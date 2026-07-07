/** Enruta un ClientMessage ya parseado al handler correspondiente.
 *  Función pura respecto al transporte: testeable con un socket fake. */

import type { BridgeContext, ClientSocket } from "./context.js";
import type { ClientMessage } from "../src/protocol/messages.js";
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
  handleResumeSession,
  handleSaveSession,
  handleStartSession,
} from "./handlers/session.js";
import { handleDialogueChoice, handleInteractEntity } from "./handlers/dialogue.js";
import { handlePlayerCrossedFrontier, handlePlayerEnteredPlace } from "./handlers/scene.js";
import { handleMapSvgUpdate, handleRequestTile, handleTileAnalysis } from "./handlers/tile.js";

export async function routeMessage(
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
    case "save_session":
      await handleSaveSession(msg, ws, ctx);
      break;
    case "dialogue_choice":
      await handleDialogueChoice(msg, ctx);
      break;
    case "player_entered_place":
      await handlePlayerEnteredPlace(msg, ctx);
      break;
    case "player_crossed_frontier":
      await handlePlayerCrossedFrontier(msg, ctx);
      break;
    case "request_tile":
      await handleRequestTile(msg, ctx);
      break;
    case "tile_analysis":
      await handleTileAnalysis(msg, ctx);
      break;
    case "map_svg_update":
      await handleMapSvgUpdate(msg, ctx);
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
