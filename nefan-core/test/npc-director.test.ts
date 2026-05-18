import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { NpcDirector } from "../src/world-map/npc-director.js";

function makeSetup() {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("g");
  // Two places under the root world.
  s.worldMap.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "Robledo" });
  s.worldMap.upsertPlace({ id: "puerto", kind: "settlement", parent_id: "world", name: "Puerto" });
  // An NPC settled in Robledo.
  s.recordEntitySpawned("boris", "npc", "robledo_scene", [0, 0, 0], {
    name: "Boris",
    current_place_id: "robledo",
  });
  const director = new NpcDirector(s);
  return { s, director };
}

describe("NpcDirector.moveNpcToPlace", () => {
  it("marks the NPC in_transit toward the destination", () => {
    const { director } = makeSetup();
    const res = director.moveNpcToPlace("boris", "puerto");
    assert.equal(res.ok, true);
    assert.equal(res.info?.in_transit?.to, "puerto");
    assert.equal(res.info?.in_transit?.from, "robledo");
    assert.equal(res.info?.current_place_id, "robledo");
  });

  it("rejects an unknown npc or unknown place", () => {
    const { director } = makeSetup();
    assert.equal(director.moveNpcToPlace("ghost", "puerto").ok, false);
    assert.equal(director.moveNpcToPlace("boris", "atlantis").ok, false);
  });

  it("is a no-op note when the NPC is already at the place", () => {
    const { director } = makeSetup();
    const res = director.moveNpcToPlace("boris", "robledo");
    assert.equal(res.ok, true);
    assert.equal(res.info?.in_transit, null);
    assert.match(res.note ?? "", /already/);
  });
});

describe("NpcDirector.arriveNpc", () => {
  it("completes the transit: current_place_id becomes the destination", () => {
    const { director } = makeSetup();
    director.moveNpcToPlace("boris", "puerto");
    const res = director.arriveNpc("boris");
    assert.equal(res.ok, true);
    assert.equal(res.info?.current_place_id, "puerto");
    assert.equal(res.info?.in_transit, null);
  });

  it("rejects an NPC that is not in transit", () => {
    const { director } = makeSetup();
    assert.equal(director.arriveNpc("boris").ok, false);
    assert.equal(director.arriveNpc("ghost").ok, false);
  });

  it("persists through save/load", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("g");
    s1.worldMap.upsertPlace({ id: "puerto", kind: "settlement", parent_id: "world", name: "Puerto" });
    s1.recordEntitySpawned("boris", "npc", "scene", [0, 0, 0], { current_place_id: "world" });
    const d1 = new NpcDirector(s1);
    d1.moveNpcToPlace("boris", "puerto");
    d1.arriveNpc("boris");
    await s1.save();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(id), true);
    const info = new NpcDirector(s2).getNpcPlace("boris");
    assert.equal(info?.current_place_id, "puerto");
    assert.equal(info?.in_transit, null);
  });
});

describe("NpcDirector.setDirective", () => {
  it("sets and clears a standing directive", () => {
    const { director } = makeSetup();
    const set = director.setDirective("boris", { type: "patrol", target_place_id: "robledo" });
    assert.equal(set.ok, true);
    assert.equal(set.info?.directive?.type, "patrol");
    const cleared = director.setDirective("boris", null);
    assert.equal(cleared.ok, true);
    assert.equal(cleared.info?.directive, null);
  });
});

describe("NpcDirector queries", () => {
  it("getNpcsAtPlace excludes in-transit NPCs", () => {
    const { s, director } = makeSetup();
    s.recordEntitySpawned("greta", "npc", "robledo_scene", [1, 0, 1], {
      current_place_id: "robledo",
    });
    assert.equal(director.getNpcsAtPlace("robledo").length, 2);
    director.moveNpcToPlace("boris", "puerto");
    const atRobledo = director.getNpcsAtPlace("robledo").map((n) => n.npc_id);
    assert.deepEqual(atRobledo, ["greta"]);
    assert.equal(director.getNpcsInTransit().length, 1);
    assert.equal(director.getNpcsInTransit()[0].npc_id, "boris");
  });
});
