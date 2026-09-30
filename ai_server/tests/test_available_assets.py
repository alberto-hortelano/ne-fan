"""Tests del canal available_assets (librería visible al motor narrativo).

Regresión del hallazgo 2026-08-14: con el filtro antiguo (type != segment y
len(prompt) > 20) las 30 entradas eran TODAS prompts de inpaint de scene/plate
— el motor no veía ni un asset reutilizable, y los prompts cortos útiles
("banco de piedra") quedaban excluidos.

Desde #199 el ÚNICO tipo reutilizable es `surface`: texture/model/sprite se
fueron con el gpu-worker, que era su único productor.

Desde la tanda BZ la librería es la del ESTILO de la partida (el `style` de la
clave de caché) y viaja como descripciones sueltas: un playtest de acuarela
veía 28 de 30 entradas de otros estilos, cuyo reuso es un repintado pagado.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from llm_client import LLMClient  # noqa: E402
from style_packs import surface_style_key  # noqa: E402

ACUARELA = "acuarela_luminosa:watercolor, luminous washes"
NEON = "acero_neon:neon steel, hard light"


class FakeStyles:
    """Resolver de packs mínimo: el token de cada estilo."""

    TOKENS = {
        "acuarela_luminosa": "watercolor, luminous washes",
        "acero_neon": "neon steel, hard light",
        "sin_token": "",
    }

    def style_token(self, style_id):
        return self.TOKENS.get(style_id, "")


class FakeManifest:
    """Honra el contrato de GET /assets: filtra por type, `extra.style` y
    `extra.kind` ANTES de la ventana `limit` (como el SQL del store)."""

    def __init__(self, assets):
        self.assets = assets
        self.last_query = None

    def list_assets(self, asset_type=None, limit=50, style=None, surface_kind=None):
        self.last_query = {
            "asset_type": asset_type, "limit": limit,
            "style": style, "surface_kind": surface_kind,
        }
        types = set((asset_type or "").split(",")) if asset_type else None
        rows = [
            a for a in self.assets
            if (types is None or a["type"] in types)
            and (style is None or a["extra"].get("style") == style)
            and (surface_kind is None or a["extra"].get("kind") == surface_kind)
        ]
        return rows[:limit]


class ManifestCaido:
    def __init__(self, exc):
        self.exc = exc

    def list_assets(self, **_kw):
        raise self.exc


def asset(hash_, prompt, style=ACUARELA, kind="unique", type_="surface"):
    return {
        "hash": hash_,
        "type": type_,
        "subtype": type_,
        "prompt": prompt,
        "created_at": "2026-08-14T00:00:00Z",
        "extra": {"style": style, "kind": kind},
    }


def make_client(assets):
    client = LLMClient.__new__(LLMClient)  # sin __init__: solo el canal de assets
    client.asset_manifest = assets if hasattr(assets, "list_assets") else FakeManifest(assets)
    client.style_packs = FakeStyles()
    client.session_info = None
    return client


def peticion(style_id="acuarela_luminosa"):
    return {"world": {"style_id": style_id}}


class TestAvailableAssets(unittest.TestCase):
    def test_pide_superficies_unique_del_estilo_de_la_clave(self):
        """Solo `surface` (#199), solo `unique` (lo que crea un surface_desc),
        y el estilo EXACTO de la clave de caché, no el style_id a secas."""
        client = make_client([])
        client._inject_available_assets(peticion())
        q = client.asset_manifest.last_query
        self.assertEqual(q["asset_type"], "surface")
        self.assertEqual(q["surface_kind"], "unique")
        self.assertEqual(q["style"], ACUARELA)

    def test_solo_ve_descripciones_de_su_estilo(self):
        """El hallazgo del playtest (tanda BZ): en una partida de acuarela el
        motor veía fachadas sci-fi de acero_neon como reusables. Reusar su
        texto aquí no es un cache-hit: el estilo va en la clave, así que sería
        un repintado pagado."""
        client = make_client([
            asset("n1", "colony airlock door, brushed steel", style=NEON),
            asset("a1", "muro de adobe encalado, manchas de humedad"),
            asset("n2", "neon-lit hangar floor plates", style=NEON),
            asset("a2", "tejado de pizarra musgosa"),
        ])
        payload = client._inject_available_assets(peticion())
        self.assertEqual(
            payload["available_assets"],
            ["muro de adobe encalado, manchas de humedad", "tejado de pizarra musgosa"],
        )
        payload = client._inject_available_assets(peticion("acero_neon"))
        self.assertEqual(
            payload["available_assets"],
            ["colony airlock door, brushed steel", "neon-lit hangar floor plates"],
        )

    def test_las_tile_no_se_ofrecen(self):
        client = make_client([
            asset("t1", "grass meadow, worn", kind="tile"),
            asset("u1", "puerta de roble con herrajes"),
        ])
        payload = client._inject_available_assets(peticion())
        self.assertEqual(payload["available_assets"], ["puerta de roble con herrajes"])

    def test_sin_estilo_no_hay_libreria(self):
        """Sin world.style_id (o sin resolver) no se puede decir qué es
        reusable: no se ofrece nada, y ni se pregunta al store."""
        casos = (
            ("sin world", {}, FakeStyles()),
            ("world sin style_id", {"world": {}}, FakeStyles()),
            ("sin resolver de packs", peticion(), None),
        )
        for nombre, payload_in, styles in casos:
            with self.subTest(nombre):
                client = make_client([asset("a1", "muro de adobe")])
                client.style_packs = styles
                payload = client._inject_available_assets(dict(payload_in))
                self.assertNotIn("available_assets", payload)
                self.assertIsNone(client.asset_manifest.last_query)

    def test_la_proyeccion_es_solo_la_descripcion(self):
        """El motor reusa por texto: hash/type/subtype/created_at eran bytes
        que no leía nadie (≈4,5 KB por petición)."""
        client = make_client([asset("a1", "  muro de adobe encalado  ")])
        payload = client._inject_available_assets(peticion())
        self.assertEqual(payload["available_assets"], ["muro de adobe encalado"])

    def test_cortos_entran_y_opacos_no(self):
        client = make_client([
            asset("a1", "banco de piedra"),      # corto pero útil
            asset("a2", "ab"),                   # etiqueta opaca
            asset("a3", "aged lime plaster surface, plain off-white"),
        ])
        got = client._inject_available_assets(peticion())["available_assets"]
        self.assertIn("banco de piedra", got)
        self.assertNotIn("ab", got)

    def test_dedupe_por_prompt(self):
        client = make_client([
            asset("a1", "Worn stone flagstones"),
            asset("a2", "worn stone flagstones"),
        ])
        payload = client._inject_available_assets(peticion())
        self.assertEqual(payload["available_assets"], ["Worn stone flagstones"])

    def test_limite_recorta_la_ventana(self):
        assets = [asset(f"s{i}", f"superficie numero {i}") for i in range(40)]
        client = make_client(assets)
        got = client._inject_available_assets(peticion(), limit=12)["available_assets"]
        self.assertEqual(len(got), 12)

    def test_store_caido_degrada_sin_libreria(self):
        """El store caído (httpx.HTTPError) deja la petición sin librería y
        con aviso: el motor describe libre."""
        client = make_client(ManifestCaido(httpx.ConnectError("sin store")))
        payload = client._inject_available_assets(peticion())
        self.assertNotIn("available_assets", payload)

    def test_un_bug_de_codigo_no_se_traga(self):
        """Antes un `except Exception` convertía cualquier bug en «sin
        librería» mudo. Solo el fallo del store degrada."""
        client = make_client(ManifestCaido(KeyError("prompt")))
        with self.assertRaises(KeyError):
            client._inject_available_assets(peticion())


class TestSurfaceStyleKey(unittest.TestCase):
    """UNA fuente para la clave del atlas y el filtro de la librería."""

    def test_id_y_token(self):
        self.assertEqual(surface_style_key(FakeStyles(), "acuarela_luminosa"), ACUARELA)

    def test_sin_token_es_el_id(self):
        self.assertEqual(surface_style_key(FakeStyles(), "sin_token"), "sin_token")

    def test_sin_estilo_o_sin_resolver_es_vacio(self):
        self.assertEqual(surface_style_key(FakeStyles(), ""), "")
        self.assertEqual(surface_style_key(None, "acuarela_luminosa"), "")

    def test_el_atlas_usa_la_misma_funcion(self):
        """remote_generation compone la clave con esta función, no inline."""
        src = (Path(__file__).resolve().parent.parent / "routers" / "remote_generation.py").read_text()
        self.assertIn("surface_style_key(deps.style_packs, body.style_id)", src)
        self.assertNotIn('f"{body.style_id}:{style_token}"', src)


if __name__ == "__main__":
    unittest.main()
