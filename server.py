"""Serve the booth pages and keep the Deepgram key on the Python server."""
import asyncio
import hmac
import io
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from aiohttp import web
from dotenv import load_dotenv
import qrcode
import qrcode.image.svg

from booth import Booth, Peer, booth_id
from backend import connection_options

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DEFAULT_REPO = "https://github.com/deepgram-devs/reinvent-voice-agent-starter"


def create_app(*, key=None, passcode=None, repo_url=None, connect=None):
    """connect is injectable so tests use a local fake API, never a shared live service."""
    key = os.getenv("DEEPGRAM_API_KEY", "") if key is None else key
    passcode = os.getenv("BOOTH_PASSCODE", "") if passcode is None else passcode
    repo_url = repo_url or os.getenv("REPO_URL", DEFAULT_REPO)
    if not key and connect is None:
        raise ValueError("Set DEEPGRAM_API_KEY in .env before starting.")
    parsed = urlparse(repo_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("REPO_URL must be an http or https URL.")
    qr = qrcode.make(repo_url, image_factory=qrcode.image.svg.SvgPathImage, border=4)
    svg = io.BytesIO()
    qr.save(svg)
    booths = {}
    endpoint, headers = connection_options(key) if connect is None else (None, None)
    upstream = connect
    app = web.Application(client_max_size=1 << 20)

    async def lifetime(app):
        nonlocal upstream
        timeout = aiohttp.ClientTimeout(total=15, sock_connect=10)
        async with aiohttp.ClientSession(timeout=timeout) as client:
            if upstream is None:
                upstream = lambda: client.ws_connect(
                    endpoint, headers=headers,
                    heartbeat=20, max_msg_size=4 << 20,
                )
            yield
            await asyncio.gather(*(booth.stop("server shutting down") for booth in booths.values()))
    app.cleanup_ctx.append(lifetime)

    async def config(request):
        return web.json_response({"repoUrl": repo_url, "passcode": bool(passcode)},
                                 headers={"Cache-Control": "no-store"})

    async def qr_image(request):
        return web.Response(body=svg.getvalue(), content_type="image/svg+xml")

    async def health(request):
        return web.json_response({"ok": True, "calls": sum(b.call is not None for b in booths.values())})

    async def socket(request):
        kind = request.match_info["kind"]
        name = booth_id(request.query.get("booth"))
        if kind not in ("stand", "console") or name is None:
            raise web.HTTPNotFound()
        origin = request.headers.get("Origin")
        if origin and urlparse(origin).netloc != request.host:
            raise web.HTTPForbidden(text="Open the console from this server.")
        ws = web.WebSocketResponse(heartbeat=20, max_msg_size=1 << 20)
        await ws.prepare(request)
        if passcode and not hmac.compare_digest(request.query.get("passcode", "").encode(), passcode.encode()):
            await ws.close(code=4401, message=b"wrong passcode")
            return ws
        if name not in booths:
            if len(booths) >= 20:
                await ws.close(code=1013, message=b"maximum booth count reached")
                return ws
            booths[name] = Booth(name, lambda: upstream())
        booth, peer = booths[name], Peer(ws)
        try:
            await booth.attach(kind, peer)
            async for message in ws:
                if message.type == aiohttp.WSMsgType.BINARY:
                    await booth.browser_message(kind, peer, message.data)
                elif message.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(message.data)
                    except (ValueError, TypeError):
                        continue
                    if isinstance(data, dict):
                        await booth.browser_message(kind, peer, data)
                elif message.type == aiohttp.WSMsgType.ERROR:
                    break
        finally:
            await booth.detach(kind, peer)
            await peer.close()
        return ws

    async def page(request):
        name = {"/": "index.html", "/console": "console.html"}.get(request.path, request.match_info["path"])
        target = (PUBLIC / name).resolve()
        if not target.is_relative_to(PUBLIC) or not target.is_file() or any(p.startswith(".") for p in Path(name).parts):
            raise web.HTTPNotFound()
        return web.FileResponse(target, headers={"Cache-Control": "no-cache"})

    app.router.add_get("/health", health)
    app.router.add_get("/config.json", config)
    app.router.add_get("/qr.svg", qr_image)
    app.router.add_get("/ws/{kind}", socket)
    app.router.add_get("/{path:.*}", page)
    return app


if __name__ == "__main__":
    load_dotenv(ROOT / ".env")
    try:
        app = create_app()
    except ValueError as error:
        raise SystemExit(str(error)) from None
    # Without a passcode bind only to this computer; set a passcode before network/container use.
    host = "0.0.0.0" if os.getenv("BOOTH_PASSCODE") else "127.0.0.1"
    web.run_app(app, host=host, port=int(os.getenv("PORT", "3000")), access_log=None)
