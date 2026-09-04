"""Tests del canal available_assets (librería visible al motor narrativo).

Regresión del hallazgo 2026-08-14: con el filtro antiguo (type != segment y
len(prompt) > 20) las 30 entradas eran TODAS prompts de inpaint de scene/plate
— el motor no veía ni un asset reutilizable, y los prompts cortos útiles
("banco de piedra") quedaban excluidos.

Desde #199 el ÚNICO tipo reutilizable es `surface`: texture/model/sprite se
fueron con el gpu-worker, que era su único productor.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from llm_client import LLMClient  # noqa: E402


class FakeManifest:
    def __init__(self, assets):
        self.assets = assets
        self.last_query = None

    def list_assets(self, asset_type=None, limit=50):
        self.last_query = {"asset_type": asset_type, "limit": limit}
        types = set((asset_type or "").split(",")) if asset_type else None
        rows = [a for a in self.assets if types is None or a["type"] in types]
        return rows[:limit]


def asset(hash_, type_, prompt, subtype=None):
    return {
        "hash": hash_,
        "type": type_,
        "subtype": subtype or type_,
        "prompt": prompt,
        "created_at": "2026-08-14T00:00:00Z",
    }


def make_client(assets):
    client = LLMClient.__new__(LLMClient)  # sin __init__: solo el canal de assets
    client.asset_manifest = FakeManifest(assets)
    client.session_info = None
    return client


class TestAvailableAssets(unittest.TestCase):
    def test_pide_solo_tipos_reutilizables(self):
        """Solo `surface`: pedir un tipo sin productor llenaría la ventana de
        entradas que ningún proceso puede volver a generar (#199)."""
        client = make_client([])
        client._inject_available_assets({})
        q = client.asset_manifest.last_query
        self.assertEqual(q["asset_type"], "surface")

    def test_cortos_entran_y_opacos_no(self):
        client = make_client([
            asset("a1", "surface", "banco de piedra"),      # corto pero útil
            asset("a2", "surface", "ab"),                   # etiqueta opaca
            asset("a3", "surface", "aged lime plaster surface, plain off-white"),
        ])
        payload = client._inject_available_assets({})
        prompts = [a["prompt"] for a in payload["available_assets"]]
        self.assertIn("banco de piedra", prompts)
        self.assertNotIn("ab", prompts)

    def test_dedupe_por_prompt(self):
        client = make_client([
            asset("a1", "surface", "Worn stone flagstones"),
            asset("a2", "surface", "worn stone flagstones"),  # mismo prompt, otro estilo
        ])
        payload = client._inject_available_assets({})
        self.assertEqual(len(payload["available_assets"]), 1)

    def test_limite_recorta_la_ventana(self):
        """El techo de la ventana se respeta aunque el manifest traiga mucho
        más. El intercalado round-robin ENTRE tipos que hubo aquí murió con
        el segundo tipo reutilizable (#199) y se borró en #257: con un solo
        tipo era código que ningún test podía ejercer."""
        assets = [asset(f"s{i}", "surface", f"superficie numero {i}") for i in range(40)]
        client = make_client(assets)
        payload = client._inject_available_assets({}, limit=12)
        got = payload["available_assets"]
        self.assertEqual(len(got), 12)
        self.assertEqual({a["type"] for a in got}, {"surface"})


if __name__ == "__main__":
    unittest.main()
