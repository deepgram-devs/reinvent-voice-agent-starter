// Shared by the booth screen and the console: which booth this page is for, the passcode, and a socket to the server
// that reconnects by itself.

export const params = new URLSearchParams(location.search);
export const booth = (params.get("booth") || "1").trim().toLowerCase();
export const config = await fetch("/config.json").then((r) => r.json());

const PASS_KEY = "booth-passcode";
export function passcode() {
  try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; }
}
export function setPasscode(value) {
  try { localStorage.setItem(PASS_KEY, value); } catch {}
}

// Opens /ws/<kind>?booth=..&passcode=.. and keeps it open. Handlers: onopen(ws), onjson(msg), onbinary(buf),
// onrefused() for a wrong passcode, onstatus(connected).
export function connect(kind, h) {
  let ws, retry = 0, stopped = false;
  const open = () => {
    const q = new URLSearchParams({ booth, passcode: passcode() });
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${kind}?${q}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { retry = 0; h.onstatus?.(true); h.onopen?.(ws); };
    ws.onmessage = (e) => (typeof e.data === "string" ? h.onjson?.(JSON.parse(e.data)) : h.onbinary?.(e.data));
    ws.onclose = (e) => {
      h.onstatus?.(false);
      if (e.code === 4401) { stopped = true; return h.onrefused?.(); }
      if (e.code === 4000) { stopped = true; return h.onreplaced?.(); }
      if (!stopped) setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
    };
  };
  open();
  return {
    send: (msg) => ws?.readyState === WebSocket.OPEN && ws.send(typeof msg === "string" || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg)),
    // After a refused passcode the socket is already closed: open a new one with the new passcode.
    reconnect: () => { stopped = false; if (ws?.readyState === WebSocket.OPEN) ws.close(); else open(); },
  };
}
