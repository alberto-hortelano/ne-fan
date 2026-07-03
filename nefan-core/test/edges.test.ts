import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WorldMapManager } from "../src/world-map/world-map.js";
import { oppositeEdge, resolveExitEdge } from "../src/world-map/edges.js";
import type { PlaceLink } from "../src/world-map/types.js";

function makeMap(): WorldMapManager {
  const wm = new WorldMapManager(WorldMapManager.createEmpty());
  wm.upsertPlace({ id: "region", kind: "region", parent_id: "world", name: "Región" });
  return wm;
}

function place(wm: WorldMapManager, id: string, pos?: [number, number]): void {
  wm.upsertPlace({ id, kind: "settlement", parent_id: "region", name: id, approx_position: pos });
}

const link = (from: string, to: string, edge?: PlaceLink["edge"]): PlaceLink => ({
  from,
  to,
  kind: "path",
  bidirectional: true,
  edge,
});

describe("oppositeEdge", () => {
  it("maps each edge to its opposite", () => {
    assert.equal(oppositeEdge("north"), "south");
    assert.equal(oppositeEdge("south"), "north");
    assert.equal(oppositeEdge("east"), "west");
    assert.equal(oppositeEdge("west"), "east");
  });
});

describe("resolveExitEdge", () => {
  it("uses link.edge directly when traversing forward", () => {
    const wm = makeMap();
    place(wm, "a");
    place(wm, "b");
    assert.equal(resolveExitEdge(wm, "a", link("a", "b", "east")), "east");
  });

  it("uses the opposite edge when traversing the link in reverse", () => {
    const wm = makeMap();
    place(wm, "a");
    place(wm, "b");
    assert.equal(resolveExitEdge(wm, "b", link("a", "b", "east")), "west");
  });

  it("falls back to the approx_position heuristic (4 quadrants)", () => {
    const wm = makeMap();
    place(wm, "centro", [10, 10]);
    place(wm, "este", [20, 12]);   // dx=10 domina → east
    place(wm, "oeste", [1, 9]);    // dx=-9 domina → west
    place(wm, "sur", [11, 25]);    // dy=15 domina → south (y+ = south)
    place(wm, "norte", [8, 2]);    // dy=-8 domina → north
    assert.equal(resolveExitEdge(wm, "centro", link("centro", "este")), "east");
    assert.equal(resolveExitEdge(wm, "centro", link("centro", "oeste")), "west");
    assert.equal(resolveExitEdge(wm, "centro", link("centro", "sur")), "south");
    assert.equal(resolveExitEdge(wm, "centro", link("centro", "norte")), "north");
    // Y desde el otro extremo, el opuesto.
    assert.equal(resolveExitEdge(wm, "este", link("centro", "este")), "west");
  });

  it("returns null on an exact tie (including overlapping places)", () => {
    const wm = makeMap();
    place(wm, "a", [0, 0]);
    place(wm, "diag", [5, 5]);   // |dx| === |dy| → empate
    place(wm, "encima", [0, 0]); // delta 0,0
    assert.equal(resolveExitEdge(wm, "a", link("a", "diag")), null);
    assert.equal(resolveExitEdge(wm, "a", link("a", "encima")), null);
  });

  it("returns null when a position is missing or parents differ", () => {
    const wm = makeMap();
    place(wm, "a", [0, 0]);
    place(wm, "sinpos");
    assert.equal(resolveExitEdge(wm, "a", link("a", "sinpos")), null);

    wm.upsertPlace({ id: "otra_region", kind: "region", parent_id: "world", name: "Otra" });
    wm.upsertPlace({ id: "lejos", kind: "settlement", parent_id: "otra_region", name: "Lejos", approx_position: [50, 0] });
    assert.equal(resolveExitEdge(wm, "a", link("a", "lejos")), null);
  });

  it("returns null for a link whose endpoint does not exist", () => {
    const wm = makeMap();
    place(wm, "a", [0, 0]);
    assert.equal(resolveExitEdge(wm, "a", link("a", "fantasma")), null);
  });
});
