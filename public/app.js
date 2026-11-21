// The browser side: send the microphone to the server, play the agent's voice, show the conversation.
// Agent events are documented at https://developers.deepgram.com/docs/voice-agent-outputs

const $ = (id) => document.getElementById(id);
let ws, mic, micCtx, outCtx, playAt = 0, sources = [];

function setState(state, text) {
  document.body.dataset.state = state;
  $("state").textContent = text;
}

function say(role, text) {
  const line = document.createElement("div");
  line.className = `line ${role}`;
  line.innerHTML = `<b>${role === "user" ? "You" : "Agent"}</b>`;
  line.append(text);
  $("log").append(line);
  line.scrollIntoView({ block: "end", behavior: "smooth" });
}

// The agent's voice arrives as raw 16-bit PCM at 24 kHz: queue each chunk right after the one before.
function play(buffer) {
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

// Barge-in: the person started talking, so stop the agent's voice at once.
function stopPlayback() {
  sources.forEach((s) => { try { s.stop(); } catch {} });
  sources = [];
  playAt = 0;
}

function onEvent(msg) {
  switch (msg.type) {
    case "SettingsApplied": setState("listening", "Listening. Say hello."); break;
    case "UserStartedSpeaking": stopPlayback(); setState("user", "You're talking. Pause to think: it waits."); break;
    case "AgentThinking": setState("listening", "Thinking..."); break;
    case "AgentStartedSpeaking": setState("agent", "Agent speaking. Talk over it to interrupt."); break;
    case "AgentAudioDone": setState("listening", "Listening."); break;
    case "ConversationText": say(msg.role === "user" ? "user" : "agent", msg.content); break;
    case "Error": setState("idle", `Error: ${msg.description || msg.code}`); break;
  }
}

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  outCtx = new AudioContext({ sampleRate: 24000 });
  micCtx = new AudioContext({ sampleRate: 16000 });                 // the browser resamples the mic to 16 kHz
  await micCtx.audioWorklet.addModule("mic-worklet.js");
  mic = new AudioWorkletNode(micCtx, "mic");
  micCtx.createMediaStreamSource(stream).connect(mic);

  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/agent`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (e) => (typeof e.data === "string" ? onEvent(JSON.parse(e.data)) : play(e.data));
  ws.onclose = () => stop("The conversation ended. Press Start to talk again.");
  mic.port.onmessage = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(e.data); };
  stream.getTracks().forEach((t) => (t.onended = () => stop("Microphone stopped.")));
  mic.stream = stream;

  setState("listening", "Connecting...");
  $("go").textContent = "Stop";
  $("go").className = "stop";
}

function stop(text = "Stopped. Press Start to talk again.") {
  if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  mic?.stream?.getTracks().forEach((t) => t.stop());
  micCtx?.close(); outCtx?.close();
  ws = mic = micCtx = outCtx = null;
  sources = []; playAt = 0;
  setState("idle", text);
  $("go").textContent = "Start";
  $("go").className = "";
}

$("go").addEventListener("click", () => (ws ? stop() : start().catch((err) => stop(`Could not start: ${err.message}`))));
