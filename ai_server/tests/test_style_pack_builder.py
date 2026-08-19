"""Tests de las partes puras del builder de style packs (sin API)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from style_pack_builder import (  # noqa: E402
    PLANTILLA_DIR,
    build_prompt,
    missing_refs,
    seed_for,
)


def _ref(id: str, file: str, description: str = "algo", **extra) -> dict:
    return {"id": id, "file": file, "description": description, **extra}


class BuilderTest(unittest.TestCase):
    def test_build_prompt_texto_vs_refs(self):
        ref = _ref("bosque", "overworld/bosque.jpg", "un bosque",
                   gen_scene="a wild forest with NO buildings")
        solo_texto = build_prompt(ref, "acuarela luminosa", has_style_refs=False)
        self.assertIn("Art style: acuarela luminosa", solo_texto)
        self.assertIn("top-down", solo_texto)
        # Oblicua CON CARAS: los volúmenes pintan cara sur y cara este.
        self.assertIn("SOUTH face", solo_texto)
        self.assertIn("EAST side face", solo_texto)
        self.assertIn("a wild forest", solo_texto)
        con_refs = build_prompt(ref, "", has_style_refs=True)
        self.assertIn("EXACT art style", con_refs)
        # Personajes: model sheet (mismo personaje en 3 vistas), no mapa.
        char = build_prompt(
            _ref("noble", "characters/noble.jpg", "una noble"), "x", has_style_refs=False,
        )
        self.assertIn("model sheet", char)
        self.assertIn("front view", char)
        self.assertNotIn("top-down", char)

    def test_gen_scene_manda_y_description_es_fallback(self):
        con_gen = build_prompt(
            _ref("x", "overworld/x.jpg", "una catedral", gen_scene="a gothic cathedral"),
            "t", False,
        )
        self.assertIn("a gothic cathedral", con_gen)
        self.assertNotIn("una catedral", con_gen)
        sin_gen = build_prompt(_ref("x", "overworld/x.jpg", "una catedral"), "t", False)
        self.assertIn("una catedral", sin_gen)
        with self.assertRaises(ValueError):
            build_prompt({"id": "x", "file": "overworld/x.jpg"}, "t", False)

    def test_prompt_de_plato_es_eye_level(self):
        p = build_prompt(
            _ref("calle", "proscenium/calle.jpg", "una calle"), "token", has_style_refs=False,
        )
        self.assertIn("eye-level ground view", p)
        self.assertIn("blockout", p)
        self.assertNotIn("top-down", p)
        # Sin vocabulario teatral (el modelo pinta cortinas si se insinúa).
        self.assertIn("no curtains", p)

    def test_prompt_de_lamina_es_atlas(self):
        p = build_prompt(
            _ref("fps_surfaces", "fps/surfaces.jpg", "lámina", role="fps_surfaces"),
            "token", has_style_refs=False,
        )
        self.assertIn("TEXTURE ATLAS SHEET", p)
        self.assertIn("grid layout EXACTLY", p)

    def test_seed_declarado_manda_y_ausente_es_error(self):
        # Los seeds de los packs migrados existen en _plantilla.
        ref = _ref("settlement", "overworld/settlement.jpg",
                   seed="overworld/settlement.png")
        self.assertEqual(seed_for(ref), PLANTILLA_DIR / "overworld" / "settlement.png")
        with self.assertRaises(FileNotFoundError):
            seed_for(_ref("x", "overworld/x.jpg", seed="overworld/no_existe.png"))

    def test_seed_default_por_vista(self):
        # Ref libre sin seed: default.png de su carpeta (creados en la
        # migración); characters usa el frame y_bot.
        self.assertEqual(
            seed_for(_ref("catedral", "overworld/catedral.jpg")),
            PLANTILLA_DIR / "overworld" / "default.png",
        )
        self.assertEqual(
            seed_for(_ref("calle", "proscenium/calle.jpg")),
            PLANTILLA_DIR / "proscenium" / "default.png",
        )
        self.assertTrue(str(seed_for(_ref("p", "characters/p.jpg"))).endswith(
            "dir_0_frame_000.png"))

    def test_missing_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "mi_estilo"
            (d / "overworld").mkdir(parents=True)
            (d / "style.json").write_text(json.dumps({
                "style_id": "mi_estilo",
                "style_token": "x",
                "cover": "cover.jpg",
                "tags": ["x"],
                "refs": [
                    _ref("bosque", "overworld/bosque.jpg", "un bosque"),
                    _ref("catedral", "overworld/catedral.jpg", "una catedral"),
                ],
            }), encoding="utf-8")
            (d / "overworld" / "bosque.jpg").write_bytes(b"fake")
            self.assertEqual(
                missing_refs(Path(tmp), "mi_estilo"),
                [{"id": "catedral", "view": "overworld", "description": "una catedral"}],
            )


if __name__ == "__main__":
    unittest.main()
