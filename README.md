# Python voice agent starter

Take the voice experience from Deepgram's re:Invent booth and tailor it to your project. This starter uses the same
**Python + asyncio + aiohttp** approach for its server, and the same core Deepgram Voice Agent API flow:

**microphone → Flux speech-to-text → Think-Fast → Flux text-to-speech → speaker**

The browser page captures audio and displays subtitles. An optional phone/tablet console starts, finishes or
immediately stops a conversation and shows the starter QR. Browser audio uses JavaScript; **no Node.js installation
or JavaScript build step is needed**.

The live conference booth has additional orchestration, a graph and documentation tools. Start here to build your
own voice task with the same core APIs; add the integrations your product needs.

## Run it

Install [Python 3.11 or newer](https://www.python.org/downloads/) and
[uv](https://docs.astral.sh/uv/getting-started/installation/).
Get a [Deepgram API key](https://console.deepgram.com/).

~~~sh
git clone https://github.com/deepgram-devs/reinvent-voice-agent-starter.git
cd reinvent-voice-agent-starter
cp .env.example .env
# Set DEEPGRAM_API_KEY in .env, then:
uv run python server.py
~~~

"uv run" creates a virtual environment and installs the locked dependencies.

1. Open **http://localhost:3000** and click **Set up** to allow the microphone and speaker.
2. Press **Start** and talk to the agent. Use headphones when your speaker is near the mic.
3. Optional: open **http://localhost:3000/console** for the operator controls.

**Model access:** the defaults match the booth: flux-general-en, think-fast, and flux-alexis-en.
Availability depends on your Deepgram project. If Think-Fast is unavailable for your key, set a supported managed
LLM in .env, for example THINK_PROVIDER=open_ai and THINK_MODEL=gpt-4o-mini, then restart. This changes only the
reply model; your key also needs access to the configured speech models. See the
[current model configuration docs](https://developers.deepgram.com/docs/llm/voice-agent).

## Tailor it to your idea

Start with one task your agent should do well.

### 1. Give it a job

Edit **agent_config.py**:

- PROMPT: describe the job, what the agent should ask, and what it must not promise.
- GREETING: write its opening sentence.
- settings(): choose the speech and reply models and audio formats.

For a telecom support idea, start with an agent that asks which service area is affected and explains the result
of a status lookup. For another product, replace that task with your own. Restart after editing Python files.

### 2. Connect one useful business function

**functions.py** contains a working, read-only example: **get_service_status**.

Say: **“Can you check the example service status for the north area?”**

The model requests that function; Python validates its arguments, reads the example data and returns a result.
The agent should label the result as **fictional sample data**. It is not connected to a telecom provider.

To connect your actual system:

1. Replace the sample lookup with an awaited call to your own authorized backend.
2. Return only the fields the agent is allowed to explain. Keep credentials on the server in .env.
3. Update the schema in DEFINITIONS and register its async handler in HANDLERS.
4. Update PROMPT for your actual task and test success, invalid input, missing records and service failures.

The Voice Agent API sends FunctionCallRequest. In **booth.py**, function() calls a registered Python handler
and sends FunctionCallResponse with **type, id, name, content**. Content is a JSON-encoded string; an optional
thought signature is echoed back. Only client_side: true requests are executed here. “Client” in the
Deepgram docs means this Python application connected to Deepgram, not necessarily browser JavaScript.

Functions run as separate async tasks, so a slow lookup does not block audio or Stop now. Cancelled calls receive
no late response. Definitions use defer_until_eot to avoid starting work on an unfinished user turn; future
actions that change data still need your own authorization and idempotency rules.

See [function requests](https://developers.deepgram.com/docs/voice-agent-function-call-request),
[responses](https://developers.deepgram.com/docs/voice-agent-function-call-response), and
[cancellation](https://developers.deepgram.com/docs/voice-agent-function-call-cancelled).

### 3. Try your workflow

- “I’m building a customer support agent.”
- “Check the example service status for the north area.”
- Interrupt the reply and change the area to central.
- “Show me the starter code.” The QR appears and the conversation continues.
- Press **Finish** for one short goodbye, or **Stop now** to cut the call immediately.

The starter has no phone line, CRM, account permissions or production customer data attached. Add those integrations
for your project. For a phone channel, start with the
[Twilio integration guide](https://developers.deepgram.com/docs/voice-agent-twilio-integration).

## Files

| File | What to customize or learn |
|---|---|
| agent_config.py | Prompt, greeting, model configuration and function definitions. **Start here.** |
| functions.py | Async business-function example and handler registry. Replace the sample data here. |
| booth.py | One call: audio relay, function dispatch/cancellation, barge-in, QR and bounded closing. |
| server.py | aiohttp pages/WebSockets, passcode checks and the server-side API connection. |
| public/stand.js, index.html, mic-worklet.js | Browser microphone, audio playback, subtitles and QR. |
| public/console.js, console.html | Phone/tablet operator console. |
| pyproject.toml, uv.lock | Python dependencies and reproducible setup. |

~~~text
Browser microphone -- PCM16 16 kHz --> Python server --> Deepgram Voice Agent API
Browser speaker    <- PCM16 24 kHz --- Python server <-- audio + JSON events
                                           |
Console -- Start / Finish / Stop / QR -------+
                                           +-- functions.py -- your backend
~~~

Like the live booth, the Python server owns the upstream WebSocket and keeps the API key out of the browser.
This small starter lets Deepgram manage the Think-Fast invocation. The conference booth additionally uses its
own Python think endpoint for orchestration; this starter does not reproduce the booth's entire application.

## Console and closing

Set BOOTH_PASSCODE in .env before opening the console on your phone, tablet or another computer. Restart, then
open http://YOUR-LAPTOP-ADDRESS:3000/console. The booth's microphone page must use localhost or HTTPS; use HTTPS
when the microphone runs on a remote device. Both pages enter the same passcode.

| Control | Behavior |
|---|---|
| **Start** | Starts once the booth screen has allowed its microphone and speaker. No guest or role selection. |
| **Finish** | Requests one short goodbye, then ends after the screen finishes playback. Maximum 12 seconds from the press. |
| **Stop now** | Stops the call and queued playback immediately. No goodbye or confirmation dialog. |
| **Show the code QR** | Shows/hides the repository QR independently; subtitles remain visible. |

Finish updates the prompt and, once quiet, sends one hidden closing cue. An end_call function starts playback
draining; the browser reports drained. The server closes the API socket instead of sending a function response
that would invite another spoken reply. A hard deadline handles missing model or browser acknowledgments.

For separate booths, add the same ?booth=2 to both pages. Each booth has one stand and one call. A replacement
stand ends the old call. Conversation text is kept only in memory during the active call for consoles joining late;
it is cleared when the call ends. Audio and transcripts are never recorded to disk.

## Put it online

~~~sh
docker build -t python-voice-agent .
docker run --rm -p 8080:8080 --env-file .env -e BOOTH_PASSCODE=choose-a-passcode python-voice-agent
~~~

Set DEEPGRAM_API_KEY and BOOTH_PASSCODE as secrets on your host. Use HTTPS and one server instance: active calls
live in memory. Without a passcode the server binds only to 127.0.0.1, so a container without a passcode is not
accessible through its published port. The passcode protects the API WebSockets; the UI and QR assets are public.
For a public deployment, add your application's authentication, abuse controls and authorization.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| DEEPGRAM_API_KEY | required | Server-side Deepgram credentials. |
| BOOTH_PASSCODE | none | Protect control/agent sockets and allow network/container access. |
| THINK_PROVIDER, THINK_MODEL | deepgram, think-fast | Reply provider/model available to your project. |
| VOICE | flux-alexis-en | Speech output model. |
| REPO_URL | this repository | QR destination; point it at your fork. |
| PORT | 3000 | HTTP port (8080 in Docker). |

## Check your changes

~~~sh
uv run pytest -q
~~~

Tests run against a local fake Voice Agent API, without credentials or real API calls. They cover audio relay,
barge-in, function results and cancellation, hard stop, closing deadlines, passcodes and booth isolation.
A real voice conversation still needs a manual check with your Deepgram key.

[Voice Agent docs](https://developers.deepgram.com/docs/voice-agent) ·
[Settings reference](https://developers.deepgram.com/docs/configure-voice-agent) ·
[Function calling](https://developers.deepgram.com/docs/voice-agents-function-calling)

MIT licensed.
