"""Tests del SpendTracker (contador de gasto del panel de dev) y del endpoint
agregado GET /dev/status.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v

La variable no es adorno: sin ella este módulo no llega ni a importarse (#392).
El ledger es dinero, y hasta hoy la suite le añadía 43 eventos de gasto
inventado por corrida."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from spend_tracker import (  # noqa: E402
    ENV_SPEND_DIR,
    RAIZ_REPO,
    RUTA_REAL,
    SpendTracker,
    parece_ledger_de_verdad,
    raiz_del_ledger,
)


class SpendTrackerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.spend = SpendTracker(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_empty_status(self):
        st = self.spend.status()
        self.assertEqual(st, {"total_usd": 0.0, "call_count": 0, "calls": []})
        self.assertEqual(self.spend.total_usd(), 0.0)

    def test_add_accumulates(self):
        self.spend.add(0.17, "plató posada", "remote-gen")
        self.spend.add(0.18, "tile 0,1", "remote-gen")
        self.spend.add(0.03, "peel: mesa", "gpu-worker")
        st = self.spend.status()
        self.assertEqual(st["call_count"], 3)
        self.assertAlmostEqual(st["total_usd"], 0.38, places=4)
        self.assertEqual(st["calls"][0]["what"], "plató posada")
        self.assertEqual(st["calls"][2]["service"], "gpu-worker")
        self.assertIn("t", st["calls"][0])

    def test_status_limit_keeps_latest(self):
        for i in range(20):
            self.spend.add(0.01, f"call-{i}", "remote-gen")
        st = self.spend.status(limit=5)
        self.assertEqual(st["call_count"], 20)
        self.assertEqual(len(st["calls"]), 5)
        self.assertEqual(st["calls"][-1]["what"], "call-19")

    def test_multi_instance_shares_file(self):
        """Los 3 procesos comparten cache/spend/ por disco (append-only):
        una instancia ve lo que otra escribió, sin IPC."""
        other = SpendTracker(Path(self._tmp.name))
        self.spend.add(0.17, "a", "remote-gen")
        other.add(0.03, "b", "gpu-worker")
        self.assertAlmostEqual(self.spend.total_usd(), 0.20, places=4)
        self.assertEqual(other.status()["call_count"], 2)


class LedgerRealFueraDeTestTest(unittest.TestCase):
    """El ledger real no se puede NOMBRAR desde un proceso de test (#392).

    La garantía va en el constructor, no en la disciplina de quien escribe el
    test: hasta hoy la suite entera pasaba VERDE mientras añadía 43 eventos y
    $10,32 de gasto inventado al fichero que se mira para decidir si se sigue
    gastando. Un test que se limitara a comprobar que nadie llama a `add` no
    habría cazado eso, porque quien llamaba era producción.
    """

    def test_construir_sobre_la_ruta_real_bajo_test_revienta(self):
        with self.assertRaises(RuntimeError) as ctx:
            SpendTracker(RUTA_REAL)
        # El mensaje tiene que traer el REMEDIO: un fail-loud que no dice qué
        # hacer se resuelve borrando el guardián.
        self.assertIn(ENV_SPEND_DIR, str(ctx.exception))
        self.assertIn(str(RUTA_REAL / "events.jsonl"), str(ctx.exception))

    def test_la_ruta_real_disfrazada_tambien_revienta(self):
        """`.resolve()` no es decorativo: `ai_server/../cache/spend` es la
        misma carpeta, y sin resolver colaría."""
        disfraz = RAIZ_REPO / "ai_server" / ".." / "cache" / "spend"
        self.assertNotEqual(str(disfraz), str(RUTA_REAL))
        with self.assertRaises(RuntimeError):
            SpendTracker(disfraz)

    def test_el_ledger_de_OTRO_checkout_tambien_revienta(self):
        """La negativa es por FORMA, no por checkout (hallazgo H2 de QA).

        `RUTA_REAL` sale del `__file__` del módulo que corre, así que desde un
        worktree el ledger del checkout principal no era «el real» para nadie:
        `NEFAN_SPEND_DIR=/home/al/code/ne-fan/cache/spend` se construía sin
        quejarse y la suite le metía 43 eventos. En esta casa se trabaja en
        worktrees a diario y las rutas absolutas se copian entre terminales.
        """
        with tempfile.TemporaryDirectory() as tmp:
            otro = Path(tmp) / "otro-checkout" / "cache" / "spend"
            otro.mkdir(parents=True)
            self.assertNotEqual(otro.resolve(), RUTA_REAL)
            with self.assertRaises(RuntimeError) as ctx:
                SpendTracker(otro)
            self.assertIn("OTRO checkout", str(ctx.exception))
            self.assertIn(ENV_SPEND_DIR, str(ctx.exception))

    def test_la_forma_es_cache_barra_spend_y_nada_mas(self):
        """Ni de menos (un `spend/` suelto no es un ledger) ni de más: lo que se
        rechaza es exactamente `…/cache/spend`, que es como lo compone
        `raiz_del_ledger`. Un `mktemp -d` no puede acabar así."""
        self.assertTrue(parece_ledger_de_verdad(Path("/x/cache/spend")))
        self.assertFalse(parece_ledger_de_verdad(Path("/x/spend")))
        self.assertFalse(parece_ledger_de_verdad(Path("/x/cache/spends")))
        self.assertFalse(parece_ledger_de_verdad(Path("/tmp/tmpab12cd34")))

    def test_un_temporal_se_construye_sin_quejarse(self):
        with tempfile.TemporaryDirectory() as tmp:
            spend = SpendTracker(Path(tmp))
            spend.add(0.24, "un herrero de pelo cano", "remote-gen")
            self.assertAlmostEqual(spend.total_usd(), 0.24, places=4)

    def test_raiz_del_ledger_lee_la_variable(self):
        self.assertEqual(raiz_del_ledger({}), RUTA_REAL)
        self.assertEqual(raiz_del_ledger({ENV_SPEND_DIR: "/tmp/nefan-ledger"}),
                         Path("/tmp/nefan-ledger"))
        # Relativa: contra la raíz del repo, no contra el cwd de quien arranca.
        self.assertEqual(raiz_del_ledger({ENV_SPEND_DIR: "cache/otro"}),
                         RAIZ_REPO / "cache" / "otro")

    def test_variable_en_blanco_es_fail_loud(self):
        """Puesta pero vacía NO es «sin override»: devolver la ruta real ahí
        sería justo lo que la variable existe para evitar."""
        for blanco in ("", "   ", "\t"):
            with self.assertRaises(RuntimeError) as ctx:
                raiz_del_ledger({ENV_SPEND_DIR: blanco})
            self.assertIn(ENV_SPEND_DIR, str(ctx.exception))


class DevStatusEndpointTest(unittest.TestCase):
    def test_dev_status_shape(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers.cache_assets import router

        app = FastAPI()
        app.include_router(router)
        old_config = deps.config
        deps.config = {
            "surface_model": "nano-banana-pro",
            "sprite_skin_model": "gpt-image-2",
            "usd_eur_rate": 0.86,
        }
        try:
            res = TestClient(app).get("/dev/status")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertIn("enabled", body["api_cache"])
            self.assertIn("total_usd", body["spend"])
            self.assertEqual(body["config"]["usd_eur_rate"], 0.86)
            self.assertIn("meshy", body["keys"])
            self.assertIsInstance(body["keys"]["fal"], bool)
        finally:
            deps.config = old_config

    def test_dev_status_censo_de_claves(self):
        """El WIRE de /dev/status, clave a clave, contra su contrato TS
        (nefan-core/src/contracts/remote-gen.ts, `DevStatus`).

        Existe porque renombrar `config.surface_model` o
        `config.sprite_skin_model` en el DICT DE SALIDA de dev_status pasaba
        callado (#319): la tupla de validación de cache_assets.py ya rompía
        con 500, pero el nombre que viaja por el cable —el que lee
        dev-status-panel.ts— podía divergir sin que ningún test lo dijera.
        El censo es el mismo patrón que test_sprite_forge_adapter (sorted ==
        lista exacta): una clave que sobre O que falte rompe, no solo las
        ausentes. Los dos modelos se afirman además POR VALOR, para cazar un
        cruce entre claves (surface con el modelo de skins) que el censo solo
        no vería.

        Límite honesto: esto ata Python → contrato tal como está ESCRITO
        AQUÍ. Un rename en el contrato TS sigue necesitando mano humana para
        llegar a esta lista — la dirección TS → fake ya la ata el typecheck
        de labs (#309)."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers.cache_assets import router

        app = FastAPI()
        app.include_router(router)
        old_config = deps.config
        deps.config = {
            "surface_model": "nano-banana-pro",
            "sprite_skin_model": "gpt-image-2",
            "usd_eur_rate": 0.86,
        }
        try:
            body = TestClient(app).get("/dev/status").json()
            self.assertEqual(sorted(body), ["api_cache", "config", "keys", "spend"])
            self.assertEqual(
                sorted(body["config"]),
                ["sprite_skin_model", "surface_model", "usd_eur_rate"],
            )
            self.assertEqual(body["config"]["surface_model"], "nano-banana-pro")
            self.assertEqual(body["config"]["sprite_skin_model"], "gpt-image-2")
            self.assertEqual(sorted(body["keys"]), ["fal", "meshy"])
        finally:
            deps.config = old_config

    def test_dev_status_fails_loud_without_config(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers.cache_assets import router

        app = FastAPI()
        app.include_router(router)
        old_config = deps.config
        deps.config = {}
        try:
            self.assertEqual(TestClient(app).get("/dev/status").status_code, 503)
            # Snapshot viejo sin usd_eur_rate: error explícito, no KeyError.
            deps.config = {"surface_model": "x", "sprite_skin_model": "z"}
            res = TestClient(app).get("/dev/status")
            self.assertEqual(res.status_code, 500)
            self.assertIn("usd_eur_rate", res.json()["detail"])
        finally:
            deps.config = old_config


if __name__ == "__main__":
    unittest.main()
