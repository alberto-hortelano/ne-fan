"""Tests del SpendTracker (contador de gasto del panel de dev) y del endpoint
agregado GET /dev/status.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v

La variable no es adorno: sin ella este módulo no llega ni a importarse (#392).
El ledger es dinero, y hasta hoy la suite le añadía 43 eventos de gasto
inventado por corrida."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from spend_tracker import (  # noqa: E402
    ENV_SPEND_DIR,
    PROCEDENCIAS,
    RAIZ_REPO,
    RUTA_REAL,
    LedgerIlegible,
    SpendTracker,
    _remedio_para_ledger_viejo,
    parece_ledger_de_verdad,
    procedencia_segun_api,
    raiz_del_ledger,
)

CEROS = {"usd": 0.0, "call_count": 0}


class SpendTrackerTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.spend = SpendTracker(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_empty_status(self):
        st = self.spend.status()
        self.assertEqual(
            st,
            {"total_usd": 0.0, "call_count": 0, "calls": [],
             "por_procedencia": {"real": CEROS, "fixture": CEROS}},
        )
        self.assertEqual(self.spend.total_usd(), 0.0)

    def test_add_accumulates(self):
        self.spend.add(0.17, "plató posada", "remote-gen", procedencia="real")
        self.spend.add(0.18, "tile 0,1", "remote-gen", procedencia="real")
        self.spend.add(0.03, "peel: mesa", "remote-gen", procedencia="real")
        st = self.spend.status()
        self.assertEqual(st["call_count"], 3)
        self.assertAlmostEqual(st["total_usd"], 0.38, places=4)
        self.assertEqual(st["calls"][0]["what"], "plató posada")
        self.assertEqual(st["calls"][2]["service"], "remote-gen")
        self.assertEqual(st["calls"][2]["procedencia"], "real")
        self.assertIn("t", st["calls"][0])

    def test_status_limit_keeps_latest(self):
        for i in range(20):
            self.spend.add(0.01, f"call-{i}", "remote-gen", procedencia="real")
        st = self.spend.status(limit=5)
        self.assertEqual(st["call_count"], 20)
        self.assertEqual(len(st["calls"]), 5)
        self.assertEqual(st["calls"][-1]["what"], "call-19")

    def test_multi_instance_shares_file(self):
        """Dos instancias sobre el mismo directorio comparten el ledger por
        disco (append-only): una ve lo que otra escribió, sin IPC."""
        other = SpendTracker(Path(self._tmp.name))
        self.spend.add(0.17, "a", "remote-gen", procedencia="real")
        other.add(0.03, "b", "remote-gen", procedencia="real")
        self.assertAlmostEqual(self.spend.total_usd(), 0.20, places=4)
        self.assertEqual(other.status()["call_count"], 2)


class ProcedenciaTest(unittest.TestCase):
    """Cada evento dice de dónde salió el dólar (#426), y el que no lo dice no
    se escribe. Es lo que convierte la limpieza del ledger de arqueología sobre
    el texto del prompt en un filtro por campo."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.spend = SpendTracker(Path(self._tmp.name))
        self.fichero = Path(self._tmp.name) / "events.jsonl"

    def tearDown(self):
        self._tmp.cleanup()

    def test_add_sin_procedencia_es_TypeError_y_no_escribe(self):
        # La garantía va en la FIRMA (keyword-only sin defecto), no en una
        # comprobación dentro: un `add` viejo revienta antes de tocar el disco.
        with self.assertRaises(TypeError):
            self.spend.add(0.24, "hero: x", "remote-gen")  # type: ignore[call-arg]
        self.assertFalse(self.fichero.exists())

    def test_una_procedencia_fuera_del_enum_es_ValueError_y_no_escribe(self):
        # `banco` y `fake-ai-server` NO escriben el ledger: no son valores.
        for mala in ("banco", "fake-ai-server", "desconocida", "", None):
            with self.subTest(procedencia=mala):
                with self.assertRaises(ValueError) as ctx:
                    self.spend.add(0.24, "hero: x", "remote-gen", procedencia=mala)  # type: ignore[arg-type]
                self.assertIn("cerrado", str(ctx.exception))
        self.assertFalse(self.fichero.exists())

    def test_el_enum_es_exactamente_real_y_fixture(self):
        # Solo valores con escritor. Añadir uno aquí exige un escritor nuevo.
        self.assertEqual(PROCEDENCIAS, ("real", "fixture"))

    def test_el_evento_en_disco_lleva_el_campo(self):
        self.spend.add(0.24, "hero: x", "remote-gen", procedencia="fixture")
        linea = json.loads(self.fichero.read_text().strip())
        self.assertEqual(sorted(linea), ["procedencia", "service", "t", "usd", "what"])
        self.assertEqual(linea["procedencia"], "fixture")

    def test_total_usd_ignora_las_fixtures(self):
        self.spend.add(0.24, "hero: x", "remote-gen", procedencia="fixture")
        self.spend.add(0.10, "style s/r", "remote-gen", procedencia="real")
        self.spend.add(0.24, "skin walk: x", "remote-gen", procedencia="fixture")
        self.assertAlmostEqual(self.spend.total_usd(), 0.10, places=4)
        st = self.spend.status()
        self.assertAlmostEqual(st["total_usd"], 0.10, places=4)
        self.assertEqual(st["call_count"], 1)
        # `calls` sí trae las tres, cada una con su campo: es lo que se pinta.
        self.assertEqual([c["procedencia"] for c in st["calls"]], ["fixture", "real", "fixture"])
        self.assertEqual(st["por_procedencia"]["real"], {"usd": 0.10, "call_count": 1})
        self.assertEqual(st["por_procedencia"]["fixture"], {"usd": 0.48, "call_count": 2})

    def test_por_procedencia_trae_las_dos_claves_aunque_una_este_a_cero(self):
        self.spend.add(0.24, "hero: x", "remote-gen", procedencia="fixture")
        self.assertEqual(
            self.spend.status()["por_procedencia"],
            {"real": CEROS, "fixture": {"usd": 0.24, "call_count": 1}},
        )

    def test_un_ledger_anterior_a_426_no_se_suma_y_dice_como_archivarlo(self):
        # La forma de los 187 eventos vivos hasta hoy: cuatro claves, sin
        # `procedencia`. Ni se migra ni se marca `desconocida`: se archiva como
        # en T9, y el mensaje trae el comando.
        self.fichero.write_text(
            json.dumps({"t": 1.0, "usd": 0.24, "what": "hero: x", "service": "remote-gen"}) + "\n"
        )
        for lectura in (self.spend.total_usd, self.spend.status):
            with self.subTest(lectura=lectura.__name__):
                with self.assertRaises(LedgerIlegible) as ctx:
                    lectura()
                msg = str(ctx.exception)
                self.assertIn("sin `procedencia`", msg)
                self.assertIn("archivo/cache/spend", msg)
                self.assertIn("events-sin-procedencia-", msg)
                self.assertIn("mv ", msg)

    def test_una_procedencia_desconocida_en_disco_tambien_es_ilegible(self):
        self.fichero.write_text(
            json.dumps({"t": 1.0, "usd": 0.24, "what": "x", "service": "remote-gen",
                        "procedencia": "banco"}) + "\n"
        )
        with self.assertRaises(LedgerIlegible) as ctx:
            self.spend.total_usd()
        self.assertIn("'banco'", str(ctx.exception))

    def test_una_linea_que_no_es_json_es_ilegible_con_su_numero_de_linea(self):
        self.spend.add(0.10, "a", "remote-gen", procedencia="real")
        with open(self.fichero, "a") as f:
            f.write("{esto no es json\n")
        with self.assertRaises(LedgerIlegible) as ctx:
            self.spend.total_usd()
        self.assertIn(":2 no es JSON", str(ctx.exception))

    # ── H2 de la QA: `_events()` valida TODO lo que se va a leer, no solo
    #    `procedencia`. Antes, una línea con el campo nuevo pero con el importe
    #    roto salía como KeyError/TypeError anónimo desde `_suma` —o se sumaba
    #    sin más—, y en `/dev/status` eso es el 500 mudo que el plan cerró.
    def _escribir(self, evento):
        self.fichero.write_text(json.dumps(evento) + "\n")

    def test_un_evento_sin_usd_o_con_usd_que_no_es_numero_es_ilegible(self):
        for roto in (None, "0.5", [], {}, True):
            with self.subTest(usd=roto):
                e = {"t": 1.0, "what": "x", "service": "remote-gen", "procedencia": "real"}
                if roto is not None:
                    e["usd"] = roto
                self._escribir(e)
                with self.assertRaises(LedgerIlegible) as ctx:
                    self.spend.total_usd()
                msg = str(ctx.exception)
                self.assertIn(":1 tiene `usd`", msg)
                self.assertIn("no es un número", msg)

    def test_un_usd_negativo_es_ilegible_y_no_se_resta_del_total(self):
        # Antes se SUMABA: un −3 escondía tres dólares de gasto real.
        self._escribir({"t": 1.0, "usd": -3, "what": "x", "service": "remote-gen",
                        "procedencia": "real"})
        with self.assertRaises(LedgerIlegible) as ctx:
            self.spend.total_usd()
        self.assertIn("negativo", str(ctx.exception))

    def test_una_linea_que_es_JSON_pero_no_un_objeto_lo_dice_por_su_nombre(self):
        # Antes decía «es un evento sin `procedencia`», que no es lo que pasa:
        # un mensaje que describe mal la avería manda a arreglar otra cosa.
        for roto, nombre in (([1, 2], "list"), ("hola", "str"), (7, "int")):
            with self.subTest(linea=roto):
                self.fichero.write_text(json.dumps(roto) + "\n")
                with self.assertRaises(LedgerIlegible) as ctx:
                    self.spend.total_usd()
                msg = str(ctx.exception)
                self.assertIn(f":1 no es un objeto JSON, es {nombre}", msg)
                self.assertNotIn("procedencia`", msg)

    def test_add_no_puede_escribir_un_importe_que_luego_no_se_deja_leer(self):
        # La otra mitad de H2: escritor y lector admiten lo MISMO, o el propio
        # tracker fabrica el fichero que después declara ilegible.
        for malo in (-0.01, float("nan")):
            with self.subTest(usd=malo):
                with self.assertRaises(ValueError) as ctx:
                    self.spend.add(malo, "x", "remote-gen", procedencia="real")
                self.assertIn("no es una cantidad pagable", str(ctx.exception))
        self.assertFalse(self.fichero.exists())
        # Y el cero sí se escribe: una llamada gratis es un hecho del ledger.
        self.spend.add(0, "gratis", "remote-gen", procedencia="fixture")
        self.assertEqual(len(self.spend.status()["calls"]), 1)

    # ── H3 de la QA: el remedio del 500 no supone la forma `<raíz>/cache/spend`
    def test_el_remedio_archiva_en_el_checkout_del_ledger_si_tiene_su_forma(self):
        ruta = Path("/un/checkout/cache/spend/events.jsonl")
        self.assertIn("mkdir -p /un/checkout/archivo/cache/spend ", _remedio_para_ledger_viejo(ruta))

    def test_el_remedio_de_un_ledger_fuera_de_cache_spend_apunta_al_repo(self):
        # Antes subía tres niveles a ciegas: `/tmp/x/events.jsonl` proponía
        # `mv` a `/tmp/archivo/cache/spend/`, un sitio que no existe por nada.
        remedio = _remedio_para_ledger_viejo(Path("/tmp/x/events.jsonl"))
        self.assertIn(f"mkdir -p {RAIZ_REPO / 'archivo' / 'cache' / 'spend'} ", remedio)
        self.assertNotIn("/tmp/archivo", remedio)

    def test_procedencia_segun_api(self):
        # Lo que dice sprite-forge → lo que se apunta. `fixture` y `fake` no
        # facturan; cualquier OTRO nombre es un proveedor y cuenta como dinero
        # (un proveedor nuevo sale como gasto real, nunca desaparece).
        self.assertEqual(procedencia_segun_api("fixture"), "fixture")
        self.assertEqual(procedencia_segun_api("fake"), "fixture")
        self.assertEqual(procedencia_segun_api("meshy"), "real")
        self.assertEqual(procedencia_segun_api("openai"), "real")
        self.assertEqual(procedencia_segun_api("loquesea"), "real")

    def test_procedencia_segun_api_sin_api_lanza(self):
        for ausente in (None, "", "   ", 3, {"api": "fixture"}):
            with self.subTest(api=ausente):
                with self.assertRaises(ValueError) as ctx:
                    procedencia_segun_api(ausente)
                self.assertIn("`api` ausente", str(ctx.exception))

    def test_procedencia_segun_api_recorta_espacios_pero_NO_baja_mayusculas(self):
        # H4 de la QA, escrito como aserto para que sea una DECISIÓN y no un
        # descuido que alguien «arregle» con un `.lower()`. La dirección es la
        # segura: lo que no reconocemos cuenta como dinero y nunca desaparece.
        self.assertEqual(procedencia_segun_api(" fake "), "fixture")
        self.assertEqual(procedencia_segun_api("FIXTURE"), "real")
        self.assertEqual(procedencia_segun_api("Fake"), "real")


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
            spend.add(0.24, "un herrero de pelo cano", "remote-gen", procedencia="real")
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
            # `spend` clave a clave (#426): `por_procedencia` con las DOS
            # procedencias siempre, que es lo que el `satisfies` del fake exige.
            self.assertEqual(
                sorted(body["spend"]), ["call_count", "calls", "por_procedencia", "total_usd"]
            )
            self.assertEqual(sorted(body["spend"]["por_procedencia"]), ["fixture", "real"])
            for p in ("real", "fixture"):
                self.assertEqual(sorted(body["spend"]["por_procedencia"][p]), ["call_count", "usd"])
            self.assertEqual(
                sorted(body["config"]),
                ["sprite_skin_model", "surface_model", "usd_eur_rate"],
            )
            self.assertEqual(body["config"]["surface_model"], "nano-banana-pro")
            self.assertEqual(body["config"]["sprite_skin_model"], "gpt-image-2")
            self.assertEqual(sorted(body["keys"]), ["fal", "meshy"])
        finally:
            deps.config = old_config

    def test_dev_status_sobre_un_ledger_anterior_a_426_es_500_con_el_remedio(self):
        """Un evento sin `procedencia` no se suma a medias ni se trata como
        real: /dev/status contesta 500 con el `mv` de archivo, no un total."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from unittest import mock

        from deps import deps
        from routers import cache_assets

        app = FastAPI()
        app.include_router(cache_assets.router)
        old_config = deps.config
        deps.config = {
            "surface_model": "nano-banana-pro",
            "sprite_skin_model": "gpt-image-2",
            "usd_eur_rate": 0.86,
        }
        try:
            with tempfile.TemporaryDirectory() as tmp:
                viejo = SpendTracker(Path(tmp))
                (Path(tmp) / "events.jsonl").write_text(
                    json.dumps({"t": 1.0, "usd": 0.24, "what": "hero: x", "service": "remote-gen"}) + "\n"
                )
                with mock.patch.object(cache_assets, "SPEND", viejo):
                    res = TestClient(app).get("/dev/status")
                self.assertEqual(res.status_code, 500, res.text)
                self.assertIn("archivo/cache/spend", res.json()["detail"])
                self.assertIn("mv ", res.json()["detail"])
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
