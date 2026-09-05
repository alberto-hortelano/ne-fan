#!/usr/bin/env node
/** Con el preset `html-fixtures` (sin bridge, cero backend), las TRES fixtures
 *  del selector «Room» pintan, y el jugador choca con lo que debe y solo con
 *  eso: el agua del grid y los volúmenes del plan. Nada más del grid bloquea.
 *
 *  Nace en la QA de #407 (`W` sale de `DEFAULT_SOLID_CHARS`). Los guiones 05 y
 *  06 miden lo mismo pero bajo `qa/run.mjs`, o sea CON bridge: la normalización
 *  la hace el servidor. El preset `html-fixtures` recorre el OTRO camino
 *  legítimo hasta la world scene —`addTileRaw` → `formatDToWorld` en el
 *  cliente (regla `solo-el-bridge-normaliza-la-escena`, `max: 2`)— y ese
 *  camino no lo mira ningún guion. Si un día el cliente empaquetara un core
 *  distinto del del bridge, aquí se vería y en el 06 no.
 *
 *  Qué afirma, por fixture:
 *   1. el renderer EMITE frames (mismo candado que `fixtures-sin-bridge.mjs`);
 *   2. `terrain_grid.solid_chars` es EXACTAMENTE `["w"]`;
 *   3. ninguna fila del grid trae el char de muro retirado (`W`): el engine
 *      no lo produce, y una fixture que lo trajera lo pintaría como suelo
 *      transitable sin que nadie avisara;
 *   4. el centro de una celda de agua BLOQUEA (`probeCollide` = unión de las
 *      dos fuentes del cliente); si la fixture no tiene agua, se dice y no se
 *      mide;
 *   5. el arranque del jugador (`__player_start`) NO bloquea;
 *   6. el centro de un volumen del plan (un edificio) BLOQUEA: los muros son
 *      plan, no chars — y siguen chocando después de retirar `W`.
 *
 *  GRUPO: corrida LOCAL (abre Chromium y conduce `./start.sh` sobre los
 *  puertos del catálogo), como `fixtures-sin-bridge.mjs`. No entra en el job
 *  `candados-headless`.
 *
 *  Probado en negativo el día que nace (2026-09-05): con `DEFAULT_SOLID_CHARS`
 *  repuesto a `["W", "w"]` en `nefan-core/src/scene/scene-normalize.ts` (vite
 *  sirve el core desde el fuente), el aserto 2 sale rojo en las tres; con `[]`
 *  también, y SOLO el 2: el aserto 4 sigue verde porque en el cliente el agua
 *  bloquea por DOS fuentes en unión (el grid y el plan `ground`, que
 *  `planCollisionGrid` rasteriza aparte). Es decir: aquí el 4 mide que el agua
 *  bloquea, no que lo haga POR el grid — eso lo mide, sobre el grid a secas,
 *  `createTerrainCollider` en `nefan-core/test/scene-normalize.test.ts` (#407).
 *
 *  Uso:  NEFAN_PORT_OFFSET=N node qa/las-fixtures-solo-chocan-con-el-agua.mjs [--headed] [--keep]
 *  Si `:html` del bloque ya está arriba se usa tal cual (no arranca nada).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { cargarFixture } from "./lib/fixtures.mjs";
import { abrirNavegador } from "./lib/navegador.mjs";
import { puertoOcupado } from "./lib/puertos.mjs";
import { ctxDeSonda } from "./lib/sonda.mjs";
import { PUERTOS, offsetActual } from "./lib/stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const SHOTS = join(here, "capturas");
const HEADED = process.argv.includes("--headed");
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

/** Lee del mundo puesto lo que hace falta para sondear la colisión: el grid,
 *  sus sólidos, una celda de agua (si hay), el arranque y un volumen del plan. */
function fotoDelMundo() {
  const s = window.__nefan.scene;
  const g = s.terrain_grid;
  const [ox, oz] = g.origin;
  const m = g.meters_per_cell;
  const cuenta = {};
  let agua = null;
  let conW = 0;
  g.grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      cuenta[ch] = (cuenta[ch] ?? 0) + 1;
      if (ch === "W") conW++;
      // Una celda de agua MACIZA: sus 8 vecinas también agua, para que el
      // cuerpo del jugador (0,4 m de radio) no roce un char de al lado.
      if (agua === null && ch === "w" && r > 0 && r < g.rows - 1 && c > 0 && c < row.length - 1) {
        const vecinas = [-1, 0, 1].every((dr) => [-1, 0, 1].every((dc) => g.grid[r + dr][c + dc] === "w"));
        if (vecinas) agua = { c, r, x: ox + (c + 0.5) * m, z: oz + (r + 0.5) * m };
      }
    }
  });
  // Un volumen del plan: primero un edificio ya montado como objeto; si la
  // fixture no monta objetos (zorder_test declara sus edificios solo en
  // `volumes`), el centro del `rect` [c, r, w, h] del primer `building` del plan.
  let edificio = null;
  const obj = (s.objects ?? []).find((o) => o.category === "building");
  if (obj) edificio = { id: obj.id, x: obj.position[0], z: obj.position[2], origen: "objects" };
  else {
    const v = (s.__plan?.volumes ?? []).find((vol) => vol.type === "building" && Array.isArray(vol.rect));
    if (v) {
      const [c, r, w, h] = v.rect;
      edificio = { id: v.id, x: ox + (c + w / 2) * m, z: oz + (r + h / 2) * m, origen: "__plan.volumes" };
    }
  }
  return {
    scene_id: s.scene_id,
    solid_chars: g.solid_chars,
    cuenta,
    conW,
    agua,
    arranque: s.__player_start ?? null,
    edificio,
    objetos: (s.objects ?? []).length,
  };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fallos = [];
  let child = null;

  if (await puertoOcupado(PORT)) {
    console.log(`· :${PORT} ya está arriba — lo uso tal cual, no arranco nada`);
  } else {
    console.log(`· arrancando ./start.sh --preset html-fixtures (bloque +${OFFSET})…`);
    child = spawn("./start.sh", ["--preset", "html-fixtures"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.stdout.on("data", (b) => process.env.QA_VERBOSE && process.stdout.write(`  | ${b}`));
    if (!(await waitPort(PORT, 60000))) throw new Error(`el preset no levantó :${PORT} en 60 s`);
  }

  const browser = await abrirNavegador(chromium, { headed: HEADED });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const ctx = ctxDeSonda(page);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const afirma = (fixture, que, ok, detalle) => {
    console.log(`    ${ok ? "✔" : "✘"} ${que}${detalle ? ` · ${detalle}` : ""}`);
    if (!ok) fallos.push(`${fixture}: ${que}${detalle ? ` (${detalle})` : ""}`);
  };

  try {
    await page.goto(`http://localhost:${PORT}/${OFFSET ? `?offset=${OFFSET}` : ""}`, {
      waitUntil: "domcontentloaded",
    });
    await ctx.waitFor("window.__nefan", () => Boolean(window.__nefan));
    // Sin bridge el arranque de partida falla a propósito y el jugador ve el
    // muro; se cierra (lo mide `fixtures-sin-bridge.mjs`, aquí es el camino).
    // Se espera al muro DE BOOTSTRAP por su titular y no a «un muro en rojo»:
    // el del socket sale a los ~0 ms y el del arranque a los ~5 s; cerrar el
    // primero deja el segundo encima de todas las capturas (medido el día que
    // nace este guion).
    await ctx.waitFor(
      "el muro de arranque del bridge",
      () =>
        document.getElementById("narrative-loader")?.classList.contains("error") === true &&
        (document.getElementById("narrative-loader-title")?.textContent ?? "").includes(
          "No se pudo arrancar la partida",
        ),
      20000,
    );
    await page.evaluate(() => document.getElementById("narrative-loader-dismiss")?.click());
    await ctx.waitFor(
      "el muro se cierra",
      () => document.getElementById("narrative-loader")?.classList.contains("error") !== true,
      5000,
    );

    for (const fixture of FIXTURES) {
      console.log(`▶ ${fixture}`);
      await cargarFixture(ctx, fixture);

      // 1 · pinta: los frames SIGUEN saliendo (espera por estado, no por reloj).
      const f0 = await page.evaluate(() => window.__nefan.fps().frames);
      const f1 = await ctx.waitFor(
        "el renderer emite más frames",
        (desde) => {
          const f = window.__nefan.fps().frames;
          return f > desde + 5 ? f : null;
        },
        10000,
        f0,
      );
      afirma(fixture, "el renderer pinta (frames siguen saliendo)", f1 > f0, `${f0} → ${f1}`);

      const foto = await page.evaluate(fotoDelMundo);
      ctx.log(`chars del grid: ${JSON.stringify(foto.cuenta)} · objetos: ${foto.objetos}`);

      // 2 · solo el agua es sólida.
      afirma(
        fixture,
        "`solid_chars` es EXACTAMENTE [\"w\"] (#407)",
        JSON.stringify(foto.solid_chars) === JSON.stringify(["w"]),
        JSON.stringify(foto.solid_chars),
      );
      // 3 · el char de muro retirado no aparece en el grid.
      afirma(fixture, "ninguna celda del grid es el muro retirado `W`", foto.conW === 0, `${foto.conW} celdas`);

      // 4 · el agua bloquea.
      if (foto.agua) {
        const choca = await ctx.nefan("probeCollide", foto.agua.x, foto.agua.z);
        afirma(fixture, "el centro de una celda de agua BLOQUEA", choca === true, `celda [${foto.agua.c}, ${foto.agua.r}]`);
      } else {
        ctx.log("sin agua maciza en esta fixture: el aserto 4 no aplica (se dice, no se aprueba)");
      }

      // 5 · el arranque del jugador es transitable.
      afirma(fixture, "hay `__player_start`", Boolean(foto.arranque), JSON.stringify(foto.arranque));
      if (foto.arranque) {
        const choca = await ctx.nefan("probeCollide", foto.arranque.x, foto.arranque.z);
        afirma(fixture, "el arranque del jugador NO bloquea", choca === false, `(${foto.arranque.x}, ${foto.arranque.z})`);
      }

      // 6 · un volumen del plan bloquea (los muros son plan, no chars).
      if (foto.edificio) {
        const choca = await ctx.nefan("probeCollide", foto.edificio.x, foto.edificio.z);
        afirma(fixture, "el centro de un edificio del plan BLOQUEA", choca === true, `${foto.edificio.id} (${foto.edificio.x}, ${foto.edificio.z})`);
      } else {
        ctx.log("sin edificios en esta fixture: el aserto 6 no aplica (se dice, no se aprueba)");
      }

      await page.screenshot({ path: join(SHOTS, `solo-agua-${fixture}.png`) });
    }

    if (pageErrors.length) fallos.push(`${pageErrors.length} excepción(es) en la página: ${pageErrors[0]}`);
  } finally {
    await browser.close();
    if (child && !KEEP) process.kill(-child.pid, "SIGINT");
    else if (child) console.log("· stack sigue arriba (--keep)");
  }

  console.log(`\n${"─".repeat(60)}`);
  if (fallos.length === 0) {
    console.log("✔ las tres fixtures pintan sin bridge y solo chocan con el agua y el plan · capturas en qa/capturas/solo-agua-*.png");
    process.exit(0);
  }
  for (const f of fallos) console.log(`✘ ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`✘ ERROR: ${err.message}`);
  process.exit(2);
});
