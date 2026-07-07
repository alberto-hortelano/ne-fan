/** Tests de la colisión analítica de volúmenes: huellas en espacio de mundo,
 *  independientes de la perspectiva pintada. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { volumeCollisionGrid } from "../src/scene/blueprint/index.js";
import type { Volume } from "../src/scene/blueprint/index.js";
import { TILE_CELLS } from "../src/scene/tile.js";

const RECT = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };

function solidAt(grid: string[], c: number, r: number): boolean {
  return grid[r][c] === "S";
}

describe("blueprint/collision", () => {
  it("tile vacío → null", () => {
    assert.equal(volumeCollisionGrid([], RECT), null);
  });

  it("bush no bloquea; prop passable tampoco", () => {
    const vols: Volume[] = [
      { id: "m", label: "mata", type: "bush", at: [20, 20] },
      { id: "t", label: "toldo", type: "prop", at: [40, 40], shape: "box", passable: true },
    ];
    assert.equal(volumeCollisionGrid(vols, RECT), null);
  });

  it("building: anillo de muros con hueco de puerta, interior libre", () => {
    const vols: Volume[] = [
      {
        id: "casa",
        label: "casa",
        type: "building",
        rect: [20, 20, 20, 16],
        doors: [{ edge: "s", at: 8, w: 4 }],
      },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(g);
    assert.equal(g.cols, TILE_CELLS);
    assert.deepEqual(g.origin, [-32, -32]);
    assert.ok(solidAt(g.grid, 30, 20), "muro norte");
    assert.ok(solidAt(g.grid, 20, 28), "muro oeste");
    assert.ok(solidAt(g.grid, 39, 28), "muro este");
    assert.ok(solidAt(g.grid, 24, 35), "muro sur (fuera de la puerta)");
    assert.ok(!solidAt(g.grid, 30, 35), "hueco de puerta sur (at=8..12 → col 28..32)");
    assert.ok(!solidAt(g.grid, 30, 28), "interior libre");
  });

  it("wall + gate: la banda bloquea y el vano queda libre", () => {
    const vols: Volume[] = [
      { id: "muro", label: "muralla", type: "wall", points: [[0, 68], [128, 68]], width: 6, h: 7 },
      { id: "puerta", label: "puerta", type: "gate", at: [64, 68], w: 9, orient: "x" },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 20, 68), "muro bloquea");
    assert.ok(solidAt(g.grid, 110, 66), "muro bloquea (banda)");
    assert.ok(!solidAt(g.grid, 64, 68), "vano central libre");
    assert.ok(!solidAt(g.grid, 62, 66), "vano libre en todo el grosor");
    assert.ok(solidAt(g.grid, 56, 68), "jamba oeste sólida");
  });

  it("tower y tree: discos según radio", () => {
    const vols: Volume[] = [
      { id: "torre", label: "torre", type: "tower", at: [40, 40], r: 6 },
      { id: "roble", label: "roble", type: "tree", at: [90, 90] },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 40, 40), "centro de torre");
    assert.ok(solidAt(g.grid, 45, 40), "borde de torre");
    assert.ok(!solidAt(g.grid, 47, 40), "fuera de torre");
    assert.ok(solidAt(g.grid, 90, 90), "tronco");
    assert.ok(!solidAt(g.grid, 94, 90), "la copa NO bloquea");
  });

  it("huellas parcialmente fuera del tile se recortan sin lanzar", () => {
    const vols: Volume[] = [
      { id: "muro", label: "muralla", type: "wall", points: [[-8, 10], [136, 10]], width: 4, h: 7 },
    ];
    const g = volumeCollisionGrid(vols, RECT)!;
    assert.ok(solidAt(g.grid, 0, 10));
    assert.ok(solidAt(g.grid, 127, 10));
  });
});
