#!/usr/bin/env node
/** De dónde sale `MAX_TILE_VOLUMES`: la medida, reproducible desde el árbol.
 *
 *  El presupuesto de volúmenes de un tile no es un número de gusto: es lo que
 *  aguanta el renderer. Cada primitiva del greybox es un `THREE.Mesh` propio,
 *  así que el coste lo marcan las DRAW CALLS y el total de volúmenes
 *  residentes — no los de un tile suelto. Este script mide ese coste con
 *  tiles sintéticos de N volúmenes, con 1 tile y con los 4 que tiene el
 *  jugador al cruzar una esquina del plano continuo.
 *
 *  Uso:
 *    ./start.sh --preset html-fixtures        # en otra terminal (solo el cliente)
 *    node qa/presupuesto-de-volumenes.mjs
 *    node qa/presupuesto-de-volumenes.mjs 120 160 200 240   # otra escalera
 *
 *  Dos cosas que hacen que la cifra signifique algo:
 *
 *  1. **El pump de rAF va sin espera.** El bench sustituye `requestAnimationFrame`
 *     por un tick de Worker de 33 ms (`?raf=timer`), que topa en ~30 fps y no
 *     puede medir 50 ni 60. Aquí se instala por `addInitScript` un pump de
 *     ping-pong SIN espera: el ritmo lo marca el propio frame, así que la
 *     cifra es `1/coste de frame` y no el vsync. Por eso salen números por
 *     encima de 60: no son fps de pantalla, son coste.
 *  2. **Dos posturas, las dos desde el centro de un tile.** Lo que cambia es
 *     hacia dónde se MIRA, porque lo que cuesta es lo que cae en el frustum:
 *     «dentro» mira al eje (el tile propio y un vecino), que es lo que se
 *     tiene andando por el mundo; «esquina» mira a la diagonal del vértice
 *     donde se juntan los cuatro, con los cuatro dentro del frustum — el peor
 *     caso, que dura lo que se tarda en cruzar el vértice.
 *     OJO: ponerse EN el vértice mirando a la diagonal NO es el peor caso,
 *     es el mejor: tres de los cuatro tiles quedan detrás de la cámara y la
 *     medida sale ~2,5× más rápida (medido el 2026-08-26, y me costó una
 *     tabla entera de números que no significaban nada).
 *
 *  Las fixtures las escribe y las borra este script (`data/scenes/perf_*.json`).
 */
import { chromium } from "playwright-core";
import { writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirNavegador } from "./lib/navegador.mjs";
import { URLS } from "./lib/stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCENES = join(here, "..", "nefan-core", "data", "scenes");
const BASE = process.env.NEFAN_URL ?? URLS.html;
const NIVELES = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const ESCALERA = NIVELES.length > 0 ? NIVELES : [120, 160, 200, 240];
const TILES = [[0, 0], [1, 0], [0, 1], [1, 1]];
const SEGUNDOS = 4;

/** Tile sintético de `n` volúmenes: entities `tree` en rejilla, que el plan
 *  deriva a un volumen cada una (el mismo camino que un bosque real). */
function fixture(n, tx, ty) {
  const lado = Math.ceil(Math.sqrt(n));
  const paso = Math.max(2, Math.floor(124 / lado));
  const entities = [];
  for (let i = 0; i < n; i++) {
    entities.push({
      id: `a${i}`,
      kind: "tree",
      name: "pino",
      cell: [2 + (i % lado) * paso, 2 + Math.floor(i / lado) * paso],
      footprint: [4, 4],
      glyph: "t",
    });
  }
  return {
    tile: { tx, ty },
    scene_id: `tile_${tx}_${ty}`,
    scene_description: `Bench de ${n} volúmenes.`,
    biome: "forest_floor",
    ground: [{ id: "senda", kind: "path", points: [[0, 64], [128, 64]], w: 4, material: "dirt" }],
    entities,
  };
}

const escritas = [];
function escribirFixtures(n) {
  for (const [tx, ty] of TILES) {
    const nombre = `perf_${n}_${tx}_${ty}`;
    const ruta = join(SCENES, `${nombre}.json`);
    writeFileSync(ruta, JSON.stringify(fixture(n, tx, ty)));
    escritas.push(ruta);
  }
}
const limpiar = () => { for (const f of escritas.splice(0)) rmSync(f, { force: true }); };
process.on("exit", limpiar);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { limpiar(); process.exit(130); });

for (const n of ESCALERA) escribirFixtures(n);

const browser = await abrirNavegador(chromium, { log: (s) => console.log(s) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Pump sin espera, ANTES de que cargue la app (mismo mecanismo que el de
// index.html, sin los 33 ms): el ritmo lo marca el frame, no el temporizador.
await page.addInitScript(() => {
  const src = "onmessage = () => setTimeout(() => postMessage(0), 0);";
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  let pending = new Map();
  let nextId = 1;
  let scheduled = false;
  worker.onmessage = () => {
    scheduled = false;
    const batch = pending;
    pending = new Map();
    const now = performance.now();
    for (const cb of batch.values()) cb(now);
    if (pending.size > 0 && !scheduled) { scheduled = true; worker.postMessage(0); }
  };
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    pending.set(id, cb);
    if (!scheduled) { scheduled = true; worker.postMessage(0); }
    return id;
  };
  window.cancelAnimationFrame = (id) => { pending.delete(id); };
});
await page.goto(`${BASE}/?input=scripted`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(document.getElementById("ts-close")), null, { timeout: 30000 });
await page.evaluate(() => window.__nefan.closeTitle());
if (!(await page.evaluate(() => typeof window.__nefan.addTileRaw === "function"))) {
  throw new Error("el cliente no expone __nefan.addTileRaw: ¿estás midiendo un build de producción?");
}

async function medir(n, tiles, postura) {
  await page.evaluate((f) => window.__nefan.loadFixture(f), `perf_${n}_0_0`);
  await page.waitForFunction(() => (window.__nefan.status().scene ? true : null), null, { timeout: 60000 });
  for (const [tx, ty] of tiles.slice(1)) {
    const raw = await page.evaluate(
      async (f) => (await fetch(`/@fs${f}`)).json(),
      join(SCENES, `perf_${n}_${tx}_${ty}.json`),
    );
    await page.evaluate((r) => window.__nefan.addTileRaw(r), raw);
  }
  await page.waitForFunction(() => {
    const f = window.__nefan.fps();
    return f && f.ready && f.activeTile ? true : null;
  }, null, { timeout: 60000 });
  await page.evaluate(({ dentro }) => {
    // Las dos posturas se toman desde el CENTRO del tile (0,0) —que ocupa
    // [-32, 32)— y lo que cambia es hacia dónde se mira:
    //  · «dentro» mira al eje +x: se ve el tile propio y UN vecino, que es lo
    //    que se tiene andando por el mundo;
    //  · «esquina» mira a la diagonal +x+z, o sea al vértice donde se juntan
    //    los cuatro: los cuatro caen dentro del frustum. Es el peor caso.
    // OJO: NO vale ponerse EN el vértice (32,32) mirando a la diagonal —
    // desde ahí tres de los cuatro quedan DETRÁS de la cámara y la medida
    // sale ~2,5× más rápida de lo que es.
    window.__nefan.setPlayerPos(0, 0);
    window.__nefan.setYaw(dentro ? Math.PI / 2 : Math.PI / 4);
  }, { dentro: postura === "dentro" });
  // Calentamiento largo (compilación de shaders, primeras subidas de
  // geometría) y tres muestras: se queda la MEJOR, que mide el coste del
  // frame y no el ruido de la máquina.
  await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 4000);
  const muestras = [];
  for (let i = 0; i < 3; i++) {
    const m = await page.evaluate(async (ms) => {
      const f0 = window.__nefan.fps().frames;
      const t0 = performance.now();
      await new Promise((res) => setTimeout(res, ms));
      return { frames: window.__nefan.fps().frames - f0, ms: performance.now() - t0 };
    }, SEGUNDOS * 1000);
    muestras.push((m.frames / m.ms) * 1000);
  }
  const fps = Math.max(...muestras);
  // El plan COMPUESTO es lo que se mide: si el nivel pedido pasa de
  // `MAX_TILE_VOLUMES`, el propio presupuesto lo recorta y la fila lo enseña
  // (pedido ≠ compuesto). Medir por encima del tope exige subirlo a mano.
  const vols = await page.evaluate(() => (window.__nefan.scene?.__plan?.volumes ?? []).length);
  return { fps, ms: 1000 / fps, vols };
}

console.log("\nvol/tile   1 tile            4 tiles (dentro)   4 tiles (esquina)");
for (const n of ESCALERA) {
  const uno = await medir(n, [[0, 0]], "dentro");
  const dentro = await medir(n, TILES, "dentro");
  const esquina = await medir(n, TILES, "esquina");
  const f = (m) => `${m.fps.toFixed(1)} fps (${m.ms.toFixed(1)} ms)`.padEnd(18);
  console.log(`${String(n).padStart(5)} (${String(uno.vols).padStart(4)})  ${f(uno)} ${f(dentro)} ${f(esquina)}`);
}
await browser.close();
limpiar();
