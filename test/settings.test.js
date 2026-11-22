import { test } from "node:test";
import assert from "node:assert/strict";
import { settings, closingPrompt, ROLES, FUNCTIONS } from "../agent.config.js";

test("the agent uses Flux to listen, Think-Fast to think and Flux TTS to speak", () => {
  const s = settings();
  assert.equal(s.type, "Settings");
  assert.deepEqual(s.agent.listen.provider, { type: "deepgram", version: "v2", model: "flux-general-en" });
  assert.deepEqual(s.agent.think.provider, { type: "deepgram", model: "think-fast" });
  assert.equal(s.agent.speak.provider.version, "v2");
  assert.equal(s.audio.input.sample_rate, 16000);
  assert.equal(s.audio.output.sample_rate, 24000);
  assert.ok(s.agent.greeting);
});

test("the role brief is part of the prompt, and an unknown role is any visitor", () => {
  assert.match(settings({ role: "developer" }).agent.think.prompt, /is a developer/);
  assert.match(settings({ role: "nope" }).agent.think.prompt, new RegExp(ROLES.general.brief.slice(0, 30)));
});

test("the agent can show the code and end the call, both only once the visitor's turn has ended", () => {
  assert.deepEqual(settings().agent.think.functions.map((f) => f.name), ["show_code", "end_call"]);
  assert.ok(FUNCTIONS.every((f) => f.defer_until_eot === true));
});

test("only the developer close asks about building one and shows the code", () => {
  assert.match(closingPrompt("developer"), /show_code/);
  assert.doesNotMatch(closingPrompt("general"), /show_code/);
  assert.match(closingPrompt("general"), /end_call/);
});
