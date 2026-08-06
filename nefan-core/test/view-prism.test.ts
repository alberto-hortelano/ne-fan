import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { prismQuads, cylinderGeom, type ViewProjLike } from "../src/scene/view-prism.js";

/** Espejo inline de la proyección de vista del cliente 2D
 *  (nefan-html/src/renderer/projection.ts): suelo identidad + cizalla
 *  oblicua en la altura. Cizalla −0.5 (en vez de la −0.35 real) para que
 *  la aritmética del test sea exacta en float. */
const OBLIQUE: ViewProjLike = {
  verticalScale: 1.0,
  shearX: -0.5,
  worldToView: (x, z) => [x, z],
};

describe("prismQuads", () => {
  it("oblicua: la tapa se desplaza (h·shearX, −h) y la cara este se materializa", () => {
    const g = prismQuads(0, 0, 2, 2, 2, OBLIQUE);
    assert.deepEqual(g.base, [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    // top = base + (2·(−0.5), −2·1)
    assert.deepEqual(g.top, [[-2, -3], [0, -3], [0, -1], [-2, -1]]);
    assert.ok(g.south, "cara sur visible");
    assert.ok(g.east, "cara este visible con la cizalla");
    assert.equal(g.baselineViewY, 1);
    assert.deepEqual(g.viewBounds, { minX: -2, minY: -3, maxX: 1, maxY: 1 });
  });

  it("h=0 no emite caras (huella plana)", () => {
    const g = prismQuads(5, 3, 2, 1, 0, OBLIQUE);
    assert.equal(g.south, undefined);
    assert.equal(g.east, undefined);
    assert.deepEqual(g.top, g.base);
  });
});

describe("cylinderGeom", () => {
  it("círculo (rx=ry=r, suelo identidad) con tapa desplazada por la cizalla", () => {
    const c = cylinderGeom(0, 0, 1.5, 2, OBLIQUE);
    assert.deepEqual(c.center, [0, 0]);
    assert.ok(Math.abs(c.rx - 1.5) < 1e-9);
    assert.ok(Math.abs(c.ry - 1.5) < 1e-9);
    assert.ok(Math.abs(c.topCx - 2 * -0.5) < 1e-9, `topCx=${c.topCx}`);
    assert.equal(c.topCy, -2);
    assert.equal(c.baselineViewY, 1.5);
    // El AABB cubre también la tapa desplazada al oeste.
    assert.ok(Math.abs(c.viewBounds.minX - (c.topCx - 1.5)) < 1e-9);
  });
});
