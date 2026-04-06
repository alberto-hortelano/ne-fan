/** Placement resolver — finds collision-free positions using the SpatialRegistry. */

import type { Vec3 } from "../types.js";
import type { AABB, SpatialRegistry } from "./spatial-registry.js";
import type { BuildingRoom } from "./building-generator.js";

export type PlacementStrategy =
  | { type: "near_entity"; entityId: string; minDist?: number; maxDist?: number }
  | { type: "inside_room"; buildingId: string; roomIndex?: number }
  | { type: "random_in_area"; center: Vec3; radius: number }
  | { type: "at_position"; position: [number, number, number] };

/** Callback to sample terrain height at a given XZ position. */
export type HeightSampler = (x: number, z: number) => number;

const MAX_RING_ATTEMPTS = 12;
const MAX_RANDOM_ATTEMPTS = 8;
const DEFAULT_MIN_DIST = 1.5;
const DEFAULT_MAX_DIST = 3.0;

export class PlacementResolver {
  private heightSampler: HeightSampler;

  constructor(
    private registry: SpatialRegistry,
    private buildingRooms: Map<string, BuildingRoom[]> = new Map(),
    heightSampler?: HeightSampler,
  ) {
    this.heightSampler = heightSampler ?? (() => 0);
  }

  /** Set a custom height sampler for terrain with hills/heightmap. */
  setHeightSampler(sampler: HeightSampler): void {
    this.heightSampler = sampler;
  }

  /** Update building rooms reference (called after generate_building). */
  setBuildingRooms(rooms: Map<string, BuildingRoom[]>): void {
    this.buildingRooms = rooms;
  }

  /**
   * Find a collision-free position for an entity with the given AABB.
   * Returns position with y = terrain height, or null if no valid position found.
   */
  resolve(
    strategy: PlacementStrategy,
    entityAABB: AABB,
    excludeIds?: Set<string>,
  ): Vec3 | null {
    switch (strategy.type) {
      case "near_entity":
        return this.resolveNearEntity(strategy, entityAABB, excludeIds);
      case "inside_room":
        return this.resolveInsideRoom(strategy, entityAABB, excludeIds);
      case "random_in_area":
        return this.resolveRandomInArea(strategy, entityAABB, excludeIds);
      case "at_position": {
        const x = strategy.position[0];
        const z = strategy.position[2];
        return { x, y: this.getGroundY(x, z), z };
      }
    }
  }

  private resolveNearEntity(
    strategy: Extract<PlacementStrategy, { type: "near_entity" }>,
    aabb: AABB,
    excludeIds?: Set<string>,
  ): Vec3 | null {
    const target = this.registry.get(strategy.entityId);
    if (!target) return null;

    const minDist = strategy.minDist ?? DEFAULT_MIN_DIST;
    const maxDist = strategy.maxDist ?? DEFAULT_MAX_DIST;
    const midDist = (minDist + maxDist) / 2;

    // Try ring positions at mid distance
    for (let i = 0; i < MAX_RING_ATTEMPTS; i++) {
      const angle = (i / MAX_RING_ATTEMPTS) * Math.PI * 2;
      const x = target.position.x + Math.cos(angle) * midDist;
      const z = target.position.z + Math.sin(angle) * midDist;
      const pos: Vec3 = { x, y: this.getGroundY(x, z), z };
      if (!this.registry.overlapsAny(pos, aabb, excludeIds)) {
        return pos;
      }
    }

    // Try random positions in the annulus
    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const x = target.position.x + Math.cos(angle) * dist;
      const z = target.position.z + Math.sin(angle) * dist;
      const pos: Vec3 = { x, y: this.getGroundY(x, z), z };
      if (!this.registry.overlapsAny(pos, aabb, excludeIds)) {
        return pos;
      }
    }

    return null;
  }

  private resolveInsideRoom(
    strategy: Extract<PlacementStrategy, { type: "inside_room" }>,
    aabb: AABB,
    excludeIds?: Set<string>,
  ): Vec3 | null {
    const rooms = this.buildingRooms.get(strategy.buildingId);
    if (!rooms) return null;

    const room = rooms[strategy.roomIndex ?? 0];
    if (!room) return null;

    const margin = 0.5;
    const usableW = room.width - margin * 2 - aabb.halfX * 2;
    const usableD = room.depth - margin * 2 - aabb.halfZ * 2;
    if (usableW <= 0 || usableD <= 0) return null;

    // Grid sampling with 0.5m step
    const step = 0.5;
    const startX = room.center.x - usableW / 2;
    const startZ = room.center.z - usableD / 2;

    for (let gx = 0; gx * step <= usableW; gx++) {
      for (let gz = 0; gz * step <= usableD; gz++) {
        const x = startX + gx * step;
        const z = startZ + gz * step;
        const pos: Vec3 = { x, y: this.getGroundY(x, z), z };
        if (!this.registry.overlapsAny(pos, aabb, excludeIds)) {
          return pos;
        }
      }
    }

    return null;
  }

  private resolveRandomInArea(
    strategy: Extract<PlacementStrategy, { type: "random_in_area" }>,
    aabb: AABB,
    excludeIds?: Set<string>,
  ): Vec3 | null {
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * strategy.radius;
      const x = strategy.center.x + Math.cos(angle) * dist;
      const z = strategy.center.z + Math.sin(angle) * dist;
      const pos: Vec3 = { x, y: this.getGroundY(x, z), z };
      if (!this.registry.overlapsAny(pos, aabb, excludeIds)) {
        return pos;
      }
    }
    return null;
  }

  /** Get ground Y at position. Uses heightSampler (default returns 0 for flat terrain). */
  getGroundY(x: number, z: number): number {
    return this.heightSampler(x, z);
  }
}
