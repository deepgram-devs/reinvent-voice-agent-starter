# Coding agent guide

## Read first

Read `README.md`, then the source files relevant to the task. Use
`docs/architecture.md` for the application structure, `docs/configuration.md` for
environment variables, and `docs/pipecat.md` for the optional pipeline.
Repository code and lockfiles determine actual behavior; do not infer features
from upstream framework capabilities or the full conference demo.

## Project boundaries

- The application is Python + asyncio + aiohttp, with plain browser JavaScript.
  No Node runtime or frontend build is required. Node 22+ is optional for the
  existing browser check in `tests/browser.mjs`.
- `VOICE_BACKEND=deepgram` is the default. `VOICE_BACKEND=pipecat` uses a local,
  authenticated Python sidecar. Both share the UI, configuration and business handlers.
- The root and `pipecat_agent/` are separate uv projects with separate lockfiles.
  Python 3.12 works for both; Pipecat requires Python 3.11–3.13.
- Pipecat currently requires direct Think-Fast access. Do not claim that the
  managed-model fallback is available to it or that live compatibility is verified.

## Where to make changes

| Task | Owning source |
| --- | --- |
| Prompt, greeting, model settings | `agent_config.py` |
| Function schemas and business handlers | `functions.py`: `DEFINITIONS`, `HANDLERS` |
| Function execution, cancellation, call lifecycle | `booth.py` |
| Backend endpoint and credentials | `backend.py` |
| HTTP/WebSocket routes and browser authentication | `server.py` |
| Pipecat frames, tools, and Think-Fast adapter | `pipecat_agent/agent.py` |
| Browser mic, playback, and captions | `public/stand.js`, `public/mic-worklet.js` |
| Operator controls | `public/console.js`, `public/console.html` |
| Server regression coverage | `tests/test_starter.py`, `tests/test_backend.py` |
| Pipeline regression coverage | `pipecat_agent/test_agent.py` |

Keep business-function schemas and handlers in the shared registry. Validate
arguments inside handlers and return JSON-serializable results. Use awaited I/O;
do not block audio or stop controls. Treat model output and tool arguments as
untrusted input. Execute only registered functions.

## Behavior to preserve

- Browser audio is PCM16 mono: 16 kHz input, 24 kHz output. If changing formats,
  update both ends and their tests together.
- Barge-in clears queued playback. Stop now stops immediately. Finish requests one
  short goodbye, drains playback, and has a hard deadline.
- Cancelled function work must not deliver a late result to an ended or newer call.
- Each booth has one stand and at most one call; state is in memory in one server.
- The service-status example is fictional. Do not present it as a live integration.

## Secrets and visitor data

Never commit or print API keys, passcodes, `.env`, visitor audio, or transcripts.
Use `.env.example` for placeholder configuration. Keep provider keys server-side,
the sidecar on loopback, and browser/sidecar authentication intact. Do not add
recorders, content-bearing logs, or persistence of visitor data. See `SECURITY.md`.

## Validation commands

From the repository root:

```sh
uv sync --frozen --group dev --python 3.12
uv run pytest -q
```

For pipeline changes, also run from `pipecat_agent/`:

```sh
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

Tests must use fakes, never paid or shared provider sessions. Local server tests
open loopback sockets. The optional browser check documents its setup at the top
of `tests/browser.mjs`. Run `git diff --check` before submitting changes.

For dependency changes, update the owning `pyproject.toml` and `uv.lock` together.
For documentation-only changes, check local links, command paths and code references;
no live voice session is needed. Prompt, voice, audio and closing changes require
a real conversation before claiming audible behavior is verified. Report that
check as outstanding if it has not happened.

## Completion report

State what changed, the checks actually run, and any remaining limitations.
Keep documentation aligned with the implemented backend. Do not claim deployed
behavior, provider access or performance that has not been verified.
