"""Tests de AssetCache: hashing content-addressed, put atómico y registro.

Los tests históricos de AssetManifest (registro/touch/prune/persistencia)
migraron con la clase al asset-store en F2 — su cobertura equivalente vive en
nefan-core/test/asset-store.test.ts (SQLite: register/list/touch/prune con
keep-list). Aquí queda lo que SIGUE siendo Python: el hashing (que no se
porta a propósito — depende del str() de Python) y la escritura de blobs con
registro duck-typed contra el índice.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v
(sin dependencias fuera de stdlib; el cache vive en un tmpdir)."""

import sys
import tempfile
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
    """El hash es el CONTRATO de la caché entera (16.907 entradas): fijarlo
    evita que un refactor lo bifurque en silencio."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cache = AssetCache(cache_dir=str(Path(self._tmp.name) / "t"), asset_type="texture")

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
            cache_dir=str(self.root / "textures"), asset_type="texture", manifest=self.registrar
        )

    def tearDown(self):
        self._tmp.cleanup()

    def test_put_writes_blob_and_registers(self):
        key = self.cache.put("mossy stone", "albedo", b"PNGDATA", context={"style": "s1"})
        path = self.root / "textures" / key / "albedo.png"
        self.assertTrue(path.exists())
        self.assertEqual(path.read_bytes(), b"PNGDATA")
        self.assertEqual(len(self.registrar.calls), 1)
        call = self.registrar.calls[0]
        self.assertEqual(call["hash"], key)
        self.assertEqual(call["type"], "texture")
        self.assertEqual(call["subtype"], "albedo")
        self.assertEqual(call["size_bytes"], 7)
        self.assertEqual(call["extra"], {"style": "s1"})

    def test_subtype_override_and_model_extension(self):
        models = AssetCache(
            cache_dir=str(self.root / "models"), asset_type="model", manifest=self.registrar
        )
        key = models.put("a sword", "model", b"GLB", subtype_override="model")
        self.assertTrue((self.root / "models" / key / "model.glb").exists())

    def test_get_roundtrip(self):
        self.cache.put("oak planks", "albedo", b"DATA")
        self.assertEqual(self.cache.get("oak planks", "albedo"), b"DATA")
        self.assertTrue(self.cache.has("oak planks", "albedo"))
        self.assertIsNone(self.cache.get("nunca generado", "albedo"))

    def test_put_without_manifest_is_fine(self):
        cache = AssetCache(cache_dir=str(self.root / "solo"), asset_type="texture")
        key = cache.put("standalone", "albedo", b"X")
        self.assertTrue((self.root / "solo" / key / "albedo.png").exists())


if __name__ == "__main__":
    unittest.main()
