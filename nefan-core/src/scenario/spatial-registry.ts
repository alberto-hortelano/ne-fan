/** Spatial registry — tracks all world entities with position and AABB for collision queries. */

import type { Vec3 } from "../types.js";

/** Axis-Aligned Bounding Box, half-extents from center. */
export interface AABB {
  halfX: number;
  halfY: number;
  halfZ: number;
}

export type EntityKind = "object" | "npc" | "enemy" | "player" | "building_wall";

export interface SpatialEntity {
  id: string;
  position: Vec3;
  aabb: AABB;
  kind: EntityKind;
  parentBuildingId?: string;
}

/** Room object from scene JSON (minimal fields needed for registration). */
export interface RoomObjectData {
  id: string;
  position: [number, number, number] | number[];
  scale: [number, number, number] | number[];
  mesh?: string;
  category?: string;
}

/** Room NPC from scene JSON. */
export interface RoomNpcData {
  id: string;
  position: [number, number, number] | number[];
  scale?: [number, number, number] | number[];
}

export class SpatialRegistry {
  private entities = new Map<string, SpatialEntity>();

  reset(): void {
    this.entities.clear();
  }

  register(entity: SpatialEntity): void {
    this.entities.set(entity.id, entity);
  }

  unregister(id: string): void {
    this.entities.delete(id);
  }

  updatePosition(id: string, pos: Vec3): void {
    const e = this.entities.get(id);
    if (e) {
      e.position.x = pos.x;
      e.position.y = pos.y;
      e.position.z = pos.z;
    }
  }

  get(id: string): SpatialEntity | undefined {
    return this.entities.get(id);
  }

  getAll(): SpatialEntity[] {
    return Array.from(this.entities.values());
  }

  /** Find all entities within XZ radius of a point. */
  findNear(center: Vec3, radius: number): SpatialEntity[] {
    const r2 = radius * radius;
    const result: SpatialEntity[] = [];
    for (const e of this.entities.values()) {
      const dx = e.position.x - center.x;
      const dz = e.position.z - center.z;
      if (dx * dx + dz * dz <= r2) {
        result.push(e);
      }
    }
    return result;
  }

  /** Find all entities of a given kind. */
  findByKind(kind: EntityKind): SpatialEntity[] {
    const result: SpatialEntity[] = [];
    for (const e of this.entities.values()) {
      if (e.kind === kind) result.push(e);
    }
    return result;
  }

  /**
   * Test if a proposed AABB at position overlaps any existing entity (XZ only).
   * Returns true if there is an overlap.
   */
  overlapsAny(pos: Vec3, aabb: AABB, excludeIds?: Set<string>): boolean {
    for (const e of this.entities.values()) {
      if (excludeIds?.has(e.id)) continue;
      if (this.overlapsXZ(pos, aabb, e.position, e.aabb)) {
        return true;
      }
    }
    return false;
  }

  /** 2D AABB overlap test on XZ plane. */
  private overlapsXZ(posA: Vec3, aabbA: AABB, posB: Vec3, aabbB: AABB): boolean {
    return (
      Math.abs(posA.x - posB.x) < aabbA.halfX + aabbB.halfX &&
      Math.abs(posA.z - posB.z) < aabbA.halfZ + aabbB.halfZ
    );
  }

  /** Populate from room JSON objects array. */
  loadFromRoomData(objects?: RoomObjectData[], npcs?: RoomNpcData[]): void {
    if (objects) {
      for (const obj of objects) {
        if (!obj.id || !obj.position || !obj.scale) continue;
        const sx = Number(obj.scale[0]) || 1;
        const sy = Number(obj.scale[1]) || 1;
        const sz = Number(obj.scale[2]) || 1;
        const px = Number(obj.position[0]) || 0;
        const py = Number(obj.position[1]) || 0;
        const pz = Number(obj.position[2]) || 0;

        this.register({
          id: obj.id,
          position: { x: px, y: py, z: pz },
          aabb: { halfX: sx / 2, halfY: sy / 2, halfZ: sz / 2 },
          kind: obj.category === "building" ? "building_wall" : "object",
        });
      }
    }

    if (npcs) {
      for (const npc of npcs) {
        if (!npc.id || !npc.position) continue;
        const scale = npc.scale ?? [0.6, 1.8, 0.6];
        const sx = Number(scale[0]) || 0.6;
        const sy = Number(scale[1]) || 1.8;
        const sz = Number(scale[2]) || 0.6;

        this.register({
          id: npc.id,
          position: {
            x: Number(npc.position[0]) || 0,
            y: Number(npc.position[1]) || 0,
            z: Number(npc.position[2]) || 0,
          },
          aabb: { halfX: sx / 2, halfY: sy / 2, halfZ: sz / 2 },
          kind: "npc",
        });
      }
    }
  }

  get size(): number {
    return this.entities.size;
  }
}
