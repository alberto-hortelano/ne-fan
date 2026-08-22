#!/usr/bin/env node
/** ¿PINTA el preset `html-fixtures`?
 *
 *  Vive fuera de `qa/run.mjs` porque su stack es el contrario: run.mjs levanta
 *  `e2e-sin-creditos` (CON bridge) y todos sus guiones lo dan por hecho. Lo que
 *  aquí se prueba es justo lo que promete el preset sin backend —«iterar
 *  renderer y UI con las fixtures del selector Room, cero backend»—, así que
 *  necesita arrancar solo.
 *
 *  Nace del issue #215, y la lección que lo abrió está en su enunciado:
 *  verificar un preset comprobando que sus puertos están arriba NO BASTA.
 *  `qa/presets.mjs` daba verde a `html-fixtures` mientras el lienzo se quedaba
 *  NEGRO con la escena cargada — `gameClient` se quedaba a null sin bridge y el
 *  game loop salía por su guarda antes de `render()`.
 *
 *  El candado NO son píxeles: es `fps().frames`, los frames que el renderer ha
 *  EMITIDO. Un renderer «ready» con tiles instalados no demuestra nada (era
 *  exactamente el estado del bug). Y leer el lienzo desde la página tampoco
 *  vale: `getImageData` sobre un canvas WebGL sin `preserveDrawingBuffer`
 *  devuelve negro AUNQUE el juego esté pintando — ese falso negativo se comió
 *  media hora durante el arreglo. La captura queda para el ojo, no para el
 *  veredicto.
 *
 *  Uso:  node qa/fixtures-sin-bridge.mjs [--headed] [--keep]
 *  Cero créditos: sin ai_server, sin asset-store, sin generadores.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const SHOTS = join(here, "capturas");
const HEADED = process.argv.includes("--headed");
const KEEP = process.argv.includes("--keep");
const PORT = 3000;

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
    setTimeout(() => (s.destroy(), resolve(false)), 800);
  });
}

async function waitPort(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await portBusy(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Espera por ESTADO, nunca por sleep — mismo criterio que qa/run.mjs. */
async function waitFor(page, label, fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout esperando: ${label}`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fallos = [];
  let child = null;

  if (await portBusy(PORT)) {
    console.log(`· :${PORT} ya está arriba — lo uso tal cual, no arranco nada`);
  } else {
    // Por SLUG, no por número: los números de preset se renumeran.
    console.log("· arrancando ./start.sh --preset html-fixtures…");
    child = spawn("./start.sh", ["--preset", "html-fixtures"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
    if (!(await waitPort(PORT, 60000))) throw new Error(`el preset no levantó :${PORT} en 60 s`);
  }

  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: !HEADED,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    await waitFor(page, "window.__nefan", () => Boolean(window.__nefan));

    // Sin bridge, el arranque de partida falla a propósito (require_bridge) y
    // el jugador ve el muro de error. Eso es CORRECTO y se comprueba: lo que
    // no puede pasar es que además se lleve por delante el visor.
    //
    // Se espera por el MURO concreto (#narrative-loader en estado error), no
    // por «un botón que ponga Cerrar»: el título tiene el suyo y aparece al
    // instante, así que esa espera devolvía el control ~4 s antes de que el
    // bootstrap terminara y medía el juego a medio arrancar.
    await waitFor(
      page,
      "el fail-loud del bridge (muro de error)",
      () => document.getElementById("narrative-loader")?.classList.contains("error") === true,
      20000,
    );
    const detalle = await page.evaluate(
      () => document.getElementById("narrative-loader-detail")?.textContent ?? "",
    );
    console.log(`· fail-loud del bridge: "${detalle.slice(0, 70)}…"`);
    if (!/bridge/i.test(detalle)) {
      fallos.push(`el muro de error no habla del bridge: "${detalle.slice(0, 80)}"`);
    }
    await page.screenshot({ path: join(SHOTS, "sin-bridge-01-error-de-arranque.png") });
    await page.evaluate(() => document.getElementById("narrative-loader-dismiss")?.click());

    await page.evaluate(() => window.__nefan.loadFixture("robledo_tile"));
    await waitFor(page, "la fixture cargada", () => window.__nefan.status().scene);

    // EL CANDADO: frames emitidos. Dos muestras separadas — que haya frames no
    // basta, tienen que seguir saliendo.
    const f0 = await page.evaluate(() => window.__nefan.fps().frames);
    await new Promise((r) => setTimeout(r, 1500));
    const f1 = await page.evaluate(() => window.__nefan.fps().frames);
    console.log(`· frames emitidos: ${f0} → ${f1}`);
    if (typeof f1 !== "number") fallos.push("fps().frames no existe: el renderer no lo publica");
    else if (f1 <= f0) fallos.push(`el renderer NO pinta: frames ${f0} → ${f1} (el lienzo se queda negro)`);

    const st = await page.evaluate(() => window.__nefan.fps());
    console.log(`· tiles: ${JSON.stringify(st.tiles)} · billboards: ${st.billboards}`);
    if (!st.tiles?.length) fallos.push("ningún tile instalado en el renderer");
    if (!st.billboards) fallos.push("0 billboards: la fixture trae NPCs y no se montó ninguno");

    await page.screenshot({ path: join(SHOTS, "sin-bridge-02-fixture-pintada.png") });
    if (pageErrors.length) fallos.push(`${pageErrors.length} excepción(es) en la página: ${pageErrors[0]}`);
  } finally {
    await browser.close();
    if (child && !KEEP) process.kill(-child.pid, "SIGINT");
    else if (child) console.log("· stack sigue arriba (--keep)");
  }

  console.log(`\n${"─".repeat(60)}`);
  if (fallos.length === 0) {
    console.log("✔ html-fixtures pinta sin backend · capturas en qa/capturas/");
    process.exit(0);
  }
  for (const f of fallos) console.log(`✘ ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`✘ ERROR: ${err.message}`);
  process.exit(2);
});
