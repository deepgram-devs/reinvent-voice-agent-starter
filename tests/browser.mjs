// Optional browser checks: start uv run python tests/browser_server.py, then isolated headless Chrome on CDP 9333.
// Run with Node 22+: node tests/browser.mjs. The application itself does not require Node.
const base = 'http://127.0.0.1:4878', cdp = 'http://127.0.0.1:9333';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function tab(url) {
  const item = await (await fetch(cdp + '/json/new?' + encodeURIComponent(url), {method:'PUT'})).json();
  const ws = new WebSocket(item.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve));
  let next = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(message.params));
  });
  const send = (method, params={}) => new Promise(resolve => {
    const id = ++next; pending.set(id, resolve); ws.send(JSON.stringify({id,method,params}));
  });
  await send('Runtime.enable');
  const js = async expression => {
    const result = await send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true,userGesture:true});
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
    return result.result?.result?.value;
  };
  const until = async expression => {
    for (let i=0; i<60; i++) { if (await js(expression)) return true; await sleep(100); }
    return false;
  };
  return {js,until,send,errors,close:()=>fetch(cdp+'/json/close/'+item.id)};
}
function check(label, value) { if (!value) throw new Error(label); console.log('PASS: '+label); }
const stand = await tab(base), consolePage = await tab(base+'/console');
try {
  check("stand module connected", await stand.until("document.getElementById('state').textContent === 'Waiting'"));
  await stand.js("document.getElementById('arm').click()");
  check('microphone and speaker set up', await consolePage.until("document.getElementById('title').textContent === 'Ready'"));
  check('no role selection', await consolePage.js("!document.getElementById('role')"));
  await consolePage.js("document.getElementById('start').click()");
  check('Python starts the call', await consolePage.until("document.getElementById('title').textContent === 'In conversation'"));
  check('agent captions arrive', await stand.until("document.getElementById('ccagent').textContent.includes('Python starter')"));
  await consolePage.js("document.getElementById('qr').click()");
  check('QR appears without hiding subtitles', await stand.until("document.body.dataset.qr === 'on' && !document.getElementById('ccagent').classList.contains('gone')"));
  for (const [width,height] of [[320,740],[390,844],[768,1024],[1440,900]]) {
    await consolePage.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    check('console fits '+width+'px', await consolePage.js("document.documentElement.scrollWidth <= innerWidth && ['start','stop','wrap','qr'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>=44 && r.height>=44})"));
  }
  await consolePage.send('Emulation.clearDeviceMetricsOverride');
  await consolePage.js("window.confirm=()=>{throw new Error('No confirmation for hard stop')};document.getElementById('stop').click()");
  check('hard stop returns to Ready', await consolePage.until("document.getElementById('title').textContent === 'Ready'"));
  check('hard stop clears captions', await stand.until("document.body.dataset.call === 'off' && document.getElementById('ccagent').textContent === ''"));
  await consolePage.js("document.getElementById('start').click()");
  check('next call starts', await consolePage.until("document.getElementById('title').textContent === 'In conversation'"));
  await consolePage.js("document.getElementById('wrap').click()");
  check('Finish closes after the goodbye plays', await consolePage.until("document.getElementById('title').textContent === 'Ready'"));
  check('no JavaScript errors', stand.errors.length === 0 && consolePage.errors.length === 0);
} finally { await stand.close(); await consolePage.close(); }
