# Deployment

## Voice Agent API container

The default Dockerfile contains Node and the shared browser assets. It runs the
`deepgram` backend; the Python sidecar is not installed in this image.

```sh
docker build -t deepgram-voice-agent .
docker run --rm -p 8080:8080 --env-file .env \
  -e VOICE_BACKEND=deepgram -e BOOTH_PASSCODE=choose-a-private-passcode \
  deepgram-voice-agent
```

Store `DEEPGRAM_API_KEY` and `BOOTH_PASSCODE` as host-managed secrets for a hosted
instance. Do not bake `.env` into the image. The image runs as the unprivileged
`node` user.

## Pipecat on a server

Install Node, Python and uv on one host. Follow [Pipecat setup](pipecat.md), then
run Node and Python under your process manager as separate services with the same
root environment. Sync Python dependencies with `uv sync --frozen --no-dev` before
starting the service.

Keep Python on loopback; expose only Node through your HTTPS reverse proxy. A
separate container's loopback is not the Node container's loopback: the current
adapter expects both processes to share a host network namespace. A two-container
configuration needs an explicit networking and authentication design.

## Network and browser requirements

- Terminate HTTPS and forward WebSocket upgrades to Node. Microphone access
  requires a secure context outside localhost.
- Set `BOOTH_PASSCODE` to enable remote access. HTTP pages are public; the passcode
  protects the stand and console sockets, not every static file.
- The browser stores the passcode in local storage and sends it in the WebSocket
  query string. Avoid recording query strings in proxy access logs.
- Keep one Node instance. State is in memory, and a restart ends current calls.
- The demo has no usage quotas, rate limiting or per-user identity. Add those
  controls before making an application broadly accessible on your API account.

## Validate a deployment

Open the booth page over HTTPS, permit the microphone, and start one real call.
Check captions, playback, interruption, console controls, QR and the goodbye drain.
Repeat on the devices and network you will use. Confirm that secrets do not appear
in page source, logs or repository changes.

CI builds the default container but does not run paid provider conversations.
See [troubleshooting](troubleshooting.md) for common failures.
