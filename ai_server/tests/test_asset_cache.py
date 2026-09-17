"""Tests de AssetCache: hashing content-addressed, put atómico y registro.

Los tests históricos de AssetManifest (registro/touch/prune/persistencia)
migraron con la clase al asset-store en F2 — su cobertura equivalente vive en
nefan-core/test/asset-store.test.ts (SQLite: register/list/touch/prune con
keep-list). Aquí queda lo que SIGUE siendo Python: el hashing (que no se
porta a propósito — depende del str() de Python) y la escritura de blobs con
registro duck-typed contra el índice.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v
(sin dependencias fuera de stdlib; el cache vive en un tmpdir)."""

import sys
import tempfile
import ast
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from asset_cache import AssetCache  # noqa: E402


class FakeRegistrar:
    """Doble del AssetStoreClient: captura los register() de put()."""

    def __init__(self):
        self.calls = []

    def register(self, hash_key, asset_type, subtype, prompt, size_bytes, extra=None):
        self.calls.append(
            {
                "hash": hash_key,
                "type": asset_type,
                "subtype": subtype,
                "prompt": prompt,
                "size_bytes": size_bytes,
                "extra": extra,
            }
        )


class HashKeyTest(unittest.TestCase):
    """El hash es el CONTRATO de la caché entera: fijarlo evita que un
    refactor lo bifurque en silencio y deje huérfanas las superficies ya
    pagadas."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cache = AssetCache(cache_dir=str(Path(self._tmp.name) / "t"), asset_type="surface")

    def tearDown(self):
        self._tmp.cleanup()

    def test_normalizes_prompt_and_sorts_context(self):
        a = self.cache.hash_key("  Mossy STONE ", {"b": 2, "a": 1})
        b = self.cache.hash_key("mossy stone", {"a": 1, "b": 2})
        self.assertEqual(a, b)
        self.assertEqual(len(a), 16)

    def test_context_changes_the_hash(self):
        base = self.cache.hash_key("stone", {"angle": "top"})
        self.assertNotEqual(base, self.cache.hash_key("stone", {"angle": "side"}))
        self.assertNotEqual(base, self.cache.hash_key("stone"))

    def test_none_and_empty_context_values_are_skipped(self):
        self.assertEqual(
            self.cache.hash_key("stone", {"angle": None, "style": ""}),
            self.cache.hash_key("stone"),
        )

    def test_python_repr_of_values_is_the_contract(self):
        # devcache=True se hashea como "devcache=True" (str() de Python) — por
        # esto el hashing NO se porta a otros lenguajes.
        with_flag = self.cache.hash_key("stone", {"devcache": True})
        self.assertNotEqual(with_flag, self.cache.hash_key("stone", {"devcache": "true"}))

    def test_golden_hash(self):
        # Valor de oro: si esto cambia, TODA la caché en disco queda huérfana.
        self.assertEqual(self.cache.hash_key("mossy stone"), "9399046b017da1e2")


class AssetCachePutTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.registrar = FakeRegistrar()
        self.cache = AssetCache(
            cache_dir=str(self.root / "surfaces"), asset_type="surface", manifest=self.registrar
        )

    def tearDown(self):
        self._tmp.cleanup()

    def test_put_writes_blob_and_registers(self):
        key = self.cache.put("mossy stone", "surface", b"PNGDATA", context={"style": "s1"})
        path = self.root / "surfaces" / key / "surface.png"
        self.assertTrue(path.exists())
        self.assertEqual(path.read_bytes(), b"PNGDATA")
        self.assertEqual(len(self.registrar.calls), 1)
        call = self.registrar.calls[0]
        self.assertEqual(call["hash"], key)
        self.assertEqual(call["type"], "surface")
        self.assertEqual(call["subtype"], "surface")
        self.assertEqual(call["size_bytes"], 7)
        self.assertEqual(call["extra"], {"style": "s1"})

    def test_defaults_are_the_live_kind(self):
        # Instanciarlo sin argumentos no puede resucitar un directorio sin
        # productor (#257): el default es el kind vivo.
        cache = AssetCache(cache_dir=str(self.root / "d"))
        self.assertEqual(cache.asset_type, "surface")
        self.assertEqual(AssetCache.__init__.__defaults__[0], "cache/surfaces")

    def test_has_and_get_by_hash_roundtrip(self):
        # El camino real de remote_generation.py: has() con el contexto y
        # get_by_hash() con la clave que devolvió put().
        ctx = {"style": "s1"}
        key = self.cache.put("oak planks", "surface", b"DATA", context=ctx)
        self.assertTrue(self.cache.has("oak planks", "surface", context=ctx))
        self.assertEqual(self.cache.get_by_hash(key, "surface"), b"DATA")
        self.assertFalse(self.cache.has("nunca generado", "surface"))
        self.assertIsNone(self.cache.get_by_hash("0000000000000000", "surface"))

    def test_put_without_manifest_is_fine(self):
        cache = AssetCache(cache_dir=str(self.root / "solo"), asset_type="surface")
        key = cache.put("standalone", "surface", b"X")
        self.assertTrue((self.root / "solo" / key / "surface.png").exists())


class NadaEscribeEnLaRaizIndexada(unittest.TestCase):
    """#413: la raíz indexada es de `AssetCache.put()` y de nadie más.

    Lo que se escriba ahí por otra vía no tiene fila de manifest, así que el
    prune —que solo borra `join(surfaceDir, g.hash)` de filas existentes— no lo
    ve, y `db.totalBytes()` tampoco: el techo de `cache_max_bytes` se compara
    contra un censo que ve una fracción del disco. Medido al abrir el issue
    (2026-09-03) y sin cambio al cerrarlo (09-17): **19 directorios `atlas_*`,
    81,7 MB, el 69 % de los bytes de `cache/surfaces/`**, irreclamables por
    construcción porque `atlas_<16hex>` son 22 caracteres y nunca casan con un
    hash de 16.

    Mira el ÁRBOL y no el texto, que es la lección que la casa aprendió con el
    candado del reloj de sim: un `grep` sabe que un nombre aparece, no que sea
    QUIEN decide.

    LO QUE NO CUBRE, y hay que leerlo antes de citarlo como garantía:
      · el propio `asset_cache.py`, exento por ser el dueño;
      · una escritura que componga la ruta a mano sin nombrar `get_path` ni
        `cache_dir` (p. ej. desde una cadena de configuración);
      · Python fuera de `ai_server/`, y todo el TypeScript.
    Entra con CERO ocupantes: es una vacuna, igual que #614. Su valor no es
    limpiar sino que el patrón no vuelva, porque el momento en que más tienta
    escribir ahí es justo cuando se quiere volcar algo "solo para mirarlo".
    """

    RAIZ = Path(__file__).resolve().parents[1]
    DUENO = "asset_cache.py"

    def _modulos(self):
        for f in sorted(self.RAIZ.rglob("*.py")):
            rel = f.relative_to(self.RAIZ)
            if f.name == self.DUENO or ".venv" in rel.parts or "__pycache__" in rel.parts:
                continue
            if rel.parts[0] == "tests":
                continue
            yield rel, ast.parse(f.read_text(), filename=str(rel))

    def test_nadie_llama_a_get_path_fuera_de_su_dueno(self):
        # Para LEER ya están `has()` y `get_by_hash()`; fuera del dueño,
        # `get_path` solo puede servir para escribir donde no se debe.
        culpables = [
            f"{rel}:{n.lineno}"
            for rel, arbol in self._modulos()
            for n in ast.walk(arbol)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and n.func.attr == "get_path"
        ]
        self.assertEqual(
            culpables,
            [],
            "get_path() fuera de AssetCache escribe en la raíz indexada sin fila de manifest. "
            "Para material de depuración está debug_path(); para un asset, put(). Sitios: "
            + ", ".join(culpables),
        )

    def test_nadie_compone_rutas_desde_cache_dir(self):
        # La otra puerta: `cache.cache_dir / "loquesea"` esquiva `get_path` y
        # llega al mismo sitio. Construir el AssetCache con `cache_dir=` como
        # argumento es legítimo y no cuenta (es nombrar el parámetro, no leer
        # el atributo).
        culpables = [
            f"{rel}:{n.lineno}"
            for rel, arbol in self._modulos()
            for n in ast.walk(arbol)
            if isinstance(n, ast.Attribute) and n.attr == "cache_dir"
        ]
        self.assertEqual(
            culpables,
            [],
            "leer .cache_dir fuera de AssetCache permite componer una ruta dentro de la raíz "
            "indexada sin pasar por put(). Sitios: " + ", ".join(culpables),
        )

    def test_debug_path_cae_fuera_de_la_raiz_indexada(self):
        # El aserto que hace falsable a los dos de arriba: si `debug_path`
        # devolviera algo DENTRO de `cache_dir`, mandar ahí las páginas del
        # atlas no habría arreglado nada y los dos tests seguirían verdes.
        with tempfile.TemporaryDirectory() as tmp:
            cache = AssetCache(cache_dir=str(Path(tmp) / "surfaces"), asset_type="surface")
            destino = cache.debug_path("atlas_deadbeefdeadbeef", "page0.png")
            self.assertNotIn(
                cache.cache_dir.resolve(),
                destino.resolve().parents,
                f"debug_path ({destino}) cae DENTRO de la raiz indexada ({cache.cache_dir})",
            )


if __name__ == "__main__":
    unittest.main()
