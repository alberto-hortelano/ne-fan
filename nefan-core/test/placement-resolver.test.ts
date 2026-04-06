import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpatialRegistry } from "../src/scenario/spatial-registry.js";
import { PlacementResolver } from "../src/scenario/placement-resolver.js";
import type { BuildingRoom } from "../src/scenario/building-generator.js";

describe("PlacementResolver", () => {
  it("places near_entity at valid position", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "counter",
      position: { x: 5, y: 0, z: 0 },
      aabb: { halfX: 1.5, halfY: 0.5, halfZ: 0.3 },
      kind: "object",
    });

    const resolver = new PlacementResolver(reg);
    const pos = resolver.resolve(
      { type: "near_entity", entityId: "counter", minDist: 1.5, maxDist: 3.0 },
      { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
    );

    assert.ok(pos, "should find a position");
    // Check it's within expected distance range
    const dx = pos.x - 5;
    const dz = pos.z - 0;
    const dist = Math.sqrt(dx * dx + dz * dz);
    assert.ok(dist >= 1.0, `distance ${dist} should be >= 1.0`);
    assert.ok(dist <= 4.0, `distance ${dist} should be <= 4.0`);
    assert.equal(pos.y, 0, "y should be ground level");
  });

  it("returns null for unknown entity", () => {
    const reg = new SpatialRegistry();
    const resolver = new PlacementResolver(reg);
    const pos = resolver.resolve(
      { type: "near_entity", entityId: "nonexistent" },
      { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
    );
    assert.equal(pos, null);
  });

  it("avoids overlapping objects when placing near entity", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "target",
      position: { x: 0, y: 0, z: 0 },
      aabb: { halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      kind: "object",
    });

    // Fill a tight ring with blockers
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      reg.register({
        id: `blocker_${i}`,
        position: { x: Math.cos(angle) * 2, y: 0, z: Math.sin(angle) * 2 },
        aabb: { halfX: 0.8, halfY: 0.5, halfZ: 0.8 },
        kind: "object",
      });
    }

    const resolver = new PlacementResolver(reg);
    const npcAABB = { halfX: 0.3, halfY: 0.9, halfZ: 0.3 };
    const pos = resolver.resolve(
      { type: "near_entity", entityId: "target", minDist: 1.5, maxDist: 3.0 },
      npcAABB,
    );

    // Should still find a gap or return null gracefully
    if (pos) {
      assert.equal(reg.overlapsAny(pos, npcAABB), false, "placed position should not overlap");
    }
  });

  it("places at explicit position", () => {
    const reg = new SpatialRegistry();
    const resolver = new PlacementResolver(reg);
    const pos = resolver.resolve(
      { type: "at_position", position: [3, 5, 7] },
      { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
    );

    assert.ok(pos);
    assert.equal(pos.x, 3);
    assert.equal(pos.y, 0);  // ground snapped
    assert.equal(pos.z, 7);
  });

  it("places in random area", () => {
    const reg = new SpatialRegistry();
    const resolver = new PlacementResolver(reg);
    const pos = resolver.resolve(
      { type: "random_in_area", center: { x: 10, y: 0, z: 10 }, radius: 5 },
      { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
    );

    assert.ok(pos);
    const dx = pos.x - 10;
    const dz = pos.z - 10;
    const dist = Math.sqrt(dx * dx + dz * dz);
    assert.ok(dist <= 5.0, `distance ${dist} should be within radius`);
  });

  it("places inside building room", () => {
    const reg = new SpatialRegistry();
    const rooms = new Map<string, BuildingRoom[]>();
    rooms.set("tavern", [{
      index: 0,
      center: { x: 5, y: 0, z: 5 },
      width: 8,
      depth: 6,
      height: 3.5,
    }]);

    const resolver = new PlacementResolver(reg, rooms);
    const pos = resolver.resolve(
      { type: "inside_room", buildingId: "tavern", roomIndex: 0 },
      { halfX: 0.5, halfY: 0.4, halfZ: 0.3 },
    );

    assert.ok(pos, "should find a position inside room");
    // Should be within room bounds (center 5,5, width 8, depth 6)
    assert.ok(pos.x >= 5 - 4 && pos.x <= 5 + 4, `x ${pos.x} should be within room`);
    assert.ok(pos.z >= 5 - 3 && pos.z <= 5 + 3, `z ${pos.z} should be within room`);
  });

  it("returns null for unknown building", () => {
    const reg = new SpatialRegistry();
    const resolver = new PlacementResolver(reg);
    const pos = resolver.resolve(
      { type: "inside_room", buildingId: "nonexistent" },
      { halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
    );
    assert.equal(pos, null);
  });

  it("uses height sampler for terrain Y", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "rock",
      position: { x: 10, y: 2.5, z: 10 },
      aabb: { halfX: 1, halfY: 1, halfZ: 1 },
      kind: "object",
    });

    // Simulate hilly terrain: Y = 2.0 everywhere
    const resolver = new PlacementResolver(reg, new Map(), (_x, _z) => 2.0);
    const pos = resolver.resolve(
      { type: "near_entity", entityId: "rock", minDist: 2, maxDist: 4 },
      { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
    );

    assert.ok(pos);
    assert.equal(pos!.y, 2.0, "y should match terrain height");
  });

  it("uses height sampler for at_position", () => {
    const reg = new SpatialRegistry();
    const resolver = new PlacementResolver(reg, new Map(), (x, z) => x * 0.1 + z * 0.05);
    const pos = resolver.resolve(
      { type: "at_position", position: [10, 999, 20] },
      { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
    );

    assert.ok(pos);
    assert.equal(pos!.y, 10 * 0.1 + 20 * 0.05, "y should be sampled from terrain, not from input");
  });
});
