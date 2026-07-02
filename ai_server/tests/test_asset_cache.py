"""Tests de AssetManifest/AssetCache: registro, touch LRU y prune con techo.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v
(sin dependencias fuera de stdlib; el cache vive en un tmpdir)."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from asset_cache import AssetCache, AssetManifest  # noqa: E402


class AssetManifestPruneTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.manifest = AssetManifest(self.root / "manifest.json")
        self.textures = AssetCache(
            cache_dir=str(self.root / "textures"), asset_type="texture", manifest=self.manifest
        )
        self.models = AssetCache(
            cache_dir=str(self.root / "models"), asset_type="model", manifest=self.manifest
        )
        self.dirs_by_type = {
            "texture": self.root / "textures",
            "model": self.root / "models",
        }

    def tearDown(self):
        self._tmp.cleanup()

    def _put_texture(self, prompt: str, size: int) -> str:
        return self.textures.put(prompt, "albedo", b"x" * size)

    def test_register_and_total_bytes(self):
        self._put_texture("mossy stone", 1000)
        self._put_texture("oak planks", 500)
        self.assertEqual(self.manifest.total_count(), 2)
        self.assertEqual(self.manifest.total_bytes(), 1500)

    def test_prune_noop_under_limit(self):
        self._put_texture("mossy stone", 1000)
        summary = self.manifest.prune(self.dirs_by_type, max_bytes=10_000)
        self.assertEqual(summary["pruned"], 0)
        self.assertEqual(summary["total_bytes"], 1000)

    def test_prune_evicts_least_recently_used_first(self):
        old = self._put_texture("old texture", 1000)
        new = self._put_texture("new texture", 1000)
        # El primero registrado es el más antiguo; touch del segundo lo
        # refresca aún más. Límite de 1500 → sólo cabe uno.
        self.manifest.touch(new)
        summary = self.manifest.prune(self.dirs_by_type, max_bytes=1500)
        self.assertEqual(summary["pruned"], 1)
        self.assertFalse((self.root / "textures" / old).exists(), "el LRU sale de disco")
        self.assertTrue((self.root / "textures" / new).exists(), "el reciente se conserva")
        # El manifest queda desindexado del evictado.
        self.assertEqual(self.manifest.find_by_hash(old), [])
        self.assertEqual(len(self.manifest.find_by_hash(new)), 1)

    def test_touch_protects_from_eviction(self):
        protected = self._put_texture("protected", 1000)
        victim = self._put_texture("victim", 1000)
        # Sin touch, "protected" (más antiguo) caería primero; el touch lo salva.
        self.manifest.touch(protected)
        summary = self.manifest.prune(self.dirs_by_type, max_bytes=1500)
        self.assertEqual(summary["pruned"], 1)
        self.assertTrue((self.root / "textures" / protected).exists())
        self.assertFalse((self.root / "textures" / victim).exists())

    def test_prune_skips_types_without_known_dir(self):
        self.models.put("a sword", "model", b"x" * 1000)
        # dirs sin "model": no debe tocar disco ni manifest para ese type.
        summary = self.manifest.prune({"texture": self.root / "textures"}, max_bytes=1)
        self.assertEqual(summary["pruned"], 0)
        self.assertEqual(self.manifest.total_count(), 1)

    def test_prune_zero_limit_is_noop(self):
        self._put_texture("anything", 1000)
        summary = self.manifest.prune(self.dirs_by_type, max_bytes=0)
        self.assertEqual(summary["pruned"], 0)
        self.assertEqual(self.manifest.total_count(), 1)

    def test_prune_groups_subtypes_as_one_asset(self):
        # albedo + normal del mismo prompt comparten hash: se evictan juntos.
        key = self.textures.put("stone wall", "albedo", b"x" * 600)
        self.textures.put("stone wall", "normal", b"x" * 600)
        self._put_texture("keep me", 100)
        self.manifest.touch(self.textures.hash_key("keep me"))
        summary = self.manifest.prune(self.dirs_by_type, max_bytes=800)
        self.assertEqual(summary["pruned"], 1)
        self.assertEqual(summary["freed_bytes"], 1200)
        self.assertEqual(self.manifest.find_by_hash(key), [])


class AssetManifestPersistenceTest(unittest.TestCase):
    def test_manifest_survives_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m1 = AssetManifest(root / "manifest.json")
            cache = AssetCache(cache_dir=str(root / "textures"), asset_type="texture", manifest=m1)
            cache.put("mossy stone", "albedo", b"x" * 10)
            m2 = AssetManifest(root / "manifest.json")
            self.assertEqual(m2.total_count(), 1)
            self.assertEqual(m2.list_assets()[0]["prompt"], "mossy stone")


if __name__ == "__main__":
    unittest.main()
