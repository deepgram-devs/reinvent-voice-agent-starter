// Run inside the built image using stdin. A fake key is sufficient; no provider calls.
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";

assert.notEqual(process.getuid(), 0, "The container must run as an unprivileged user");
const child = spawn(process.execPath, ["server.js"], { stdio: ["ignore", "pipe", "inherit"] });
try {
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => { throw new Error(`Server exited: ${code}`); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Startup timed out")), 5000).unref()),
  ]);
  const base = `http://127.0.0.1:${process.env.PORT || 8080}`;
  for (const route of ["/", "/console", "/config.json", "/qr.svg"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.doesNotMatch(await response.text(), /offline-test-key/);
  }
  console.log("Container startup, assets and non-root user verified.");
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}
