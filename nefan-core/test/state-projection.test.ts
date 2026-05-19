import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { projectEnemiesFromEntities } from "../src/store/state-projection.js";
import type { EntityRecord } from "../src/narrative/types.js";

function entity(over: Partial<EntityRecord>): EntityRecord {
  return {
    id: "x",
    type: "enemy",
    scene_id: "s",
    spawned_at: "",
    spawn_reason: "scene_init",
    spawn_event_id: "",
    position: [0, 0, 0],
    data: {},
    asset_refs: [],
    ...over,
  };
}

describe("projectEnemiesFromEntities", () => {
  it("filters out non-enemy entities", () => {
    const entities = [
      entity({ id: "e1", type: "enemy", data: { health: 50, weapon_id: "club" } }),
      entity({ id: "n1", type: "npc",   data: { name: "Aldo" } }),
      entity({ id: "o1", type: "object", data: { mesh: "box" } }),
    ];
    const result = projectEnemiesFromEntities(entities);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e1");
  });

  it("restricts to scene_id when provided", () => {
    const entities = [
      entity({ id: "a", scene_id: "tavern", data: { health: 10 } }),
      entity({ id: "b", scene_id: "crypt",  data: { health: 10 } }),
    ];
    const result = projectEnemiesFromEntities(entities, { sceneId: "tavern" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a");
  });

  it("includes every scene when sceneId is empty string", () => {
    const entities = [
      entity({ id: "a", scene_id: "tavern", data: { health: 10 } }),
      entity({ id: "b", scene_id: "crypt",  data: { health: 10 } }),
    ];
    assert.equal(projectEnemiesFromEntities(entities, { sceneId: "" }).length, 2);
  });

  it("reads HP and weapon from data.combat when top-level is missing", () => {
    const entities = [entity({
      id: "scenario_spawn",
      data: { combat: { health: 30, weapon_id: "war_hammer" } },
    })];
    const [r] = projectEnemiesFromEntities(entities);
    assert.equal(r.hp, 30);
    assert.equal(r.weapon_id, "war_hammer");
  });

  it("top-level data.health beats data.combat.health", () => {
    const entities = [entity({
      data: { health: 99, combat: { health: 30 } },
    })];
    assert.equal(projectEnemiesFromEntities(entities)[0].hp, 99);
  });

  it("falls back to defaults when data is empty", () => {
    const entities = [entity({ data: {} })];
    const [r] = projectEnemiesFromEntities(entities, { defaultHp: 42, defaultWeapon: "fists" });
    assert.equal(r.hp, 42);
    assert.equal(r.weapon_id, "fists");
    assert.equal(r.max_hp, 42);
  });

  it("marks alive=false when hp comes out as 0", () => {
    const entities = [entity({ data: { health: 0 } })];
    const [r] = projectEnemiesFromEntities(entities);
    assert.equal(r.alive, false);
  });

  it("returns a fresh position tuple (no aliasing of entity.position)", () => {
    const ent = entity({ position: [1, 2, 3], data: { health: 10 } });
    const [r] = projectEnemiesFromEntities([ent]);
    r.pos[0] = 999;
    assert.equal(ent.position[0], 1);
  });

  it("output is a fresh array even when input is empty", () => {
    const a = projectEnemiesFromEntities([]);
    const b = projectEnemiesFromEntities([]);
    assert.notEqual(a, b);
    assert.deepEqual(a, []);
  });
});
