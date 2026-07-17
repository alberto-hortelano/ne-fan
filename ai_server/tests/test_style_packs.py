"""Tests del StylePackResolver: resolución por categoría con fallback por
vecindad de zona, alias legacy (nature→forest), degradación con packs
incompletos y recarga por mtime."""
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image

from style_packs import ENV_CATEGORIES, StylePackResolver  # noqa: E402


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
                {"category": "forest", "file": "forest.jpg", "tags": []},
                # Entrada legacy de la era de dos proyecciones: se IGNORA.
                {"category": "forest", "file": "forest_iso.jpg", "tags": [],
                 "perspective": "isometric"},
                {"category": "settlement", "file": "settlement.jpg", "tags": []},
                # snow SOLO como entrada legacy iso ⇒ para el resolver NO existe.
                {"category": "snow", "file": "snow_iso.jpg", "tags": [],
                 "perspective": "isometric"},
                {"category": "character_commoner", "file": "character_commoner.jpg", "tags": []},
            ],
        }
        (d / "style.json").write_text(json.dumps(manifest), encoding="utf-8")
        _write_jpg(d / "forest.jpg", (10, 200, 10))
        _write_jpg(d / "forest_iso.jpg", (10, 100, 60))
        _write_jpg(d / "snow_iso.jpg", (220, 220, 250))
        # settlement declarado pero SIN archivo (pack incompleto)
        _write_jpg(d / "character_commoner.jpg", (200, 10, 10))
        self.resolver = StylePackResolver(styles_dir=self.styles_dir)

    def tearDown(self):
        self.tmp.cleanup()

    def test_resolve_categoria_directa(self):
        ref = self.resolver.resolve("mi_estilo", "forest")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "forest")
        self.assertEqual(ref.style_token, "token de arte")
        self.assertTrue(ref.data_uri.startswith("data:image/jpeg;base64,"))
        self.assertEqual(len(ref.content_hash), 12)

    def test_fallback_por_vecindad(self):
        # settlement declarado sin archivo → recorre su cadena de vecinos
        # (farmland, fortress... ausentes) hasta forest, la única con imagen.
        ref = self.resolver.resolve("mi_estilo", "settlement")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "forest")

    def test_entradas_iso_legacy_se_ignoran(self):
        # snow solo existe como entrada legacy "isometric": el resolver no la
        # sirve — cae por la cadena de vecinos hasta forest.
        ref = self.resolver.resolve("mi_estilo", "snow")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "forest")

    def test_alias_legacy_en_peticion(self):
        # Una escena vieja con style_tag "nature" resuelve a forest.
        ref = self.resolver.resolve("mi_estilo", "nature")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "forest")

    def test_alias_legacy_en_manifest(self):
        # Un pack anterior al set de zonas (category "nature") sigue sirviendo
        # su imagen cuando se pide forest.
        d = self.styles_dir / "viejo"
        d.mkdir()
        (d / "style.json").write_text(
            json.dumps({
                "style_id": "viejo",
                "style_token": "t",
                "refs": [{"category": "nature", "file": "nature.jpg", "tags": []}],
            }),
            encoding="utf-8",
        )
        _write_jpg(d / "nature.jpg", (5, 100, 5))
        ref = self.resolver.resolve("viejo", "forest")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "forest")

    def test_categoria_desconocida_usa_settlement(self):
        # Fail-soft con aviso: categoría fuera del enum usa la cadena de
        # settlement (que aquí degrada hasta forest).
        ref = self.resolver.resolve("mi_estilo", "volcano")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "forest")

    def test_cadenas_cubren_todas_las_zonas(self):
        # Cada categoría de entorno alcanza cualquier otra por su cadena.
        from style_packs import _ENV_FALLBACK
        for cat in ENV_CATEGORIES:
            chain = {cat, *_ENV_FALLBACK[cat]}
            self.assertEqual(chain, set(ENV_CATEGORIES), f"cadena incompleta: {cat}")

    def test_personaje_no_cae_a_entorno(self):
        ref = self.resolver.resolve("mi_estilo", "character_noble")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.category, "character_commoner")

    def test_estilo_inexistente_degrada_a_none(self):
        self.assertIsNone(self.resolver.resolve("no_existe", "forest"))

    def test_pack_sin_imagenes_degrada_a_none(self):
        d = self.styles_dir / "vacio"
        d.mkdir()
        (d / "style.json").write_text(
            json.dumps({"style_id": "vacio", "style_token": "x", "refs": []}),
            encoding="utf-8",
        )
        self.assertIsNone(self.resolver.resolve("vacio", "forest"))

    def test_recarga_por_mtime(self):
        ref1 = self.resolver.resolve("mi_estilo", "forest")
        path = self.styles_dir / "mi_estilo" / "forest.jpg"
        _write_jpg(path, (10, 10, 200))
        os.utime(path, (path.stat().st_atime, path.stat().st_mtime + 10))
        ref2 = self.resolver.resolve("mi_estilo", "forest")
        self.assertNotEqual(ref1.content_hash, ref2.content_hash)


if __name__ == "__main__":
    unittest.main()
