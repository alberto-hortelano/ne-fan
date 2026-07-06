"""Tests del StylePackResolver: resolución por categoría con fallback,
degradación con packs incompletos y recarga por mtime."""
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image

from style_packs import StylePackResolver  # noqa: E402


def _write_jpg(path: Path, color: tuple[int, int, int]) -> None:
    img = Image.new("RGB", (64, 64), color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    path.write_bytes(buf.getvalue())


class StylePacksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.styles_dir = Path(self.tmp.name)
        d = self.styles_dir / "mi_estilo"
        d.mkdir()
        manifest = {
            "style_id": "mi_estilo",
            "name": "Mi estilo",
            "description": "desc",
            "style_token": "token de arte",
            "cover": "cover.jpg",
            "refs": [
                {"category": "nature", "file": "nature.jpg", "tags": []},
                {"category": "settlement", "file": "settlement.jpg", "tags": []},
                {"category": "character_commoner", "file": "character_commoner.jpg", "tags": []},
            ],
        }
        (d / "style.json").write_text(json.dumps(manifest), encoding="utf-8")
        _write_jpg(d / "nature.jpg", (10, 200, 10))
        # settlement declarado pero SIN archivo (pack incompleto)
        _write_jpg(d / "character_commoner.jpg", (200, 10, 10))
        self.resolver = StylePackResolver(styles_dir=self.styles_dir)

    def tearDown(self):
        self.tmp.cleanup()

    def test_resolve_categoria_directa(self):
        ref = self.resolver.resolve("mi_estilo", "nature")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "nature")
        self.assertEqual(ref.style_token, "token de arte")
        self.assertTrue(ref.data_uri.startswith("data:image/jpeg;base64,"))
        self.assertEqual(len(ref.content_hash), 12)

    def test_fallback_a_categoria_hermana(self):
        # settlement declarado sin archivo → cae a nature (siguiente del orden).
        ref = self.resolver.resolve("mi_estilo", "settlement")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "nature")

    def test_personaje_no_cae_a_entorno(self):
        ref = self.resolver.resolve("mi_estilo", "character_noble")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "character_commoner")

    def test_estilo_inexistente_degrada_a_none(self):
        self.assertIsNone(self.resolver.resolve("no_existe", "nature"))

    def test_pack_sin_imagenes_degrada_a_none(self):
        d = self.styles_dir / "vacio"
        d.mkdir()
        (d / "style.json").write_text(
            json.dumps({"style_id": "vacio", "style_token": "x", "refs": []}),
            encoding="utf-8",
        )
        self.assertIsNone(self.resolver.resolve("vacio", "nature"))

    def test_recarga_por_mtime(self):
        ref1 = self.resolver.resolve("mi_estilo", "nature")
        path = self.styles_dir / "mi_estilo" / "nature.jpg"
        _write_jpg(path, (10, 10, 200))
        os.utime(path, (path.stat().st_atime, path.stat().st_mtime + 10))
        ref2 = self.resolver.resolve("mi_estilo", "nature")
        self.assertNotEqual(ref1.content_hash, ref2.content_hash)


if __name__ == "__main__":
    unittest.main()
