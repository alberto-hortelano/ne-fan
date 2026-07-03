import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TILE_CELLS,
  neighborTile,
  parseTileKey,
  resolveBiome,
  tileKey,
  tileWorldRect,
  worldToTile,
} from "../src/scene/tile.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";

describe("geometría de tile", () => {
  it("tile (0,0) está centrado en el origen; vecinos contiguos", () => {
    assert.deepEqual(tileWorldRect(0, 0), { minX: -32, minZ: -32, maxX: 32, maxZ: 32 });
    assert.deepEqual(tileWorldRect(1, 0), { minX: 32, minZ: -32, maxX: 96, maxZ: 32 });
    assert.deepEqual(tileWorldRect(-1, 2), { minX: -96, minZ: 96, maxX: -32, maxZ: 160 });
  });

  it("worldToTile usa round (consistente con el rect centrado)", () => {
    assert.deepEqual(worldToTile(0, 0), { tx: 0, ty: 0 });
    assert.deepEqual(worldToTile(31.9, -31.9), { tx: 0, ty: 0 });
    assert.deepEqual(worldToTile(32.1, 0), { tx: 1, ty: 0 });
    assert.deepEqual(worldToTile(-33, 70), { tx: -1, ty: 1 });
  });

  it("tileKey/parseTileKey round-trip con negativos", () => {
    assert.equal(tileKey(-3, 7), "tile_-3_7");
    assert.deepEqual(parseTileKey("tile_-3_7"), { tx: -3, ty: 7 });
    assert.equal(parseTileKey("taberna_interior"), null);
  });

  it("neighborTile respeta la convención de ejes (north = -z)", () => {
    assert.deepEqual(neighborTile(0, 0, "north"), { tx: 0, ty: -1 });
    assert.deepEqual(neighborTile(0, 0, "south"), { tx: 0, ty: 1 });
    assert.deepEqual(neighborTile(2, -1, "east"), { tx: 3, ty: -1 });
    assert.deepEqual(neighborTile(2, -1, "west"), { tx: 1, ty: -1 });
  });

  it("resolveBiome: catálogo, char reservado, desconocido fail-loud", () => {
    assert.deepEqual(resolveBiome("forest_floor"), { char: "g", name: "suelo de bosque" });
    assert.deepEqual(resolveBiome("a"), { char: "a", name: "a" });
    assert.throws(() => resolveBiome("lava"), /desconocido/);
    assert.throws(() => resolveBiome(undefined), /requerido/);
  });
});

/** Tile de bosque con un camino que entra por el oeste (fila 41) y sale por el
 *  este (fila 52) — el caso canónico de simplificación del plan. */
function makeForestTile(): Record<string, unknown> {
  return {
    tile: { tx: 1, ty: 0 },
    scene_id: "tile_1_0",
    scene_description: "Bosque espeso con una senda.",
    biome: "forest_floor",
    terrain_features: [
      {
        type: "path",
        points: [[0, 41], [64, 46], [128, 52]],
        width: 2,
        at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 52 }],
      },
    ],
    vegetation_zones: [{ type: "pino", area: "rest", density: 0.1 }],
    entities: [],
    ambient_event: "",
  };
}

describe("expansión de tiles (Format D v3)", () => {
  it("rellena el bioma 128×128 y rasteriza el camino tocando ambos bordes", () => {
    const out = expandScenePrimitives(makeForestTile());
    const grid = out.terrain as string[];
    assert.equal(grid.length, TILE_CELLS);
    assert.ok(grid.every((row) => row.length === TILE_CELLS));
    assert.equal(out.__expanded, true);
    // El fill base es el char del bioma.
    assert.equal(grid[0][0], "g");
    assert.equal((out.terrain_legend as Record<string, unknown>).g, "suelo de bosque");
    // El camino toca el borde oeste alrededor de la fila 41…
    assert.equal(grid[41][0], "_", `borde oeste fila 41: "${grid[41][0]}"`);
    // …y el este alrededor de la fila 52.
    assert.equal(grid[52][TILE_CELLS - 1], "_", `borde este fila 52: "${grid[52][TILE_CELLS - 1]}"`);
    // Y cruza el interior (algún "_" en la columna central).
    const midCol = 64;
    assert.ok(grid.some((row) => row[midCol] === "_"), "el camino cruza el centro");
  });

  it("el scatter 'rest' es determinista, respeta el bioma y no invade el camino ni su margen", () => {
    const a = expandScenePrimitives(makeForestTile());
    const b = expandScenePrimitives(makeForestTile());
    const treesA = (a.entities as Record<string, unknown>[]).filter((e) => e.kind === "tree");
    const treesB = (b.entities as Record<string, unknown>[]).filter((e) => e.kind === "tree");
    assert.ok(treesA.length > 500, `density 0.1 sobre ~16k celdas debería plantar >500, plantó ${treesA.length}`);
    assert.deepEqual(treesA, treesB, "misma seed → mismo scatter");
    const grid = a.terrain as string[];
    for (const t of treesA) {
      const [c, r] = t.cell as [number, number];
      assert.equal(grid[r][c], "g", `árbol ${t.id} sobre "${grid[r][c]}" en (${c},${r})`);
      // Margen de 1 celda alrededor del camino.
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ch = grid[r + dr]?.[c + dc];
        assert.ok(ch !== "_", `árbol ${t.id} pegado al camino en (${c},${r})`);
      }
    }
  });

  it("terrain_patches estampa y valida rangos", () => {
    const tile = makeForestTile();
    tile.terrain_patches = [{ at: [10, 10], rows: ["ss", "s_"] }];
    const out = expandScenePrimitives(tile);
    const grid = out.terrain as string[];
    assert.equal(grid[10].slice(10, 12), "ss");
    assert.equal(grid[11].slice(10, 12), "s_");

    const bad = makeForestTile();
    bad.terrain_patches = [{ at: [127, 0], rows: ["ss"] }];
    assert.throws(() => expandScenePrimitives(bad), /se sale del tile/);
  });

  it("rechaza tiles con size/terrain completos y biome desconocido", () => {
    const withTerrain = makeForestTile();
    withTerrain.terrain = ["ggg"];
    assert.throws(() => expandScenePrimitives(withTerrain), /biome.*primitivas|no lleva size\/terrain/);

    const badBiome = makeForestTile();
    badBiome.biome = "lava";
    assert.throws(() => expandScenePrimitives(badBiome), /desconocido/);
  });

  it("las structures se estampan sobre el tile (interiores en el plano)", () => {
    const tile = makeForestTile();
    tile.structures = [
      { type: "room", rect: [30, 30, 12, 10], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 5, width: 3 }] },
    ];
    const out = expandScenePrimitives(tile);
    const grid = out.terrain as string[];
    assert.equal(grid[30].slice(30, 42), "W".repeat(12));
    assert.equal(grid[35][30], "W");
    assert.equal(grid[33][35], "o");
    // Puerta al sur (fila 39), 3 celdas desde at=5.
    assert.equal(grid[39].slice(35, 38), "___");
  });

  it("area:'rest' fuera de un tile es fail-loud", () => {
    const legacy = {
      scene_id: "s",
      size: { cols: 8, rows: 8, meters_per_cell: 1 },
      terrain: Array.from({ length: 8 }, () => "g".repeat(8)),
      vegetation_zones: [{ type: "pino", area: "rest", density: 0.2 }],
      entities: [],
    };
    assert.throws(() => expandScenePrimitives(legacy), /solo está disponible en tiles/);
  });
});
