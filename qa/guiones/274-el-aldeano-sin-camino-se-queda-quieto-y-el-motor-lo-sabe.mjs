/** EL ALDEANO SIN CAMINO: ¿SE QUEDA QUIETO DE VERDAD, LO SABE EL MOTOR, Y QUÉ PASA AL REANUDAR? (#618 — QA de la 2ª vuelta de BO)
 *
 *  POR QUÉ EXISTE. La 2ª vuelta de BO aplicó la decisión del usuario para el
 *  NPC que no encuentra camino («que el estado le llegue al motor y él
 *  decide»): se PARA, deja su meta en `data.suspended_goal` con
 *  `reason: "no_path"` y solo reintenta si cambia el mundo de su zona. Sus
 *  candados (`273`, `bridge-npc.test.ts`) lo miden en el sim. Esto lo mide en
 *  el JUEGO ENTERO, desde el arranque, por los canales del motor y en lo que
 *  viaja por el cable (`state_update.npcs`: `moving`, `forward`, `pos`), que es
 *  lo que decide si el cliente pinta la animación de andar.
 *
 *  El «sin camino» que se puede provocar en el tile servido sin tocar nada: un
 *  lugar en un tile SIN GENERAR. Para planificar, lo no generado es sólido;
 *  el tabernero anda hasta el borde y se rinde (`why: "zona-sin-generar"`).
 *
 *  LO QUE AFIRMA:
 *    1. el motor ancla el lugar en el tile (−1, 0) y da la directiva;
 *    2. la meta SUSPENDIDA con `no_path` la ve el motor por `entity_get`
 *       (`GET /entity/{id}`), y la línea de ambiente queda en el save (la que
 *       `serializeForLlm` manda en `ambient_events`). OJO: el State API
 *       declara `GET /session/{id}/llm_context` pero es PLANEADA: 404;
 *    3. el tabernero no sale del tile (se para en el borde, no en la arena);
 *    4. PARADO DE VERDAD, en el cable: 5 s de juego con `moving=false` en
 *       todos los `state_update`, sin moverse > 1 cm y sin girar > 1°;
 *    5. y en lo que pinta el cliente (`__nefan.npcs()` por frame): ≤ 1 cm;
 *    6. tras REANUDAR acaba otra vez parado con `no_path`. El sim NO guarda por
 *       sus eventos («el save llega con el siguiente save normal»), así que
 *       el save trae la posición y la directiva de antes de rendirse: el
 *       tabernero vuelve a andar hasta el borde y se rinde de nuevo. Dónde
 *       reaparece se registra en el log;
 *    7. REAPERTURA: el jugador genera el tile (−1, 0) (`request_tile`, motor
 *       falso, 0 €). Cambia la huella de la zona, el tabernero recupera su
 *       meta solo y entra andando en el tile nuevo.
 *  Dos capturas de 1,5 s de separación con el NPC parado.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D.
 */
import { nuevaPartida, comenzar, reanudar, recargarAlTitulo, esperarEnElStateApi, pedirYEsperarTile } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves", "fake-ai"];

const NPC = "barkeep";
const MPC = 0.5;
/** Cuánto se espera (pared) a que el motor vea el `no_path`: el tabernero
 *  cruza medio tile andando (~40 m a paso de aldeano). */
const ESPERA_NO_PATH_MS = 150_000;
const QUIETO_S = 5;

async function api(method, path, body) {
  const res = await fetch(`${URLS.state_api}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}

/** El `suspended_goal` del tabernero tal cual lo lee el motor con
 *  `entity_get` (`GET /entity/{id}`), o null. `GET /session/{id}/llm_context`
 *  NO sirve: es una ruta PLANEADA (`PLANNED_ROUTES`), contesta 404. */
const suspendidaDe = (rec) => rec?.data?.suspended_goal ?? null;

/** Lo que el cable dice del tabernero, frame a frame (`state_update.npcs`). */
function espiarElCable(ctx) {
  const frames = [];
  const enganchar = (ws) => ws.on("framereceived", (f) => {
    if (typeof f.payload !== "string" || !f.payload.includes("\"state_update\"")) return;
    let m;
    try {
      m = JSON.parse(f.payload);
    } catch {
      return;
    }
    const n = (m.npcs ?? []).find((x) => x.id === NPC);
    if (n) frames.push({ moving: n.moving, pos: n.pos, forward: n.forward, state: n.state });
  });
  ctx.page.on("websocket", enganchar);
  return frames;
}

/** `QUIETO_S` segundos de juego y lo que pasó en el cable y en el cliente. */
async function mirarloQuieto(ctx, frames) {
  const desde = frames.length;
  await ctx.page.evaluate(() => {
    window.__qa274 = { traza: [], on: true };
    const f = () => {
      if (!window.__qa274.on) return;
      const v = window.__nefan.npcs().find((x) => x.id === "barkeep");
      if (v) window.__qa274.traza.push({ x: v.pos.x, z: v.pos.z });
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const t = await ctx.page.evaluate(() => window.__nefan.reloj().sim);
  await ctx.waitFor(`${QUIETO_S} s de juego mirándolo`, (a) => (window.__nefan.reloj().sim > a.t + a.s ? true : null), { sim: QUIETO_S * 3 }, { t, s: QUIETO_S });
  const cliente = await ctx.page.evaluate(() => { window.__qa274.on = false; return window.__qa274.traza; });
  const cable = frames.slice(desde);
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const giro = (a, b) => {
    let x = Math.abs(Math.atan2(a.x, a.z) - Math.atan2(b.x, b.z));
    if (x > Math.PI) x = 2 * Math.PI - x;
    return (x * 180) / Math.PI;
  };
  return {
    nCable: cable.length,
    andando: cable.filter((f) => f.moving).length,
    movCable: cable.length ? Math.max(...cable.map((f) => d(f.pos, cable[0].pos))) : null,
    giroCable: cable.length ? Math.max(...cable.map((f) => giro(f.forward, cable[0].forward))) : null,
    estados: [...new Set(cable.map((f) => f.state))],
    nCliente: cliente.length,
    movCliente: cliente.length ? Math.max(...cliente.map((p) => d(p, cliente[0]))) : null,
    fin: cliente.at(-1) ?? null,
  };
}

export default async function (ctx) {
  const frames = espiarElCable(ctx);
  // El socket del juego se abre al cargar la página: se recarga para que el
  // espía lo vea nacer.
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);
  await ctx.waitFor("el tabernero está en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 60_000, NPC);
  const inicio = await ctx.page.evaluate((id) => ({ ...window.__nefan.npcs().find((n) => n.id === id).pos, rect: window.__nefan.scene.world_rect }), NPC);

  // ── 1 · Un lugar en el tile (−1, 0), que nadie ha generado ──────────────
  const destino = { x: inicio.rect.minX - 10, z: inicio.z };
  const rect = [Math.round((destino.x + 96) / MPC) - 1, Math.round((destino.z + 32) / MPC) - 1, 2, 2];
  const alta = await api("POST", "/map/place", { id: "qa274_mas_alla", kind: "landmark", parent_id: null, name: "Más allá del bosque (guion 274)", anchor: { tx: -1, ty: 0, rect } });
  const orden = await api("POST", `/npc/${NPC}/directive`, { directive: { type: "goto_place", target_place_id: "qa274_mas_alla" } });
  ctx.expect("1 · el motor ancla un lugar en un tile SIN GENERAR y da la directiva", alta.status === 200 && orden.status === 200, `${alta.status} · ${orden.status}`);

  // ── 2 · Llega al motor ──────────────────────────────────────────────────
  const sus = await esperarEnElStateApi(`/entity/${NPC}`, (rec) => {
    const x = suspendidaDe(rec);
    return x?.reason === "no_path" ? x : null;
  }, ESPERA_NO_PATH_MS);
  ctx.expect("2 · la meta suspendida con `no_path` la ve el motor (`entity_get` → GET /entity/{id})", sus !== null, JSON.stringify(sus));
  if (!sus) ctx.sinMedir("el tabernero no llegó a rendirse: sin `no_path` no hay NPC parado que mirar");
  ctx.log(`suspended_goal: ${JSON.stringify(sus)}`);

  // ── 3-5 · Parado de verdad ──────────────────────────────────────────────
  const donde = await ctx.page.evaluate((id) => window.__nefan.npcs().find((n) => n.id === id).pos, NPC);
  ctx.expect("3 · se para DENTRO del tile, en el borde (no sobre la «Zona sin generar»)", donde.x >= inicio.rect.minX,
    `(${donde.x.toFixed(2)}, ${donde.z.toFixed(2)}); borde oeste x = ${inicio.rect.minX}`);
  // Cámara de bench: el jugador a 4 m del NPC, dentro del tile, mirándolo.
  await ctx.page.evaluate((p) => {
    const n = window.__nefan;
    n.setPlayerPos(p.x + 4, p.z + 1.5);
    n.setYaw(Math.atan2(p.x - (p.x + 4), p.z - (p.z + 1.5)));
  }, donde);
  const q = await mirarloQuieto(ctx, frames);
  await ctx.shot("parado-a");
  const t2 = await ctx.page.evaluate(() => window.__nefan.reloj().sim);
  await ctx.waitFor("1,5 s de juego entre las dos fotos", (t0) => (window.__nefan.reloj().sim > t0 + 1.5 ? true : null), { sim: 5 }, t2);
  await ctx.shot("parado-b");
  ctx.log(`cable: ${q.nCable} state_update, estados ${q.estados.join(",")}`);
  ctx.expect(`4 · en el cable, ${QUIETO_S} s PARADO: moving=false, < 1 cm y < 1°`,
    q.nCable > 0 && q.andando === 0 && q.movCable < 0.01 && q.giroCable < 1,
    `${q.andando} de ${q.nCable} frames con moving=true · se movió ${q.movCable?.toFixed(3)} m · giró ${q.giroCable?.toFixed(2)}°`);
  ctx.expect("5 · y lo que pinta el cliente tampoco se mueve (< 1 cm)", q.nCliente > 0 && q.movCliente < 0.01,
    `${q.nCliente} frames · ${q.movCliente?.toFixed(3)} m`);

  // ── 6 · Reanudar ────────────────────────────────────────────────────────
  const vuelta = await reanudar(ctx, partida.sessionId);
  ctx.expect("6 · CONTROL: la partida se reanuda", vuelta !== null, JSON.stringify(vuelta));
  if (!vuelta) return;
  await ctx.waitFor("el tabernero vuelve a estar en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 60_000, NPC);
  const alVolver = await ctx.page.evaluate((id) => window.__nefan.npcs().find((n) => n.id === id).pos, NPC);
  const recAlVolver = await (await fetch(`${URLS.state_api}/entity/${NPC}`)).json();
  ctx.log(`al reanudar: tabernero en (${alVolver.x.toFixed(2)}, ${alVolver.z.toFixed(2)}) · directiva ${JSON.stringify(recAlVolver?.data?.directive ?? null)} · ` +
    `suspended ${JSON.stringify(recAlVolver?.data?.suspended_goal ?? null)} (el sim no guarda por sus eventos: el save es el del último guardado)`);
  const susTras = await esperarEnElStateApi(`/entity/${NPC}`, (rec) => (suspendidaDe(rec)?.reason === "no_path" ? suspendidaDe(rec) : null), ESPERA_NO_PATH_MS);
  ctx.expect("6 · tras reanudar, acaba otra vez PARADO con `no_path` y el motor lo ve", susTras !== null, JSON.stringify(susTras));
  const quietoTras = await mirarloQuieto(ctx, frames);
  ctx.expect("6 · …y otra vez parado de verdad en el cable", quietoTras.nCable > 0 && quietoTras.andando === 0 && quietoTras.movCable < 0.01,
    `${quietoTras.andando} de ${quietoTras.nCable} andando · ${quietoTras.movCable?.toFixed(3)} m`);

  // ── 7 · Se abre el camino: el jugador genera el tile (−1, 0) ─────────────
  // Es lo que cambia la HUELLA de la zona: un tile nuevo registrado. El
  // tabernero tiene que volver a por su meta sin que el motor diga nada.
  await pedirYEsperarTile(ctx, "tile_-1_0", -1, 0);
  const reabre = await esperarEnElStateApi(`/entity/${NPC}`, (rec) =>
    (rec?.data?.directive?.target_place_id === "qa274_mas_alla" && !rec?.data?.suspended_goal ? rec.data.directive : null), 30_000);
  ctx.expect("7 · al generarse el tile, el tabernero RECUPERA su meta solo (npc_path_reopened)", reabre !== null, JSON.stringify(reabre));
  const cruza = await ctx.expectEspera("7 · …y entra andando en el tile nuevo", true, (a) => {
    const v = window.__nefan.npcs().find((x) => x.id === a.id);
    return v && v.pos.x < a.borde - 1 ? { x: v.pos.x, z: v.pos.z } : null;
  }, { sim: 60, arg: { id: NPC, borde: inicio.rect.minX }, aserto: "7 · entra en el tile (−1, 0) en ≤ 60 s de juego" });
  ctx.log(`tras abrirse: ${JSON.stringify(cruza.ultimo ?? null)}`);
  await ctx.shot("tras-abrirse-el-camino");
}
