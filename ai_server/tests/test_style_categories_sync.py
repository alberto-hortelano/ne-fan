"""Candado cross-language del enum de categorías de estilo.

La fuente única TS (nefan-core/src/games/style-categories.ts) emite
data/contract/style_categories.json vía `npm run gen:contract`; la fuente
única Python es ai_server/style_categories.py. Este test compara ambas: una
categoría, alias o entrada de ZONE_TO_STAGE añadida/retirada en un solo lado
rompe CI en vez de derivar en silencio (como pasó con la copia a mano StyleTag
de contracts/remote-gen.ts, que omitía las stage_* y arrastraba "nature").
"""
import json
import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from style_categories import (  # noqa: E402
    ALL_STYLE_TAGS,
    CHARACTER_CATEGORIES,
    ENV_CATEGORIES,
    FPS_CATEGORIES,
    LEGACY_ALIASES,
    STAGE_CATEGORIES,
    STYLE_TAG_PATTERN,
    ZONE_TO_STAGE,
)

ARTIFACT = (
    Path(__file__).resolve().parent.parent.parent
    / "nefan-core" / "data" / "contract" / "style_categories.json"
)


class TestStyleCategoriesSync(unittest.TestCase):
    def setUp(self) -> None:
        self.artifact = json.loads(ARTIFACT.read_text())

    def test_env_categories(self) -> None:
        self.assertEqual(list(ENV_CATEGORIES), self.artifact["env"])

    def test_character_categories(self) -> None:
        self.assertEqual(list(CHARACTER_CATEGORIES), self.artifact["character"])

    def test_stage_categories(self) -> None:
        self.assertEqual(list(STAGE_CATEGORIES), self.artifact["stage"])

    def test_fps_categories(self) -> None:
        self.assertEqual(list(FPS_CATEGORIES), self.artifact["fps"])

    def test_fps_not_in_style_tags(self) -> None:
        # fps_surfaces es una categoría de REF del pack, no un style_tag de
        # tile: no debe colarse en el vocabulario del wire.
        for cat in FPS_CATEGORIES:
            self.assertNotIn(cat, ALL_STYLE_TAGS)

    def test_legacy_aliases(self) -> None:
        self.assertEqual(LEGACY_ALIASES, self.artifact["legacy_aliases"])

    def test_zone_to_stage(self) -> None:
        self.assertEqual(ZONE_TO_STAGE, self.artifact["zone_to_stage"])

    def test_style_tag_pattern_accepts_exactly_all_tags(self) -> None:
        # El patrón Pydantic del wire (remote_generation.py) deriva de
        # ALL_STYLE_TAGS; verificamos que acepta exactamente el enum + "" y
        # rechaza valores fuera (canario del propio derive).
        rx = re.compile(STYLE_TAG_PATTERN)
        for tag in sorted(ALL_STYLE_TAGS) + [""]:
            self.assertIsNotNone(rx.match(tag), f"el patrón debería aceptar '{tag}'")
        for bad in ("nave", "stage_", "settlementx", "forest ", "character_noble"):
            self.assertIsNone(rx.match(bad), f"el patrón no debería aceptar '{bad}'")


if __name__ == "__main__":
    unittest.main()
