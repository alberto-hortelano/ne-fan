/** VARIOS ALDEANOS A LA MISMA CASA: ¿LLEGAN CADA UNO POR SU LADO, O SE APILAN EN UN PUNTO? (#618 — QA de la tanda BO)
 *
 *  POR QUÉ EXISTE. La tanda BO le dio al NPC un A* y una META LIBRE: el lugar
 *  anclado a un edificio (el `anchor.rect` es su huella, 13 de 13 en robledo y
 *  puerto) ya no se persigue hasta su centro ocupado, sino hasta
 *  `sitioParaAparecer(centro)` — UN punto, el mismo para todos, en la cara que
 *  la cuenta elija. Los candados de BO mandan a UN NPC cada vez. Esto manda a
 *  CUATRO a la vez, desde los cuatro lados del concejo de robledo, que es lo
 *  que el motor hace cuando dice «los vecinos van al concejo».
 *
 *  LO QUE AFIRMA:
 *    1. CONTROL: los cuatro llegan (`npc_reached_place`) en ≤ 60 s de juego.
 *    2. al llegar, ningún par tiene los CUERPOS solapados (centros a ≥ 2 R);
 *    3. nadie da la vuelta al edificio para llegar a él: lo andado no pasa de
 *       2,5 × la distancia a la huella del edificio (inflada por el radio) +
 *       2 m (doblar una esquina cabe de sobra; rodear media casa, no);
 *    4. CONTROL del 2: los mismos cuatro hacia un lugar de CAMPO ABIERTO se
 *       quedan separados. Es lo que demuestra que el 2 puede ponerse verde —
 *       sin él, un rojo del 2 podría ser el aserto y no el juego.
 *
 *  NACIÓ ROJO sobre `d0d1903b` (QA de BO): los cuatro acaban en un corro de
 *  0,6 m en la cara NORTE (el del sur y el del oeste a 0,01 m: un cuerpo
 *  dentro del otro), y el que llega por el sur anda 15,4 m para una casa que
 *  tenía a 3,5 m, rodeándola. El control 4 sale verde: en campo abierto cada
 *  uno se para a 1,5 m de la meta por su lado. En `scratch`, con una casa de 10 m y seis NPC: los seis en ≤ 0,6 m,
 *  tres en la misma coordenada exacta; el del oeste andaba 27 m para una cara
 *  que tenía a 8,5 m.
 *
 *  VERDE desde la 2ª vuelta de BO: la meta es el primer punto libre del rayo
 *  del centro hacia el vecino (su cara) y se reparte a lo largo de la fachada
 *  con las metas de los que ya van (`metaLibre` en `ruta-por-el-suelo.ts`).
 *  En negativo (vecinos sin repartir, `vecinosEn` vacío): rojo el 4, dos a
 *  0,40 m.
 *
 *  PROBADO EN POSITIVO (que PUEDE ponerse verde, QA de BO): con la meta libre
 *  buscada desde el punto medio entre el vecino y el centro —cada uno se queda
 *  en su cara— sobre `dist/src/simulation/ruta-por-el-suelo.js` (sabotaje de
 *  una línea, restaurado con `md5sum -c`), los seis asertos salen verdes. No es
 *  una propuesta de arreglo: es la prueba de que el 2 y el 3 miden la meta.
 *
 *  Sin navegador, sin stack, sin créditos: lee `nefan-core/dist` con el
 *  cableado de PRODUCCIÓN (`createSessionNpcBehavior` + `createSimCollisionProvider`).
 *  Antes: `cd nefan-core && npm run build`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "mueve NPCs con el sim de nefan-core/dist y el proveedor de colisión de producción; no abre partida ni habla con el motor";
export const sinNavegador = "conduce el NpcBehaviorSystem de dist con el cableado del bridge; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(RAIZ, "nefan-core", "dist");
const T = 1 / 60;
/** Radio del cuerpo del NPC (`NPC_RADIUS_M`). Escrito a mano: es el oráculo. */
const R = 0.5;
const MPC = 0.5;
const PRESUPUESTO_S = 60;
const LEJOS = { playerPos: { x: 999, y: 0, z: 999 }, combatEvents: [], combatantPositions: new Map() };
/** Desde dónde sale cada vecino, relativo a la huella del concejo. */
const LADOS = ["sur", "oeste", "este", "norte"];

async function cargar() {
  return {
    NarrativeState: (await import(`${DIST}/src/narrative/narrative-state.js`)).NarrativeState,
    MemorySessionStorage: (await import(`${DIST}/src/narrative/session-storage.js`)).MemorySessionStorage,
    expandScenePrimitives: (await import(`${DIST}/src/scene/scene-expand.js`)).expandScenePrimitives,
    createSimCollisionProvider: (await import(`${DIST}/bridge/sim-collision.js`)).createSimCollisionProvider,
    createSessionNpcBehavior: (await import(`${DIST}/bridge/context.js`)).createSessionNpcBehavior,
  };
}

/** Distancia de `p` a la huella `h` inflada por el radio (0 si está dentro). */
function aLaHuella(p, h) {
  const dx = Math.max(h.x0 - R - p.x, 0, p.x - (h.x1 + R));
  const dz = Math.max(h.z0 - R - p.z, 0, p.z - (h.z1 + R));
  return Math.hypot(dx, dz);
}

/** Cuatro vecinos al lugar `rect`, desde `salidas`, con el sim de la sesión. */
function vecinosA(m, robledo, rect, salidas) {
  const s = new m.NarrativeState(new m.MemorySessionStorage());
  s.startNewSession("qa271");
  s.recordSceneLoaded("tile_0_0", m.expandScenePrimitives(robledo));
  s.worldMap.upsertPlace({ id: "destino", kind: "landmark", parent_id: null, name: "destino", anchor: { tx: 0, ty: 0, rect } });
  const prov = m.createSimCollisionProvider(s);
  const sys = m.createSessionNpcBehavior({ narrative: s, simCollision: prov }, undefined);
  const ids = salidas.map((p, i) => {
    const id = `vecino_${LADOS[i]}`;
    s.recordEntitySpawned(id, "npc", "tile_0_0", [p.x, 0, p.z], { name: id, role: "villager", directive: { type: "goto_place", target_place_id: "destino" } });
    sys.addNpc(s.getEntity(id));
    return id;
  });
  const llegada = {};
  const andado = Object.fromEntries(ids.map((id) => [id, 0]));
  const prev = Object.fromEntries(ids.map((id, i) => [id, { ...salidas[i] }]));
  for (let k = 0; k < PRESUPUESTO_S / T; k++) {
    for (const e of sys.tick(T, LEJOS)) if (e.type === "npc_reached_place" && llegada[e.npcId] === undefined) llegada[e.npcId] = (k + 1) * T;
    for (const id of ids) {
      const p = s.getEntity(id).position;
      if (llegada[id] === undefined) andado[id] += Math.hypot(p[0] - prev[id].x, p[2] - prev[id].z);
      prev[id] = { x: p[0], z: p[2] };
    }
  }
  const fin = Object.fromEntries(ids.map((id) => [id, { x: s.getEntity(id).position[0], z: s.getEntity(id).position[2] }]));
  return { ids, llegada, andado, fin, prov };
}

/** El par más cercano al final. */
function parMasCercano(ids, fin) {
  let mejor = { d: Infinity, a: null, b: null };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const d = Math.hypot(fin[ids[i]].x - fin[ids[j]].x, fin[ids[i]].z - fin[ids[j]].z);
      if (d < mejor.d) mejor = { d, a: ids[i], b: ids[j] };
    }
  }
  return mejor;
}

const fmt = (p) => `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;

export default async function (ctx) {
  const m = await cargar();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const robledo = JSON.parse(readFileSync(join(RAIZ, "nefan-core/data/scenes/robledo_tile.json"), "utf8"));
    const concejo = robledo.entities.find((e) => e.id === "casa_concejo");
    if (!concejo) ctx.sinMedir("robledo ya no trae `casa_concejo`: no hay edificio al que mandar a los vecinos");
    const h = {
      x0: -32 + concejo.cell[0] * MPC, x1: -32 + (concejo.cell[0] + concejo.footprint[0]) * MPC,
      z0: -32 + concejo.cell[1] * MPC, z1: -32 + (concejo.cell[1] + concejo.footprint[1]) * MPC,
    };
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
    // A 4 m de cada cara, alineados con el centro: sur, oeste, este, norte.
    const salidas = [
      { x: cx, z: h.z0 - 4 }, { x: h.x0 - 4, z: cz }, { x: h.x1 + 4, z: cz }, { x: cx, z: h.z1 + 4 },
    ];
    ctx.log(`concejo x ${h.x0}..${h.x1} · z ${h.z0}..${h.z1}; vecinos desde ${salidas.map(fmt).join(" ")}`);

    // ── 1-3 · Los cuatro al concejo ────────────────────────────────────────
    const r = vecinosA(m, robledo, [...concejo.cell, ...concejo.footprint], salidas);
    const libres = salidas.filter((p) => !r.prov.ocupado(p.x, p.z, R)).length;
    ctx.expect("CONTROL: los cuatro vecinos salen de suelo LIBRE", libres === 4, `${libres} de 4`);
    const noLlegan = r.ids.filter((id) => r.llegada[id] === undefined);
    ctx.expect(`1 · CONTROL: los cuatro llegan al concejo en ≤ ${PRESUPUESTO_S} s`, noLlegan.length === 0,
      r.ids.map((id) => `${id} ${r.llegada[id]?.toFixed(1) ?? "NUNCA"} s → ${fmt(r.fin[id])}`).join(" · "));
    const par = parMasCercano(r.ids, r.fin);
    ctx.expect("2 · al llegar, ningún par tiene los cuerpos solapados (centros a ≥ 2 R = 1 m)", par.d >= 2 * R,
      `${par.a} y ${par.b} a ${par.d.toFixed(2)} m · finales ${r.ids.map((id) => fmt(r.fin[id])).join(" ")}`);
    const rodean = r.ids.map((id, i) => {
      const cerca = aLaHuella(salidas[i], h);
      return { id, andado: r.andado[id], tope: 2.5 * cerca + 2, cerca };
    });
    const vueltas = rodean.filter((x) => x.andado > x.tope);
    ctx.expect("3 · nadie da la vuelta al edificio para llegar a él (andado ≤ 2,5 × distancia a su huella + 2 m)", vueltas.length === 0,
      rodean.map((x) => `${x.id} ${x.andado.toFixed(1)} m (tenía la casa a ${x.cerca.toFixed(1)} m, tope ${x.tope.toFixed(1)})`).join(" · "));

    // ── 4 · CONTROL del 2: un lugar en campo abierto ───────────────────────
    // La plaza al sur del concejo: 2×2 celdas en suelo libre, a 9 m de la cara.
    const plaza = { x: cx, z: h.z0 - 9 };
    // Cada vecino a 7 m de la plaza, uno por lado: cuatro caminos que no se comparten.
    const alrededor = [{ x: 0, z: -7 }, { x: -7, z: 0 }, { x: 7, z: 0 }, { x: 0, z: 3.5 }].map((d) => ({ x: plaza.x + d.x, z: plaza.z + d.z }));
    const r4 = vecinosA(m, robledo, [Math.round((plaza.x + 32) / MPC) - 1, Math.round((plaza.z + 32) / MPC) - 1, 2, 2], alrededor);
    ctx.expect("4 · CONTROL: la plaza y los cuatro arranques están en suelo libre",
      !r4.prov.ocupado(plaza.x, plaza.z, R) && alrededor.every((p) => !r4.prov.ocupado(p.x, p.z, R)), `${fmt(plaza)} · ${alrededor.map(fmt).join(" ")}`);
    const par4 = parMasCercano(r4.ids, r4.fin);
    ctx.expect("4 · CONTROL: hacia un lugar de campo abierto se quedan SEPARADOS (el 2 puede ser verde)", par4.d >= 2 * R,
      `${par4.a} y ${par4.b} a ${par4.d.toFixed(2)} m · llegadas ${r4.ids.map((id) => r4.llegada[id]?.toFixed(1) ?? "NUNCA").join(", ")}`);
  } finally {
    console.warn = warn;
  }
}
