import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { WebSocket } from "ws";

// Launch only the application server, with a fake key. Never press Start or open a provider socket.
test("server serves the starter and protects console sockets without exposing its key", { timeout: 10000 }, async () => {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port), DEEPGRAM_API_KEY: "offline-test-key",
      BOOTH_PASSCODE: "test-passcode", VOICE_BACKEND: "deepgram",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const clients = [];
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on("data", () => resolve());
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Server exited before listening: ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    for (const route of ["/", "/console", "/qr.svg", "/config.json"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.doesNotMatch(await response.text(), /offline-test-key/);
    }
    assert.equal((await fetch(base + "/does-not-exist")).status, 404);
    const refused = new WebSocket(`ws://127.0.0.1:${port}/ws/console?booth=1&passcode=wrong`);
    clients.push(refused);
    assert.equal((await once(refused, "close"))[0], 4401);
    const accepted = new WebSocket(`ws://127.0.0.1:${port}/ws/console?booth=1&passcode=test-passcode`);
    clients.push(accepted);
    const [data] = await once(accepted, "message");
    assert.equal(JSON.parse(String(data)).type, "roles");
  } finally {
    for (const client of clients) client.terminate();
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
