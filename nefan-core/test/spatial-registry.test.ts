import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpatialRegistry } from "../src/scenario/spatial-registry.js";

describe("SpatialRegistry", () => {
  it("registers and retrieves entities", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "table_01",
      position: { x: 3, y: 0, z: 2 },
      aabb: { halfX: 0.75, halfY: 0.375, halfZ: 0.4 },
      kind: "object",
    });

    const entity = reg.get("table_01");
    assert.ok(entity);
    assert.equal(entity.id, "table_01");
    assert.equal(entity.position.x, 3);
    assert.equal(reg.size, 1);
  });

  it("unregisters entities", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "chair",
      position: { x: 0, y: 0, z: 0 },
      aabb: { halfX: 0.3, halfY: 0.5, halfZ: 0.3 },
      kind: "object",
    });
    assert.equal(reg.size, 1);
    reg.unregister("chair");
    assert.equal(reg.size, 0);
    assert.equal(reg.get("chair"), undefined);
  });

  it("updates positions", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "npc_01",
      position: { x: 0, y: 0, z: 0 },
      aabb: { halfX: 0.3, halfY: 0.9, halfZ: 0.3 },
      kind: "npc",
    });

    reg.updatePosition("npc_01", { x: 5, y: 0, z: 3 });
    const e = reg.get("npc_01")!;
    assert.equal(e.position.x, 5);
    assert.equal(e.position.z, 3);
  });

  it("detects XZ overlap between two entities", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "box_a",
      position: { x: 0, y: 0, z: 0 },
      aabb: { halfX: 1, halfY: 1, halfZ: 1 },
      kind: "object",
    });

    // Overlapping position
    assert.equal(
      reg.overlapsAny({ x: 0.5, y: 0, z: 0.5 }, { halfX: 1, halfY: 1, halfZ: 1 }),
      true,
    );

    // Non-overlapping position (far away)
    assert.equal(
      reg.overlapsAny({ x: 10, y: 0, z: 10 }, { halfX: 1, halfY: 1, halfZ: 1 }),
      false,
    );
  });

  it("respects excludeIds in overlap check", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "self",
      position: { x: 0, y: 0, z: 0 },
      aabb: { halfX: 1, halfY: 1, halfZ: 1 },
      kind: "npc",
    });

    // Same position but excluded
    assert.equal(
      reg.overlapsAny({ x: 0, y: 0, z: 0 }, { halfX: 1, halfY: 1, halfZ: 1 }, new Set(["self"])),
      false,
    );
  });

  it("finds entities near a point", () => {
    const reg = new SpatialRegistry();
    reg.register({
      id: "near",
      position: { x: 1, y: 0, z: 1 },
      aabb: { halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      kind: "object",
    });
    reg.register({
      id: "far",
      position: { x: 50, y: 0, z: 50 },
      aabb: { halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      kind: "object",
    });

    const nearby = reg.findNear({ x: 0, y: 0, z: 0 }, 5);
    assert.equal(nearby.length, 1);
    assert.equal(nearby[0].id, "near");
  });

  it("finds entities by kind", () => {
    const reg = new SpatialRegistry();
    reg.register({ id: "a", position: { x: 0, y: 0, z: 0 }, aabb: { halfX: 1, halfY: 1, halfZ: 1 }, kind: "npc" });
    reg.register({ id: "b", position: { x: 2, y: 0, z: 0 }, aabb: { halfX: 1, halfY: 1, halfZ: 1 }, kind: "object" });
    reg.register({ id: "c", position: { x: 4, y: 0, z: 0 }, aabb: { halfX: 1, halfY: 1, halfZ: 1 }, kind: "npc" });

    const npcs = reg.findByKind("npc");
    assert.equal(npcs.length, 2);
  });

  it("loads from room data", () => {
    const reg = new SpatialRegistry();
    reg.loadFromRoomData(
      [
        { id: "table", position: [3, 0, 2], scale: [1.5, 0.75, 0.8], category: "prop" },
        { id: "wall", position: [0, 1.5, -5], scale: [10, 3, 0.2], category: "building" },
      ],
      [
        { id: "npc_01", position: [1, 0, 1] },
      ],
    );

    assert.equal(reg.size, 3);
    const table = reg.get("table")!;
    assert.equal(table.kind, "object");
    assert.equal(table.aabb.halfX, 0.75);

    const wall = reg.get("wall")!;
    assert.equal(wall.kind, "building_wall");

    const npc = reg.get("npc_01")!;
    assert.equal(npc.kind, "npc");
  });

  it("resets all entities", () => {
    const reg = new SpatialRegistry();
    reg.register({ id: "a", position: { x: 0, y: 0, z: 0 }, aabb: { halfX: 1, halfY: 1, halfZ: 1 }, kind: "object" });
    reg.register({ id: "b", position: { x: 2, y: 0, z: 0 }, aabb: { halfX: 1, halfY: 1, halfZ: 1 }, kind: "npc" });
    assert.equal(reg.size, 2);

    reg.reset();
    assert.equal(reg.size, 0);
  });
});
