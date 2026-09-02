import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeTileEdges, matchCrossings } from "../src/scene/tile-edges.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { TILE_CELLS } from "../src/scene/tile.js";
import { forestTile } from "./fixtures/tiles.js";

const forestTileWithPath = (): Record<string, unknown> =>
  expandScenePrimitives(forestTile({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0" }));

describe("computeTileEdges", () => {
  it("detecta los cruces del camino en los bordes oeste y este con su at", () => {
    const edges = computeTileEdges(forestTileWithPath());
    const west = edges.west.crossings;
    const east = edges.east.crossings;
    assert.equal(west.length, 1, `west: ${JSON.stringify(west)}`);
    assert.equal(west[0].type, "path");
    assert.ok(Math.abs(west[0].at - 41) <= 1, `west at=${west[0].at}`);
    assert.equal(east.length, 1, `east: ${JSON.stringify(east)}`);
    assert.ok(Math.abs(east[0].at - 52) <= 1, `east at=${east[0].at}`);
    // Los bordes sin nada no tienen cruces y conservan el bioma.
    assert.deepEqual(edges.north.crossings, []);
    assert.equal(edges.north.biome, "forest_floor");
  });

  it("fail-loud con un grid que no es de tile", () => {
    assert.throws(
      () => computeTileEdges({ terrain: ["ggg"], biome: "grass" }),
      new RegExp(`${TILE_CELLS}x${TILE_CELLS}`),
    );
  });

  // `ground` es la ÚNICA vía de costuras: un tile que declara ahí su
  // camino/agua/puente debe exponer los tres cruces en el grid
  // (rasterizeGroundToGrid en scene-expand).
  it("deriva cruces de `ground`: path→camino, water→río, deck→puente", () => {
    const expanded = expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "grass",
      ground: [
        // Camino oeste→este que aterriza en ambos bordes (row ~64).
        { id: "camino", kind: "path", points: [[0, 64], [64, 63], [128, 64]], w: 2 },
        // Río vertical norte→sur en la columna 30.
        { id: "rio", kind: "water", rect: [29, 0, 3, 128] },
        // Puente (deck) que cruza el río donde pasa el camino.
        { id: "puente", kind: "deck", rect: [29, 62, 3, 4], material: "wood" },
      ],
      entities: [],
    });
    const edges = computeTileEdges(expanded);
    // Camino en oeste y este cerca de row 64.
    assert.equal(edges.west.crossings[0]?.type, "path", `west: ${JSON.stringify(edges.west.crossings)}`);
    assert.ok(Math.abs(edges.west.crossings[0].at - 64) <= 2);
    assert.equal(edges.east.crossings[0]?.type, "path", `east: ${JSON.stringify(edges.east.crossings)}`);
    assert.ok(Math.abs(edges.east.crossings[0].at - 64) <= 2);
    // Río (water→river) en norte y sur cerca de col 30.
    assert.equal(edges.north.crossings[0]?.type, "river", `north: ${JSON.stringify(edges.north.crossings)}`);
    assert.ok(Math.abs(edges.north.crossings[0].at - 30) <= 2);
    assert.equal(edges.south.crossings[0]?.type, "river");
  });
});

describe("matchCrossings", () => {
  const path = (at: number) => ({ type: "path" as const, at, width: 2 });

  it("continuación exacta y con tolerancia ±2", () => {
    assert.deepEqual(matchCrossings([path(41)], [path(41)]).missing, []);
    assert.deepEqual(matchCrossings([path(41)], [path(43)]).missing, []);
    assert.equal(matchCrossings([path(41)], [path(44)]).missing.length, 1);
  });

  it("categorías compatibles: path↔road, river↔bridge; incompatibles fallan", () => {
    assert.deepEqual(matchCrossings([path(10)], [{ type: "road", at: 10, width: 3 }]).missing, []);
    assert.deepEqual(
      matchCrossings([{ type: "river", at: 20, width: 3 }], [{ type: "bridge", at: 20, width: 3 }]).missing,
      [],
    );
    assert.equal(
      matchCrossings([{ type: "river", at: 20, width: 3 }], [path(20)]).missing.length,
      1,
    );
  });
});
