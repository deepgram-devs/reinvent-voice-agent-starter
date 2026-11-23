"""Real local WebSockets and a fake Voice Agent API; tests never call Deepgram."""
import asyncio
import json

import aiohttp
import pytest
import pytest_asyncio
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer

import server
from agent_config import settings
from booth import Booth, booth_id
from functions import HANDLERS, get_service_status


async def receive(ws, kind=None):
    async with asyncio.timeout(3):
        while True:
            msg = await ws.receive()
            if kind == "binary" and msg.type == WSMsgType.BINARY:
                return msg.data
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                if kind is None or data.get("type") == kind:
                    return data
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED):
                return None


class Connection:
    def __init__(self, ws):
        self.ws, self.incoming = ws, asyncio.Queue()

    async def message(self, kind):
        async with asyncio.timeout(3):
            while True:
                data = await self.incoming.get()
                if isinstance(data, dict) and data.get("type") == kind:
                    return data


@pytest_asyncio.fixture
async def running(request, monkeypatch):
    connections = asyncio.Queue()
    async def agent(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        connection = Connection(ws)
        await connections.put(connection)
        async for message in ws:
            data = message.data if message.type == WSMsgType.BINARY else json.loads(message.data)
            await connection.incoming.put(data)
            if isinstance(data, dict) and data.get("type") == "Settings":
                await ws.send_json({"type": "SettingsApplied"})
        return ws
    api = web.Application()
    api.router.add_get("/agent", agent)
    original = server.Booth
    close_seconds = getattr(request, "param", 12)
    monkeypatch.setattr(server, "Booth", lambda name, connect: original(name, connect, close_seconds=close_seconds))
    async with TestServer(api) as upstream, aiohttp.ClientSession() as http:
        app = server.create_app(key="test-key-never-expose", passcode="test-pass",
                                connect=lambda: http.ws_connect(upstream.make_url("/agent")))
        async with TestClient(TestServer(app)) as client:
            yield client, connections


async def browsers(running, name="1"):
    client, connections = running
    stand = await client.ws_connect(f"/ws/stand?booth={name}&passcode=test-pass")
    console = await client.ws_connect(f"/ws/console?booth={name}&passcode=test-pass")
    await stand.send_json({"type": "armed"})
    while not (await receive(console, "status"))["armed"]:
        pass
    await console.send_json({"type": "start"})
    connection = await asyncio.wait_for(connections.get(), 3)
    configuration = await connection.message("Settings")
    while not (await receive(console, "status"))["live"]:
        pass
    return stand, console, connection, configuration


async def test_python_settings_and_audio_formats(running):
    stand, console, connection, config = await browsers(running)
    assert config["audio"]["input"]["sample_rate"] == 16000
    assert config["audio"]["output"]["sample_rate"] == 24000
    assert config["agent"]["listen"]["provider"]["model"] == "flux-general-en"
    assert config["agent"]["think"]["provider"]["model"] == "think-fast"
    assert config["agent"]["speak"]["provider"]["model"] == "flux-alexis-en"
    assert "test-key-never-expose" not in json.dumps(config)
    await stand.send_bytes(b"\x01\x02")
    assert await asyncio.wait_for(connection.incoming.get(), 1) == b"\x01\x02"
    await connection.ws.send_bytes(b"\x03\x04")
    assert await receive(stand, "binary") == b"\x03\x04"
    await connection.ws.send_json({"type": "UserStartedSpeaking"})
    assert await receive(stand, "flush") == {"type": "flush"}


async def test_console_cannot_inject_microphone_audio(running):
    _, console, connection, _ = await browsers(running)
    await console.send_bytes(b"should not reach Deepgram")
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(connection.incoming.get(), 0.05)


async def test_function_response_is_canonical_and_sample_data_is_labeled(running):
    _, _, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [{
        "id": "lookup-1", "name": "get_service_status", "arguments": '{"area":"north"}',
        "client_side": True, "thought_signature": "example-signature",
    }]})
    result = await connection.message("FunctionCallResponse")
    assert set(result) == {"type", "id", "name", "content", "thought_signature"}
    assert result["id"] == "lookup-1" and result["name"] == "get_service_status"
    assert json.loads(result["content"])["sample_data"] is True
    assert result["thought_signature"] == "example-signature"


@pytest.mark.parametrize("name,args,error", [
    ("get_service_status", '{"area":"unknown"}', "Invalid function arguments"),
    ("get_service_status", "{bad", "Invalid function arguments"),
    ("get_service_status", "[]", "Invalid function arguments"),
    ("unregistered", "{}", "Unknown function"),
])
async def test_function_errors_return_specific_safe_results(running, name, args, error):
    _, _, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "bad", "name": name, "arguments": args, "client_side": True}]})
    result = await connection.message("FunctionCallResponse")
    assert json.loads(result["content"]) == {"error": error}


async def test_cancelled_function_never_sends_a_late_result(running, monkeypatch):
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def slow(arguments):
        started.set()
        try:
            await asyncio.sleep(100)
        finally:
            cancelled.set()
    monkeypatch.setitem(HANDLERS, "slow", slow)
    _, _, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "slow-1", "name": "slow", "arguments": "{}", "client_side": True}]})
    await asyncio.wait_for(started.wait(), 1)
    await connection.ws.send_json({"type": "FunctionCallCancelled", "functions": [{"id": "slow-1", "name": "slow"}]})
    await asyncio.wait_for(cancelled.wait(), 1)
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(connection.incoming.get(), 0.05)


async def test_internal_functions_and_duplicate_ids_are_not_executed_twice(running):
    _, _, connection, _ = await browsers(running)
    function = {"id": "once", "name": "get_service_status", "arguments": '{"area":"central"}', "client_side": True}
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "internal", "name": "internal", "client_side": False}, function, function]})
    assert (await connection.message("FunctionCallResponse"))["id"] == "once"
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(connection.incoming.get(), 0.05)


async def test_qr_does_not_end_the_call_and_hard_stop_closes_upstream(running):
    stand, console, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "qr", "name": "show_code", "arguments": "{}", "client_side": True}]})
    await connection.message("FunctionCallResponse")
    while not (await receive(console, "status"))["qr"]:
        pass
    await console.send_json({"type": "stop"})
    assert await receive(stand, "stop")
    async with asyncio.timeout(3):
        while (await receive(console, "status"))["call"]:
            pass
    assert (await (await running[0].get("/health")).json())["calls"] == 0
    assert await receive(connection.ws) is None


@pytest.mark.parametrize("running", [0.2], indirect=True)
async def test_finish_deadline_stops_even_without_a_model_goodbye(running):
    stand, console, connection, _ = await browsers(running)
    await console.send_json({"type": "wrap"})
    prompt = await connection.message("UpdatePrompt")
    assert "one short warm goodbye" in prompt["prompt"]
    assert await receive(stand, "stop")


async def test_goodbye_drains_once_without_a_second_model_response(running):
    stand, console, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "end", "name": "end_call", "arguments": "{}", "client_side": True}]})
    await connection.ws.send_bytes(b"\x01\x02")
    assert await receive(stand, "end")
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(connection.incoming.get(), 0.05)
    await stand.send_json({"type": "drained"})
    assert await receive(stand, "stop")


async def test_stand_disconnect_ends_call_and_next_visitor_starts_fresh(running):
    stand, console, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "ConversationText", "role": "user", "content": "Synthetic visitor detail"})
    await receive(console, "line")
    await stand.close()
    async with asyncio.timeout(3):
        while (await receive(console, "status"))["call"]:
            pass
    fresh = await running[0].ws_connect("/ws/console?passcode=test-pass")
    assert (await receive(fresh))["type"] == "status"  # no old transcript replay


async def test_pages_qr_passcode_origin_and_booth_isolation(running):
    client, _ = running
    for path in ("/", "/console", "/stand.js", "/console.js", "/mic-worklet.js", "/qr.svg"):
        response = await client.get(path)
        assert response.status == 200, path
        assert "test-key-never-expose" not in await response.text()
    config = await (await client.get("/config.json")).json()
    assert config["passcode"] is True
    assert (await client.get("/.env")).status == 404
    refused = await client.ws_connect("/ws/console?passcode=wrong")
    assert (await refused.receive()).data == 4401
    with pytest.raises(aiohttp.WSServerHandshakeError) as error:
        await client.ws_connect("/ws/console?passcode=test-pass", origin="https://other.example")
    assert error.value.status == 403
    a = await client.ws_connect("/ws/console?booth=one&passcode=test-pass")
    b = await client.ws_connect("/ws/console?booth=two&passcode=test-pass")
    assert (await receive(a, "status"))["booth"] == "one"
    assert (await receive(b, "status"))["booth"] == "two"


def test_same_config_supports_a_managed_llm_without_think_fast(monkeypatch):
    monkeypatch.setenv("THINK_PROVIDER", "open_ai")
    monkeypatch.setenv("THINK_MODEL", "gpt-4o-mini")
    assert settings()["agent"]["think"]["provider"] == {"type": "open_ai", "model": "gpt-4o-mini"}


@pytest.mark.parametrize("raw,expected", [(None, "1"), ("Hall-2", "hall-2"), ("../secret", None), ("a" * 25, None)])
def test_booth_identifiers(raw, expected):
    assert booth_id(raw) == expected


async def test_end_call_waits_for_goodbye_audio_that_arrives_after_function(running):
    stand, _, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "late-goodbye", "name": "end_call", "arguments": "{}", "client_side": True}]})
    ended = asyncio.create_task(receive(stand, "end"))
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(asyncio.shield(ended), 0.6)
    await connection.ws.send_json({"type": "AgentStartedSpeaking"})
    await connection.ws.send_bytes(b"\x01\x02")
    await connection.ws.send_json({"type": "AgentAudioDone"})
    assert await asyncio.wait_for(ended, 2)


@pytest.mark.parametrize("fails", [True, False])
async def test_bad_handlers_return_safe_errors_instead_of_hanging(running, monkeypatch, fails):
    async def bad(arguments):
        if fails:
            raise RuntimeError("private backend credential should never reach the model")
        return object()  # not JSON serializable
    monkeypatch.setitem(HANDLERS, "bad", bad)
    _, _, connection, _ = await browsers(running)
    await connection.ws.send_json({"type": "FunctionCallRequest", "functions": [
        {"id": "bad-result", "name": "bad", "arguments": "{}", "client_side": True}]})
    response = await connection.message("FunctionCallResponse")
    assert "error" in json.loads(response["content"])
    assert "credential" not in response["content"]
