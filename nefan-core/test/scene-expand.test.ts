import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { expandScenePrimitives, hasUnexpandedPrimitives } from "../src/scene/scene-expand.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";
import { TILE_CELLS } from "../src/scene/tile.js";

/** Un tile crudo como lo emite el motor: bioma + un rasgo de `ground` (una
 *  balsa de agua) y sin grid. Lo ÚNICO que el expander hace hoy es sintetizar
 *  ese grid: el decor pegado al muro se retiró con #399 porque buscaba un
 *  char de muro que ningún productor escribía. */
function makeTile(): Record<string, unknown> {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "Pradera con una balsa.",
    biome: "grass",
    ground: [{ id: "balsa", kind: "water", rect: [10, 10, 6, 4] }],
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1] },
    ],
  };
}

describe("expandScenePrimitives", () => {
  it("is idempotent (a second expansion is a no-op)", () => {
    const once = expandScenePrimitives(makeTile());
    const twice = expandScenePrimitives(once);
    assert.equal(twice, once);
    assert.equal(hasUnexpandedPrimitives(once), false);
  });

  it("solo un tile sin la marca tiene algo que expandir", () => {
    assert.equal(hasUnexpandedPrimitives(makeTile()), true);
    assert.equal(hasUnexpandedPrimitives({ ...makeTile(), __expanded: true }), false);
    // Sin `tile` no hay bioma que rellenar ni `ground` que rasterizar: la
    // escena se devuelve tal cual (misma referencia).
    const sinTile: Record<string, unknown> = { ...makeTile() };
    delete sinTile.tile;
    assert.equal(hasUnexpandedPrimitives(sinTile), false);
    assert.equal(expandScenePrimitives(sinTile), sinTile);
  });

  it("sintetiza el grid 128×128 del bioma y rasteriza el agua declarada", () => {
    const out = expandScenePrimitives(makeTile());
    const grid = out.terrain as string[];
    assert.equal(grid.length, TILE_CELLS);
    assert.ok(grid.every((row) => row.length === TILE_CELLS));
    assert.equal(grid[12][12], "w", "dentro de la balsa: agua");
    assert.equal(grid[64][64], "g", "fuera: el fill del bioma");
    assert.equal(out.__expanded, true);
  });

  it("formatDToWorld expands defensively and the water collides", () => {
    const world = formatDToWorld(makeTile());
    const tg = world.terrain_grid as { grid: string[]; solid_chars: string[] };
    assert.equal(tg.grid.length, TILE_CELLS, "la fixture cruda llega expandida");
    assert.ok(tg.solid_chars.includes("w"));
    const col = createTerrainCollider(tg as never)!;
    // Celda (12,12) de la balsa. mpc 0,5 y tile centrado en el origen (64 m de
    // lado): centro de la celda x = 12*0,5 − 32 + 0,25 = −25,75 ; z igual.
    assert.ok(col.blocksCircle(-25.75, -25.75, 0.1));
    // Celda (64,64), hierba: x = 64*0,5 − 32 + 0,25 = 0,25 → transitable.
    assert.ok(!col.blocksCircle(0.25, 0.25, 0.1));
  });
});
