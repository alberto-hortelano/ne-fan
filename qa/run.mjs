#!/usr/bin/env node
/** Runner de guiones de QA — el brazo ejecutable del rol `qa`.
 *
 *  El informe de QA sigue siendo juicio de usuario (crítica visual, fricción,
 *  workarounds): eso no se automatiza. Lo que sí se automatiza es la parte que
 *  hoy se re-verificaba a mano cada vez — "el jugador camina hasta ahí y no
 *  atraviesa el agua" — y que sin script solo existe como prosa que alguien
 *  tiene que creerse.
 *
 *  Conduce el juego REAL por el mismo camino que el jugador: el provider
 *  `scripted` (?input=scripted) y la API de bench `window.__nefan`. Nunca lee
 *  píxeles y nunca espera por tiempo de pared — el movimiento va por delta de
 *  rAF y el typewriter por setInterval, así que ningún `sleep` es
 *  determinista: se espera por ESTADO.
 *
 *  La corrida es HERMÉTICA: el stack arranca contra `qa/.tmp/<runid>/{saves,
 *  games}` (NEFAN_SAVES_DIR / NEFAN_GAMES_DIR), copia real de `data/games` sin
 *  mundos pre-generados, y ese directorio se borra al salir. Así una corrida no
 *  hereda el disco de la anterior. Dentro de una corrida, cada guion declara qué
 *  necesita virgen con `export const aisla = ["saves"|"mundo"|"fake-ai"]` y el
 *  runner ejecuta SOLO eso antes de lanzarlo — la precondición de cada guion,
 *  escrita, que hasta ahora no existía en ningún sitio.
 *
 *  Uso:
 *    node qa/run.mjs                  todos los guiones
 *    node qa/run.mjs colision hud     solo los que casen con esos nombres
 *    node qa/run.mjs --headed         con ventana, para mirar qué hace
 *    node qa/run.mjs --keep           deja el stack arriba y el tmp sin borrar
 *    node qa/run.mjs --url URL        usa un stack ya arrancado
 *    node qa/run.mjs --orden inverso  al revés (criterio: mismo veredicto)
 *    node qa/run.mjs --diag           una línea de diagnóstico por guion
 */
import { chromium } from "playwright-core";
import { abrirNavegador } from "./lib/navegador.mjs";
import { spawn } from "node:child_process";
import { readdirSync, mkdirSync, rmSync, cpSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const SHOTS = join(here, "capturas");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
/** Opciones que llevan valor: su valor NO es un filtro de nombre de guion. */
const CON_VALOR = new Set(["--url", "--orden"]);
const filters = args.filter((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1]));

const HEADED = flag("--headed");
const KEEP = flag("--keep");
const DIAG = flag("--diag");
const ORDEN = opt("--orden", "alfabetico");
const BASE = opt("--url", "http://localhost:3000");
const FAKE_AI = "http://127.0.0.1:18765";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const TMP = join(here, ".tmp", RUN_ID);
const TMP_SAVES = join(TMP, "saves");
const TMP_GAMES = join(TMP, "games");
/** Los plugins COMUNES a todos los mundos viven al lado de `games/`, y el
 *  loader los busca ahí mismo (`{gamesDir}/../plugins`). Si el disco efímero
 *  solo copia `games/`, TODA corrida de QA juega sin `economy` —el sistema que
 *  mueve `player.gold`— y una partida de bench deja de ser la del jugador. */
const TMP_PLUGINS = join(TMP, "plugins");
const GAMES_ORIGEN = join(repoRoot, "nefan-core", "data", "games");
const PLUGINS_ORIGEN = join(repoRoot, "nefan-core", "data", "plugins");
/** ?raf=timer: en headless la pestaña no está "visible" y el rAF se pausaría;
 *  el pump por Web Worker mantiene el game loop vivo. */
const URL_QS = `?input=scripted&ai=${encodeURIComponent(FAKE_AI)}&raf=timer`;

function portBusy(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 800);
  });
}

async function waitPort(port, label, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portBusy(port)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} (:${port}) no respondió en ${timeoutMs / 1000}s`);
}

/** Arranca el preset `e2e-sin-creditos` (fake-ai + bridge + cliente, cero
 *  créditos) por el mismo camino que usaría una persona:
 *  `./start.sh --preset e2e-sin-creditos`. Si el stack ya está arriba, no toca
 *  nada. Por SLUG y no por número: el número se desplaza al morir un preset. */
const PUERTOS = [
  [18765, "fake-ai-server"],
  [9877, "bridge"],
  [3000, "cliente HTML"],
];

async function ensureStack() {
  const vivos = [];
  for (const [port, label] of PUERTOS) if (await portBusy(port)) vivos.push(label);
  if (vivos.length === PUERTOS.length) {
    console.log("· stack ya arriba — no lo toco");
    return null;
  }
  if (vivos.length > 0) {
    // Medio stack en pie no es un stack: arrancar encima daría fallos raros
    // (puerto ocupado, cliente sin backend) en vez de un error claro.
    throw new Error(
      `hay servicios sueltos arriba (${vivos.join(", ")}) pero el stack está incompleto. ` +
        `Párralo del todo (Ctrl+C en su terminal, o ./start.sh y tecla k) y vuelve a lanzar.`,
    );
  }
  // Por SLUG, no por número: los números de preset se renumeran cuando muere
  // uno, y entonces esto levantaría otro stack y fallaría por timeout sin decir
  // por qué.
  console.log("· arrancando ./start.sh --preset e2e-sin-creditos…");
  console.log(`· disco efímero: ${TMP}`);
  const child = spawn("./start.sh", ["--preset", "e2e-sin-creditos"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    // Disco propio de la corrida: sin esto la batería lee y ESCRIBE en los
    // saves y los mundos pre-generados del repo, y la corrida N deja el disco
    // distinto para la N+1 (medido: el snapshot de mundo cambiaba de md5 cada
    // vez). El bridge respeta las dos variables (ws-server.ts:46,52) y
    // start.sh las hereda del entorno.
    env: { ...process.env, NEFAN_SAVES_DIR: TMP_SAVES, NEFAN_GAMES_DIR: TMP_GAMES },
  });
  child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
  child.stderr.on("data", (b) => process.env.QA_VERBOSE && process.stderr.write(`  ! ${b}`));
  for (const [port, label] of PUERTOS) await waitPort(port, label);
  console.log("· stack listo");
  return child;
}

/** El stack que arrancó ESTA corrida (null = ya había uno). Lo guarda el
 *  módulo para que el manejador de señales pueda matarlo: sin esto, un Ctrl+C
 *  dejaba el stack vivo y el tmp en el disco, y la corrida siguiente detectaba
 *  «puertos arriba», se saltaba TODOS los `aisla` y daba rojos falsos. */
let stackPropio = null;
let saliendo = false;

/** Única salida del runner: apaga lo que arrancó esta corrida y borra su tmp.
 *  La llaman el final feliz, el error y las señales — un Ctrl+C no puede dejar
 *  el disco ni los puertos en un estado que envenene la corrida siguiente. */
function salir(code, motivo) {
  if (saliendo) return;
  saliendo = true;
  if (motivo) console.log(`\n· ${motivo}`);
  if (stackPropio && !KEEP) {
    try {
      process.kill(-stackPropio.pid, "SIGINT");
    } catch {
      console.log("· el stack ya no estaba");
    }
  } else if (stackPropio) {
    console.log("· stack sigue arriba (--keep)");
  }
  if (!KEEP) rmSync(TMP, { recursive: true, force: true });
  else console.log(`· disco efímero sin borrar: ${TMP}`);
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => salir(130, `${sig}: apagando el stack y borrando ${TMP}`));
}

/** Restos de corridas anteriores que murieron a lo bruto. Se borran al empezar
 *  (dos baterías a la vez no pueden convivir: comparten puertos). */
function limpiarTmpViejos() {
  const raiz = join(here, ".tmp");
  if (!existsSync(raiz)) return;
  const viejos = readdirSync(raiz).filter((d) => join(raiz, d) !== TMP);
  for (const d of viejos) rmSync(join(raiz, d), { recursive: true, force: true });
  if (viejos.length) console.log(`· ${viejos.length} tmp de corridas muertas borrados`);
}

/** Disco efímero de la corrida: copia REAL de `data/games` (lo mismo que tiene
 *  el jugador) menos los mundos ya pre-generados — el mundo se genera dentro de
 *  la corrida por el camino del jugador, no se copia de un artefacto rancio.
 *  Copiarlo sería heredar justo lo que esto viene a cortar. */
function prepararDisco() {
  limpiarTmpViejos();
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP_SAVES, { recursive: true });
  cpSync(GAMES_ORIGEN, TMP_GAMES, { recursive: true });
  if (existsSync(PLUGINS_ORIGEN)) cpSync(PLUGINS_ORIGEN, TMP_PLUGINS, { recursive: true });
  limpiarMundos();
}

/** Borra los artefactos de mundo pre-generado del disco efímero: es lo que pide
 *  `aisla: ["mundo"]`. Las aplicaciones de estilo (`world/styles/`) NO se tocan
 *  aquí: las invalida `generate_game` al escribir el snapshot nuevo, que es el
 *  camino real y el que corre a continuación. */
function limpiarMundos() {
  let borrados = 0;
  for (const juego of readdirSync(TMP_GAMES)) {
    const world = join(TMP_GAMES, juego, "world");
    if (!existsSync(world)) continue;
    for (const f of readdirSync(world)) {
      if (f.endsWith(".json")) {
        rmSync(join(world, f), { force: true });
        borrados++;
      }
    }
  }
  return borrados;
}

/** Reset del estado de PROCESO del motor falso (tiles servidos, atlas
 *  "pintados", turnos de diálogo). Es lo que pide `aisla: ["fake-ai"]`. */
async function resetFakeAi() {
  const res = await fetch(`${FAKE_AI}/dev/reset`, { method: "POST" });
  if (!res.ok) throw new Error(`/dev/reset HTTP ${res.status}`);
  return res.json();
}

/** Ejecuta SOLO lo que el guion declare en `export const aisla = [...]`.
 *  Un guion que no declara nada corre sobre lo que dejó el anterior, a
 *  propósito: la declaración es la precondición, y una precondición que no
 *  existe no debe inventarse por simetría. */
async function aislar(nombre, aisla, propio) {
  if (!Array.isArray(aisla) || aisla.length === 0) return [];
  // Sin stack propio no hay disco efímero que vaciar: no sabemos dónde guarda
  // sus saves ni sus mundos el stack que ya estaba. Antes esto se saltaba en
  // SILENCIO y el guion daba una roja que no era del juego sino de su
  // precondición perdida. Ahora se dice y se para: un veredicto que no
  // significa lo que dice es exactamente el problema de #210.
  const deDisco = aisla.filter((q) => q === "saves" || q === "mundo");
  if (!propio && deDisco.length) {
    throw new Error(
      `necesita [${deDisco.join(", ")}] virgen y el stack no lo arrancó esta corrida ` +
        `(no sé dónde tiene el disco). Párala del todo —./start.sh y tecla k— y vuelve a lanzar.`,
    );
  }
  const hechos = [];
  for (const qué of aisla) {
    switch (qué) {
      case "saves":
        rmSync(TMP_SAVES, { recursive: true, force: true });
        mkdirSync(TMP_SAVES, { recursive: true });
        hechos.push("saves vaciados");
        break;
      case "mundo":
        hechos.push(`mundos borrados (${limpiarMundos()} artefactos)`);
        break;
      case "fake-ai": {
        const r = await resetFakeAi();
        hechos.push(`fake-ai reseteado (${JSON.stringify(r.limpiado)})`);
        break;
      }
      default:
        throw new Error(`${nombre}: aisla desconocido "${qué}" (vale saves|mundo|fake-ai)`);
    }
  }
  return hechos;
}

/** Cuánto tarda el título en tener su lista de partidas — el `list_sessions`
 *  del bridge, por su propio cable. Es lo que espera el jugador mirando el home
 *  y crece con cada save que se acumula. */
function medirListSessions() {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:9877");
    const fin = (v) => { try { ws.close(); } catch { /* ya cerrado */ } resolve(v); };
    const t = setTimeout(() => fin(null), 10_000);
    ws.onerror = () => { clearTimeout(t); fin(null); };
    ws.onopen = () => {
      const t0 = Date.now();
      ws.onmessage = (ev) => {
        const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
        if (m.type !== "sessions_listed") return;
        clearTimeout(t);
        fin({ ms: Date.now() - t0, n: m.sessions?.length ?? 0 });
      };
      ws.send(JSON.stringify({ type: "list_sessions", requestId: "diag" }));
    };
  });
}

/** Foto barata del disco, del motor falso y del bridge, para el `--diag`. */
async function diagnostico() {
  const saves = existsSync(TMP_SAVES) ? readdirSync(TMP_SAVES).length : 0;
  const mundos = {};
  for (const juego of readdirSync(TMP_GAMES)) {
    const f = join(TMP_GAMES, juego, "world", "tile.json");
    if (existsSync(f)) mundos[juego] = createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8);
  }
  const fake = await fetch(`${FAKE_AI}/dev/counters`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const list = await medirListSessions();
  return { saves, mundos, fake, list };
}

/** Contexto que recibe cada guion. Todo lo que ofrece espera por estado; no
 *  hay sleep en la API, a propósito. */
function makeCtx(page, name) {
  let step = 0;
  const ctx = {
    page,
    name,
    fallos: [],
    log: (msg) => console.log(`    ${msg}`),

    /** Llama a window.__nefan.<path>(...args), o lo lee si no es función. */
    async nefan(path, ...fnArgs) {
      return page.evaluate(
        ([p, a]) => {
          const hook = window.__nefan;
          if (!hook) throw new Error("window.__nefan no existe (¿build de producción?)");
          const keys = p.split(".");
          const owner = keys.slice(0, -1).reduce((o, k) => (o == null ? o : o[k]), hook);
          const target = keys.length === 1 ? hook[p] : owner?.[keys[keys.length - 1]];
          if (target === undefined) throw new Error(`__nefan.${p} no existe`);
          return typeof target === "function" ? target.apply(keys.length === 1 ? hook : owner, a) : target;
        },
        [path, fnArgs],
      );
    },

    /** Espera a que `probeFn` (evaluada en la página) devuelva algo truthy.
     *  `arg` viaja serializado a la página: los guiones comparan contra
     *  valores que midieron antes, sin ensuciar `window` con globales. */
    async waitFor(desc, probeFn, timeoutMs = 30_000, arg = undefined) {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeoutMs) {
        last = await page.evaluate(probeFn, arg).catch((e) => ({ __err: String(e) }));
        if (last && !last.__err) return last;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`timeout esperando: ${desc} (último valor: ${JSON.stringify(last)})`);
    },

    /** Mantiene una tecla hasta que se cumple `untilFn`, y la suelta SIEMPRE.
     *  `maxMs` es un cortafuegos, no la condición de parada: esperar por
     *  tiempo de pared no es determinista (el movimiento va por delta de rAF). */
    async holdUntil(key, desc, untilFn, maxMs = 15_000, arg = undefined) {
      await ctx.nefan("inputDriver.press", key);
      try {
        return await ctx.waitFor(desc, untilFn, maxMs, arg);
      } finally {
        await ctx.nefan("inputDriver.releaseAll");
      }
    },

    expect(desc, cond, detalle = "") {
      if (cond) console.log(`    ✔ ${desc}`);
      else {
        console.log(`    ✘ ${desc}${detalle ? ` — ${detalle}` : ""}`);
        ctx.fallos.push(`${desc}${detalle ? ` — ${detalle}` : ""}`);
      }
    },

    async shot(label) {
      const file = join(SHOTS, `${name}-${String(++step).padStart(2, "0")}-${label}.png`);
      await page.screenshot({ path: file });
      return file;
    },
  };
  return ctx;
}

async function main() {
  const guiones = readdirSync(join(here, "guiones"))
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => filters.length === 0 || filters.some((q) => f.includes(q)))
    .sort();
  if (ORDEN === "inverso") guiones.reverse();
  else if (ORDEN !== "alfabetico") {
    console.error(`--orden "${ORDEN}" no existe (vale alfabetico|inverso)`);
    process.exit(2);
  }

  if (guiones.length === 0) {
    console.error("No hay guiones que casen con:", filters.join(", ") || "(todos)");
    process.exit(2);
  }

  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  prepararDisco();
  const stack = await ensureStack();
  stackPropio = stack;
  if (!stack) {
    // El stack que ya estaba no sabe de nuestro disco efímero, así que la
    // corrida NO es hermética. Puede ser de otra persona o el huérfano de una
    // corrida anterior que murió a lo bruto: desde aquí no se distingue, así
    // que no se le llama "ajeno" — se dice lo único que se sabe seguro.
    console.log(
      "· OJO: el stack ya estaba arriba y NO lo arrancó esta corrida — usa SU disco, no qa/.tmp.\n" +
        "       Los guiones que necesiten saves o mundo vírgenes fallarán diciéndolo.",
    );
  }
  console.log(`· orden: ${ORDEN}`);
  const browser = await abrirNavegador(chromium, { headed: HEADED });

  const resultados = [];
  for (const file of guiones) {
    const nombre = file.replace(/\.mjs$/, "");
    console.log(`\n▶ ${nombre}`);
    const mod = await import(pathToFileURL(join(here, "guiones", file)).href);
    // Precondición DECLARADA del guion, ejecutada antes de abrir su página.
    try {
      const hechos = await aislar(nombre, mod.aisla, Boolean(stack));
      if (hechos.length) console.log(`    ⟲ aisla: ${hechos.join(" · ")}`);
    } catch (err) {
      console.log(`    ✘ PRECONDICIÓN NO GARANTIZADA: ${err.message}`);
      resultados.push({
        nombre,
        ok: false,
        fallos: [`precondición no garantizada: ${err.message}`],
        fatal: err,
      });
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    const ctx = makeCtx(page, nombre);
    let fatal = null;
    const t0 = Date.now();
    try {
      await page.goto(`${BASE}/${URL_QS}`, { waitUntil: "domcontentloaded" });
      await ctx.waitFor("window.__nefan disponible", () => Boolean(window.__nefan));
      await mod.default(ctx);
    } catch (err) {
      fatal = err;
      console.log(`    ✘ ERROR: ${err.message}`);
      await ctx.shot("error").catch(() => {});
    }
    if (DIAG) {
      const libros = await page
        .evaluate(() => ({
          viaje: window.__nefan.viaje ?? null,
          tiles: window.__nefan.tileEpisodios ?? null,
          estilo: window.__nefan.estilo ? window.__nefan.estilo() : null,
        }))
        .catch((e) => ({ __err: String(e) }));
      console.log(`    ⓘ ${Date.now() - t0} ms · ${JSON.stringify(await diagnostico())}`);
      console.log(`    ⓘ libros: ${JSON.stringify(libros)}`);
    }
    if (errores.length) {
      console.log(`    ✘ ${errores.length} excepción(es) en la página`);
      errores.slice(0, 3).forEach((e) => console.log(`      ${e.split("\n")[0]}`));
      ctx.fallos.push(`${errores.length} excepción(es) no capturadas en la página`);
    }
    await page.close();
    resultados.push({ nombre, ok: !fatal && ctx.fallos.length === 0, fallos: ctx.fallos, fatal });
  }

  await browser.close();

  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(60)}`);
  for (const r of resultados) console.log(`${r.ok ? "✔" : "✘"} ${r.nombre}`);
  console.log(`${ok}/${resultados.length} guiones en verde · capturas en qa/capturas/`);
  salir(ok === resultados.length ? 0 : 1);
}

main().catch((err) => {
  console.error("runner:", err);
  salir(2);
});
