/** Interprets beat actions and produces ScenarioUpdates + side effects. */

import type { BeatAction, ScenarioUpdate, GameDef, SpawnObjectData } from "./scenario-types.js";
import type { NpcController } from "./npc-controller.js";
import type { SpatialRegistry, AABB } from "./spatial-registry.js";
import type { PlacementResolver, PlacementStrategy } from "./placement-resolver.js";
import { BuildingGenerator, type BuildingRoom } from "./building-generator.js";

export interface ActionResult {
  /** Updates to send to Godot this tick. */
  updates: ScenarioUpdate[];
  /** If true, the executor is waiting (dialogue, wait timer) and should not advance. */
  blocking: boolean;
  /** If a dialogue_choice selected a specific beat, jump there. */
  jumpToBeat?: string;
}

const NPC_AABB: AABB = { halfX: 0.3, halfY: 0.9, halfZ: 0.3 };

export class ActionExecutor {
  private waitTimer = 0;
  private waitingForDialogue = false;
  private waitingForChoice = false;
  private dialogueQueue: Array<{ speaker: string; text: string }> = [];
  private choiceAction: { choices: string[]; choice_beats: string[] } | null = null;

  private buildingGenerator = new BuildingGenerator();
  private buildingRooms = new Map<string, BuildingRoom[]>();

  constructor(
    private gameDef: GameDef,
    private npcController: NpcController,
    private spatialRegistry?: SpatialRegistry,
    private placementResolver?: PlacementResolver,
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
          this.spatialRegistry?.register({
            id: action.npc_id,
            position: { x: action.position[0], y: action.position[1], z: action.position[2] },
            aabb: NPC_AABB,
            kind: "npc",
          });
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
        this.spatialRegistry?.unregister(action.npc_id);
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
        this.spatialRegistry?.register({
          id: action.enemy_id,
          position: { x: action.position[0], y: action.position[1], z: action.position[2] },
          aabb: NPC_AABB,
          kind: "enemy",
        });
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
        updates.push({ change_scene: { scene_id: action.scene_id } });
        return { updates, blocking: false };
      }

      case "wait": {
        this.waitTimer = action.duration;
        return { updates, blocking: true };
      }

      // ── World Toolkit Actions ──

      case "place_npc": {
        return this.executePlaceNpc(action, updates);
      }

      case "npc_approach": {
        return this.executeNpcApproach(action, updates);
      }

      case "place_object": {
        return this.executePlaceObject(action, updates);
      }

      case "generate_building": {
        return this.executeGenerateBuilding(action, updates);
      }

      case "place_object_in_building": {
        return this.executePlaceObjectInBuilding(action, updates);
      }

      default:
        return { updates, blocking: false };
    }
  }

  // ── World Toolkit Implementations ──

  private executePlaceNpc(
    action: Extract<BeatAction, { type: "place_npc" }>,
    updates: ScenarioUpdate[],
  ): ActionResult {
    const npcDef = this.gameDef.npcs[action.npc_id];
    if (!npcDef) return { updates, blocking: false };

    const defaultY = this.placementResolver?.getGroundY(0, 0) ?? 0;
    let position: [number, number, number] = [0, defaultY, 0];

    if (this.placementResolver && action.near) {
      const strategy: PlacementStrategy = {
        type: "near_entity",
        entityId: action.near,
        minDist: action.minDist,
        maxDist: action.maxDist,
      };
      const pos = this.placementResolver.resolve(strategy, NPC_AABB);
      if (pos) {
        position = [pos.x, pos.y, pos.z];
      }
    }

    this.npcController.spawnNpc(
      action.npc_id,
      action.npc_id,
      npcDef.name,
      npcDef.character_type,
      position,
      action.animation ?? "idle",
    );
    this.spatialRegistry?.register({
      id: action.npc_id,
      position: { x: position[0], y: 0, z: position[2] },
      aabb: NPC_AABB,
      kind: "npc",
    });
    updates.push({
      spawn_npc: {
        id: action.npc_id,
        name: npcDef.name,
        character_type: npcDef.character_type,
        position,
        animation: action.animation ?? "idle",
      },
    });

    return { updates, blocking: false };
  }

  private executeNpcApproach(
    action: Extract<BeatAction, { type: "npc_approach" }>,
    updates: ScenarioUpdate[],
  ): ActionResult {
    // Get target position — can be an NPC, object, enemy, or "player"
    let targetPos: { x: number; z: number } | null = null;

    // Try NPC controller first
    const npcPos = this.npcController.getNpcPosition(action.target_id);
    if (npcPos) {
      targetPos = npcPos;
    } else if (this.spatialRegistry) {
      const entity = this.spatialRegistry.get(action.target_id);
      if (entity) {
        targetPos = entity.position;
      }
    }

    if (!targetPos) return { updates, blocking: false };

    const sourcePos = this.npcController.getNpcPosition(action.npc_id);
    if (!sourcePos) return { updates, blocking: false };

    const stopDist = action.stop_distance ?? 1.5;
    const dx = targetPos.x - sourcePos.x;
    const dz = targetPos.z - sourcePos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= stopDist) return { updates, blocking: false };

    // Move to a point stop_distance away from target, on the line from source to target
    const ratio = (dist - stopDist) / dist;
    const tx = sourcePos.x + dx * ratio;
    const tz = sourcePos.z + dz * ratio;
    const ty = this.placementResolver?.getGroundY(tx, tz) ?? 0;
    const moveTarget: [number, number, number] = [tx, ty, tz];
    this.npcController.moveTo(action.npc_id, moveTarget, action.speed);

    return { updates, blocking: false };
  }

  private executePlaceObject(
    action: Extract<BeatAction, { type: "place_object" }>,
    updates: ScenarioUpdate[],
  ): ActionResult {
    const aabb: AABB = {
      halfX: action.scale[0] / 2,
      halfY: action.scale[1] / 2,
      halfZ: action.scale[2] / 2,
    };

    const defY = this.placementResolver?.getGroundY(0, 0) ?? 0;
    let position: [number, number, number] = [0, defY, 0];

    if (this.placementResolver) {
      const strategy: PlacementStrategy = action.near
        ? { type: "near_entity", entityId: action.near }
        : { type: "random_in_area", center: { x: 0, y: 0, z: 0 }, radius: 8 };
      const pos = this.placementResolver.resolve(strategy, aabb);
      if (pos) {
        position = [pos.x, pos.y, pos.z];
      }
    }

    this.spatialRegistry?.register({
      id: action.object_id,
      position: { x: position[0], y: position[1], z: position[2] },
      aabb,
      kind: "object",
    });

    const objData: SpawnObjectData = {
      id: action.object_id,
      mesh: action.mesh,
      position,
      scale: action.scale,
      category: action.category ?? "prop",
      description: action.description,
      interactive: action.interactive,
      texture_prompt: action.texture_prompt,
    };
    updates.push({ spawn_objects: [objData] });

    return { updates, blocking: false };
  }

  private executeGenerateBuilding(
    action: Extract<BeatAction, { type: "generate_building" }>,
    updates: ScenarioUpdate[],
  ): ActionResult {
    const building = this.buildingGenerator.generate({
      id: action.building_id,
      width: action.width,
      depth: action.depth,
      numRooms: action.num_rooms,
      wallHeight: action.wall_height,
      style: action.style,
      description: action.description,
    });

    // Determine world position
    let offX = 0;
    let offZ = 0;
    if (action.position) {
      offX = action.position[0];
      offZ = action.position[2];
    } else if (action.near && this.placementResolver) {
      const buildingAABB: AABB = { halfX: action.width / 2, halfY: 2, halfZ: action.depth / 2 };
      const pos = this.placementResolver.resolve(
        { type: "near_entity", entityId: action.near, minDist: action.width, maxDist: action.width * 2 },
        buildingAABB,
      );
      if (pos) {
        offX = pos.x;
        offZ = pos.z;
      }
    }

    // Offset all building objects and register them
    const spawnObjects: SpawnObjectData[] = building.objects.map(obj => {
      const worldPos: [number, number, number] = [
        obj.position[0] + offX,
        obj.position[1],
        obj.position[2] + offZ,
      ];
      this.spatialRegistry?.register({
        id: obj.id,
        position: { x: worldPos[0], y: worldPos[1], z: worldPos[2] },
        aabb: { halfX: obj.scale[0] / 2, halfY: obj.scale[1] / 2, halfZ: obj.scale[2] / 2 },
        kind: "building_wall",
        parentBuildingId: action.building_id,
      });
      return {
        id: obj.id,
        mesh: obj.mesh,
        position: worldPos,
        scale: obj.scale,
        category: obj.category,
        description: obj.description,
        texture_prompt: obj.texture_prompt,
      };
    });

    // Store room metadata (offset to world position)
    const worldRooms = building.rooms.map(r => ({
      ...r,
      center: { x: r.center.x + offX, y: r.center.y, z: r.center.z + offZ },
    }));
    this.buildingRooms.set(action.building_id, worldRooms);
    this.placementResolver?.setBuildingRooms(this.buildingRooms);

    updates.push({ spawn_objects: spawnObjects });

    return { updates, blocking: false };
  }

  private executePlaceObjectInBuilding(
    action: Extract<BeatAction, { type: "place_object_in_building" }>,
    updates: ScenarioUpdate[],
  ): ActionResult {
    if (!this.placementResolver) return { updates, blocking: false };

    const aabb: AABB = {
      halfX: action.scale[0] / 2,
      halfY: action.scale[1] / 2,
      halfZ: action.scale[2] / 2,
    };

    const pos = this.placementResolver.resolve(
      { type: "inside_room", buildingId: action.building_id, roomIndex: action.room_index ?? 0 },
      aabb,
    );
    if (!pos) return { updates, blocking: false };

    this.spatialRegistry?.register({
      id: action.object_id,
      position: pos,
      aabb,
      kind: "object",
      parentBuildingId: action.building_id,
    });

    const objData: SpawnObjectData = {
      id: action.object_id,
      mesh: action.mesh,
      position: [pos.x, pos.y, pos.z],
      scale: action.scale,
      category: action.category ?? "prop",
      description: action.description,
      interactive: action.interactive,
      texture_prompt: action.texture_prompt,
    };
    updates.push({ spawn_objects: [objData] });

    return { updates, blocking: false };
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

  /** Expose building rooms for external access. */
  getBuildingRooms(): Map<string, BuildingRoom[]> {
    return this.buildingRooms;
  }
}
