import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { solidGridFromMasks, type AlphaMask } from "../src/scene/image-collision.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";

/** Máscara rectangular llena (alpha 255) de w×h px colocada en bbox. */
function fullMask(bbox: [number, number, number, number], imgW = 64, imgH = 64): AlphaMask {
  const [, , bw, bh] = bbox;
  return {
    alpha: new Uint8Array(bw * bh).fill(255),
    width: bw,
    height: bh,
    imageBbox: bbox,
    imgW,
    imgH,
  };
}

describe("solidGridFromMasks", () => {
  // Imagen 64×64, grid 8×8 → celda = 8×8 px.
  it("rectángulo lleno marca exactamente sus celdas", () => {
    const grid = solidGridFromMasks([fullMask([8, 16, 16, 8])], 8, 8);
    assert.ok(grid);
    // bbox x 8..24 → cols 1-2; y 16..24 → row 2.
    assert.equal(grid[2], "gSSggggg");
    for (const [r, line] of grid.entries()) {
      if (r !== 2) assert.equal(line, "gggggggg", `fila ${r} debe estar vacía`);
    }
  });

  it("cobertura parcial bajo el umbral no marca la celda", () => {
    // 3×8 px dentro de una celda de 8×8 = 37.5% < 50%.
    const under = solidGridFromMasks([fullMask([0, 0, 3, 8])], 8, 8);
    assert.equal(under, null);
    // 5×8 px = 62.5% ≥ 50%.
    const over = solidGridFromMasks([fullMask([0, 0, 5, 8])], 8, 8);
    assert.ok(over);
    assert.equal(over[0][0], "S");
  });

  it("sprite 1×1 estirado por bbox cubre todo el bbox (caso mock)", () => {
    const m: AlphaMask = {
      alpha: new Uint8Array([255]),
      width: 1,
      height: 1,
      imageBbox: [16, 16, 16, 16],
      imgW: 64,
      imgH: 64,
    };
    const grid = solidGridFromMasks([m], 8, 8);
    assert.ok(grid);
    assert.equal(grid[2], "ggSSgggg");
    assert.equal(grid[3], "ggSSgggg");
  });

  it("alpha transparente no marca nada", () => {
    const m = fullMask([0, 0, 32, 32]);
    (m.alpha as Uint8Array).fill(0);
    assert.equal(solidGridFromMasks([m], 8, 8), null);
  });

  it("sin máscaras devuelve null", () => {
    assert.equal(solidGridFromMasks([], 8, 8), null);
  });

  it("máscaras solapadas no doblan la cobertura (cap al área de celda)", () => {
    // Dos máscaras de 3×8 px idénticas: 37.5% + 37.5% solapado sigue siendo 37.5%.
    const grid = solidGridFromMasks([fullMask([0, 0, 3, 8]), fullMask([0, 0, 3, 8])], 8, 8);
    assert.equal(grid, null);
  });

  it("lanza con bbox fuera de imagen o alpha inconsistente", () => {
    assert.throws(() => solidGridFromMasks([fullMask([60, 0, 16, 8])], 8, 8), /bbox/);
    const bad = fullMask([0, 0, 8, 8]);
    bad.width = 4;
    assert.throws(() => solidGridFromMasks([bad], 8, 8), /alpha/);
    assert.throws(() => solidGridFromMasks([], 0, 8), /inválido/);
  });

  it("el grid resultante alimenta createTerrainCollider", () => {
    const grid = solidGridFromMasks([fullMask([8, 16, 16, 8])], 8, 8)!;
    const collider = createTerrainCollider({
      grid,
      cols: 8,
      rows: 8,
      meters_per_cell: 8,
      origin: [-32, -32],
      solid_chars: ["S"],
    });
    assert.ok(collider);
    assert.equal(collider.solidCellCount, 2);
    // Celda (1,2) = mundo x -24..-16, z -16..-8: moverse dentro bloquea.
    assert.equal(collider.blocksMove(-30, -12, -20, -12, 0.4), true);
    // Lejos de las celdas sólidas: libre.
    assert.equal(collider.blocksMove(10, 10, 12, 10, 0.4), false);
  });
});
