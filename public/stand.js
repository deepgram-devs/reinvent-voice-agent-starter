// The booth screen: captures the mic, plays the agent's voice, shows captions and the QR code. The server decides when
// a conversation starts and ends (from the console, or the Start button here) and relays everything to Deepgram.

import { booth, config, connect, passcode, setPasscode } from "./common.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
let micCtx, outCtx, live = false, armed = false, call = false;
let playAt = 0, sources = [], drainTimer = null;

$("who").textContent = $("setupbooth").textContent = `Booth ${booth}`;
$("consolelink").href = $("consolelink").textContent = `/console?booth=${encodeURIComponent(booth)}`;
$("qrurl").textContent = config.repoUrl.replace(/^https?:\/\//, "");
if (config.passcode && !passcode()) $("pass").classList.remove("hidden");

function setState(state, text) {
  body.dataset.state = state;
  $("state").textContent = text;
}

// ---- audio ---------------------------------------------------------------------------------------------------------

async function arm() {
  if (armed) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  outCtx = new AudioContext({ sampleRate: 24000 });
  micCtx = new AudioContext({ sampleRate: 16000 });                  // the browser resamples the mic to 16 kHz
  await micCtx.audioWorklet.addModule("mic-worklet.js");
  const mic = new AudioWorkletNode(micCtx, "mic");
  micCtx.createMediaStreamSource(stream).connect(mic);
  mic.port.onmessage = (e) => { if (live) server.send(e.data); };    // 16-bit PCM, 40 ms a chunk
  armed = true;
  server.send({ type: "armed" });
  setState("idle", "Ready");
}

// The agent's voice arrives as raw 16-bit PCM at 24 kHz: queue each chunk right after the one before.
function play(buffer) {
  if (!outCtx) return;
  const pcm = new Int16Array(buffer);
  const audio = outCtx.createBuffer(1, pcm.length, 24000);
  const ch = audio.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
  const src = outCtx.createBufferSource();
  src.buffer = audio;
  src.connect(outCtx.destination);
  playAt = Math.max(playAt, outCtx.currentTime);
  src.start(playAt);
  playAt += audio.duration;
  sources.push(src);
  src.onended = () => { sources = sources.filter((s) => s !== src); };
}

// Barge-in: the visitor started talking, so stop the agent's voice at once.
function flush() {
  sources.forEach((s) => { try { s.stop(); } catch {} });
  sources = [];
  playAt = 0;
}

// ---- captions ------------------------------------------------------------------------------------------------------

let ccTimer;
function caption(role, text) {
  const el = role === "user" ? $("ccuser") : $("ccagent");
  el.textContent = text;
  el.classList.remove("gone");
  if (role === "user") $("ccagent").classList.add("gone");
  clearTimeout(ccTimer);
  ccTimer = setTimeout(() => { $("ccuser").classList.add("gone"); $("ccagent").classList.add("gone"); }, 12000);
}

// ---- the server ----------------------------------------------------------------------------------------------------

const server = connect("stand", {
  onstatus(up) {
    if (!up) { call = live = false; flush(); clearInterval(drainTimer); body.dataset.call = "off"; $("go").textContent = "Start"; setState("idle", "Offline"); }
  },
  onjson(msg) {
    switch (msg.type) {
      case "hello":
        body.dataset.qr = msg.qr ? "on" : "off";
        if (armed) server.send({ type: "armed" });                   // reconnected: still ready
        setState("idle", armed ? "Ready" : "Waiting");
        break;
      case "start":
        call = live = true;
        body.dataset.call = "on";
        $("go").textContent = "End";
        setState("listening", "Connecting");
        break;
      case "state":
        setState(msg.state, { listening: "Listening", user: "Listening", thinking: "Thinking", agent: "Speaking" }[msg.state] || msg.state);
        break;
      case "flush": flush(); break;
      case "caption": caption(msg.role, msg.text); break;
      case "qr": body.dataset.qr = msg.on ? "on" : "off"; break;
      case "end":
        // The goodbye is in: tell the server when the speaker has played it all.
        live = false;
        clearInterval(drainTimer);
        drainTimer = setInterval(() => {
          if (!outCtx || outCtx.currentTime >= playAt) { clearInterval(drainTimer); server.send({ type: "drained" }); }
        }, 100);
        break;
      case "stop":
        call = live = false;
        clearInterval(drainTimer);
        flush();
        clearTimeout(ccTimer);
        $("ccuser").textContent = $("ccagent").textContent = "";
        $("ccuser").classList.add("gone"); $("ccagent").classList.add("gone");
        body.dataset.call = "off";
        $("go").textContent = "Start";
        setState("idle", "Ready");
        break;
      case "error": setState("idle", "Error"); caption("agent", msg.text); break;
      case "replaced": break;
    }
  },
  onbinary: (buffer) => { if (call) play(buffer); },
  onrefused() {
    $("setup").classList.remove("hidden");
    $("pass").classList.remove("hidden");
    $("err").textContent = passcode() ? "That passcode is wrong." : "This booth needs a passcode.";
  },
  onreplaced() {
    $("setup").classList.remove("hidden");
    $("err").textContent = "Another booth screen took over this booth. Reload to take it back.";
    $("arm").disabled = true;
  },
});

$("arm").addEventListener("click", async () => {
  $("err").textContent = "";
  if (!$("pass").classList.contains("hidden")) {
    setPasscode($("pass").value.trim());
    server.reconnect();
  }
  try {
    await arm();
    $("setup").classList.add("hidden");
    $("go").disabled = false;
  } catch (err) {
    $("err").textContent = `Could not use the microphone: ${err.message}`;
  }
});

$("go").addEventListener("click", () => server.send({ type: call ? "stop" : "start" }));
