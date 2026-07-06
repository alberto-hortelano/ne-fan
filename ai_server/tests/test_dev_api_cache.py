"""Tests del DevApiCache: gating por enabled, roundtrip multi-blob,
persistencia del estado y namespacing de claves derivadas.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v"""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dev_api_cache import DevApiCache  # noqa: E402


class DevApiCacheTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cache = DevApiCache(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_disabled_always_calls_but_stores(self):
        calls = []

        def call():
            calls.append(1)
            return [b"real-1"]

        blobs, cached = self.cache.through_sync("meshy_test", call)
        self.assertEqual((blobs, cached), ([b"real-1"], False))
        blobs, cached = self.cache.through_sync("meshy_test", call)
        self.assertEqual((blobs, cached), ([b"real-1"], False))
        self.assertEqual(len(calls), 2)  # apagado: siempre llama

    def test_enabled_serves_last_value_without_calling(self):
        self.cache.through_sync("meshy_test", lambda: [b"real-1"])
        self.cache.through_sync("meshy_test", lambda: [b"real-2"])
        self.cache.set_enabled(True)

        def must_not_run():
            raise AssertionError("no debe llamar a la API en modo dev")

        blobs, cached = self.cache.through_sync("meshy_test", must_not_run)
        self.assertEqual((blobs, cached), ([b"real-2"], True))

    def test_enabled_miss_falls_through_once(self):
        self.cache.set_enabled(True)
        calls = []

        def call():
            calls.append(1)
            return [b"first"]

        # Canal sin valor: la primera llamada pasa de verdad y queda guardada.
        self.assertEqual(self.cache.through_sync("nuevo_canal", call), ([b"first"], False))
        self.assertEqual(self.cache.through_sync("nuevo_canal", call), ([b"first"], True))
        self.assertEqual(len(calls), 1)

    def test_multi_blob_roundtrip(self):
        blobs_in = [b"a", b"bb" * 100, b"", b"ccc"]
        self.cache.put("fal_test", blobs_in)
        self.cache.set_enabled(True)
        self.assertEqual(self.cache.get("fal_test"), blobs_in)

    def test_async_through(self):
        async def call():
            return [b"async-1"]

        blobs, cached = asyncio.run(self.cache.through("meshy_async", call))
        self.assertEqual((blobs, cached), ([b"async-1"], False))
        self.cache.set_enabled(True)

        async def must_not_run():
            raise AssertionError("no debe llamar")

        blobs, cached = asyncio.run(self.cache.through("meshy_async", must_not_run))
        self.assertEqual((blobs, cached), ([b"async-1"], True))

    def test_state_persists_across_instances(self):
        self.cache.set_enabled(True)
        self.cache.put("meshy_test", [b"x"])
        reborn = DevApiCache(Path(self._tmp.name))
        self.assertTrue(reborn.enabled)
        self.assertEqual(reborn.get("meshy_test"), [b"x"])

    def test_namespace_only_when_enabled(self):
        self.assertEqual(self.cache.namespace_suffix(), "")
        self.assertIsNone(self.cache.namespace_context())
        self.assertEqual(self.cache.namespace_context({"a": 1}), {"a": 1})
        self.cache.set_enabled(True)
        self.assertEqual(self.cache.namespace_suffix(), "devcache")
        self.assertEqual(self.cache.namespace_context(), {"devcache": True})
        self.assertEqual(self.cache.namespace_context({"a": 1}), {"a": 1, "devcache": True})

    def test_invalid_channel_rejected(self):
        with self.assertRaises(ValueError):
            self.cache.put("../evil", [b"x"])

    def test_status_lists_channels(self):
        self.cache.put("meshy_test", [b"xy", b"z"], note="prompt de prueba")
        st = self.cache.status()
        self.assertFalse(st["enabled"])
        self.assertEqual(st["channels"]["meshy_test"]["bytes"], 3)
        self.assertEqual(st["channels"]["meshy_test"]["blobs"], 2)


if __name__ == "__main__":
    unittest.main()
