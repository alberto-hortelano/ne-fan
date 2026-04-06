/** Evaluates trigger conditions for beat advancement. */

import type { Vec3 } from "../types.js";
import type { Trigger } from "./scenario-types.js";
import type { NpcController } from "./npc-controller.js";

export interface TriggerContext {
  /** Seconds elapsed since the current beat started. */
  beatElapsed: number;
  /** Player world position. */
  playerPosition: Vec3;
  /** True if all enemies in the current room are dead. */
  allEnemiesDead: boolean;
  /** True if the current dialogue sequence is finished. */
  dialogueComplete: boolean;
  /** The wall the player exited through, if any (set by scenario_event). */
  exitEntered: string | null;
  /** Reference to NPC controller for proximity checks. */
  npcController: NpcController;
}

export function evaluateTrigger(
  trigger: Trigger,
  ctx: TriggerContext,
): boolean {
  switch (trigger.type) {
    case "timer":
      return ctx.beatElapsed >= trigger.delay;

    case "exit":
      if (!ctx.exitEntered) return false;
      if (trigger.exit_wall) return ctx.exitEntered === trigger.exit_wall;
      return true;

    case "enemies_defeated":
      return ctx.allEnemiesDead;

    case "dialogue_complete":
      return ctx.dialogueComplete;

    case "player_near": {
      const npcPos = ctx.npcController.getNpcPosition(trigger.target_id);
      if (!npcPos) return false;
      const dx = ctx.playerPosition.x - npcPos.x;
      const dz = ctx.playerPosition.z - npcPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist <= trigger.distance;
    }

    default:
      return false;
  }
}
