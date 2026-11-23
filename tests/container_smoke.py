"""Run inside the container using stdin; never opens a provider conversation."""
import os
import subprocess
import time
import urllib.request

assert os.getuid() != 0
server = subprocess.Popen([".venv/bin/python", "server.py"])
try:
    base = f"http://127.0.0.1:{os.environ.get('PORT', '8080')}"
    for attempt in range(50):
        try:
            with urllib.request.urlopen(base + "/health", timeout=1) as response:
                assert response.status == 200
            break
        except OSError:
            if server.poll() is not None:
                raise RuntimeError("Server exited before startup")
            time.sleep(.1)
    else:
        raise RuntimeError("Startup timed out")
    for route in ("/", "/console", "/config.json", "/qr.svg"):
        with urllib.request.urlopen(base + route, timeout=2) as response:
            assert response.status == 200
            assert b"offline-test-key" not in response.read()
    print("Container startup, assets and non-root user verified.")
finally:
    server.terminate()
    server.wait(timeout=5)
