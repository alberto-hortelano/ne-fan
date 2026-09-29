/** EL ALDEANO RODEA LA CASA Y LLEGA A LA PUERTA (#618, pieza A — tanda BO).
 *
 *  Hasta la tanda BO un NPC con destino solo tenía el abanico de siete rumbos:
 *  con un edificio entre él y su meta pisaba en el sitio delante de la
 *  fachada, con la animación de andar puesta, hasta que el watchdog se rendía
 *  y `goto` volvía a derivar la misma meta. Hoy busca camino con un A* sobre
 *  la colisión del sim (`bridge/sim-collision.ts` → `buscarRuta`) y su meta es
 *  un sitio LIBRE del lugar (`sitioParaAparecer`), no su centro.
 *
 *  `qa/el-mundo-solido-tambien-para-el-npc.mjs` lo mide sin navegador sobre
 *  mundos de laboratorio. Esto es el juego entero desde el arranque: el
 *  bridge de verdad, el tile que sirve el motor falso y la posición que el
 *  jugador VE (`__nefan.npcs()`, que llega por `state_update.npcs`).
 *
 *  Lo que se hace, por los canales del motor:
 *   1 · Nueva partida; se elige al habitante AMBIENTAL del tile de entrada y
 *       un EDIFICIO del tile servido (derivados de la escena, sin coordenadas
 *       escritas a mano) con un punto libre DELANTE de una cara y otro DETRÁS
 *       de la opuesta, alineados con su centro — CONTROL: la recta entre los
 *       dos pisa el edificio.
 *   2 · `POST /map/place` (= `map_upsert_place`) ancla un lugar delante y
 *       `POST /npc/{id}/directive` (= `npc_set_directive`) le da `goto_place`.
 *       Llegar ahí es CONTROL: pone al NPC de frente y centrado ante la
 *       fachada. Sin esta etapa el guion no discriminaba: con la recta
 *       oblicua desde donde está el NPC, el abanico resbala por la cara y
 *       llega sin ruta (medido en la primera versión: VERDE con el A*
 *       cortado).
 *   3 · Otro lugar detrás y otra directiva. Se sondea su posición: llega en
 *       ≤ 60 s, y NINGÚN punto de la traza está dentro de un sólido
 *       (`probePoint`, la consulta de PUNTO: `probeCollide` es de movimiento
 *       y su sujeto es el jugador).
 *   4 · Captura con el NPC detrás de la casa, para la crítica visual (cámara
 *       de bench: `setPlayerPos` + `setYaw`, sin aserto).
 *
 *  PROBADO EN NEGATIVO (tanda BO): con `buscarRuta` cortado en
 *  `nefan-core/bridge/context.ts` (el plan siempre falla y el NPC vuelve al
 *  abanico), el 3 sale rojo: a los 60 s de juego estaba en (18,85, 8,49), a
 *  10,5 m de la meta, con 52,9 m andados pisando en el sitio delante de la
 *  fachada. Con el A*: 18,7 s y 18,6 m.
 *  El «anduvo más que la recta» NO discrimina (el que pisa en el sitio también
 *  anda): está para que el verde no pueda salir de un NPC teletransportado.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** El mapa se MUTA (un lugar nuevo) y la directiva se escribe en el save. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const LUGAR_DELANTE = "qa270_delante_de_la_casa";
const LUGAR_DETRAS = "qa270_detras_de_la_casa";
/** Umbral de llegada del NPC (`GOAL_REACHED` en `npc-behavior.ts`) y un margen
 *  de la cadencia del sondeo. */
const LLEGADA_M = 1.5 + 0.3;
/** Tras la cara del edificio, cuánto se aleja la meta, y delante de la
 *  opuesta el punto de partida: lo bastante para que no caigan pegados a la
 *  fachada ni fuera del tile. */
const DETRAS_M = 3;
const DELANTE_M = 4;
const PRESUPUESTO_S = 60;
const MPC = 0.5;

/** Llamada al State API tal cual la hace narrative-mcp. */
async function api(method, path, body) {
  const res = await fetch(`${URLS.state_api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text };
  }
  return { status: res.status, body: json };
}

/** El NPC ambiental del tile y, por cada edificio y cada eje, un par de
 *  puntos LIBRES a los dos lados: `frente` (a `DELANTE_M` de una cara) y
 *  `detras` (a `DETRAS_M` de la opuesta), alineados con el CENTRO. Ir de uno al
 *  otro es chocar de frente y centrado contra la fachada, que es justo lo que
 *  el abanico no sabe resolver: con una recta oblicua resbala por la cara y
 *  llega sin ruta (medido: la primera versión de este guion salía VERDE con el
 *  A* cortado, porque el aldeano llegaba en diagonal y resbalaba). Todo se lee
 *  de la escena SERVIDA y se sondea con la colisión del cliente. */
function candidatos(args) {
  const { delante, detras, mpc } = args;
  const n = window.__nefan;
  const escena = n.scene;
  const ambientales = (escena.npcs ?? []).filter((x) => x.role !== "hostile" && x.combat == null);
  const vivos = n.npcs();
  const npc = ambientales.map((a) => vivos.find((v) => v.id === a.id)).find(Boolean) ?? null;
  if (!npc) return { npc: null, lista: [] };
  const r = escena.world_rect;
  const dentroDelTile = (p) => p.x > r.minX + 2 && p.x < r.maxX - 2 && p.z > r.minZ + 2 && p.z < r.maxZ - 2;
  const rect = (p) => [Math.round((p.x - r.minX) / mpc) - 1, Math.round((p.z - r.minZ) / mpc) - 1, 2, 2];
  const lista = [];
  for (const o of escena.objects ?? []) {
    if (o.category !== "building") continue;
    const c = { x: o.position[0], z: o.position[2] };
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const semi = ax ? o.scale[0] / 2 : o.scale[2] / 2;
      const frente = { x: c.x - ax * (semi + delante), z: c.z - az * (semi + delante) };
      const meta = { x: c.x + ax * (semi + detras), z: c.z + az * (semi + detras) };
      if (!dentroDelTile(frente) || !dentroDelTile(meta)) continue;
      if (n.probePoint(frente.x, frente.z) || n.probePoint(meta.x, meta.z)) continue;
      const L = Math.hypot(meta.x - frente.x, meta.z - frente.z);
      let cruza = 0;
      const pasos = Math.ceil(L / 0.25);
      for (let k = 0; k <= pasos; k++) {
        if (n.probePoint(frente.x + ((meta.x - frente.x) * k) / pasos, frente.z + ((meta.z - frente.z) * k) / pasos)) cruza++;
      }
      if (cruza === 0) continue;
      lista.push({ edificio: o.id, nombre: o.name, centro: c, huella: [o.scale[0], o.scale[2]], frente, meta, cruza, L,
        aFrente: Math.hypot(frente.x - npc.pos.x, frente.z - npc.pos.z), rectFrente: rect(frente), rectMeta: rect(meta) });
    }
  }
  lista.sort((a, b) => a.aFrente - b.aFrente);
  return { npc, tile: n.currentTile, lista };
}

/** Manda al NPC a `lugar` por los canales del motor y ESPERA POR ESTADO a que
 *  llegue a `punto`, con presupuesto en segundos de MUNDO (`{sim}`): bajo carga
 *  el juego avanza menos que la pared, y un NPC que no ha tenido frames no es
 *  un NPC que no llega. La traza se acumula en la página, en el mismo sondeo
 *  que decide la llegada. */
async function irA(ctx, npcId, tile, lugar, nombre, rect, punto) {
  const m = /^tile_(-?\d+)_(-?\d+)$/.exec(tile);
  const alta = await api("POST", "/map/place", {
    id: lugar, kind: "landmark", parent_id: null, name: nombre,
    anchor: { tx: Number(m[1]), ty: Number(m[2]), rect },
  });
  const orden = await api("POST", `/npc/${npcId}/directive`, { directive: { type: "goto_place", target_place_id: lugar } });
  const ok = alta.status === 200 && orden.status === 200;
  const vacia = { ok, estado: { alta: alta.status, orden: orden.status }, traza: [], llegada: null, andado: 0, ultimo: null };
  ctx.expect(`el motor ancla «${nombre}» y da la directiva (map_upsert_place + npc_set_directive)`, ok, JSON.stringify(vacia.estado));
  if (!ok) return vacia;
  await ctx.page.evaluate(() => { window.__qa270 = { t0: window.__nefan.reloj().sim, traza: [] }; });
  const espera = await ctx.expectEspera(`el NPC llega a «${nombre}»`, true, (a) => {
    const n = window.__nefan;
    const v = n.npcs().find((x) => x.id === a.id);
    if (!v) return null;
    const q = window.__qa270;
    q.traza.push({ x: v.pos.x, z: v.pos.z, ocupado: n.probePoint(v.pos.x, v.pos.z) });
    return Math.hypot(v.pos.x - a.punto.x, v.pos.z - a.punto.z) <= a.llegada ? n.reloj().sim - q.t0 : null;
  }, { sim: PRESUPUESTO_S, arg: { id: npcId, punto, llegada: LLEGADA_M }, aserto: `«${nombre}»: llega en ≤ ${PRESUPUESTO_S} s de juego` });
  const traza = await ctx.page.evaluate(() => window.__qa270.traza);
  const andado = traza.reduce((acc, p, i) => (i ? acc + Math.hypot(p.x - traza[i - 1].x, p.z - traza[i - 1].z) : 0), 0);
  return { ...vacia, traza, llegada: espera.ocurrio ? espera.ultimo : null, andado, ultimo: traza.at(-1) ?? null };
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  // ── 1 · El NPC, el edificio y los dos puntos ─────────────────────────────
  const c = await ctx.page.evaluate(candidatos, { delante: DELANTE_M, detras: DETRAS_M, mpc: MPC });
  if (!c.npc) {
    ctx.sinMedir("el tile de entrada no trae ningún habitante AMBIENTAL: no hay a quién mandar a ningún sitio");
  }
  ctx.log(`NPC ${c.npc.id} en (${c.npc.pos.x.toFixed(2)}, ${c.npc.pos.z.toFixed(2)}) · ${c.lista.length} par(es) frente/detrás`);
  ctx.expect("CONTROL: hay un edificio del tile con un punto libre delante y otro detrás, y la recta entre ellos lo cruza",
    c.lista.length > 0, JSON.stringify(c.lista.slice(0, 3)));
  if (!c.lista.length) return;
  const e = c.lista[0];
  ctx.log(`edificio «${e.nombre ?? e.edificio}» centro (${e.centro.x.toFixed(1)}, ${e.centro.z.toFixed(1)}) ` +
    `huella ${e.huella.join(" × ")} m · delante (${e.frente.x.toFixed(2)}, ${e.frente.z.toFixed(2)}) → ` +
    `detrás (${e.meta.x.toFixed(2)}, ${e.meta.z.toFixed(2)}): ${e.L.toFixed(1)} m de recta que pisa sólido en ${e.cruza} sonda(s)`);

  // ── 2 · Primera etapa: plantarse DELANTE, centrado ───────────────────────
  const ida = await irA(ctx, c.npc.id, c.tile, LUGAR_DELANTE, "Delante de la casa (guion 270)", e.rectFrente, e.frente);
  ctx.expect("CONTROL: el NPC llega delante de la fachada (la etapa que pone el choque de frente)", ida.llegada !== null,
    ida.llegada !== null ? `en ${ida.llegada.toFixed(1)} s` : `se quedó en (${ida.ultimo?.x.toFixed(2)}, ${ida.ultimo?.z.toFixed(2)})`);
  if (ida.llegada === null) return;

  // ── 3 · Segunda etapa: al otro lado, con la casa en medio ────────────────
  const vuelta = await irA(ctx, c.npc.id, c.tile, LUGAR_DETRAS, "Detrás de la casa (guion 270)", e.rectMeta, e.meta);
  ctx.expect(`3 · el NPC RODEA el edificio y llega detrás en ≤ ${PRESUPUESTO_S} s`, vuelta.llegada !== null,
    vuelta.llegada !== null
      ? `llegó en ${vuelta.llegada.toFixed(1)} s andando ${vuelta.andado.toFixed(1)} m (la recta eran ${e.L.toFixed(1)} m)`
      : `a los ${PRESUPUESTO_S} s estaba en (${vuelta.ultimo?.x.toFixed(2)}, ${vuelta.ultimo?.z.toFixed(2)}), ` +
        `a ${vuelta.ultimo ? Math.hypot(vuelta.ultimo.x - e.meta.x, vuelta.ultimo.z - e.meta.z).toFixed(1) : "?"} m de la meta`);
  const traza = [...ida.traza, ...vuelta.traza];
  const dentro = traza.filter((p) => p.ocupado);
  ctx.expect("3 · …y ningún punto de su traza está dentro de un sólido (consulta de PUNTO)", dentro.length === 0,
    `${dentro.length} de ${traza.length} muestras dentro${dentro[0] ? `, la primera en (${dentro[0].x.toFixed(2)}, ${dentro[0].z.toFixed(2)})` : ""}`);
  ctx.expect("3 · …y anduvo más que la recta (rodear es más largo que atravesar)", vuelta.andado > e.L,
    `${vuelta.andado.toFixed(1)} m andados para ${e.L.toFixed(1)} m de recta`);
  ctx.log(`etapa 1: ${ida.llegada?.toFixed(1)} s · etapa 2: ${vuelta.llegada?.toFixed(1) ?? "—"} s, ${vuelta.andado.toFixed(1)} m`);

  // ── 4 · La foto ──────────────────────────────────────────────────────────
  // Cámara de bench (no es el camino del jugador, y no afirma nada): se pone
  // al jugador a unos metros del NPC, del lado contrario al edificio,
  // mirándolo, para que la captura enseñe al NPC con la fachada detrás.
  const camara = await ctx.page.evaluate(({ meta, centro }) => {
    const n = window.__nefan;
    const base = Math.atan2(meta.x - centro.x, meta.z - centro.z);
    // Del lado contrario al edificio primero, y abriendo el ángulo hasta ver
    // al NPC sin nada sólido en medio.
    for (const da of [0, 0.5, -0.5, 1, -1, 1.4, -1.4]) {
      for (const k of [5, 6.5]) {
        const a = base + da;
        const p = { x: meta.x + Math.sin(a) * k, z: meta.z + Math.cos(a) * k };
        let libre = true;
        for (let i = 0; i <= 20 && libre; i++) {
          if (n.probePoint(p.x + ((meta.x - p.x) * i) / 20 * 0.8, p.z + ((meta.z - p.z) * i) / 20 * 0.8)) libre = false;
        }
        if (!libre) continue;
        n.setPlayerPos(p.x, p.z);
        n.setYaw(Math.atan2(meta.x - p.x, meta.z - p.z));
        return p;
      }
    }
    return null;
  }, { meta: e.meta, centro: e.centro });
  ctx.log(`cámara de la captura: ${camara ? `(${camara.x.toFixed(1)}, ${camara.z.toFixed(1)})` : "sin sitio libre; la foto es la vista del jugador"}`);
  // Medio segundo de mundo para que el renderer pinte con la cámara puesta.
  const t = await ctx.page.evaluate(() => window.__nefan.reloj().sim);
  await ctx.waitFor("medio segundo de juego con la cámara puesta", (t0) => (window.__nefan.reloj().sim > t0 + 0.5 ? true : null), { sim: 2 }, t);
  await ctx.shot("npc-en-la-puerta");
}
