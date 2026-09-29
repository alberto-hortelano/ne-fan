/** #465 (tanda BM, fase 2) · La entrada regenerada CONOCE los sitios que ya
 *  viven en ella, y entre huellas anidadas se activa la más pequeña.
 *
 *  El playtest con el motor real (H1 de su QA) lo vio así: una entrada rota se
 *  regenera dentro de su mapa (#578), el motor la rehace con otra distribución
 *  y los sitios anclados en (0,0) —la posada, la lamparería— se quedan con
 *  rects sobre una geometría que ya no existe. El motor no pudo saberlo:
 *  `generate_tile` solo le pasaba el lugar de partida, y los demás anclados en
 *  ese tile se saltaban con un `continue`. Con el motor falso no se ve el
 *  efecto (repite la misma entrada), pero sí la CAUSA: lo que le llega.
 *
 *  Montaje (patrón del 214, 0 créditos): se pre-genera el mundo, se rompe la
 *  entrada y en el FICHERO se mete `posada_del_fichero`, un `site` anclado en
 *  (0,0) con una huella DENTRO de la de `taberna_bench_place` y puesto el
 *  PRIMERO en `world_map.places`.
 *
 *   A · H1 · la petición de la entrada regenerada (`ultimaPeticionDeEscena`
 *       de `/dev/counters`) lleva el lugar de partida CON su rect, y en
 *       `anchored_places` la posada con su rect y su descripción.
 *   B · H3 · por la posición: en una celda de la posada el lugar activo
 *       (`active_place_id` del State API) es la POSADA, aunque la taberna la
 *       contenga y vaya después; en una celda de la taberna fuera de la
 *       posada, la TABERNA. Antes ganaba el último rect del bucle.
 *
 *  PROBADO EN NEGATIVO (tanda BM, fase 2; la salida en su
 *  `implementacion.md`): con `bridge/handlers/tile.ts` de main y el motor
 *  falso nuevo, A sale rojo (`anclados: []`, el lugar sin rect) y B también
 *  (en la celda de la posada, `taberna_bench_place`).
 *
 *  Lo que NO mide: que el motor construya cada sitio dentro de su huella ni
 *  que no los re-ancle. Eso es conducta de un modelo real y se mide en el
 *  playtest corto tras el merge. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import { celdaAMundo, comenzar, esperarEnElMapa, nuevaPartida, recargarAlTitulo, regenerarMundo } from "../lib/sesion.mjs";

export const aisla = ["mundo", "fake-ai", "saves"];

const GAME = "alta_fantasia";
const TABERNA = "taberna_bench_place";
const POSADA = "posada_del_fichero";
const DESCRIPCION_POSADA = "La posada de la taberna, con su farol encendido.";
/** Dentro de la huella de la taberna del motor falso ([52,48,24,16]). */
const RECT_POSADA = [56, 50, 8, 6];

async function motor() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return { escenas: c?.gasto?.rutas?.["/generate_scene"] ?? 0, ultima: c?.ultimaPeticionDeEscena ?? null };
}

/** La misma rotura que el 214: el NPC de la entrada pasa a nacer dentro de un
 *  sólido, y la entrada deja de pasar el validador. */
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

/** Pisa una celda del tile (0,0) y espera a que el bridge active `placeId`;
 *  si expira, devuelve el que haya activo para que el rojo lo diga. */
async function pisarYLeer(ctx, col, row, placeId) {
  const escena = await ctx.page.evaluate(() => ({ terrain_grid: window.__nefan.scene.terrain_grid }));
  const [x, z] = celdaAMundo(escena, col, row);
  await ctx.page.evaluate((p) => window.__nefan.setPlayerPos(p.x, p.z), { x, z });
  const activo = await esperarEnElMapa((m) => (m.active_place_id === placeId ? m.active_place_id : null), 15_000);
  if (activo) return activo;
  const r = await fetch(`${URLS.state_api}/map`);
  return r.ok ? ((await r.json())?.active_place_id ?? null) : `HTTP ${r.status}`;
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay tile.json que editar");
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const leer = () => JSON.parse(readFileSync(tileJson, "utf8"));
  const escribir = (s) => writeFileSync(tileJson, JSON.stringify(s, null, 2) + "\n", "utf8");

  await regenerarMundo(ctx, GAME);
  if (!existsSync(tileJson)) ctx.sinMedir(`«Generar mundo» no dejó ${tileJson}`);
  const fichero = leer();
  const taberna = fichero.world_map?.places?.[TABERNA];
  const rectTaberna = taberna?.anchor?.rect;
  ctx.expect(
    `el mapa pre-generado ancla «${TABERNA}» en (0,0) con rect`,
    taberna?.anchor?.tx === 0 && taberna?.anchor?.ty === 0 && Array.isArray(rectTaberna),
    JSON.stringify(taberna?.anchor),
  );
  const [tc, tr, tw, th] = rectTaberna;
  const [pc, pr, pw, ph] = RECT_POSADA;
  ctx.expect(
    "la huella de la posada cae DENTRO de la de la taberna (premisa del anidamiento)",
    pc >= tc && pr >= tr && pc + pw <= tc + tw && pr + ph <= tr + th,
    `taberna ${JSON.stringify(rectTaberna)} · posada ${JSON.stringify(RECT_POSADA)}`,
  );

  // La posada, PRIMERA en el orden de inserción: con el bucle de antes la
  // taberna, que va después y también la contiene, se la comía.
  const posada = {
    ...taberna,
    id: POSADA,
    kind: "site",
    parent_id: TABERNA,
    name: "La Posada del Fichero",
    description: DESCRIPCION_POSADA,
    anchor: { tx: 0, ty: 0, rect: RECT_POSADA },
    triggers: [],
    visited: false,
  };
  delete posada.realized_scene_id;
  delete posada.introduced_event_id;
  fichero.world_map.places = { [POSADA]: posada, ...fichero.world_map.places };
  const npc = romperLaEntrada(fichero);
  if (!npc) ctx.sinMedir("la entrada no se puede romper: sin NPC o sin volumen sólido");
  escribir(fichero);
  ctx.log(`entrada rota (${npc} dentro de un sólido); «${POSADA}» anclada en ${JSON.stringify(RECT_POSADA)}, la primera del mapa`);

  // ── A · H1: lo que le llega al motor ─────────────────────────────────────
  const antes = await motor();
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "vector", charMode: "vector" });
  await comenzar(ctx);
  const tras = await motor();
  ctx.log(`A · última petición al motor: ${JSON.stringify(tras.ultima)}`);
  ctx.expect(
    "A · la entrada rota cuesta UNA petición, y es la de la entrada sin sembrar",
    tras.escenas === antes.escenas + 1 && tras.ultima?.bootstrap === true && tras.ultima?.bootstrap_world_map === false,
    `/generate_scene ${antes.escenas} → ${tras.escenas} · ${JSON.stringify(tras.ultima)}`,
  );
  ctx.expect(
    "A · el lugar de partida viaja CON su huella",
    tras.ultima?.lugar?.id === TABERNA && JSON.stringify(tras.ultima?.lugar?.rect) === JSON.stringify(rectTaberna),
    JSON.stringify(tras.ultima?.lugar),
  );
  const anclada = (tras.ultima?.anclados ?? []).find((p) => p.id === POSADA);
  ctx.expect(
    "A · la posada anclada en la entrada llega en anchored_places, con su rect y su descripción",
    JSON.stringify(anclada?.rect) === JSON.stringify(RECT_POSADA) && anclada?.description === DESCRIPCION_POSADA,
    JSON.stringify(tras.ultima?.anclados),
  );
  ctx.expect(
    "A · …y el lugar de partida no se repite entre los anclados",
    !(tras.ultima?.anclados ?? []).some((p) => p.id === TABERNA),
    JSON.stringify(tras.ultima?.anclados),
  );

  // ── B · H3: la huella más pequeña gana ──────────────────────────────────
  const enLaPosada = await pisarYLeer(ctx, pc + 1, pr + 1, POSADA);
  ctx.expect(
    `B · en una celda de la posada (dentro también de la taberna) el lugar activo es «${POSADA}»`,
    enLaPosada === POSADA,
    `active_place_id = ${enLaPosada}`,
  );
  // Una celda de la taberna fuera de la posada: su esquina opuesta.
  const enLaTaberna = await pisarYLeer(ctx, tc + tw - 2, tr + th - 2, TABERNA);
  ctx.expect(
    `B · en una celda de la taberna fuera de la posada, «${TABERNA}»`,
    enLaTaberna === TABERNA,
    `active_place_id = ${enLaTaberna}`,
  );
  await ctx.shot("b-la-huella-mas-pequena");
}
