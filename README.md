# Deepgram Voice Agent Starter

Build and customize a browser-based voice agent with **Python**, **Deepgram**, and
an optional **Pipecat** pipeline. Start with a working audio interface, live
captions, an operator console, and an example business function.

Choose managed orchestration with the Deepgram Voice Agent API or run the voice
pipeline yourself with Pipecat. Both implementations share the same application
configuration and Python function handlers.

[Quick start](#quick-start) · [Pipecat setup](docs/pipecat.md) ·
[Customization](#customize-the-agent) · [Coding agents](#working-with-a-coding-agent) ·
[Configuration](docs/configuration.md)

## What is included

- Browser microphone capture, streaming speech playback, and live captions.
- An operator console with **Start**, **Finish**, **Stop now**, and repository QR controls.
- Shared prompts, model configuration, and an async business-function registry.
- A read-only service-status example using clearly labeled fictional data.
- Offline tests, locked dependencies, GitHub Actions, and a container for the default backend.

The app runs on Python and aiohttp. Browser assets are plain JavaScript; no Node.js
runtime or frontend build step is required. Originally developed for Deepgram's
re:Invent booth, this repository contains the core starter experience rather than
the full conference demo.

## Choose a backend

| | Deepgram Voice Agent API | Pipecat |
| --- | --- | --- |
| `VOICE_BACKEND` | `deepgram` — default | `pipecat` |
| Orchestration | Managed by Deepgram | Local Python pipeline |
| Processes | Python web server | Python web server + Python sidecar |
| Speech recognition | Deepgram Flux | Deepgram Flux |
| Reply model | Think-Fast or a configured managed model | Direct Think-Fast endpoint |
| Speech synthesis | Deepgram Flux TTS | Deepgram Flux TTS |
| Setup | [Quick start](#quick-start) | [Pipecat guide](docs/pipecat.md) |

**Model availability depends on your Deepgram project.** Pipecat is experimental:
direct Think-Fast access and a real conversation on the intended hardware still
need verification. Access through the Voice Agent API may differ from direct
endpoint access.

## Quick start

### Prerequisites

- Python **3.12 recommended**. The default backend supports Python 3.11+;
  Pipecat supports Python 3.11–3.13.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for dependency management.
- A [Deepgram API key](https://console.deepgram.com/) with access to the configured models.
- A browser with microphone access. Use headphones for your first conversation.

### 1. Install

```sh
git clone https://github.com/deepgram-devs/reinvent-voice-agent-starter.git
cd reinvent-voice-agent-starter
uv sync --frozen --python 3.12
cp .env.example .env
```

### 2. Configure

Edit the root `.env` file:

```dotenv
DEEPGRAM_API_KEY=your-key
VOICE_BACKEND=deepgram
```

Defaults are `flux-general-en` for recognition, `think-fast` for replies, and
`flux-alexis-en` for speech. If Think-Fast is unavailable, the **managed backend**
can use a supported model such as:

```dotenv
THINK_PROVIDER=open_ai
THINK_MODEL=gpt-4o-mini
```

That fallback is not implemented in the Pipecat backend. Provider requests use
your account and may incur charges. Never commit `.env` or share your API key.

### 3. Run

From the repository root:

```sh
uv run python server.py
```

Open [localhost:3000](http://localhost:3000), click **Set up**, allow the microphone,
and press **Start**. Try: “Check the example service status for the north area.”
The response should identify its data as fictional.

Optionally open [localhost:3000/console](http://localhost:3000/console) to control
the conversation. **Finish** requests a short goodbye and waits for playback;
**Stop now** ends the call immediately. To use another device, configure
`BOOTH_PASSCODE` and follow the [deployment guide](docs/deployment.md).

## Customize the agent

Start with one task your agent should perform well.

| Change | Edit |
| --- | --- |
| Agent purpose, tone, and greeting | `PROMPT` and `GREETING` in [agent_config.py](agent_config.py) |
| Model settings and audio configuration | `settings()` in [agent_config.py](agent_config.py) and [.env.example](.env.example) |
| A business lookup or action | `DEFINITIONS` and `HANDLERS` in [functions.py](functions.py) |
| Browser interface | [public/](public/) |
| Repository QR destination | `REPO_URL` in your `.env` |

For a business integration, replace the fictional lookup with an awaited call to
your authorized backend. Validate arguments, return only appropriate fields, and
register the handler in `functions.py`. Both voice backends use that registry.
Add tests for success, invalid input, missing records, failures, and cancellation.
Restart the Python processes after changing configuration or code.

The starter does not include a phone number, CRM connection, customer account
permissions, or production business data. Those integrations belong in your
application. See [architecture and customization](docs/architecture.md).

## Working with a coding agent

Ask your coding agent to read [AGENTS.md](AGENTS.md) before editing. It provides
the source map, exact offline checks, backend boundaries, and data-handling rules.
[llms.txt](llms.txt) is a compact index of repository documentation.

Example task:

```text
Read README.md and AGENTS.md. Adapt this starter into a service-status assistant.
Update the prompt and the registered functions.py handler, keeping sample data
clearly labeled. Preserve both voice backends, interruption, Finish, and Stop now.
Add offline tests for valid and invalid inputs and report the checks you ran.
Do not call live providers or add credentials to source files.
```

For pipeline changes, include [docs/pipecat.md](docs/pipecat.md) and
[pipecat_agent/agent.py](pipecat_agent/agent.py) in the task context. For business
logic, begin with `agent_config.py`, `functions.py`, and `tests/test_starter.py`.

## Repository map

| Path | Responsibility |
| --- | --- |
| [server.py](server.py) | aiohttp routes, browser sockets, authentication, and booth registry. |
| [backend.py](backend.py) | Backend selection and private connection options. |
| [booth.py](booth.py) | Audio relay, tool dispatch, cancellation, captions, and call lifecycle. |
| [agent_config.py](agent_config.py) | Shared prompt, greeting, models, and function definitions. |
| [functions.py](functions.py) | Async business functions and handler registry. |
| [pipecat_agent/](pipecat_agent/) | Optional pipeline, Think-Fast adapter, tests, and separate lockfile. |
| [public/](public/) | Shared browser interface, console, and audio worklet. |
| [tests/](tests/) | Offline server tests, optional browser check, and container smoke test. |

## Development and validation

Run server checks from the repository root:

```sh
uv sync --frozen --group dev --python 3.12
uv run pytest -q
```

Run Pipecat checks in its separate environment:

```sh
cd pipecat_agent
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

Tests use local fakes and mocked provider responses. GitHub Actions checks Python
3.11–3.13 and builds and smoke-tests the default container. Automated checks do
not establish live model access or audible performance: hear a real conversation
before relying on prompt, voice, interruption, or closing changes.

## Deployment and data handling

The default container runs the managed Voice Agent API backend:

```sh
docker build -t python-voice-agent .
docker run --rm -p 8080:8080 --env-file .env \
  -e VOICE_BACKEND=deepgram -e BOOTH_PASSCODE=choose-a-private-passcode \
  python-voice-agent
```

Use HTTPS for microphone access outside localhost. Keep one web-server instance:
booth and call state live in memory. The default image does not include the
Pipecat sidecar; follow [deployment](docs/deployment.md) for that setup.

Provider credentials stay server-side. Audio and transcripts are not recorded to
disk; conversation text is held in memory during the call and cleared at its end.
Provider retention policies apply independently. The shared browser passcode is
stored in local storage; review [SECURITY.md](SECURITY.md) before public deployment.

## Documentation and resources

- [Configuration reference](docs/configuration.md)
- [Pipecat setup and limitations](docs/pipecat.md)
- [Architecture and customization](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Deepgram Voice Agent documentation](https://developers.deepgram.com/docs/voice-agent)
- [Pipecat documentation](https://docs.pipecat.ai/)

## License

[MIT](LICENSE).
