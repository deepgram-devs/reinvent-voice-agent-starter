// The booth's conversation logic, against a fake Voice Agent API socket and fake browser sockets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Booth, boothId, passcodeOk } from "../booth.js";

class Fake extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; }
  send(data) { this.sent.push(typeof data === "string" ? JSON.parse(data) : data); }
  close() { this.readyState = 3; this.emit("close", 1000, ""); }
  of(type) { return this.sent.filter((m) => m.type === type); }
}

const TIMING = { tickMs: 5, quietMs: 20, endGapMs: 20, endMaxMs: 2000, drainMaxMs: 100, noAnswerMs: 60,
  closingMaxMs: 2000 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(role = "general", timing = {}) {
  const agent = new Fake(), stand = new Fake(), con = new Fake();
  const booth = new Booth("1", { connect: () => agent, log: () => {}, timing: { ...TIMING, ...timing } });
  booth.attachStand(stand);
  booth.attachConsole(con);
  stand.emit("message", JSON.stringify({ type: "armed" }), false);
  con.emit("message", JSON.stringify({ type: "start", role }), false);
  agent.emit("open");
  const say = (msg) => agent.emit("message", JSON.stringify(msg), false);
  say({ type: "SettingsApplied" });
  return { agent, stand, con, booth, say };
}

test("Start opens the agent with the role's Settings, and the screen starts the mic", () => {
  const { agent, stand, booth } = setup("developer");
  assert.equal(agent.of("Settings").length, 1);
  assert.match(agent.of("Settings")[0].agent.think.prompt, /developer/);
  assert.equal(stand.of("start").length, 1);
  booth.stop("test");
});

test("Start is refused until the booth screen is set up", () => {
  const stand = new Fake(), con = new Fake();
  const booth = new Booth("1", { connect: () => assert.fail("no agent"), log: () => {}, timing: TIMING });
  booth.attachStand(stand);
  booth.attachConsole(con);
  con.emit("message", JSON.stringify({ type: "start" }), false);
  assert.equal(booth.call, null);
  assert.match(con.of("event").at(-1).text, /Set up|click/i);
});

test("mic audio reaches the agent, agent audio and captions reach the screen, barge-in flushes", () => {
  const { agent, stand, booth, say } = setup();
  stand.emit("message", Buffer.from([1, 2]), true);
  assert.equal(agent.sent.filter(Buffer.isBuffer).length, 1);
  agent.emit("message", Buffer.from([3, 4]), true);
  assert.equal(stand.sent.filter(Buffer.isBuffer).length, 1);
  say({ type: "ConversationText", role: "assistant", content: "Hi there" });
  assert.deepEqual(stand.of("caption")[0], { type: "caption", role: "agent", text: "Hi there" });
  say({ type: "UserStartedSpeaking" });
  assert.equal(stand.of("flush").length, 1);
  booth.stop("test");
});

test("end_call gets no response, and the call ends once the goodbye has played", async () => {
  const { agent, stand, booth, say } = setup();
  say({ type: "FunctionCallRequest", functions: [{ id: "f1", name: "end_call", arguments: "{}", client_side: true }] });
  agent.emit("message", Buffer.from([0, 0]), true);           // the goodbye audio
  await wait(80);
  assert.equal(agent.of("FunctionCallResponse").length, 0);
  assert.equal(stand.of("end").length, 1);
  stand.emit("message", JSON.stringify({ type: "drained" }), false);
  assert.equal(booth.call, null);
  assert.equal(agent.readyState, 3);
});

test("show_code mid-conversation shows the QR and answers the agent, which keeps talking", () => {
  const { agent, stand, booth, say } = setup();
  say({ type: "FunctionCallRequest", functions: [{ id: "f2", name: "show_code", arguments: "{}", client_side: true }] });
  assert.equal(stand.of("qr").at(-1).on, true);
  assert.equal(agent.of("FunctionCallResponse")[0].id, "f2");
  assert.equal(booth.call.ending, null);
  booth.stop("test");
});

test("Wrap up: closing prompt, then a hidden cue when quiet; the general close ends on end_call", async () => {
  const { agent, con, booth, say } = setup();
  con.emit("message", JSON.stringify({ type: "wrap" }), false);
  assert.match(agent.of("UpdatePrompt")[0].prompt, /end_call/);
  say({ type: "PromptUpdated" });
  await wait(60);
  assert.equal(agent.of("InjectUserMessage")[0].content, "[operator] Please wrap up now.");
  say({ type: "FunctionCallRequest", functions: [{ id: "f3", name: "end_call", arguments: "{}", client_side: true }] });
  assert.ok(booth.call.ending);
  booth.stop("test");
});

test("a reply already under way when Wrap up is pressed does not count as the close", () => {
  const { con, booth, say } = setup();
  say({ type: "AgentStartedSpeaking" });
  con.emit("message", JSON.stringify({ type: "wrap" }), false);
  say({ type: "PromptUpdated" });
  say({ type: "AgentAudioDone" });
  assert.equal(booth.call.closing.replies, 0);
  booth.stop("test");
});

test("developer close: a yes gets show_code: the QR, a goodbye, and the call ends with the QR still up", async () => {
  const { agent, stand, con, booth, say } = setup("developer");
  con.emit("message", JSON.stringify({ type: "wrap" }), false);
  assert.match(agent.of("UpdatePrompt")[0].prompt, /show_code/);
  say({ type: "PromptUpdated" });
  say({ type: "AgentStartedSpeaking" });
  say({ type: "ConversationText", role: "assistant", content: "Great to chat! Want to build one?" });
  say({ type: "AgentAudioDone" });
  say({ type: "ConversationText", role: "user", content: "Yes!" });
  say({ type: "FunctionCallRequest", functions: [{ id: "f4", name: "show_code", arguments: "{}", client_side: true }] });
  assert.equal(stand.of("qr").at(-1).on, true);
  assert.ok(booth.call.ending);
  await wait(550);
  assert.match(agent.of("FunctionCallResponse")[0].content, /goodbye/);   // it had said nothing yet: still say goodbye
  booth.stop("goodbye");
  assert.equal(booth.qr, true);                        // the QR stays up after the goodbye
  await wait(80);
  assert.equal(booth.qr, true);
});

test("the code QR stays up until the console hides it or the next conversation starts", () => {
  const { stand, con, booth } = setup();
  con.emit("message", JSON.stringify({ type: "qr", on: true }), false);
  booth.stop("test");
  assert.equal(booth.qr, true);
  con.emit("message", JSON.stringify({ type: "start" }), false);
  assert.equal(stand.of("qr").at(-1).on, false);
  con.emit("message", JSON.stringify({ type: "qr", on: true }), false);
  con.emit("message", JSON.stringify({ type: "qr", on: false }), false);
  assert.equal(booth.qr, false);
  booth.stop("test");
});

test("developer close: when the agent already spoke before show_code, it gets no answer (one goodbye, not two)", async () => {
  const { agent, con, booth, say } = setup("developer");
  con.emit("message", JSON.stringify({ type: "wrap" }), false);
  say({ type: "PromptUpdated" });
  say({ type: "ConversationText", role: "user", content: "Yes please" });
  say({ type: "FunctionCallRequest", functions: [{ id: "f5", name: "show_code", arguments: "{}", client_side: true }] });
  say({ type: "ConversationText", role: "assistant", content: "Scan the code on the screen. Bye!" });
  await wait(550);
  assert.equal(agent.of("FunctionCallResponse").length, 0);
  booth.stop("test");
});

test("developer close: no answer to the question, so the agent says goodbye and the call ends", async () => {
  const { agent, con, booth, say } = setup("developer");
  con.emit("message", JSON.stringify({ type: "wrap" }), false);
  say({ type: "PromptUpdated" });
  say({ type: "AgentStartedSpeaking" });
  say({ type: "AgentAudioDone" });
  await wait(150);
  assert.match(agent.of("InjectAgentMessage")[0].message, /Thanks for stopping by/);
  assert.ok(booth.call.ending);
  booth.stop("test");
});

test("Wrap up's hidden cue is retried when the agent refuses it, and never shows on the screen", async () => {
  const { agent, stand, con, booth, say } = setup();
  con.emit("message", JSON.stringify({ type: "wrap" }), false);
  await wait(60);
  say({ type: "InjectionRefused" });
  await wait(60);
  assert.equal(agent.of("InjectUserMessage").length, 2);
  say({ type: "ConversationText", role: "user", content: "[operator] Please wrap up now." });
  assert.equal(stand.of("caption").length, 0);
  booth.stop("test");
});

test("the screen closing ends the conversation", () => {
  const { stand, booth } = setup();
  stand.emit("close");
  assert.equal(booth.call, null);
});

test("booth names and passcodes", () => {
  assert.equal(boothId(undefined), "1");
  assert.equal(boothId("Hall-2"), "hall-2");
  assert.equal(boothId("../x"), null);
  assert.equal(passcodeOk("anything", ""), true);
  assert.equal(passcodeOk("abc", "abc"), true);
  assert.equal(passcodeOk("abd", "abc"), false);
  assert.equal(passcodeOk(undefined, "abc"), false);
});
