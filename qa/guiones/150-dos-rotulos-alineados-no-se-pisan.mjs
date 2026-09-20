/** DOS PERSONAJES ALINEADOS NO PRODUCEN DOS RÓTULOS PISADOS (#484, punto 3).
 *
 *  EL DEFECTO, medido: en el tile de partida, el tabernero (8,3 m) y el bandido
 *  (12,3 m) proyectan sus cajas a 9 px una de otra en vertical, con cajas de
 *  21 px de alto — o sea que se solapan más de la mitad— y sus bordes
 *  horizontales se rozan (entre −5 y +5 px según dónde ande el tabernero, que
 *  pasea). El resultado no son dos nombres: es un amasijo del que no se lee
 *  ninguno.
 *
 *  LA REGLA, y por qué no es «se oculta el más lejano» a secas: `pickAimTarget`
 *  gana por desviación ANGULAR, no por distancia (`scene/aim.ts`), así que el
 *  que la mirilla enfila puede ser perfectamente el más LEJANO de los dos.
 *  Ocultar «el lejano» apagaría el nombre de aquello a lo que apuntas y dejaría
 *  la mirilla encendida sobre un bulto anónimo, que es el defecto exacto que el
 *  rótulo vino a cerrar. La regla es una sola frase: se ordenan por PRIORIDAD
 *  —el enfilado primero, luego por profundidad ascendente— y el que interseque
 *  a uno ya colocado no se emite (`nefan-core/src/scene/rotulos-apilados.ts`,
 *  con su propia batería: aquí se mide que el cliente la USA con cajas de
 *  verdad).
 *
 *  POR LA PUERTA DE FIXTURES (`loadSceneRaw`, la misma del selector «Room»,
 *  igual que el §2 del guion 79): la geometría tiene que ser EXACTA —dos
 *  cuerpos que se distinguen para apuntar y dos cajas que se pisan— y el tile
 *  del motor falso la deja al azar del paseo de sus NPCs. Se parte de
 *  `robledo_tile` para no inventar el esqueleto del Format D.
 *
 *  LOS CUATRO ESTADOS:
 *   1. Sin apuntar a ninguno (mirada arriba, fuera del cono): se ve el CERCANO
 *      y el lejano sale en `data-tapados` del contenedor. Que salga ahí es la
 *      prueba de que se pisaban: core solo mete en esa lista lo que intersecó.
 *   2. Apuntando al LEJANO: se invierte — el lejano a la vista y el cercano
 *      tapado. Es la excepción, y sin ella la mirilla se encendería sobre un
 *      nombre que no está.
 *   3. Apuntando al CERCANO: vuelve al caso 1 por el otro camino.
 *   4. SEPARÁNDOLOS: el jugador se mueve de lado hasta que las cajas dejan de
 *      pisarse y vuelven los DOS, con `data-tapados` vacío. Es el control que
 *      distingue «lo tapó la criba» de «ese rótulo ya no existía» — sin él,
 *      los tres primeros estados saldrían igual de verdes con los rótulos rotos.
 *
 *  No lee píxeles para decidir: los asertos van contra el DOM
 *  (`[data-label-id]`, `#world-labels[data-tapados]`). Las medidas en píxeles
 *  que se registran son para que un humano vea de cuánto va el solape.
 *
 *  PROBADO EN NEGATIVO (2026-09-14): anulando la criba en `ui/world-labels.ts`
 *  (emitir siempre, `tapados` vacío) se ponen rojos los estados 1, 2 y 3 y el 4
 *  sigue verde — que es lo que tiene que pasar, porque el 4 es el control.
 *  Cero créditos: motor falso, modo maqueta.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["fake-ai"];

const AQUI = dirname(fileURLToPath(import.meta.url));
const ROBLEDO = join(AQUI, "..", "..", "nefan-core", "data", "scenes", "robledo_tile.json");

const CERCA = { id: "aldeana_cerca", nombre: "Aldeana del pozo viejo", cell: [64, 64] };
/** 1,5 m a la derecha y 11,5 m por delante del jugador: sus CUERPOS se
 *  distinguen para apuntar (7,4° de desviación, dentro del cono de 9°) y sus
 *  CAJAS se pisan (≈65 px de separación horizontal frente a ~130 px de ancho).
 *  Y a 11,5 m sigue dentro del alcance de puntería (`AIM_RANGE_M` = 12 m): un
 *  metro más lejos y la excepción de la mirilla sería inmedible. */
const LEJOS = { id: "lenador_lejos", nombre: "Leñador de la vereda", cell: [67, 57] };
/** Donde se planta el jugador: 8 m por detrás del cercano, en su misma vertical. */
const JUGADOR = { cell: [64, 80] };
/** Grados de mirada por píxel de ratón (`nefan-core/src/simulation/mirada.ts`). */
const GRADOS_POR_PX = (0.0025 * 180) / Math.PI;

/** Espera a que el bucle pinte `n` fotogramas más: los rótulos se sincronizan
 *  DESPUÉS de render(), así que tras mover al jugador hay que dejar pasar el
 *  frame antes de leer el DOM.
 *
 *  Con dueño único desde #606 (`qa/lib/fotogramas.mjs`): "loop" porque los
 *  rótulos se colocan al pintar: lo que tiene que correr es el loop del
 *  renderer.
 */
const frames = esperaDeFotogramas("loop");

/** Mueve el RATÓN hasta que la mirada llega al ángulo pedido (calcado del 79). */
function mirarA(ctx, grados) {
  return ctx.waitFor(
    `la mirada llega a ${grados}°`,
    ({ g, gpp }) => {
      const f = window.__nefan.fps();
      if (!f?.ready || typeof f.pitchDeg !== "number") return null;
      const falta = g - f.pitchDeg;
      if (Math.abs(falta) <= 1.5) return { pitchDeg: f.pitchDeg };
      window.__nefan.inputDriver.queueLook(0, -Math.max(-30, Math.min(30, falta)) / gpp);
      return null;
    },
    10_000,
    { g: grados, gpp: GRADOS_POR_PX },
  );
}

/** Qué rótulos hay a la vista, cuáles se callaron por tapados y qué caja ocupa
 *  cada uno de los visibles. Todo en una evaluación: dos lecturas separadas
 *  describirían dos instantes. */
function foto() {
  const host = document.getElementById("world-labels");
  const vistos = Array.from(host.querySelectorAll("[data-label-id]")).map((n) => {
    const r = n.getBoundingClientRect();
    return {
      id: n.dataset.labelId,
      texto: n.textContent,
      focus: n.dataset.focus === "true",
      caja: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
  return {
    ids: vistos.map((v) => v.id),
    vistos,
    tapados: (host.dataset.tapados ?? "").split(" ").filter(Boolean),
    mirilla: document.getElementById("reticle")?.dataset.target ?? null,
  };
}

export default async function (ctx) {
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  // ── El escenario, exacto ────────────────────────────────────────────────
  const robledo = JSON.parse(readFileSync(ROBLEDO, "utf8"));
  await ctx.nefan("loadSceneRaw", {
    ...robledo,
    scene_id: "qa150",
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: JUGADOR.cell, footprint: [1, 1] },
      { id: CERCA.id, kind: "npc", name: CERCA.nombre, cell: CERCA.cell, footprint: [1, 1], description: "aldeana de saya parda" },
      { id: LEJOS.id, kind: "npc", name: LEJOS.nombre, cell: LEJOS.cell, footprint: [1, 1], description: "leñador de hacha al hombro" },
    ],
  });
  await ctx.waitFor("el tile del guion está pintado", () => (window.__nefan.scene?.scene_id === "qa150" ? true : null), 30_000);
  const cuerpos = await ctx.waitFor(
    "los dos personajes están en el cliente",
    (a) => {
      const c = window.__nefan.npcs().find((n) => n.id === a.cerca);
      const l = window.__nefan.npcs().find((n) => n.id === a.lejos);
      return c && l ? { cerca: c.pos, lejos: l.pos } : null;
    },
    30_000,
    { cerca: CERCA.id, lejos: LEJOS.id },
  );

  /** Planta al jugador donde toca y lo encara a un punto. */
  const plantarse = async (x, z, hacia) => {
    await ctx.nefan("setPlayerPos", x, z);
    await ctx.nefan("setYaw", Math.atan2(hacia.x - x, hacia.z - z));
    await frames(ctx, 2);
  };
  const medio = { x: (cuerpos.cerca.x + cuerpos.lejos.x) / 2, z: (cuerpos.cerca.z + cuerpos.lejos.z) / 2 };
  const base = { x: cuerpos.cerca.x, z: cuerpos.cerca.z + 8 };
  await plantarse(base.x, base.z, medio);
  const sitio = await ctx.page.evaluate((a) => {
    const p = window.__nefan.state().pos;
    const d = (q) => Math.hypot(q.x - p.x, q.z - p.z);
    return { pos: { x: p.x, z: p.z }, dCerca: d(a.cerca), dLejos: d(a.lejos) };
  }, cuerpos);
  ctx.log(`jugador en ${JSON.stringify(sitio.pos)} · cercano a ${sitio.dCerca.toFixed(2)} m · lejano a ${sitio.dLejos.toFixed(2)} m`);
  ctx.expect(
    "precondición: uno está claramente más cerca que el otro y los dos dentro del alcance de puntería (12 m)",
    sitio.dCerca < sitio.dLejos - 2 && sitio.dLejos < 12,
    JSON.stringify(sitio),
  );

  // ── 1 · Sin apuntar a ninguno: se ve el CERCANO ─────────────────────────
  // Mirando 10° por encima: los dos quedan fuera del cono de puntería (9°) y
  // sus rótulos siguen en pantalla, así que lo único que decide es la criba.
  await mirarA(ctx, 10);
  await frames(ctx, 2);
  const sinApuntar = await ctx.page.evaluate(foto);
  ctx.log(`sin apuntar: ${JSON.stringify(sinApuntar)}`);
  ctx.expect(
    "precondición: con la mirada arriba la mirilla está apagada (nadie tiene el foco)",
    sinApuntar.mirilla === "false" && sinApuntar.vistos.every((v) => !v.focus),
    JSON.stringify({ mirilla: sinApuntar.mirilla, focos: sinApuntar.vistos.filter((v) => v.focus).map((v) => v.id) }),
  );
  ctx.expect(
    "de dos rótulos que se pisan solo queda UNO en pantalla, y es el del CERCANO",
    sinApuntar.ids.length === 1 && sinApuntar.ids[0] === CERCA.id,
    JSON.stringify(sinApuntar.ids),
  );
  ctx.expect(
    "…y el que falta no se ha esfumado: está declarado como TAPADO, que es lo que distingue «no cabe» de «no está»",
    sinApuntar.tapados.length === 1 && sinApuntar.tapados[0] === LEJOS.id,
    JSON.stringify(sinApuntar.tapados),
  );
  await ctx.shot("sin-apuntar-queda-el-cercano");

  // ── 2 · Apuntando al LEJANO: se invierte ────────────────────────────────
  await mirarA(ctx, 0);
  const enfilandoAlLejano = await ctx.waitFor(
    "la mirilla enfila al LEJANO (que es el que el cono elige, no el cercano)",
    (a) => {
      const l = window.__nefan.npcs().find((n) => n.id === a.lejos);
      const p = window.__nefan.state().pos;
      window.__nefan.setYaw(Math.atan2(l.pos.x - p.x, l.pos.z - p.z));
      const el = document.querySelector(`#world-labels [data-label-id="${a.lejos}"]`);
      return el?.dataset.focus === "true" ? { ok: true } : null;
    },
    15_000,
    { lejos: LEJOS.id },
  );
  ctx.expect("precondición: el foco es del lejano", Boolean(enfilandoAlLejano.ok));
  const alLejano = await ctx.page.evaluate(foto);
  ctx.log(`apuntando al lejano: ${JSON.stringify(alLejano)}`);
  ctx.expect(
    "APUNTANDO AL LEJANO, el que se ve es el suyo: la mirilla nunca se enciende sobre un bulto anónimo",
    alLejano.ids.length === 1 && alLejano.ids[0] === LEJOS.id && alLejano.mirilla === "true",
    JSON.stringify({ ids: alLejano.ids, mirilla: alLejano.mirilla }),
  );
  ctx.expect(
    "…y el que se calla ahora es el CERCANO, declarado como tapado",
    alLejano.tapados.length === 1 && alLejano.tapados[0] === CERCA.id,
    JSON.stringify(alLejano.tapados),
  );
  await ctx.shot("apuntando-al-lejano-queda-el-suyo");

  // ── 3 · Apuntando al CERCANO: vuelve el caso 1 por el otro camino ───────
  const enfilandoAlCercano = await ctx.waitFor(
    "la mirilla enfila al CERCANO",
    (a) => {
      const c = window.__nefan.npcs().find((n) => n.id === a.cerca);
      const p = window.__nefan.state().pos;
      window.__nefan.setYaw(Math.atan2(c.pos.x - p.x, c.pos.z - p.z));
      const el = document.querySelector(`#world-labels [data-label-id="${a.cerca}"]`);
      return el?.dataset.focus === "true" ? { ok: true } : null;
    },
    15_000,
    { cerca: CERCA.id },
  );
  ctx.expect("precondición: el foco es del cercano", Boolean(enfilandoAlCercano.ok));
  const alCercano = await ctx.page.evaluate(foto);
  ctx.log(`apuntando al cercano: ${JSON.stringify(alCercano)}`);
  ctx.expect(
    "apuntando al CERCANO queda el suyo y el lejano se calla",
    alCercano.ids.length === 1 && alCercano.ids[0] === CERCA.id && alCercano.tapados[0] === LEJOS.id,
    JSON.stringify({ ids: alCercano.ids, tapados: alCercano.tapados }),
  );

  // ── 4 · CONTROL: separándolos vuelven los dos ───────────────────────────
  // El jugador se aparta de lado hasta que las dos cajas dejan de pisarse. Sin
  // este control, los tres estados de arriba saldrían igual de verdes con los
  // rótulos simplemente rotos.
  // Se planta en la PERPENDICULAR a la línea que une a los dos, a 6 m del punto
  // medio: desde ahí los ve a los dos a la misma distancia y separados ~35° en
  // vez de los 7,4° de antes. Sigue sin apuntar a ninguno (los dos quedan a
  // 17° del centro, fuera del cono de 9°), así que lo único que cambia respecto
  // al estado 1 es que las cajas ya no se pisan.
  const eje = { x: cuerpos.lejos.x - cuerpos.cerca.x, z: cuerpos.lejos.z - cuerpos.cerca.z };
  const largo = Math.hypot(eje.x, eje.z);
  const perp = { x: -eje.z / largo, z: eje.x / largo };
  const aLado = { x: medio.x + perp.x * 6, z: medio.z + perp.z * 6 };
  await plantarse(aLado.x, aLado.z, medio);
  const separados = await ctx.page.evaluate((a) => {
    const p = window.__nefan.state().pos;
    const d = (q) => Math.hypot(q.x - p.x, q.z - p.z);
    return { pos: { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 }, dCerca: d(a.cerca), dLejos: d(a.lejos) };
  }, cuerpos);
  const conLosDos = await ctx.page.evaluate(foto);
  ctx.log(`separados (jugador en ${JSON.stringify(separados.pos)}): ${JSON.stringify(conLosDos)}`);
  ctx.expect(
    "CONTROL: cuando las cajas ya no se pisan vuelven los DOS rótulos, y nadie queda declarado tapado",
    conLosDos.ids.length === 2 &&
      conLosDos.ids.includes(CERCA.id) &&
      conLosDos.ids.includes(LEJOS.id) &&
      conLosDos.tapados.length === 0,
    JSON.stringify({ ids: conLosDos.ids, tapados: conLosDos.tapados }),
  );
  if (conLosDos.vistos.length === 2) {
    const [a, b] = conLosDos.vistos;
    const sx = Math.min(a.caja.x + a.caja.w, b.caja.x + b.caja.w) - Math.max(a.caja.x, b.caja.x);
    const sy = Math.min(a.caja.y + a.caja.h, b.caja.y + b.caja.h) - Math.max(a.caja.y, b.caja.y);
    ctx.log(`cajas ya separadas: ${a.id} ${JSON.stringify(a.caja)} · ${b.id} ${JSON.stringify(b.caja)} · cruce x=${sx} y=${sy}`);
    ctx.expect(
      "…y es verdad que ya no se cruzan: las dos cajas están disjuntas en pantalla",
      sx <= 0 || sy <= 0,
      `cruce x=${sx} y=${sy}`,
    );
  }
  await ctx.shot("separados-vuelven-los-dos");
}
