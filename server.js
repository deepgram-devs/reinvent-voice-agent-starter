// A voice agent in one small server: it serves the page in public/, and relays the browser's microphone to Deepgram's
// Voice Agent API and the agent's voice back. Your API key stays here, on the server; the browser never sees it.
//
//   browser mic (PCM16, 16 kHz) --> this server --> wss://agent.deepgram.com/v1/agent/converse
//   browser speaker (PCM16, 24 kHz) <-- this server <-- the agent's voice, plus JSON events (transcript, turns)

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { settings } from "./agent.config.js";

const PORT = Number(process.env.PORT || 3000);
const KEY = process.env.DEEPGRAM_API_KEY;
const AGENT_URL = process.env.AGENT_URL || "wss://agent.deepgram.com/v1/agent/converse";
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

if (!KEY) {
  console.error("Set DEEPGRAM_API_KEY first: copy .env.example to .env and put your key in it (https://console.deepgram.com).");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// One browser socket on /agent = one conversation = one Voice Agent API socket.
const wss = new WebSocketServer({ server, path: "/agent" });
wss.on("connection", (browser) => {
  const agent = new WebSocket(AGENT_URL, { headers: { Authorization: `Token ${KEY}` } });
  let keepAlive;

  agent.on("open", () => {
    agent.send(JSON.stringify(settings()));                                   // first message: what the agent is
    keepAlive = setInterval(() => agent.send(JSON.stringify({ type: "KeepAlive" })), 8000);
  });
  agent.on("message", (data, isBinary) => {
    if (browser.readyState !== WebSocket.OPEN) return;
    browser.send(data, { binary: isBinary });                                 // audio stays binary, events stay JSON
    if (!isBinary) {
      const msg = JSON.parse(data.toString());
      // VOICE_PROMPT_ADDED is expected with think-fast: Deepgram adds spoken-style instructions ahead of your prompt
      if ((msg.type === "Error" || msg.type === "Warning") && msg.code !== "VOICE_PROMPT_ADDED") {
        console.log(msg.type, msg.code || "", msg.description || "");
      }
    }
  });
  agent.on("close", (code, reason) => {
    clearInterval(keepAlive);
    if (code !== 1000) console.log("agent closed", code, reason.toString());
    browser.close();
  });
  agent.on("error", (err) => console.log("agent error", err.message));

  browser.on("message", (data, isBinary) => {
    if (isBinary && agent.readyState === WebSocket.OPEN) agent.send(data);   // microphone audio
  });
  browser.on("close", () => agent.close());
});

server.listen(PORT, () => console.log(`Open http://localhost:${PORT} and press Start.`));
