import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTileGreyboxSpec,
  TILE_GREYBOX_VERSION,
  type TileGreyboxPlan,
} from "../src/scene/blueprint/greybox.js";
import { canonicalGreyboxJson } from "../src/scene/greybox/common.js";
import { PROJECTION, OBLIQUE_KX, OBLIQUE_KY } from "../src/scene/blueprint/projection.js";
import { volumeFootprint } from "../src/scene/blueprint/footprint.js";

function makePlan(): TileGreyboxPlan {
  return {
    biome: "grass",
    ground: [
      { id: "senda", kind: "path", points: [[0, 41], [70, 45], [128, 50]], w: 4, material: "dirt" },
      { id: "plaza", kind: "area", ellipse: { center: [64, 80], rx: 15, ry: 8.5 }, material: "cobble" },
      { id: "rio", kind: "water", polygon: [[100, 0], [110, 0], [112, 128], [98, 128]] },
      { id: "puente", kind: "deck", rect: [98, 44, 16, 8], material: "wood" },
    ],
    volumes: [
      { id: "taberna", label: "taberna", type: "building", rect: [52, 48, 24, 16], cutaway: true, doors: [{ edge: "s", at: 11, w: 4 }] },
      { id: "casa", label: "casa", type: "building", rect: [84, 20, 12, 10], wall_h: 5, roof: { kind: "gable" } },
      { id: "muralla", label: "muralla", type: "wall", points: [[0, 108], [128, 108]], width: 5, h: 7, crenellated: true },
      { id: "puerta_sur", label: "puerta", type: "gate", at: [64, 108], w: 9, h: 10, orient: "x" },
      { id: "roble", label: "roble", type: "tree", at: [30, 34], s: 1.2 },
      { id: "roca", label: "roca", type: "rock", at: [14, 74], s: 1.3 },
    ],
  };
}

describe("buildTileGreyboxSpec", () => {
  it("determinista: mismo plan + seedKey ⇒ mismo canónico (la clave de caché)", () => {
    const a = canonicalGreyboxJson(buildTileGreyboxSpec(makePlan(), "tile_0_0"));
    const b = canonicalGreyboxJson(buildTileGreyboxSpec(makePlan(), "tile_0_0"));
    assert.equal(a, b);
    assert.ok(a.includes(`"tile_greybox_version":${TILE_GREYBOX_VERSION}`));
  });

  it("seedKey distinto ⇒ detalle procedural distinto", () => {
    const a = canonicalGreyboxJson(buildTileGreyboxSpec(makePlan(), "tile_0_0"));
    const b = canonicalGreyboxJson(buildTileGreyboxSpec(makePlan(), "tile_1_0"));
    assert.notEqual(a, b);
  });

  it("cámara: view_box del compositor y cizalla oblicua exacta", () => {
    const spec = buildTileGreyboxSpec(makePlan(), "cam");
    assert.equal(spec.camera.kind, "ortho_shear");
    assert.deepEqual(spec.camera.view_box, PROJECTION.viewBox);
    assert.equal(spec.camera.kx, OBLIQUE_KX);
    assert.equal(spec.camera.ky, OBLIQUE_KY);
  });

  it("equivalencia de proyección: la cizalla del spec reproduce PROJECTION.pt a 1e-6", () => {
    const spec = buildTileGreyboxSpec(makePlan(), "equiv");
    // La cámara del cliente es ortográfica cenital (x→x de vista, z→y de
    // vista) con la matriz de cizalla x' = x + kx·y, z' = z − ky·y.
    const shear = (u: number, v: number, h: number): [number, number] => [
      u + spec.camera.kx * h,
      v - spec.camera.ky * h,
    ];
    for (const [u, v, h] of [
      [0, 0, 0], [64, 64, 0], [128, 128, 0], [30, 40, 8], [100, 20, 24], [5, 120, 32],
    ] as const) {
      const [ex, ey] = PROJECTION.pt(u, v, h);
      const [sx, sy] = shear(u, v, h);
      assert.ok(Math.abs(ex - sx) < 1e-6 && Math.abs(ey - sy) < 1e-6, `pt(${u},${v},${h})`);
    }
  });

  it("elements: mismo contrato de siempre — huella de volumeFootprint, bbox que la contiene", () => {
    const plan = makePlan();
    const spec = buildTileGreyboxSpec(plan, "els");
    assert.equal(spec.elements.length, plan.volumes.length);
    for (const v of plan.volumes) {
      const el = spec.elements.find((e) => e.id === v.id)!;
      assert.ok(el, v.id);
      const fp = volumeFootprint(v);
      assert.deepEqual(
        el.footprint_cells.map((n) => Math.round(n * 100) / 100),
        fp.cells.map((n) => Math.round(n * 100) / 100),
      );
      // El bbox proyectado contiene la huella del suelo (h=0 ⇒ identidad).
      // La huella DECLARADA de wall padea media anchura más allá de los
      // extremos (y un muro tallado por un gate ni siquiera cubre el vano):
      // ahí basta el solape, no la contención.
      const [bx, by, bw, bh] = el.bbox;
      if (v.type !== "wall") {
        assert.ok(bx <= fp.cells[0] + 0.01 && bx + bw >= fp.cells[2] - 0.01, `${v.id} bbox u`);
      }
      // Árbol: su huella declarada padea 1.2·s alrededor del tronco y la copa
      // proyectada (elevada, cizallada al noroeste) puede quedar una fracción
      // de celda por encima — media celda de tolerancia.
      const vTol = v.type === "tree" ? 0.6 : 0.01;
      assert.ok(by + bh >= fp.cells[3] - vTol, `${v.id} bbox v`);
      assert.equal(el.baseline_y, Math.round(fp.depthPoint[1] * 100) / 100);
    }
  });

  it("occluders: cutaway en back_n/back_w/front (sin floor), muros troceados, copa aérea", () => {
    const spec = buildTileGreyboxSpec(makePlan(), "occ");
    const ids = spec.occluders.map((o) => o.id);
    assert.ok(ids.includes("taberna:back_n") && ids.includes("taberna:back_w") && ids.includes("taberna:front"));
    assert.ok(!ids.includes("taberna:floor"), "el suelo del cutaway no ocluye");
    // Muralla de 128 celdas ⇒ varios tramos de ~14 celdas.
    const wallChunks = spec.occluders.filter((o) => o.vid === "muralla");
    assert.ok(wallChunks.length >= 8, `muralla en ${wallChunks.length} tramos`);
    // Árbol: tronco + copa aérea.
    const canopy = spec.occluders.find((o) => o.id === "roble:canopy");
    assert.ok(canopy?.overhead, "copa overhead");
    assert.ok(ids.includes("roble:trunk"));
    // La roca no es tall: sin occluder.
    assert.ok(!spec.occluders.some((o) => o.vid === "roca"));
    // Índices de primitivas válidos y del volumen correcto.
    for (const o of spec.occluders) {
      for (const i of o.prims) {
        assert.ok(spec.primitives[i], `${o.id} prim ${i}`);
        assert.equal(spec.primitives[i].volId, `vol_${o.vid}`);
      }
    }
  });

  it("la muralla talla el vano de la puerta (ningún tramo pisa el hueco)", () => {
    const spec = buildTileGreyboxSpec(makePlan(), "gate");
    for (const o of spec.occluders.filter((x) => x.vid === "muralla")) {
      const [minU, , maxU] = [o.footprint_cells[0], o.footprint_cells[1], o.footprint_cells[2]];
      assert.ok(maxU <= 64 - 4.5 + 0.01 || minU >= 64 + 4.5 - 0.01, `tramo ${o.id} invade el vano [${minU}, ${maxU}]`);
    }
  });

  it("suelo: la base cubre EXACTAMENTE el cuadrado del tile (silueta del compositing)", () => {
    const spec = buildTileGreyboxSpec(makePlan(), "base");
    const base = spec.primitives[0];
    assert.equal(base.shape, "box");
    assert.deepEqual(base.size, [128, 0.1, 128]);
    assert.deepEqual(base.pos, [64, -0.1, 64]);
  });

  it("rasgos del suelo: agua sobre áreas, deck sobre agua (elevaciones crecientes)", () => {
    const spec = buildTileGreyboxSpec(makePlan(), "layers");
    const waterY = Math.max(...spec.primitives.filter((p) => p.cat === "water").map((p) => p.pos[1]));
    const maxFlatY = Math.max(...spec.primitives.filter((p) => p.cat === "terrain").map((p) => p.pos[1]));
    assert.ok(waterY > 0, "agua presente");
    assert.ok(maxFlatY > waterY, "deck por encima del agua");
  });

  it("canónico estable ante floats: redondeo a 1e-4", () => {
    const canon = canonicalGreyboxJson(buildTileGreyboxSpec(makePlan(), "round"));
    assert.ok(!/\d\.\d{5,}/.test(canon), "floats largos en el canónico");
  });
});
