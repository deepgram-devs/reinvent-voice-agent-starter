# Configuration

Copy `.env.example` to `.env` in the repository root. Both processes load that
file; exported environment variables take precedence. Restart processes after
configuration changes. Never commit credentials.

| Variable | Default | Applies to | Purpose |
|---|---|---|---|
| `DEEPGRAM_API_KEY` | Required | Both | Server-side Deepgram credentials. |
| `VOICE_BACKEND` | `deepgram` | Node | `deepgram` or `pipecat`. |
| `THINK_PROVIDER` | `deepgram` | Both | Voice Agent provider; Pipecat requires `deepgram`. |
| `THINK_MODEL` | `think-fast` | Both | Voice Agent model; Pipecat requires `think-fast`. |
| `VOICE` | `flux-alexis-en` | Both | Flux TTS voice available to your project. |
| `BOOTH_PASSCODE` | Unset | Node | Shared passcode for booth and console sockets. Without it, Node binds to `127.0.0.1`. |
| `REPO_URL` | This repository | Node | URL encoded in the QR card. |
| `PORT` | `3000` | Node | HTTP port. The Docker image sets `8080`. |
| `PIPECAT_TOKEN` | Required with Pipecat | Both | Random shared secret authenticating Node to the local Python service. |
| `PIPECAT_URL` | `ws://127.0.0.1:7861/agent` | Node | Loopback WebSocket endpoint. Remote hosts are rejected. |
| `PIPECAT_PORT` | `7861` | Python | Local Python listening port. Match `PIPECAT_URL` if changed. |

Generate a token with Node:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`BOOTH_PASSCODE` controls browser access. `PIPECAT_TOKEN` authenticates the private
backend connection; they serve different purposes.

For a different booth, use matching IDs in both URLs, for example `/?booth=demo-2`
and `/console?booth=demo-2`. IDs allow lowercase letters, numbers and dashes,
up to 24 characters.

Return to the [README](../README.md).
