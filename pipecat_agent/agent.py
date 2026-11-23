"""Private Pipecat sidecar, using the existing booth socket protocol.

No audio/transcript recorder or external tracing is installed. Each socket owns
its pipeline and context. Never expose this port outside the local machine.
"""
import asyncio
import contextlib
import hmac
import os
from pathlib import Path

import httpx
from aiohttp import web, WSMsgType
from dotenv import load_dotenv
from loguru import logger
from openai import AsyncOpenAI

# Pipecat's debug logs may contain visitor speech and model output.
logger.remove()

from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.frames.frames import (
    BotStartedSpeakingFrame, BotStoppedSpeakingFrame, ErrorFrame, FunctionCallResultProperties, InputAudioRawFrame,
    InterruptionFrame, LLMFullResponseEndFrame, LLMFullResponseStartFrame,
    LLMMessagesAppendFrame, LLMTextFrame, OutputAudioRawFrame, StartFrame,
    TTSSpeakFrame, TTSStartedFrame, TTSStoppedFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.worker import PipelineWorker, PipelineParams
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.deepgram.flux.tts import DeepgramFluxTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies


async def think_request(request):
    """The OpenAI SDK appends /chat/completions; Think-Fast uses /v1/think."""
    request.url = httpx.URL("https://agent.deepgram.com/v1/think")
    request.headers["Authorization"] = "Token " + os.environ["DEEPGRAM_API_KEY"]


class ThinkFastLLMService(OpenAILLMService):
    def create_client(self, **kwargs):
        return AsyncOpenAI(
            api_key=os.environ["DEEPGRAM_API_KEY"],
            base_url="https://agent.deepgram.com/v1/",
            max_retries=0,
            http_client=httpx.AsyncClient(event_hooks={"request": [think_request]}, timeout=20),
        )


class Captions(FrameProcessor):
    def __init__(self, send):
        super().__init__()
        self.send, self.text = send, ""

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                self.text = ""
                await self.send("AgentThinking")
            elif isinstance(frame, LLMTextFrame):
                self.text += frame.text
            elif isinstance(frame, LLMFullResponseEndFrame):
                if self.text.strip():
                    await self.send("ConversationText", role="assistant", content=self.text)
                self.text = ""
            elif isinstance(frame, InterruptionFrame):
                self.text = ""
        await self.push_frame(frame, direction)


class SocketOutput(FrameProcessor):
    def __init__(self, ws, send, ready):
        super().__init__()
        self.ws, self.send, self.ready = ws, send, ready

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, StartFrame):
                self.ready.set()
            elif isinstance(frame, OutputAudioRawFrame):
                await self.ws.send_bytes(frame.audio)
            elif isinstance(frame, TTSStartedFrame):
                await self.send("AgentStartedSpeaking")
                await self.broadcast_frame(BotStartedSpeakingFrame)
            elif isinstance(frame, TTSStoppedFrame):
                await self.send("AgentAudioDone")
                await self.broadcast_frame(BotStoppedSpeakingFrame)
            elif isinstance(frame, ErrorFrame):
                # Provider bodies can contain input. Keep them out of logs and UI.
                await self.send("Error", code="PIPECAT_PROVIDER", description="A Pipecat provider failed. Check credentials and model access.")
        await self.push_frame(frame, direction)


class Conversation:
    def __init__(self, ws):
        self.ws, self.worker, self.runner_task, self.llm = ws, None, None, None
        self.pending_tools = {}

    async def send(self, kind, **fields):
        if not self.ws.closed:
            await self.ws.send_json({"type": kind, **fields})

    async def start(self, settings):
        agent = settings["agent"]
        provider = agent["think"]["provider"]
        if provider != {"type": "deepgram", "model": "think-fast"}:
            raise ValueError("Pipecat currently requires THINK_PROVIDER=deepgram and THINK_MODEL=think-fast")
        key = os.environ["DEEPGRAM_API_KEY"]
        self.context = LLMContext(
            [{"role": "system", "content": agent["think"]["prompt"]}],
            tools=[FunctionSchema(name=f["name"], description=f["description"],
                                  properties=f["parameters"]["properties"],
                                  required=f["parameters"].get("required", []))
                   for f in agent["think"]["functions"]],
        )
        self.llm = ThinkFastLLMService(api_key=key, settings=OpenAILLMService.Settings(model="think-fast"))
        for name in (f["name"] for f in agent["think"]["functions"]):
            self.llm.register_function(name, self.tool)
        stt = DeepgramFluxSTTService(api_key=key, sample_rate=16000,
                                    settings=DeepgramFluxSTTService.Settings(model="flux-general-en"))
        tts = DeepgramFluxTTSService(api_key=key, sample_rate=24000,
                                   settings=DeepgramFluxTTSService.Settings(voice=agent["speak"]["provider"]["model"]))
        @stt.event_handler("on_start_of_turn")
        async def started(service, transcript):
            await self.send("UserStartedSpeaking")

        @stt.event_handler("on_end_of_turn")
        async def ended(service, transcript):
            await self.send("ConversationText", role="user", content=transcript)
            await self.send("EndOfTurn")

        pair = LLMContextAggregatorPair(self.context, user_params=LLMUserAggregatorParams(
            user_turn_strategies=ExternalUserTurnStrategies()))
        ready = asyncio.Event()
        self.worker = PipelineWorker(
            Pipeline([stt, pair.user(), self.llm, Captions(self.send), tts,
                      SocketOutput(self.ws, self.send, ready), pair.assistant()]),
            params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=24000),
            enable_rtvi=False,
        )
        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(self.worker)
        self.runner_task = asyncio.create_task(runner.run())
        self.runner_task.add_done_callback(lambda task: asyncio.create_task(self.pipeline_done(task)))
        await asyncio.wait_for(ready.wait(), timeout=20)
        await self.send("SettingsApplied")
        greeting = agent["greeting"]
        self.context.add_message({"role": "assistant", "content": greeting})
        await self.send("ConversationText", role="assistant", content=greeting)
        await self.worker.queue_frame(TTSSpeakFrame(greeting))

    async def pipeline_done(self, task):
        if not self.ws.closed:
            if not task.cancelled() and task.exception():
                await self.send("Error", code="PIPECAT_PIPELINE", description="The Pipecat pipeline stopped.")
            await self.ws.close()

    async def tool(self, params):
        future = asyncio.get_running_loop().create_future()
        self.pending_tools[params.tool_call_id] = future
        try:
            await self.send("FunctionCallRequest", functions=[{
                "id": params.tool_call_id, "name": params.function_name,
                "arguments": params.arguments, "client_side": True,
            }])
            if params.function_name == "end_call":
                # The shared Booth closes after the goodbye; no second reply.
                result, run_llm = "Done", False
            else:
                # Booth validates arguments and calls the same registered Python
                # handlers used by the managed Voice Agent API implementation.
                try:
                    result = await asyncio.wait_for(future, timeout=8)
                except TimeoutError:
                    result = '{"error":"The function timed out. Do not invent a result."}'
                run_llm = True
            await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=run_llm))
        except asyncio.CancelledError:
            await self.send("FunctionCallCancelled", functions=[{"id": params.tool_call_id}])
            raise
        finally:
            self.pending_tools.pop(params.tool_call_id, None)

    async def command(self, msg):
        kind = msg.get("type")
        if kind == "Settings":
            if self.worker:
                raise ValueError("Settings already applied")
            await self.start(msg)
        elif kind == "FunctionCallResponse":
            future = self.pending_tools.get(msg.get("id"))
            if future is not None and not future.done():
                future.set_result(msg.get("content", "{}"))
        elif kind == "KeepAlive":
            return
        elif not self.worker:
            raise ValueError("Send Settings first")
        elif kind == "UpdatePrompt":
            # Add instructions without discarding the original identity or history.
            messages = self.context.get_messages()
            messages[0]["content"] = msg["prompt"]
            await self.send("PromptUpdated")
        elif kind == "InjectUserMessage":
            await self.send("ConversationText", role="user", content=msg["content"])
            await self.worker.queue_frame(LLMMessagesAppendFrame(
                [{"role": "user", "content": msg["content"]}], run_llm=True))
        elif kind == "InjectAgentMessage":
            self.context.add_message({"role": "assistant", "content": msg["message"]})
            await self.send("ConversationText", role="assistant", content=msg["message"])
            await self.worker.queue_frame(TTSSpeakFrame(msg["message"]))
        else:
            raise ValueError("Unsupported command")

    async def close(self):
        if self.worker:
            await self.worker.cancel()
        if self.runner_task:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.runner_task
        if self.llm:
            await self.llm._client.close()


async def agent_socket(request):
    expected = "Bearer " + os.environ["PIPECAT_TOKEN"]
    if not hmac.compare_digest(request.headers.get("Authorization", ""), expected):
        raise web.HTTPUnauthorized()
    ws = web.WebSocketResponse(max_msg_size=1 << 20)
    await ws.prepare(request)
    call = Conversation(ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                if call.worker:
                    await call.worker.queue_frame(InputAudioRawFrame(msg.data, 16000, 1))
            elif msg.type == WSMsgType.TEXT:
                await call.command(msg.json())
            elif msg.type == WSMsgType.ERROR:
                break
    except Exception:
        await call.send("Error", code="PIPECAT_SESSION", description="Pipecat could not run this session. Check configuration and model access.")
        await ws.close()
    finally:
        await call.close()
    return ws


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    if not os.getenv("DEEPGRAM_API_KEY") or not os.getenv("PIPECAT_TOKEN"):
        raise SystemExit("Set DEEPGRAM_API_KEY and PIPECAT_TOKEN in the root .env")
    app = web.Application()
    app.router.add_get("/agent", agent_socket)
    web.run_app(app, host="127.0.0.1", port=int(os.getenv("PIPECAT_PORT", "7861")), access_log=None)


if __name__ == "__main__":
    main()
