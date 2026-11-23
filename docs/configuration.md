# Configuration

Copy root `.env.example` to `.env`. Both Python processes load it; exported variables
take precedence. Restart after changes. Never commit secrets.

| Variable | Default | Purpose |
|---|---|---|
| `DEEPGRAM_API_KEY` | Required | Server-side provider key. |
| `VOICE_BACKEND` | `deepgram` | Managed Voice Agent API or `pipecat`. |
| `THINK_PROVIDER` | `deepgram` | Managed provider; Pipecat requires `deepgram`. |
| `THINK_MODEL` | `think-fast` | Managed model; Pipecat requires `think-fast`. |
| `VOICE` | `flux-alexis-en` | Available Flux speech voice. |
| `BOOTH_PASSCODE` | Unset | Browser socket passcode; enables listening beyond loopback. |
| `PORT` | `3000` | Web server port; container uses `8080`. |
| `REPO_URL` | This repository | QR destination. |
| `PIPECAT_TOKEN` | Required with Pipecat | Shared secret between server and sidecar. |
| `PIPECAT_URL` | `ws://127.0.0.1:7861/agent` | Loopback-only sidecar URL. |
| `PIPECAT_PORT` | `7861` | Sidecar listening port; match the URL if changed. |

Generate a random token with `python -c "import secrets; print(secrets.token_hex(32))"`.
Use matching `?booth=2` on the stand and console for another booth. IDs allow
lowercase letters, numbers and dashes, up to 24 characters.
