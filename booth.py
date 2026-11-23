"""One in-memory conversation: browser PCM <-> Python <-> Deepgram Voice Agent API.

This follows the live booth's asyncio/aiohttp approach, with its graph and side agents left out.
Nothing here records audio or writes conversation text to disk.
"""
import asyncio
import contextlib
import json
import re
import time
from collections import deque
from dataclasses import dataclass, field

from aiohttp import WSMsgType

from agent_config import CLOSING_PROMPT, configured_prompt, settings
from functions import HANDLERS

AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse"


def booth_id(raw):
    value = (raw or "1").strip().lower()
    return value if re.fullmatch(r"[a-z0-9-]{1,24}", value) else None


class Peer:
    """One browser's bounded output queue; a slow console never blocks the agent."""
    def __init__(self, ws):
        self.ws, self.queue, self.wake = ws, deque(), asyncio.Event()
        self.closed = False
        self.task = asyncio.create_task(self._write())

    def emit(self, message):
        if self.closed:
            return
        if len(self.queue) >= 100:
            self.interrupt()                     # stale audio is less useful than the current conversation
            if len(self.queue) >= 100:
                self.closed = True
                self.wake.set()
                return
        self.queue.append(message if isinstance(message, bytes) else json.dumps(message))
        self.wake.set()

    def interrupt(self):
        self.queue = deque(item for item in self.queue if not isinstance(item, bytes))

    async def _write(self):
        try:
            while not self.closed:
                await self.wake.wait()
                self.wake.clear()
                while self.queue and not self.closed:
                    item = self.queue.popleft()
                    if isinstance(item, bytes):
                        await self.ws.send_bytes(item)
                    else:
                        await self.ws.send_str(item)
        except (ConnectionError, RuntimeError):
            pass
        finally:
            await self.ws.close()

    async def close(self):
        self.closed = True
        self.queue.clear()
        self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
        await self.ws.close()


@dataclass
class Call:
    at: float
    agent: object = None
    live: bool = False
    agent_speaking: bool = False
    visitor_speaking: bool = False
    quiet_at: float = 0
    last_audio: float = 0
    close_at: float | None = None
    ending_at: float | None = None
    prompt_updated: bool = False
    closing_reply: bool = False
    cue_sent: bool = False
    draining: bool = False
    jobs: set = field(default_factory=set)
    functions: dict = field(default_factory=dict)
    seen_functions: set = field(default_factory=set)
    cancelled_functions: set = field(default_factory=set)


class Booth:
    def __init__(self, name, connect, *, handlers=None, close_seconds=12, max_seconds=1800):
        self.name, self.connect = name, connect
        self.handlers = HANDLERS if handlers is None else handlers
        self.close_seconds, self.max_seconds = close_seconds, max_seconds
        self.stand, self.consoles, self.call = None, set(), None
        self.armed, self.qr, self.lines = False, False, []

    def broadcast(self, message):
        for peer in self.consoles:
            peer.emit(message)

    def status(self):
        call = self.call
        self.broadcast({
            "type": "status", "booth": self.name, "stand": self.stand is not None,
            "armed": self.armed, "call": call is not None, "live": bool(call and call.live),
            "closing": bool(call and call.close_at is not None),
            "ending": bool(call and call.ending_at is not None), "qr": self.qr,
        })

    async def attach(self, kind, peer):
        if kind == "stand":
            if self.stand:
                await self.stop("screen replaced")
                old = self.stand
                old.emit({"type": "replaced"})
                await old.ws.close(code=4000, message=b"another booth screen took over")
            self.stand, self.armed = peer, False
            peer.emit({"type": "hello", "booth": self.name, "qr": self.qr})
        else:
            self.consoles.add(peer)
            for line in self.lines:
                peer.emit({"type": "line", **line})
        self.status()

    async def detach(self, kind, peer):
        if kind == "stand" and self.stand is peer:
            self.stand, self.armed = None, False
            await self.stop("screen disconnected")
        else:
            self.consoles.discard(peer)
        self.status()

    async def browser_message(self, kind, peer, message):
        if kind == "stand" and self.stand is not peer:
            return
        if isinstance(message, bytes):
            call = self.call
            if kind == "stand" and call and call.live and call.ending_at is None:
                await call.agent.send_bytes(message)
            return
        action = message.get("type")
        if kind == "stand" and action == "armed":
            self.armed = True
            self.status()
        elif action == "start":
            self.start()
        elif action == "stop":
            await self.stop("operator stopped the call")
        elif kind == "stand" and action == "drained":
            if self.call and self.call.draining:
                await self.stop("goodbye")
        elif kind == "console" and action == "wrap":
            await self.wrap()
        elif kind == "console" and action == "qr":
            self.show_qr(bool(message.get("on")))

    def job(self, call, coroutine):
        task = asyncio.create_task(coroutine)
        call.jobs.add(task)
        task.add_done_callback(call.jobs.discard)
        return task

    def start(self):
        if self.call or not self.stand or not self.armed:
            self.broadcast({"type": "event", "text": "Set up the booth screen before Start; only one call per booth."})
            return
        now = time.monotonic()
        call = self.call = Call(at=now, quiet_at=now)
        self.lines.clear()
        self.show_qr(False)
        self.stand.emit({"type": "start"})
        self.job(call, self._run(call))
        self.job(call, self._tick(call))
        self.status()

    async def _run(self, call):
        try:
            async with self.connect() as agent:
                if self.call is not call:
                    return
                call.agent = agent
                await agent.send_json(settings())
                async for message in agent:
                    if self.call is not call:
                        break
                    if message.type == WSMsgType.BINARY:
                        call.last_audio = time.monotonic()
                        if self.stand:
                            self.stand.emit(message.data)
                    elif message.type == WSMsgType.TEXT:
                        try:
                            data = json.loads(message.data)
                        except (ValueError, TypeError):
                            continue
                        if isinstance(data, dict):
                            await self.agent_message(call, data)
                            if self.call is not call:
                                break
                    elif message.type == WSMsgType.ERROR:
                        break
        except (OSError, TimeoutError, RuntimeError):
            self.broadcast({"type": "event", "text": "The agent connection failed. Check server credentials and model access."})
        except Exception:
            # Never expose the API key, upstream URL/query, or visitor text in an exception log.
            self.broadcast({"type": "event", "text": "The agent connection could not be completed."})
        finally:
            if self.call is call:
                await self.stop("agent disconnected")

    async def stop(self, reason):
        call, self.call = self.call, None
        if call is None:
            return
        if self.stand:
            self.stand.interrupt()
            self.stand.emit({"type": "stop"})
        self.lines.clear()                          # late consoles never receive an ended visitor's transcript
        self.broadcast({"type": "event", "text": f"Conversation ended: {reason}."})
        self.status()
        others = [task for task in call.jobs if task is not asyncio.current_task()]
        for task in others:
            task.cancel()
        await asyncio.gather(*others, return_exceptions=True)

    async def agent_message(self, call, message):
        kind, now = message.get("type"), time.monotonic()
        if kind == "SettingsApplied":
            call.live = True
            self.status()
        elif kind == "UserStartedSpeaking":
            call.visitor_speaking, call.agent_speaking = True, False
            if self.stand:
                self.stand.interrupt()
                self.stand.emit({"type": "flush"})
                self.stand.emit({"type": "state", "state": "user"})
        elif kind == "EndOfTurn":
            call.visitor_speaking, call.quiet_at = False, now
        elif kind == "AgentThinking" and self.stand:
            self.stand.emit({"type": "state", "state": "thinking"})
        elif kind == "AgentStartedSpeaking":
            call.agent_speaking = True
            call.closing_reply = call.close_at is not None and call.prompt_updated
            if self.stand:
                self.stand.emit({"type": "state", "state": "agent"})
        elif kind == "AgentAudioDone":
            call.agent_speaking, call.quiet_at = False, now
            if call.closing_reply and call.ending_at is None:
                call.ending_at = now
            if self.stand:
                self.stand.emit({"type": "state", "state": "listening"})
        elif kind == "ConversationText":
            role = "user" if message.get("role") == "user" else "agent"
            text = str(message.get("content", ""))
            if role == "user":
                call.visitor_speaking, call.quiet_at = False, now
                if text.startswith("[operator]"):
                    return
            line = {"role": role, "text": text}
            self.lines = [*self.lines[-99:], line]
            self.broadcast({"type": "line", **line})
            if self.stand:
                self.stand.emit({"type": "caption", **line})
        elif kind == "PromptUpdated":
            call.prompt_updated = True
        elif kind == "InjectionRefused":
            call.cue_sent, call.quiet_at = False, now
        elif kind == "FunctionCallRequest":
            for function in message.get("functions", []):
                if not isinstance(function, dict) or function.get("client_side") is not True:
                    continue
                ident = function.get("id")
                if not isinstance(ident, str) or not ident or ident in call.seen_functions:
                    continue
                call.seen_functions.add(ident)
                task = self.job(call, self.function(call, function, received_at=now))
                call.functions[ident] = task
                task.add_done_callback(lambda _, ident=ident: call.functions.pop(ident, None))
        elif kind == "FunctionCallCancelled":
            for function in message.get("functions", []):
                if isinstance(function, dict):
                    ident = function.get("id")
                    call.cancelled_functions.add(ident)
                    if task := call.functions.get(ident):
                        task.cancel()
        elif kind == "Error":
            # The browser gets a useful provider error, but no raw exception or request headers.
            text = str(message.get("description") or message.get("code") or "Voice Agent API error")
            if self.stand:
                self.stand.emit({"type": "error", "text": text})
            self.broadcast({"type": "event", "text": text})
            await self.stop("Voice Agent API error")

    async def function(self, call, function, *, received_at=None):
        name = function.get("name")
        self.broadcast({"type": "line", "role": "tool", "text": str(name)})
        if name == "end_call":
            # Closing the API connection completes this action; a result would solicit another spoken reply.
            call.ending_at = time.monotonic() if received_at is None else received_at
            if call.close_at is None:
                call.close_at = call.ending_at
            self.status()
            return
        if call.close_at is not None:
            result = {"error": "The operator is ending this call. Say only a short goodbye and call end_call."}
        else:
            try:
                arguments = function.get("arguments", "{}")
                arguments = json.loads(arguments) if isinstance(arguments, str) else arguments
                if not isinstance(arguments, dict):
                    raise ValueError("Invalid function arguments")
                if name == "show_code":
                    self.show_qr(True)
                    result = {"displayed": True, "message": "The starter QR is on the booth screen."}
                elif handler := self.handlers.get(name):
                    result = await asyncio.wait_for(handler(arguments), timeout=5)
                else:
                    result = {"error": "Unknown function"}
            except (ValueError, TypeError):
                result = {"error": "Invalid function arguments"}
            except TimeoutError:
                result = {"error": "The lookup timed out. Do not invent a result."}
            except Exception:
                result = {"error": "The lookup failed. Do not invent a result."}
        if self.call is call and function["id"] not in call.cancelled_functions:
            try:
                content = json.dumps(result, allow_nan=False)
            except (TypeError, ValueError):
                content = json.dumps({"error": "The lookup returned an invalid result."})
            response = {"type": "FunctionCallResponse", "id": function["id"], "name": name,
                        "content": content}
            if "thought_signature" in function:
                response["thought_signature"] = function["thought_signature"]
            with contextlib.suppress(ConnectionError, RuntimeError):
                await call.agent.send_json(response)

    def show_qr(self, on):
        self.qr = on
        if self.stand:
            self.stand.emit({"type": "qr", "on": on})
        self.status()

    async def wrap(self):
        call = self.call
        if call is None or not call.live or call.close_at is not None:
            return
        call.close_at = time.monotonic()
        await call.agent.send_json({"type": "UpdatePrompt", "prompt": configured_prompt() + "\n\n" + CLOSING_PROMPT})
        self.status()

    async def _tick(self, call):
        keepalive_at = time.monotonic()
        while self.call is call:
            await asyncio.sleep(0.1)
            now = time.monotonic()
            if now - call.at >= self.max_seconds or (call.close_at is not None and now - call.close_at >= self.close_seconds):
                await self.stop("conversation finished")
                return
            if not call.live:
                if now - call.at >= 15:
                    await self.stop("the agent did not start; check model access")
                    return
                continue
            if now - keepalive_at >= 8:
                await call.agent.send_json({"type": "KeepAlive"})
                keepalive_at = now
            if call.ending_at is not None:
                heard_goodbye = call.last_audio >= call.ending_at or call.closing_reply or now - call.ending_at >= 3
                if heard_goodbye and not call.draining and not call.agent_speaking and now - max(call.last_audio, call.ending_at) >= 0.5:
                    call.draining = True
                    if self.stand:
                        self.stand.emit({"type": "end"})
                continue
            if call.close_at is not None and not call.cue_sent and not call.agent_speaking and not call.visitor_speaking:
                if now - max(call.last_audio, call.quiet_at) >= 0.5:
                    call.cue_sent = True
                    await call.agent.send_json({"type": "InjectUserMessage", "content": "[operator] Say one short goodbye now, then call end_call."})
