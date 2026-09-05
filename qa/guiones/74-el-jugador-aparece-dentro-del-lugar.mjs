/** EL JUGADOR APARECE DENTRO DEL LUGAR, Y EL LUGAR SE ANCLA POR EL CANAL REAL (#408).
 *
 *  Hasta #408 la escena podía traer sus propias anclas de lugar ({place_id,
 *  rect} por tile; el campo está RETIRADO y su nombre se lee de
 *  `retired-terrain-fields.ts`, no se escribe aquí) y el bridge afinaba con
 *  eso el anclaje del place. Ningún prompt ni tool se lo
 *  pedía al motor real: solo lo escribía el motor del banco, así que el banco
 *  probaba un camino que el juego no ejercía. El campo se retiró y el ÚNICO
 *  canal por el que un lugar se ancla al plano es la tool `map_upsert_place`
 *  con `anchor {tx, ty, rect}` → `POST /map/place` del State API. El motor del
 *  banco ancla ahora por ahí, igual que lo haría el real.
 *
 *  Lo que este guion protege, andando y leyendo el mapa del bridge (no la escena):
 *   1. la escena servida NO lleva ningún campo retirado de la raíz (lo
 *      retirado no vuelve por el wire);
 *   2. el lugar de partida está anclado al tile de arranque CON rect, y lo está
 *      en el world map del bridge (`GET /map`), o sea por `POST /map/place`;
 *   3. al viajar a un lugar sin realizar, el motor acota el lugar con un rect
 *      DURANTE la generación y el jugador aparece DENTRO de ese rect, no solo
 *      dentro del tile (el 08 solo afirma el tile: por él pasa en verde un
 *      spawn en el centro del tile con el anchor perdido);
 *   4. al pisar el rect, el bridge activa ese lugar (`active_place_id`);
 *   5. la vuelta deja al jugador dentro del rect del lugar de partida.
 *
 *  Probado en negativo (2026-09-05, QA-E de T13), dos veces:
 *   - quitando el `anchor` del upsert del lugar de PARTIDA en
 *     `labs/narrative/fake-ai-server.ts` → el criterio 2 sale rojo (`anchor null`);
 *   - corriéndolo DETRÁS de 08/09 en el mismo stack (o con `--adoptar` sobre un
 *     stack ya usado): el fake solo hace el upsert del lugar del tile dentro de
 *     `if (!tileByKey.has(key))`, así que la segunda sesión que genera ese tile
 *     recibe el anchor SIN rect y el spawn cae en el centro del tile (128, 0) →
 *     el criterio 3 sale rojo. Ese rojo era un defecto del banco, no del guion
 *     (el motor real ancla en cada generación, el fake solo en la primera), y
 *     se arregló en la misma PR: el fake ancla en cada `generate_tile`, sin
 *     `.catch`. No se declara `aisla: ["fake-ai"]` a propósito: taparía justo
 *     una regresión de eso.
 *
 *  Grupo: NAVEGADOR (corrida local con `qa/run.mjs`, preset `e2e-sin-creditos`).
 *  Cero créditos: el motor es el fake-ai-server.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { nuevaPartida, comenzar, regenerarMundo, esperarRegistro, esperarEnElMapa } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

const GAME_ID = "alta_fantasia";

/** La fuente única de los nombres retirados de la escena. Se lee como texto
 *  porque el runner es node a secas (sin tsx) y el fichero es TypeScript;
 *  mismo idioma que el guion 62. Se quiere la tabla ENTERA (`MOTIVOS`): raíz y
 *  entity juntas — sobra que alguna clave sea de entity, ninguna puede estar
 *  en la raíz de la escena servida. */
const FUENTE = fileURLToPath(
  new URL("../../nefan-core/src/contract/model-io/retired-terrain-fields.ts", import.meta.url),
);

function camposRetirados() {
  const src = readFileSync(FUENTE, "utf8");
  const m = src.match(/const MOTIVOS[^{]*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error(`no encuentro la tabla MOTIVOS en ${FUENTE}`);
  const claves = [...m[1].matchAll(/^\s{2}(\w+):/gm)].map((x) => x[1]);
  if (claves.length < 3) throw new Error(`MOTIVOS con ${claves.length} claves: ¿cambió la forma del fichero?`);
  return claves;
}

/** El world map tal cual lo sirve el bridge (la misma lectura que haría el motor por `map_get`). */
async function mapa() {
  const res = await fetch(`${URLS.state_api}/map`);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __raw: text };
  }
  return { status: res.status, body };
}

/** Lo que el jugador puede ver: tile, posición, rect del tile y salidas; y
 *  qué claves RETIRADAS trae la escena servida (ninguna, si el wire es honesto). */
const mirar = (retirados) => ({
  scene_id: window.__nefan.scene?.scene_id ?? null,
  rect: window.__nefan.scene?.world_rect ?? null,
  pos: window.__nefan.state().pos,
  retiradosEnLaEscena: window.__nefan.scene ? retirados.filter((k) => k in window.__nefan.scene) : [],
  exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
});

/** El rect del anchor (celdas del tile) en METROS, con la escala que el propio
 *  tile declara: el cliente no convierte celdas, así que aquí tampoco se
 *  inventa la escala — se deriva del `world_rect` servido. */
function rectDelAnclaEnMetros(anchor, worldRect) {
  const mpc = (worldRect.maxX - worldRect.minX) / 128;
  const [col, row, w, h] = anchor.rect;
  return {
    minX: worldRect.minX + col * mpc,
    maxX: worldRect.minX + (col + w) * mpc,
    minZ: worldRect.minZ + row * mpc,
    maxZ: worldRect.minZ + (row + h) * mpc,
  };
}

const dentro = (p, r) => p.x >= r.minX && p.x < r.maxX && p.z >= r.minZ && p.z < r.maxZ;

const anclaBuena = (a, sceneId) =>
  Boolean(a) && Array.isArray(a.rect) && a.rect.length === 4 && `tile_${a.tx}_${a.ty}` === sceneId;

async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) =>
    bs.map((b) => b.textContent ?? ""),
  );
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) throw new Error(`el panel no ofrece "${nombre}"; ofrece: ${JSON.stringify(botones)}`);
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
}

/** El viaje ha terminado cuando el jugador está en OTRO tile y DENTRO de su
 *  rect (el scene_init se adelanta al `ready` que trae el spawn). */
async function esperarLlegada(ctx, desc, sceneAnterior, retirados) {
  return ctx.waitFor(
    desc,
    ({ previo, retirados }) => {
      const s = window.__nefan.scene;
      if (!s || s.scene_id === previo) return null;
      const p = window.__nefan.state().pos;
      const r = s.world_rect;
      if (!r || p.x < r.minX || p.x >= r.maxX || p.z < r.minZ || p.z >= r.maxZ) return null;
      const v = window.__nefan.viaje;
      if (!v || !v.spawnAplicado) return null;
      return {
        scene_id: s.scene_id,
        rect: r,
        pos: p,
        retiradosEnLaEscena: retirados.filter((k) => k in s),
        exits: (s.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
      };
    },
    240_000,
    { previo: sceneAnterior, retirados },
  );
}

/** El bridge activa el lugar por POSICIÓN cuando el cliente reporta que el
 *  jugador está dentro del rect. Se espera por estado del State API (la
 *  espera vive en `qa/lib`), y si expira se lee el último valor para el rojo. */
async function esperarLugarActivo(placeId, maxMs = 20_000) {
  const activo = await esperarEnElMapa((m) => (m.active_place_id === placeId ? m.active_place_id : null), maxMs);
  if (activo) return activo;
  return (await mapa()).body?.active_place_id ?? null;
}

export default async function (ctx) {
  const retirados = camposRetirados();
  ctx.log(`claves retiradas que la escena no puede traer: ${retirados.join(", ")}`);
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);

  // ── 1 y 2. La escena no ancla; el mapa del bridge sí, con rect ──────────
  const partida = await ctx.page.evaluate(mirar, retirados);
  ctx.log(`partida: ${partida.scene_id} · pos ${JSON.stringify(partida.pos)} · salidas ${JSON.stringify(partida.exits)}`);
  ctx.expect(
    "la escena servida NO lleva ningún campo retirado (#408 retiró las anclas de lugar: lo que se retira no vuelve por el wire)",
    partida.retiradosEnLaEscena.length === 0,
    `retirados en la escena: ${JSON.stringify(partida.retiradosEnLaEscena)}`,
  );

  const m0 = await mapa();
  ctx.expect("el State API sirve el world map (`GET /map`)", m0.status === 200 && m0.body?.places, `HTTP ${m0.status}`);
  if (m0.status !== 200) return;
  const activoInicial = m0.body.active_place_id;
  const anclaPartida = m0.body.places[activoInicial]?.anchor ?? null;
  ctx.log(`lugar activo al arrancar: ${activoInicial} · anchor ${JSON.stringify(anclaPartida)}`);
  ctx.expect(
    `el lugar de partida (${activoInicial}) está anclado al tile de arranque CON rect, y lo está en el world map: llegó por map_upsert_place.anchor, no por la escena`,
    anclaBuena(anclaPartida, partida.scene_id),
    JSON.stringify(anclaPartida),
  );

  ctx.expect("el panel «Salidas» ofrece un destino", partida.exits.length > 0, JSON.stringify(partida.exits));
  if (!partida.exits.length) return;
  const destino = partida.exits[0];
  await ctx.shot("antes-de-viajar");

  // ── 3. Ida: el motor acota el lugar con rect mientras genera ────────────
  await pulsarSalida(ctx, destino.name);
  await esperarRegistro(
    ctx,
    "el bridge acusa el viaje (destino sin realizar: entra en la cola)",
    "viaje",
    () => (window.__nefan.viaje?.encolado ? window.__nefan.viaje : null),
    60_000,
  ).catch(() => null);
  const llegada = await esperarLlegada(ctx, "el jugador llega al destino y el spawn se aplica", partida.scene_id, retirados).catch(
    (err) => {
      ctx.expect(`clicar «${destino.name}» lleva al jugador al destino`, false, err.message);
      return null;
    },
  );
  if (!llegada) {
    await ctx.shot("ida-fallida");
    return;
  }
  ctx.log(`llegada: ${llegada.scene_id} · pos ${JSON.stringify(llegada.pos)}`);
  ctx.expect(
    "la escena del destino tampoco lleva ningún campo retirado",
    llegada.retiradosEnLaEscena.length === 0,
    `retirados en la escena: ${JSON.stringify(llegada.retiradosEnLaEscena)}`,
  );

  const m1 = await mapa();
  const anclaDestino = m1.body?.places?.[destino.place_id]?.anchor ?? null;
  ctx.log(`anchor del destino ${destino.place_id}: ${JSON.stringify(anclaDestino)}`);
  ctx.expect(
    `el motor acotó ${destino.place_id} con un rect en el tile que le tocó (map_upsert_place.anchor durante la generación)`,
    anclaBuena(anclaDestino, llegada.scene_id),
    JSON.stringify(anclaDestino),
  );
  if (anclaBuena(anclaDestino, llegada.scene_id)) {
    const rectLugar = rectDelAnclaEnMetros(anclaDestino, llegada.rect);
    ctx.log(`rect del lugar en metros: ${JSON.stringify(rectLugar)}`);
    ctx.expect(
      "el jugador aparece DENTRO del lugar (el rect del anchor), no solo dentro del tile",
      dentro(llegada.pos, rectLugar),
      `pos ${JSON.stringify(llegada.pos)} · rect del lugar ${JSON.stringify(rectLugar)} · tile ${JSON.stringify(llegada.rect)}`,
    );
  }
  await ctx.shot("dentro-del-lugar");

  // ── 4. Al pisar el rect, el bridge activa el lugar ──────────────────────
  const activo = await esperarLugarActivo(destino.place_id);
  ctx.expect(
    `el bridge activa el lugar al aparecer dentro de su rect (active_place_id = ${destino.place_id})`,
    activo === destino.place_id,
    `active_place_id = ${activo}`,
  );

  // ── 5. Vuelta: dentro del rect del lugar de partida ─────────────────────
  const vuelta = llegada.exits.find((e) => e.place_id !== destino.place_id) ?? null;
  ctx.expect("el panel ofrece la vuelta", Boolean(vuelta), JSON.stringify(llegada.exits));
  if (!vuelta) return;
  await pulsarSalida(ctx, vuelta.name);
  const regreso = await esperarLlegada(ctx, "el jugador vuelve al tile de partida y el spawn se aplica", llegada.scene_id, retirados).catch(
    (err) => {
      ctx.expect(`clicar «${vuelta.name}» devuelve al jugador`, false, err.message);
      return null;
    },
  );
  if (!regreso) {
    await ctx.shot("vuelta-fallida");
    return;
  }
  ctx.log(`regreso: ${regreso.scene_id} · pos ${JSON.stringify(regreso.pos)}`);
  ctx.expect("la vuelta acaba en el tile de partida", regreso.scene_id === partida.scene_id, regreso.scene_id);
  if (anclaBuena(anclaPartida, regreso.scene_id)) {
    const rectPartida = rectDelAnclaEnMetros(anclaPartida, regreso.rect);
    ctx.expect(
      `de vuelta, el jugador aparece DENTRO del rect de ${vuelta.place_id} (el anchor que el motor fijó al sembrar el mapa)`,
      dentro(regreso.pos, rectPartida),
      `pos ${JSON.stringify(regreso.pos)} · rect del lugar ${JSON.stringify(rectPartida)}`,
    );
  }
  await ctx.shot("de-vuelta-dentro-del-lugar");
}
