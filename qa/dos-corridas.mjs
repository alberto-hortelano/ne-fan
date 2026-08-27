#!/usr/bin/env node
/** ¿Terminan DOS baterías de QA lanzadas a la vez, midiendo cada una lo suyo?
 *
 *  Es el candado del criterio 3, y no se puede afirmar leyendo: hay que
 *  arrancar las dos y verlas terminar. Lo que separa este guion de «cambiar los
 *  puertos» es que los puertos eran el obstáculo más visible, no el que
 *  producía el fallo caro. Los otros cuatro, todos medidos sobre `main`
 *  `c4a6e8f`, eran:
 *
 *   1. `qa/lib/saves.mjs` recorría TODOS los `qa/.tmp/*​/saves` y se quedaba con
 *      el primero alfabético — el RUN_ID más ANTIGUO, o sea el disco de la otra
 *      corrida. No fallaba: afirmaba en VERDE sobre los saves del vecino.
 *   2. `limpiarTmpViejos()` borraba todo `qa/.tmp/*` que no fuera el suyo,
 *      incluido el disco VIVO de la otra corrida, y lo hacía justo cuando tenía
 *      stack propio: el caso que esta tanda vuelve simultáneo.
 *   3. `qa/capturas/` era ruta fija y se borraba entera al arrancar, así que la
 *      segunda batería le borraba a la primera las pruebas de lo que acababa de
 *      medir.
 *   4. los nueve logs eran `/tmp/nefan-*.log`, nombre fijo y truncando: dos
 *      stacks se pisaban el diagnóstico, y cruzando worktrees.
 *
 *  Por eso las afirmaciones de abajo no son solo «las dos salieron 0»: son
 *  también que cada una conserva SU disco, SUS capturas y SUS logs, y que no
 *  comparten un solo puerto.
 *
 *  Coste: ~2-3 min de reloj y un pico de 4-5 núcleos de 16 (dos stacks ligeros
 *  y dos Chromium). Por eso NO lanza las dos baterías enteras: dos guiones cada
 *  una bastan para tocar saves, capturas, disco y puertos.
 *
 *  Uso:  node qa/dos-corridas.mjs [guion…]     (por defecto: 01 y 29)
 *  Cero créditos: las dos corridas usan el preset `e2e-sin-creditos`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { PUERTOS_BASE } from "./lib/stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const RAIZ_TMP = join(here, ".tmp");
const RAIZ_SHOTS = join(here, "capturas");

const filtros = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const GUIONES = filtros.length ? filtros : ["01", "29"];

const fallos = [];
const ok = (t) => console.log(`  ✔ ${t}`);
const mal = (t, d) => {
  console.log(`  ✘ ${t}${d ? ` — ${d}` : ""}`);
  fallos.push(t);
};

function ocupado(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const fin = (v) => {
      s.destroy();
      res(v);
    };
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
    setTimeout(() => fin(false), 800);
  });
}

/** Lanza una batería y devuelve su promesa de `{code, salida}`. */
function lanzar(etiqueta) {
  const proc = spawn("node", ["qa/run.mjs", ...GUIONES], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let salida = "";
  const recoger = (b) => {
    salida += b;
    if (process.env.QA_VERBOSE) process.stdout.write(`[${etiqueta}] ${b}`);
  };
  proc.stdout.on("data", recoger);
  proc.stderr.on("data", recoger);
  const t0 = Date.now();
  return new Promise((res) =>
    proc.on("exit", (code) => {
      console.log(`  · ${etiqueta} terminó con ${code} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      res({ code, salida, ms: Date.now() - t0 });
    }),
  );
}

/** El RUN_ID que la corrida imprimió (aparece en la ruta del disco efímero y
 *  en la línea final de capturas). */
function runIdDe(salida) {
  const m = salida.match(/qa\/\.tmp\/([^\s/]+)/) ?? salida.match(/qa\/capturas\/([^\s/]+)/);
  return m?.[1] ?? null;
}

/** El bloque de puertos que eligió, o 0 si no lo dijo (no se desplazó). */
function offsetDe(salida) {
  return Number(salida.match(/bloque de puertos \+(\d+)/)?.[1] ?? 0);
}

// ── Preflight: sin stack ajeno arriba ────────────────────────────────────
const base = ["fake_ai", "bridge", "html"].map((k) => PUERTOS_BASE[k]);
const sucios = [];
for (const p of base) if (await ocupado(p)) sucios.push(p);
if (sucios.length) {
  console.error(
    `❌ el bloque base ya está ocupado (${sucios.join(", ")}). Este guion mide que DOS corridas\n` +
      `   conviven, así que necesita saber que las dos son suyas. Para el stack que haya\n` +
      `   (./start.sh --parar) y vuelve a lanzar.`,
  );
  process.exit(2);
}

console.log(`▶ dos corridas de qa/run.mjs a la vez · guiones: ${GUIONES.join(" ")}\n`);
const tmpAntes = new Set(existsSync(RAIZ_TMP) ? readdirSync(RAIZ_TMP) : []);

/** Vigilante del disco efímero MIENTRAS las dos corren.
 *
 *  Es la afirmación que de verdad prueba el obstáculo más caro: no basta con
 *  que al final no falte nada —cuando terminan, cada una ha borrado el suyo—,
 *  hay que haber VISTO los dos directorios vivos a la vez. Antes de esta tanda
 *  eso no pasaba nunca: la segunda corrida borraba el disco de la primera nada
 *  más tener stack propio. */
let convivieron = 0;
let maxSimultaneos = 0;
const vigilante = setInterval(() => {
  const vivos = (existsSync(RAIZ_TMP) ? readdirSync(RAIZ_TMP) : []).filter((d) => !d.startsWith("."));
  maxSimultaneos = Math.max(maxSimultaneos, vivos.length);
  if (vivos.length >= 2) convivieron++;
}, 200);

// Las dos A LA VEZ, sin escalonar: es el caso que hay que probar.
const [a, b] = await Promise.all([lanzar("A"), lanzar("B")]);
clearInterval(vigilante);

console.log("");
// ── 1. Las dos terminan, y terminan BIEN ────────────────────────────────
// Código 0 y no «no murió»: el runner distingue rojo (1) de no-llegó-a-medir
// (2), y un 2 aquí sería justo el fallo que este guion busca.
ok(`las dos corridas terminaron (A=${a.code}, B=${b.code})`);
if (a.code !== 0 || b.code !== 0) {
  mal("ambas salen con 0", `A=${a.code} B=${b.code} — mira la salida completa con QA_VERBOSE=1`);
  for (const [et, r] of [["A", a], ["B", b]]) {
    if (r.code !== 0) console.log(`\n--- salida de ${et} (últimas 25 líneas) ---\n${r.salida.split("\n").slice(-25).join("\n")}`);
  }
} else {
  ok("ambas salen con 0: las dos MIDIERON (2 sería «no llegó a medir»)");
}

// ── 2. Cada una tuvo su propio bloque de puertos ────────────────────────
const offA = offsetDe(a.salida);
const offB = offsetDe(b.salida);
if (offA !== offB) ok(`bloques de puertos distintos (A=+${offA}, B=+${offB})`);
else mal("cada corrida usa su propio bloque de puertos", `las dos dicen +${offA}`);

// ── 2 bis. Las dos midieron lo que decían medir ─────────────────────────
// Sin esto, «salió 0» podría ser una corrida que no ejecutó ningún guion, que
// es exactamente la clase de verde que esta casa se ha comido varias veces.
for (const [et, r] of [["A", a], ["B", b]]) {
  const m = r.salida.match(/(\d+) en verde · (\d+) en rojo de (\d+)/);
  if (m && Number(m[3]) === GUIONES.length && Number(m[1]) === GUIONES.length) {
    ok(`${et} ejecutó y aprobó los ${GUIONES.length} guiones (${m[0]})`);
  } else {
    mal(`${et} ejecutó los ${GUIONES.length} guiones`, m ? m[0] : "no dice cuántos midió");
  }
}

// ── 3. Cada una midió SU disco, y ninguna borró el de la otra ───────────
// Lo que prueba el obstáculo caro: los dos discos efímeros VIVOS a la vez.
if (convivieron > 0) ok(`los dos discos efímeros convivieron (${convivieron} muestras con ${maxSimultaneos} a la vez)`);
else mal("los dos discos efímeros conviven", `nunca se vieron dos a la vez (máximo ${maxSimultaneos})`);

const idA = runIdDe(a.salida);
const idB = runIdDe(b.salida);
if (idA && idB && idA !== idB) ok(`identidades de corrida distintas (${idA} · ${idB})`);
else mal("cada corrida tiene su propio RUN_ID", `A=${idA} B=${idB}`);

// El disco efímero se borra al salir (es lo correcto), así que lo que se
// afirma es que NINGUNA se llevó por delante lo que había antes ni dejó
// restos: `limpiarTmpViejos` ya no borra por «no es el mío».
const tmpDespues = new Set(existsSync(RAIZ_TMP) ? readdirSync(RAIZ_TMP) : []);
const perdidos = [...tmpAntes].filter((d) => !d.startsWith(".") && !tmpDespues.has(d));
if (perdidos.length === 0) ok("ningún qa/.tmp ajeno desapareció durante las dos corridas");
else mal("nadie borra el disco de otra corrida", `desaparecieron: ${perdidos.join(", ")}`);

// ── 4. Las capturas de las dos sobreviven ───────────────────────────────
for (const [et, id] of [["A", idA], ["B", idB]]) {
  const dir = id ? join(RAIZ_SHOTS, id) : null;
  if (dir && existsSync(dir) && readdirSync(dir).length > 0) {
    ok(`${et} conserva sus capturas (${readdirSync(dir).length} en qa/capturas/${id})`);
  } else {
    mal(`${et} conserva sus capturas`, `no hay nada en ${dir ?? "(sin RUN_ID)"}`);
  }
}

// ── 5. Cada stack escribió SUS logs, no los del otro ────────────────────
// Se lee de la propia salida: el disco efímero ya no está, pero el runner dice
// dónde lo puso, y `start.sh` respeta NEFAN_LOG_DIR.
for (const [et, r] of [["A", a], ["B", b]]) {
  const dijo = /disco efímero: /.test(r.salida);
  (dijo ? ok : mal)(`${et} declaró su disco efímero propio (logs incluidos)`);
}

// ── 6. Y ninguna dio el aviso de «stack ajeno adoptado» ─────────────────
for (const [et, r] of [["A", a], ["B", b]]) {
  const adoptó = /stack ya arriba/.test(r.salida);
  (!adoptó ? ok : mal)(
    `${et} arrancó stack PROPIO (no se enganchó al del otro)`,
    adoptó ? "dice «stack ya arriba»" : "",
  );
}

console.log(
  `\n${fallos.length === 0 ? "✔ dos corridas simultáneas terminan las dos, cada una midiendo lo suyo" : `✘ ${fallos.length} fallo(s)`}`,
);
process.exit(fallos.length === 0 ? 0 : 1);
