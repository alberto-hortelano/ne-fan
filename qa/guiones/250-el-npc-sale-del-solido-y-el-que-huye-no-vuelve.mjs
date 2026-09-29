/** ¿SALE EL NPC DE DONDE HA CAÍDO, Y SE QUEDA LEJOS EL QUE HUYE? (#618, #298 — QA de la tanda BL)
 *
 *  POR QUÉ EXISTE. La tanda BL cambió tres conductas del NPC en
 *  `npc-behavior.ts` (que está en `sin_mutar`: la mutación no mide nada de
 *  él) y en `npc-director.ts`. Sus candados son unitarios con un NPC cada vez
 *  y dos guiones de la familia (`qa/el-mundo-solido-…`, `qa/el-viaje-…`).
 *  Esto es la pasada ADVERSARIAL de la QA, dejada ejecutable: los estados que
 *  esos candados no visitan.
 *
 *    1. VARIOS A LA VEZ en los siete edificios de robledo: 28 NPC metidos en la
 *       geometría del TILE (no una caja de runtime), cuatro modos por edificio
 *       —sin directiva, `hold`, `wander` con radio, otro sin directiva—. Salen
 *       todos, ninguno vuelve a entrar, ninguno atraviesa, el `hold` se queda
 *       quieto fuera.
 *    2. RESUME: un save con tres NPC dentro de edificios se carga en una
 *       NarrativeState nueva (lo que hace `loadSession` al reanudar): salen, y
 *       el siguiente resume ya los tiene fuera.
 *    3. UN SÓLIDO QUE APARECE EN RUNTIME sobre un GRUPO: quieto, `hold`,
 *       `react` (jugador al lado) y el que ya llegó a su plaza.
 *    4. `npc_arrive` con el NPC YA DENTRO del rect del lugar pero dentro de un
 *       carro: no salta (desde H4-BM el umbral es «dentro del rect», no «a ≤
 *       3 m del centro») y la salida del sim lo saca.
 *    5. LA HUIDA (#298) con pelea que SIGUE, por el cableado real y con las
 *       directivas que el motor escribe: sin directiva (tres roles), `hold`,
 *       `patrol` (cuatro semillas × 300 s). Huye UNA vez y tras reanudar no
 *       vuelve a entrar en su percepción.
 *
 *  LOS TRES AGUJEROS QUE ENCONTRÓ LA QA DE BL, hoy ASERTOS (cerrados en la
 *  misma tanda, tras la primera pasada de QA):
 *
 *    A1. El que tiene `goto_place` hacia un sitio junto a la pelea volvía a
 *        ella: 15 huidas en 180 s (antes de BL: 24). Decisión del usuario:
 *        «que el estado le llegue al motor de narrativa y él decide». Hoy
 *        huye UNA vez, suspende la directiva (`data.directive = null`) y la
 *        deja en `data.suspended_goal` con el porqué.
 *    A2. Con `wander.radius` 15 la huida se cortaba a los 4 s de salir de la
 *        percepción (24 m) sin llegar a `distanciaDeHuida` (31 m), y re-huía
 *        en 4 de 8 semillas × 600 s. Hoy la huida no se cierra hasta llegar
 *        a su meta: 0 de 8.
 *    A3. `npc_arrive` a un lugar de un tile SIN REALIZAR envenenaba la caché
 *        de colisión: `createSimCollisionProvider` guardaba «sin escena» como
 *        colliders vacíos PARA SIEMPRE, y al realizarse el tile el sim lo veía
 *        vacío. Hoy la caché va por registro de escena y no cachea la ausencia.
 *
 *  PROBADO EN NEGATIVO contra el árbol de ANTES de BL (`d0cc2231`, `dist`
 *  compilado en un worktree aparte y pasado con `QA_250_CORE=<ruta>/nefan-core`):
 *  12 rojos — 1 (los siete `hold` siguen dentro), 2 (el `hold` no sale, y el
 *  siguiente resume lo trae dentro), 3 (ninguno de los cuatro sale), 5 (19-20
 *  huidas en 180 s sin directiva, 29-32 en 300 s con `patrol`) y A3. El 4
 *  sale verde también ahí, porque ya salía el que andaba: lo que mide es que
 *  el umbral de 3 m no deja a nadie dentro, no la tanda. A3 sale «cerrado»
 *  contra la base, que es justo lo que dice: la puerta la abre BL. A1 y A2
 *  siguen abiertos también ahí (24 huidas; 8 de 8 semillas).
 *
 *  Sin navegador, sin stack, sin créditos: lee `nefan-core/dist` (compila
 *  antes: `cd nefan-core && npm run build`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "mueve NPCs con el sim de nefan-core/dist y el proveedor de colisión de producción; no abre partida ni habla con el motor";
export const sinNavegador = "conduce el NpcBehaviorSystem y el NpcDirector de dist con el cableado del bridge; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = process.env.QA_250_CORE ?? join(RAIZ, "nefan-core");
const DIST = join(CORE, "dist");
const T = 1 / 60;
const R_NPC = 0.5;
const LEJOS = { playerPos: { x: 999, y: 0, z: 999 }, combatEvents: [], combatantPositions: new Map() };
const PELEA = { playerPos: { x: 999, y: 0, z: 999 }, combatEvents: [{ type: "attack_started", combatantId: "bandit" }], combatantPositions: new Map([["bandit", { x: 0, y: 0, z: 0 }]]) };

async function cargar() {
  return {
    NarrativeState: (await import(`${DIST}/src/narrative/narrative-state.js`)).NarrativeState,
    MemorySessionStorage: (await import(`${DIST}/src/narrative/session-storage.js`)).MemorySessionStorage,
    expandScenePrimitives: (await import(`${DIST}/src/scene/scene-expand.js`)).expandScenePrimitives,
    createSimCollisionProvider: (await import(`${DIST}/bridge/sim-collision.js`)).createSimCollisionProvider,
    createSessionNpcBehavior: (await import(`${DIST}/bridge/context.js`)).createSessionNpcBehavior,
    NpcDirector: (await import(`${DIST}/src/world-map/npc-director.js`)).NpcDirector,
    NPC_ROLE_PRESETS: (await import(`${DIST}/src/simulation/npc-roles.js`)).NPC_ROLE_PRESETS,
  };
}

const campo = (sid = "tile_0_0", tx = 0, ty = 0, entities = []) =>
  ({ tile: { tx, ty }, scene_id: sid, scene_description: "campo abierto", biome: "grass", entities });
const centroDe = (b) => ({ x: -32 + (b.cell[0] + b.footprint[0] / 2) * 0.5, z: -32 + (b.cell[1] + b.footprint[1] / 2) * 0.5 });

/** Corre el sim y devuelve, por NPC: cuándo salió, si volvió a entrar, cuánto
 *  se alejó de donde salió y si terminó dentro. */
function correr(s, prov, sys, ids, segundos, ctx = LEJOS) {
  const r = Object.fromEntries(ids.map((id) => [id, { salio: null, exit: null, reentra: false, lejos: 0, finDentro: false }]));
  for (let k = 0; k < segundos / T; k++) {
    sys.tick(T, ctx);
    for (const id of ids) {
      const p = s.getEntity(id).position;
      const dentro = prov.ocupado(p[0], p[2], R_NPC);
      const n = r[id];
      if (n.salio === null && !dentro) { n.salio = k * T; n.exit = { x: p[0], z: p[2] }; }
      if (n.salio !== null) {
        if (dentro) n.reentra = true;
        n.lejos = Math.max(n.lejos, Math.hypot(p[0] - n.exit.x, p[2] - n.exit.z));
      }
    }
  }
  for (const id of ids) { const p = s.getEntity(id).position; r[id].finDentro = prov.ocupado(p[0], p[2], R_NPC); }
  return r;
}

/** Una huida con pelea que sigue en (0,0): cuántas veces huye y cuántos ticks
 *  pasa dentro de su percepción después de la primera reanudación. */
function huida(m, { role = "villager", data = {}, places = [], segundos = 180, seed = "qa250" }) {
  const s = new m.NarrativeState(new m.MemorySessionStorage());
  s.startNewSession(seed);
  s.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(campo()));
  for (const p of places) s.worldMap.upsertPlace(p);
  const prov = m.createSimCollisionProvider(s);
  const sys = m.createSessionNpcBehavior({ narrative: s, simCollision: prov }, undefined);
  s.recordEntitySpawned("v", "npc", "tile_0_0", [3, 0, 0], { name: "v", role, ...data });
  sys.addNpc(s.getEntity("v"));
  const perc = m.NPC_ROLE_PRESETS[role].perception_radius;
  let huidas = 0, reanudo = false, enPercepcion = 0;
  for (let k = 0; k < segundos / T; k++) {
    const ev = sys.tick(T, PELEA);
    huidas += ev.filter((e) => e.type === "npc_fled_combat").length;
    if (ev.some((e) => e.type === "npc_resumed")) reanudo = true;
    const p = s.getEntity("v").position;
    if (reanudo && Math.hypot(p[0], p[2]) < perc) enPercepcion++;
  }
  return { huidas, reanudo, enPercepcion, data: s.getEntity("v").data };
}

export default async function (ctx) {
  const m = await cargar();
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.join(" "));
  const robledo = JSON.parse(readFileSync(join(RAIZ, "nefan-core/data/scenes/robledo_tile.json"), "utf8"));
  const edificios = robledo.entities.filter((e) => e.kind === "building");

  // ── 1 · Varios a la vez, dentro de la geometría del tile ────────────────
  const s1 = new m.NarrativeState(new m.MemorySessionStorage());
  s1.startNewSession("qa250-1");
  s1.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(robledo));
  const prov1 = m.createSimCollisionProvider(s1);
  const sys1 = m.createSessionNpcBehavior({ narrative: s1, simCollision: prov1 }, undefined);
  const MODOS = [
    ["libre", "peasant", null], ["hold", "villager", { type: "hold" }],
    ["wander", "merchant", { type: "wander", radius: 3 }], ["libre2", "villager", null],
  ];
  const ids1 = [];
  let dentroAlEmpezar = 0;
  for (const b of edificios) {
    const c = centroDe(b);
    MODOS.forEach(([modo, role, directive], i) => {
      const id = `${b.id}__${modo}`;
      const x = c.x + (i - 1.5) * 0.4, z = c.z + (i % 2 ? 0.3 : -0.3);
      s1.recordEntitySpawned(id, "npc", "tile_0_0", [x, 0, z], { name: id, role, ...(directive ? { directive } : {}) });
      sys1.addNpc(s1.getEntity(id));
      if (prov1.ocupado(x, z, R_NPC)) dentroAlEmpezar++;
      ids1.push(id);
    });
  }
  ctx.expect("1 · CONTROL: los 28 NPC empiezan DENTRO de los siete edificios", dentroAlEmpezar === ids1.length, `${dentroAlEmpezar} de ${ids1.length}`);
  avisos.length = 0;
  const r1 = correr(s1, prov1, sys1, ids1, 90);
  const noSalen = ids1.filter((id) => r1[id].salio === null || r1[id].finDentro);
  ctx.expect("1 · salen TODOS, sea cual sea su modo, en menos de 10 s", noSalen.length === 0 && ids1.every((id) => r1[id].salio < 10),
    noSalen.length ? `siguen dentro: ${noSalen.join(", ")}` : `el más lento ${Math.max(...ids1.map((id) => r1[id].salio)).toFixed(1)} s`);
  const reentran = ids1.filter((id) => r1[id].reentra);
  ctx.expect("1 · ninguno vuelve a meterse", reentran.length === 0, reentran.join(", ") || "0");
  const atraviesa = avisos.filter((a) => /ATRAVIES/.test(a)).length;
  ctx.expect("1 · ninguno atraviesa (salir no es el escape)", atraviesa === 0, `${atraviesa} aviso(s) ATRAVIESA`);
  const holds = ids1.filter((id) => id.endsWith("__hold"));
  ctx.expect("1 · el `hold` fuera se queda QUIETO", holds.every((id) => r1[id].lejos < 0.05),
    holds.map((id) => r1[id].lejos.toFixed(2)).join(" · "));
  const libres = ids1.filter((id) => id.includes("__libre"));
  ctx.expect("1 · y el que no tiene directiva PASEA fuera (> 1 m de donde salió)", libres.every((id) => r1[id].lejos > 1),
    libres.map((id) => r1[id].lejos.toFixed(1)).join(" · "));

  // ── 2 · Resume con NPC dentro ───────────────────────────────────────────
  const disco = new m.MemorySessionStorage();
  const s2 = new m.NarrativeState(disco);
  s2.startNewSession("qa250-2");
  await s2.establecer();
  s2.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(robledo));
  const ids2 = ["r_libre", "r_hold", "r_wander"];
  const dirs2 = [null, { type: "hold" }, { type: "wander", radius: 4 }];
  ids2.forEach((id, i) => {
    const c = centroDe(edificios[i]);
    s2.recordEntitySpawned(id, "npc", "tile_0_0", [c.x, 0, c.z], { name: id, role: "villager", ...(dirs2[i] ? { directive: dirs2[i] } : {}) });
  });
  await s2.save();
  const s2b = new m.NarrativeState(disco);
  const cargo = await s2b.loadSession(s2.session_id);
  const prov2 = m.createSimCollisionProvider(s2b);
  const sys2 = m.createSessionNpcBehavior({ narrative: s2b, simCollision: prov2 }, undefined);
  for (const id of ids2) sys2.addNpc(s2b.getEntity(id));
  const dentro2 = ids2.filter((id) => { const p = s2b.getEntity(id).position; return prov2.ocupado(p[0], p[2], R_NPC); });
  ctx.expect("2 · CONTROL: el resume trae a los tres DENTRO", cargo && dentro2.length === 3, `${dentro2.length} de 3`);
  const r2 = correr(s2b, prov2, sys2, ids2, 30);
  ctx.expect("2 · tras reanudar, salen los tres", ids2.every((id) => r2[id].salio !== null && !r2[id].finDentro),
    ids2.map((id) => `${id} ${r2[id].salio?.toFixed(1) ?? "NUNCA"} s`).join(" · "));
  await s2b.save();
  const s2c = new m.NarrativeState(disco);
  await s2c.loadSession(s2.session_id);
  const fuera2 = ids2.filter((id) => { const p = s2c.getEntity(id).position; return !prov2.ocupado(p[0], p[2], R_NPC); });
  ctx.expect("2 · y el siguiente resume ya los tiene FUERA", fuera2.length === 3, `${fuera2.length} de 3`);

  // ── 3 · Un sólido de runtime cae sobre un grupo ─────────────────────────
  const s3 = new m.NarrativeState(new m.MemorySessionStorage());
  s3.startNewSession("qa250-3");
  s3.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(campo()));
  s3.worldMap.upsertPlace({ id: "plaza", kind: "landmark", parent_id: null, name: "la plaza", anchor: { tx: 0, ty: 0, rect: [(1 + 32) / 0.5, (-1 + 32) / 0.5, 0, 0] } });
  const prov3 = m.createSimCollisionProvider(s3);
  const sys3 = m.createSessionNpcBehavior({ narrative: s3, simCollision: prov3 }, undefined);
  const grupo = [
    ["g_quieto", [0.5, 0, 0.5], { role: "peasant" }],
    ["g_hold", [-1, 0, 1], { role: "villager", directive: { type: "hold" } }],
    ["g_react", [1.5, 0, 1.5], { role: "villager" }],
    ["g_llegado", [1, 0, -1], { role: "villager", directive: { type: "goto_place", target_place_id: "plaza" } }],
  ];
  for (const [id, pos, data] of grupo) { s3.recordEntitySpawned(id, "npc", "tile_0_0", pos, { name: id, ...data }); sys3.addNpc(s3.getEntity(id)); }
  const junto = { ...LEJOS, playerPos: { x: 2.5, y: 0, z: 2.5 } };
  correr(s3, prov3, sys3, [], 5, junto);
  s3.recordEntitySpawned("granero", "object", "tile_0_0", { x: 0.5, y: 0, z: 0.5 }, { name: "granero", footprint: [20, 20] }, "narrative_request", "ev_granero");
  const ids3 = grupo.map((g) => g[0]);
  const dentro3 = ids3.filter((id) => { const p = s3.getEntity(id).position; return prov3.ocupado(p[0], p[2], R_NPC); });
  ctx.expect("3 · CONTROL: el granero de 10 m cae encima de los cuatro", dentro3.length === 4, dentro3.join(", "));
  const r3 = correr(s3, prov3, sys3, ids3, 40, junto);
  ctx.expect("3 · salen los cuatro (quieto, hold, react, ya llegado)", ids3.every((id) => r3[id].salio !== null && !r3[id].finDentro),
    ids3.map((id) => `${id} ${r3[id].salio?.toFixed(1) ?? "NUNCA"} s`).join(" · "));

  // ── 4 · npc_arrive a ≤ 3 m del centro pero dentro de un carro ───────────
  const s4 = new m.NarrativeState(new m.MemorySessionStorage());
  s4.startNewSession("qa250-4");
  s4.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(campo()));
  // rect [60,60,8,8] → de −2 a 2 m: el viajero en (1, 1) ya está DENTRO.
  s4.worldMap.upsertPlace({ id: "pozo", kind: "landmark", parent_id: null, name: "el pozo", anchor: { tx: 0, ty: 0, rect: [60, 60, 8, 8] } });
  const prov4 = m.createSimCollisionProvider(s4);
  const dir4 = new m.NpcDirector(s4, prov4);
  const sys4 = m.createSessionNpcBehavior({ narrative: s4, simCollision: prov4 }, undefined);
  s4.recordEntitySpawned("viajero", "npc", "tile_0_0", [1, 0, 1], { name: "Viajero" });
  s4.recordEntitySpawned("carro", "object", "tile_0_0", { x: 0, y: 0, z: 0 }, { name: "carro", footprint: [12, 12] }, "narrative_request", "ev_carro");
  dir4.moveNpcToPlace("viajero", "pozo");
  sys4.addNpc(s4.getEntity("viajero"));
  const res4 = dir4.arriveNpc("viajero");
  const p4 = s4.getEntity("viajero").position;
  ctx.expect("4 · CONTROL: llega sin salto (ya estaba en el rect) y queda dentro del carro",
    res4.ok && p4[0] === 1 && p4[2] === 1 && prov4.ocupado(p4[0], p4[2], R_NPC));
  const r4 = correr(s4, prov4, sys4, ["viajero"], 30);
  ctx.expect("4 · …y el sim lo saca", r4.viajero.salio !== null && !r4.viajero.finDentro, `${r4.viajero.salio?.toFixed(1) ?? "NUNCA"} s`);

  // ── 5 · La huida con pelea que sigue (#298) ─────────────────────────────
  const casos5 = [
    ["villager sin directiva", { role: "villager" }],
    ["peasant sin directiva", { role: "peasant" }],
    ["merchant sin directiva", { role: "merchant" }],
    ["villager con hold", { data: { directive: { type: "hold" } } }],
    ...[1, 2, 3, 4].map((k) => [`villager patrol · semilla ${k} · 300 s`, { data: { directive: { type: "patrol" } }, seed: `pat${k}`, segundos: 300 }]),
  ];
  for (const [nombre, opts] of casos5) {
    const h = huida(m, opts);
    ctx.expect(`5 · ${nombre}: huye UNA vez y no vuelve a entrar en su percepción`, h.huidas === 1 && h.reanudo && h.enPercepcion === 0,
      `huidas ${h.huidas} · ticks en percepción tras reanudar ${h.enPercepcion}`);
  }

  // ── Los tres agujeros de la QA de BL, hoy asertos ───────────────────────
  // A1 · el que iba a un sitio junto a la pelea (H2).
  const plazaJunto = [{ id: "plaza", kind: "landmark", parent_id: null, name: "plaza", anchor: { tx: 0, ty: 0, rect: [(-8 + 32) / 0.5, 32 / 0.5, 0, 0] } }];
  const a1 = huida(m, { data: { directive: { type: "goto_place", target_place_id: "plaza" } }, places: plazaJunto });
  ctx.expect("A1 · con `goto_place` junto a la pelea huye UNA vez y no vuelve a su percepción",
    a1.huidas === 1 && a1.reanudo && a1.enPercepcion === 0,
    `huidas ${a1.huidas} · ticks en percepción tras reanudar ${a1.enPercepcion}`);
  ctx.expect("A1 · …suspende la directiva y el record lo refleja para el motor (`suspended_goal`)",
    a1.data.directive === null && a1.data.suspended_goal?.field === "directive" &&
      a1.data.suspended_goal?.value?.target_place_id === "plaza" && a1.data.suspended_goal?.reason === "fled_combat",
    JSON.stringify({ directive: a1.data.directive, suspended_goal: a1.data.suspended_goal }));

  // A2 · la huida llega a su meta con un paseo grande (H3).
  let rehuyen = 0;
  for (let k = 1; k <= 8; k++) {
    if (huida(m, { data: { directive: { type: "wander", radius: 15 } }, seed: `w15-${k}`, segundos: 600 }).huidas > 1) rehuyen++;
  }
  ctx.expect("A2 · con `wander.radius` 15 ninguna semilla re-huye (8 × 600 s)", rehuyen === 0, `${rehuyen} de 8`);

  // A3 · la caché de colisión no guarda la ausencia de un tile (H1).
  const s6 = new m.NarrativeState(new m.MemorySessionStorage());
  s6.startNewSession("qa250-a3");
  s6.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(campo()));
  const concejo = edificios.find((e) => e.id === "casa_concejo");
  s6.worldMap.upsertPlace({ id: "concejo", kind: "site", parent_id: null, name: "Casa del concejo", anchor: { tx: 1, ty: 0, rect: [concejo.cell[0], concejo.cell[1], concejo.footprint[0], concejo.footprint[1]] } });
  const prov6 = m.createSimCollisionProvider(s6);
  const dir6 = new m.NpcDirector(s6, prov6);
  s6.recordEntitySpawned("viajero", "npc", "tile_0_0", [0, 0, 0], { name: "Viajero" });
  dir6.moveNpcToPlace("viajero", "concejo");
  const res6 = dir6.arriveNpc("viajero");
  s6.recordSceneLoaded("tile_1_0", m.expandScenePrimitives({ ...robledo, tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0" }));
  const c6 = centroDe(concejo);
  const ve = prov6.ocupado(c6.x + 64, c6.z, R_NPC);
  const verdad = m.createSimCollisionProvider(s6).ocupado(c6.x + 64, c6.z, R_NPC);
  ctx.expect("A3 · tras `npc_arrive` a un tile SIN realizar, el proveedor de la sesión ve el tile en cuanto se realiza",
    res6.ok && verdad && ve,
    `ok=${res6.ok} · sesión ${ve ? "ocupado" : "LIBRE"} · verdad ${verdad ? "ocupado" : "libre"}`);
  // Y el viajero que cayó en el centro (entonces libre) está dentro: el sim le saca.
  const sys6 = m.createSessionNpcBehavior({ narrative: s6, simCollision: prov6 }, undefined);
  sys6.addNpc(s6.getEntity("viajero"));
  // Se JUZGA con un proveedor recién hecho, no con el de la sesión: con la
  // caché envenenada, el de la sesión ve libre al que está dentro y este
  // aserto salía verde por construcción (medido saboteando la caché).
  const r6 = correr(s6, m.createSimCollisionProvider(s6), sys6, ["viajero"], 30);
  ctx.expect("A3 · …y el viajero que cayó en el concejo antes de que existiera, sale", r6.viajero.salio !== null && !r6.viajero.finDentro,
    `${r6.viajero.salio?.toFixed(1) ?? "NUNCA"} s`);

  console.warn = warn;
}
