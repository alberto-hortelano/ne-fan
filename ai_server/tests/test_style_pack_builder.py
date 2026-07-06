"""Tests de las partes puras del builder de style packs (sin API)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from style_pack_builder import CATEGORY_SCENES, build_prompt, missing_categories  # noqa: E402
from style_packs import CHARACTER_CATEGORIES, ENV_CATEGORIES  # noqa: E402


class BuilderTest(unittest.TestCase):
    def test_todas_las_categorias_tienen_escena(self):
        for cat in (*ENV_CATEGORIES, *CHARACTER_CATEGORIES):
            self.assertIn(cat, CATEGORY_SCENES)

    def test_build_prompt_texto_vs_refs(self):
        solo_texto = build_prompt("nature", "acuarela luminosa", has_style_refs=False)
        self.assertIn("Art style: acuarela luminosa", solo_texto)
        self.assertIn("top-down", solo_texto)
        con_refs = build_prompt("nature", "", has_style_refs=True)
        self.assertIn("EXACT art style", con_refs)
        # Personajes usan encuadre de personaje, no de mapa.
        char = build_prompt("character_noble", "x", has_style_refs=False)
        self.assertIn("full body character", char)
        self.assertNotIn("top-down", char)
        # Todos los prompts caben de sobra en el límite i2i (2000).
        for cat in CATEGORY_SCENES:
            self.assertLess(len(build_prompt(cat, "token largo " * 10, True)), 2000)

    def test_missing_categories(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "mi_estilo"
            d.mkdir()
            (d / "style.json").write_text(json.dumps({
                "style_id": "mi_estilo",
                "style_token": "x",
                "cover": "cover.jpg",
                "refs": [
                    {"category": "nature", "file": "nature.jpg"},
                    {"category": "settlement", "file": "settlement.jpg"},
                ],
            }), encoding="utf-8")
            (d / "nature.jpg").write_bytes(b"fake")
            self.assertEqual(missing_categories(Path(tmp), "mi_estilo"), ["settlement"])


if __name__ == "__main__":
    unittest.main()
