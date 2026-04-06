/** Interprets beat actions and produces ScenarioUpdates + side effects. */

import type { BeatAction, ScenarioUpdate, GameDef } from "./scenario-types.js";
import type { NpcController } from "./npc-controller.js";

export interface ActionResult {
  /** Updates to send to Godot this tick. */
  updates: ScenarioUpdate[];
  /** If true, the executor is waiting (dialogue, wait timer) and should not advance. */
  blocking: boolean;
  /** If a dialogue_choice selected a specific beat, jump there. */
  jumpToBeat?: string;
}

export class ActionExecutor {
  private waitTimer = 0;
  private waitingForDialogue = false;
  private waitingForChoice = false;
  private dialogueQueue: Array<{ speaker: string; text: string }> = [];
  private choiceAction: { choices: string[]; choice_beats: string[] } | null = null;

  constructor(
    private gameDef: GameDef,
    private npcController: NpcController,
  ) {}

  reset(): void {
    this.waitTimer = 0;
    this.waitingForDialogue = false;
    this.waitingForChoice = false;
    this.dialogueQueue = [];
    this.choiceAction = null;
  }

  /** Returns true if the executor is currently blocking on a wait/dialogue. */
  isBlocking(): boolean {
    return this.waitTimer > 0 || this.waitingForDialogue || this.waitingForChoice;
  }

  /** Advance internal timers. Returns updates if a wait completes or dialogue should show. */
  tick(delta: number): ActionResult {
    const updates: ScenarioUpdate[] = [];

    if (this.waitTimer > 0) {
      this.waitTimer -= delta;
      if (this.waitTimer <= 0) {
        this.waitTimer = 0;
        return { updates, blocking: false };
      }
      return { updates, blocking: true };
    }

    return { updates, blocking: this.waitingForDialogue || this.waitingForChoice };
  }

  /** Execute a single action. Returns updates for Godot. */
  execute(action: BeatAction): ActionResult {
    const updates: ScenarioUpdate[] = [];

    switch (action.type) {
      case "spawn_npc": {
        const npcDef = this.gameDef.npcs[action.npc_id];
        if (npcDef) {
          this.npcController.spawnNpc(
            action.npc_id,
            action.npc_id,
            npcDef.name,
            npcDef.character_type,
            action.position,
            action.animation ?? "idle",
          );
          updates.push({
            spawn_npc: {
              id: action.npc_id,
              name: npcDef.name,
              character_type: npcDef.character_type,
              position: action.position,
              animation: action.animation ?? "idle",
            },
          });
        }
        return { updates, blocking: false };
      }

      case "despawn_npc": {
        this.npcController.despawnNpc(action.npc_id);
        updates.push({ despawn_npc: action.npc_id });
        return { updates, blocking: false };
      }

      case "npc_move": {
        this.npcController.moveTo(action.npc_id, action.target, action.speed);
        return { updates, blocking: false };
      }

      case "npc_animation": {
        this.npcController.setAnimation(action.npc_id, action.animation);
        return { updates, blocking: false };
      }

      case "spawn_enemy": {
        updates.push({
          spawn_enemy: {
            id: action.enemy_id,
            character_type: action.character_type,
            position: action.position,
            combat: action.combat,
          },
        });
        return { updates, blocking: false };
      }

      case "dialogue": {
        this.waitingForDialogue = true;
        updates.push({
          dialogue: { speaker: action.speaker, text: action.text },
        });
        return { updates, blocking: true };
      }

      case "dialogue_choice": {
        this.waitingForChoice = true;
        this.choiceAction = {
          choices: action.choices,
          choice_beats: action.choice_beats,
        };
        updates.push({
          dialogue: {
            speaker: action.speaker ?? "",
            text: action.text,
            choices: action.choices,
          },
        });
        return { updates, blocking: true };
      }

      case "set_objective": {
        updates.push({ objective: action.text });
        return { updates, blocking: false };
      }

      case "give_weapon": {
        updates.push({ give_weapon: action.weapon_id });
        return { updates, blocking: false };
      }

      case "change_scene": {
        // The ScenarioRunner handles scene loading; we just signal it.
        updates.push({ change_scene: { scene_id: action.scene_id } });
        return { updates, blocking: false };
      }

      case "wait": {
        this.waitTimer = action.duration;
        return { updates, blocking: true };
      }

      default:
        return { updates, blocking: false };
    }
  }

  /** Called when the player advances a dialogue (presses E/Space). */
  onDialogueAdvanced(): void {
    this.waitingForDialogue = false;
  }

  /** Called when the player picks a dialogue choice. Returns beat to jump to, if any. */
  onDialogueChoice(choiceIndex: number): string | undefined {
    if (!this.choiceAction) return undefined;
    this.waitingForChoice = false;
    const beat = this.choiceAction.choice_beats[choiceIndex];
    this.choiceAction = null;
    return beat;
  }

  get isWaitingForDialogue(): boolean {
    return this.waitingForDialogue;
  }

  get isWaitingForChoice(): boolean {
    return this.waitingForChoice;
  }
}
