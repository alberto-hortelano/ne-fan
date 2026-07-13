import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { prismQuads, cylinderGeom, type ViewProjLike } from "../src/scene/view-prism.js";

/** Espejos inline de las proyecciones de vista del cliente 2D
 *  (nefan-html/src/renderer/projection.ts). */
const TOPDOWN: ViewProjLike = {
  verticalScale: 1.0,
  worldToView: (x, z) => [x, z],
};
const ISO: ViewProjLike = {
  verticalScale: 0.75,
  worldToView: (x, z) => [x - z, (x + z) / 2],
};

describe("prismQuads", () => {
  it("topdown: cara este degenerada, cara sur rectangular, tapa a −h", () => {
    const g = prismQuads(0, 0, 2, 2, 3, TOPDOWN);
    assert.deepEqual(g.base, [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    assert.deepEqual(g.top, [[-1, -4], [1, -4], [1, -2], [-1, -2]]);
    assert.equal(g.east, undefined, "cara este degenera en topdown (área 0)");
    assert.deepEqual(g.south, [[-1, 1], [1, 1], [1, -2], [-1, -2]]);
    assert.equal(g.baselineViewY, 1);
  });

  it("iso: rombo de huella, dos caras visibles y tapa elevada h·0.75", () => {
    const g = prismQuads(0, 0, 2, 2, 2, ISO);
    // nw(-1,-1)→(0,-1); ne(1,-1)→(2,0); se(1,1)→(0,1); sw(-1,1)→(-2,0)
    assert.deepEqual(g.base, [[0, -1], [2, 0], [0, 1], [-2, 0]]);
    assert.deepEqual(g.top, [[0, -2.5], [2, -1.5], [0, -0.5], [-2, -1.5]]);
    assert.ok(g.south, "cara sur visible en iso");
    assert.ok(g.east, "cara este visible en iso");
    // Baseline = vy de la esquina SE del rombo (la más al sur en vista).
    assert.equal(g.baselineViewY, 1);
    assert.deepEqual(g.viewBounds, { minX: -2, minY: -2.5, maxX: 2, maxY: 1 });
  });

  it("h=0 no emite caras (huella plana)", () => {
    const g = prismQuads(5, 3, 2, 1, 0, ISO);
    assert.equal(g.south, undefined);
    assert.equal(g.east, undefined);
    assert.deepEqual(g.top, g.base);
  });
});

describe("cylinderGeom", () => {
  it("topdown: círculo (rx=ry=r) con tapa a −h", () => {
    const c = cylinderGeom(0, 0, 1.5, 2, TOPDOWN);
    assert.deepEqual(c.center, [0, 0]);
    assert.ok(Math.abs(c.rx - 1.5) < 1e-9);
    assert.ok(Math.abs(c.ry - 1.5) < 1e-9);
    assert.equal(c.topCy, -2);
    assert.equal(c.baselineViewY, 1.5);
  });

  it("iso: semiejes r√2 y r√2/2 (espejo de groundEllipse del compositor)", () => {
    const r = 2;
    const c = cylinderGeom(0, 0, r, 4, ISO);
    assert.ok(Math.abs(c.rx - r * Math.SQRT2) < 1e-9, `rx=${c.rx}`);
    assert.ok(Math.abs(c.ry - (r * Math.SQRT2) / 2) < 1e-9, `ry=${c.ry}`);
    assert.equal(c.topCy, 0 - 4 * 0.75);
  });
});
