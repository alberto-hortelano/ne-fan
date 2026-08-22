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
 *  Uso:
 *    node qa/run.mjs                  todos los guiones
 *    node qa/run.mjs colision hud     solo los que casen con esos nombres
 *    node qa/run.mjs --headed         con ventana, para mirar qué hace
 *    node qa/run.mjs --keep           deja el stack arriba al terminar
 *    node qa/run.mjs --url URL        usa un stack ya arrancado
 */
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { readdirSync, mkdirSync, rmSync } from "node:fs";
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
const filters = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--url");

const HEADED = flag("--headed");
const KEEP = flag("--keep");
const BASE = opt("--url", "http://localhost:3000");
const FAKE_AI = "http://127.0.0.1:18765";
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
  const child = spawn("./start.sh", ["--preset", "e2e-sin-creditos"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
  child.stderr.on("data", (b) => process.env.QA_VERBOSE && process.stderr.write(`  ! ${b}`));
  for (const [port, label] of PUERTOS) await waitPort(port, label);
  console.log("· stack listo");
  return child;
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

  if (guiones.length === 0) {
    console.error("No hay guiones que casen con:", filters.join(", ") || "(todos)");
    process.exit(2);
  }

  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const stack = await ensureStack();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: !HEADED,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
  });

  const resultados = [];
  for (const file of guiones) {
    const nombre = file.replace(/\.mjs$/, "");
    console.log(`\n▶ ${nombre}`);
    const mod = await import(pathToFileURL(join(here, "guiones", file)).href);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errores = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    const ctx = makeCtx(page, nombre);
    let fatal = null;
    try {
      await page.goto(`${BASE}/${URL_QS}`, { waitUntil: "domcontentloaded" });
      await ctx.waitFor("window.__nefan disponible", () => Boolean(window.__nefan));
      await mod.default(ctx);
    } catch (err) {
      fatal = err;
      console.log(`    ✘ ERROR: ${err.message}`);
      await ctx.shot("error").catch(() => {});
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
  if (stack && !KEEP) process.kill(-stack.pid, "SIGINT");
  else if (stack) console.log("\n· stack sigue arriba (--keep)");

  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(60)}`);
  for (const r of resultados) console.log(`${r.ok ? "✔" : "✘"} ${r.nombre}`);
  console.log(`${ok}/${resultados.length} guiones en verde · capturas en qa/capturas/`);
  process.exit(ok === resultados.length ? 0 : 1);
}

main().catch((err) => {
  console.error("runner:", err);
  process.exit(2);
});
