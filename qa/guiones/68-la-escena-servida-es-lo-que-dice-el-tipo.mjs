/** LA ESCENA SERVIDA ES LO QUE DICE EL TIPO (QA de T7 PR-B: #378).
 *
 *  #378 cerró `WorldScene` (antes `Record<string, unknown>`) y puso el wire en
 *  el tipo: `EscenaServida = WorldScene & { exits }` la devuelve solo `alWire`,
 *  y `__format_d` —el Format D crudo ENTERO, el 44 % de los bytes de un tile—
 *  dejó de viajar dentro de la escena; lo que el cliente leía de él
 *  (`place_id`) es un miembro. Los tests de core lo afirman sobre un contexto
 *  de prueba; este guion lo mide donde lo ve el jugador: la escena que el
 *  bridge REAL sirve al cliente por sus dos puertas (el broadcast del arranque
 *  y el `session_started` del resume), con el motor falso y cero créditos.
 *
 *  Lo que se afirma, en cada una de las dos puertas:
 *   1 · ni `__format_d`, ni `size`, ni `entities`, ni `__expanded`: el crudo
 *       no viaja dentro, ni entero ni por trozos;
 *   2 · `exits` es una lista: las salidas van encima, calculadas al servir;
 *   3 · TODAS las claves de la raíz, de cada objeto y de cada npc están en la
 *       lista de miembros del tipo: lo que viaja es lo que el tipo declara, y
 *       nada más — en el wire no hay `tsc`, así que se mira la clave a clave;
 *   4 · el grid de terreno viaja UNA vez (con `__format_d` iba dos: en
 *       `terrain` del crudo y en `terrain_grid`);
 *   5 · `name` de cada objeto y npc es texto no vacío: lo promete el tipo y el
 *       cliente lo rotula sin volver a mirar.
 *  Y aparte:
 *   6 · normalizar DOS veces desde JS (`__nefan.addTileRaw(__nefan.scene)`)
 *       se DICE: `formatDToWorld` lanza nombrando lo que no es Format D, en
 *       vez de devolver media conversión (la guarda `__format_d` que hacía
 *       idempotente la llamada murió con él).
 *
 *  EN NEGATIVO (probado el 2026-09-03 al escribirlo): volver a emitir
 *  `__format_d: raw` en `formatDToWorld` pone rojos el paso 1, el 3 (clave
 *  fuera de la lista) y el 4 (el grid dos veces) en las dos puertas.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D.
 */
import { comenzar, nuevaPartida, reanudar } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** Los miembros de `WorldScene` (scene-normalize.ts) más `exits`
 *  (`EscenaServida`, protocol/messages.ts). Si el tipo gana un miembro, esta
 *  lista gana una línea: es a propósito, para que el wire no crezca callado. */
const MIEMBROS_ESCENA = [
  "scene_id", "scene_description", "dimensions", "world_rect", "tile", "terrain", "terrain_grid",
  "ground", "volumes", "vegetation_zones", "scatter_generators", "scatter_zones", "biome", "place_id",
  "objects", "npcs", "__player_start", "__plan", "__plan_warnings",
  "exits",
];
const MIEMBROS_OBJETO = ["id", "position", "scale", "category", "name", "description", "volume_id", "shape"];
const MIEMBROS_NPC = ["id", "name", "position", "combat", "role", "style_ref", "description", "position_declared"];
/** Lo que es del Format D crudo y no debe asomar en la escena servida. */
const RASTROS_DEL_CRUDO = ["__format_d", "size", "entities", "__expanded"];

/** Radiografía de la escena activa, hecha EN la página y sin píxeles. */
const radiografia = (ctx) =>
  ctx.page.evaluate(
    ({ MIEMBROS_ESCENA, MIEMBROS_OBJETO, MIEMBROS_NPC, RASTROS_DEL_CRUDO }) => {
      const s = window.__nefan.scene;
      const fuera = (obj, lista) => Object.keys(obj).filter((k) => !lista.includes(k));
      const json = JSON.stringify(s);
      const grid = JSON.stringify(s.terrain_grid?.grid ?? null);
      const vecesGrid = grid === "null" ? 0 : json.split(grid).length - 1;
      return {
        scene_id: s.scene_id,
        bytes: json.length,
        rastros: RASTROS_DEL_CRUDO.filter((k) => k in s),
        exitsEsLista: Array.isArray(s.exits),
        clavesFuera: fuera(s, MIEMBROS_ESCENA),
        objetosFuera: s.objects.flatMap((o) => fuera(o, MIEMBROS_OBJETO).map((k) => `${o.id}.${k}`)),
        npcsFuera: s.npcs.flatMap((n) => fuera(n, MIEMBROS_NPC).map((k) => `${n.id}.${k}`)),
        sinNombre: [...s.objects, ...s.npcs].filter((e) => typeof e.name !== "string" || e.name === "").map((e) => e.id),
        vecesGrid,
        objetos: s.objects.length,
        npcs: s.npcs.length,
        place_id: s.place_id ?? null,
      };
    },
    { MIEMBROS_ESCENA, MIEMBROS_OBJETO, MIEMBROS_NPC, RASTROS_DEL_CRUDO },
  );

function afirmar(ctx, puerta, r) {
  ctx.log(
    `${puerta}: ${r.scene_id} · ${r.bytes} bytes · ${r.objetos} objetos · ${r.npcs} npcs · place_id ${r.place_id} · grid ×${r.vecesGrid}`,
  );
  ctx.expect(`${puerta} · el crudo no viaja dentro (ni __format_d, ni size, ni entities)`, r.rastros.length === 0, JSON.stringify(r.rastros));
  ctx.expect(`${puerta} · las salidas van encima, como lista`, r.exitsEsLista, String(r.exitsEsLista));
  ctx.expect(`${puerta} · la raíz solo lleva miembros del tipo`, r.clavesFuera.length === 0, JSON.stringify(r.clavesFuera));
  ctx.expect(`${puerta} · cada objeto solo lleva miembros del tipo`, r.objetosFuera.length === 0, JSON.stringify(r.objetosFuera.slice(0, 8)));
  ctx.expect(`${puerta} · cada npc solo lleva miembros del tipo`, r.npcsFuera.length === 0, JSON.stringify(r.npcsFuera.slice(0, 8)));
  ctx.expect(`${puerta} · el grid de terreno viaja UNA vez`, r.vecesGrid === 1, `×${r.vecesGrid}`);
  ctx.expect(`${puerta} · todo objeto y npc trae su name (lo promete el tipo)`, r.sinNombre.length === 0, JSON.stringify(r.sinNombre));
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await ctx.page.click('#ts-rendermode [data-rendermode="vector"]');
  const partida = await comenzar(ctx);

  // ── Puerta 1: el broadcast del arranque (`scene_loaded`) ─────────────────
  afirmar(ctx, "arranque", await radiografia(ctx));
  await ctx.shot("escena-servida-al-arrancar");

  // ── 6: normalizar dos veces desde JS se dice, no se traga ────────────────
  const segundaPasada = await ctx.page.evaluate(async () => {
    try {
      await window.__nefan.addTileRaw(window.__nefan.scene);
      return { lanzo: false, mensaje: "" };
    } catch (e) {
      return { lanzo: true, mensaje: String(e?.message ?? e) };
    }
  });
  ctx.log(`addTileRaw(escena servida): ${segundaPasada.mensaje.slice(0, 160)}`);
  ctx.expect(
    "normalizar una escena YA servida lanza y nombra lo que falta (no devuelve media conversión)",
    segundaPasada.lanzo && /no es Format D expandido/.test(segundaPasada.mensaje) && /claves:/.test(segundaPasada.mensaje),
    segundaPasada.mensaje.slice(0, 200),
  );
  const sigue = await ctx.page.evaluate(() => ({ scene: window.__nefan.status().scene, id: window.__nefan.scene?.scene_id }));
  ctx.expect("…y la escena que había sigue puesta", sigue.scene && sigue.id === (await radiografia(ctx)).scene_id, JSON.stringify(sigue));

  // ── Puerta 2: el `session_started` del resume (`sessionDataForClient`) ──
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  afirmar(ctx, "resume", await radiografia(ctx));
  await ctx.shot("escena-servida-tras-reanudar");
}
