import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeTileEdges, matchCrossings } from "../src/scene/tile-edges.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { TILE_CELLS } from "../src/scene/tile.js";

function forestTileWithPath(): Record<string, unknown> {
  return expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    biome: "forest_floor",
    terrain_features: [
      {
        type: "path",
        points: [[0, 41], [64, 46], [128, 52]],
        width: 2,
        at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 52 }],
      },
    ],
    entities: [],
  });
}

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

  it("clasifica runs por char (río→river, s→road) y separa runs distintos", () => {
    // Tile con un río vertical que cruza norte→sur y una carretera al este.
    const expanded = expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "grass",
      terrain_features: [
        { type: "river", points: [[30, 0], [30, 128]], width: 3, at_edges: [{ edge: "north", at: 30 }, { edge: "south", at: 30 }] },
        { type: "road", points: [[128, 90], [100, 90]], width: 2, at_edges: [{ edge: "east", at: 90 }] },
      ],
      entities: [],
    });
    const edges = computeTileEdges(expanded);
    assert.equal(edges.north.crossings[0]?.type, "river");
    assert.ok(Math.abs(edges.north.crossings[0].at - 30) <= 1);
    assert.equal(edges.south.crossings[0]?.type, "river");
    assert.equal(edges.east.crossings.length, 1);
    assert.equal(edges.east.crossings[0].type, "road");
    assert.ok(Math.abs(edges.east.crossings[0].at - 90) <= 1);
    assert.deepEqual(edges.west.crossings, []);
  });

  it("los muros en el borde NO cuentan como cruce", () => {
    const expanded = expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "grass",
      // Room pegada al borde norte (fila 0 = muro W).
      structures: [{ type: "room", rect: [50, 0, 10, 6], doors: [{ side: "south", at: 4 }] }],
      entities: [],
    });
    const edges = computeTileEdges(expanded);
    assert.deepEqual(edges.north.crossings, []);
  });

  it("fail-loud con un grid que no es de tile", () => {
    assert.throws(
      () => computeTileEdges({ terrain: ["ggg"], biome: "grass" }),
      new RegExp(`${TILE_CELLS}x${TILE_CELLS}`),
    );
  });

  // Retirado terrain_features del contrato: `ground` es ahora la vía de
  // costuras. Un tile que declara su camino/agua SOLO en `ground` debe seguir
  // exponiendo los cruces en el grid (rasterizeGroundToGrid en scene-expand).
  it("deriva cruces de `ground` (path→camino, water→río, deck→puente) sin terrain_features", () => {
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
