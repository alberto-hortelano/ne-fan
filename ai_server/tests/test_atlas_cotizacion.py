"""EL PRECIO LO DICE QUIEN EMPAQUETA: paridad cotización ↔ cobro del atlas.

Hasta el 2026-09-14 el precio del atlas se lo inventaba el cliente con una
fórmula propia (`ceil(missing/12) × $0.15` en `nefan-html/src/ui/style-apply.ts`)
que se había separado de este empaquetador sin que nada lo comprobase: aquí las
páginas se abren por GRUPO (tiles aparte de uniques, y un subgrupo por cada ref
de cara), y cada página se cobra al precio de SU modelo ($0.15 nano-banana-pro
con tiles, $0.17 gpt-image-2 sin ellos). Medido sobre `data/scenes/*.json`: el
jugador aceptaba $0.15 y se le cobraban $0.47 en el peor fichero.

Lo que canda este fichero es que la cifra que se COTIZA y la que se COBRA salgan
de la misma función sobre las mismas celdas. Hay dos sitios donde eso se puede
romper, y los dos se prueban:

1. **El generador** — `cotizar()` frente al `cost_usd` de `generate()`, con
   `_run_page` sustituido por un lienzo en blanco: cero llamadas de imagen, cero
   créditos, y el reparto real de páginas de punta a punta.
2. **El endpoint** — lo que sale por el wire con `resolve_only` (el camino del
   panel de «Aplicar estilo», $0) frente a lo que sale al pintar de verdad. Con
   una **ref de cara inexistente** entre medias, que es donde el endpoint limpia
   refs: cotizar ANTES de esa limpieza diría más páginas de las que se pintan, y
   mentir por arriba sigue siendo mentir.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v
"""

import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from surface_atlas_generator import (  # noqa: E402
    PAGE_PX,
    SurfaceAtlasGenerator,
    pack_missing,
)

_HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None


def celda(key, kind="tile", ref="", color="#c9b89a", w=4.0, h=2.5):
    return {
        "key": key,
        "mat": key,
        "kind": kind,
        "desc": f"{key} surface swatch",
        "base_color": color,
        "world_w": w,
        "world_h": h,
        "hints": None,
        "ref": ref,
    }


def _lienzo_en_blanco() -> bytes:
    """Lo que devuelve el `_run_page` stubeado: una página gris del tamaño
    exacto, para que `crop_cells` recorte celdas de verdad sin tocar la red."""
    buf = io.BytesIO()
    Image.new("RGB", (PAGE_PX, PAGE_PX), "#808080").save(buf, format="PNG")
    return buf.getvalue()


class GeneradorSinRed(SurfaceAtlasGenerator):
    """El pintor de verdad con la ÚNICA llamada que gasta sustituida. Todo lo
    demás —packer, base clay, prompts, recorte, precios— es el de producción:
    un doble que replicara el reparto probaría el doble, no el pintor."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.paginas_pintadas = 0

    def _run_page(self, prompt, refs, ai_model):  # noqa: D102 - sustituto del que paga
        self.paginas_pintadas += 1
        return _lienzo_en_blanco()


# Un mundo de celdas con las tres cosas que separan páginas: tiles, uniques sin
# ref y uniques con DOS refs distintas. Cotizado a ojo daría una página; el
# reparto real abre cuatro grupos.
CELDAS = [
    *(celda(f"tile_{i}") for i in range(5)),
    celda("muro_sin_ref", kind="unique", w=3.0, h=3.0),
    celda("puerta_norte", kind="unique", ref="fachada", w=1.2, h=2.4),
    celda("ventana_sur", kind="unique", ref="fachada", w=1.0, h=1.0),
    celda("altar", kind="unique", ref="interior", w=2.0, h=1.0),
]


class ParidadDelGeneradorTest(unittest.TestCase):
    def test_lo_cotizado_es_lo_cobrado(self):
        gen = GeneradorSinRed()
        presupuesto = gen.cotizar(CELDAS)
        pintado = gen.generate(CELDAS, "un pueblo de piedra", "token", [])
        self.assertEqual(
            presupuesto["cost_usd"],
            pintado["cost_usd"],
            "el importe cotizado y el cobrado tienen que salir de la misma fórmula",
        )
        self.assertEqual(presupuesto["pages"], pintado["pages_painted"])
        self.assertEqual(gen.paginas_pintadas, presupuesto["pages"])

    def test_cada_grupo_paga_el_precio_de_SU_modelo(self):
        # La mitad que un «coste = páginas × un precio» no ve: las páginas sin
        # tiles las pinta gpt-image-2 y cuestan más. Cuatro grupos aquí: tiles
        # ($0.15) + unique sin ref + ref "fachada" + ref "interior" ($0.17).
        gen = GeneradorSinRed()
        presupuesto = gen.cotizar(CELDAS)
        self.assertEqual(presupuesto["pages"], 4, "cada grupo abre página propia")
        self.assertAlmostEqual(presupuesto["cost_usd"], 0.15 + 0.17 * 3, places=2)

    def test_sin_celdas_no_hay_presupuesto(self):
        self.assertEqual(
            GeneradorSinRed().cotizar([]), {"pages": 0, "cost_usd": 0.0}
        )

    def test_cotizar_no_toca_las_celdas_que_le_dan(self):
        # `pack_missing` estampa `rect` en cada celda. Si `cotizar` lo hiciera
        # sobre las del llamante, el endpoint cotizaría y pintaría sobre listas
        # distintas sin saberlo.
        celdas = [celda("tile_a")]
        GeneradorSinRed().cotizar(celdas)
        self.assertNotIn("rect", celdas[0])


@unittest.skipUnless(_HAS_FASTAPI, "fastapi no instalado")
class ParidadDelEndpointTest(unittest.TestCase):
    """Lo mismo, pero por el wire: `resolve_only` (lo que ve el jugador antes
    de aceptar) contra la petición que pinta."""

    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from asset_cache import AssetCache
        from deps import deps
        from routers import remote_generation as rg

        self._tmp = tempfile.TemporaryDirectory()
        self.gen = GeneradorSinRed()
        self._orig = (deps.surface_cache, deps.surface_atlas_gen, deps.style_packs)
        deps.surface_cache = AssetCache(cache_dir=str(Path(self._tmp.name) / "surfaces"))
        deps.surface_atlas_gen = self.gen
        deps.style_packs = PacksFalsos()

        app = FastAPI()
        app.include_router(rg.router)
        self.client = TestClient(app)

    def tearDown(self):
        from deps import deps

        deps.surface_cache, deps.surface_atlas_gen, deps.style_packs = self._orig
        self._tmp.cleanup()

    def _pedir(self, celdas, **extra):
        cuerpo = {
            "cells": celdas,
            "scene_description": "un pueblo de piedra",
            "style_id": "alta_fantasia",
        }
        cuerpo.update(extra)
        res = self.client.post("/generate_surface_atlas", json=cuerpo)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_el_presupuesto_del_wire_es_la_factura(self):
        cotizado = self._pedir(CELDAS, resolve_only=True)
        self.assertEqual(cotizado["cost_usd"], 0.0, "cotizar no gasta")
        self.assertEqual(cotizado["missing"], len(CELDAS))
        self.assertGreater(cotizado["quoted_cost_usd"], 0)

        cobrado = self._pedir(CELDAS)
        self.assertEqual(cobrado["cost_usd"], cotizado["quoted_cost_usd"])
        self.assertEqual(cobrado["pages_painted"], cotizado["quoted_pages"])

    def test_una_ref_que_no_existe_no_infla_el_presupuesto(self):
        # `fantasma` no está en el pack: el endpoint la borra de la celda antes
        # de empaquetar (una ref muerta no debe abrir grupo propio). Si la
        # cotización se hiciera ANTES de esa limpieza, prometería una página de
        # más — $0.17 que nadie va a cobrar.
        celdas = [*CELDAS, celda("gargola", kind="unique", ref="fantasma", w=1.0, h=1.0)]
        cotizado = self._pedir(celdas, resolve_only=True)

        limpias = [{**c, "ref": "" if c["ref"] == "fantasma" else c["ref"]} for c in celdas]
        self.assertEqual(cotizado["quoted_pages"], len(pack_missing(limpias)))
        self.assertLess(
            cotizado["quoted_pages"],
            len(pack_missing([dict(c) for c in celdas])),
            "sin la limpieza la ref muerta abriría grupo propio: el caso pierde su sujeto",
        )

        cobrado = self._pedir(celdas)
        self.assertEqual(cobrado["cost_usd"], cotizado["quoted_cost_usd"])
        self.assertEqual(cobrado["pages_painted"], cotizado["quoted_pages"])

    def test_lo_que_ya_esta_en_la_libreria_no_se_cotiza(self):
        # Segunda pasada: todo en caché ⇒ nada que pintar y presupuesto a cero.
        # Es lo que sostiene el «en caché ($0)» del panel.
        self._pedir(CELDAS)
        otra = self._pedir(CELDAS, resolve_only=True)
        self.assertEqual(otra["missing"], 0)
        self.assertEqual(otra["quoted_pages"], 0)
        self.assertEqual(otra["quoted_cost_usd"], 0.0)


class PacksFalsos:
    """Un pack con dos refs de cara y ninguna lámina. `resolve_face` devuelve
    `None` para lo que no conoce, que es el caso que el endpoint limpia."""

    REFS = {"fachada", "interior"}

    def style_token(self, style_id):
        return "estilo de prueba"

    def resolve_sheet(self, style_id):
        return None

    def resolve_face(self, style_id, ref_id):
        if ref_id not in self.REFS:
            return None
        from style_packs import StyleRef

        return StyleRef(
            style_id=style_id,
            ref_id=ref_id,
            data_uri="data:image/png;base64,AA==",
            content_hash=f"hash_{ref_id}",
            style_token="estilo de prueba",
        )


if __name__ == "__main__":
    unittest.main()
