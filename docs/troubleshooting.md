# Troubleshooting

| Symptom | Check |
|---|---|
| Node exits asking for a key | Copy `.env.example` to root `.env`, set `DEEPGRAM_API_KEY`, then run `npm start` from the root. |
| Unknown `--env-file-if-exists` option | Use Node.js 22.9 or newer; `.nvmrc` selects Node 22. |
| No microphone prompt | Open localhost or an HTTPS URL, check browser permissions, and click Set up. |
| Another device cannot open the server | Set `BOOTH_PASSCODE`, restart Node, and check host firewall and network access. |
| Wrong passcode | Enter the configured `BOOTH_PASSCODE`; the browser may have saved an older value. |
| Agent fails at Start | Verify account/model access and the configured voice. Think-Fast is Early Access. |
| Pipecat connection refused | Start `pipecat_agent/agent.py`; check `PIPECAT_PORT` and `PIPECAT_URL`. |
| Pipecat unauthorized | Set the same nonempty `PIPECAT_TOKEN` for both processes and restart both. |
| Pipecat provider error | Check direct Think-Fast, Flux STT and Flux TTS access. The UI intentionally omits provider response bodies. |
| Pipecat rejects provider/model settings | Use the default `THINK_PROVIDER=deepgram` and `THINK_MODEL=think-fast`. |
| Echo or unwanted interruptions | Test with headphones, then separate the speaker and microphone. |
| Console controls the wrong call | Match the `?booth=...` value on the stand and console. |
| Docker serves nothing | Set `BOOTH_PASSCODE`; without it, Node listens only inside container loopback. |

For a bug report, include the backend, runtime versions, browser, operating system,
steps and a sanitized error. Do not include API keys, `.env`, visitor audio or
conversation transcripts. See [contributing](../CONTRIBUTING.md).
