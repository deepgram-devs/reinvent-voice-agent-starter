// The UI and Booth speak the same protocol with either implementation. The Pipecat
// service is private to this machine; never send the Deepgram key to that service.
import { WebSocket } from "ws";

export function agentConnection(key, env = process.env) {
  const backend = env.VOICE_BACKEND || "deepgram";
  if (backend === "deepgram") return () => new WebSocket("wss://agent.deepgram.com/v1/agent/converse", {
    headers: { Authorization: `Token ${key}` },
  });
  if (backend !== "pipecat") throw new Error("VOICE_BACKEND must be deepgram or pipecat");
  if (!env.PIPECAT_TOKEN) throw new Error("Set PIPECAT_TOKEN in both the Node and Pipecat environments");
  const url = new URL(env.PIPECAT_URL || "ws://127.0.0.1:7861/agent");
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("PIPECAT_URL must be a loopback ws:// URL; run Pipecat alongside Node");
  }
  return () => new WebSocket(url, { headers: { Authorization: `Bearer ${env.PIPECAT_TOKEN}` } });
}
