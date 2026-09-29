/** CUANDO NO HAY CAMINO, ¿EL ALDEANO SIGUE PISANDO EN EL SITIO? (#618 — QA de la tanda BO)
 *
 *  POR QUÉ EXISTE. La petición era que el NPC RODEE en vez de pisar en el
 *  sitio. La tanda BO lo cumple cuando hay camino (`el-mundo-solido`, 270).
 *  Cuando NO lo hay, el plan falla y el NPC vuelve al steering de antes
 *  (`implementacion.md`: «se hace `warnOnce` y el NPC vuelve al steering
 *  directo»), que es exactamente el síntoma de partida: la animación de andar
 *  puesta y el cuerpo quieto contra la pared. Ningún candado de BO lo mira:
 *  `el-mundo-solido` bloque 4 afirma que el escape se ANUNCIA, y su cabecera
 *  declara que no termina.
 *
 *  Tres casos con el cableado de PRODUCCIÓN, 120 s de juego cada uno:
 *    A. CONTROL: meta alcanzable detrás de un carro de 6 m. Llega; lo que se
 *       mide abajo sale a cero. Prueba que la medida PUEDE ser verde.
 *    B. Meta en un PATIO CERRADO (cuatro murallas de runtime, sin puerta).
 *    C. El PASILLO CERRADO de `el-mundo-solido` (1 m de ancho, tres murallas y
 *       el agua del tile): el escape por caja se anuncia y nunca termina.
 *
 *  LO QUE AFIRMA, en B y en C:
 *    1. CONTROL: el plan falla y se dice («no encuentra ruta»).
 *    2. no pasa más del 10 % del tiempo con `moving=true` sin avanzar (menos
 *       de 0,3 m en un segundo): lo que ve el jugador es andar en el sitio;
 *    3. su mirada no tiembla: menos de 5 saltos de `forward` > 3° por segundo
 *       (lo que viaja en `state_update.npcs` y pinta el cliente);
 *    4. y en C, si el escape «ATRAVIESA» se anuncia, en ≤ 30 s está fuera del
 *       cercado.
 *
 *  NACIÓ ROJO sobre `d0d1903b` (QA de BO), igual que en `main` antes de BO
 *  (C no tiene ruta: `inicio-encerrado`, así que el steering es el de antes):
 *   - B: 70 s de 120 andando sin avanzar, 109 cambios de sentido; cada 3 s un
 *     plan que llega al tope de 16.384 expansiones (20-45 ms, medido fuera
 *     de este guion);
 *   - C: `moving=true` el 100 % de 300 s en (7,50, 0,00↔0,02); la mirada salta
 *     84°↔90° en CADA tick (60 veces por segundo); el aviso ATRAVIESA y el
 *     «quedó DENTRO» salen una vez cada uno y el NPC no sale jamás.
 *
 *  VERDE desde la 2ª vuelta de BO (decisión del usuario: «que el estado le
 *  llegue al motor de narrativa y él decide»): tras un plan fallido y UN
 *  reintento el NPC se PARA y deja la meta en `suspended_goal` con
 *  `reason: "no_path"`; sin ruta ya no anda con el abanico. En negativo (sin
 *  rendirse): rojos B-2, B-3, C-2, C-3 y C-4.
 *
 *  PROBADO EN POSITIVO (QA de BO; sabotaje de una línea en `dist`, restaurado
 *  con `md5sum -c`): con el NPC PARADO (`moving=false`, sin paso) cuando su
 *  último plan falló, los diez asertos salen verdes, el control A incluido.
 *  No es una propuesta de arreglo —quedarse quieto, avisar al motor o darse
 *  por vencido es decisión de producto—: es la prueba de que 2-4 miden la
 *  conducta y no el aserto.
 *
 *  Sin navegador, sin stack, sin créditos: lee `nefan-core/dist`. Antes:
 *  `cd nefan-core && npm run build`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "mueve NPCs con el sim de nefan-core/dist y el proveedor de colisión de producción; no abre partida ni habla con el motor";
export const sinNavegador = "conduce el NpcBehaviorSystem de dist con el cableado del bridge; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(RAIZ, "nefan-core", "dist");
const T = 1 / 60;
const SEGUNDOS = 120;
const LEJOS = { playerPos: { x: 999, y: 0, z: 999 }, combatEvents: [], combatantPositions: new Map() };
/** Umbrales de lo que el jugador llama «pisar en el sitio» y «temblar». */
const SIN_AVANZAR_M = 0.3;
const TOPE_SIN_AVANZAR = 0.1;
const GIRO_RAD = (3 * Math.PI) / 180;
const TOPE_TEMBLOR_POR_S = 5;
const ESCAPE_S = 30;

async function cargar() {
  return {
    NarrativeState: (await import(`${DIST}/src/narrative/narrative-state.js`)).NarrativeState,
    MemorySessionStorage: (await import(`${DIST}/src/narrative/session-storage.js`)).MemorySessionStorage,
    expandScenePrimitives: (await import(`${DIST}/src/scene/scene-expand.js`)).expandScenePrimitives,
    createSimCollisionProvider: (await import(`${DIST}/bridge/sim-collision.js`)).createSimCollisionProvider,
    createSessionNpcBehavior: (await import(`${DIST}/bridge/context.js`)).createSessionNpcBehavior,
  };
}

/** Un tile de campo; con `agua`, la columna del `terrain_grid` en x 8..8,5
 *  (filas 40..88), la misma de `el-mundo-solido`. */
function tile(m, { agua = false } = {}) {
  const s = new m.NarrativeState(new m.MemorySessionStorage());
  s.startNewSession("qa273");
  const escena = m.expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", scene_description: "campo", biome: "grass", entities: [] });
  if (agua) for (let r = 40; r < 88; r++) escena.terrain[r] = `${escena.terrain[r].slice(0, 80)}w${escena.terrain[r].slice(81)}`;
  s.recordSceneLoaded("tile_0_0", escena);
  return s;
}

function caja(s, id, x, z, footprint) {
  s.recordEntitySpawned(id, "building", "tile_0_0", { x, y: 0, z }, { name: id, footprint }, "narrative_request", `ev_${id}`);
}

/** El aldeano va a `meta` durante `SEGUNDOS`; se mide lo que ve el jugador. */
function aldeano(m, s, desde, meta) {
  s.worldMap.upsertPlace({ id: "meta", kind: "landmark", parent_id: null, name: "meta",
    anchor: { tx: 0, ty: 0, rect: [(meta.x + 32) / 0.5, (meta.z + 32) / 0.5, 0, 0] } });
  const prov = m.createSimCollisionProvider(s);
  const sys = m.createSessionNpcBehavior({ narrative: s, simCollision: prov }, undefined);
  s.recordEntitySpawned("aldeano", "npc", "tile_0_0", [desde.x, 0, desde.z],
    { name: "aldeano", role: "villager", directive: { type: "goto_place", target_place_id: "meta" } });
  sys.addNpc(s.getEntity("aldeano"));
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.map(String).join(" "));
  const traza = [];
  let llegada = null;
  try {
    for (let k = 0; k < SEGUNDOS / T; k++) {
      if (sys.tick(T, LEJOS).some((e) => e.type === "npc_reached_place") && llegada === null) llegada = (k + 1) * T;
      const st = sys.states()[0];
      traza.push({ t: (k + 1) * T, x: st.pos.x, z: st.pos.z, m: st.moving, f: Math.atan2(st.forward.x, st.forward.z) });
    }
  } finally {
    console.warn = warn;
  }
  // Pisar en el sitio: segundos con moving=true y < SIN_AVANZAR_M de avance en ese segundo.
  const porSegundo = Math.round(1 / T);
  let enElSitio = 0, segundos = 0;
  for (let i = porSegundo; i < traza.length; i += porSegundo) {
    segundos++;
    const a = traza[i - porSegundo], b = traza[i];
    if (b.m && Math.hypot(b.x - a.x, b.z - a.z) < SIN_AVANZAR_M) enElSitio++;
  }
  let temblores = 0;
  for (let i = 1; i < traza.length; i++) {
    let d = Math.abs(traza[i].f - traza[i - 1].f);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > GIRO_RAD) temblores++;
  }
  return { llegada, avisos, traza, enElSitio, segundos, temblorPorS: temblores / SEGUNDOS, fin: traza.at(-1) };
}

const pct = (a, b) => `${((100 * a) / b).toFixed(0)} %`;

function afirmaQueNoPisa(ctx, etiqueta, r) {
  ctx.expect(`${etiqueta} · CONTROL: el plan falla y se dice`, r.avisos.some((a) => a.includes("no encuentra ruta")),
    r.avisos.find((a) => a.includes("no encuentra ruta"))?.slice(0, 140) ?? "sin aviso");
  ctx.expect(`${etiqueta} · no se queda andando en el sitio (≤ ${TOPE_SIN_AVANZAR * 100} % del tiempo con moving=true y < ${SIN_AVANZAR_M} m/s)`,
    r.enElSitio / r.segundos <= TOPE_SIN_AVANZAR,
    `${r.enElSitio} s de ${r.segundos} (${pct(r.enElSitio, r.segundos)}) · acabó en (${r.fin.x.toFixed(2)}, ${r.fin.z.toFixed(2)}) moving=${r.fin.m}`);
  ctx.expect(`${etiqueta} · su mirada no tiembla (< ${TOPE_TEMBLOR_POR_S} saltos de forward > 3° por segundo)`,
    r.temblorPorS < TOPE_TEMBLOR_POR_S, `${r.temblorPorS.toFixed(1)} por segundo`);
}

export default async function (ctx) {
  const m = await cargar();

  // ── A · CONTROL: con camino, la medida sale a cero ─────────────────────
  const sA = tile(m);
  caja(sA, "carro", 0, 0, [12, 12]);
  const a = aldeano(m, sA, { x: -12, z: 0 }, { x: 12, z: 0 });
  ctx.expect("A · CONTROL: con camino, llega", a.llegada !== null, `${a.llegada?.toFixed(1) ?? "NUNCA"} s`);
  ctx.expect("A · CONTROL: con camino, la medida de «pisar en el sitio» sale a cero", a.enElSitio === 0 && a.temblorPorS < TOPE_TEMBLOR_POR_S,
    `${a.enElSitio} s en el sitio · ${a.temblorPorS.toFixed(1)} temblores/s`);

  // ── B · Meta en un patio cerrado ────────────────────────────────────────
  const sB = tile(m);
  caja(sB, "muro_n", 0, 5, [20, 2]);
  caja(sB, "muro_s", 0, -5, [20, 2]);
  caja(sB, "muro_e", 5, 0, [2, 20]);
  caja(sB, "muro_o", -5, 0, [2, 20]);
  const b = aldeano(m, sB, { x: -14, z: 0 }, { x: 0, z: 0 });
  ctx.expect("B · CONTROL: el patio no tiene entrada (no llega)", b.llegada === null, `${b.llegada ?? "no llegó"}`);
  afirmaQueNoPisa(ctx, "B · patio cerrado", b);

  // ── C · El pasillo cerrado de verdad ────────────────────────────────────
  const sC = tile(m, { agua: true });
  caja(sC, "muralla_norte", 6, 1.5, [40, 4]);
  caja(sC, "muralla_sur", 6, -1.5, [40, 4]);
  caja(sC, "muralla_oeste", -5, 0, [2, 10]);
  const c = aldeano(m, sC, { x: 6, z: 0 }, { x: 30, z: 0 });
  afirmaQueNoPisa(ctx, "C · pasillo cerrado", c);
  const anuncio = c.avisos.findIndex((x) => x.includes("ATRAVIESA"));
  const cercado = (p) => p.x > -4 && p.x < 8 && Math.abs(p.z) < 1;
  const fuera = c.traza.find((p) => !cercado(p));
  ctx.expect(`C · si el escape se anuncia, en ≤ ${ESCAPE_S} s está fuera del cercado`,
    anuncio < 0 || (fuera !== undefined && fuera.t <= ESCAPE_S),
    `${anuncio < 0 ? "sin anuncio" : "anunciado"} · ${fuera ? `fuera a los ${fuera.t.toFixed(1)} s` : `nunca sale en ${SEGUNDOS} s`} · ` +
    `avisos: ${c.avisos.map((x) => x.slice(0, 90)).join(" | ")}`);
}
