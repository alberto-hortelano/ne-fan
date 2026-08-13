"""Tests de validate_scene_response — fail-loud en la FORMA (espejo de
FormatDSceneSchema) + normalizaciones benignas conservadas.

Antes esta función no tenía tests y degradaba TODO en silencio (grid rellenado,
entities clampadas), así que un error de forma del modelo nunca le volvía. Aquí
se fija el contrato nuevo: lanza ValueError en lo estructural, normaliza lo
benigno, y NUNCA rechaza una escena real (el caso peligroso: rechazar tras el
pre-flight MCP).
"""
import json
import glob
import os
import unittest

from ai_server.narrative_schemas import validate_scene_response

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCENES = os.path.join(REPO, "nefan-core", "data", "scenes")


def base_scene():
    return {
        "scene_id": "s",
        "scene_description": "una escena de prueba",
        "size": {"cols": 4, "rows": 2, "meters_per_cell": 2},
        "terrain": ["gggg", "gggg"],
        "entities": [
            {"id": "p", "kind": "player", "name": "Tú", "cell": [1, 1], "footprint": [1, 1], "glyph": "@"}
        ],
    }


class TestSceneValidateAcceptsReal(unittest.TestCase):
    def test_real_scenes_do_not_raise(self):
        files = [os.path.join(SCENES, "robledo_village.json"), os.path.join(SCENES, "zorder_test.json")]
        files += sorted(glob.glob(os.path.join(SCENES, "proscenio", "*.json")))
        for f in files:
            with self.subTest(scene=os.path.basename(f)):
                with open(f) as fh:
                    data = json.load(fh)
                validate_scene_response(dict(data))  # no raise

    def test_base_scene_ok(self):
        out = validate_scene_response(base_scene())
        self.assertEqual(out["terrain"], ["gggg", "gggg"])
        self.assertEqual(len(out["entities"]), 1)


class TestSceneStageHook(unittest.TestCase):
    """El bloque stage de una escena proscenio pasa por validate_stage
    (fail-loud); un tile lo descarta con traza (jamás lleva stage)."""

    def test_bad_stage_raises(self):
        s = base_scene()
        s["stage"] = {"exits": []}  # sin exits → softlock
        with self.assertRaisesRegex(ValueError, "stage.exits"):
            validate_scene_response(s)

    def test_tile_drops_stage(self):
        s = base_scene()
        s.pop("size")
        s.pop("terrain")
        s["tile"] = {"tx": 0, "ty": 0}
        s["biome"] = "farmland"
        s["stage"] = {"exits": []}  # ni se valida: se descarta con traza
        out = validate_scene_response(s)
        self.assertNotIn("stage", out)


class TestSceneValidateFailLoud(unittest.TestCase):
    def test_terrain_row_wrong_width_raises(self):
        s = base_scene()
        s["terrain"] = ["gggg", "ggg"]  # 2ª fila corta (antes: padding silencioso)
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_terrain_wrong_row_count_raises(self):
        s = base_scene()
        s["terrain"] = ["gggg"]  # falta una fila (antes: relleno)
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_terrain_not_list_raises(self):
        s = base_scene()
        s["terrain"] = {"type": "grass"}  # esquema viejo (antes: → hierba)
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_missing_size_raises(self):
        s = base_scene()
        del s["size"]
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_tile_without_biome_raises(self):
        with self.assertRaises(ValueError):
            validate_scene_response({"scene_id": "t", "scene_description": "d", "tile": {"tx": 0, "ty": 0}, "entities": []})

    def test_entity_bad_kind_raises(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "monster", "name": "X", "cell": [0, 0], "footprint": [1, 1], "glyph": "x"}]
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_entity_missing_glyph_raises(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [0, 0], "footprint": [1, 1]}]
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_entity_bad_footprint_raises(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [0, 0], "footprint": [0, 1], "glyph": "x"}]
        with self.assertRaises(ValueError):
            validate_scene_response(s)


class TestSceneValidateBenign(unittest.TestCase):
    def test_missing_scene_id_defaults(self):
        s = base_scene()
        del s["scene_id"]
        out = validate_scene_response(s)
        self.assertTrue(out["scene_id"])  # se rellena (benigno)

    def test_glyph_colliding_with_terrain_is_reassigned(self):
        s = base_scene()
        # 'g' es char de terreno (grass); un entity con glyph 'g' recibe reserva.
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [0, 0], "footprint": [1, 1], "glyph": "g"}]
        out = validate_scene_response(s)
        self.assertNotEqual(out["entities"][0]["glyph"], "g")

    def test_cell_out_of_bounds_clamped(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [99, 99], "footprint": [1, 1], "glyph": "x"}]
        out = validate_scene_response(s)
        self.assertLess(out["entities"][0]["cell"][0], 4)  # clampado a cols


if __name__ == "__main__":
    unittest.main()
