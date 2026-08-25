#!/usr/bin/env node
/** Captura las PORTADAS del selector de mundos desde el juego real.
 *
 *  Las cinco `cover.jpg` de `data/styles/` eran copias byte a byte de
 *  `faces/fachada.jpg` — no una decisión, sino el relleno automático de
 *  `style_pack_builder.generate_missing`. Una portada debe enseñar lo que el
 *  jugador va a ver de verdad: primera persona, a la altura de los ojos, con
 *  el atlas de superficies de ESE estilo ya pintado.
 *
 *  Vive en `qa/` y no en `tools/` por una razón práctica: playwright-core está
 *  instalado en `qa/node_modules`, y este script reutiliza `qa/lib/sesion.mjs`
 *  (el mismo camino del jugador desde el título) y los hooks `window.__nefan`.
 *
 *  La captura es arte, así que se hace con la GPU real (`qa/lib/navegador.mjs`).
 *  Hasta el 2026-08-25 esta cabecera decía eso mismo y el código de veinte
 *  líneas más abajo pasaba `--use-angle=swiftshader` en cuanto no hubiera
 *  ventana: **las portadas headless salieron de un rasterizador por software**.
 *  Ahora lo dicho y lo hecho coinciden.
 *
 *  GASTA CRÉDITOS: cada mundo pinta su tile de entrada (páginas de 1024² a
 *  $0,15-0,17). El script imprime el gasto de remote-gen antes y después de
 *  cada mundo para que el tope sea comprobable, no confiado.
 *
 *  Uso:
 *    node qa/capturar-portadas.mjs --games toledo_1200
 *    node qa/capturar-portadas.mjs --games alta_fantasia --yaws 0,90,180
 *    node qa/capturar-portadas.mjs --games X --pose 12.5,-3,45 --pose 0,0,180
 */
import { chromium } from "playwright-core";
import { abrirNavegador } from "./lib/navegador.mjs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nuevaPartida, comenzar, celdaAMundo } from "./lib/sesion.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const opts = (name) => args.flatMap((a, i) => (args[i - 1] === name ? [a] : []));

const BASE = opt("--url", "http://localhost:3000");
const OUT = opt("--out", "/tmp/claude-1000/-home-al-code-ne-fan/portadas");
const GAMES = opt("--games", "alta_fantasia,colonia_aster,cuentos_oscuros,toledo_1200").split(",");
const YAWS = opt("--yaws", "0,45,90,135,180,225,270,315").split(",").map(Number);
/** `--pose x,z,yawDeg` (repetible). Si hay poses explícitas, sustituyen al
 *  barrido de yaws desde el spawn. */
const POSES = opts("--pose").map((s) => s.split(",").map(Number));
/** `--celda col,row` (repetible): barre los yaws desde esa celda del plan. */
const CELDAS = opts("--celda").map((s) => s.split(",").map(Number));
const REMOTE_GEN = opt("--remote-gen", "http://127.0.0.1:8768");
/** `--headed` abre ventana real (GPU del equipo). Exige escritorio activo. */
const HEADED = args.includes("--headed");
/** El motor narrativo de esta corrida soy yo por MCP: el bootstrap tarda lo
 *  que tarde en llegar la respuesta, no lo que tarde una API. */
const MAX_ESCENA_MS = Number(opt("--timeout-escena", "1800")) * 1000;
const MAX_PINTURA_MS = Number(opt("--timeout-pintura", "900")) * 1000;

const VIEWPORT = { width: 1536, height: 1024 }; // 3:2 exacto — la proporción de la tarjeta

function makeCtx(page) {
  return {
    page,
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
    async waitFor(desc, probeFn, timeoutMs = 30_000, arg = undefined) {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeoutMs) {
        last = await page.evaluate(probeFn, arg).catch((e) => ({ __err: String(e) }));
        if (last && !last.__err) return last;
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error(`timeout esperando: ${desc} (último valor: ${JSON.stringify(last)})`);
    },
  };
}

/** Gasto acumulado que declara remote-gen. Es el contador real (tablas
 *  Meshy/fal), el mismo que pinta el chip del panel de dev. */
async function gastoUsd() {
  try {
    const res = await fetch(`${REMOTE_GEN}/dev/status`);
    const j = await res.json();
    return Number(j?.spend?.total_usd ?? NaN);
  } catch (err) {
    console.log(`  · no pude leer el gasto de remote-gen: ${err.message}`);
    return NaN;
  }
}

/** La pintura del atlas arranca UNOS TICKS DESPUÉS de que llegue la escena:
 *  preguntar por `!painting` nada más recibirla daría "ya está" antes de
 *  empezar. Se espera a que el flag esté quieto en false durante `quietMs`
 *  seguidos, habiendo dado margen a que arranque. */
async function esperarPinturaEstable(ctx, { quietMs = 8000, maxMs }) {
  const t0 = Date.now();
  let quietoDesde = null;
  let vistoPintando = false;
  let ultimo = null;
  let ultimoAviso = 0;
  while (Date.now() - t0 < maxMs) {
    const st = await ctx.nefan("status");
    ultimo = st;
    // Latido: sin esto, una espera colgada es indistinguible de una lenta.
    if (Date.now() - ultimoAviso > 15_000) {
      ultimoAviso = Date.now();
      console.log(`  · [${((Date.now() - t0) / 1000).toFixed(0)}s] ${JSON.stringify(st)}`);
    }
    if (st.painting) {
      if (!vistoPintando) console.log("  · el atlas está pintando…");
      vistoPintando = true;
      quietoDesde = null;
    } else if (quietoDesde === null) {
      quietoDesde = Date.now();
    } else if (Date.now() - quietoDesde >= quietMs) {
      return { vistoPintando, esperaMs: Date.now() - t0 };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`la pintura no se estabilizó en ${maxMs / 1000}s (último: ${JSON.stringify(ultimo)})`);
}

async function capturarMundo(browser, gameId) {
  console.log(`\n▶ ${gameId}`);
  const usdAntes = await gastoUsd();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const ctx = makeCtx(page);
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e).split("\n")[0]));

  // Sin `?ai=`: los servicios REALES (remote-gen :8768, asset-store :8767).
  // `raf=timer` mantiene vivo el game loop aunque la ventana pierda foco.
  await page.goto(`${BASE}/?input=scripted&raf=timer`, { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible", () => Boolean(window.__nefan));

  const { styleId } = await nuevaPartida(ctx, { gameId, charMode: "vector" });
  // Escenarios en "image" a propósito: es lo que se quiere fotografiar.
  // Personajes en "vector" (y_bot): esta tanda es sin figuras, y así no se
  // paga ni un skin.
  await page.click('#ts-rendermode [data-rendermode="image"]');
  console.log(`  · mundo=${gameId} estilo=${styleId} escenarios=image personajes=vector`);

  console.log("  · esperando la escena del motor (soy yo por MCP: puede tardar)…");
  await comenzar(ctx, MAX_ESCENA_MS);
  const scene = await ctx.nefan("scene");
  console.log(`  · escena "${scene.scene_id}": ${scene.objects?.length ?? 0} objetos, ${scene.npcs?.length ?? 0} npcs`);

  const { vistoPintando, esperaMs } = await esperarPinturaEstable(ctx, { maxMs: MAX_PINTURA_MS });
  console.log(`  · pintura estable tras ${(esperaMs / 1000).toFixed(0)}s (¿llegó a pintar?: ${vistoPintando ? "sí" : "NO"})`);

  // Fuera toda la interfaz: el retículo vive dentro de #game-ui, así que se
  // va con él. La portada es el mundo, nada más.
  await page.addStyleTag({
    content: "#game-ui,#dev-status,#dev-menu,#error-log,#title-screen{display:none !important}",
  });

  const dir = join(OUT, gameId);
  mkdirSync(dir, { recursive: true });
  const spawn = await ctx.nefan("state");
  // `--celda col,row` (repetible) piensa en las MISMAS coordenadas que el
  // plan del motor; la conversión sale de la propia escena, no de constantes
  // copiadas. Sin poses explícitas, barrido de yaws desde el spawn.
  const desdeCeldas = CELDAS.map(([col, row]) => {
    const [x, z] = celdaAMundo(scene, col, row);
    return YAWS.map((yawDeg) => ({ x, z, yawDeg, etiqueta: `c${col}_${row}` }));
  }).flat();
  const poses = POSES.length > 0
    ? POSES.map(([x, z, yawDeg]) => ({ x, z, yawDeg, etiqueta: "pose" }))
    : desdeCeldas.length > 0
      ? desdeCeldas
      : YAWS.map((yawDeg) => ({ x: spawn.pos.x, z: spawn.pos.z, yawDeg, etiqueta: "spawn" }));

  const hechas = [];
  for (const [i, p] of poses.entries()) {
    await ctx.nefan("setPlayerPos", p.x, p.z);
    await ctx.nefan("setYaw", (p.yawDeg * Math.PI) / 180);
    // Dos frames: uno aplica la pose, el siguiente ya la ha dibujado.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = join(dir, `${String(i + 1).padStart(2, "0")}-${p.etiqueta}-yaw${p.yawDeg}.png`);
    await page.locator("#fps-canvas").screenshot({ path: file });
    hechas.push(file);
  }
  console.log(`  · ${hechas.length} capturas en ${dir}`);

  if (errores.length) console.log(`  ! ${errores.length} excepción(es) en la página: ${errores.slice(0, 3).join(" | ")}`);
  await page.close();

  const usdDespues = await gastoUsd();
  const delta = usdDespues - usdAntes;
  console.log(`  · GASTO: ${usdAntes.toFixed(2)} → ${usdDespues.toFixed(2)} USD (este mundo: ${delta.toFixed(2)})`);
  return { gameId, styleId, dir, capturas: hechas.length, usdAntes, usdDespues, delta };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // Con ventana real (--headed) la corrida depende de que el escritorio esté
  // DESBLOQUEADO: Chrome frena el render de una ventana ocluida por el
  // salvapantallas y la espera de pintura se cuelga sin decir por qué.
  const browser = await abrirNavegador(chromium, { headed: HEADED });
  const resumen = [];
  try {
    for (const g of GAMES) resumen.push(await capturarMundo(browser, g.trim()));
  } finally {
    await browser.close();
  }
  console.log(`\n${"─".repeat(60)}`);
  for (const r of resumen) console.log(`${r.gameId} (${r.styleId}): ${r.capturas} capturas · $${r.delta.toFixed(2)}`);
  const total = resumen.reduce((a, r) => a + (Number.isFinite(r.delta) ? r.delta : 0), 0);
  console.log(`TOTAL de esta corrida: $${total.toFixed(2)}`);
}

main().catch((err) => {
  console.error("capturar-portadas:", err);
  process.exit(2);
});
