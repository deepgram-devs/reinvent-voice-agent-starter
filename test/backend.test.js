import { test } from "node:test";
import assert from "node:assert/strict";
import { agentConnection } from "../backend.js";
import { settings } from "../agent.config.js";

test("Deepgram remains the default and invalid backends fail early", () => {
  assert.equal(typeof agentConnection("test", {}), "function");
  assert.throws(() => agentConnection("test", { VOICE_BACKEND: "typo" }), /VOICE_BACKEND/);
});

test("Pipecat requires a token and a local sidecar", () => {
  assert.throws(() => agentConnection("test", { VOICE_BACKEND: "pipecat" }), /PIPECAT_TOKEN/);
  const env = { VOICE_BACKEND: "pipecat", PIPECAT_TOKEN: "local-secret" };
  assert.equal(typeof agentConnection("test", env), "function");
  for (const PIPECAT_URL of ["ws://example.com/agent", "https://localhost/agent"]) {
    assert.throws(() => agentConnection("test", { ...env, PIPECAT_URL }), /loopback/);
  }
});

test("the Pipecat prompt describes the implementation that runs", () => {
  const previous = process.env.VOICE_BACKEND;
  try {
    process.env.VOICE_BACKEND = "pipecat";
    assert.match(settings().agent.think.prompt, /You run on Pipecat/);
    assert.doesNotMatch(settings().agent.think.prompt, /You run on Deepgram's Voice Agent API/);
  } finally {
    if (previous === undefined) delete process.env.VOICE_BACKEND;
    else process.env.VOICE_BACKEND = previous;
  }
});
