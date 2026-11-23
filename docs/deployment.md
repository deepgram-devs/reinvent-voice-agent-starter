# Deployment

The default container runs the Python aiohttp server with the managed Voice Agent
API backend. It installs locked dependencies and runs as an unprivileged user.

```sh
docker build -t python-voice-agent .
docker run --rm -p 8080:8080 --env-file .env \
  -e VOICE_BACKEND=deepgram -e BOOTH_PASSCODE=choose-a-private-passcode \
  python-voice-agent
```

Store provider keys and passcodes in host-managed secrets. Use HTTPS for microphone
access outside localhost, forward WebSocket upgrades and keep one server instance:
call state lives in memory. `/health` reports readiness and the active call count.
Static pages and QR assets are public; passcodes protect browser WebSockets.
The browser stores the passcode in local storage and sends it in socket query
strings. Avoid recording those strings in reverse-proxy logs.

For Pipecat, follow [setup](pipecat.md) and run the web server and sidecar as two
Python services on one host under your process manager. Only expose the web server.
The current adapter requires a shared loopback network namespace, so separate
containers need an explicit network/authentication design. The default image does
not include Pipecat dependencies.

The starter has no per-user identity, usage quotas or rate limiting. Add your
application's access and abuse controls before broad public exposure. Provider
retention policies apply independently of the app's in-memory data handling.

CI builds and smoke-tests the default container with fake credentials. Before live
use, hear a real conversation and check function results, interruption, captions,
QR, Finish and Stop now on the intended devices and network.
