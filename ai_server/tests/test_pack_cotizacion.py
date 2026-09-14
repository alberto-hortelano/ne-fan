"""EL PRECIO LO DICE QUIEN EMPAQUETA, también en el pack de estilo.

Hermano de `test_atlas_cotizacion.py`, y nace del mismo defecto una fila más
arriba de la MISMA pantalla. Hasta el 2026-09-14 el dry-run del pack
(`/styles/{id}/missing` y `/styles/upload`) cotizaba **todas** las refs al precio
del modelo de personajes —el más caro— mientras `generate_missing` cobraba por
CARPETA: surfaces/ a fal nano-banana-pro, faces/ a fal gpt-image-2, characters/
a Meshy. Medido sobre un pack de 1 surface + 2 faces + 1 character: **$0.96
cotizados contra $0.73 cobrados, ×1,32** — y el panel de «Aplicar estilo» lo
enseñaba como cifra EXACTA.

Lo que canda este fichero es que las dos cifras salgan de la misma función
(`precio_de_ref`) sobre las mismas refs, con las dos APIs de imagen sustituidas
por un doble: cero llamadas, cero créditos.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v
"""

import asyncio
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

import style_pack_builder as spb  # noqa: E402
from meshy_client import FalImageToImage, MeshyImageToImage  # noqa: E402

#: El pack de prueba: una ref por carpeta y dos caras, que es donde el precio
#: viejo se separaba más (las caras se cobran a $0.17 y se cotizaban a $0.24).
REFS = [
    {"id": "materiales", "file": "surfaces/materiales.jpg", "description": "lámina de materiales"},
    {"id": "fachada", "file": "faces/fachada.jpg", "description": "una fachada de piedra"},
    {"id": "puerta", "file": "faces/puerta.jpg", "description": "un portón de madera"},
    {"id": "noble", "file": "characters/noble.jpg", "description": "un noble con capa"},
]


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), "#808080").save(buf, format="PNG")
    return buf.getvalue()


#: Lo que cada API REAL pintaría, apuntado por modelo. Se sustituyen SOLO el
#: constructor (que exige clave) y la llamada que gasta: la tabla de precios,
#: que es lo que este fichero compara, sigue siendo la de producción — un doble
#: con su propia tabla probaría el doble.
PEDIDOS_FAL: list[str] = []
PEDIDOS_MESHY: list[str] = []


async def _fal_run_one(self, prompt, refs, ai_model="", aspect=None):
    PEDIDOS_FAL.append(ai_model)
    return _png(), None


async def _meshy_run_one(self, ai_model, prompt, refs):
    PEDIDOS_MESHY.append(ai_model)
    return _png(), None


class ParidadDelPackTest(unittest.TestCase):
    AI_MODEL = "gpt-image-2"  # el `sprite_skin_model` de serie

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.styles = Path(self._tmp.name)
        pack = self.styles / "mi_estilo"
        pack.mkdir()
        (pack / "style.json").write_text(
            json.dumps({"id": "mi_estilo", "style_token": "un estilo de prueba", "refs": REFS}),
            encoding="utf-8",
        )
        PEDIDOS_FAL.clear()
        PEDIDOS_MESHY.clear()
        self._parches = [
            mock.patch.object(FalImageToImage, "__init__", lambda self, *a, **k: None),
            mock.patch.object(FalImageToImage, "run_one", _fal_run_one),
            mock.patch.object(MeshyImageToImage, "__init__", lambda self, *a, **k: None),
            mock.patch.object(MeshyImageToImage, "run_one", _meshy_run_one),
        ]
        for p in self._parches:
            p.start()

    def tearDown(self):
        for p in self._parches:
            p.stop()
        self._tmp.cleanup()

    def test_lo_cotizado_es_lo_cobrado(self):
        faltan = spb.missing_refs(self.styles, "mi_estilo")
        self.assertEqual(len(faltan), 4, "las cuatro refs del pack están sin imagen")
        cotizado = spb.cotizar_refs(faltan, self.AI_MODEL)
        pintado = asyncio.run(
            spb.generate_missing(self.styles, "mi_estilo", self.AI_MODEL, log=lambda *a: None)
        )
        self.assertEqual(sorted(pintado["generated"]), sorted(r["id"] for r in REFS))
        self.assertEqual(
            cotizado,
            pintado["cost_usd"],
            "el importe cotizado y el cobrado tienen que salir de la misma fórmula",
        )

    def test_cada_carpeta_paga_el_precio_de_SU_modelo(self):
        # La mitad que un «refs × un precio» no ve: la lámina la pinta
        # nano-banana-pro ($0.15), las caras gpt-image-2 por fal ($0.17) y el
        # personaje Meshy ($0.24). El precio viejo cobraba $0.24 a las cuatro.
        faltan = spb.missing_refs(self.styles, "mi_estilo")
        self.assertAlmostEqual(
            spb.cotizar_refs(faltan, self.AI_MODEL),
            FalImageToImage.COST_USD["nano-banana-pro"]
            + 2 * FalImageToImage.COST_USD["gpt-image-2"]
            + MeshyImageToImage.cost_usd(self.AI_MODEL),
            places=2,
        )
        # Y el precio VIEJO (todas al modelo de personajes) era otro: si esta
        # aserción dejara de distinguirlos, el test habría perdido su sujeto.
        self.assertNotAlmostEqual(
            spb.cotizar_refs(faltan, self.AI_MODEL),
            len(faltan) * MeshyImageToImage.cost_usd(self.AI_MODEL),
            places=2,
        )

    def test_un_pack_completo_no_cuesta_nada(self):
        for r in REFS:
            destino = self.styles / "mi_estilo" / str(r["file"])
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(_png())
        faltan = spb.missing_refs(self.styles, "mi_estilo")
        self.assertEqual(faltan, [])
        self.assertEqual(spb.cotizar_refs(faltan, self.AI_MODEL), 0.0)

    def test_solo_una_carpeta_cotiza_y_cobra_lo_mismo(self):
        # `folder_only` es el camino del flujo de aprobación por carpeta: la
        # cotización tiene que seguirlo, no cotizar el pack entero.
        faltan = [r for r in spb.missing_refs(self.styles, "mi_estilo") if r["folder"] == "faces"]
        cotizado = spb.cotizar_refs(faltan, self.AI_MODEL)
        pintado = asyncio.run(
            spb.generate_missing(
                self.styles, "mi_estilo", self.AI_MODEL, folder_only="faces", log=lambda *a: None
            )
        )
        self.assertEqual(cotizado, pintado["cost_usd"])
        self.assertEqual(PEDIDOS_FAL, ["gpt-image-2", "gpt-image-2"])
        self.assertEqual(PEDIDOS_MESHY, [], "una tirada de caras no toca Meshy")


if __name__ == "__main__":
    unittest.main()
