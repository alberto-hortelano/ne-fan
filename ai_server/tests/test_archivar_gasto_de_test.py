"""El barrido de gasto de test del ledger (`ai_server/tools/archivar_gasto_de_test.py`).

Un guion que se corre a mano sobre el fichero que dice cuánto dinero se ha
gastado. Se prueba por eso, y lo que se fija es lo que costaría caro:

  1. **El criterio se DERIVA de las fixtures canónicas**, no de una cadena
     copiada aquí. Si el prompt de la fixture cambia, el criterio cambia solo.
  2. **No se selecciona por parecido.** `hero: un herrero` NO es
     `hero: un herrero de pelo cano`: el criterio es «contiene el prompt de la
     fixture», y un evento vecino se queda donde está. En el ledger real hay
     1189 eventos así, y llevárselos por delante habría sido irreversible.
  3. **Dry-run no toca un byte.** Es el defecto.
  4. **Nunca borra**: lo movido está entero, byte a byte, en el archivo.
  5. **Rerunnable**: la segunda corrida no mueve nada.
  6. **Fail-loud** con un criterio peligroso (prompt genérico), sin criterio
     (fixtures ausentes) y con el ledger cambiando bajo los pies.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests
"""

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

_TOOL = Path(__file__).resolve().parents[1] / "tools" / "archivar_gasto_de_test.py"
_spec = importlib.util.spec_from_file_location("archivar_gasto_de_test", _TOOL)
tool = importlib.util.module_from_spec(_spec)
sys.modules["archivar_gasto_de_test"] = tool
_spec.loader.exec_module(tool)

FIXTURES_REALES = Path(__file__).resolve().parents[2] / "nefan-core" / "data" / "contract" / "fixtures" / "sprite-forge"


class CriterioTest(unittest.TestCase):
    def test_el_prompt_sale_de_las_fixtures_canonicas(self):
        """La cadena no está escrita en el guion: se lee de la respuesta REAL
        del servicio que hay commiteada en el repo."""
        self.assertEqual(tool.prompts_de_test(), ["un herrero de pelo cano"])

    def test_cambiar_la_fixture_cambia_el_criterio(self):
        """Derivado significa esto: otra fixture, otro criterio. Con la cadena
        copiada en el guion este test saldría rojo."""
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "skins.json").write_text(
                json.dumps({"meta": {"skin": {"prompt": "una alquimista de guantes largos"}}}))
            self.assertEqual(tool.prompts_de_test(Path(tmp)), ["una alquimista de guantes largos"])

    def test_sin_prompts_no_hay_criterio(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "vacia.json").write_text('{"service": "sprite-forge"}')
            with self.assertRaises(RuntimeError) as ctx:
                tool.prompts_de_test(Path(tmp))
            self.assertIn("criterio", str(ctx.exception))

    def test_un_prompt_generico_para_el_guion(self):
        """Es dinero: un criterio de 3 letras seleccionaría gasto real."""
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "f.json").write_text(json.dumps({"meta": {"skin": {"prompt": "x"}}}))
            with self.assertRaises(RuntimeError) as ctx:
                tool.prompts_de_test(Path(tmp))
            self.assertIn("genérico", str(ctx.exception))

    def test_fixtures_ausentes_es_fail_loud(self):
        with self.assertRaises(RuntimeError):
            tool.prompts_de_test(FIXTURES_REALES / "no-existe")

    def test_el_criterio_vivo_no_barre_arte_real(self):
        """Los seis casos EXACTOS con los que QA tumbó el `contains` (H1).

        Están construidos con la forma que emite producción
        (`f"hero: {prompt[:50]}"`, `f"skin {anim}: {prompt[:44]}"`), y tres de
        ellos se barrían: un NPC de jugador que empieza igual y sigue, su
        locomoción, y uno que contiene el prompt en medio. El cuarto —un atlas—
        también, y ni siquiera lo pide un test de sprite-forge.
        """
        vivo = tool.prompts_de_test()  # ['un herrero de pelo cano']
        de_test = [
            "hero: un herrero de pelo cano",
            "skin walk: un herrero de pelo cano",
            "skin run: un herrero de pelo cano",
            "skin idle: un herrero de pelo cano",   # cualquier anim, no solo las tres vistas
        ]
        arte_real = [
            "hero: un herrero de pelo cano y delantal de cuero quemad",
            "skin walk: un herrero de pelo cano y delantal de cuero",
            "hero: retrato de un herrero de pelo cano, forja de Roble",
            "atlas d0: un herrero de pelo cano",
            "hero: un herrero de pelo negro, forja de Robledo",
            "hero: un herrero de la aldea del norte",
        ]
        for what in de_test:
            self.assertTrue(tool.es_de_test({"what": what}, vivo), f"debería barrerse: {what}")
        for what in arte_real:
            self.assertFalse(tool.es_de_test({"what": what}, vivo), f"NO debería barrerse: {what}")

    def test_las_formas_salen_del_prompt_y_se_truncan_como_produccion(self):
        """`hero:` recorta a 50 y `skin <anim>:` a 44. Si el patrón no truncara,
        un prompt largo no casaría con NINGÚN evento y el barrido saldría vacío
        —silenciosamente— sobre un ledger sucio."""
        largo = "un herrero de pelo cano con un delantal de cuero curtido y remaches de bronce"
        pat = tool.formas_exactas(largo)
        self.assertTrue(pat.match(f"hero: {largo[:50]}"))
        self.assertTrue(pat.match(f"skin walk: {largo[:44]}"))
        self.assertFalse(pat.match(f"hero: {largo}"))


class FixturaRetiradaTest(unittest.TestCase):
    """El segundo criterio: lotes cuya fixture ya no está en el repo.

    No se puede derivar lo que se fue con su commit, así que se DECLARA — y por
    eso las exigencias son otras: procedencia escrita, ventana de fechas que se
    comprueba, e igualdad EXACTA en vez de `contains`. El prompt retirado
    (`un herrero`) es corto y genérico: con `contains`, un `hero: un herrero de
    la aldea del norte` pedido por un jugador de verdad se iría al archivo.
    """

    LOTE = tool.FIXTURES_RETIRADAS[0]

    def test_cada_lote_declara_su_procedencia_y_su_ventana(self):
        for lote in tool.FIXTURES_RETIRADAS:
            for campo in ("id", "whats", "commit", "desde", "hasta", "procedencia"):
                self.assertTrue(lote.get(campo), f"{lote.get('id')} sin {campo}")
            self.assertLessEqual(lote["desde"], lote["hasta"])
            self.assertIn(lote["commit"], lote["procedencia"])

    def test_selecciona_por_igualdad_exacta(self):
        for what in self.LOTE["whats"]:
            self.assertTrue(tool.es_de_test({"what": what}, []))

    def test_un_prompt_real_que_lo_contiene_NO_se_selecciona(self):
        """Este es el test que impide volver a `contains`. Un prompt de juego
        empieza igual y sigue: el evento no es de test y no se toca."""
        for what in ("hero: un herrero de la aldea del norte",
                     "skin walk: un herrero manco con delantal de cuero",
                     "hero: un herrerox"):
            self.assertFalse(tool.es_de_test({"what": what}, []), what)

    def test_un_evento_fuera_de_la_ventana_para_el_guion(self):
        """La ventana es la mitad COMPROBABLE de la procedencia: si aparece uno
        en otra fecha, la fuga no fue la que dice el commit declarado."""
        fuera = time.mktime(time.strptime("2026-09-03", "%Y-%m-%d"))
        pares = [("{}", {"t": fuera, "usd": 0.24, "what": self.LOTE["whats"][0]})]
        with self.assertRaises(RuntimeError) as ctx:
            tool.comprobar_ventanas(pares)
        self.assertIn(self.LOTE["id"], str(ctx.exception))
        self.assertIn("2026-09-03", str(ctx.exception))

    def test_dentro_de_la_ventana_no_se_queja(self):
        dentro = time.mktime(time.strptime("2026-08-26", "%Y-%m-%d"))
        tool.comprobar_ventanas([("{}", {"t": dentro, "usd": 0.24, "what": self.LOTE["whats"][0]})])


class BarridoTest(unittest.TestCase):
    #: Un ledger de mentira con las cuatro poblaciones que importan: gasto de la
    #: fixture VIVA, gasto de la fixture RETIRADA, gasto REAL, y el vecino que
    #: CONTIENE el prompt retirado pero no es él.
    #: `t` importa: el lote retirado declara una ventana de fechas y se comprueba.
    DENTRO_VENTANA = time.mktime(time.strptime("2026-08-26", "%Y-%m-%d"))
    DE_TEST = [
        ("hero: un herrero de pelo cano", 0.24, None),
        ("skin walk: un herrero de pelo cano", 0.24, None),
        ("skin run: un herrero de pelo cano", 0.24, None),
        ("hero: un herrero", 0.24, DENTRO_VENTANA),
        ("skin walk: un herrero", 0.96, DENTRO_VENTANA),
        ("skin run: un herrero", 0.96, DENTRO_VENTANA),
    ]
    SE_QUEDAN = [
        ("hero: un herrero de la aldea del norte", 0.24, None),
        ("atlas d0: Blas, el tabernero", 0.17, None),
        ("style acero_neon/plaza", 0.19, None),
    ]

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        raiz = Path(self._tmp.name)
        self.ledger = raiz / "cache" / "spend" / "events.jsonl"
        self.ledger.parent.mkdir(parents=True)
        self.archivo = raiz / "archivo" / "cache" / "spend"
        lineas = []
        for what, usd, t in self.DE_TEST + self.SE_QUEDAN:
            lineas.append(json.dumps({"t": t if t else time.time(), "usd": usd, "what": what,
                                      "service": "remote-gen"}, ensure_ascii=False))
        self.crudo = "".join(linea + "\n" for linea in lineas)
        self.ledger.write_text(self.crudo, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def _correr(self, *extra: str) -> int:
        """Corre el guion y guarda su informe en `self.salida` (es lo que se
        lee antes de decidir `--ejecutar`, así que también se afirma)."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            codigo = tool.main(["--ledger", str(self.ledger), "--archivo", str(self.archivo),
                                "--fecha", "2026-09-04", *extra])
        self.salida = buf.getvalue()
        return codigo

    @property
    def _destino(self) -> Path:
        return self.archivo / "events-de-test-2026-09-04.jsonl"

    def test_dry_run_no_toca_un_byte(self):
        self.assertEqual(self._correr(), 0)
        self.assertEqual(self.ledger.read_text(encoding="utf-8"), self.crudo)
        self.assertFalse(self._destino.exists())
        # El informe dice qué se llevaría y qué quedaría: es lo que se lee
        # ANTES de autorizar, y si mintiera nadie se enteraría.
        self.assertIn("A ARCHIVAR: 6 eventos · $2.88", self.salida)
        self.assertIn("SE QUEDAN:  3 eventos · $0.60", self.salida)
        self.assertIn("DRY-RUN", self.salida)
        # Y dice CON QUÉ criterio: el derivado y el declarado, con procedencia.
        self.assertIn("fixture VIVA", self.salida)
        self.assertIn("fixture RETIRADA sprite-forge-a31a6f4", self.salida)
        self.assertIn("2026-08-24→2026-08-31", self.salida)

    def test_ejecutar_mueve_solo_lo_de_test(self):
        self.assertEqual(self._correr("--ejecutar"), 0)
        quedan = [json.loads(x)["what"] for x in self.ledger.read_text().splitlines() if x.strip()]
        self.assertEqual(quedan, [w for w, _, _ in self.SE_QUEDAN])
        movidos = [json.loads(x)["what"] for x in self._destino.read_text().splitlines() if x.strip()]
        self.assertEqual(movidos, [w for w, _, _ in self.DE_TEST])

    def test_el_vecino_que_se_parece_no_se_lo_lleva(self):
        """Los dos parecidos, en las dos direcciones. `un herrero` es prefijo de
        `un herrero de pelo cano` (y el criterio vivo va por `contains`, así que
        no lo alcanza); y `hero: un herrero de la aldea del norte` CONTIENE el
        `what` retirado entero (y el criterio retirado va por igualdad, así que
        tampoco). Un `contains` en el segundo se habría llevado arte pagado."""
        self._correr("--ejecutar")
        quedan = self.ledger.read_text()
        self.assertIn("hero: un herrero de la aldea del norte", quedan)
        self.assertNotIn("de pelo cano", quedan)
        self.assertNotIn('"what": "hero: un herrero"', quedan)

    def test_destino_propio_no_mezcla_dos_procedencias(self):
        otro = self.archivo / "events-de-otro-lote.jsonl"
        self.assertEqual(self._correr("--ejecutar", "--destino", str(otro)), 0)
        self.assertFalse(self._destino.exists())
        self.assertEqual(len([x for x in otro.read_text().splitlines() if x.strip()]), len(self.DE_TEST))

    def test_se_niega_a_duplicar_en_el_archivo(self):
        """Con el ledger restaurado de una copia, el mismo lote al mismo destino
        NO se escribe dos veces: se niega entero, como sus dos hermanas. Sin
        esto QA midió 426 líneas con 213 únicas, y el guion decía `Archivados`
        las dos veces."""
        self.assertEqual(self._correr("--ejecutar"), 0)
        antes = self._destino.read_text()
        self.ledger.write_text(self.crudo, encoding="utf-8")   # alguien restaura de la copia
        self.assertEqual(self._correr("--ejecutar"), 1)
        self.assertEqual(self._destino.read_text(), antes, "el archivo no se toca")
        self.assertEqual(self.ledger.read_text(), self.crudo, "el ledger tampoco")

    def test_nada_se_borra(self):
        antes = [x for x in self.crudo.splitlines() if x.strip()]
        self._correr("--ejecutar")
        despues = ([x for x in self.ledger.read_text().splitlines() if x.strip()]
                   + [x for x in self._destino.read_text().splitlines() if x.strip()])
        # Byte a byte: la línea archivada es la que se escribió, no una
        # reserialización con las claves en otro orden.
        self.assertEqual(sorted(antes), sorted(despues))

    def test_correrlo_dos_veces_no_mueve_nada_la_segunda(self):
        self._correr("--ejecutar")
        ledger2 = self.ledger.read_text()
        archivo2 = self._destino.read_text()
        self.assertEqual(self._correr("--ejecutar"), 0)
        self.assertEqual(self.ledger.read_text(), ledger2)
        self.assertEqual(self._destino.read_text(), archivo2)

    def test_una_linea_corrupta_para_el_guion(self):
        with open(self.ledger, "a", encoding="utf-8") as f:
            f.write("esto no es json\n")
        with self.assertRaises(RuntimeError):
            self._correr("--ejecutar")
        self.assertFalse(self._destino.exists())

    def test_ledger_inexistente_no_revienta(self):
        self.ledger.unlink()
        self.assertEqual(self._correr("--ejecutar"), 0)


if __name__ == "__main__":
    unittest.main()
