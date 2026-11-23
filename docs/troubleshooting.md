# Troubleshooting

| Symptom | Check |
|---|---|
| Missing API key | Copy root `.env.example` to `.env`, set the key and restart. |
| No microphone | Open localhost or HTTPS, check browser permissions, then click Set up. |
| Remote device cannot connect | Set `BOOTH_PASSCODE`, restart, and check firewall/network access. |
| Wrong passcode | Re-enter the configured value; local storage may contain an old value. |
| Agent fails at Start | Check your key's access to all configured speech/reply models. |
| Pipecat connection refused | Start the sidecar and match `PIPECAT_URL` with `PIPECAT_PORT`. |
| Pipecat unauthorized | Both processes need the same nonempty `PIPECAT_TOKEN`. |
| Pipecat provider error | Verify direct Think-Fast and Flux STT/TTS access; managed-model access may differ. |
| Pipecat settings rejected | Use `THINK_PROVIDER=deepgram` and `THINK_MODEL=think-fast`. |
| Echo or false interruptions | Begin with headphones, then separate speaker and microphone. |
| Wrong console call | Match `?booth=...` on both pages. |
| Container inaccessible | Set `BOOTH_PASSCODE` so the server listens outside container loopback. |

Report backend, runtime/browser versions, sanitized errors and reproduction steps.
Never include credentials, `.env`, visitor audio or transcripts.
