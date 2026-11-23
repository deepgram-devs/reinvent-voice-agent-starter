"""Offline checks: never contact Deepgram or save visitor content."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from openai import AsyncOpenAI

import agent
from pipecat.frames.frames import (
    TranscriptionFrame, TTSSpeakFrame, TTSStartedFrame, TTSStoppedFrame,
    TTSAudioRawFrame, ProposedUserStartedSpeakingFrame, ProposedUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameProcessor


class Socket:
    closed = False
    def __init__(self):
        self.events, self.audio = [], []
    async def send_json(self, event):
        self.events.append(event)
    async def send_bytes(self, audio):
        self.audio.append(audio)
    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_think_fast_path_auth_and_stream(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-key")
    async def respond(request):
        assert str(request.url) == "https://agent.deepgram.com/v1/think"
        assert request.headers["Authorization"] == "Token test-key"
        assert json.loads(request.content)["model"] == "think-fast"
        body = 'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), event_hooks={"request": [agent.think_request]}) as http:
        async with AsyncOpenAI(api_key="unused", base_url="https://agent.deepgram.com/v1/", http_client=http) as client:
            stream = await client.chat.completions.create(model="think-fast", messages=[{"role": "user", "content": "hi"}], stream=True)
            assert [chunk.choices[0].delta.content async for chunk in stream] == ["Hello"]


@pytest.mark.asyncio
async def test_tools_do_not_generate_a_second_goodbye():
    ws = Socket()
    call = agent.Conversation(ws)
    result = AsyncMock()
    await call.tool(SimpleNamespace(tool_call_id="id", function_name="end_call", arguments={}, result_callback=result))
    assert ws.events[0]["functions"][0]["name"] == "end_call"
    assert result.call_args.kwargs["properties"].run_llm is False


@pytest.mark.asyncio
async def test_prompt_update_keeps_one_system_message_and_history():
    ws = Socket()
    call = agent.Conversation(ws)
    call.worker = SimpleNamespace(queue_frame=AsyncMock())
    call.context = agent.LLMContext([{"role": "system", "content": "Identity"}, {"role": "user", "content": "hi"}])
    await call.command({"type": "UpdatePrompt", "prompt": "Say goodbye"})
    messages = call.context.get_messages()
    assert len(messages) == 2
    assert messages[0]["content"] == "Say goodbye"
    assert ws.events == [{"type": "PromptUpdated"}]
    await call.command({"type": "InjectUserMessage", "content": "[operator] wrap"})
    assert call.worker.queue_frame.call_args.args[0].run_llm


class FakeSTT(FrameProcessor):
    def __init__(self, **kwargs):
        super().__init__()
        self._register_event_handler("on_start_of_turn")
        self._register_event_handler("on_end_of_turn")
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)
    Settings = agent.DeepgramFluxSTTService.Settings


class FakeTTS(FrameProcessor):
    Settings = agent.DeepgramFluxTTSService.Settings
    def __init__(self, **kwargs):
        super().__init__()
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSSpeakFrame):
            await self.push_frame(TTSStartedFrame())
            await self.push_frame(TTSAudioRawFrame(b'\x00\x00' * 240, 24000, 1))
            await self.push_frame(TTSStoppedFrame())
        else:
            await self.push_frame(frame, direction)


@pytest.mark.asyncio
async def test_real_pipeline_lifecycle_with_fake_audio_services(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-key")
    monkeypatch.setattr(agent, "DeepgramFluxSTTService", FakeSTT)
    monkeypatch.setattr(agent, "DeepgramFluxTTSService", FakeTTS)
    requests = []
    async def respond(request):
        requests.append(json.loads(request.content))
        body = 'data: {"id":"t","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello back"},"finish_reason":null}]}\n\ndata: {"id":"t","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
    def mock_client(self, **kwargs):
        return AsyncOpenAI(api_key="test", base_url="https://test.invalid/v1/", http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(agent.ThinkFastLLMService, "create_client", mock_client)
    ws = Socket()
    call = agent.Conversation(ws)
    settings = {"agent": {
        "think": {"provider": {"type": "deepgram", "model": "think-fast"}, "prompt": "Hello", "functions": []},
        "speak": {"provider": {"model": "flux-alexis-en"}}, "greeting": "Welcome",
    }}
    try:
        await call.start(settings)
        for _ in range(100):
            if ws.audio:
                break
            await asyncio.sleep(.01)
        assert ws.audio
        kinds = [e["type"] for e in ws.events]
        assert "SettingsApplied" in kinds
        assert "AgentStartedSpeaking" in kinds
        assert "AgentAudioDone" in kinds
        await call.worker.queue_frame(ProposedUserStartedSpeakingFrame())
        await call.worker.queue_frame(TranscriptionFrame("Hi there", "visitor", "now", finalized=True))
        await call.worker.queue_frame(ProposedUserStoppedSpeakingFrame())
        for _ in range(200):
            if any(e.get("content") == "Hello back" for e in ws.events):
                break
            await asyncio.sleep(.01)
        assert any(e.get("content") == "Hello back" for e in ws.events)
        assert requests[0]["model"] == "think-fast"
        assert any(m.get("content") == "Hi there" for m in requests[0]["messages"])
    finally:
        ws.closed = True
        await call.close()
    assert call.runner_task.done()


@pytest.mark.asyncio
async def test_business_function_result_returns_through_shared_booth_handler():
    ws = Socket()
    call = agent.Conversation(ws)
    result = AsyncMock()
    params = SimpleNamespace(tool_call_id="lookup-1", function_name="get_service_status",
                             arguments={"area": "north"}, result_callback=result)
    job = asyncio.create_task(call.tool(params))
    try:
        await asyncio.sleep(0)
        request = ws.events[0]["functions"][0]
        assert request["arguments"] == {"area": "north"}
        content = '{"sample_data":true,"area":"north","status":"fictional"}'
        await call.command({"type": "FunctionCallResponse", "id": "lookup-1", "content": content})
        await asyncio.wait_for(job, 1)
        assert result.call_args.args[0] == content
        assert result.call_args.kwargs["properties"].run_llm is True
        assert not call.pending_tools
    finally:
        if not job.done():
            job.cancel()
            await asyncio.gather(job, return_exceptions=True)


@pytest.mark.asyncio
async def test_interrupted_tool_cancels_shared_handler():
    ws = Socket()
    call = agent.Conversation(ws)
    result = AsyncMock()
    params = SimpleNamespace(tool_call_id="lookup-cancel", function_name="get_service_status",
                             arguments={"area": "north"}, result_callback=result)
    job = asyncio.create_task(call.tool(params))
    await asyncio.sleep(0)
    job.cancel()
    await asyncio.gather(job, return_exceptions=True)
    assert ws.events[-1] == {"type": "FunctionCallCancelled", "functions": [{"id": "lookup-cancel"}]}
    assert not call.pending_tools
    result.assert_not_called()
