"""Tests del proceso gpu-worker (F3) en modo mock: /health y wire de
/generate_texture (miss → generado, hit → cached).

Requieren fastapi (TestClient); en entornos sin ella se saltan — el CI las
ejecuta (fastapi/uvicorn en el pip install del job ai-server).

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v"""

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None


@unittest.skipUnless(_HAS_FASTAPI, "fastapi no instalado")
class GpuWorkerAppTest(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient

        self._tmp = tempfile.TemporaryDirectory()
        os.environ["NEFAN_GPU_MOCK"] = self._tmp.name
        os.environ["NEFAN_GPU_WORKER_ID"] = "test_worker"
        os.environ["NEFAN_GPU_MOCK_SLEEP"] = "0"
        import gpu_worker_main  # noqa: F401 — registra la app

        self._client_ctx = TestClient(gpu_worker_main.app)
        self.client = self._client_ctx.__enter__()  # dispara el lifespan

    def tearDown(self):
        from deps import deps

        self._client_ctx.__exit__(None, None, None)
        for key in ("NEFAN_GPU_MOCK", "NEFAN_GPU_WORKER_ID", "NEFAN_GPU_MOCK_SLEEP"):
            os.environ.pop(key, None)
        # deps es un singleton de proceso: limpiar lo que pobló el mock para
        # no contaminar otros tests del mismo run.
        deps.texture_gen = None
        deps.asset_cache = None
        deps.config = {}
        self._tmp.cleanup()

    def test_health_shape(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.json(),
            {"status": "ready", "texture_pipeline": "loaded", "model_backend": "none"},
        )

    def test_generate_texture_roundtrip(self):
        r = self.client.post("/generate_texture", json={"prompt": "mossy stone"})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        # Hash de oro de test_asset_cache: el worker usa el MISMO hash_key.
        self.assertEqual(body["hash"], "9399046b017da1e2")
        self.assertFalse(body["cached"])
        self.assertEqual(body["albedo_url"], "/cache/albedo/9399046b017da1e2")
        # El blob queda en disco (mock: cache local sin registro en el store).
        blob = Path(self._tmp.name) / "textures" / "9399046b017da1e2" / "albedo.png"
        self.assertTrue(blob.exists())
        self.assertIn(b"test_worker", blob.read_bytes())

        again = self.client.post("/generate_texture", json={"prompt": "mossy stone"}).json()
        self.assertTrue(again["cached"])
        self.assertEqual(again["hash"], body["hash"])

    def test_bad_base64_is_400(self):
        # Re-anclado dos veces: este ejercicio de `decode_b64_png` colgaba de
        # /peel_scene_layer (plató) y luego de /inpaint_scene_plate (placa LaMa
        # del repintado oblicuo). Los dos endpoints murieron con sus pipelines,
        # pero el decodificador lo comparten los routers vivos y su fail-loud
        # sigue siendo contrato: un base64 roto es 400, nunca una imagen vacía
        # en silencio.
        from fastapi import HTTPException

        from request_util import decode_b64_png

        self.assertEqual(decode_b64_png("aGk="), b"hi")
        self.assertEqual(decode_b64_png("data:image/png;base64,aGk="), b"hi")
        with self.assertRaises(HTTPException) as cm:
            decode_b64_png("no es base64!!")
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIn("invalid base64", cm.exception.detail)


if __name__ == "__main__":
    unittest.main()
