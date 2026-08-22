"""Tests del SpendTracker (contador de gasto del panel de dev) y del endpoint
agregado GET /dev/status.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from spend_tracker import SpendTracker  # noqa: E402


class SpendTrackerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.spend = SpendTracker(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_empty_status(self):
        st = self.spend.status()
        self.assertEqual(st, {"total_usd": 0.0, "call_count": 0, "calls": []})
        self.assertEqual(self.spend.total_usd(), 0.0)

    def test_add_accumulates(self):
        self.spend.add(0.17, "plató posada", "remote-gen")
        self.spend.add(0.18, "tile 0,1", "remote-gen")
        self.spend.add(0.03, "peel: mesa", "gpu-worker")
        st = self.spend.status()
        self.assertEqual(st["call_count"], 3)
        self.assertAlmostEqual(st["total_usd"], 0.38, places=4)
        self.assertEqual(st["calls"][0]["what"], "plató posada")
        self.assertEqual(st["calls"][2]["service"], "gpu-worker")
        self.assertIn("t", st["calls"][0])

    def test_status_limit_keeps_latest(self):
        for i in range(20):
            self.spend.add(0.01, f"call-{i}", "remote-gen")
        st = self.spend.status(limit=5)
        self.assertEqual(st["call_count"], 20)
        self.assertEqual(len(st["calls"]), 5)
        self.assertEqual(st["calls"][-1]["what"], "call-19")

    def test_multi_instance_shares_file(self):
        """Los 3 procesos comparten cache/spend/ por disco (append-only):
        una instancia ve lo que otra escribió, sin IPC."""
        other = SpendTracker(Path(self._tmp.name))
        self.spend.add(0.17, "a", "remote-gen")
        other.add(0.03, "b", "gpu-worker")
        self.assertAlmostEqual(self.spend.total_usd(), 0.20, places=4)
        self.assertEqual(other.status()["call_count"], 2)


class DevStatusEndpointTest(unittest.TestCase):
    def test_dev_status_shape(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers.cache_assets import router

        app = FastAPI()
        app.include_router(router)
        old_config = deps.config
        deps.config = {
            "surface_model": "nano-banana-pro",
            "sprite_skin_model": "gpt-image-2",
            "usd_eur_rate": 0.86,
        }
        try:
            res = TestClient(app).get("/dev/status")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertIn("enabled", body["api_cache"])
            self.assertIn("total_usd", body["spend"])
            self.assertEqual(body["config"]["usd_eur_rate"], 0.86)
            self.assertIn("meshy", body["keys"])
            self.assertIsInstance(body["keys"]["fal"], bool)
        finally:
            deps.config = old_config

    def test_dev_status_fails_loud_without_config(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers.cache_assets import router

        app = FastAPI()
        app.include_router(router)
        old_config = deps.config
        deps.config = {}
        try:
            self.assertEqual(TestClient(app).get("/dev/status").status_code, 503)
            # Snapshot viejo sin usd_eur_rate: error explícito, no KeyError.
            deps.config = {"surface_model": "x", "sprite_skin_model": "z"}
            res = TestClient(app).get("/dev/status")
            self.assertEqual(res.status_code, 500)
            self.assertIn("usd_eur_rate", res.json()["detail"])
        finally:
            deps.config = old_config


if __name__ == "__main__":
    unittest.main()
