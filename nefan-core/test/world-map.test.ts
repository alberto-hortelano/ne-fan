import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WorldMapManager } from "../src/world-map/world-map.js";
import { WORLD_MAP_SCHEMA_VERSION } from "../src/world-map/types.js";

function makeManager() {
  return new WorldMapManager(WorldMapManager.createEmpty("Test World"));
}

describe("WorldMapManager construction", () => {
  it("createEmpty produces a root world place", () => {
    const map = WorldMapManager.createEmpty("Mundo");
    assert.equal(map.schema_version, WORLD_MAP_SCHEMA_VERSION);
    assert.equal(map.root_id, "world");
    assert.equal(map.active_place_id, "world");
    assert.equal(map.places.world.kind, "world");
    assert.equal(map.places.world.parent_id, null);
    assert.equal(map.links.length, 0);
  });
});

describe("WorldMapManager.upsertPlace", () => {
  it("inserts a place under an existing parent", () => {
    const m = makeManager();
    const place = m.upsertPlace({
      id: "robledo",
      kind: "settlement",
      parent_id: "world",
      name: "Robledo",
      approx_position: [12, 34],
    });
    assert.equal(place.id, "robledo");
    assert.equal(m.get("robledo")?.name, "Robledo");
    assert.deepEqual(m.get("robledo")?.approx_position, [12, 34]);
    assert.equal(m.get("robledo")?.visited, false);
  });

  it("updates existing place, preserving unspecified fields", () => {
    const m = makeManager();
    m.upsertPlace({
      id: "robledo",
      kind: "settlement",
      parent_id: "world",
      name: "Robledo",
      attrs: { population: 300 },
      approx_position: [12, 34],
    });
    m.upsertPlace({
      id: "robledo",
      kind: "settlement",
      parent_id: "world",
      name: "Robledo Quemado",
    });
    const r = m.get("robledo");
    assert.equal(r?.name, "Robledo Quemado");
    assert.deepEqual(r?.attrs, { population: 300 });
    assert.deepEqual(r?.approx_position, [12, 34]);
  });

  it("throws if parent_id is missing", () => {
    const m = makeManager();
    assert.throws(() =>
      m.upsertPlace({
        id: "x",
        kind: "settlement",
        parent_id: "nonexistent",
        name: "X",
      }),
    );
  });
});

describe("WorldMapManager.removePlace", () => {
  it("removes a leaf and its links", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    m.addLink({ from: "a", to: "b", kind: "road" });
    assert.equal(m.removePlace("a"), true);
    assert.equal(m.get("a"), undefined);
    assert.equal(m.serialize().links.length, 0);
  });

  it("refuses to remove the root", () => {
    const m = makeManager();
    assert.throws(() => m.removePlace("world"));
  });

  it("refuses to remove a place with children", () => {
    const m = makeManager();
    m.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "R" });
    m.upsertPlace({ id: "iglesia", kind: "site", parent_id: "robledo", name: "Iglesia" });
    assert.throws(() => m.removePlace("robledo"));
  });

  it("resets active_place_id to root if removed place was active", () => {
    const m = makeManager();
    m.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "R" });
    m.setActivePlace("robledo");
    m.removePlace("robledo");
    assert.equal(m.serialize().active_place_id, "world");
  });
});

describe("WorldMapManager.addLink", () => {
  it("creates a bidirectional link by default", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    m.addLink({ from: "a", to: "b", kind: "road", travel_hours: 2 });
    const links = m.serialize().links;
    assert.equal(links.length, 1);
    assert.equal(links[0].bidirectional, true);
    assert.equal(links[0].travel_hours, 2);
  });

  it("dedupes by updating existing link instead of adding a new one", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    m.addLink({ from: "a", to: "b", kind: "road", travel_hours: 2 });
    m.addLink({ from: "b", to: "a", kind: "road", travel_hours: 5 });
    const links = m.serialize().links;
    assert.equal(links.length, 1);
    assert.equal(links[0].travel_hours, 5);
  });

  it("persists edge on creation and round-trips through serialize", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    m.addLink({ from: "a", to: "b", kind: "path", edge: "east" });
    const links = m.serialize().links;
    assert.equal(links[0].edge, "east");
    const restored = WorldMapManager.fromSerialized(JSON.parse(JSON.stringify(m.serialize())));
    assert.equal(restored.serialize().links[0].edge, "east");
  });

  it("update adopts a new edge, keeps the old one when absent", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    m.addLink({ from: "a", to: "b", kind: "path", edge: "east" });
    m.addLink({ from: "a", to: "b", kind: "road" }); // sin edge -> conserva
    assert.equal(m.serialize().links[0].edge, "east");
    m.addLink({ from: "a", to: "b", kind: "road", edge: "south" });
    assert.equal(m.serialize().links[0].edge, "south");
  });

  it("update in REVERSED orientation stores the opposite edge", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    m.addLink({ from: "a", to: "b", kind: "path", edge: "east" });
    // map_link(b->a, edge:"west") describe el MISMO par: desde b la salida
    // hacia a esta al oeste, o sea a->b sigue siendo east.
    m.addLink({ from: "b", to: "a", kind: "path", edge: "west" });
    const links = m.serialize().links;
    assert.equal(links.length, 1);
    assert.equal(links[0].from, "a");
    assert.equal(links[0].edge, "east");
  });

  it("rejects unknown endpoints and self-links", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    assert.throws(() => m.addLink({ from: "a", to: "ghost", kind: "road" }));
    assert.throws(() => m.addLink({ from: "a", to: "a", kind: "road" }));
  });
});

describe("WorldMapManager queries", () => {
  it("getChildren and getAncestors walk the hierarchy", () => {
    const m = makeManager();
    m.upsertPlace({ id: "greybark", kind: "region", parent_id: "world", name: "Greybark" });
    m.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "greybark", name: "R" });
    m.upsertPlace({ id: "iglesia", kind: "site", parent_id: "robledo", name: "Iglesia" });

    const kids = m.getChildren("greybark").map((p) => p.id);
    assert.deepEqual(kids, ["robledo"]);

    const ancestors = m.getAncestors("iglesia").map((p) => p.id);
    assert.deepEqual(ancestors, ["iglesia", "robledo", "greybark", "world"]);
  });

  it("getByKind filters by kind", () => {
    const m = makeManager();
    m.upsertPlace({ id: "g", kind: "region", parent_id: "world", name: "G" });
    m.upsertPlace({ id: "r", kind: "settlement", parent_id: "g", name: "R" });
    m.upsertPlace({ id: "p", kind: "settlement", parent_id: "g", name: "P" });
    assert.equal(m.getByKind("settlement").length, 2);
    assert.equal(m.getHighLevel().length, 3);
  });
});

describe("WorldMapManager.findPath", () => {
  it("returns [self] for same node", () => {
    const m = makeManager();
    assert.deepEqual(m.findPath("world", "world"), ["world"]);
  });

  it("returns BFS shortest path", () => {
    const m = makeManager();
    for (const id of ["a", "b", "c", "d"]) {
      m.upsertPlace({ id, kind: "settlement", parent_id: "world", name: id.toUpperCase() });
    }
    m.addLink({ from: "a", to: "b", kind: "road" });
    m.addLink({ from: "b", to: "c", kind: "road" });
    m.addLink({ from: "c", to: "d", kind: "road" });
    m.addLink({ from: "a", to: "d", kind: "path", travel_hours: 12 });
    const path = m.findPath("a", "d");
    assert.deepEqual(path, ["a", "d"]);
  });

  it("returns null when no path exists", () => {
    const m = makeManager();
    m.upsertPlace({ id: "a", kind: "settlement", parent_id: "world", name: "A" });
    m.upsertPlace({ id: "b", kind: "settlement", parent_id: "world", name: "B" });
    assert.equal(m.findPath("a", "b"), null);
  });
});

describe("WorldMapManager attachments", () => {
  it("attachRealizedScene + markVisited + addTrigger", () => {
    const m = makeManager();
    m.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "R" });
    m.attachRealizedScene("robledo", "scene_robledo_v1");
    m.markVisited("robledo");
    m.addTrigger("robledo", {
      id: "first_in_robledo",
      when: { type: "first_visit" },
      consequences: [{ type: "story_update", delta: "Llegas a Robledo" }],
    });
    const r = m.get("robledo")!;
    assert.equal(r.realized_scene_id, "scene_robledo_v1");
    assert.equal(r.visited, true);
    assert.equal(r.triggers.length, 1);
    assert.equal(r.triggers[0].when.type, "first_visit");
  });

  it("addTrigger replaces by id when re-registered", () => {
    const m = makeManager();
    m.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "R" });
    m.addTrigger("robledo", {
      id: "t1",
      when: { type: "first_visit" },
      consequences: [{ type: "story_update", delta: "v1" }],
    });
    m.addTrigger("robledo", {
      id: "t1",
      when: { type: "first_visit" },
      consequences: [{ type: "story_update", delta: "v2" }],
    });
    const r = m.get("robledo")!;
    assert.equal(r.triggers.length, 1);
    assert.deepEqual(r.triggers[0].consequences, [
      { type: "story_update", delta: "v2" },
    ]);
  });
});

describe("WorldMapManager serialization", () => {
  it("serialize/fromSerialized roundtrip preserves the map", () => {
    const m = makeManager();
    m.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "R" });
    m.upsertPlace({ id: "puerto", kind: "settlement", parent_id: "world", name: "P" });
    m.addLink({ from: "robledo", to: "puerto", kind: "road", travel_hours: 8 });
    const wire = JSON.parse(JSON.stringify(m.serialize()));
    const m2 = WorldMapManager.fromSerialized(wire);
    assert.equal(m2.get("robledo")?.name, "R");
    assert.deepEqual(m2.findPath("robledo", "puerto"), ["robledo", "puerto"]);
  });
});
