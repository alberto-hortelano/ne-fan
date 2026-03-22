/** State reducers — port of GameStore._apply() match arms.
 *  Pure functions that mutate state in place based on events. */

import type { GameState, EnemyState } from "../types.js";

export function applyReducer(
  state: GameState,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  switch (eventName) {
    case "player_moved":
      if (payload.pos) state.player.pos = payload.pos as number[];
      if (payload.velocity) state.player.velocity = payload.velocity as number[];
      break;

    case "camera_rotated":
      if (payload.yaw !== undefined) state.player.camera_yaw = payload.yaw as number;
      if (payload.pitch !== undefined) state.player.camera_pitch = payload.pitch as number;
      break;

    case "player_damaged":
      state.player.hp = (payload.new_hp as number) ?? state.player.hp;
      break;

    case "player_healed":
      state.player.hp = (payload.new_hp as number) ?? state.player.hp;
      break;

    case "player_died":
      state.player.hp = 0;
      state.player.combat_state = "dead";
      break;

    case "attack_started": {
      const attackerId = payload.attacker_id as string;
      const attackType = payload.type as string;
      if (attackerId === "player") {
        state.player.combat_state = "winding_up";
        state.player.attack_type = attackType;
      } else {
        updateEnemy(state.enemies, attackerId, "combat_state", "winding_up");
      }
      break;
    }

    case "attack_landed": {
      const targetId = payload.target_id as string;
      const newHp = payload.new_hp as number;
      if (targetId === "player") {
        state.player.hp = newHp;
      } else {
        updateEnemy(state.enemies, targetId, "hp", newHp);
      }
      break;
    }

    case "enemy_damaged":
      updateEnemy(state.enemies, payload.enemy_id as string, "hp", payload.new_hp as number);
      break;

    case "enemy_died":
      updateEnemy(state.enemies, payload.enemy_id as string, "alive", false);
      updateEnemy(state.enemies, payload.enemy_id as string, "hp", 0);
      break;

    case "combat_state_changed": {
      const entityId = payload.entity_id as string;
      const newState = payload.state as string;
      if (entityId === "player") {
        state.player.combat_state = newState;
      } else {
        updateEnemy(state.enemies, entityId, "combat_state", newState);
      }
      break;
    }

    case "room_changed":
      state.world.room_id = (payload.room_id as string) ?? "";
      state.world.room_data = (payload.room_data as Record<string, unknown>) ?? {};
      state.enemies = (payload.enemies as EnemyState[]) ?? [];
      break;

    case "room_visited":
      state.world.rooms_visited[payload.room_id as string] = payload.room_data;
      break;

    case "object_interacted":
      state.narrative.last_interaction = (payload.description as string) ?? "";
      break;

    case "npc_talked":
      state.narrative.last_dialogue = (payload.dialogue as string) ?? "";
      break;

    case "weapon_changed":
      state.player.weapon_id = (payload.weapon_id as string) ?? state.player.weapon_id;
      break;

    case "meta_update":
      for (const [key, value] of Object.entries(payload)) {
        (state.meta as Record<string, unknown>)[key] = value;
      }
      break;
  }
}

function updateEnemy(
  enemies: EnemyState[],
  enemyId: string,
  key: keyof EnemyState,
  value: unknown,
): void {
  const enemy = enemies.find((e) => e.id === enemyId);
  if (enemy) {
    (enemy as Record<string, unknown>)[key] = value;
  }
}
