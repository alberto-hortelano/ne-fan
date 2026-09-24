/** #578 · QA de la tanda BE: lo que el 214 no mira del mundo cuya ENTRADA se
 *  regeneró dentro de su propio mapa — ANDAR hasta el anillo, volver a
 *  empezar y reanudar.
 *
 *  El 214 cruza al anillo con `pedirYEsperarTile` + `setPlayerPos` dentro del
 *  tile vecino. Aquí el cruce del BORDE se anda con la tecla W (la frontera
 *  pide el tile al bridge como en partida); lo único que se teletransporta es
 *  el punto de partida, a unos metros del borde este de la entrada, para no
 *  depender de la ruta que el motor falso deje libre desde el spawn.
 *
 *   1 · Antes de Comenzar, qué dice el título de un mundo cuya entrada está
 *       rota: NO «✓ generado», y el remedio de verdad —Comenzar la regenera
 *       con una llamada— en vez de «regenera el mundo» (H1 de esta QA).
 *   2 · Comenzar: UNA petición al motor, sin sembrar.
 *   3 · Andando al este se cruza a `tile_1_0` sin gastar, y su panel
 *       «Salidas» NO está vacío.
 *   4 · El fichero quedó curado: el título dice «✓ generado» y un SEGUNDO
 *       Comenzar replayea sin ninguna llamada, con las salidas del anillo.
 *   5 · Reanudar la primera partida (el save pasa por `WorldMapSchema`): la
 *       escena vuelve y el anillo sigue teniendo salidas, sin gastar.
 *
 *  Misma divergencia fabricada que el 214 (`taberna_bench_place` →
 *  `taberna_del_fichero` en el FICHERO). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import {
  abrirSelectorDeMundos,
  comenzar,
  nuevaPartida,
  pedirYEsperarTile,
  reanudar,
  recargarAlTitulo,
  regenerarMundo,
} from "../lib/sesion.mjs";
import { botonesDeSalida } from "../lib/viaje.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

/** "mundo": el sujeto es que el jugador ANDA hasta cruzar el borde. */
const frames = esperaDeFotogramas("mundo");

export const aisla = ["mundo", "fake-ai", "saves"];

const GAME = "alta_fantasia";
const LUGAR_VIEJO = "taberna_bench_place";
const LUGAR_DEL_FICHERO = "taberna_del_fichero";
const VECINO = "tile_1_0";
/** El borde este de la entrada, en metros (tile de 64 m centrado en 0). */
const BORDE_ESTE = 32;

async function escenasPedidas() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return { n: c?.gasto?.rutas?.["/generate_scene"] ?? 0, ultima: c?.ultimaPeticionDeEscena ?? null };
}

function romperLaEntrada(snap) {
  const entrada = snap.scenes[snap.entry_scene_id];
  const npc = (entrada.entities ?? []).find((e) => e.kind === "npc");
  const solido = (entrada.volumes ?? []).find(
    (v) => Array.isArray(v.rect) && v.rect.length === 4 && (v.type === "prop" || (v.type === "building" && v.cutaway !== true)),
  );
  if (!npc || !solido) return null;
  const [c0, r0, w, d] = solido.rect;
  npc.cell = [Math.floor(c0 + w / 2), Math.floor(r0 + d / 2)];
  return npc.id;
}

async function leerTitulo(ctx) {
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME}"]`);
  const leido = await ctx.page.evaluate(
    (gameId) => ({
      tarjeta: document.querySelector(`[data-game-id="${gameId}"]`)?.textContent ?? "",
      estado: document.getElementById("ts-gen-state")?.textContent ?? "",
    }),
    GAME,
  );
  await ctx.page.click("#ts-back");
  return leido;
}

/** Salidas del tile activo, esperando a que lleguen. */
async function salidasDelTile(ctx, desc) {
  return ctx.waitFor(
    desc,
    () => {
      const e = window.__nefan.exits ?? [];
      return e.length > 0 ? e.map((x) => x.place_id) : null;
    },
    15_000,
  );
}

/** Anda al este con W desde (x0, z) hasta que el tile activo sea el vecino.
 *  Devuelve la x alcanzada y si cruzó. */
async function andarAlEste(ctx, x0, z) {
  await ctx.nefan("setPlayerPos", x0, z);
  await ctx.nefan("setYaw", Math.PI / 2);
  await ctx.page.keyboard.down("w");
  let cruzo = false;
  try {
    for (let i = 0; i < 30; i++) {
      await frames(ctx, 20);
      const t = await ctx.page.evaluate(() => window.__nefan.currentTile);
      if (t === VECINO) {
        cruzo = true;
        break;
      }
    }
  } finally {
    await ctx.page.keyboard.up("w");
  }
  const fin = await ctx.page.evaluate(() => ({ tile: window.__nefan.currentTile, x: window.__nefan.playerPos?.x, z: window.__nefan.playerPos?.z }));
  return { cruzo, tile: fin.tile, x: fin.x, z: fin.z };
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay tile.json que editar");
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const leer = () => JSON.parse(readFileSync(tileJson, "utf8"));

  // El proveedor de TECLADO (sin `?input=scripted`), como el 37: el cruce se
  // anda con la tecla W de verdad, no con el driver de bench.
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));

  await regenerarMundo(ctx, GAME);
  if (!existsSync(tileJson)) ctx.sinMedir(`«Generar mundo» no dejó ${tileJson}`);
  const intacto = leer();
  const anillo = Object.keys(intacto.scenes).filter((id) => id !== intacto.entry_scene_id);
  ctx.expect("el mundo pre-generado trae el anillo de 8 con el vecino este", anillo.length === 8 && anillo.includes(VECINO), JSON.stringify(anillo));

  const fichero = JSON.parse(JSON.stringify(intacto).replaceAll(`"${LUGAR_VIEJO}"`, `"${LUGAR_DEL_FICHERO}"`));
  for (const id of anillo) fichero.scenes[id].place_id = LUGAR_DEL_FICHERO;
  if (!romperLaEntrada(fichero)) ctx.sinMedir("la entrada no se puede romper");
  writeFileSync(tileJson, JSON.stringify(fichero, null, 2) + "\n", "utf8");

  // ── 1 · el título antes de Comenzar ──────────────────────────────────────
  await recargarAlTitulo(ctx);
  const antesTitulo = await leerTitulo(ctx);
  ctx.log(`1 · título con la entrada rota: tarjeta «${antesTitulo.tarjeta.slice(0, 80)}» · estado «${antesTitulo.estado}»`);
  ctx.expect("1 · el título NO da por bueno un mundo cuya entrada no se sirve", !/✓ generado/.test(antesTitulo.estado), antesTitulo.estado);
  // H1 de la QA de BE: el remedio que dice es el de verdad — Comenzar, con una
  // llamada — y no «regenera el mundo», que son nueve.
  ctx.expect(
    "1 · …y dice el remedio de verdad: Comenzar regenera la entrada con UNA llamada",
    antesTitulo.estado.includes("la entrada se regenerará al empezar (1 llamada al motor)") && !antesTitulo.estado.includes("regenera el mundo"),
    antesTitulo.estado,
  );

  // ── 2 · Comenzar ─────────────────────────────────────────────────────────
  const a0 = await escenasPedidas();
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "vector", charMode: "vector" });
  const primera = await comenzar(ctx);
  const a1 = await escenasPedidas();
  ctx.expect("2 · la entrada rota cuesta UNA petición, sin sembrar", a1.n === a0.n + 1 && a1.ultima?.bootstrap_world_map === false, `${a0.n}→${a1.n} ${JSON.stringify(a1.ultima)}`);

  // ── 3 · andar al anillo ─────────────────────────────────────────────────
  // El vecino llega por la frontera (lo que pasa al acercarse al borde) y se
  // cruza ANDANDO. Se prueban varias líneas por si una choca con algo.
  await pedirYEsperarTile(ctx, VECINO, 1, 0);
  let cruce = { cruzo: false, tile: null };
  for (const z of [0, 6, -6, 12, -12, 20, -20]) {
    cruce = await andarAlEste(ctx, BORDE_ESTE - 6, z);
    ctx.log(`3 · andando al este por z=${z}: ${JSON.stringify(cruce)}`);
    if (cruce.cruzo) break;
  }
  ctx.expect(`3 · andando con W se cruza de la entrada a ${VECINO}`, cruce.cruzo, JSON.stringify(cruce));
  const exits = await salidasDelTile(ctx, "el tile del anillo, pisado andando, trae sus salidas");
  const botones = await botonesDeSalida(ctx);
  ctx.log(`3 · salidas ${JSON.stringify(exits)} · botones ${JSON.stringify(botones)}`);
  ctx.expect(`3 · el panel «Salidas» de ${VECINO} NO está vacío`, botones.length > 0, JSON.stringify(botones));
  ctx.expect("3 · cruzar andando no cuesta ninguna llamada", (await escenasPedidas()).n === a1.n, String((await escenasPedidas()).n));
  await ctx.shot("salidas-tras-cruzar-andando");

  // ── 4 · el fichero curado se sirve sin motor ────────────────────────────
  const curado = leer();
  ctx.expect("4 · el fichero curado conserva los lugares del fichero", JSON.stringify(Object.keys(curado.world_map.places).sort()) === JSON.stringify(Object.keys(fichero.world_map.places).sort()), JSON.stringify(Object.keys(curado.world_map.places)));
  await recargarAlTitulo(ctx);
  const despuesTitulo = await leerTitulo(ctx);
  ctx.log(`4 · título tras la cura: estado «${despuesTitulo.estado}»`);
  ctx.expect("4 · el título dice «✓ generado» tras regenerar la entrada", /✓ generado/.test(despuesTitulo.estado), despuesTitulo.estado);
  const b0 = await escenasPedidas();
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "vector", charMode: "vector" });
  await comenzar(ctx);
  ctx.expect("4 · el segundo Comenzar replayea: CERO peticiones al motor", (await escenasPedidas()).n === b0.n, `${b0.n}→${(await escenasPedidas()).n}`);
  await pedirYEsperarTile(ctx, VECINO, 1, 0);
  await ctx.nefan("setPlayerPos", 64, 0);
  await ctx.waitFor("el cliente activa el vecino", (t) => (window.__nefan.currentTile === t ? t : null), 30_000, VECINO);
  const exits2 = await salidasDelTile(ctx, "en el replay, el vecino trae salidas");
  ctx.expect("4 · en el replay el anillo sigue teniendo salidas", exits2.length > 0, JSON.stringify(exits2));

  // ── 5 · reanudar la primera partida ─────────────────────────────────────
  const c0 = await escenasPedidas();
  const vuelta = await reanudar(ctx, primera.sessionId);
  ctx.expect("5 · la partida de la entrada regenerada se REANUDA", Boolean(vuelta?.scene), JSON.stringify(vuelta));
  if (vuelta?.scene) {
    await pedirYEsperarTile(ctx, VECINO, 1, 0);
    await ctx.nefan("setPlayerPos", 64, 0);
    await ctx.waitFor("el cliente activa el vecino tras reanudar", (t) => (window.__nefan.currentTile === t ? t : null), 30_000, VECINO);
    const exits3 = await salidasDelTile(ctx, "tras reanudar, el vecino trae salidas");
    ctx.expect("5 · tras reanudar, el anillo sigue teniendo salidas", exits3.length > 0, JSON.stringify(exits3));
  }
  ctx.expect("5 · reanudar no cuesta ninguna llamada al motor", (await escenasPedidas()).n === c0.n, `${c0.n}→${(await escenasPedidas()).n}`);
}
