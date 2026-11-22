# Voice agent booth

The voice agent you talked to at Deepgram's AWS re:Invent 2026 booth, ready to run with your own Deepgram key. It is a
small Node server and two pages on [Deepgram's Voice Agent API](https://developers.deepgram.com/docs/voice-agent):

- **The booth screen** (`/`): a laptop or big screen with a mic and speaker. Visitors talk to it. It shows large
  live captions, what the agent is doing, and a QR code for this repo.
- **The console** (`/console`): on your phone. Pick who is visiting, start and end conversations, and press **Wrap up**
  for a graceful goodbye.

Under the hood:

- **Flux** listens, and knows when someone has finished a thought, not just when they pause.
- **Think-Fast**, Deepgram's LLM tuned for voice, writes short replies.
- **Flux TTS** speaks them, and stops the moment the visitor talks over it.

## Run it on your laptop

You need [Node.js](https://nodejs.org) 22.9 or newer and a Deepgram API key
([sign up free](https://console.deepgram.com)).

```sh
git clone https://github.com/deepgram-devs/reinvent-voice-agent-starter.git
cd reinvent-voice-agent-starter
npm install
cp .env.example .env        # then put your key in .env
npm start
```

1. Open http://localhost:3000 and click **Set up**, which allows the mic and speaker.
2. Press **Start** at the bottom of the screen and say what you are building.
3. Optional: open http://localhost:3000/console in a second window to run it like the booth does. For the console on
   your phone, set `BOOTH_PASSCODE` in `.env` first (see below) and open `http://<your-laptop's-address>:3000/console`.

Use headphones, or a speaker away from the mic.

> **Think-Fast is in Early Access.** If your Deepgram project does not have it yet, the agent will not start and the
> screen shows the error. Use a Deepgram-managed LLM instead by adding two lines to `.env`:
> `THINK_PROVIDER=open_ai` and `THINK_MODEL=gpt-4o-mini`.

## Put it online

The repo has a `Dockerfile`, so it runs on any host that runs containers. Give it two environment variables:

- `DEEPGRAM_API_KEY`: your key. Store it as a secret on your host, never in the image or the repo.
- `BOOTH_PASSCODE`: anything only your team knows. Both pages ask for it once.

The container listens on port 8080. Use one instance: a booth's conversation lives in that instance's memory.

**Why the passcode is required:** the agent runs on your Deepgram key, so anyone who can open the page can spend your
credit. Without `BOOTH_PASSCODE`, the server only accepts connections from the computer it runs on, which means a
container without it serves nobody.

Try the image locally first:

```sh
docker build -t voice-agent-booth .
docker run --rm -p 8080:8080 --env-file .env -e BOOTH_PASSCODE=pick-one voice-agent-booth
```

## Run a booth

| Press | What happens |
|---|---|
| **Who is at the booth** | Sets the visitor's role before Start: any visitor, developer, executive, product manager or customer experience. The agent's questions follow the role. |
| **Start** / **End** | Starts or stops a conversation on the booth screen. |
| **Wrap up** | The agent answers anything still open in a few words, says it enjoyed the chat but has to wrap up, and says goodbye. The conversation then ends by itself. |
| **Show the code QR** | Shows or hides the QR code for this repo on the booth screen, at any time. It stays up until you hide it or start the next conversation. |

**The developer close.** With the role set to developer, Wrap up adds one step: before the goodbye, the agent asks if
they want to build a voice agent like it. On a yes, the QR code appears and stays on screen after the
goodbye.

Several booths can share one server: add `?booth=2` to both pages.

## Make it yours

Everything the agent is lives in `agent.config.js`. Start there.

- **Give it a job.** Change `PROMPT` and `GREETING`: a support line, a booking assistant, a tutor.
- **Change who visits.** Edit `ROLES`. Each one adds a short brief to the prompt.
- **Change the voice.** Set `VOICE` in `.env` to another [Flux TTS voice](https://developers.deepgram.com/docs/tts-models).
- **Let it do things.** Add [functions](https://developers.deepgram.com/docs/voice-agents-function-calling) to
  `FUNCTIONS` and handle them in `callFunction` in `booth.js`.
- **Point the QR code at your fork.** Set `REPO_URL`.

## How it works

```
booth screen  -- mic, 16 kHz PCM -->  server.js + booth.js  -->  wss://agent.deepgram.com/v1/agent/converse
              <-- voice, 24 kHz PCM --                       <--  the agent's voice, plus JSON events
console       <-- status, transcript --
              --> Start, End, Wrap up, QR -->
```

The server holds the Voice Agent API socket, so your key never reaches a browser, and the console can wrap up a
conversation the booth screen is running.

| File | What it does |
|---|---|
| `agent.config.js` | The agent: prompt, greeting, roles, the closing instructions, functions and models. **Start here.** |
| `booth.js` | One booth: runs the conversation, relays audio, handles Wrap up, `show_code` and `end_call`. |
| `server.js` | Serves the pages and the QR code, checks the passcode, and connects browsers to their booth. |
| `public/index.html`, `stand.js`, `mic-worklet.js` | The booth screen: mic capture, playback, barge-in, captions and the QR card. |
| `public/console.html`, `console.js` | The console. |
| `public/common.js` | Shared by both pages: booth name, passcode, a socket that reconnects. |
| `Dockerfile` | The container image, for any host. |

How a graceful close works on the Voice Agent API:

1. Wrap up sends [`UpdatePrompt`](https://developers.deepgram.com/docs/voice-agent-update-prompt) with the closing
   instructions.
2. At the next pause, it sends a hidden
   [`InjectUserMessage`](https://developers.deepgram.com/docs/voice-agent-inject-user-message) asking the agent to wrap
   up.
3. The agent says goodbye and calls `end_call`, a client-side function with `defer_until_eot`. The server sends no
   response on purpose: a response makes the model say goodbye a second time.
4. The server ends the conversation once the screen has finished playing the goodbye.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `DEEPGRAM_API_KEY` | (required) | Your Deepgram API key. |
| `BOOTH_PASSCODE` | none | Without it, only this computer can open the booth. Both pages ask for it once. |
| `THINK_PROVIDER`, `THINK_MODEL` | `deepgram`, `think-fast` | The LLM. |
| `VOICE` | `flux-alexis-en` | The Flux TTS voice. |
| `REPO_URL` | this repo | What the QR code opens. |
| `PORT` | `3000` | The server's port. |

## Learn more

- [Voice Agent API docs](https://developers.deepgram.com/docs/voice-agent)
- [Settings reference](https://developers.deepgram.com/docs/configure-voice-agent)
- [Function calling](https://developers.deepgram.com/docs/voice-agents-function-calling)
- [Think-Fast in the Voice Agent](https://developers.deepgram.com/docs/llm/voice-agent)
- [Flux](https://developers.deepgram.com/docs/flux/feature-overview)

MIT licensed.
