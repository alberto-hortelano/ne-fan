"""Candado anti-divergencia del contrato narrativo (lado Python).

Ejecuta las fixtures compartidas de nefan-core/data/contract/fixtures/ contra
los validadores de narrative_schemas. El MISMO set lo ejecuta nefan-core con
los validadores espejo TS de narrative-mcp (test/contract-fixtures.test.ts):
si alguien endurece o relaja un lado sin el otro, uno de los dos suites rompe
en CI en vez de divergir en silencio.
"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from narrative_schemas import (  # noqa: E402
    validate_ground,
    validate_volumes,
    validate_narrative_reaction,
    validate_scene_response,
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


def contenido_en(esperado, obtenido, ruta: str):
    """¿Está `esperado` contenido en `obtenido`? Espejo literal de `contenidoEn`
    (nefan-core/test/contract-fixtures.test.ts): objeto por claves, array por
    índice con la MISMA longitud, escalar por igualdad. Devuelve el motivo del
    primer desajuste o None.

    Subconjunto y no igualdad profunda porque este saneador NORMALIZA
    (`position_hint` y `trigger` salen con su defecto) y el zod no: exigir
    igualdad obligaría a escribir dos ficheros distintos para las dos vías, que
    es justo lo que las fixtures compartidas existen para evitar.
    """
    if isinstance(esperado, list):
        if not isinstance(obtenido, list):
            return f"{ruta}: esperaba una lista, obtuve {obtenido!r}"
        if len(esperado) != len(obtenido):
            return f"{ruta}: la lista tiene {len(obtenido)} elemento(s) y `sobrevive` declara {len(esperado)}"
        for i, (e, o) in enumerate(zip(esperado, obtenido, strict=True)):
            fallo = contenido_en(e, o, f"{ruta}[{i}]")
            if fallo:
                return fallo
        return None
    if isinstance(esperado, dict):
        if not isinstance(obtenido, dict):
            return f"{ruta}: esperaba un objeto, obtuve {obtenido!r}"
        for k, v in esperado.items():
            if k not in obtenido:
                return f"{ruta}.{k}: NO SOBREVIVE al saneador (el campo se cae en silencio)"
            fallo = contenido_en(v, obtenido[k], f"{ruta}.{k}")
            if fallo:
                return fallo
        return None
    return None if esperado == obtenido else (
        f"{ruta}: sale {obtenido!r} y `sobrevive` declara {esperado!r}"
    )


def accepts_scene(payload) -> bool:
    try:
        validate_scene_response(copy.deepcopy(payload))
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

    def test_reaction_sobrevive(self):
        """EL CAMPO LLEGA VIVO, que no es lo mismo que pasar el gate (#532).

        Éste es el candado que cazaba el drop silencioso: hasta aquí las dos
        suites comparaban accept/reject, así que un campo declarado en el zod y
        ausente de la allow-list de este saneador salía VERDE en las dos y
        moría en el wire — medido con `footprint`, y ya había pasado con `role`
        y `style_ref` (#397). La totalidad (que todo campo del tool tenga una
        fixture con `sobrevive`) la vigila el lado TS, que corre en
        `npm run verify`; aquí se comprueba la SUPERVIVENCIA, que es lo que
        este proceso puede romper.
        """
        for name, fx in load_fixtures("reaction"):
            if "sobrevive" not in fx:
                continue
            with self.subTest(fixture=name):
                self.assertEqual(
                    fx["expect"],
                    "accept",
                    f"reaction/{name}: `sobrevive` solo tiene sentido en una fixture que se acepta",
                )
                salida = validate_narrative_reaction(copy.deepcopy(fx["payload"]))
                fallo = contenido_en(fx["sobrevive"], salida, "salida")
                self.assertIsNone(
                    fallo,
                    f"reaction/{name}: {fallo} — lo que el contrato declara tiene que LLEGAR, no "
                    "solo pasar el gate. Si el campo ya no viaja, quítalo del zod y de la fixture; "
                    "si viaja, arregla la allow-list de validate_narrative_reaction.",
                )

    def test_scene(self):
        """Escena Format D: espejo de EmittedSceneSchema (el gate del
        pre-flight MCP). Es el set que sujeta el VOCABULARIO de `role` — el zod
        con `z.enum(NPC_ROLES)`, este saneador leyendo el enum del tool — para
        que no vuelvan a separarse sin que nadie se entere. `copy.deepcopy`
        porque validate_scene_response MUTA lo que recibe."""
        self._run("scene", lambda fx: accepts_scene(fx["payload"]))


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
