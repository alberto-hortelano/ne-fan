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

  /** Populate from room JSON objects array. Throws on malformed input — no
   *  silent `Number(x) || 0` coercion that turns NaN into zero. */
  loadFromRoomData(objects?: RoomObjectData[], npcs?: RoomNpcData[]): void {
    if (objects) {
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (!obj.id) throw new Error(`spatial-registry: object[${i}] missing id`);
        if (!obj.position) throw new Error(`spatial-registry: object[${i}] (${obj.id}) missing position`);
        if (!obj.scale) throw new Error(`spatial-registry: object[${i}] (${obj.id}) missing scale`);
        const [sx, sy, sz] = obj.scale;
        const [px, py, pz] = obj.position;
        for (const [label, v] of [["scale.x", sx], ["scale.y", sy], ["scale.z", sz],
                                  ["pos.x", px], ["pos.y", py], ["pos.z", pz]] as const) {
          if (typeof v !== "number" || !Number.isFinite(v)) {
            throw new Error(`spatial-registry: object[${i}] (${obj.id}) ${label} must be a finite number, got ${v}`);
          }
        }
        this.register({
          id: obj.id,
          position: { x: px, y: py, z: pz },
          aabb: { halfX: sx / 2, halfY: sy / 2, halfZ: sz / 2 },
          kind: obj.category === "building" ? "building_wall" : "object",
        });
      }
    }

    if (npcs) {
      for (let i = 0; i < npcs.length; i++) {
        const npc = npcs[i];
        if (!npc.id) throw new Error(`spatial-registry: npc[${i}] missing id`);
        if (!npc.position) throw new Error(`spatial-registry: npc[${i}] (${npc.id}) missing position`);
        const [nx, ny, nz] = npc.position;
        for (const [label, v] of [["pos.x", nx], ["pos.y", ny], ["pos.z", nz]] as const) {
          if (typeof v !== "number" || !Number.isFinite(v)) {
            throw new Error(`spatial-registry: npc[${i}] (${npc.id}) ${label} must be a finite number, got ${v}`);
          }
        }
        const scale = npc.scale;
        if (scale && (scale.length < 3 || scale.some((s) => typeof s !== "number" || !Number.isFinite(s)))) {
          throw new Error(`spatial-registry: npc[${i}] (${npc.id}) scale must be [x,y,z] of finite numbers`);
        }
        const sx = scale ? scale[0] : 0.6;
        const sy = scale ? scale[1] : 1.8;
        const sz = scale ? scale[2] : 0.6;
        this.register({
          id: npc.id,
          position: { x: nx, y: ny, z: nz },
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
