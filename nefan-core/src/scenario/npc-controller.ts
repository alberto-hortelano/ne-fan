/** Manages runtime NPC state: position, movement, facing, animation. */

import type { Vec3 } from "../types.js";
import type { NpcRuntimeState, NpcUpdate } from "./scenario-types.js";

const DEFAULT_MOVE_SPEED = 1.9;
const ARRIVAL_THRESHOLD = 0.3;

export class NpcController {
  private npcs = new Map<string, NpcRuntimeState>();
  private arrivedIds: string[] = [];

  reset(): void {
    this.npcs.clear();
    this.arrivedIds = [];
  }

  spawnNpc(
    id: string,
    npcDefId: string,
    name: string,
    characterType: string,
    position: [number, number, number],
    animation: string,
  ): void {
    this.npcs.set(id, {
      id,
      npcDefId,
      name,
      characterType,
      position: { x: position[0], y: position[1], z: position[2] },
      facing: { x: 0, y: 0, z: -1 },
      animation,
      visible: true,
      moveTarget: null,
      moveSpeed: DEFAULT_MOVE_SPEED,
    });
  }

  despawnNpc(id: string): void {
    this.npcs.delete(id);
  }

  setVisible(id: string, visible: boolean): void {
    const npc = this.npcs.get(id);
    if (npc) npc.visible = visible;
  }

  moveTo(id: string, target: [number, number, number], speed?: number): void {
    const npc = this.npcs.get(id);
    if (!npc) return;
    npc.moveTarget = { x: target[0], y: target[1], z: target[2] };
    npc.moveSpeed = speed ?? DEFAULT_MOVE_SPEED;
  }

  setAnimation(id: string, animation: string): void {
    const npc = this.npcs.get(id);
    if (npc) npc.animation = animation;
  }

  getNpc(id: string): NpcRuntimeState | undefined {
    return this.npcs.get(id);
  }

  /** Returns IDs of NPCs that arrived at their target since last call. */
  drainArrived(): string[] {
    const result = this.arrivedIds.slice();
    this.arrivedIds = [];
    return result;
  }

  /** Advance NPC positions. Call once per tick. */
  tick(delta: number): void {
    for (const npc of this.npcs.values()) {
      if (!npc.moveTarget) continue;

      const dx = npc.moveTarget.x - npc.position.x;
      const dz = npc.moveTarget.z - npc.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < ARRIVAL_THRESHOLD) {
        // Arrived
        npc.position.x = npc.moveTarget.x;
        npc.position.z = npc.moveTarget.z;
        npc.moveTarget = null;
        npc.animation = "idle";
        this.arrivedIds.push(npc.id);
        continue;
      }

      // Move toward target
      const step = Math.min(npc.moveSpeed * delta, dist);
      const nx = dx / dist;
      const nz = dz / dist;
      npc.position.x += nx * step;
      npc.position.z += nz * step;

      // Face movement direction
      npc.facing.x = nx;
      npc.facing.z = nz;

      // Walking animation
      if (npc.animation !== "walk") {
        npc.animation = "walk";
      }
    }
  }

  /** Build NPC updates for the bridge response. */
  getUpdates(): NpcUpdate[] {
    const updates: NpcUpdate[] = [];
    for (const npc of this.npcs.values()) {
      updates.push({
        id: npc.id,
        pos: { x: npc.position.x, z: npc.position.z },
        animation: npc.animation,
        visible: npc.visible,
        facing: { x: npc.facing.x, z: npc.facing.z },
      });
    }
    return updates;
  }

  /** Check if any NPC is still moving. */
  hasMovingNpcs(): boolean {
    for (const npc of this.npcs.values()) {
      if (npc.moveTarget) return true;
    }
    return false;
  }

  getNpcPosition(id: string): Vec3 | null {
    const npc = this.npcs.get(id);
    return npc ? { ...npc.position } : null;
  }
}
