/** Handlers del hot loop: input, load_room, respawn y add_combatants. */

import { createCombatant } from "../../src/combat/combatant.js";
import { activateByPosition } from "./tile.js";
import { getEnemyStates, type BridgeContext, type ClientSocket } from "../context.js";
import type {
  InputMessage,
  AddCombatantsMessage,
  LoadRoomMessage,
  RespawnMessage,
  StateUpdateMessage,
} from "../../src/protocol/messages.js";

export async function handleInput(
  msg: InputMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Sim aún sin sembrar (title screen, o bridge recién reiniciado antes del
  // resume): responder aquí con playerHp 0 haría que el cliente matara al
  // player. Sin combatiente no hay nada que simular ni reportar.
  if (!ctx.sim.getCombatant("player")) return;
  const result = ctx.sim.tick(msg.delta, msg.inputs);

  const playerPos = msg.inputs.playerPosition;
  // Mantén store.player.pos al día: los position hints de los spawns
  // narrativos (dialogue.ts) y fireMapTriggers se resuelven contra él.
  ctx.store.dispatch("player_moved", { pos: [playerPos.x, playerPos.y, playerPos.z] });
  // Mundo continuo: el tile/place activos se deciden por POSICIÓN (gateado
  // por cambio de celda dentro de activateByPosition).
  await activateByPosition(ctx, playerPos.x, playerPos.z);

  ctx.send(ws, {
    type: "state_update",
    events: result.events,
    playerHp: ctx.sim.getCombatant("player")?.health ?? 0,
    enemies: getEnemyStates(ctx),
  });
}

export function handleLoadRoom(
  msg: LoadRoomMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  // Con sesión narrativa activa, cambiar de escena NO cura: se preserva el
  // HP del combatiente vivo (leído antes del reset). Sin sesión (rooms de
  // test legacy) se mantiene el arranque a tope de vida.
  const livePlayer = ctx.sim.getCombatant("player");
  const playerMaxHp = ctx.store.state.player.max_hp || 100;
  const inSession = ctx.narrative.session_id !== "" && livePlayer !== undefined;
  const playerHp = inSession ? livePlayer!.health : playerMaxHp;
  // Reset simulation for new room
  ctx.sim.reset();
  ctx.store.dispatch("player_respawned", { hp: playerHp, pos: [0, 0, 0] });
  ctx.sim.addCombatant(
    createCombatant(
      "player",
      playerHp,
      ctx.store.state.player.weapon_id,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
    ),
  );

  // Set room bounds for AI clamping
  if (msg.dimensions) {
    ctx.sim.setRoomBounds(msg.dimensions.width, msg.dimensions.depth);
  }

  // Add enemies from room data
  for (const enemy of msg.enemies) {
    const combatant = createCombatant(
      enemy.id,
      enemy.health,
      enemy.weaponId,
      enemy.position,
      { x: 0, y: 0, z: 1 }, // Default forward
    );
    ctx.sim.addCombatant(combatant, enemy.personality);
  }

  ctx.store.dispatch("room_changed", { room_id: msg.roomId });
  ctx.store.dispatch("enemies_projected", {
    enemies: msg.enemies.map((e) => ({
      id: e.id,
      pos: [e.position.x, e.position.y, e.position.z],
      hp: e.health,
      max_hp: e.health,
      weapon_id: e.weaponId,
      combat_state: "idle",
      alive: true,
    })),
  });

  console.log(`Bridge: room loaded '${msg.roomId}' with ${msg.enemies.length} enemies`);
  // Send state_update with the (possibly preserved) HP so the client syncs.
  // In-session, this is a scene TRANSITION, not a respawn: emitting the
  // player_respawned event would make the client run its respawn side-effects
  // (Godot teleports the player to the spawn point and refills HP, clobbering
  // a resume's restored position). Legacy no-session loads keep the event.
  const roomResponse: StateUpdateMessage = {
    type: "state_update",
    events: inSession ? [] : [{ type: "player_respawned", hp: playerHp }],
    playerHp: playerHp,
    enemies: getEnemyStates(ctx),
  };
  ctx.send(ws, roomResponse);
}

export function handleRespawn(msg: RespawnMessage, ws: ClientSocket, ctx: BridgeContext): void {
  const events = ctx.sim.respawn(msg.pos);
  const response: StateUpdateMessage = {
    type: "state_update",
    events,
    playerHp: ctx.sim.getCombatant("player")?.health ?? 100,
    enemies: getEnemyStates(ctx),
  };
  ctx.send(ws, response);
  console.log("Bridge: player respawned");
}

/** Alta ADITIVA de combatientes (enemigos de un tile recién cargado en el
 *  cliente). No resetea el sim ni toca bounds: los combatientes de otros
 *  tiles siguen vivos — el mundo es un plano continuo, no una arena. Ids ya
 *  presentes se ignoran (re-entrada a un tile). */
export function handleAddCombatants(
  msg: AddCombatantsMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  const projected = [...ctx.store.state.enemies];
  let added = 0;
  for (const enemy of msg.enemies) {
    if (ctx.sim.getCombatant(enemy.id)) continue;
    ctx.sim.addCombatant(
      createCombatant(enemy.id, enemy.health, enemy.weaponId, enemy.position, { x: 0, y: 0, z: 1 }),
      enemy.personality,
    );
    // Proyección al store (getEnemyStates itera store.enemies): CONCAT, no
    // reemplazo — los enemigos de otros tiles siguen vivos.
    if (!projected.some((p) => p.id === enemy.id)) {
      projected.push({
        id: enemy.id,
        pos: [enemy.position.x, enemy.position.y, enemy.position.z],
        hp: enemy.health,
        max_hp: enemy.health,
        weapon_id: enemy.weaponId,
        combat_state: "idle",
        alive: true,
      });
    }
    added++;
  }
  if (added > 0) {
    ctx.store.dispatch("enemies_projected", { enemies: projected });
    console.log(`Bridge: ${added} combatiente(s) añadidos (aditivo)`);
  }
  const response: StateUpdateMessage = {
    type: "state_update",
    events: [],
    playerHp: ctx.sim.getCombatant("player")?.health ?? 100,
    enemies: getEnemyStates(ctx),
  };
  ctx.send(ws, response);
}
