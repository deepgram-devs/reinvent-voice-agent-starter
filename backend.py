"""Choose a private server-side voice connection without exposing provider keys."""
import os
from urllib.parse import urlparse

from booth import AGENT_URL


def connection_options(key):
    backend = os.getenv("VOICE_BACKEND", "deepgram")
    if backend == "deepgram":
        return AGENT_URL, {"Authorization": f"Token {key}"}
    if backend != "pipecat":
        raise ValueError("VOICE_BACKEND must be deepgram or pipecat")
    token = os.getenv("PIPECAT_TOKEN", "")
    if not token:
        raise ValueError("Set PIPECAT_TOKEN in both server and Pipecat environments")
    url = os.getenv("PIPECAT_URL", "ws://127.0.0.1:7861/agent")
    parsed = urlparse(url)
    if parsed.scheme != "ws" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("PIPECAT_URL must be a loopback ws:// URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("PIPECAT_URL must not contain credentials, query or fragment")
    return url, {"Authorization": f"Bearer {token}"}
