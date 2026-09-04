/** Enruta un ClientMessage ya parseado al handler correspondiente.
 *  Función pura respecto al transporte: testeable con un socket fake.
 *
 *  Y desde 2026-09-01, NUNCA rechaza: un handler que revienta se contesta al
 *  cliente por el canal que ese mensaje ya tiene (frame con `requestId` o
 *  `narrative_status: error`), en vez de morir como unhandled rejection del
 *  proceso. Antes cualquier throw no capturado acababa en un `console.warn`
 *  del servidor y el cliente NO recibía nada: 30 s de timeout para los
 *  mensajes con requestId, espera INFINITA para los fire-and-forget (el modal
 *  de diálogo colgado para siempre). */

import {
  motivoDeSesionParaElJugador,
  motivoParaElJugador,
} from "../src/protocol/status-motivo.js";
import type { BridgeContext, ClientSocket, SinSello } from "./context.js";
import type {
  ClientMessage,
  NarrativeStatusDeSesion,
  SinSelloDeSesion,
} from "../src/protocol/messages.js";
import {
  handleInput,
  handleLoadRoom,
  handleRespawn,
  handleAddCombatants,
} from "./handlers/simulation.js";
import {
  handleCreateGame,
  handleDeleteSession,
  handleListGames,
  handleListSessions,
  handleSetRenderMode,
  handleResumeSession,
  handleSessionEntered,
  handleStartSession,
} from "./handlers/session.js";
import { handleGenerateGame } from "./handlers/game-gen.js";
import {
  handleGetWorldSnapshot,
  handleRecordStyleApplication,
} from "./handlers/style-apply.js";
import { handleDialogueChoice, handleInteractEntity } from "./handlers/dialogue.js";
import { handlePlayerEnteredPlace } from "./handlers/scene.js";
import { handleRequestTile } from "./handlers/tile.js";

export async function routeMessage(
  msg: ClientMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  try {
    await despachar(msg, ws, ctx);
  } catch (err) {
    // La red POR MENSAJE. El volcado técnico se queda aquí, que es donde se
    // depura; lo que viaja es lo que ese cliente ya sabe pintar.
    console.error(`Bridge: el handler de '${msg.type}' reventó:`, err);
    const respuesta = respuestaAlFalloDeHandler(msg, err);
    if (respuesta.a === "peticion") ctx.send(ws, respuesta.frame);
    else ctx.broadcastNarrative(respuesta.frame);
  }
}

async function despachar(
  msg: ClientMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  switch (msg.type) {
    case "input":
      await handleInput(msg, ws, ctx);
      break;
    case "load_room":
      handleLoadRoom(msg, ws, ctx);
      break;
    case "respawn":
      handleRespawn(msg, ws, ctx);
      break;
    case "add_combatants":
      handleAddCombatants(msg, ws, ctx);
      break;
    case "ping":
      ctx.send(ws, { type: "pong" });
      break;
    case "list_games":
      handleListGames(msg, ws, ctx);
      break;
    case "create_game":
      await handleCreateGame(msg, ws, ctx);
      break;
    case "generate_game":
      await handleGenerateGame(msg, ws, ctx);
      break;
    case "get_world_snapshot":
      handleGetWorldSnapshot(msg, ws, ctx);
      break;
    case "record_style_application":
      handleRecordStyleApplication(msg, ws, ctx);
      break;
    case "list_sessions":
      await handleListSessions(msg, ws, ctx);
      break;
    case "start_session":
      await handleStartSession(msg, ws, ctx);
      break;
    case "resume_session":
      await handleResumeSession(msg, ws, ctx);
      break;
    case "delete_session":
      await handleDeleteSession(msg, ws, ctx);
      break;
    case "session_entered":
      await handleSessionEntered(msg, ctx);
      break;
    case "set_render_mode":
      await handleSetRenderMode(msg, ws, ctx);
      break;
    case "dialogue_choice":
      await handleDialogueChoice(msg, ctx);
      break;
    case "player_entered_place":
      await handlePlayerEnteredPlace(msg, ctx);
      break;
    case "request_tile":
      await handleRequestTile(msg, ctx);
      break;
    case "interact_entity":
      await handleInteractEntity(msg, ctx);
      break;
    default: {
      // Exhaustividad: si el union crece sin case nuevo, esto deja de compilar.
      const unknown: never = msg;
      console.warn(`Bridge: unhandled message type:`, (unknown as { type?: string }).type);
    }
  }
}

/** Lo que debe recibir el cliente cuando el handler de `msg` revienta:
 *  o el frame de respuesta que su `requestId` está esperando, o la difusión
 *  de `narrative_status: error` que un fire-and-forget ya sabe pintar. */
export type RespuestaAlFallo =
  | { a: "peticion"; frame: SinSello }
  | { a: "difusion"; frame: SinSelloDeSesion<NarrativeStatusDeSesion> };

/** Pura y exhaustiva sobre `ClientMessage`: un mensaje nuevo sin decisión de
 *  respuesta al fallo NO COMPILA — así la red por mensaje no se queda corta en
 *  silencio cuando crezca el protocolo. El `error` de los frames con requestId
 *  lleva el motivo técnico (el cliente lo traduce con
 *  `motivoDeSesionParaElJugador` y guarda el crudo en su error-log); el de las
 *  difusiones de GENERACIÓN va ya traducido con `motivoParaElJugador`, como
 *  los emisores de tile.ts y scene.ts.
 *
 *  La difusión que NO es de generación usa el otro traductor, y no es un
 *  detalle de estilo (#352): un `dialogue_choice` o un `respawn` que revienta
 *  no ha pasado por el motor narrativo, así que `motivoParaElJugador` —cuyo
 *  genérico es «El motor narrativo no pudo construirlo»— le contaba al jugador
 *  una causa inventada, y encima bajo un titular que decía lo mismo. El
 *  genérico de `motivoDeSesionParaElJugador` («El servidor del juego no pudo
 *  completarlo; inténtalo de nuevo») es exactamente el hecho. */
export function respuestaAlFalloDeHandler(msg: ClientMessage, err: unknown): RespuestaAlFallo {
  const raw = (err as Error)?.message ?? String(err);
  const peticion = (frame: SinSello): RespuestaAlFallo => ({ a: "peticion", frame });
  switch (msg.type) {
    case "list_games":
      return peticion({
        type: "games_listed",
        requestId: msg.requestId,
        error: `list_games_failed: ${raw}`,
        games: [],
        styles: [],
      });
    case "list_sessions":
      return peticion({
        type: "sessions_listed",
        requestId: msg.requestId,
        error: `list_sessions_failed: ${raw}`,
        sessions: [],
      });
    case "create_game":
      return peticion({
        type: "game_created",
        requestId: msg.requestId,
        ok: false,
        error: `create_game_failed: ${raw}`,
      });
    case "generate_game":
      return peticion({
        type: "game_generated",
        requestId: msg.requestId,
        ok: false,
        error: `generate_game_failed: ${raw}`,
      });
    case "get_world_snapshot":
      return peticion({
        type: "world_snapshot",
        requestId: msg.requestId,
        ok: false,
        error: `get_world_snapshot_failed: ${raw}`,
      });
    case "record_style_application":
      return peticion({
        type: "style_application_recorded",
        requestId: msg.requestId,
        ok: false,
        error: `record_style_application_failed: ${raw}`,
      });
    case "start_session":
    case "resume_session":
      return peticion({
        type: "session_started",
        requestId: msg.requestId,
        ok: false,
        error: `${msg.type}_failed: ${raw}`,
      });
    case "delete_session":
      // CORRIGE lo que esta misma línea decía hasta hoy (#370, `4a9c5e1`):
      // «`session_deleted` no tiene campo error: `ok:false` es la respuesta
      // honesta y el motivo queda en el log». No lo era. El log es del
      // servidor y quien pulsó Borrar mira la pantalla; y aquel `ok:false`
      // colapsaba además dos causas distintas —«no estaba» y «no se pudo»—
      // que `SessionStorage.delete` sí distingue. Desde #365 el frame es una
      // unión discriminada y `failed` no compila sin motivo.
      return peticion({
        type: "session_deleted",
        requestId: msg.requestId,
        outcome: "failed",
        error: `delete_session_failed: ${raw}`,
      });
    case "set_render_mode":
      return peticion({
        type: "render_mode_set",
        requestId: msg.requestId,
        ok: false,
        error: `set_render_mode_failed: ${raw}`,
      });
    // Fire-and-forget: nadie espera un frame, así que el canal es la difusión
    // de error — con los campos que permiten al cliente ATRIBUIRLA: el tile
    // libera su key de `frontier.requested` (y el velo), el viaje cierra su
    // «Viajando…» por `placeId`.
    case "request_tile":
      return {
        a: "difusion",
        frame: {
          type: "narrative_status",
          phase: "error",
          kind: "tile",
          tile: { tx: msg.tx, ty: msg.ty },
          edge: msg.edge,
          message: motivoParaElJugador(err),
        },
      };
    case "player_entered_place":
      return {
        a: "difusion",
        frame: {
          type: "narrative_status",
          phase: "error",
          kind: "scene",
          placeId: msg.placeId,
          message: motivoParaElJugador(err),
        },
      };
    case "dialogue_choice":
    case "interact_entity":
    case "input":
    case "load_room":
    case "respawn":
    case "add_combatants":
    case "ping":
    case "session_entered":
      return {
        a: "difusion",
        frame: {
          type: "narrative_status",
          phase: "error",
          // `action` y no `consequences`: lo que ha reventado es el handler de
          // algo que el jugador PIDIÓ (hablar, pegar, interactuar, reaparecer).
          // El motor narrativo puede no haber intervenido siquiera.
          kind: "action",
          message: motivoDeSesionParaElJugador(err),
        },
      };
  }
  // Exhaustividad: un mensaje nuevo sin decisión de respuesta no compila.
  const nunca: never = msg;
  throw new Error(`sin respuesta de fallo para ${(nunca as { type?: string }).type}`);
}
