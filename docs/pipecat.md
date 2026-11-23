# Run the Pipecat implementation

This backend uses native Pipecat Flux STT and TTS services, context aggregators
and an OpenAI-style LLM adapter for Deepgram's direct Think-Fast API. The Node
server and existing browser interface stay in place.

## Requirements

- Node.js 22.9+ and npm.
- Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/).
- A Deepgram key with Flux STT, Flux TTS and **direct Think-Fast endpoint** access.

Access to Think-Fast through the Voice Agent API has not been verified to imply
access to the direct endpoint. The adapter is pinned to Pipecat 1.17.0.

## Setup

Run `npm ci` in the repository root and copy `.env.example` to `.env`. Set:

```dotenv
DEEPGRAM_API_KEY=your-key
VOICE_BACKEND=pipecat
PIPECAT_TOKEN=your-random-shared-secret
```

Leave `THINK_PROVIDER=deepgram` and `THINK_MODEL=think-fast`, their defaults.
A separate model-provider fallback is not implemented for this backend.

In one terminal:

```sh
cd pipecat_agent
uv sync --frozen --python 3.12
uv run python agent.py
```

In a second terminal, from the repository root:

```sh
npm start
```

Open [localhost:3000](http://localhost:3000), allow the microphone, and start a call.
The console is at [localhost:3000/console](http://localhost:3000/console).

To switch back, set `VOICE_BACKEND=deepgram`, restart Node and stop the Python
service. No browser code changes are needed.

## Implementation boundaries

- The service binds only to `127.0.0.1`; Node authenticates with `PIPECAT_TOKEN`.
- Each socket gets its own pipeline and in-memory context.
- The existing browser socket carries PCM16 mono audio: 16 kHz in, 24 kHz out.
- Flux final turn detection drives replies; eager speculative replies are disabled.
- The adapter translates SDK chat-completion requests to `/v1/think`, using
  Deepgram `Token` authentication.
- Pipecat tools return results without an additional LLM invocation so the agent
  does not generate another goodbye. Add explicit follow-up behavior for tools
  whose results need a spoken answer.
- The compatibility path uses a system message in `LLMContext`. Pipecat currently
  warns that this should migrate to `system_instruction` before version 2.
- The existing Dockerfile runs only the Node backend. See [deployment](deployment.md).

## Validation

```sh
cd pipecat_agent
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

Tests mock provider responses and audio services. They do not establish live
Think-Fast compatibility, account access or audible performance. Before event
use, hear greeting, replies, barge-in, captions, QR, general/developer Wrap up
and End on the actual hardware.

Return to the [README](../README.md).
