import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseGround, groundHasWater, type GroundFeature } from "../src/scene/blueprint/ground.js";
import { groundCollisionGrid } from "../src/scene/blueprint/ground-collision.js";
import { TILE_CELLS } from "../src/scene/tile.js";

const rect = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };

function features(raw: unknown): GroundFeature[] {
  const r = parseGround(raw);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r.features : [];
}

describe("parseGround", () => {
  it("acepta los cuatro kinds con sus formas", () => {
    const feats = features([
      { id: "senda", kind: "path", points: [[0, 41], [128, 50]], w: 4, material: "dirt" },
      { id: "plaza", kind: "area", ellipse: { center: [60, 60], rx: 16, ry: 12 }, material: "cobble" },
      { id: "rio", kind: "water", polygon: [[100, 0], [110, 0], [112, 128], [98, 128]] },
      { id: "puente", kind: "deck", rect: [98, 60, 16, 8], material: "wood" },
    ]);
    assert.equal(feats.length, 4);
  });

  it("rechaza id duplicado, kind desconocido y formas ambiguas", () => {
    assert.equal(parseGround([{ id: "a", kind: "water", rect: [0, 0, 1, 1] }, { id: "a", kind: "water", rect: [2, 2, 1, 1] }]).ok, false);
    assert.equal(parseGround([{ id: "a", kind: "lava", rect: [0, 0, 1, 1] }]).ok, false);
    assert.equal(parseGround([{ id: "a", kind: "water" }]).ok, false, "sin forma");
    assert.equal(
      parseGround([{ id: "a", kind: "water", rect: [0, 0, 1, 1], polygon: [[0, 0], [1, 0], [1, 1]] }]).ok,
      false,
      "dos formas",
    );
  });

  it("groundHasWater refleja los rasgos water", () => {
    assert.equal(groundHasWater(features([{ id: "p", kind: "path", points: [[0, 0], [1, 1]] }])), false);
    assert.equal(groundHasWater(features([{ id: "w", kind: "water", rect: [0, 0, 4, 4] }])), true);
  });

  it("acepta hill (loma/hondonada, h en metros) y rechaza h inválida", () => {
    const feats = features([
      { id: "loma", kind: "hill", label: "loma", ellipse: { center: [64, 64], rx: 24, ry: 18 }, h: 3.5 },
      { id: "vaguada", kind: "hill", polygon: [[10, 80], [40, 90], [30, 118]], h: -2 },
    ]);
    assert.equal(feats.length, 2);
    assert.equal(parseGround([{ id: "a", kind: "hill", rect: [0, 0, 10, 10], h: 0 }]).ok, false, "h=0");
    assert.equal(parseGround([{ id: "a", kind: "hill", rect: [0, 0, 10, 10], h: 9 }]).ok, false, "h>6");
    assert.equal(parseGround([{ id: "a", kind: "hill", rect: [0, 0, 10, 10], h: -9 }]).ok, false, "h<-6");
    assert.equal(parseGround([{ id: "a", kind: "hill", rect: [0, 0, 10, 10] }]).ok, false, "sin h");
    assert.equal(parseGround([{ id: "a", kind: "hill", h: 2 }]).ok, false, "sin forma");
  });

  it("hill no genera colisión (presentación pura)", () => {
    const grid = groundCollisionGrid(
      features([{ id: "monte", kind: "hill", rect: [0, 0, 128, 128], h: 5 }]),
      rect,
    );
    assert.equal(grid, null);
  });
});

describe("groundCollisionGrid", () => {
  it("el agua bloquea y el deck perfora (transitable sobre el agua)", () => {
    const grid = groundCollisionGrid(
      features([
        { id: "rio", kind: "water", rect: [40, 0, 10, 128] },
        { id: "puente", kind: "deck", rect: [38, 60, 14, 6] },
      ]),
      rect,
    )!;
    assert.ok(grid);
    assert.equal(grid.cols, TILE_CELLS);
    const solid = new Set(grid.solid_chars);
    // Dentro del río, fuera del puente: sólido.
    assert.ok(solid.has(grid.grid[10][45]));
    // Bajo el puente: transitable.
    assert.ok(!solid.has(grid.grid[62][45]));
    // Fuera del río: libre.
    assert.ok(!solid.has(grid.grid[10][20]));
  });

  it("polígono y elipse marcan por centro de celda (point-in-shape)", () => {
    const grid = groundCollisionGrid(
      features([
        { id: "lago", kind: "water", ellipse: { center: [30, 30], rx: 8, ry: 5 } },
        { id: "meandro", kind: "water", polygon: [[80, 80], [100, 80], [100, 100]] },
      ]),
      rect,
    )!;
    const solid = new Set(grid.solid_chars);
    assert.ok(solid.has(grid.grid[30][30]), "centro del lago");
    assert.ok(!solid.has(grid.grid[30][40]), "fuera del rx");
    assert.ok(!solid.has(grid.grid[24][30]), "fuera del ry");
    assert.ok(solid.has(grid.grid[85][95]), "dentro del triángulo");
    assert.ok(!solid.has(grid.grid[95][82]), "fuera del triángulo");
  });

  it("sin agua (o toda cubierta por decks) devuelve null", () => {
    assert.equal(groundCollisionGrid(features([{ id: "p", kind: "path", points: [[0, 0], [10, 10]] }]), rect), null);
    assert.equal(
      groundCollisionGrid(
        features([
          { id: "charca", kind: "water", rect: [10, 10, 4, 4] },
          { id: "tablas", kind: "deck", rect: [9, 9, 6, 6] },
        ]),
        rect,
      ),
      null,
    );
  });

  it("origin y metros por celda salen del rect del tile", () => {
    const grid = groundCollisionGrid(features([{ id: "w", kind: "water", rect: [0, 0, 4, 4] }]), rect)!;
    assert.deepEqual(grid.origin, [rect.minX, rect.minZ]);
    assert.equal(grid.meters_per_cell, 0.5);
  });

  it("v8: dims de plató — grid a cols/rows/mpc de la escena, no del tile", () => {
    // Plató 80×40 a 1 m/celda: con el grid del tile (128² a 0.5) el agua
    // quedaba desalineada del mundo (bug latente arreglado al parametrizar).
    const stageRect = { minX: -40, minZ: -20, maxX: 40, maxZ: 20 };
    const dims = { cols: 80, rows: 40, mpc: 1.0 };
    const grid = groundCollisionGrid(
      features([
        { id: "rio", kind: "water", rect: [30, 0, 6, 40] },
        { id: "vado", kind: "deck", rect: [30, 18, 6, 4], material: "stone" },
      ]),
      stageRect,
      dims,
    )!;
    assert.equal(grid.cols, 80);
    assert.equal(grid.rows, 40);
    assert.equal(grid.meters_per_cell, 1.0);
    const solid = new Set(grid.solid_chars);
    assert.ok(solid.has(grid.grid[5][32]), "río bloquea");
    assert.ok(!solid.has(grid.grid[19][32]), "el vado perfora");
    assert.ok(!solid.has(grid.grid[5][20]), "orilla libre");
  });
});
