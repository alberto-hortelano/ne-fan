#!/usr/bin/env node
/** Fotografía una fixture del selector «Room» desde una celda concreta.
 *
 *  Para mirar el juego, no para decidir nada: los guiones de `qa/guiones/`
 *  siguen siendo quienes dan verde o rojo. Esto existe porque la crítica
 *  visual («¿esto parece un bosque?») se hace mirando, y hasta ahora cada
 *  pareja antes/después salía de un script de usar y tirar que nadie más
 *  podía repetir.
 *
 *  Uso:
 *    ./start.sh --preset html-fixtures      # en otra terminal (solo el cliente)
 *    node qa/captura-de-fixture.mjs <fixture> <etiqueta> [col] [fila] [yaw]
 *
 *    node qa/captura-de-fixture.mjs robledo_tile pinar 25 82 3.14159
 *
 *  `col`/`fila` son celdas del tile (0..127) y `yaw` radianes (π = norte).
 *  La captura sale en `qa/capturas/<etiqueta>.png`. OJO: `node qa/run.mjs`
 *  VACÍA ese directorio al empezar, así que una pareja que quieras conservar
 *  hay que sacarla de ahí o rehacerla después de la batería.
 */
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { abrirNavegador } from "./lib/navegador.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, "capturas");
const BASE = process.env.NEFAN_URL ?? "http://localhost:3000";
const [fixture, etiqueta, col = "64", fila = "64", yaw = String(Math.PI)] = process.argv.slice(2);
if (!fixture || !etiqueta) {
  console.error("uso: node qa/captura-de-fixture.mjs <fixture> <etiqueta> [col] [fila] [yaw]");
  process.exit(2);
}

const browser = await abrirNavegador(chromium, { log: (s) => console.log(s) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}/?input=scripted&raf=timer`, { waitUntil: "domcontentloaded" });

const esperar = (desc, fn, arg, ms = 30000) =>
  page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).catch((e) => {
    throw new Error(`${desc}: ${e.message}`);
  });

await esperar("el título aparece", () => Boolean(document.getElementById("ts-close")));
await page.evaluate(() => window.__nefan.closeTitle());
await page.evaluate((f) => window.__nefan.loadFixture(f), fixture);
await esperar("la fixture carga", () => (window.__nefan.status().scene ? true : null));
await esperar("el mundo 3D instala el tile", () => {
  const f = window.__nefan.fps();
  return f && f.ready && f.activeTile ? true : null;
});

const info = await page.evaluate(
  ({ col, fila, yaw }) => {
    const s = window.__nefan.scene;
    const g = s.terrain_grid;
    const [ox, oz] = g.origin;
    const mpc = g.meters_per_cell;
    window.__nefan.setPlayerPos(ox + col * mpc, oz + fila * mpc);
    window.__nefan.setYaw(yaw);
    const vols = s.__plan?.volumes ?? [];
    return {
      scene_id: s.scene_id,
      objetos: (s.objects ?? []).length,
      pintados: (s.objects ?? []).filter((o) => o.volume_id === undefined).length,
      volumenes: vols.length,
      arboles: vols.filter((v) => v.type === "tree").length,
    };
  },
  { col: Number(col), fila: Number(fila), yaw: Number(yaw) },
);

// Sin bridge, el muro de error del arranque tarda ~5 s en aparecer: se cierra
// por SU botón, como haría una persona (ocultarlo sería trampa).
await page.waitForFunction(() => Boolean(document.getElementById("narrative-loader")?.classList.contains("error")), null, { timeout: 12000 }).catch(() => {});
await page.evaluate(() => document.getElementById("narrative-loader-dismiss")?.click());

const f0 = await page.evaluate(() => window.__nefan.fps().frames);
await esperar("frames nuevos", (f0) => (window.__nefan.fps().frames >= f0 + 5 ? true : null), f0, 20000);
mkdirSync(SHOTS, { recursive: true });
await page.screenshot({ path: join(SHOTS, `${etiqueta}.png`) });
console.log(JSON.stringify(info));
console.log(`captura → qa/capturas/${etiqueta}.png`);
await browser.close();
