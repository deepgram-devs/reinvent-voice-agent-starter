// The booth server. It serves two pages and relays audio between them and Deepgram's Voice Agent API:
//
//   /          the booth screen: a laptop or a big screen with a mic and speaker. Visitors talk to it.
//   /console   the operator console, on a phone or tablet: pick who is visiting, Start, Wrap up, notes, QR code.
//
// Your Deepgram API key stays here, on the server; no browser ever sees it.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { Booth, boothId, passcodeOk } from "./booth.js";

const PORT = Number(process.env.PORT || 3000);
const KEY = process.env.DEEPGRAM_API_KEY;
const PASSCODE = process.env.BOOTH_PASSCODE || "";
// Without a passcode the booth is only reachable from this computer. Set BOOTH_PASSCODE to open it to your network,
// a container or the internet: the agent runs on your Deepgram key.
const HOST = PASSCODE ? "0.0.0.0" : "127.0.0.1";
// The QR code on the booth screen opens this. Point it at your own fork.
const REPO_URL = process.env.REPO_URL || "https://github.com/deepgram-devs/reinvent-voice-agent-starter";
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon",
};
const PAGES = { "/": "index.html", "/console": "console.html" };

if (!KEY) {
  console.error("Set DEEPGRAM_API_KEY first: copy .env.example to .env and put your key in it (https://console.deepgram.com).");
  process.exit(1);
}

const qrSvg = await QRCode.toString(REPO_URL, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
const booths = new Map();

function booth(id) {
  if (!booths.has(id)) booths.set(id, new Booth(id, { key: KEY }));
  return booths.get(id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/config.json") {
    return json(res, { repoUrl: REPO_URL, passcode: !!PASSCODE });
  }
  if (url.pathname === "/qr.svg") {
    return res.writeHead(200, { "content-type": TYPES[".svg"], "cache-control": "no-cache" }).end(qrSvg);
  }
  const file = path.normalize(path.join(PUBLIC, PAGES[url.pathname] || url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return res.writeHead(403).end();
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// Two sockets: /ws/stand for the booth screen (audio and captions), /ws/console for consoles (control and status).
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const kind = { "/ws/stand": "stand", "/ws/console": "console" }[url.pathname];
  const id = boothId(url.searchParams.get("booth"));
  if (!kind || !id) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!passcodeOk(url.searchParams.get("passcode"), PASSCODE)) return ws.close(4401, "wrong passcode");
    if (kind === "stand") booth(id).attachStand(ws);
    else booth(id).attachConsole(ws);
  });
});

function json(res, body) {
  res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-cache" }).end(JSON.stringify(body));
}

server.listen(PORT, HOST, () => {
  console.log(`Booth screen:  http://localhost:${PORT}/`);
  console.log(`Console:       http://localhost:${PORT}/console`);
  if (!PASSCODE) console.log("Only this computer can open it. Set BOOTH_PASSCODE to use a phone or put it online.");
});
