"""Candado anti-divergencia del umbral del borrador de mundo (lado Python).

La regla —cuántos caracteres hace falta que tenga un borrador para que valga una
génesis— vive en `nefan-core/src/protocol/borrador-de-mundo.ts` y la aplican el
título y el bridge con `validarBorrador`. Este proceso es el TERCERO que la mide
(`POST /develop_world` es quien llama al motor) y hasta la vuelta de QA de la PR
7 de #241 la tenía escrita a mano: `Field(min_length=20, max_length=64_000)`.

Aquí se comprueba lo único que puede divergir: que los dos números que aplica
Pydantic son los del snapshot `data/contract/borrador-de-mundo.json`, y que el
umbral de verdad corta donde dice. El endpoint REAL es el sujeto —no una app de
juguete con el mismo modelo—: un borrador corto muere en la puerta con 422 y uno
válido la atraviesa y llega al endpoint, que sin motor contesta 503. Ese 503 es
justo la prueba de que pasó el umbral.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from narrative_schemas import (  # noqa: E402
    BORRADOR_MAX,
    BORRADOR_MIN,
    CONTRACT_BORRADOR_PATH,
    _load_contract_borrador,
)


def _cliente():
    """El router REAL montado en una app pelada. Sin `deps.llm_client` el
    endpoint contesta 503, que es exactamente lo que queremos distinguir del 422
    de la puerta."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from routers.narrative import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class UmbralDelBorradorTest(unittest.TestCase):
    def test_los_numeros_salen_del_snapshot_no_de_este_proceso(self):
        """Si alguien vuelve a escribirlos a mano, este test sigue verde — lo
        que lo caza es la regla `el-umbral-del-borrador-no-se-copia-a-mano`.
        Lo que se comprueba aquí es lo otro: que lo que APLICA Pydantic es lo
        que hay en el fichero commiteado."""
        from routers.narrative import DevelopWorldRequest

        with open(CONTRACT_BORRADOR_PATH, encoding="utf-8") as f:
            snap = json.load(f)
        self.assertEqual((BORRADOR_MIN, BORRADOR_MAX), (snap["min"], snap["max"]))

        aplicados = {
            attr: getattr(m, attr)
            for m in DevelopWorldRequest.model_fields["draft_text"].metadata
            for attr in ("min_length", "max_length")
            if hasattr(m, attr)
        }
        self.assertEqual(aplicados, {"min_length": snap["min"], "max_length": snap["max"]})

    def test_un_borrador_corto_muere_en_la_puerta_y_uno_valido_la_atraviesa(self):
        cliente = _cliente()

        corto = cliente.post("/develop_world", json={"draft_text": "a" * (BORRADOR_MIN - 1)})
        self.assertEqual(corto.status_code, 422)

        # Justo el mínimo: pasa el umbral y llega al endpoint, que sin motor
        # narrativo contesta 503 fail-loud. NO es 422: esa es la diferencia.
        justo = cliente.post("/develop_world", json={"draft_text": "a" * BORRADOR_MIN})
        self.assertEqual(justo.status_code, 503)
        self.assertIn("LLM backend", justo.json()["detail"])

    def test_el_maximo_corta_donde_dice(self):
        cliente = _cliente()
        self.assertEqual(
            cliente.post("/develop_world", json={"draft_text": "a" * BORRADOR_MAX}).status_code,
            503,
        )
        self.assertEqual(
            cliente.post("/develop_world", json={"draft_text": "a" * (BORRADOR_MAX + 1)}).status_code,
            422,
        )

    def test_sin_snapshot_falla_fuerte_y_dice_el_comando(self):
        """Sin el fichero no hay defaults inventados: inventarlos es exactamente
        cómo se diverge (misma conducta que physics.json y style-upload.json)."""
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError) as ctx:
                _load_contract_borrador(Path(tmp) / "no-esta.json")
            self.assertIn("npm run dump-borrador-de-mundo", str(ctx.exception))

            a_medias = Path(tmp) / "borrador-de-mundo.json"
            a_medias.write_text(json.dumps({"min": 20}), encoding="utf-8")
            with self.assertRaises(ValueError) as ctx2:
                _load_contract_borrador(a_medias)
            self.assertIn("`max`", str(ctx2.exception))


if __name__ == "__main__":
    unittest.main()
