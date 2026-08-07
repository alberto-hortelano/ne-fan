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
    _view_of,
    build_prompt,
    missing_categories,
    seed_for,
)
from style_packs import CHARACTER_CATEGORIES, ENV_CATEGORIES, STAGE_CATEGORIES  # noqa: E402


class BuilderTest(unittest.TestCase):
    def test_todas_las_categorias_tienen_escena(self):
        for cat in (*ENV_CATEGORIES, *CHARACTER_CATEGORIES, *STAGE_CATEGORIES):
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

    def test_prompt_de_plato_es_eye_level(self):
        for cat in STAGE_CATEGORIES:
            p = build_prompt(cat, "token", has_style_refs=False)
            self.assertIn("eye-level ground view", p)
            self.assertIn("blockout", p)
            self.assertNotIn("top-down", p)
            # Sin vocabulario teatral (el modelo pinta cortinas si se insinúa).
            self.assertIn("no curtains", p)

    def test_view_of_por_namespace(self):
        self.assertEqual(_view_of("stage_street"), "proscenium")
        self.assertEqual(_view_of("settlement"), "overworld")
        self.assertEqual(_view_of("character_noble"), "overworld")

    def test_seed_de_plato_sin_plantilla_es_error(self):
        # Fail-loud: sin la plantilla clay no hay encuadre que enseñar.
        categorias_sin_plantilla = [
            c for c in STAGE_CATEGORIES
            if not (Path(__file__).resolve().parents[2]
                    / "nefan-core" / "data" / "styles" / "_plantilla" / "proscenio"
                    / f"{c}.png").exists()
        ]
        for cat in categorias_sin_plantilla:
            with self.assertRaises(FileNotFoundError):
                seed_for(cat)

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
