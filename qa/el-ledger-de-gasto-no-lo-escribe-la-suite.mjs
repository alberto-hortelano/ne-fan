#!/usr/bin/env node
/** EL LEDGER DE GASTO NO LO ESCRIBE LA SUITE (QA de T9 PR-3: #392).
 *
 *  `cache/spend/events.jsonl` es el número que se mira para decidir si se
 *  sigue gastando. Hasta #392, cada `python -m unittest discover -s
 *  ai_server/tests` le añadía 43 eventos y $10,32 de gasto INVENTADO, y la
 *  suite pasaba VERDE mientras lo hacía. Cuando se descubrió, el ledger llevaba
 *  desde el 2026-08-24 siendo un 95 % ruido: de 1616 eventos y $768,58, el
 *  gasto real eran 187 y $37,54.
 *
 *  El criterio del usuario es de estado, así que se comprueba corriendo, no
 *  leyendo: **correr la suite dos veces deja el ledger con el mismo número de
 *  líneas**. Los tests de `ai_server/tests/test_spend_tracker.py` afirman el
 *  constructor; esto afirma el efecto de la corrida entera, que es lo que ve
 *  quien mira el dinero.
 *
 *  Lo que se afirma:
 *   1 · LA NEGATIVA EN EL TIPO, sin escribir un byte: bajo `unittest`, nombrar
 *       el ledger real revienta y el mensaje trae la variable Y el remedio. Se
 *       prueba en sus cinco disfraces —sin variable, absoluta, relativa (que se
 *       resuelve contra la raíz del repo, no contra el cwd), con `..` por en
 *       medio, y un enlace simbólico— porque el `.resolve()` es la mitad del
 *       candado. Más el valor EN BLANCO, que no es «sin override».
 *   2 · PRODUCCIÓN SIGUE ARRANCANDO: sin `unittest` y sin variable, el
 *       singleton se construye sobre la ruta real. Un candado que rompiese
 *       remote-gen sería peor que la fuga.
 *   3 · LA SUITE, DOS VECES, CON la variable: verde las dos, el gasto de test
 *       aterriza en el temporal (mismo recuento en las dos corridas) y el
 *       ledger del checkout no cambia ni una línea.
 *   4 · LA SUITE, DOS VECES, SIN la variable: falla NOMBRÁNDOLA —olvidarla no
 *       es verde y sucio— y sigue sin tocar el ledger.
 *   5 · EL LEDGER DEL CHECKOUT, INTACTO: mismo tamaño, mismas líneas y mismo
 *       md5 al empezar y al terminar (o sigue sin existir, que también vale).
 *   6 · FUERA DE `unittest`, UN FORGE DE FIXTURES NO SUMA AL GASTO REAL (#426).
 *       El guardia de proceso (1-4) no cubre este camino: remote-gen en
 *       producción hablando con un sprite-forge que conteste `api: "fixture"`
 *       (los dos guiones que apuntan el adaptador a un forge propio corren así,
 *       sin `unittest` y sin la variable). Aquí se recorre ENTERO en un proceso
 *       sin `unittest` (se mide: si entra, `⊘`): un `http.server` con las cuatro
 *       fixtures canónicas, `skin_sprite_sheet_endpoint` llamado tal cual, y
 *       el ledger dice `procedencia: fixture` en cada evento, `total_usd() == 0`
 *       y el desglose `por_procedencia.fixture` con los 0,48 $ de las fixtures.
 *       El límite honesto: el ledger es un `checkout-falso/cache/spend` en el
 *       temporal —MISMA forma que el real—, porque fuera de `unittest` el
 *       constructor no consulta la forma (mismo camino de código) y «sin la
 *       variable» literal escribiría el dinero del checkout.
 *
 *  **La puerta del paso 3.** Este guion corre la suite, así que en un árbol SIN
 *  el arreglo la correría contra el ledger de verdad — sería el guion quien
 *  inventase el gasto. Por eso el paso 1 es una PUERTA: si la negativa no está,
 *  sale `⊘ SIN MEDIR` y no ejecuta nada más. Un candado que para ensuciar el
 *  dinero no es un candado.
 *
 *  EN NEGATIVO (probado el 2026-09-04 al escribirlo, en el worktree de QA):
 *  quitando el bloque `if root.resolve() == RUTA_REAL and "unittest" in
 *  sys.modules` de `spend_tracker.py`, el paso 1 cae entero y el guion sale con
 *  2 sin correr la suite —la puerta hace su trabajo—; con la negativa puesta y
 *  el `.resolve()` quitado, cae el disfraz relativo; y devolviendo `RUTA_REAL`
 *  con la variable en blanco, cae el caso del blanco. El paso 6 (tanda AB,
 *  medido el 2026-09-20 con las DOS averías —contarlas es lo que demuestra
 *  que las distingue—): con `procedencia_segun_api` devolviendo siempre
 *  `"real"` caen CUATRO del paso 6 —«todos fixture», «total real 0», el
 *  `/dev/status` y el desglose, porque el dinero de mentira desaparece del
 *  reparto en vez de quedar apartado— más los dos del paso 3, que con ese
 *  sabotaje tampoco pasa: 6 ✘ y EXIT=1. Con `total_usd()` sumando todo cae
 *  UNO solo del paso 6, «total real 0», y el `/dev/status` y el desglose
 *  siguen en pie: 3 ✘ y EXIT=1. La herramienta de retirada por texto que
 *  ocupaba este paso se JUBILÓ con #426 (se borró con su test): con el campo
 *  en el evento, la arqueología sobre el prompt no tiene sujeto.
 *
 *  CERO CRÉDITOS: no arranca ningún servicio, no abre un puerto y no llama a
 *  ninguna API. Todo lo que escribe vive en un `mkdtemp` que borra al salir.
 *
 *  Vive FUERA de `qa/guiones/` por lo mismo que
 *  `el-indice-del-store-se-prueba-sin-el-del-checkout.mjs`: no toca la página,
 *  y en la batería pagaría un Chromium por nada.
 *
 *  Uso:  node qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs
 *
 *  Salida: 0 todo verde · 1 alguna comprobación en rojo · 2 no llegó a medir.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { interpretePython } from "./lib/python.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(RAIZ, "cache", "spend", "events.jsonl");
const FIXTURES_FORGE = join(RAIZ, "nefan-core", "data", "contract", "fixtures", "sprite-forge");
const ENV_SPEND_DIR = "NEFAN_SPEND_DIR";

/** El intérprete: `NEFAN_PYTHON`, el `.venv` del checkout, el del checkout
 *  principal desde un worktree o el `python3` del sistema, en ese orden
 *  (`qa/lib/python.mjs`, misma regla que `ai_server/lint.sh`). */
const PY = interpretePython(RAIZ);

const fallos = [];
const expect = (desc, cond, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✘"} ${desc}${cond || !detalle ? "" : ` — ${detalle}`}`);
  if (!cond) fallos.push(desc);
};
class SinMedir extends Error {}

/** Corre python con un entorno controlado. `env` se MEZCLA sobre el del
 *  proceso, y un valor `null` BORRA la variable (no la pone en blanco: puesta y
 *  vacía es justo uno de los casos que se prueban). */
function py(codigo, env = {}) {
  const entorno = { ...process.env };
  delete entorno[ENV_SPEND_DIR];
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete entorno[k];
    else entorno[k] = v;
  }
  const r = spawnSync(PY, ["-c", codigo], { cwd: RAIZ, encoding: "utf8", env: entorno, timeout: 120_000 });
  return { code: r.status, out: `${r.stdout ?? ""}`, err: `${r.stderr ?? ""}` };
}

/** Con `NEFAN_SPEND_DIR` puesta a `valor` (o SIN ella si es `null`), y bajo
 *  `unittest`: ¿se puede construir el tracker? Recorre el camino entero
 *  —`raiz_del_ledger()` y luego el constructor—, que es por donde pasa el
 *  singleton al importarse.
 *
 *  Solo IMPORTA y construye: `__init__` no escribe ni crea el directorio, así
 *  que preguntarlo es gratis y seguro incluso apuntando al ledger de verdad. */
function construirBajoTest(valor) {
  return py(
    "import sys, json\n" +
      "sys.path.insert(0, 'ai_server')\n" +
      "import unittest  # noqa: F401 — el olfateo mide justo esto\n" +
      "try:\n" +
      "    import spend_tracker as st\n" +
      "    t = st.SpendTracker(st.raiz_del_ledger())\n" +
      "    print(json.dumps({'lanzo': False, 'root': str(t.root)}))\n" +
      "except RuntimeError as e:\n" +
      "    print(json.dumps({'lanzo': True, 'msg': str(e)}))\n",
    { [ENV_SPEND_DIR]: valor },
  );
}

function leerJson(r) {
  const linea = r.out.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(linea);
  } catch {
    throw new SinMedir(`la sonda de python no devolvió JSON (code=${r.code}): ${r.err.trim().slice(-400)}`);
  }
}

/** Foto del ledger del checkout: existe / líneas / md5. Es lo que se compara al
 *  final, y el `existe:false` también es una foto válida. */
function fotoDelLedger() {
  if (!existsSync(LEDGER)) return { existe: false };
  const crudo = readFileSync(LEDGER);
  return {
    existe: true,
    bytes: crudo.length,
    lineas: crudo.toString("utf8").split("\n").filter((l) => l.trim()).length,
    md5: createHash("md5").update(crudo).digest("hex"),
  };
}

const suite = (dir) => {
  const env = { ...process.env };
  if (dir === null) delete env[ENV_SPEND_DIR];
  else env[ENV_SPEND_DIR] = dir;
  const r = spawnSync(PY, ["-m", "unittest", "discover", "-s", "ai_server/tests"], {
    cwd: RAIZ,
    encoding: "utf8",
    env,
    timeout: 600_000,
  });
  return { code: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const eventos = (dir) => {
  const f = join(dir, "events.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
};

/** La sonda del paso 6. Argumentos: el directorio de fixtures de sprite-forge y
 *  dónde escribir los sheets. Sale con un JSON en la última línea. NO importa
 *  `unittest` ni `fastapi.testclient`; mide si algo lo trajo. */
const SONDA_FORGE_DE_FIXTURES = String.raw`
import asyncio, base64, json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, "ai_server")
fixtures, sheets_dir = Path(sys.argv[1]), Path(sys.argv[2])
fx = {n: json.loads((fixtures / f"{n}.json").read_text()) for n in ("sheets", "catalog", "identity", "skins")}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def _r(self, cuerpo):
        datos = json.dumps(cuerpo).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)
    def do_GET(self):
        self._r(fx["catalog"] if self.path == "/catalog" else {})
    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", 0)))
        self._r(fx.get(self.path.strip("/"), {}))

srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

from deps import deps
from routers import remote_generation as rg
import spend_tracker as st

class Store:
    def register_character(self, hero_key, hero=None, sheets=None):
        return {"ok": True}

deps.config.update({"sprite_forge_url": f"http://127.0.0.1:{srv.server_address[1]}", "sprite_skin_model": "gpt-image-2"})
deps.style_packs = None
deps.asset_manifest = Store()
rg.SKINNED_SHEETS_DIR = sheets_dir
rg._BASE_KEYS_INDEX = sheets_dir / "_base_keys.json"

body = rg.SkinSpriteSheetRequest(model="heroe", anim="walk", angle="frontal_8", prompt="un herrero de pelo cano")
status, detalle = 200, None
try:
    asyncio.run(rg.skin_sprite_sheet_endpoint(body))
except Exception as e:  # noqa: BLE001 — la sonda reporta, no decide
    status, detalle = getattr(e, "status_code", 500), str(e)[:300]
srv.shutdown()

f = st.SPEND.root / "events.jsonl"
eventos = [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []
estado = st.SPEND.status()
print(json.dumps({
    "unittest_cargado": "unittest" in sys.modules,
    "ledger_con_forma_real": st.parece_ledger_de_verdad(st.SPEND.root.resolve()),
    "root": str(st.SPEND.root),
    "status": status, "detalle": detalle,
    "eventos": eventos,
    "total_usd": st.SPEND.total_usd(),
    "status_total": estado["total_usd"], "status_calls": estado["call_count"],
    "por_procedencia": estado["por_procedencia"],
}))
`;

async function main() {
  console.log("▶ el ledger de gasto y la suite de tests\n");
  const antes = fotoDelLedger();
  console.log(
    `  · ledger del checkout: ${antes.existe ? `${antes.lineas} eventos, md5 ${antes.md5.slice(0, 8)}` : "no existe"}\n`,
  );

  const tmp = mkdtempSync(join(tmpdir(), "qa-ledger-"));
  try {
    // ── 1 · la negativa en el tipo, sin escribir un byte ────────────────────
    const rutaReal = leerJson(
      py("import sys;sys.path.insert(0,'ai_server');import spend_tracker as st;print(__import__('json').dumps({'r':str(st.RUTA_REAL)}))"),
    ).r;
    const enlace = join(tmp, "enlace-al-ledger");
    if (existsSync(rutaReal)) symlinkSync(rutaReal, enlace);

    const disfraces = [
      ["sin la variable", null],
      ["absoluta", rutaReal],
      ["relativa (contra la raíz del repo, no contra el cwd)", "cache/spend"],
      ["con `..` por en medio", "ai_server/../cache/spend"],
      ...(existsSync(rutaReal) ? [["un enlace simbólico", enlace]] : []),
    ];
    let negativaPuesta = true;
    for (const [etiqueta, valor] of disfraces) {
      const r = leerJson(construirBajoTest(valor));
      const bien = r.lanzo === true;
      if (!bien) negativaPuesta = false;
      expect(
        `1 · bajo unittest, el ledger real no se puede nombrar — ${etiqueta}`,
        bien,
        r.lanzo ? "" : `se construyó sobre ${r.root}`,
      );
    }
    // El mensaje tiene que ser accionable: la variable Y el remedio.
    const msg = leerJson(construirBajoTest(null)).msg ?? "";
    expect("1 · …y el mensaje nombra NEFAN_SPEND_DIR y trae el remedio", /NEFAN_SPEND_DIR/.test(msg) && /mktemp/.test(msg), msg.slice(0, 120));

    for (const blanco of ["", "   ", "\t"]) {
      const r = leerJson(construirBajoTest(blanco));
      expect(
        `1 · la variable PUESTA pero en blanco (${JSON.stringify(blanco)}) es fail-loud`,
        r.lanzo === true && /NEFAN_SPEND_DIR/.test(r.msg ?? ""),
        r.lanzo ? (r.msg ?? "").slice(0, 100) : `se construyó sobre ${r.root}`,
      );
    }

    // ── 2 · producción sigue arrancando ────────────────────────────────────
    const prod = leerJson(
      py(
        "import sys, json\n" +
          "sys.path.insert(0, 'ai_server')\n" +
          "import spend_tracker as st\n" +
          "print(json.dumps({'root': str(st.SPEND.root), 'real': str(st.SPEND.root) == str(st.RUTA_REAL), 'unittest': 'unittest' in sys.modules}))\n",
      ),
    );
    expect("2 · sin unittest, el singleton se construye sobre la ruta real", prod.real === true, JSON.stringify(prod));
    expect("2 · …y `unittest` no está cargado en ese proceso (el olfateo, medido)", prod.unittest === false);

    // ── LA PUERTA ──────────────────────────────────────────────────────────
    if (!negativaPuesta) {
      throw new SinMedir(
        "la negativa del constructor NO está: correr la suite aquí escribiría en el ledger de verdad. " +
          "No se corre nada más.",
      );
    }

    // ── 3 · la suite, dos veces, CON la variable ───────────────────────────
    const recuentos = [];
    for (const i of [1, 2]) {
      const dir = join(tmp, `spend-${i}`);
      mkdirSync(dir);
      const r = suite(dir);
      const ev = eventos(dir);
      recuentos.push(ev.length);
      expect(`3 · corrida ${i} con la variable: la suite pasa`, r.code === 0, r.salida.trim().split("\n").slice(-3).join(" / "));
      expect(
        `3 · corrida ${i}: el gasto de test aterriza en el temporal (${ev.length} eventos, $${ev.reduce((a, e) => a + e.usd, 0).toFixed(2)})`,
        ev.length > 0,
        "cero eventos: ¿falta fastapi y los tests se saltan?",
      );
    }
    if (recuentos[0] === 0) throw new SinMedir("la suite no escribió NI UN evento de gasto: sin fastapi no hay nada que medir");
    expect("3 · las dos corridas escriben lo mismo (es determinista)", recuentos[0] === recuentos[1], `${recuentos[0]} vs ${recuentos[1]}`);
    expect("3 · …y el ledger del checkout no ha cambiado", JSON.stringify(fotoDelLedger()) === JSON.stringify(antes));

    // ── 4 · la suite, dos veces, SIN la variable ───────────────────────────
    for (const i of [1, 2]) {
      const r = suite(null);
      expect(`4 · corrida ${i} sin la variable: la suite NO pasa`, r.code !== 0, `salió con ${r.code}`);
      expect(`4 · corrida ${i}: y dice qué poner`, /NEFAN_SPEND_DIR/.test(r.salida) && /mktemp/.test(r.salida));
    }

    // ── 5 · el ledger del checkout, intacto ────────────────────────────────
    const despues = fotoDelLedger();
    expect(
      "5 · el ledger del checkout tiene las MISMAS líneas y el mismo md5 que al empezar",
      JSON.stringify(despues) === JSON.stringify(antes),
      `antes=${JSON.stringify(antes)} después=${JSON.stringify(despues)}`,
    );

    // ── 6 · fuera de unittest, un forge de fixtures NO suma al gasto real ──
    // El mismo camino que producción: `skin_sprite_sheet_endpoint` de verdad,
    // sin TestClient (starlette lo importa vía `unittest`), contra un
    // `http.server` que contesta las cuatro fixtures canónicas de sprite-forge.
    const checkoutFalso = join(tmp, "checkout-falso");
    const ledgerFalso = join(checkoutFalso, "cache", "spend");
    const sonda = join(tmp, "sonda-forge-de-fixtures.py");
    writeFileSync(sonda, SONDA_FORGE_DE_FIXTURES);
    const r6 = spawnSync(PY, [sonda, FIXTURES_FORGE, join(checkoutFalso, "sprite_sheets")], {
      cwd: RAIZ,
      encoding: "utf8",
      env: { ...process.env, [ENV_SPEND_DIR]: ledgerFalso },
      timeout: 120_000,
    });
    const s6 = leerJson({ code: r6.status, out: `${r6.stdout ?? ""}`, err: `${r6.stderr ?? ""}` });
    if (s6.unittest_cargado) {
      throw new SinMedir(
        `el proceso de la sonda cargó \`unittest\` (${s6.quien ?? "?"}): el paso 6 mediría bajo el guardia de proceso y no el camino de producción`,
      );
    }
    expect("6 · la sonda corrió SIN `unittest` en el proceso (medido, no supuesto)", s6.unittest_cargado === false);
    expect("6 · …y el ledger que abrió tiene la FORMA del real (`…/cache/spend`)", s6.ledger_con_forma_real === true, s6.root);
    expect("6 · el adaptador contestó 200 con arte de las fixtures", s6.status === 200, JSON.stringify(s6).slice(0, 200));
    expect(`6 · escribió eventos en el ledger (${s6.eventos?.length ?? 0})`, (s6.eventos?.length ?? 0) >= 1);
    expect(
      "6 · TODOS los eventos dicen `procedencia: fixture` — la dice la RESPUESTA, no el proceso",
      (s6.eventos ?? []).length > 0 && s6.eventos.every((e) => e.procedencia === "fixture"),
      JSON.stringify((s6.eventos ?? []).map((e) => e.procedencia)),
    );
    expect("6 · el gasto REAL (`total_usd()`) sigue en 0", s6.total_usd === 0, `total_usd=${s6.total_usd}`);
    expect("6 · `/dev/status`.total_usd y call_count también en 0", s6.status_total === 0 && s6.status_calls === 0, JSON.stringify(s6.por_procedencia));
    expect(
      "6 · …y el desglose `por_procedencia.fixture` trae el dinero de mentira (> 0), no lo esconde",
      (s6.por_procedencia?.fixture?.usd ?? 0) > 0 && s6.por_procedencia?.real?.usd === 0,
      JSON.stringify(s6.por_procedencia),
    );
    expect("6 · y el ledger del checkout sigue como al empezar", JSON.stringify(fotoDelLedger()) === JSON.stringify(antes));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("");
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("VERDE — la suite no puede escribir en el ledger, y un forge de fixtures no suma al gasto real.");
  return 0;
}

let code = 2;
try {
  code = await main();
} catch (e) {
  if (e instanceof SinMedir) console.log(`\n⊘ SIN MEDIR — ${e.message}`);
  else console.log(`\n⊘ SIN MEDIR — ${e?.stack ?? e}`);
}
process.exit(code);
