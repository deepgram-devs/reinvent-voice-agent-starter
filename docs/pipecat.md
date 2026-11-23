# Pipecat setup

Both implementations use Python. The aiohttp server serves the shared interface;
a private Pipecat service provides Flux STT → Think-Fast → Flux TTS. No Node runtime
or frontend build step is required.

Install Python 3.11–3.13 and uv. Copy `.env.example` to the repository root `.env`:

```dotenv
DEEPGRAM_API_KEY=your-key
VOICE_BACKEND=pipecat
PIPECAT_TOKEN=your-random-shared-secret
```

The key needs Flux STT/TTS and **direct Think-Fast endpoint** access. Access through
the Voice Agent API has not been verified to imply direct endpoint access.
Keep `THINK_PROVIDER=deepgram` and `THINK_MODEL=think-fast`, their defaults.
The managed-model fallback applies only to the default backend.

Start the pipeline in one terminal:

```sh
cd pipecat_agent
uv sync --frozen --python 3.12
uv run python agent.py
```

Start the web server in another terminal from the repository root:

```sh
uv run python server.py
```

Open http://localhost:3000 and allow the microphone. Use `/console` for controls.
To switch back, set `VOICE_BACKEND=deepgram`, restart the server and stop the sidecar.

## Behavior and extension points

- The pipeline listens only on `127.0.0.1:7861` and authenticates with `PIPECAT_TOKEN`.
- Each socket owns its pipeline and in-memory context; no recorder is installed.
- Audio is PCM16 mono: 16 kHz input and 24 kHz output.
- Native Pipecat services handle Flux STT/TTS and context aggregation. Flux final
  turn boundaries drive replies; eager speculative replies are disabled.
- The LLM adapter maps chat-completion requests to `/v1/think` with `Token` auth.
- The shared `agent_config.py` supplies the prompt and function schemas. Function
  requests go back to `booth.py`, which calls registered `functions.py` handlers.
  Results return to Pipecat and can generate a spoken response. `end_call` suppresses
  that response to prevent a second goodbye.
- Pipecat is pinned to 1.17.0. Its system-message compatibility path emits a
  deprecation warning; migrate before version 2.
- The default container includes only the managed backend. Run both Python
  processes together on a host for Pipecat; see [deployment](deployment.md).

## Checks

```sh
cd pipecat_agent
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

Tests use fakes. They do not prove model access, live API compatibility, voice
availability or audible performance. Before event use, hear greeting, replies,
interruption, sample function lookup, QR, Finish and Stop now on actual hardware.
