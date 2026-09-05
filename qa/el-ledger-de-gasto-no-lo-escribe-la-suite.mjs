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
 *   6 · LA HERRAMIENTA DE RETIRADA por su CLI, sobre un ledger de MENTIRA: el
 *       dry-run no toca un byte; `--ejecutar` mueve solo lo de test y deja el
 *       arte real —incluido el vecino `hero: un herrero de la aldea del norte`,
 *       que CONTIENE entero el `what` retirado—; ninguna línea se pierde;
 *       repetirlo no mueve nada; y un evento del lote retirado FUERA de su
 *       ventana de fechas para el guion en vez de archivarlo.
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
 *  el `.resolve()` quitado, cae el disfraz relativo; devolviendo `RUTA_REAL`
 *  con la variable en blanco, cae el caso del blanco; y cambiando la igualdad
 *  exacta del lote retirado por `contains` en `archivar_gasto_de_test.py`, cae
 *  el vecino del paso 6.
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
const HERRAMIENTA = join(RAIZ, "ai_server", "tools", "archivar_gasto_de_test.py");
const ENV_SPEND_DIR = "NEFAN_SPEND_DIR";

/** El intérprete: `NEFAN_PYTHON`, el `.venv` del checkout o el `python3` del
 *  sistema, en ese orden (`qa/lib/python.mjs`; un worktree desprendido lo dice
 *  con la variable). */
const PY = interpretePython(RAIZ);

const fallos = [];
const expect = (desc, cond, detalle = "") => {
  console.log(`  ${cond ? "✔" : "✘"} ${desc}${cond || !detalle ? "" : ` — ${detalle}`}`);
  if (!cond) fallos.push(desc);
};
/** Un dato que se mide y se DICE, pero no decide el veredicto: un hallazgo
 *  abierto que ya está reportado y que aquí solo se vigila. */
const nota = (desc, detalle) => console.log(`  ⚠ ${desc}${detalle ? ` — ${detalle}` : ""}`);

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

const epoch = (iso) => Date.parse(`${iso}T12:00:00`) / 1000;

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

    // ── 6 · la herramienta de retirada, por su CLI y sobre un ledger falso ──
    const falso = join(tmp, "ledger-de-mentira.jsonl");
    const archivo = join(tmp, "archivado.jsonl");
    const lineas = [
      // gasto de test de la fixture VIVA
      { t: epoch("2026-09-01"), usd: 0.24, what: "hero: un herrero de pelo cano", service: "remote-gen" },
      { t: epoch("2026-09-02"), usd: 0.24, what: "skin walk: un herrero de pelo cano", service: "remote-gen" },
      // gasto de test de la fixture RETIRADA, DENTRO de su ventana declarada
      { t: epoch("2026-08-26"), usd: 0.24, what: "hero: un herrero", service: "remote-gen" },
      { t: epoch("2026-08-29"), usd: 0.96, what: "skin walk: un herrero", service: "remote-gen" },
      // ARTE REAL que se parece: contiene entero el `what` retirado. Se queda.
      { t: epoch("2026-08-27"), usd: 0.24, what: "hero: un herrero de la aldea del norte", service: "remote-gen" },
      // ARTE REAL sin parecido
      { t: epoch("2026-08-17"), usd: 0.24, what: "atlas d0: Blas, el tabernero", service: "remote-gen" },
    ].map((e) => JSON.stringify(e));
    writeFileSync(falso, `${lineas.join("\n")}\n`);
    const md5Falso = createHash("md5").update(readFileSync(falso)).digest("hex");

    const herramienta = (extra) =>
      spawnSync(PY, [HERRAMIENTA, "--ledger", falso, "--destino", archivo, ...extra], {
        cwd: RAIZ,
        encoding: "utf8",
        timeout: 120_000,
      });

    const seco = herramienta([]);
    expect("6 · el dry-run no toca un byte del ledger", createHash("md5").update(readFileSync(falso)).digest("hex") === md5Falso);
    expect("6 · …y no crea el fichero de archivo", !existsSync(archivo));
    expect("6 · …y anuncia los 4 eventos de test antes de tocar nada", /A ARCHIVAR: 4 eventos/.test(seco.stdout ?? ""), (seco.stdout ?? "").trim().split("\n").slice(-4).join(" / "));

    herramienta(["--ejecutar"]);
    const quedan = readFileSync(falso, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const movidos = readFileSync(archivo, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    expect("6 · `--ejecutar` mueve los 4 de test y deja los 2 reales", quedan.length === 2 && movidos.length === 4, `quedan=${quedan.length} movidos=${movidos.length}`);
    expect(
      "6 · el vecino `hero: un herrero de la aldea del norte` NO se lo lleva (igualdad exacta, no `contains`)",
      quedan.some((e) => e.what === "hero: un herrero de la aldea del norte"),
      `se quedaron: ${quedan.map((e) => e.what).join(" | ")}`,
    );
    expect(
      "6 · ninguna línea se pierde: ledger ∪ archivo == el original",
      JSON.stringify([...quedan, ...movidos].map((e) => e.what).sort()) ===
        JSON.stringify(lineas.map((l) => JSON.parse(l).what).sort()),
    );
    const md5Tras = [falso, archivo].map((f) => createHash("md5").update(readFileSync(f)).digest("hex"));
    herramienta(["--ejecutar"]);
    expect(
      "6 · correrla otra vez no mueve nada",
      JSON.stringify([falso, archivo].map((f) => createHash("md5").update(readFileSync(f)).digest("hex"))) === JSON.stringify(md5Tras),
    );

    // La ventana de fechas es la mitad comprobable de la procedencia declarada.
    const fuera = join(tmp, "fuera-de-ventana.jsonl");
    writeFileSync(
      fuera,
      `${JSON.stringify({ t: epoch("2026-09-03"), usd: 0.24, what: "hero: un herrero", service: "remote-gen" })}\n`,
    );
    const rFuera = spawnSync(PY, [HERRAMIENTA, "--ledger", fuera, "--destino", join(tmp, "no.jsonl")], {
      cwd: RAIZ,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(
      "6 · un evento del lote retirado FUERA de su ventana para el guion",
      rFuera.status !== 0 && /ventana|declara/i.test(`${rFuera.stdout}${rFuera.stderr}`),
      `salió con ${rFuera.status}`,
    );

    // ── nota · hallazgo abierto, vigilado y no puntuado ─────────────────────
    // La negativa compara contra la RUTA_REAL de ESTE checkout. Apuntada al
    // ledger real de OTRO checkout (el principal desde un worktree), se
    // construye sin quejarse. Reportado en qa-2.md (H2); aquí solo se vigila.
    const otro = "/home/al/code/ne-fan/cache/spend";
    if (resolve(otro) !== resolve(rutaReal)) {
      const r = leerJson(construirBajoTest(otro));
      if (!r.lanzo) nota("H2 sigue abierto: apuntada al ledger real de OTRO checkout, se construye sin quejarse", r.root);
      else nota("H2 parece cerrado: apuntar a otro checkout ya revienta", (r.msg ?? "").slice(0, 80));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("");
  if (fallos.length) {
    console.log(`ROJO — ${fallos.length} comprobación(es) fallaron.`);
    return 1;
  }
  console.log("VERDE — la suite no puede escribir en el ledger, y la retirada es reproducible.");
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
