import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { resolvePlaceTarget } from "../src/world-map/place-target.js";

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
    s1.recordEntitySpawned("boris", "npc", "scene", [0, 0, 0], { name: "Boris", current_place_id: "world" });
    const d1 = new NpcDirector(s1);
    d1.moveNpcToPlace("boris", "puerto");
    d1.arriveNpc("boris");
    await s1.establecer();

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

describe("NpcDirector.arriveNpc — teleport narrative-paced", () => {
  it("salta al anchor del place si el NPC sigue lejos; no salta si llegó a pie", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("g");
    // Anchor en tile (0,0), celdas 64..68 → centro mundo (1, 1).
    s.worldMap.upsertPlace({
      id: "plaza", kind: "site", parent_id: "world", name: "Plaza",
      anchor: { tx: 0, ty: 0, rect: [64, 64, 4, 4] },
    });
    s.worldMap.upsertPlace({ id: "lejos", kind: "site", parent_id: "world", name: "Sin anchor" });
    const director = new NpcDirector(s);

    // Viaje narrative-paced: el NPC está a 20 m → teleport al centro.
    s.recordEntitySpawned("boris", "npc", "tile_0_0", [20, 0, 20], { name: "Boris" });
    director.moveNpcToPlace("boris", "plaza");
    director.arriveNpc("boris");
    assert.deepEqual(s.getEntity("boris")!.position, [1, 0, 1]);

    // Llegada a pie (el sim lo dejó a <3 m): la posición no se toca.
    s.recordEntitySpawned("greta", "npc", "tile_0_0", [1.8, 0, 1.2], { name: "Greta" });
    director.moveNpcToPlace("greta", "plaza");
    director.arriveNpc("greta");
    assert.deepEqual(s.getEntity("greta")!.position, [1.8, 0, 1.2]);

    // Place sin anchor ni escena tile: sin coordenadas, sin teleport.
    s.recordEntitySpawned("cleo", "npc", "tile_0_0", [7, 0, 7], { name: "Cleo" });
    director.moveNpcToPlace("cleo", "lejos");
    director.arriveNpc("cleo");
    assert.deepEqual(s.getEntity("cleo")!.position, [7, 0, 7]);
  });
});

describe("resolvePlaceTarget — las tres vías del docblock y los dos null", () => {
  // Tile (2,-3), y NO (0,0): tileWorldRect da minX 96 · maxX 160 · minZ -224 ·
  // maxZ -160, centro (128, -192). Con tx o ty en {0,-1} el centro cae en 0 y
  // `(min+max)*2` o `min-max` dan lo mismo que el original: los mutantes
  // aritméticos del centro sobreviven por simetría y este test no los ve.
  // Medido el 2026-09-18: 14 de los 18 supervivientes eran `NoCoverage` porque
  // ninguna batería entraba en las vías (b) y (c) del docblock (#675).
  const TILE = { tx: 2, ty: -3 };
  const CENTRO = { x: 128, z: -192 };

  function conPlaces(places: Array<Parameters<NarrativeState["worldMap"]["upsertPlace"]>[0]>) {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("g");
    for (const p of places) s.worldMap.upsertPlace(p);
    return s;
  }

  it("(a) anchor con rect: el centro del rect en metros, dentro de su tile", () => {
    // rect [10,20,4,2] en celdas de 0,5 m → x = 96 + 12·0,5, z = -224 + 21·0,5.
    const s = conPlaces([{ id: "forja", kind: "site", parent_id: "world", name: "Forja", anchor: { ...TILE, rect: [10, 20, 4, 2] } }]);
    assert.deepEqual(resolvePlaceTarget(s, "forja"), { x: 102, z: -213.5 });
  });

  it("(b) anchor sin rect: el centro del tile", () => {
    const s = conPlaces([{ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea", anchor: { ...TILE } }]);
    assert.deepEqual(resolvePlaceTarget(s, "aldea"), CENTRO);
  });

  it("(c) sin anchor pero con escena realizada que es un tile: el centro de ese tile", () => {
    const s = conPlaces([{ id: "bosque", kind: "region", parent_id: "world", name: "Bosque", realized_scene_id: "tile_2_-3" }]);
    assert.deepEqual(resolvePlaceTarget(s, "bosque"), CENTRO);
  });

  it("null: la escena realizada no es un tile", () => {
    const s = conPlaces([{ id: "cripta", kind: "site", parent_id: "world", name: "Cripta", realized_scene_id: "escena_x" }]);
    assert.equal(resolvePlaceTarget(s, "cripta"), null);
  });

  it("null: el place no existe", () => {
    const s = conPlaces([]);
    assert.equal(resolvePlaceTarget(s, "atlantis"), null);
  });

  it("precedencia: con anchor y escena realizada, manda el anchor", () => {
    // El docblock dice «anchor O escena»; esto fija cuál gana cuando hay los dos.
    const s = conPlaces([{ id: "doble", kind: "site", parent_id: "world", name: "Doble", anchor: { ...TILE }, realized_scene_id: "tile_9_9" }]);
    assert.deepEqual(resolvePlaceTarget(s, "doble"), CENTRO);
  });
});
