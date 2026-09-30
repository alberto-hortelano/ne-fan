/** EL DESPERTAR: al morir el jugador en partida, el bridge le pregunta al motor
 *  DÓNDE despierta y qué pasa al despertar (#613, decisión del usuario
 *  2026-09-29: «Que decida el motor»).
 *
 *  Lo que es de core y aquí solo se ata:
 *   · la REGLA de qué despertar vale (`simulation/despertar.ts`), contra el
 *     mundo de esta partida (`mundoDelDespertar`) — la MISMA que responde el
 *     pre-flight del motor (State API `POST /despertar/validar`);
 *   · el CONTEXTO que ve el motor (`narrative/contexto-de-la-muerte.ts`);
 *   · levantar al jugador y soltarle (`GameSimulation.respawn(punto)`).
 *
 *  UNA petición en vuelo (`ctx.despertar.enVuelo`), lanzada desde tres sitios:
 *  la muerte en `handleInput`, entrar en una partida guardada con el jugador
 *  caído (`handleSessionEntered`) y la R del jugador tras un fallo
 *  (`handleRespawn`, que en partida es «reintentar»). La respuesta que llega
 *  tarde —otra sesión, otro `id`— se tira y se dice en el log.
 *
 *  SIN RESPALDO MUDO: motor caído, respuesta inválida, despertar que no vale o
 *  timeout acaban en `narrative_status{phase:"error", kind:"despertar"}`. El
 *  jugador sigue caído, lo ve en su velo y reintenta con R. La espera se
 *  anuncia con `phase:"generating"`. */

import { randomUUID } from "node:crypto";

import { contextoDeLaMuerte, type ContextoDeLaMuerte } from "../../src/narrative/contexto-de-la-muerte.js";
import type { LlmContext } from "../../src/narrative/types.js";
import { colocacionDeLosSpawns, dispatchConsequences } from "../../src/narrative/consequence-handler.js";
import { falloDelDespertarParaElJugador } from "../../src/protocol/status-motivo.js";
import {
  MARGEN_DEL_DESPERTAR_M,
  validarDespertar,
  type MundoDelDespertar,
} from "../../src/simulation/despertar.js";
import { worldToTile } from "../../src/scene/tile.js";
import { resolvePlaceTarget } from "../../src/world-map/place-target.js";
import type { DespertarValidarResponse } from "../../src/contracts/world-state.js";
import type { Wake } from "../../src/contract/model-io/schemas.js";
import type { StateUpdateMessage, SinDuenoDelSim } from "../../src/protocol/messages.js";
import type { ReportPlayerDeathResult } from "../../src/narrative/ai-client.js";
import { guardarOAvisar } from "../guardar.js";
import {
  aplicarCuraciones,
  getEnemyStates,
  getNpcStates,
  runPluginTick,
  sessionChangedError,
  type BridgeContext,
  type ClientSocket,
} from "../context.js";
import { estadoDelJugador } from "./simulation.js";
import { activateByPosition } from "./tile.js";

/** El mundo de ESTA partida visto por la regla del despertar. */
export function mundoDelDespertar(ctx: BridgeContext): MundoDelDespertar {
  const tileRealizado = (x: number, z: number): boolean => {
    const t = worldToTile(x, z);
    return ctx.narrative.hasTile(t.tx, t.ty);
  };
  return {
    resolverLugar: (placeId) => resolvePlaceTarget(ctx.narrative, placeId),
    lugaresValidos: () => lugaresDondeDespertar(ctx, tileRealizado).map((l) => l.place_id),
    tileRealizado,
    suelo: ctx.simCollision,
    hostiles: ctx.sim.hostilesVivos().map((h) => ({ id: h.id, casa: h.casa, radio: h.radio })),
    margen: MARGEN_DEL_DESPERTAR_M,
  };
}

/** Los lugares del mapa que dan un punto sobre un tile que existe. */
function lugaresDondeDespertar(
  ctx: BridgeContext,
  tileRealizado: (x: number, z: number) => boolean,
): Array<{ place_id: string; name: string; centro: { x: number; z: number } }> {
  const out: Array<{ place_id: string; name: string; centro: { x: number; z: number } }> = [];
  for (const place of Object.values(ctx.narrative.worldMap.map.places)) {
    const centro = resolvePlaceTarget(ctx.narrative, place.id);
    if (centro && tileRealizado(centro.x, centro.z)) out.push({ place_id: place.id, name: place.name, centro });
  }
  return out;
}

/** La respuesta del pre-flight del motor (State API). */
export function validarDespertarEnElBridge(ctx: BridgeContext, wake: Wake): DespertarValidarResponse {
  const r = validarDespertar(wake, mundoDelDespertar(ctx));
  return r.ok ? { ok: true, punto: r.punto } : { ok: false, motivo: r.motivo };
}

/** Nombre legible de una entidad del ledger (para el `asesino` y los hostiles). */
function nombreDe(ctx: BridgeContext, id: string): string {
  const e = ctx.narrative.entities.find((x) => x.id === id);
  const name = e?.data?.name;
  return typeof name === "string" && name.trim() ? name : id;
}

function contextoParaElMotor(ctx: BridgeContext): LlmContext & { muerte: ContextoDeLaMuerte } {
  const player = ctx.sim.getCombatant("player");
  const cayoEn = player ? { x: player.position.x, z: player.position.z } : { x: 0, z: 0 };
  const t = worldToTile(cayoEn.x, cayoEn.z);
  const tileRealizado = (x: number, z: number): boolean => {
    const k = worldToTile(x, z);
    return ctx.narrative.hasTile(k.tx, k.ty);
  };
  const asesinoId = ctx.sim.ultimoAtacanteDelJugador;
  const muerte = contextoDeLaMuerte({
    cayoEn,
    tile: ctx.narrative.hasTile(t.tx, t.ty) ? t : null,
    placeId: ctx.posTracking.cadena?.at(-1) ?? null,
    asesino: asesinoId ? { id: asesinoId, name: nombreDe(ctx, asesinoId) } : null,
    hostiles: ctx.sim.hostilesVivos().map((h) => ({
      id: h.id,
      name: nombreDe(ctx, h.id),
      pos: h.pos,
      casa: h.casa,
      radio: h.radio,
    })),
    lugares: lugaresDondeDespertar(ctx, tileRealizado),
    puntoSeguro: ctx.sim.puntoSeguroActual,
    margen: MARGEN_DEL_DESPERTAR_M,
  });
  return { ...ctx.narrative.serializeForLlm(ctx.activePlugins), muerte };
}

/** ¿Está el jugador de ESTA partida caído? */
export function jugadorCaido(ctx: BridgeContext): boolean {
  const p = ctx.sim.getCombatant("player");
  return p !== undefined && p.health <= 0;
}

const DECIDIENDO = "El mundo decide dónde despiertas…";

/** Un caído no habla, no interactúa ni viaja (#613, QA H3): el viaje por
 *  «Salidas» de un muerto guardaba la partida con 0 PV en otro sitio. Si el
 *  jugador de esta partida está caído, CONTESTA al socket que lo pidió
 *  (`kind:"despertar"`, con el `placeId` del viaje si lo hay: así cierra su
 *  espera) y devuelve `true`; el handler no corre. */
export function rechazarSiEstaCaido(
  ctx: BridgeContext,
  ws: ClientSocket,
  accion: string,
  placeId?: string,
): boolean {
  if (ctx.world.kind !== "session" || !jugadorCaido(ctx)) return false;
  console.warn(`Bridge: ${accion} rechazado — el jugador está caído`);
  ctx.enviarNarrativo(ws, {
    type: "narrative_status",
    phase: "error",
    kind: "despertar",
    message: `Estás caído: no puedes ${accion} hasta que despiertes.`,
    rechazo: true,
    ...(placeId ? { placeId } : {}),
  });
  return true;
}

/** Pide el despertar al motor. Si ya hay una petición en vuelo no lanza otra:
 *  vuelve a decir `generating` (a quien lo pidió), que es lo que el jugador
 *  tiene que ver. `ws` es el socket que conduce el mundo: a él va el frame con
 *  el punto. */
export function pedirDespertar(ctx: BridgeContext, ws: ClientSocket): void {
  if (ctx.despertar.enVuelo) {
    ctx.enviarNarrativo(ws, { type: "narrative_status", phase: "generating", kind: "despertar", message: DECIDIENDO });
    return;
  }
  const id = randomUUID();
  const sessionId = ctx.narrative.session_id;
  ctx.despertar.enVuelo = { id, ws };
  ctx.broadcastNarrative({ type: "narrative_status", phase: "generating", kind: "despertar", message: DECIDIENDO });
  const context = contextoParaElMotor(ctx);
  console.log(`Bridge: el jugador ha caído — se pregunta al motor dónde despierta (${id.slice(0, 8)})`);
  // `.catch` y no `await`: quien lo lanza (un input, un ack de sesión) no
  // espera al motor. Todo lo que pase dentro sale por `fallo`, nunca mudo.
  void ctx.aiClient
    .reportPlayerDeath({ eventId: id, context })
    .then((res) => alLlegarElDespertar(ctx, id, sessionId, res))
    .catch((err: unknown) => fallo(ctx, id, err));
}

function fallo(ctx: BridgeContext, id: string, err: unknown): void {
  if (ctx.despertar.enVuelo?.id === id) ctx.despertar.enVuelo = null;
  console.error(`Bridge: el despertar ${id.slice(0, 8)} falló:`, err);
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "error",
    kind: "despertar",
    ...falloDelDespertarParaElJugador(err),
    detalleTecnico: (err as Error)?.message ?? String(err),
  });
}

/** Lo que el jugador lee cuando el motor contestó y el juego no aceptó el
 *  sitio. El motivo técnico va a `detalleTecnico` y al log. */
const NO_VALE = "El mundo eligió un sitio donde no se puede despertar; pulsa R para que lo intente otra vez.";
/** Y cuando el sitio vale pero lo que el mundo quería poner a tu lado no cabe
 *  sin pisarte ni salirse del suelo. */
const NO_CABE =
  "Lo que el mundo quería poner a tu alrededor al despertar no cabe ahí; pulsa R para que lo intente otra vez.";

export async function alLlegarElDespertar(
  ctx: BridgeContext,
  id: string,
  sessionId: string,
  res: ReportPlayerDeathResult,
): Promise<void> {
  const cambio = sessionChangedError(ctx, sessionId);
  if (cambio) {
    console.warn(`Bridge: despertar ${id.slice(0, 8)} descartado — ${cambio}`);
    return;
  }
  const enVuelo = ctx.despertar.enVuelo;
  if (enVuelo?.id !== id) {
    console.warn(`Bridge: despertar ${id.slice(0, 8)} descartado — ya no es la petición en vuelo`);
    return;
  }
  ctx.despertar.enVuelo = null;
  if (!res.ok) {
    fallo(ctx, id, new Error(res.error));
    return;
  }
  if (!jugadorCaido(ctx)) {
    console.warn(`Bridge: despertar ${id.slice(0, 8)} descartado — el jugador ya está en pie`);
    return;
  }
  // La puerta que MANDA: el mundo pudo cambiar mientras el motor pensaba.
  const v = validarDespertar(res.resolucion.wake, mundoDelDespertar(ctx));
  if (!v.ok) {
    console.error(`Bridge: el despertar ${id.slice(0, 8)} no vale: ${v.motivo}`);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "despertar",
      message: NO_VALE,
      detalleTecnico: v.motivo,
    });
    return;
  }
  // Lo que el motor manda aparecer se coloca ANTES de levantar al jugador
  // (tanda CB, QA H-2): si no cabe alrededor del sitio elegido, el despacho
  // lanzaría después de `sim.respawn` y el jugador quedaría en pie en el sim,
  // sin `state_update` y con el velo pidiendo R. Así se queda caído y R vale.
  // `respawn` pone al jugador EXACTAMENTE en `v.punto`, así que la cuenta es
  // la misma que hará `dispatchConsequences`.
  const colocacion = colocacionDeLosSpawns(ctx.narrative, res.resolucion.consequences, {
    playerPosition: v.punto,
    playerForward: { x: 0, y: 0, z: -1 },
  });
  if (!colocacion.ok) {
    console.error(`Bridge: el despertar ${id.slice(0, 8)} no cabe: ${colocacion.error}`);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "despertar",
      message: NO_CABE,
      detalleTecnico: colocacion.error,
    });
    return;
  }
  const { events, punto } = ctx.sim.respawn(v.punto);
  const eventId = `despertar_${id.slice(0, 8)}`;
  const dispatched = dispatchConsequences(ctx.narrative, eventId, res.resolucion.consequences, {
    playerPosition: punto,
    playerForward: { x: 0, y: 0, z: -1 },
  });
  const pluginFx = runPluginTick(ctx, eventId, dispatched.pluginEvents);
  aplicarCuraciones(ctx, eventId, dispatched.curaciones);
  // El tile del sitio pasa a ser el activo, con sus triggers: despertar en un
  // lugar es entrar en él.
  await activateByPosition(ctx, punto.x, punto.z);
  await guardarOAvisar(
    ctx,
    "el despertar del jugador",
    "Si reanudas, podrías volver a estar caído donde caíste.",
  );
  const player = ctx.sim.getCombatant("player");
  if (player && ctx.world.canDrive(enVuelo.ws)) {
    const frame: SinDuenoDelSim<StateUpdateMessage> = {
      type: "state_update",
      events,
      playerHp: player.health,
      ...estadoDelJugador(ctx),
      enemies: getEnemyStates(ctx),
      npcs: getNpcStates(ctx),
      reaparicion: punto,
      miradaAlDespertar: v.yaw,
    };
    ctx.enviarEstado(enVuelo.ws, frame);
  } else {
    console.warn(`Bridge: despertar ${id.slice(0, 8)} aplicado, pero su socket ya no conduce el mundo`);
  }
  console.log(`Bridge: el jugador despierta en (${punto.x.toFixed(2)}, ${punto.z.toFixed(2)})`);
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId,
    consequences: res.resolucion.consequences,
    effects: [...dispatched.effects, ...pluginFx],
  });
}
