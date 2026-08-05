"""Tests de POST /segment (proceso remote-gen, F4) con FalSamClient fake:
wire de auto/boxes, orden e ids, 503 sin FAL_KEY, 502 en fallo fal — y el
string de config que ancla la clave de caché de los análisis (sam_model).

Requieren fastapi (TestClient); sin ella se saltan (el CI las ejecuta).

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v"""

import base64
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None


def _tiny_png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


class FakeFalSam:
    """Devuelve blobs deterministas y registra las llamadas."""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls: list[tuple] = []

    def auto_segment(self, data_uri: str) -> list[bytes]:
        self.calls.append(("auto", data_uri))
        if self.fail:
            raise RuntimeError("fal boom")
        return [b"mask-a", b"mask-b"]

    def segment_boxes(self, data_uri: str, boxes_xyxy: list) -> list[bytes]:
        self.calls.append(("boxes", data_uri, boxes_xyxy))
        if self.fail:
            raise RuntimeError("fal boom")
        return [f"mask-{i}".encode() for i in range(len(boxes_xyxy))]


@unittest.skipUnless(_HAS_FASTAPI, "fastapi no instalado")
class SegmentRouterTest(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers.segment import router

        self.deps = deps
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.image_b64 = base64.b64encode(_tiny_png()).decode()

    def tearDown(self):
        self.deps.fal_sam = None

    def test_auto_mode_ids_and_roundtrip(self):
        self.deps.fal_sam = FakeFalSam()
        r = self.client.post("/segment", json={"image_b64": self.image_b64, "mode": "auto"})
        self.assertEqual(r.status_code, 200)
        masks = r.json()["masks"]
        self.assertEqual([m["id"] for m in masks], ["auto_0", "auto_1"])
        self.assertEqual(base64.b64decode(masks[0]["mask_b64"]), b"mask-a")

    def test_boxes_mode_preserves_order_and_ids(self):
        fake = FakeFalSam()
        self.deps.fal_sam = fake
        r = self.client.post("/segment", json={
            "image_b64": self.image_b64,
            "mode": "boxes",
            "boxes": [
                {"id": "casa", "box_xyxy": [10.7, 20, 30, 40]},
                {"id": "arbol", "box_xyxy": [1, 2, 3, 4]},
            ],
        })
        self.assertEqual(r.status_code, 200)
        masks = r.json()["masks"]
        self.assertEqual([m["id"] for m in masks], ["casa", "arbol"])
        # Las cajas llegan a fal como enteros xyxy, mismo orden.
        self.assertEqual(fake.calls[0][2], [(10, 20, 30, 40), (1, 2, 3, 4)])

    def test_boxes_mode_validation(self):
        self.deps.fal_sam = FakeFalSam()
        r = self.client.post("/segment", json={"image_b64": self.image_b64, "mode": "boxes"})
        self.assertEqual(r.status_code, 422)
        r = self.client.post("/segment", json={
            "image_b64": self.image_b64,
            "mode": "boxes",
            "boxes": [
                {"id": "dup", "box_xyxy": [1, 2, 3, 4]},
                {"id": "dup", "box_xyxy": [5, 6, 7, 8]},
            ],
        })
        self.assertEqual(r.status_code, 422)
        self.assertIn("duplicados", r.json()["detail"])

    def test_no_fal_key_is_503(self):
        self.deps.fal_sam = None
        r = self.client.post("/segment", json={"image_b64": self.image_b64, "mode": "auto"})
        self.assertEqual(r.status_code, 503)
        self.assertIn("FAL_KEY", r.json()["detail"])

    def test_fal_failure_is_502(self):
        self.deps.fal_sam = FakeFalSam(fail=True)
        r = self.client.post("/segment", json={"image_b64": self.image_b64, "mode": "auto"})
        self.assertEqual(r.status_code, 502)
        self.assertIn("fal SAM2", r.json()["detail"])


class CacheKeyAnchorsTest(unittest.TestCase):
    """F4 cambió la fuente del `sam_model` de las claves de caché de los
    análisis (atributo del cliente in-process → config). Este golden ancla el
    string: si cambia, TODOS los análisis cacheados se invalidan — debe ser
    un acto deliberado, no un efecto colateral."""

    def test_auto_segment_model_golden(self):
        cfg_path = (
            Path(__file__).resolve().parent.parent.parent
            / "nefan-core" / "data" / "runtime_config.json"
        )
        cfg = json.loads(cfg_path.read_text())
        self.assertEqual(cfg["ai_server"]["auto_segment_model"], "fal-ai/sam2/auto-segment")


if __name__ == "__main__":
    unittest.main()
