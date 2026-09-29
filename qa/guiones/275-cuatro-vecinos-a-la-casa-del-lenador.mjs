/** CUATRO VECINOS A LA CASA DEL LEÑADOR, EN EL JUEGO ENTERO (#618 — QA de la 2ª vuelta de BO)
 *
 *  POR QUÉ EXISTE. El 271 mide en el sim que varios NPC hacia el mismo
 *  edificio llegan cada uno por su cara y sin meterse uno dentro de otro. Esto
 *  lo mide en el JUEGO: bridge real, cliente real, lo que el jugador VE
 *  (`__nefan.npcs()`), y una captura con los cuatro en la casa.
 *
 *  SIEMBRA (workaround DECLARADO): el tile servido trae un solo aldeano y el
 *  State API no tiene puerta para crear entidades. Lo que el motor haría con
 *  `spawn_entity` se escribe en un CLON del save —tres copias del tabernero
 *  con `spawn_reason: "narrative_request"`, que es la forma exacta en la que
 *  el bridge guarda un NPC puesto por el motor— y se reanuda ese clon. El
 *  jugador llega a ese mismo estado por el camino del motor; el guion solo se
 *  ahorra la conversación.
 *
 *  LO QUE AFIRMA:
 *    1. CONTROL: tras reanudar el clon, los cuatro están en escena;
 *    2. el motor ancla un lugar con la HUELLA de la casa del leñador (el rect
 *       de su footprint, como ancla el motor un edificio) y da `goto_place` a
 *       los cuatro;
 *    3. los cuatro llegan (se paran junto a la casa) en ≤ 90 s de juego;
 *    4. al final ningún par está a < 1 m (dos cuerpos de 0,5 m);
 *    5. ninguno acaba dentro de un sólido (consulta de PUNTO).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { nuevaPartida, comenzar, reanudar, recargarAlTitulo } from "../lib/sesion.mjs";
import { clonarSaves, rutaDelSave } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves", "fake-ai"];

const BASE = "barkeep";
const VECINOS = ["qa275_a", "qa275_b", "qa275_c"];
const MPC = 0.5;
const PRESUPUESTO_S = 90;

async function api(method, path, body) {
  const res = await fetch(`${URLS.state_api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}

/** Lo que el cable dice de los cuatro (`state_update.npcs`), frame a frame. */
function espiarElCable(ctx, ids) {
  const frames = [];
  ctx.page.on("websocket", (ws) => ws.on("framereceived", (f) => {
    if (typeof f.payload !== "string" || !f.payload.includes("\"state_update\"")) return;
    let m;
    try {
      m = JSON.parse(f.payload);
    } catch {
      return;
    }
    const v = (m.npcs ?? []).filter((x) => ids.includes(x.id));
    if (v.length) frames.push(v.map((x) => ({ id: x.id, moving: x.moving, pos: x.pos, state: x.state })));
  }));
  return frames;
}

export default async function (ctx) {
  const frames = espiarElCable(ctx, [BASE, ...VECINOS]);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);
  await ctx.waitFor("el tabernero está en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 60_000, BASE);
  await recargarAlTitulo(ctx);

  // ── Siembra en un clon del save ─────────────────────────────────────────
  const [clon] = clonarSaves(partida.sessionId, 1);
  const f = rutaDelSave(clon);
  const data = JSON.parse(readFileSync(f, "utf8"));
  const base = data.entities.find((e) => e.id === BASE);
  if (!base) ctx.sinMedir("el save no guarda al tabernero como entidad: no hay molde para sembrar vecinos");
  const desplazados = [[-6, 3], [6, -3], [-3, -6]];
  VECINOS.forEach((id, i) => {
    data.entities.push({
      ...structuredClone(base), id, spawn_reason: "narrative_request", spawn_event_id: `ev_${id}`,
      position: [base.position[0] + desplazados[i][0], base.position[1], base.position[2] + desplazados[i][1]],
      data: { ...structuredClone(base.data), name: `Vecino ${i + 1}`, description: "aldeano de camisa parda", role: "villager" },
    });
  });
  writeFileSync(f, JSON.stringify(data));
  const vuelta = await reanudar(ctx, clon);
  ctx.expect("CONTROL: el clon sembrado se reanuda", vuelta !== null, clon);
  if (!vuelta) return;
  const todos = [BASE, ...VECINOS];
  const presentes = await ctx.waitFor("los cuatro en escena", (ids) => {
    const v = window.__nefan.npcs();
    return ids.every((id) => v.some((n) => n.id === id)) ? v.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, pos: n.pos })) : null;
  }, 60_000, todos);
  ctx.expect("1 · CONTROL: tras reanudar, los cuatro están en escena", presentes.length === 4, JSON.stringify(presentes));

  // El jugador se aparta: un NPC en `react` (el jugador a su lado) no relee
  // su directiva hasta que se va (conducta de antes de BO, `decide`), y aquí
  // se mide la ruta, no el saludo.
  await ctx.page.evaluate(() => window.__nefan.setPlayerPos(-25, -25));

  // ── 2 · El lugar: la huella de la casa del leñador ──────────────────────
  const casa = await ctx.page.evaluate(() => {
    const o = window.__nefan.scene.objects.find((x) => x.category === "building");
    return o ? { id: o.id, x: o.position[0], z: o.position[2], w: o.scale[0], d: o.scale[2] } : null;
  });
  if (!casa) ctx.sinMedir("el tile servido ya no trae ningún edificio");
  const rect = [Math.round((casa.x - casa.w / 2 + 32) / MPC), Math.round((casa.z - casa.d / 2 + 32) / MPC), Math.round(casa.w / MPC), Math.round(casa.d / MPC)];
  const alta = await api("POST", "/map/place", { id: "qa275_casa", kind: "landmark", parent_id: null, name: "Casa del leñador (guion 275)", anchor: { tx: 0, ty: 0, rect } });
  const ordenes = [];
  for (const id of todos) ordenes.push((await api("POST", `/npc/${id}/directive`, { directive: { type: "goto_place", target_place_id: "qa275_casa" } })).status);
  ctx.expect("2 · el motor ancla la casa y da la directiva a los cuatro", alta.status === 200 && ordenes.every((s) => s === 200), `${alta.status} · ${ordenes.join(",")}`);

  // ── 3 · Llegan: los cuatro junto a la casa y quietos ────────────────────
  const fin = await ctx.expectEspera("3 · los cuatro llegan a la casa", true, (a) => {
    const n = window.__nefan;
    const v = n.npcs().filter((x) => a.ids.includes(x.id));
    const w = window.__qa275 ?? (window.__qa275 = { prev: null, quietos: 0 });
    const junto = v.every((x) => Math.max(Math.abs(x.pos.x - a.c.x) - a.c.w / 2, Math.abs(x.pos.z - a.c.z) - a.c.d / 2) < 4);
    const mov = w.prev ? Math.max(...v.map((x) => { const p = w.prev.find((q) => q.id === x.id); return p ? Math.hypot(x.pos.x - p.pos.x, x.pos.z - p.pos.z) : 1; })) : 1;
    w.prev = v.map((x) => ({ id: x.id, pos: { ...x.pos } }));
    w.quietos = junto && mov < 0.02 ? w.quietos + 1 : 0;
    return v.length === 4 && w.quietos > 30 ? v.map((x) => ({ id: x.id, x: x.pos.x, z: x.pos.z, dentro: n.probePoint(x.pos.x, x.pos.z) })) : null;
  }, { sim: PRESUPUESTO_S, arg: { ids: todos, c: { x: casa.x, z: casa.z, w: casa.w, d: casa.d } }, aserto: `3 · llegan y se paran junto a la casa en ≤ ${PRESUPUESTO_S} s de juego` });
  const finales = fin.ocurrio ? fin.ultimo : [];
  if (!fin.ocurrio) {
    const donde = await ctx.page.evaluate((ids) => window.__nefan.npcs().filter((x) => ids.includes(x.id)).map((x) => `${x.id} (${x.pos.x.toFixed(2)}, ${x.pos.z.toFixed(2)})`), todos);
    const recs = [];
    for (const id of todos) recs.push(`${id}: ${JSON.stringify((await (await fetch(`${URLS.state_api}/entity/${id}`)).json())?.data?.suspended_goal ?? null)}`);
    const t9 = await ctx.page.evaluate(() => window.__nefan.reloj().sim);
    await ctx.waitFor("2 s más", (t0) => (window.__nefan.reloj().sim > t0 + 2 ? true : null), { sim: 6 }, t9);
    const donde2 = await ctx.page.evaluate((ids) => window.__nefan.npcs().filter((x) => ids.includes(x.id)).map((x) => `${x.id} (${x.pos.x.toFixed(2)}, ${x.pos.z.toFixed(2)})`), todos);
    ctx.log(`2 s después: ${donde2.join(" · ")}`);
    ctx.log(`sin llegar: ${donde.join(" · ")} · casa ${JSON.stringify(casa)} · suspendidas ${recs.join(" · ")}`);
  }
  ctx.log(`finales: ${finales.map((p) => `${p.id} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).join(" · ")}`);
  let minD = Infinity, par = "";
  for (let i = 0; i < finales.length; i++) for (let j = i + 1; j < finales.length; j++) {
    const d = Math.hypot(finales[i].x - finales[j].x, finales[i].z - finales[j].z);
    if (d < minD) { minD = d; par = `${finales[i].id}–${finales[j].id}`; }
  }
  ctx.expect("4 · ningún par a < 1 m (ningún cuerpo dentro de otro)", finales.length === 4 && minD >= 1, `${par} a ${minD.toFixed(2)} m`);
  ctx.expect("5 · ninguno acaba dentro de un sólido", finales.length === 4 && finales.every((p) => !p.dentro), JSON.stringify(finales.filter((p) => p.dentro)));

  // 6 · Llegados, QUIETOS en el cable: 3 s sin moving=true y sin derivar.
  const desde = frames.length;
  const t6 = await ctx.page.evaluate(() => window.__nefan.reloj().sim);
  await ctx.waitFor("3 s de juego mirándolos", (t0) => (window.__nefan.reloj().sim > t0 + 3 ? true : null), { sim: 10 }, t6);
  const tras = frames.slice(desde);
  const andando = tras.reduce((a, fr) => a + fr.filter((x) => x.moving).length, 0);
  const deriva = {};
  for (const fr of tras) for (const x of fr) {
    const d = deriva[x.id] ?? (deriva[x.id] = { p0: x.pos, max: 0, estados: new Set() });
    d.max = Math.max(d.max, Math.hypot(x.pos.x - d.p0.x, x.pos.z - d.p0.z));
    d.estados.add(x.state);
  }
  const peor = Math.max(0, ...Object.values(deriva).map((d) => d.max));
  ctx.expect("6 · llegados, quietos en el cable: 3 s sin moving=true y sin derivar > 1 cm", tras.length > 0 && andando === 0 && peor < 0.01,
    `${tras.length} state_update · ${andando} NPC-frames andando · ` +
    Object.entries(deriva).map(([id, d]) => `${id} ${d.max.toFixed(3)} m [${[...d.estados].join(",")}]`).join(" · "));

  // Foto: el jugador a 8 m de la casa, mirando al corro.
  const cx = finales.reduce((a, p) => a + p.x, 0) / Math.max(1, finales.length);
  const cz = finales.reduce((a, p) => a + p.z, 0) / Math.max(1, finales.length);
  await ctx.page.evaluate(({ cx, cz, casa }) => {
    const n = window.__nefan;
    const dx = cx - casa.x, dz = cz - casa.z, l = Math.hypot(dx, dz) || 1;
    const p = { x: cx + (dx / l) * 7, z: cz + (dz / l) * 7 };
    n.setPlayerPos(p.x, p.z);
    n.setYaw(Math.atan2(cx - p.x, cz - p.z));
  }, { cx, cz, casa });
  const t = await ctx.page.evaluate(() => window.__nefan.reloj().sim);
  await ctx.waitFor("medio segundo con la cámara puesta", (t0) => (window.__nefan.reloj().sim > t0 + 0.5 ? true : null), { sim: 3 }, t);
  await ctx.shot("cuatro-en-la-casa");
}
