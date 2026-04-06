/** ScenarioRunner — orchestrates narrative beats, NPC behavior, and triggers. */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Vec3 } from "../types.js";
import type {
  GameDef,
  Beat,
  BeatAction,
  NpcUpdate,
  ScenarioUpdate,
} from "./scenario-types.js";
import { NpcController } from "./npc-controller.js";
import { ActionExecutor } from "./action-executor.js";
import { evaluateTrigger, type TriggerContext } from "./trigger-evaluator.js";
import { SpatialRegistry } from "./spatial-registry.js";
import { PlacementResolver } from "./placement-resolver.js";

export interface ScenarioTickResult {
  npcs: NpcUpdate[];
  scenarioUpdates: ScenarioUpdate[];
}

export class ScenarioRunner {
  private gameDef: GameDef | null = null;
  private gameDir = "";
  private premise = "";
  private beats = new Map<string, Beat>();
  private currentBeat: Beat | null = null;
  private actionIndex = 0;
  private beatElapsed = 0;
  private allActionsExecuted = false;

  private npcController = new NpcController();
  private spatialRegistry = new SpatialRegistry();
  private placementResolver = new PlacementResolver(this.spatialRegistry);
  private actionExecutor: ActionExecutor | null = null;

  // External state fed each tick
  private playerPosition: Vec3 = { x: 0, y: 0, z: 0 };
  private allEnemiesDead = true;
  private dialogueComplete = false;
  private exitEntered: string | null = null;

  // Pending scene change (consumed by ws-server to load scene JSON)
  private pendingSceneChange: Record<string, unknown> | null = null;
  private pendingEnemies: ScenarioUpdate["spawn_enemy"][] = [];

  /** Load a game definition from disk. Returns initial scene data (or null if generating async). */
  async loadGame(gamesDir: string, gameId: string): Promise<Record<string, unknown> | null> {
    this.gameDir = resolve(gamesDir, gameId);
    const gameJsonPath = resolve(this.gameDir, "game.json");
    const raw = readFileSync(gameJsonPath, "utf-8");
    this.gameDef = JSON.parse(raw) as GameDef;

    // Load premise if available
    try {
      const premisePath = resolve(this.gameDir, "premise.md");
      this.premise = readFileSync(premisePath, "utf-8");
    } catch {
      this.premise = "";
    }

    // Index beats
    this.beats.clear();
    for (const beat of this.gameDef.beats) {
      this.beats.set(beat.beat_id, beat);
    }

    // Init systems
    this.npcController.reset();
    this.spatialRegistry.reset();
    this.actionExecutor = new ActionExecutor(
      this.gameDef, this.npcController, this.spatialRegistry, this.placementResolver,
    );

    // Load or generate initial scene
    const initialSceneId = this.gameDef.initial_scene;
    const sceneData = await this.loadSceneData(initialSceneId);

    // Populate spatial registry from scene data
    if (sceneData) {
      const objects = sceneData.objects as Array<{ id: string; position: number[]; scale: number[]; category?: string }> | undefined;
      const npcs = sceneData.npcs as Array<{ id: string; position: number[]; scale?: number[] }> | undefined;
      this.spatialRegistry.loadFromRoomData(objects, npcs);
    }
    // Register player in the registry
    this.spatialRegistry.register({
      id: "player",
      position: { ...this.playerPosition },
      aabb: { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
      kind: "player",
    });

    // Start first beat
    const firstBeat = this.gameDef.beats[0];
    if (firstBeat) {
      this.startBeat(firstBeat);
    }

    console.log(
      `ScenarioRunner: loaded game '${this.gameDef.title}' with ${this.gameDef.beats.length} beats`,
    );

    return sceneData;
  }

  /** Main tick — call every frame from ws-server. */
  async tick(delta: number, playerPos: Vec3): Promise<ScenarioTickResult> {
    this.playerPosition = playerPos;
    const scenarioUpdates: ScenarioUpdate[] = [];

    if (!this.currentBeat || !this.actionExecutor) {
      this.npcController.tick(delta);
      return { npcs: this.npcController.getUpdates(), scenarioUpdates };
    }

    this.beatElapsed += delta;

    // Advance internal timers (wait, dialogue)
    const tickResult = this.actionExecutor.tick(delta);
    scenarioUpdates.push(...tickResult.updates);

    // Execute next actions if not blocking
    if (!this.actionExecutor.isBlocking() && !this.allActionsExecuted) {
      const actionUpdates = await this.executeNextActions();
      scenarioUpdates.push(...actionUpdates);
    }

    // Tick NPC movement
    this.npcController.tick(delta);

    // Sync NPC and player positions to spatial registry
    this.spatialRegistry.updatePosition("player", playerPos);
    for (const npcUpdate of this.npcController.getUpdates()) {
      if (npcUpdate.pos) {
        this.spatialRegistry.updatePosition(npcUpdate.id, { x: npcUpdate.pos.x, y: 0, z: npcUpdate.pos.z });
      }
    }

    // Check if we should advance to next beat
    if (this.allActionsExecuted && this.currentBeat.next_trigger) {
      const ctx: TriggerContext = {
        beatElapsed: this.beatElapsed,
        playerPosition: this.playerPosition,
        allEnemiesDead: this.allEnemiesDead,
        dialogueComplete: this.dialogueComplete,
        exitEntered: this.exitEntered,
        npcController: this.npcController,
      };

      if (evaluateTrigger(this.currentBeat.next_trigger, ctx)) {
        this.advanceToBeat(this.currentBeat.next);
        // Execute the new beat's immediate actions
        if (this.currentBeat && !this.actionExecutor.isBlocking()) {
          const newBeatUpdates = await this.executeNextActions();
          scenarioUpdates.push(...newBeatUpdates);
        }
      }
    }

    // If all actions executed and no next_trigger, beat is simply done (terminal beat)

    // Clear one-shot state
    this.exitEntered = null;
    this.dialogueComplete = false;

    return { npcs: this.npcController.getUpdates(), scenarioUpdates };
  }

  /** Execute actions from current position until a blocking action or end of list. */
  private async executeNextActions(): Promise<ScenarioUpdate[]> {
    const updates: ScenarioUpdate[] = [];
    if (!this.currentBeat || !this.actionExecutor) return updates;

    const actions = this.currentBeat.actions;
    while (this.actionIndex < actions.length) {
      const action = actions[this.actionIndex];
      this.actionIndex++;

      const result = this.actionExecutor.execute(action);
      updates.push(...result.updates);

      // Handle scene changes
      for (const u of result.updates) {
        if (u.change_scene) {
          const sceneId = (u.change_scene as { scene_id: string }).scene_id;
          const sceneData = await this.loadSceneData(sceneId);
          if (sceneData) {
            this.pendingSceneChange = sceneData;
            u.change_scene = sceneData;
          }
        }
        if (u.spawn_enemy) {
          this.pendingEnemies.push(u.spawn_enemy);
        }
      }

      // Handle jump from dialogue choice
      if (result.jumpToBeat) {
        this.advanceToBeat(result.jumpToBeat);
        return updates;
      }

      if (result.blocking) break;
    }

    if (this.actionIndex >= actions.length) {
      this.allActionsExecuted = true;
    }

    return updates;
  }

  private startBeat(beat: Beat): void {
    this.currentBeat = beat;
    this.actionIndex = 0;
    this.beatElapsed = 0;
    this.allActionsExecuted = false;
    this.actionExecutor?.reset();
    console.log(`ScenarioRunner: beat '${beat.beat_id}'`);
  }

  private advanceToBeat(beatId: string | undefined): void {
    if (!beatId) {
      this.currentBeat = null;
      console.log("ScenarioRunner: scenario complete");
      return;
    }

    const beat = this.beats.get(beatId);
    if (!beat) {
      console.warn(`ScenarioRunner: beat '${beatId}' not found`);
      this.currentBeat = null;
      return;
    }

    this.startBeat(beat);
  }

  /** Load scene JSON from disk or generate via ai_server. */
  private async loadSceneData(sceneId: string): Promise<Record<string, unknown> | null> {
    if (!this.gameDef) return null;
    const sceneDef = this.gameDef.scenes[sceneId];
    if (!sceneDef) {
      console.warn(`ScenarioRunner: scene '${sceneId}' not found in game def`);
      return null;
    }

    // Try to load from file first; only generate if file doesn't exist
    const scenePath = resolve(this.gameDir, sceneDef.file);
    try {
      const raw = readFileSync(scenePath, "utf-8");
      const fileData = JSON.parse(raw) as Record<string, unknown>;
      console.log(`ScenarioRunner: loaded scene '${sceneId}' from file`);
      return fileData;
    } catch {
      // File not found — try generation if flagged
    }

    if (sceneDef.generate) {
      const generated = await this.generateScene(sceneId, sceneDef.description ?? "");
      const objects = generated?.objects as unknown[] | undefined;
      if (generated && objects && objects.length > 0) return generated;
      console.log(`ScenarioRunner: generation returned empty/failed for '${sceneId}'`);
    }

    console.error(`ScenarioRunner: no scene data available for '${sceneId}'`);
    return null;
  }

  /** Generate a scene via ai_server HTTP endpoint. */
  private async generateScene(
    sceneId: string,
    sceneDescription: string,
  ): Promise<Record<string, unknown> | null> {
    const AI_SERVER = "http://localhost:8765";
    const payload = {
      premise: this.premise,
      setting: this.gameDef?.setting ?? {},
      scene_id: sceneId,
      scene_description: sceneDescription,
    };

    console.log(`ScenarioRunner: generating scene '${sceneId}' via ai_server...`);

    try {
      const res = await fetch(`${AI_SERVER}/generate_scene`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error(`ScenarioRunner: ai_server returned ${res.status}`);
        return null;
      }

      const data = (await res.json()) as Record<string, unknown>;
      console.log(
        `ScenarioRunner: scene '${sceneId}' generated (${(data.objects as unknown[])?.length ?? 0} objects)`,
      );
      return data;
    } catch (err) {
      console.error(`ScenarioRunner: failed to generate scene:`, err);
      return null;
    }
  }

  // ── External event handlers ──

  /** Player pressed E/Space to advance dialogue. */
  handleDialogueAdvanced(): void {
    this.actionExecutor?.onDialogueAdvanced();
    this.dialogueComplete = true;
  }

  /** Player picked a dialogue choice. */
  async handleDialogueChoice(choiceIndex: number): Promise<ScenarioUpdate[]> {
    if (!this.actionExecutor) return [];
    const jumpBeat = this.actionExecutor.onDialogueChoice(choiceIndex);
    if (jumpBeat) {
      this.advanceToBeat(jumpBeat);
      if (this.currentBeat) {
        return this.executeNextActions();
      }
    }
    return [];
  }

  /** Player entered an exit. */
  handleExitEntered(exitWall: string): void {
    this.exitEntered = exitWall;
  }

  /** Update enemy alive status. */
  setAllEnemiesDead(dead: boolean): void {
    this.allEnemiesDead = dead;
  }

  /** Drain pending enemies to add to GameSimulation. */
  drainPendingEnemies(): ScenarioUpdate["spawn_enemy"][] {
    const result = this.pendingEnemies.slice();
    this.pendingEnemies = [];
    return result;
  }

  /** Drain pending scene change. */
  drainPendingSceneChange(): Record<string, unknown> | null {
    const result = this.pendingSceneChange;
    this.pendingSceneChange = null;
    return result;
  }

  get isActive(): boolean {
    return this.gameDef !== null;
  }

  get currentBeatId(): string | null {
    return this.currentBeat?.beat_id ?? null;
  }
}
