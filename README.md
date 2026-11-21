# Voice agent starter

Build the voice agent you talked to at Deepgram's AWS re:Invent 2026 booth. It is one small Node server and one web
page, on [Deepgram's Voice Agent API](https://developers.deepgram.com/docs/voice-agent):

- **Flux** listens, and knows when you have finished a thought, not just when you pause.
- **Think-Fast**, Deepgram's own LLM tuned for voice, writes the replies.
- **Flux TTS** speaks them, and stops the moment you talk over it.

## Run it

You need [Node.js](https://nodejs.org) 20.6 or newer and a Deepgram API key
([sign up free](https://console.deepgram.com)).

```sh
git clone https://github.com/deepgram-devs/reinvent-voice-agent-starter.git
cd reinvent-voice-agent-starter
npm install
cp .env.example .env        # then put your key in .env
npm start
```

Open http://localhost:3000, press **Start**, allow the microphone, and say what you are building. Use headphones, or a
speaker away from your mic.

Try the things the booth showed:

- **Pause mid-sentence.** "I'm building... a scheduling agent." It waits for the end of your thought.
- **Talk over it.** Start speaking while it answers. It stops and listens.

> **Think-Fast is in Early Access.** If your Deepgram project does not have it yet, the agent will not start and the
> page shows the error. Use a Deepgram-managed LLM instead by adding two lines to `.env`:
> `THINK_PROVIDER=open_ai` and `THINK_MODEL=gpt-4o-mini`.

## How it works

```
browser mic  -- 16 kHz PCM -->  server.js  -->  wss://agent.deepgram.com/v1/agent/converse
browser      <-- 24 kHz PCM --  server.js  <--  the agent's voice, plus JSON events
```

| File | What it does |
|---|---|
| `agent.config.js` | The agent: its prompt, greeting and models. **Start here.** |
| `server.js` | Serves the page and relays audio between the browser and the Voice Agent API. Your key stays on the server. |
| `public/app.js` | Captures the mic, plays the agent's voice, stops playback when you start talking, shows the transcript. |
| `public/mic-worklet.js` | Turns microphone samples into 16-bit PCM on the audio thread. |

The whole agent is one `Settings` message, sent when the conversation opens (`agent.config.js`):

```js
listen: { provider: { type: "deepgram", version: "v2", model: "flux-general-en" } },
think:  { provider: { type: "deepgram", model: "think-fast" }, prompt: PROMPT },
speak:  { provider: { type: "deepgram", version: "v2", model: "flux-alexis-en" } },
```

## Make it yours

- **Give it a job.** Change `PROMPT` and `GREETING` in `agent.config.js`: a support line, a booking assistant, a tutor.
- **Change the voice.** Set `VOICE` in `.env` to another [Flux TTS voice](https://developers.deepgram.com/docs/tts-models).
- **Let it do things.** Add [functions](https://developers.deepgram.com/docs/voice-agents-function-calling) to
  `agent.think` so it can look things up or take actions.
- **Put it on the phone.** Connect the same `Settings` to a phone line:
  [Twilio and the Voice Agent API](https://developers.deepgram.com/docs/twilio-and-deepgram-voice-agent).

## Learn more

- [Voice Agent API docs](https://developers.deepgram.com/docs/voice-agent)
- [Settings reference](https://developers.deepgram.com/docs/configure-voice-agent)
- [Think-Fast in the Voice Agent](https://developers.deepgram.com/docs/llm/voice-agent)
- [Flux](https://developers.deepgram.com/docs/flux/feature-overview)

MIT licensed.
