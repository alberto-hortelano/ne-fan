"""Tests de las partes puras del builder de style packs (sin API)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from style_pack_builder import (  # noqa: E402
    CATEGORY_SCENES,
    build_prompt,
    missing_categories,
)
from style_packs import CHARACTER_CATEGORIES, ENV_CATEGORIES  # noqa: E402


class BuilderTest(unittest.TestCase):
    def test_todas_las_categorias_tienen_escena(self):
        for cat in (*ENV_CATEGORIES, *CHARACTER_CATEGORIES):
            self.assertIn(cat, CATEGORY_SCENES)

    def test_build_prompt_texto_vs_refs(self):
        solo_texto = build_prompt("forest", "acuarela luminosa", has_style_refs=False)
        self.assertIn("Art style: acuarela luminosa", solo_texto)
        self.assertIn("top-down", solo_texto)
        # Oblicua CON CARAS: los volúmenes pintan cara sur y cara este.
        self.assertIn("SOUTH face", solo_texto)
        self.assertIn("EAST side face", solo_texto)
        con_refs = build_prompt("forest", "", has_style_refs=True)
        self.assertIn("EXACT art style", con_refs)
        # Alias legacy: "nature" sigue generando (como forest).
        self.assertEqual(con_refs, build_prompt("nature", "", has_style_refs=True))
        # Personajes: model sheet (mismo personaje en 3 vistas), no mapa.
        char = build_prompt("character_noble", "x", has_style_refs=False)
        self.assertIn("model sheet", char)
        self.assertIn("front view", char)
        self.assertNotIn("top-down", char)

    def test_prompt_cabe_en_el_limite(self):
        # Todos los prompts caben de sobra en el límite i2i (2000).
        for cat in CATEGORY_SCENES:
            self.assertLess(len(build_prompt(cat, "token largo " * 10, True)), 2000)

    def test_escenas_de_zona_con_transiciones(self):
        # Las zonas salvajes piden senda de tierra (nunca empedrado) y el
        # empedrado queda confinado a la plaza urbana.
        self.assertIn("cobblestone paving ONLY", CATEGORY_SCENES["settlement"])
        for cat in ("forest", "wetland", "desert", "snow"):
            self.assertIn("NO buildings", CATEGORY_SCENES[cat])
            self.assertIn("blending into", CATEGORY_SCENES[cat])

    def test_missing_categories(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "mi_estilo"
            d.mkdir()
            (d / "style.json").write_text(json.dumps({
                "style_id": "mi_estilo",
                "style_token": "x",
                "cover": "cover.jpg",
                "refs": [
                    {"category": "forest", "file": "forest.jpg"},
                    # Entrada legacy iso: NO cuenta como pendiente.
                    {"category": "forest", "file": "forest_iso.jpg",
                     "perspective": "isometric"},
                    {"category": "settlement", "file": "settlement.jpg"},
                ],
            }), encoding="utf-8")
            (d / "forest.jpg").write_bytes(b"fake")
            self.assertEqual(
                missing_categories(Path(tmp), "mi_estilo"),
                ["settlement"],
            )


if __name__ == "__main__":
    unittest.main()
