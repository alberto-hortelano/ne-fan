import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GameStore } from "../src/store/game-store.js";

describe("GameStore — payload aliasing invariant", () => {
  it("player_moved: mutating payload.pos after dispatch does not affect state", () => {
    const store = new GameStore();
    const pos: [number, number, number] = [1, 2, 3];
    store.dispatch("player_moved", { pos });
    pos[0] = 999;
    assert.deepEqual(store.state.player.pos, [1, 2, 3]);
  });

  it("player_moved: mutating payload.velocity after dispatch does not affect state", () => {
    const store = new GameStore();
    const velocity: [number, number, number] = [4, 5, 6];
    store.dispatch("player_moved", { velocity });
    velocity[1] = 999;
    assert.deepEqual(store.state.player.velocity, [4, 5, 6]);
  });

  it("player_respawned: mutating payload.pos after dispatch does not affect state", () => {
    const store = new GameStore();
    const pos: [number, number, number] = [7, 8, 9];
    store.dispatch("player_respawned", { pos });
    pos[2] = 999;
    assert.deepEqual(store.state.player.pos, [7, 8, 9]);
  });

  it("room_changed: mutating payload.room_data after dispatch does not affect state", () => {
    const store = new GameStore();
    const room_data: Record<string, unknown> = { exits: ["north", "south"] };
    store.dispatch("room_changed", { room_id: "r1", room_data, enemies: [] });
    (room_data.exits as string[]).push("east");
    assert.deepEqual(store.state.world.room_data, { exits: ["north", "south"] });
  });

  it("room_changed: mutating payload.enemies after dispatch does not affect state", () => {
    const store = new GameStore();
    const enemies = [{ id: "e1", hp: 100, alive: true } as never];
    store.dispatch("room_changed", { room_id: "r1", room_data: {}, enemies });
    (enemies[0] as unknown as Record<string, unknown>).hp = 0;
    enemies.push({ id: "e2", hp: 50, alive: true } as never);
    assert.equal(store.state.enemies.length, 1);
    assert.equal((store.state.enemies[0] as unknown as { hp: number }).hp, 100);
  });

  it("room_visited: mutating payload.room_data after dispatch does not affect state", () => {
    const store = new GameStore();
    const room_data: Record<string, unknown> = { name: "tavern" };
    store.dispatch("room_visited", { room_id: "r1", room_data });
    room_data.name = "different";
    assert.deepEqual(store.state.world.rooms_visited["r1"], { name: "tavern" });
  });
});

describe("GameStore.snapshot — independence from internal state", () => {
  it("snapshot returns a structurally independent copy", () => {
    const store = new GameStore();
    store.dispatch("player_moved", { pos: [1, 2, 3] });
    const snap = store.snapshot();
    store.dispatch("player_moved", { pos: [10, 20, 30] });
    assert.deepEqual(snap.player.pos, [1, 2, 3]);
    assert.deepEqual(store.state.player.pos, [10, 20, 30]);
  });

  it("mutating a snapshot does not affect the internal state", () => {
    const store = new GameStore();
    store.dispatch("player_moved", { pos: [1, 2, 3] });
    const snap = store.snapshot();
    snap.player.pos[0] = 999;
    assert.equal(store.state.player.pos[0], 1);
  });

  it("freezeInDev: mutating a snapshot throws in strict mode", () => {
    const store = new GameStore();
    store.setFreezeInDev(true);
    store.dispatch("player_moved", { pos: [1, 2, 3] });
    const snap = store.snapshot();
    assert.throws(() => {
      "use strict";
      snap.player.pos[0] = 999;
    }, TypeError);
  });
});
