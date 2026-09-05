#!/usr/bin/env node
/** ¿Las TRES fixtures del selector «Room» pintan, se caminan y colisionan en
 *  `html-fixtures`, sin bridge? (QA de T13 PR-F: #405)
 *
 *  Hasta #405 el cliente tenía un camino propio para la escena «sin grid»
 *  (`isGridTile`, `loadRoom` por «no es grid», el `getAt` por rect del
 *  TileStore, el `else` de `scene_loaded` que reseteaba el mundo). Todo eso
 *  murió: toda escena servida o cargada del selector es un TILE, y las tres
 *  fixtures de `data/scenes/` entran por `addTileRaw` → `formatDToWorld`. Este
 *  guion afirma que el preset sin backend sigue sirviendo para lo que existe
 *  —«iterar renderer/UI con las fixtures del selector Room, cero backend»—
 *  sobre las TRES, no sobre una:
 *   1 · la fixture queda puesta y el renderer sigue EMITIENDO frames;
 *   2 · es un tile: `scene.tile` = {0,0} y `world_rect` = [−32, 32)²
 *       (el rect sale del tile, no de «centrar el grid en el origen»);
 *   3 · el jugador ANDA: con `up` mantenida la posición cambia;
 *   4 · la colisión viene de la huella: el centro de un edificio (o del primer
 *       objeto con huella) colisiona y el spawn del jugador NO.
 *  Y una vez, adversarial:
 *   5 · la fixture real SIN `tile` la rechaza `addTileRaw` nombrando `tile`, y
 *       la escena que había sigue puesta (no hay «escena suelta» que cargar).
 *
 *  Grupo: conduce `start.sh` y un Chromium sobre los puertos del catálogo →
 *  corrida LOCAL, fuera del job `candados-headless` (misma casilla que
 *  `fixtures-sin-bridge.mjs`, del que toma el arranque).
 *
 *  Uso:  NEFAN_PORT_OFFSET=<n> node qa/fixtures-las-tres-se-caminan.mjs [--headed] [--keep]
 *  Cero créditos: sin ai_server, sin asset-store, sin generadores.
 *
 *  Probado en negativo (2026-09-05): con `probeCollide` devolviendo siempre
 *  `false` desde la página (monkeypatch de `window.__nefan.probeCollide` antes
 *  de medir), el paso 4 se pone rojo en las tres fixtures; con la tecla no
 *  pulsada (`press` omitido), el paso 3.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { puertoOcupado } from "./lib/puertos.mjs";
import { chromium } from "playwright-core";
import { abrirNavegador } from "./lib/navegador.mjs";
import { ctxDeSonda } from "./lib/sonda.mjs";
import { cargarFixture } from "./lib/fixtures.mjs";
import { PUERTOS, offsetActual } from "./lib/stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const SHOTS = join(here, "capturas");
const KEEP = process.argv.includes("--keep");
const PORT = PUERTOS.html;
const OFFSET = offsetActual();
const FIXTURES = ["robledo_tile", "puerto_tile", "zorder_test"];

async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await puertoOcupado(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function medirFixture(page, ctx, fixture, fallos) {
  const f = (msg) => fallos.push(`${fixture}: ${msg}`);
  await cargarFixture(ctx, fixture);

  // 1 · frames que siguen saliendo (dos muestras, como fixtures-sin-bridge).
  const f0 = await page.evaluate(() => window.__nefan.fps().frames);
  await ctx.waitFor(`${fixture} · el renderer emite frames`, (n) => window.__nefan.fps().frames > n + 5, 10_000, f0);
  const f1 = await page.evaluate(() => window.__nefan.fps().frames);

  // 2 · es un tile y su rect es el del tile.
  const escena = await page.evaluate(() => {
    const s = window.__nefan.scene;
    return s ? { id: s.scene_id, tile: s.tile, rect: s.world_rect, objetos: s.objects?.length ?? 0, npcs: s.npcs?.length ?? 0, spawn: s.__player_start } : null;
  });
  if (!escena) { f("no hay escena puesta"); return; }
  const rectOk = escena.rect && escena.rect.minX === -32 && escena.rect.minZ === -32 && escena.rect.maxX === 32 && escena.rect.maxZ === 32;
  if (!escena.tile || escena.tile.tx !== 0 || escena.tile.ty !== 0) f(`scene.tile no es {0,0}: ${JSON.stringify(escena.tile)}`);
  if (!rectOk) f(`world_rect no es el del tile (0,0): ${JSON.stringify(escena.rect)}`);

  // 3 · el jugador anda.
  const p0 = (await ctx.nefan("state")).pos;
  let movio = false;
  await ctx.nefan("inputDriver.press", "up");
  try {
    await ctx.waitFor(
      `${fixture} · el jugador avanza`,
      (o) => {
        const p = window.__nefan.state().pos;
        return Math.hypot(p.x - o.x, p.z - o.z) > 0.5 ? true : null;
      },
      8000,
      { x: p0.x, z: p0.z },
    );
    movio = true;
  } catch (e) {
    f(`el jugador no se mueve con «up» mantenida: ${String(e).slice(0, 120)}`);
  } finally {
    await ctx.nefan("inputDriver.releaseAll");
  }
  const p1 = (await ctx.nefan("state")).pos;

  // 4 · colisión desde la huella.
  const objetivo = await page.evaluate(() => {
    const objs = window.__nefan.scene?.objects ?? [];
    const b = objs.find((o) => o.category === "building") ?? objs.find((o) => o.scale && o.scale[0] >= 1 && o.scale[2] >= 1);
    return b ? { id: b.id, x: b.position[0], z: b.position[2], cat: b.category } : null;
  });
  // Una fixture sin objetos (zorder_test es solo NPCs) no tiene huella que
  // sondear: se DECLARA, no se pinta de rojo (regla 6 de qa/README.md).
  if (!objetivo) console.log(`· ${fixture}: ⊘ sin objetos con huella — la colisión contra edificio no se mide en esta fixture`);
  else {
    const dentro = await ctx.nefan("probeCollide", objetivo.x, objetivo.z);
    if (dentro !== true) f(`el centro de ${objetivo.id} (${objetivo.cat}) NO colisiona`);
  }
  const spawn = escena.spawn;
  if (spawn) {
    const libre = await ctx.nefan("probeCollide", spawn.x, spawn.z);
    if (libre !== false) f(`el spawn del jugador (${spawn.x}, ${spawn.z}) colisiona`);
  }

  console.log(
    `· ${fixture}: frames ${f0}→${f1} · tile ${JSON.stringify(escena.tile)} · rect [${escena.rect?.minX},${escena.rect?.maxX}) · ` +
      `${escena.objetos} objetos · ${escena.npcs} npcs · anduvo ${movio} (${p0.x.toFixed(2)},${p0.z.toFixed(2)})→(${p1.x.toFixed(2)},${p1.z.toFixed(2)})` +
      (objetivo ? ` · colisión en ${objetivo.id}` : ""),
  );
  await page.screenshot({ path: join(SHOTS, `las-tres-${fixture}.png`) });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fallos = [];
  let child = null;

  if (await puertoOcupado(PORT)) {
    console.log(`· :${PORT} ya está arriba — lo uso tal cual, no arranco nada`);
  } else {
    console.log("· arrancando ./start.sh --preset html-fixtures…");
    child = spawn("./start.sh", ["--preset", "html-fixtures"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], detached: true });
    child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
    if (!(await waitPort(PORT, 60000))) throw new Error(`el preset no levantó :${PORT} en 60 s`);
  }

  const browser = await abrirNavegador(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const ctx = ctxDeSonda(page);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    // `input=scripted` instala el driver que `__nefan.inputDriver` expone (sin
    // él es el teclado real); `raf=timer` mantiene el game loop vivo en
    // headless (misma URL que `run.mjs`, sin `ai=`: aquí no hay motor).
    const q = new URLSearchParams({ input: "scripted", raf: "timer" });
    if (OFFSET) q.set("offset", String(OFFSET));
    await page.goto(`http://localhost:${PORT}/?${q}`, { waitUntil: "domcontentloaded" });
    await ctx.waitFor("window.__nefan", () => Boolean(window.__nefan));
    // Sin bridge el arranque falla a propósito (require_bridge) y sale el muro;
    // que cite el socket lo canda `fixtures-sin-bridge.mjs`. Aquí solo se
    // espera y se descarta UNA vez, por el botón del jugador.
    await ctx.waitFor(
      "el muro de arranque del bridge",
      () => document.getElementById("narrative-loader")?.classList.contains("error") === true,
      20000,
    );
    await page.evaluate(() => document.getElementById("narrative-loader-dismiss")?.click());

    for (const fixture of FIXTURES) await medirFixture(page, ctx, fixture, fallos);

    // 5 · ADVERSARIAL (#405): una Format D cruda SIN `tile` ya no es «escena
    // suelta centrada en el origen»: `addTileRaw` la RECHAZA nombrando `tile`
    // y la escena que había sigue puesta. Se usa la fixture real leída del
    // disco, con el campo quitado — no una escena inventada.
    const cruda = JSON.parse(readFileSync(join(repoRoot, "nefan-core", "data", "scenes", "robledo_tile.json"), "utf8"));
    delete cruda.tile;
    const antes = await page.evaluate(() => window.__nefan.scene?.scene_id ?? null);
    const rechazo = await page.evaluate((raw) => {
      try {
        window.__nefan.addTileRaw(raw);
        return null;
      } catch (e) {
        return String(e?.message ?? e);
      }
    }, cruda);
    const despues = await page.evaluate(() => window.__nefan.scene?.scene_id ?? null);
    console.log(`· sin tile → ${rechazo ? `rechazada: «${rechazo.slice(0, 90)}»` : "ACEPTADA"} · escena ${antes} → ${despues}`);
    if (!rechazo) fallos.push("una Format D sin `tile` se ACEPTÓ por addTileRaw (la escena suelta ha vuelto)");
    else if (!/`tile`/.test(rechazo)) fallos.push(`el rechazo no nombra \`tile\`: ${rechazo}`);
    if (antes !== despues) fallos.push(`la escena cambió tras el rechazo: ${antes} → ${despues}`);

    if (pageErrors.length) fallos.push(`${pageErrors.length} excepción(es) en la página: ${pageErrors[0]}`);
  } finally {
    await browser.close();
    if (child && !KEEP) process.kill(-child.pid, "SIGINT");
    else if (child) console.log("· stack sigue arriba (--keep)");
  }

  console.log(`\n${"─".repeat(60)}`);
  if (fallos.length === 0) {
    console.log(`✔ las tres fixtures pintan, se caminan y colisionan sin backend · capturas en qa/capturas/las-tres-*.png`);
    process.exit(0);
  }
  for (const f of fallos) console.log(`✘ ${f}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`✘ ${e?.stack ?? e}`);
  process.exit(1);
});
