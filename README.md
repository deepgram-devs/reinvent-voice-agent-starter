# Deepgram Voice Agent Starter

Build a browser voice agent with **Deepgram Voice Agent API** or **Pipecat**.
Both implementations share a microphone and speaker interface, live captions,
an operator console, and an editable agent configuration.

Originally built for Deepgram's AWS re:Invent booth. Adapt the prompt and tools
for your own application.

[Quick start](#quick-start) · [Pipecat setup](docs/pipecat.md) · [Configuration](docs/configuration.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

## Choose an implementation

| | Deepgram Voice Agent API | Pipecat |
|---|---|---|
| Set `VOICE_BACKEND` | `deepgram` (default) | `pipecat` |
| Runtime | Node.js | Node.js + Python sidecar |
| Orchestration | Managed by Deepgram | Python pipeline you control |
| Speech recognition | Deepgram Flux | Deepgram Flux |
| Language model | Think-Fast, or a configured Deepgram-managed model | Direct Think-Fast endpoint |
| Speech synthesis | Deepgram Flux TTS | Deepgram Flux TTS |
| Setup | [Quick start below](#quick-start) | [Pipecat guide](docs/pipecat.md) |

Think-Fast is Early Access and requires project access. The Pipecat adapter's
direct Think-Fast access must be verified separately. The Pipecat implementation
has offline tests but still needs a real conversation before event use.

## Quick start

You need **Node.js 22.9+**, npm, a modern browser with microphone access, and a
[Deepgram API key](https://console.deepgram.com/).

```sh
git clone https://github.com/deepgram-devs/reinvent-voice-agent-starter.git
cd reinvent-voice-agent-starter
npm ci
cp .env.example .env
```

Set your key in `.env`:

```dotenv
DEEPGRAM_API_KEY=your-key
VOICE_BACKEND=deepgram
```

```sh
npm start
```

1. Open [localhost:3000](http://localhost:3000), click **Set up** and allow the microphone.
2. Press **Start** and speak. Use headphones during initial testing.
3. Optionally open [localhost:3000/console](http://localhost:3000/console) to control the same conversation.

If Think-Fast is unavailable to your project, the **Voice Agent API** backend can
use a Deepgram-managed model by setting:

```dotenv
THINK_PROVIDER=open_ai
THINK_MODEL=gpt-4o-mini
```

This fallback is not implemented in the Pipecat backend. Requests use your
provider account and may incur charges.

## Make it yours

Start in [`agent.config.js`](agent.config.js):

- Change `PROMPT` and `GREETING` to define the agent's job and first words.
- Edit `ROLES` to change the optional visitor briefs shown on the console.
- Add function schemas to `FUNCTIONS` and implement handlers for each backend you use.
- Set `VOICE` in `.env` to an available Flux TTS voice.
- Set `REPO_URL` to your fork to update the on-screen QR code.

The starter includes `show_code` and `end_call`. Your own integrations—bookings,
orders, customer records or other actions—need application handlers.
See [architecture and customization](docs/architecture.md).

## Run a booth

| Control | Behavior |
|---|---|
| Start / End | Start a conversation or stop it immediately. |
| Who is at the booth | Choose an optional role before starting. |
| Wrap up | Ask the agent to close, then wait for the goodbye audio to finish. |
| Show the code QR | Show or hide a link to the source repository. |

The developer role's closing flow asks whether the visitor wants to build an agent;
a yes shows the QR. Add `?booth=2` to **both** pages to run another booth.
Booths and conversation state live in one server's memory.

## Development

```sh
npm run check
```

For Pipecat checks (no API key or live provider calls required):

```sh
cd pipecat_agent
uv sync --frozen --group dev --python 3.12
uv run ruff check .
uv run pytest -q
```

GitHub Actions runs JavaScript checks, Python lint and tests, and the default
container build. Tests use fakes; a real conversation remains necessary to check
audio, interruption, model access and voice availability.

## Deploy and operate

The existing container runs the **Deepgram Voice Agent API** backend:

```sh
docker build -t deepgram-voice-agent .
docker run --rm -p 8080:8080 --env-file .env \
  -e VOICE_BACKEND=deepgram -e BOOTH_PASSCODE=choose-a-private-passcode \
  deepgram-voice-agent
```

Use HTTPS when opening the microphone outside localhost. Without a passcode,
the Node server binds to loopback only. Use one application instance because
booth state is not shared. See [deployment](docs/deployment.md) for the Python
sidecar, reverse proxy considerations and validation steps.

The app does not record audio or write transcripts to disk. The server and
connected consoles hold conversation text in memory; the last transcript stays
until the next call or process exit. The browser stores the booth passcode in
local storage. Provider retention is governed by the services you configure.
See [security](SECURITY.md) before making a demo publicly reachable.

## Documentation

- [Configuration reference](docs/configuration.md)
- [Pipecat setup and limitations](docs/pipecat.md)
- [Architecture and customization](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)

## Resources

[Voice Agent API](https://developers.deepgram.com/docs/voice-agent) ·
[Function calling](https://developers.deepgram.com/docs/voice-agents-function-calling) ·
[Flux](https://developers.deepgram.com/docs/flux/feature-overview) ·
[Pipecat](https://docs.pipecat.ai/)

## License

[MIT](LICENSE).
