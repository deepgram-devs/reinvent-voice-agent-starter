import { test } from "node:test";
import assert from "node:assert/strict";
import { settings } from "../agent.config.js";

test("the agent uses Flux to listen, Think-Fast to think and Flux TTS to speak", () => {
  const s = settings();
  assert.equal(s.type, "Settings");
  assert.deepEqual(s.agent.listen.provider, { type: "deepgram", version: "v2", model: "flux-general-en" });
  assert.deepEqual(s.agent.think.provider, { type: "deepgram", model: "think-fast" });
  assert.equal(s.agent.speak.provider.version, "v2");
  assert.equal(s.audio.input.sample_rate, 16000);
  assert.equal(s.audio.output.sample_rate, 24000);
  assert.ok(s.agent.greeting && s.agent.think.prompt);
});
