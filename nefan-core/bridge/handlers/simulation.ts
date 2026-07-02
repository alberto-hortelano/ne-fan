/** Handlers del hot loop: input, load_room, respawn y scenario_event. */

import { createCombatant } from "../../src/combat/combatant.js";
import { getEnemyStates, type BridgeContext, type ClientSocket } from "../context.js";
import type {
  InputMessage,
  LoadRoomMessage,
  ScenarioEventMessage,
  StateUpdateMessage,
} from "../../src/protocol/messages.js";
import type { ScenarioUpdate } from "../../src/scenario/scenario-types.js";

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

  // Tick scenario runner
  const playerPos = msg.inputs.playerPosition;
  // Mantén store.player.pos al día: los position hints de los spawns
  // narrativos (dialogue.ts) y fireMapTriggers se resuelven contra él.
  ctx.store.dispatch("player_moved", { pos: [playerPos.x, playerPos.y, playerPos.z] });
  const scenarioResult = ctx.scenario.isActive
    ? await ctx.scenario.tick(msg.delta, playerPos)
    : null;

  // Process pending enemies from scenario
  if (ctx.scenario.isActive) {
    const pendingEnemies = ctx.scenario.drainPendingEnemies();
    for (const enemy of pendingEnemies) {
      if (enemy) {
        const combatant = createCombatant(
          enemy.id,
          enemy.combat.health,
          enemy.combat.weapon_id,
          { x: enemy.position[0], y: enemy.position[1], z: enemy.position[2] },
          { x: 0, y: 0, z: 1 },
        );
        ctx.sim.addCombatant(combatant, enemy.combat.personality);
        ctx.store.dispatch("enemies_projected", {
          enemies: [
            ...ctx.store.state.enemies,
            {
              id: enemy.id,
              pos: enemy.position,
              hp: enemy.combat.health,
              max_hp: enemy.combat.health,
              weapon_id: enemy.combat.weapon_id,
              combat_state: "idle",
              alive: true,
            },
          ],
        });
      }
    }

    // Update enemy alive status for trigger evaluation
    const anyAlive = ctx.store.state.enemies.some((e) => e.alive);
    ctx.scenario.setAllEnemiesDead(!anyAlive || ctx.store.state.enemies.length === 0);
  }

  // Send one state_update per scenario update to avoid Object.assign overwriting
  const playerHpNow = ctx.sim.getCombatant("player")?.health ?? 0;
  const enemyStates = getEnemyStates(ctx);
  const npcStates = scenarioResult?.npcs;

  if (scenarioResult && scenarioResult.scenarioUpdates.length > 0) {
    // First message includes combat events + first scenario update
    const firstUpdate = scenarioResult.scenarioUpdates[0];
    ctx.send(ws, {
      type: "state_update",
      events: result.events,
      playerHp: playerHpNow,
      enemies: enemyStates,
      npcs: npcStates,
      scenario: firstUpdate,
    });

    // Remaining scenario updates sent as separate messages
    for (let i = 1; i < scenarioResult.scenarioUpdates.length; i++) {
      ctx.send(ws, {
        type: "state_update",
        events: [],
        playerHp: playerHpNow,
        enemies: enemyStates,
        npcs: npcStates,
        scenario: scenarioResult.scenarioUpdates[i],
      });
    }
  } else {
    ctx.send(ws, {
      type: "state_update",
      events: result.events,
      playerHp: playerHpNow,
      enemies: enemyStates,
      npcs: npcStates,
    });
  }
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

export function handleRespawn(ws: ClientSocket, ctx: BridgeContext): void {
  const events = ctx.sim.respawn();
  const response: StateUpdateMessage = {
    type: "state_update",
    events,
    playerHp: ctx.sim.getCombatant("player")?.health ?? 100,
    enemies: getEnemyStates(ctx),
  };
  ctx.send(ws, response);
  console.log("Bridge: player respawned");
}

export async function handleScenarioEvent(
  msg: ScenarioEventMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const updates: ScenarioUpdate[] = [];
  switch (msg.event) {
    case "dialogue_advanced":
      ctx.scenario.handleDialogueAdvanced();
      break;
    case "dialogue_choice":
      if (msg.data?.choiceIndex !== undefined) {
        const choiceUpdates = await ctx.scenario.handleDialogueChoice(msg.data.choiceIndex);
        updates.push(...choiceUpdates);
      }
      break;
    case "exit_entered":
      if (msg.data?.exitWall) {
        ctx.scenario.handleExitEntered(msg.data.exitWall);
      }
      break;
  }
  if (updates.length > 0) {
    for (const u of updates) {
      const response: StateUpdateMessage = {
        type: "state_update",
        events: [],
        playerHp: ctx.sim.getCombatant("player")?.health ?? 0,
        enemies: getEnemyStates(ctx),
        scenario: u,
      };
      ctx.send(ws, response);
    }
  }
}
