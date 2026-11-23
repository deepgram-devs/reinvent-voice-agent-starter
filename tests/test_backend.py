"""Backend selection and shared function wiring; no paid provider calls."""
import pytest
from agent_config import configured_prompt
from backend import connection_options


def test_backend_selection(monkeypatch):
    monkeypatch.delenv("VOICE_BACKEND", raising=False)
    url, headers = connection_options("fake")
    assert url.endswith("/v1/agent/converse")
    assert headers == {"Authorization": "Token fake"}
    monkeypatch.setenv("VOICE_BACKEND", "invalid")
    with pytest.raises(ValueError, match="VOICE_BACKEND"):
        connection_options("fake")
    monkeypatch.setenv("VOICE_BACKEND", "pipecat")
    monkeypatch.delenv("PIPECAT_TOKEN", raising=False)
    with pytest.raises(ValueError, match="PIPECAT_TOKEN"):
        connection_options("fake")
    monkeypatch.setenv("PIPECAT_TOKEN", "local-secret")
    assert connection_options("fake")[1] == {"Authorization": "Bearer local-secret"}
    assert "Python Pipecat pipeline" in configured_prompt()
    for invalid in ("ws://example.com/agent", "https://localhost/agent", "ws://localhost/agent?secret=x"):
        monkeypatch.setenv("PIPECAT_URL", invalid)
        with pytest.raises(ValueError):
            connection_options("fake")
