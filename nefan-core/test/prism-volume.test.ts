/** Volumen `prism` — geometría libre (contorno poligonal + altura): schema,
 *  colisión (relleno del polígono, gobernada por `solid`) y render como
 *  primitiva `polygon` en el builder del tile. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseVolumes, volumeCollisionGrid } from "../src/scene/blueprint/index.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";
import { tileWorldRect } from "../src/scene/tile.js";
import { volumePrimsForTile } from "../src/scene/greybox/volume-prims.js";
import type { Volume } from "../src/scene/blueprint/volumes.js";

/** Cuadrado 10..20 en celdas, altura 5 — el prism de referencia. */
function squarePrism(over: Partial<Record<string, unknown>> = {}): Volume {
  return {
    id: "p1",
    label: "plataforma irregular",
    type: "prism",
    points: [[10, 10], [20, 10], [20, 20], [10, 20]],
    h: 5,
    ...over,
  } as Volume;
}

const cell = (c: number, r: number) => ({ x: -32 + (c + 0.5) * 0.5, z: -32 + (r + 0.5) * 0.5 });

describe("prism — schema", () => {
  it("acepta un contorno ≥3 puntos + h; rechaza <3 puntos y sin h", () => {
    assert.equal(parseVolumes([squarePrism()]).ok, true);
    const few = parseVolumes([squarePrism({ points: [[10, 10], [20, 10]] })]);
    assert.equal(few.ok, false);
    const noH = parseVolumes([{ id: "x", label: "x", type: "prism", points: [[1, 1], [2, 1], [2, 2]] }]);
    assert.equal(noH.ok, false);
  });

  // `tall` era del occluder de la vista oblicua: decía si el volumen se
  // dibujaba encima de quien estuviera detrás. Retirado con ella — la altura
  // la lleva `h` y nadie interpretaba el campo. El candado es el .strict()
  // del zod, no un grep: "tall" es palabra corriente en inglés (el propio
  // prompt dice "a character is ~3.6 cells tall").
  it("rechaza `tall`, retirado con la vista oblicua", () => {
    const conTall = parseVolumes([squarePrism({ tall: false })]);
    assert.equal(conTall.ok, false, "un prism con `tall` tiene que fallar");
    assert.match(!conTall.ok ? conTall.error : "", /tall/);
  });
});

describe("prism — colisión (relleno del polígono)", () => {
  it("bloquea dentro del contorno y no fuera; solid:false no bloquea", () => {
    const rect = tileWorldRect(0, 0);
    const grid = volumeCollisionGrid([squarePrism()], rect);
    assert.ok(grid, "el prism sólido debe producir grid");
    const col = createTerrainCollider(grid)!;
    const inside = cell(15, 15);
    const outside = cell(4, 4);
    assert.ok(col.blocksCircle(inside.x, inside.z, 0.3), "centro del contorno bloquea");
    assert.ok(!col.blocksCircle(outside.x, outside.z, 0.3), "fuera no bloquea");

    const passable = volumeCollisionGrid([squarePrism({ solid: false })], rect);
    assert.equal(passable, null, "prism solid:false no aporta colisión");
  });
});

describe("prism — render del tile (primitiva polygon)", () => {
  it("emite un único prim `polygon` con esos puntos y altura h", () => {
    const prims = volumePrimsForTile(squarePrism(), []);
    assert.equal(prims.length, 1);
    const polys = prims.filter((p) => p.shape === "polygon");
    assert.equal(polys.length, 1);
    assert.equal(polys[0].size[0], 5, "grosor de extrusión = h");
    assert.deepEqual(polys[0].points, [[10, 10], [20, 10], [20, 20], [10, 20]]);
    assert.equal(polys[0].volId, "vol_p1");
  });
});
