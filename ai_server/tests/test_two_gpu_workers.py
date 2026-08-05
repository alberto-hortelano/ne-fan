"""Criterio "hecho" de F3: dos gpu-workers (mock) reparten trabajo.

Arranca DOS procesos gpu_worker_main.py en puertos efímeros (NEFAN_GPU_MOCK,
sleep 0.4 s bajo el gpu_lock) y reparte 4 /generate_texture en round-robin
desde el caller — el mecanismo real de escala: un proceso por GPU y el caller
elige base URL (NEFAN_URL_GPU_WORKER). Afirma:

  (a) enrutado: cada worker cacheó en disco EXACTAMENTE sus 2 prompts;
  (b) paralelismo inter-proceso: 4×0.4 s en <1.5 s de pared (serial ≈1.6 s);
  (c) serialización intra-worker (gpu_lock): la pared no baja de ~0.8 s (los
      2 requests de un worker corren en secuencia, no a la vez).

No hay balanceador ni dispatcher de producción — a propósito.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v"""

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

AI_SERVER_DIR = Path(__file__).resolve().parent.parent

_HAS_STACK = all(
    importlib.util.find_spec(m) is not None for m in ("fastapi", "uvicorn")
)

SLEEP_S = 0.4


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _post_texture(port: int, prompt: str) -> dict:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/generate_texture",
        data=json.dumps({"prompt": prompt}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


@unittest.skipUnless(_HAS_STACK, "fastapi/uvicorn no instalados")
class TwoGpuWorkersTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.procs: list[subprocess.Popen] = []
        self.ports: list[int] = []
        self.dirs: list[Path] = []
        for i in (1, 2):
            port = _free_port()
            wdir = Path(self._tmp.name) / f"w{i}"
            wdir.mkdir()
            env = {
                **os.environ,
                "NEFAN_GPU_MOCK": str(wdir),
                "NEFAN_GPU_WORKER_ID": f"w{i}",
                "NEFAN_GPU_MOCK_SLEEP": str(SLEEP_S),
            }
            proc = subprocess.Popen(
                [sys.executable, "-u", "gpu_worker_main.py", "--port", str(port)],
                cwd=AI_SERVER_DIR,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
            )
            self.procs.append(proc)
            self.ports.append(port)
            self.dirs.append(wdir)
        for port in self.ports:
            self._wait_health(port)

    def tearDown(self):
        for proc in self.procs:
            proc.terminate()
        for proc in self.procs:
            proc.wait(timeout=10)
        self._tmp.cleanup()

    def _wait_health(self, port: int, timeout_s: float = 20.0) -> None:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/health", timeout=2
                ) as r:
                    if r.status == 200:
                        return
            except OSError:
                time.sleep(0.15)
        self.fail(f"gpu-worker :{port} no llegó a /health en {timeout_s}s")

    def test_round_robin_two_workers(self):
        prompts = ["tex uno", "tex dos", "tex tres", "tex cuatro"]
        # Round-robin del caller: w1, w2, w1, w2.
        routing = [self.ports[i % 2] for i in range(len(prompts))]
        results: list[dict | None] = [None] * len(prompts)

        def call(i: int) -> None:
            results[i] = _post_texture(routing[i], prompts[i])

        threads = [threading.Thread(target=call, args=(i,)) for i in range(len(prompts))]
        start = time.monotonic()
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        wall = time.monotonic() - start

        for i, res in enumerate(results):
            self.assertIsNotNone(res, f"request {i} sin respuesta")
            self.assertFalse(res["cached"], f"request {i} no debía estar cacheado")

        # (a) Enrutado: los blobs de cada worker viven en SU cache dir.
        for w, wdir in enumerate(self.dirs):
            expected = {results[i]["hash"] for i in range(len(prompts)) if i % 2 == w}
            on_disk = {p.name for p in (wdir / "textures").iterdir() if p.is_dir()}
            self.assertEqual(on_disk, expected, f"worker w{w + 1} sirvió otros prompts")

        # (b) Paralelismo inter-proceso: serial global sería ≈ 4×SLEEP_S.
        self.assertLess(wall, SLEEP_S * 3.75, f"sin paralelismo entre workers ({wall:.2f}s)")
        # (c) gpu_lock intra-worker: 2 requests por worker en secuencia.
        self.assertGreaterEqual(
            wall, SLEEP_S * 1.9, f"requests intra-worker corrieron a la vez ({wall:.2f}s)"
        )


if __name__ == "__main__":
    unittest.main()
