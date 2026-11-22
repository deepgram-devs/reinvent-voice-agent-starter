// One booth: the booth screen (mic and speaker), any consoles watching it, and at most one conversation, which is one
// Voice Agent API socket. The server owns the agent socket, so a console can wrap up a call the screen is
// running, and your API key never reaches a browser.
//
//   booth screen  <-- audio, captions, QR -->  Booth  <-- Settings, audio, events -->  Voice Agent API
//   console(s)    <-- status, transcript  -->    |
//                 --> start, end, wrap up, QR -->

import crypto from "node:crypto";
import { WebSocket } from "ws";
import { settings, closingPrompt, ROLES } from "./agent.config.js";

export const TIMING = {
  tickMs: 200,
  quietMs: 1200,        // Wrap up: both sides silent this long before its hidden cue goes in
  endGapMs: 1200,       // after end_call: the goodbye is over once no agent audio has arrived for this long
  endMaxMs: 10000,      // after end_call: end anyway
  drainMaxMs: 8000,     // the screen gets this long to finish playing the goodbye
  noAnswerMs: 10000,    // developer close: no answer to "want to build one?" for this long, so say goodbye
  closingMaxMs: 45000,  // a close never takes longer than this
};

const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const CUE = "[operator]";        // Wrap up's hidden user turns start with this; never shown or captioned
const OPEN = 1;

export class Booth {
  constructor(id, { key, connect, log = console.log, timing = TIMING } = {}) {
    this.id = id;
    this.t = timing;
    this.log = (...a) => log(`[booth ${id}]`, ...a);
    // How the agent socket is made; tests pass a fake.
    this.connect = connect || (() => new WebSocket(AGENT_URL, { headers: { Authorization: `Token ${key}` } }));
    this.stand = null;
    this.armed = false;
    this.consoles = new Set();
    this.call = null;
    this.lines = [];          // the last conversation's transcript, for consoles that join late
    this.qr = false;          // the code QR stays up until the console hides it or the next conversation starts
  }

  // ---- browsers ---------------------------------------------------------------------------------------------------

  attachStand(ws) {
    if (this.stand) {
      send(this.stand, { type: "replaced" });
      this.stand.close(4000, "another booth screen took over");
    }
    this.stand = ws;
    this.armed = false;
    send(ws, { type: "hello", booth: this.id, qr: this.qr });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return this.micAudio(data);
      const msg = parse(data);
      if (msg.type === "armed") { this.armed = true; this.status(); }
      else if (msg.type === "start") this.start(msg.role);
      else if (msg.type === "stop") this.stop("ended on the booth screen");
      else if (msg.type === "drained") this.call?.ending && this.stop("goodbye");
    });
    ws.on("close", () => {
      if (this.stand !== ws) return;
      this.stand = null;
      this.armed = false;
      this.stop("the booth screen closed");
      this.status();
    });
    this.status();
  }

  attachConsole(ws) {
    this.consoles.add(ws);
    send(ws, { type: "roles", roles: Object.entries(ROLES).map(([id, r]) => ({ id, label: r.label })) });
    for (const line of this.lines) send(ws, { type: "line", ...line });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = parse(data);
      if (msg.type === "start") this.start(msg.role);
      else if (msg.type === "stop") this.stop("ended from the console");
      else if (msg.type === "wrap") this.wrap();
      else if (msg.type === "qr") this.showQr(!!msg.on);
    });
    ws.on("close", () => this.consoles.delete(ws));
    this.status();
  }

  status() {
    const c = this.call;
    this.toConsoles({
      type: "status", booth: this.id, stand: !!this.stand, armed: this.armed, call: !!c, live: !!c?.live,
      role: c?.role || null, closing: !!c?.closing, ending: !!c?.ending, qr: this.qr,
    });
  }

  toConsoles(msg) { for (const ws of this.consoles) send(ws, msg); }

  event(text) { this.toConsoles({ type: "event", text }); }

  // ---- the conversation -------------------------------------------------------------------------------------------

  start(role) {
    if (this.call) return this.event("A conversation is already running.");
    if (!this.stand) return this.event("No booth screen is connected.");
    if (!this.armed) return this.event("Click the booth screen once first, to allow its mic and speaker.");
    role = ROLES[role] ? role : "general";
    const agent = this.connect();
    const now = Date.now();
    const c = this.call = {
      agent, role, live: false, at: now,
      agentSpeaking: false, visitorSpeaking: false, quietSince: now, seq: 0, replySeq: 0, lastAudio: 0,
      cues: [], closing: null, ending: null,
    };
    this.lines = [];
    this.showQr(false);
    agent.on("open", () => {
      agent.send(JSON.stringify(settings({ role })));
      c.keepAlive = setInterval(() => agent.readyState === OPEN && agent.send('{"type":"KeepAlive"}'), 8000);
    });
    agent.on("message", (data, isBinary) => this.agentMessage(c, data, isBinary));
    agent.on("close", (code, reason) => {
      if (code && code !== 1000 && code !== 1005) this.log("agent closed", code, String(reason || ""));
      if (this.call === c) this.stop("the agent connection closed");
    });
    agent.on("error", (err) => { this.log("agent error", err.message); this.event(`Agent error: ${err.message}`); });
    c.timer = setInterval(() => this.tick(c), this.t.tickMs);
    send(this.stand, { type: "start" });
    this.log("start", role);
    this.status();
  }

  stop(reason) {
    const c = this.call;
    if (!c) return;
    this.call = null;
    clearInterval(c.timer);
    clearInterval(c.keepAlive);
    if (c.agent.readyState <= OPEN) c.agent.close();
    send(this.stand, { type: "stop" });
    this.log("stop:", reason);
    this.event(`Conversation ended: ${reason}.`);
    this.status();
  }

  micAudio(data) {
    const c = this.call;
    if (c?.live && !c.ending && c.agent.readyState === OPEN) c.agent.send(data);
  }

  agentMessage(c, data, isBinary) {
    if (this.call !== c) return;
    if (isBinary) {
      c.lastAudio = Date.now();
      if (this.stand?.readyState === OPEN) this.stand.send(data, { binary: true });
      return;
    }
    const msg = parse(data);
    const now = Date.now();
    switch (msg.type) {
      case "SettingsApplied":
        c.live = true;
        this.status();
        break;
      case "UserStartedSpeaking":
        c.visitorSpeaking = true;
        c.agentSpeaking = false;
        send(this.stand, { type: "flush" });               // stop the agent's voice at once: barge-in
        send(this.stand, { type: "state", state: "user" });
        break;
      case "EndOfTurn":
        c.visitorSpeaking = false;
        c.quietSince = now;
        break;
      case "AgentThinking":
        send(this.stand, { type: "state", state: "thinking" });
        break;
      case "AgentStartedSpeaking":
        c.agentSpeaking = true;
        c.replySeq = ++c.seq;                               // which came first: this reply or the closing prompt
        send(this.stand, { type: "state", state: "agent" });
        break;
      case "AgentAudioDone":
        c.agentSpeaking = false;
        c.quietSince = now;
        send(this.stand, { type: "state", state: "listening" });
        this.replyDone(c);
        break;
      case "ConversationText":
        this.text(c, msg.role === "user" ? "user" : "agent", String(msg.content || ""));
        break;
      case "PromptUpdated":
        if (c.closing && !c.closing.promptSeq) c.closing.promptSeq = ++c.seq;
        break;
      case "FunctionCallRequest":
        for (const f of msg.functions || []) if (f.client_side) this.callFunction(c, f);
        break;
      case "InjectionRefused":
        if (c.inFlight) { c.cues.unshift(c.inFlight); c.inFlight = null; }
        break;
      case "Error":
        this.log("Error", msg.code || "", msg.description || "");
        this.event(`Error from the agent: ${msg.description || msg.code}`);
        send(this.stand, { type: "error", text: msg.description || msg.code });
        break;
      case "Warning":
        // VOICE_PROMPT_ADDED is expected with think-fast: Deepgram adds spoken-style instructions ahead of your prompt
        if (msg.code !== "VOICE_PROMPT_ADDED") this.log("Warning", msg.code || "", msg.description || "");
        break;
    }
  }

  text(c, role, content) {
    if (role === "user") {
      c.visitorSpeaking = false;
      c.quietSince = Date.now();
      if (content.startsWith(CUE)) { c.inFlight = null; return; }   // our own cue, not the visitor
      c.saidSinceVisitor = 0;
      if (c.closing) c.closing.answered = true;
    } else {
      c.saidSinceVisitor = (c.saidSinceVisitor || 0) + 1;
    }
    const line = { role, text: content };
    this.lines.push(line);
    if (this.lines.length > 200) this.lines.shift();
    this.toConsoles({ type: "line", ...line });
    send(this.stand, { type: "caption", ...line });
  }

  callFunction(c, f) {
    this.log("function", f.name);
    if (f.name === "end_call") {
      // No FunctionCallResponse on purpose: answering it makes the model say goodbye a second time.
      this.toConsoles({ type: "line", role: "tool", text: "end_call" });
      return this.endAfterGoodbye(c);
    }
    if (f.name === "show_code") {
      this.toConsoles({ type: "line", role: "tool", text: "show_code" });
      this.showQr(true);
      if (!c.closing) return respond(c.agent, f, "The QR code is on the booth screen now.");
      // The close's last reply. If the agent has already spoken in it, that was the goodbye: no answer, or it says
      // goodbye twice. If it has not, answer so it still says goodbye. Its words can trail the request a little.
      this.endAfterGoodbye(c);
      setTimeout(() => {
        if (this.call === c && !c.saidSinceVisitor) {
          respond(c.agent, f, "The QR code is on the screen. In one short sentence, tell them to scan it and say goodbye.");
        }
      }, 500);
      return;
    }
    respond(c.agent, f, `There is no function called ${f.name}.`);
  }

  // ---- closing ----------------------------------------------------------------------------------------------------

  // Close the conversation gracefully: the agent finishes what it was saying, answers a pending question in a few
  // words, says it was great to chat, and (developer role) asks if they want to build one before the goodbye.
  wrap() {
    const c = this.call;
    if (!c || c.closing || c.ending) return;
    c.closing = { at: Date.now(), dev: !!ROLES[c.role]?.developer, replies: 0, promptSeq: 0, answered: false };
    send(c.agent, { type: "UpdatePrompt", prompt: closingPrompt(c.role) });
    c.cues.push(`${CUE} Please wrap up now.`);   // goes in at the next pause, in case no reply is coming
    this.log("wrap");
    this.event("Wrapping up.");
    this.status();
  }

  replyDone(c) {
    const k = c.closing;
    if (!k || c.ending || !k.promptSeq || c.replySeq < k.promptSeq) return;
    k.replies++;
    c.cues = c.cues.filter((n) => n !== `${CUE} Please wrap up now.`);   // a closing reply came: cue not needed
    if (!k.dev && k.replies >= 2) this.endAfterGoodbye(c);  // it was told twice and still no end_call
    if (k.dev && k.replies === 1) k.askedAt = Date.now();  // it asked "want to build one?": wait for the answer
    if (k.dev && k.replies >= 2 && k.answered) this.endAfterGoodbye(c);
    if (!k.dev && k.replies === 1) c.cues.push(`${CUE} Say goodbye now and call end_call.`);
  }

  endAfterGoodbye(c) {
    if (c.ending) return;
    c.ending = { at: Date.now() };
    c.cues = [];
    this.status();
  }

  showQr(on) {
    this.qr = on;
    send(this.stand, { type: "qr", on });
    this.status();
  }

  tick(c) {
    if (this.call !== c || !c.live) return;
    const now = Date.now();
    const quiet = !c.agentSpeaking && !c.visitorSpeaking && now - c.quietSince >= this.t.quietMs;
    const k = c.closing;

    if (c.ending) {
      const e = c.ending;
      const goodbyeOver = c.lastAudio >= e.at ? now - c.lastAudio >= this.t.endGapMs : now - e.at >= 3000;
      if (!e.drainAt && (goodbyeOver || now - e.at >= this.t.endMaxMs)) {
        e.drainAt = now;
        send(this.stand, { type: "end" });                 // the screen answers "drained" when its speaker is done
      }
      if (e.drainAt && now - e.drainAt >= this.t.drainMaxMs) this.stop("goodbye");
      return;
    }
    if (k && now - k.at >= this.t.closingMaxMs) return this.endAfterGoodbye(c);
    if (k?.dev && k.askedAt && !k.answered && quiet && now - c.quietSince >= this.t.noAnswerMs) {
      send(c.agent, { type: "InjectAgentMessage", message: "No worries. Thanks for stopping by!" });
      return this.endAfterGoodbye(c);
    }
    if (quiet && c.cues.length && !c.inFlight) {
      c.inFlight = c.cues.shift();
      c.quietSince = now;                                  // one cue per quiet moment
      send(c.agent, { type: "InjectUserMessage", content: c.inFlight });
    }
  }
}

function send(ws, msg) {
  if (ws?.readyState === OPEN) ws.send(JSON.stringify(msg));
}

function respond(agent, f, content) {
  send(agent, { type: "FunctionCallResponse", id: f.id, name: f.name, content });
}

function parse(data) {
  try { return JSON.parse(String(data)); } catch { return {}; }
}

// A booth is named in the URL: /?booth=2 and /console?booth=2. Letters, digits and dashes only.
export function boothId(raw) {
  const id = String(raw || "1").trim().toLowerCase();
  return /^[a-z0-9-]{1,24}$/.test(id) ? id : null;
}

export function passcodeOk(given, expected) {
  if (!expected) return true;
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
