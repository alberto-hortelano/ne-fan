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
        ref = _ref("fachada", "faces/fachada.jpg", "una fachada",
                   gen_scene="a timber-framed house front")
        solo_texto = build_prompt(ref, "acuarela luminosa", has_style_refs=False)
        self.assertIn("Art style: acuarela luminosa", solo_texto)
        self.assertIn("a timber-framed house front", solo_texto)
        con_refs = build_prompt(ref, "", has_style_refs=True)
        self.assertIn("EXACT art style", con_refs)
        # Personajes: model sheet (mismo personaje en 3 vistas), no una cara.
        char = build_prompt(
            _ref("noble", "characters/noble.jpg", "una noble"), "x", has_style_refs=False,
        )
        self.assertIn("model sheet", char)
        self.assertIn("front view", char)
        self.assertNotIn("architectural face", char)

    def test_gen_scene_manda_y_description_es_fallback(self):
        con_gen = build_prompt(
            _ref("x", "faces/x.jpg", "una catedral", gen_scene="a gothic cathedral"),
            "t", False,
        )
        self.assertIn("a gothic cathedral", con_gen)
        self.assertNotIn("una catedral", con_gen)
        sin_gen = build_prompt(_ref("x", "faces/x.jpg", "una catedral"), "t", False)
        self.assertIn("una catedral", sin_gen)
        with self.assertRaises(ValueError):
            build_prompt({"id": "x", "file": "faces/x.jpg"}, "t", False)

    def test_ref_fuera_de_carpeta_es_error(self):
        # Sin carpeta no hay rol, y sin rol no hay encuadre que aplicar: eso
        # es fail-loud, no "pinta algo genérico".
        with self.assertRaises(ValueError):
            build_prompt(_ref("x", "x.jpg", "algo"), "t", False)
        with self.assertRaises(ValueError):
            build_prompt(_ref("x", "overworld/x.jpg", "algo"), "t", False)

    def test_ref_de_cara_es_cara_no_rejilla(self):
        p = build_prompt(
            _ref("fachada", "faces/fachada.jpg", "fachada de casa",
                 gen_scene="a house facade with door and windows"),
            "token", has_style_refs=False,
        )
        self.assertIn("ONE architectural face", p)
        self.assertIn("framing guide", p)
        self.assertNotIn("TEXTURE ATLAS SHEET", p)

    def test_prompt_de_lamina_es_atlas(self):
        p = build_prompt(
            _ref("fps_surfaces", "surfaces/surfaces.jpg", "lámina"),
            "token", has_style_refs=False,
        )
        self.assertIn("TEXTURE ATLAS SHEET", p)
        self.assertIn("grid layout EXACTLY", p)
        self.assertNotIn("architectural face", p)

    def test_seed_default_por_carpeta(self):
        # Cada carpeta tiene SU default y no son intercambiables: la rejilla
        # de swatches sería un seed nefasto para una fachada.
        self.assertEqual(
            seed_for(_ref("fachada", "faces/fachada.jpg", "fachada")),
            PLANTILLA_DIR / "faces" / "default.png",
        )
        self.assertEqual(
            seed_for(_ref("fps_surfaces", "surfaces/surfaces.jpg", "lámina")),
            PLANTILLA_DIR / "surfaces" / "default.png",
        )
        self.assertTrue(str(seed_for(_ref("p", "characters/p.jpg"))).endswith(
            "dir_0_frame_000.png"))
        # Las plantillas existen de verdad en el repo (si no, el builder
        # falla en la primera llamada de pago, no aquí).
        for folder in ("surfaces", "faces"):
            self.assertTrue((PLANTILLA_DIR / folder / "default.png").exists(), folder)

    def test_seed_declarado_manda_y_ausente_es_error(self):
        ref = _ref("fps_surfaces", "surfaces/surfaces.jpg", seed="surfaces/default.png")
        self.assertEqual(seed_for(ref), PLANTILLA_DIR / "surfaces" / "default.png")
        with self.assertRaises(FileNotFoundError):
            seed_for(_ref("x", "faces/x.jpg", seed="faces/no_existe.png"))

    def test_missing_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / "mi_estilo"
            (d / "faces").mkdir(parents=True)
            (d / "style.json").write_text(json.dumps({
                "style_id": "mi_estilo",
                "style_token": "x",
                "cover": "cover.jpg",
                "tags": ["x"],
                "refs": [
                    _ref("fachada", "faces/fachada.jpg", "una fachada"),
                    _ref("catedral", "faces/catedral.jpg", "una catedral"),
                ],
            }), encoding="utf-8")
            (d / "faces" / "fachada.jpg").write_bytes(b"fake")
            self.assertEqual(
                missing_refs(Path(tmp), "mi_estilo"),
                [{"id": "catedral", "folder": "faces", "description": "una catedral"}],
            )


if __name__ == "__main__":
    unittest.main()
