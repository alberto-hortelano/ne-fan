import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuildingGenerator } from "../src/scenario/building-generator.js";

describe("BuildingGenerator", () => {
  const gen = new BuildingGenerator();

  it("generates a single-room building", () => {
    const result = gen.generate({
      id: "hut",
      width: 6,
      depth: 4,
      wallHeight: 3,
    });

    assert.ok(result.objects.length > 0, "should generate objects");
    assert.equal(result.rooms.length, 1);

    // Check room dimensions
    const room = result.rooms[0];
    assert.equal(room.index, 0);
    assert.ok(room.width > 0);
    assert.ok(room.depth > 0);
    assert.equal(room.height, 3);

    // Should have floor and ceiling
    const floor = result.objects.find(o => o.id === "hut_floor");
    assert.ok(floor, "should have floor");
    assert.deepEqual(floor!.scale, [6, 0.15, 4]);

    const ceiling = result.objects.find(o => o.id === "hut_ceiling");
    assert.ok(ceiling, "should have ceiling");
  });

  it("generates south door by default", () => {
    const result = gen.generate({
      id: "shop",
      width: 8,
      depth: 6,
    });

    // South wall should be split into segments (left, right, lintel)
    const southLeft = result.objects.find(o => o.id === "shop_wall_south_left");
    const southRight = result.objects.find(o => o.id === "shop_wall_south_right");
    assert.ok(southLeft, "should have south left wall segment");
    assert.ok(southRight, "should have south right wall segment");

    // North wall should be solid (no door)
    const north = result.objects.find(o => o.id === "shop_wall_north");
    assert.ok(north, "should have solid north wall");
  });

  it("generates 2-room building with interior wall", () => {
    const result = gen.generate({
      id: "house",
      width: 10,
      depth: 8,
      numRooms: 2,
    });

    assert.equal(result.rooms.length, 2);

    // Interior wall segments
    const interiorWalls = result.objects.filter(o => o.id.includes("interior"));
    assert.ok(interiorWalls.length > 0, "should have interior wall segments");

    // Rooms should have different Z centers
    assert.notEqual(result.rooms[0].center.z, result.rooms[1].center.z);
  });

  it("generates 4-room building (2x2 grid)", () => {
    const result = gen.generate({
      id: "mansion",
      width: 16,
      depth: 12,
      numRooms: 4,
    });

    assert.equal(result.rooms.length, 4);

    // All rooms should have positive dimensions
    for (const room of result.rooms) {
      assert.ok(room.width > 0, `room ${room.index} width should be > 0`);
      assert.ok(room.depth > 0, `room ${room.index} depth should be > 0`);
    }
  });

  it("all objects have category building", () => {
    const result = gen.generate({
      id: "test",
      width: 5,
      depth: 5,
    });

    for (const obj of result.objects) {
      assert.equal(obj.category, "building");
      assert.equal(obj.mesh, "box");
    }
  });

  it("respects custom wall height and door dimensions", () => {
    const result = gen.generate({
      id: "tall",
      width: 8,
      depth: 6,
      wallHeight: 5,
      doorWidth: 2.0,
      doorHeight: 3.0,
    });

    // Check ceiling is at correct height
    const ceiling = result.objects.find(o => o.id === "tall_ceiling");
    assert.ok(ceiling);
    assert.ok(ceiling!.position[1] > 4.9, "ceiling should be near wall height");

    // Room height should match
    assert.equal(result.rooms[0].height, 5);
  });

  it("clamps numRooms to max 4", () => {
    const result = gen.generate({
      id: "big",
      width: 20,
      depth: 20,
      numRooms: 10,
    });

    assert.equal(result.rooms.length, 4);
  });

  it("generates texture prompts based on style", () => {
    const result = gen.generate({
      id: "castle",
      width: 10,
      depth: 10,
      style: "stone castle",
    });

    const wall = result.objects.find(o => o.id.includes("wall"));
    assert.ok(wall);
    assert.ok(wall!.texture_prompt?.includes("stone castle"));
  });
});
