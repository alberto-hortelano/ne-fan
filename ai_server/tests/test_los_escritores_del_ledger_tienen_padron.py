"""Quién escribe el ledger de gasto, contado en el ÁRBOL (#426).

Cada `SPEND.add(...)` de `ai_server/` (fuera de `tests/`) está en este padrón
con la función que lo envuelve, declara `procedencia` por keyword, y el valor
es el que le toca por quién es: los dos llamantes de fal/Meshy la ponen a
`"real"` a mano (no tienen doble en el árbol); los dos del adaptador de
sprite-forge la DERIVAN de la respuesta (`_procedencia_o_502`, que envuelve
`procedencia_segun_api`). Un `add` nuevo sin estar aquí es rojo; uno que la
cablee donde debería derivarla, también.

Se cuenta con `ast`, no con `grep`: un censo por texto es ciego a un nombre
partido en dos líneas, y aquí los dos del adaptador lo están.

LO QUE ESTO NO SUJETA, dicho para que nadie lo cite como garantía:
  - un alias (`from spend_tracker import SPEND as S; S.add(...)`),
  - `getattr(SPEND, "add")(...)`,
  - otra instancia (`SpendTracker(...).add(...)`) con otro nombre,
  - un `add` en un fichero fuera de `ai_server/`.
Para esos está la OTRA mitad: la firma keyword-only sin defecto de
`SpendTracker.add`, que es `TypeError` en runtime (probado en
`test_spend_tracker.py`). El padrón caza al que se olvida; la firma, al que
se esconde.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests
"""

import ast
import sys
import unittest
from pathlib import Path

AI_SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AI_SERVER))

#: (fichero relativo a ai_server/, función envolvente) → cómo declara la
#: procedencia: `"real"` literal, o `derivada` (una llamada a
#: `_procedencia_o_502`, que es la que traduce `api` de sprite-forge).
PADRON = {
    ("style_pack_builder.py", "generate_missing"): "real",
    ("surface_atlas_generator.py", "_run_page"): "real",
    ("routers/remote_generation.py", "skin_sprite_sheet_endpoint"): "derivada",
}
#: Cuántos `add` hay en cada función del padrón: el adaptador tiene DOS (hero
#: y skin) y los otros uno. Un tercero en el adaptador también sería rojo.
CUANTOS = {
    ("style_pack_builder.py", "generate_missing"): 1,
    ("surface_atlas_generator.py", "_run_page"): 1,
    ("routers/remote_generation.py", "skin_sprite_sheet_endpoint"): 2,
}


def _fuentes():
    for p in sorted(AI_SERVER.rglob("*.py")):
        rel = p.relative_to(AI_SERVER)
        if rel.parts[0] in ("tests", "__pycache__"):
            continue
        yield rel.as_posix(), ast.parse(p.read_text(encoding="utf-8"), filename=str(p))


def _es_spend_add(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "add"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "SPEND"
    )


def _llamadas_a_spend_add():
    """Cada `SPEND.add(...)` con su fichero y su función envolvente más
    cercana (la que lo contiene en el árbol, no la de `def` más arriba)."""
    for rel, arbol in _fuentes():
        # Padre de cada nodo, para subir hasta el def que envuelve la llamada.
        padres = {}
        for padre in ast.walk(arbol):
            for hijo in ast.iter_child_nodes(padre):
                padres[hijo] = padre
        for node in ast.walk(arbol):
            if not _es_spend_add(node):
                continue
            cursor = node
            funcion = None
            while cursor in padres:
                cursor = padres[cursor]
                if isinstance(cursor, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    funcion = cursor.name
                    break
            yield rel, funcion, node


def _como_declara(node: ast.Call) -> str:
    kw = {k.arg: k.value for k in node.keywords}
    if "procedencia" not in kw:
        return "SIN procedencia"
    v = kw["procedencia"]
    if isinstance(v, ast.Constant):
        return v.value
    # Derivada: el nombre que se pasa lo asignó una llamada a
    # `_procedencia_o_502` en la misma función. Se acepta el Name y se
    # comprueba aparte que esa asignación existe (ver test).
    if isinstance(v, ast.Name):
        return f"nombre:{v.id}"
    if isinstance(v, ast.Call) and isinstance(v.func, ast.Name) and v.func.id == "_procedencia_o_502":
        return "derivada"
    return f"otra cosa: {ast.dump(v)[:60]}"


class LosEscritoresDelLedgerTienenPadron(unittest.TestCase):
    def setUp(self):
        self.llamadas = list(_llamadas_a_spend_add())

    def test_el_padron_es_exactamente_el_que_hay(self):
        vistos = {}
        for rel, fn, _ in self.llamadas:
            vistos[(rel, fn)] = vistos.get((rel, fn), 0) + 1
        self.assertEqual(
            vistos, CUANTOS,
            "un `SPEND.add` nuevo, movido o de más: actualiza el padrón CON su procedencia",
        )

    def test_cada_add_declara_procedencia_por_keyword(self):
        for rel, fn, node in self.llamadas:
            with self.subTest(donde=f"{rel}:{node.lineno} ({fn})"):
                self.assertNotEqual(_como_declara(node), "SIN procedencia")

    def test_los_de_fal_y_meshy_la_ponen_a_real_y_el_adaptador_la_deriva(self):
        for rel, fn, node in self.llamadas:
            esperado = PADRON[(rel, fn)]
            como = _como_declara(node)
            with self.subTest(donde=f"{rel}:{node.lineno} ({fn})"):
                if esperado == "real":
                    self.assertEqual(como, "real")
                else:
                    self.assertTrue(como.startswith("nombre:"), como)

    def test_lo_que_el_adaptador_pasa_por_nombre_sale_de_procedencia_o_502(self):
        """La mitad que un `Name` solo no dice: `procedencia=procedencia_hero`
        vale si y solo si `procedencia_hero = _procedencia_o_502(...)` está en
        la MISMA función. Sin esto, `procedencia_hero = "fixture"` pasaría."""
        rel = "routers/remote_generation.py"
        arbol = dict(_fuentes())[rel]
        fn = next(
            n for n in ast.walk(arbol)
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "skin_sprite_sheet_endpoint"
        )
        asignadas = {}
        for n in ast.walk(fn):
            if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
                asignadas[n.targets[0].id] = n.value
        nombres = [
            _como_declara(node).removeprefix("nombre:")
            for r, f, node in self.llamadas
            if (r, f) == (rel, "skin_sprite_sheet_endpoint")
        ]
        self.assertEqual(len(nombres), 2)
        for nombre in nombres:
            with self.subTest(nombre=nombre):
                v = asignadas.get(nombre)
                self.assertIsNotNone(v, f"{nombre} no se asigna en la función")
                self.assertTrue(
                    isinstance(v, ast.Call) and isinstance(v.func, ast.Name) and v.func.id == "_procedencia_o_502",
                    f"{nombre} = {ast.dump(v)[:80]} — tiene que salir de _procedencia_o_502",
                )

    def test_procedencia_o_502_envuelve_a_procedencia_segun_api(self):
        # Y el eslabón que falta: `_procedencia_o_502` LLAMA a
        # `procedencia_segun_api`, o el adaptador «deriva» de una función que
        # se inventa el valor.
        arbol = dict(_fuentes())["routers/remote_generation.py"]
        fn = next(n for n in ast.walk(arbol) if isinstance(n, ast.FunctionDef) and n.name == "_procedencia_o_502")
        llamadas = {
            n.func.id for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        }
        self.assertIn("procedencia_segun_api", llamadas)


if __name__ == "__main__":
    unittest.main()
