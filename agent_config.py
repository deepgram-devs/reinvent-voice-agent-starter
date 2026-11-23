"""Start here: change the job, greeting and models, then restart the server."""
import os

from functions import DEFINITIONS

GREETING = "Hey, welcome to Deepgram! What are you working on, or are you just exploring?"

PROMPT = """You are a friendly, capable voice assistant at the Deepgram booth.
Follow the visitor's interests. Answer their question directly in one or two short sentences.
Ask one useful question when needed, without repeating a question they already answered.
Learn their project and where voice could help naturally; do not run an interview or role-play.
Everything is spoken: no markdown, lists or URLs. Say speech-to-text and text-to-speech in full.
You use the Deepgram Voice Agent API: Flux recognizes speech, Think-Fast writes replies,
and Flux text-to-speech speaks them. The server is Python, and the browser captures and plays audio.
Only claim the configured capabilities. Do not invent product details, prices or integrations.
The service-status function uses fictional sample data: label it as an example, not a real outage.
When asked for the starter code, call show_code and wait for success. Invite them to take the
Python starter and tailor it to their project. Sharing code does not end the conversation.
If they say goodbye, say one short warm goodbye and then call end_call. Say nothing after it.
"""

CLOSING_PROMPT = """The operator is ending this conversation now.
Say just one short warm goodbye, then call end_call. No question, technical explanation,
code offer, recap or business-function lookup. Do not say goodbye twice."""

FUNCTIONS = [
    {
        "name": "show_code",
        "description": "Show the starter repository QR on this booth screen.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        "defer_until_eot": True,
    },
    {
        "name": "end_call",
        "description": "End this conversation after saying your goodbye. Say nothing afterward.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        "defer_until_eot": True,
    },
    *DEFINITIONS,
]


def settings():
    """Raw Voice Agent Settings; the same audio formats as the Python booth."""
    return {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 24000, "container": "none"},
        },
        "agent": {
            "listen": {"provider": {"type": "deepgram", "version": "v2", "model": "flux-general-en"}},
            "think": {
                "provider": {
                    "type": os.getenv("THINK_PROVIDER", "deepgram"),
                    "model": os.getenv("THINK_MODEL", "think-fast"),
                },
                "prompt": PROMPT,
                "functions": FUNCTIONS,
            },
            "speak": {"provider": {
                "type": "deepgram", "version": "v2", "model": os.getenv("VOICE", "flux-alexis-en"),
            }},
            "greeting": GREETING,
        },
    }
