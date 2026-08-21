"""Candado anti-divergencia del contrato narrativo (lado Python).

Ejecuta las fixtures compartidas de nefan-core/data/contract/fixtures/ contra
los validadores de narrative_schemas. El MISMO set lo ejecuta nefan-core con
los validadores espejo TS de narrative-mcp (test/contract-fixtures.test.ts):
si alguien endurece o relaja un lado sin el otro, uno de los dos suites rompe
en CI en vez de divergir en silencio.
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from narrative_schemas import (  # noqa: E402
    validate_blueprint_review,
    validate_ground,
    validate_image_review,
    validate_volumes,
    validate_narrative_reaction,
    validate_scene_classify_response,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "nefan-core" / "data" / "contract" / "fixtures"


def load_fixtures(kind: str):
    out = []
    for verdict in ("valid", "invalid"):
        for path in sorted((FIXTURES_DIR / kind / verdict).glob("*.json")):
            with open(path, encoding="utf-8") as f:
                out.append((f"{verdict}/{path.name}", json.load(f)))
    if not out:
        raise AssertionError(f"sin fixtures para {kind}")
    return out


def accepts_reaction(payload) -> bool:
    try:
        validate_narrative_reaction(payload)
        return True
    except ValueError:
        return False


def accepts_blueprint(payload) -> bool:
    try:
        validate_blueprint_review(payload)
        return True
    except ValueError:
        return False


def accepts_classify(payload, expected_indices) -> bool:
    return validate_scene_classify_response(payload, expected_indices) is not None


def accepts_image_review(payload) -> bool:
    try:
        validate_image_review(payload)
        return True
    except ValueError:
        return False


class TestContractFixtures(unittest.TestCase):
    def _run(self, kind: str, accepts):
        for name, fx in load_fixtures(kind):
            with self.subTest(kind=kind, fixture=name):
                expected = fx["expect"] == "accept"
                got = accepts(fx)
                self.assertEqual(
                    got,
                    expected,
                    f"{kind}/{name}: esperaba {fx['expect']} — {fx['description']}. "
                    "Si el cambio de regla es intencional, actualiza el validador TS "
                    "de narrative-mcp Y la fixture.",
                )

    def test_reaction(self):
        self._run("reaction", lambda fx: accepts_reaction(fx["payload"]))

    def test_blueprint_review(self):
        self._run("blueprint_review", lambda fx: accepts_blueprint(fx["payload"]))

    def test_scene_classify(self):
        self._run(
            "scene_classify",
            lambda fx: accepts_classify(fx["payload"], fx.get("expected_indices")),
        )

    def test_image_review(self):
        self._run("image_review", lambda fx: accepts_image_review(fx["payload"]))

    def test_ground_plan(self):
        """Plan de suelo declarativo: espejo de parseGround (nefan-core, zod)."""
        for name, fx in load_fixtures("ground_plan"):
            with self.subTest(fixture=name):
                raw = fx["payload"]["ground"]
                result = validate_ground(
                    [dict(f) if isinstance(f, dict) else f for f in raw]
                    if isinstance(raw, list) else raw
                )
                expected = fx["expect"] == "accept"
                self.assertEqual(
                    result is not None and result == raw,
                    expected,
                    f"ground_plan/{name}: esperaba {fx['expect']} — {fx['description']}. "
                    "Si el cambio es intencional, actualiza parseGround (nefan-core) "
                    "Y la fixture.",
                )

    def test_volumes_plan(self):
        """Volúmenes: el MCP rechaza estricto (fail-loud + re-responder); el
        saneador Python es la última red para el camino API — el candado aquí
        es que NO descarte ni un item de una fixture válida, y que en las
        inválidas detecte el problema (descartaría ≥1)."""
        for name, fx in load_fixtures("volumes_plan"):
            with self.subTest(fixture=name):
                raw = fx["payload"]["volumes"]
                clean = validate_volumes([dict(v) for v in raw])
                # Igualdad profunda: un item DESCARTADO o un campo SANEADO
                # (p.ej. angle fuera de rango eliminado) cuentan como detección.
                intact = clean is not None and clean == raw
                expected = fx["expect"] == "accept"
                self.assertEqual(
                    intact,
                    expected,
                    f"volumes_plan/{name}: esperaba {fx['expect']} — {fx['description']}. "
                    "Si el cambio de regla es intencional, actualiza validateVolumes "
                    "(narrative-mcp) Y la fixture.",
                )


if __name__ == "__main__":
    unittest.main()
