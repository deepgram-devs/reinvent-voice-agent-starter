import sys,asyncio,struct,math,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import aiohttp
from aiohttp import web
from server import create_app

async def main():
    async def agent(request):
        ws=web.WebSocketResponse();await ws.prepare(request)
        async for event in ws:
            if event.type!=aiohttp.WSMsgType.TEXT: continue
            m=json.loads(event.data)
            if m.get('type')=='Settings':
                await ws.send_json({'type':'SettingsApplied'})
                await ws.send_json({'type':'AgentStartedSpeaking'})
                await ws.send_json({'type':'ConversationText','role':'assistant','content':'Hello from the Python starter.'})
                pcm=b''.join(struct.pack('<h',int(math.sin(i*440*2*math.pi/24000)*1500)) for i in range(4800))
                await ws.send_bytes(pcm)
                await ws.send_json({'type':'AgentAudioDone'})
            if m.get('type')=='UpdatePrompt':await ws.send_json({'type':'PromptUpdated'})
            if m.get('type')=='InjectUserMessage':
                await ws.send_json({'type':'AgentStartedSpeaking'})
                await ws.send_json({'type':'ConversationText','role':'assistant','content':'Thanks for stopping by. Goodbye!'})
                await ws.send_json({'type':'AgentAudioDone'})
        return ws
    api=web.Application();api.router.add_get('/agent',agent)
    ar=web.AppRunner(api,access_log=None);await ar.setup();await web.TCPSite(ar,'127.0.0.1',4880).start()
    async with aiohttp.ClientSession() as http:
        app=create_app(key='synthetic',passcode='',connect=lambda:http.ws_connect('http://127.0.0.1:4880/agent'))
        runner=web.AppRunner(app,access_log=None);await runner.setup();await web.TCPSite(runner,'127.0.0.1',4878).start()
        try:await asyncio.Event().wait()
        finally:await runner.cleanup();await ar.cleanup()
asyncio.run(main())
