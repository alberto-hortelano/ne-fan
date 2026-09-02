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
import { CAMINO_OESTE_ESTE, forestTile } from "./fixtures/tiles.js";

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

  it("resolveBiome: catálogo, char del grid, desconocido fail-loud", () => {
    assert.equal(resolveBiome("forest_floor"), "g");
    assert.equal(resolveBiome("a"), "a");
    assert.throws(() => resolveBiome("lava"), /desconocido/);
    assert.throws(() => resolveBiome(undefined), /requerido/);
  });
});

const makeForestTile = (): Record<string, unknown> =>
  forestTile({
    scene_description: "Bosque espeso con una senda.",
    vegetation_zones: [{ type: "pino", area: "rest", density: 0.02 }],
    ambient_event: "",
  });

describe("expansión de tiles (Format D v3)", () => {
  it("rellena el bioma 128×128 y rasteriza el camino tocando ambos bordes", () => {
    const out = expandScenePrimitives(makeForestTile());
    const grid = out.terrain as string[];
    assert.equal(grid.length, TILE_CELLS);
    assert.ok(grid.every((row) => row.length === TILE_CELLS));
    assert.equal(out.__expanded, true);
    // El fill base es el char del bioma, y el tile expandido no lleva nada
    // más del terreno que el grid: ni nombres por char ni solidez declarada.
    assert.equal(grid[0][0], "g");
    assert.deepEqual(
      Object.keys(out).filter((k) => k.startsWith("terrain")),
      ["terrain"],
      "el único campo de terreno que escribe el expander es el grid",
    );
    // El camino toca el borde oeste alrededor de la fila 41…
    assert.equal(grid[41][0], "_", `borde oeste fila 41: "${grid[41][0]}"`);
    // …y el este alrededor de la fila 52.
    assert.equal(grid[52][TILE_CELLS - 1], "_", `borde este fila 52: "${grid[52][TILE_CELLS - 1]}"`);
    // Y cruza el interior (algún "_" en la columna central).
    const midCol = 64;
    assert.ok(grid.some((row) => row[midCol] === "_"), "el camino cruza el centro");
  });

  it("rechaza tiles con size/terrain completos y biome desconocido", () => {
    const withTerrain = makeForestTile();
    withTerrain.terrain = ["ggg"];
    assert.throws(() => expandScenePrimitives(withTerrain), /biome.*primitivas|no lleva size\/terrain/);

    const badBiome = makeForestTile();
    badBiome.biome = "lava";
    assert.throws(() => expandScenePrimitives(badBiome), /desconocido/);
  });

  it("formatDToWorld emite world_rect global y posiciones globales para tiles", async () => {
    const { formatDToWorld } = await import("../src/scene/scene-normalize.js");
    const { createTerrainCollider } = await import("../src/scene/terrain-collision.js");
    const tile = makeForestTile(); // tx=1, ty=0 → rect [32..96, -32..32]
    (tile.entities as Record<string, unknown>[]).push(
      { id: "npc1", kind: "npc", name: "Guía", cell: [0, 0], footprint: [1, 1], glyph: "n" },
    );
    const w = formatDToWorld(tile);
    assert.deepEqual(w.world_rect, { minX: 32, minZ: -32, maxX: 96, maxZ: 32 });
    assert.deepEqual(w.tile, { tx: 1, ty: 0 });
    // NPC en celda (0,0) → centro global (32.25, -31.75).
    const npc = (w.npcs as { position: number[] }[])[0];
    assert.deepEqual(npc.position, [32.25, 0, -31.75]);
    const tg = w.terrain_grid as { origin: [number, number] };
    assert.deepEqual(tg.origin, [32, -32]);
    // El collider bloquea en coordenadas GLOBALES: una charca declarada en
    // `ground` sobre la esquina NW del tile.
    const tile2 = makeForestTile();
    tile2.ground = [CAMINO_OESTE_ESTE, { id: "charca", kind: "water", rect: [0, 0, 6, 2] }];
    const w2 = formatDToWorld(tile2);
    const col = createTerrainCollider(w2.terrain_grid as never)!;
    // Celda (0,0) del tile (1,0) = mundo [32..32.5): su centro es sólido (agua).
    assert.ok(col.blocksCircle(32.25, -31.75, 0.1));
    assert.ok(!col.blocksCircle(0, 0, 0.1), "el origen del mundo NO pertenece a este tile");
  });

  it("las escenas legacy conservan el rect centrado (identidad)", async () => {
    const { formatDToWorld } = await import("../src/scene/scene-normalize.js");
    const legacy = formatDToWorld({
      scene_id: "s",
      size: { cols: 10, rows: 6, meters_per_cell: 2 },
      terrain: Array.from({ length: 6 }, () => "g".repeat(10)),
      entities: [{ id: "b", kind: "building", name: "B", cell: [2, 1], footprint: [4, 2], glyph: "H" }],
    });
    assert.deepEqual(legacy.world_rect, { minX: -10, minZ: -6, maxX: 10, maxZ: 6 });
    assert.equal(legacy.tile, undefined);
    const obj = (legacy.objects as { position: number[] }[])[0];
    assert.deepEqual(obj.position, [-2, 0, -2]); // misma posición que siempre
  });
});
