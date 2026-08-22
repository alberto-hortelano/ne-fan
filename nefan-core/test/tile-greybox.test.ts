import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTileGreyboxSpec,
  TILE_GREYBOX_VERSION,
  type TileGreyboxPlan,
} from "../src/scene/blueprint/greybox.js";
import { canonicalGreyboxJson } from "../src/scene/greybox/common.js";
import { volumePrimsForTile } from "../src/scene/greybox/volume-prims.js";
import type { GateVolume } from "../src/scene/blueprint/volumes.js";

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

  it("cada prim de un volumen lleva su volId (la fps reparte heroes por ahí)", () => {
    // fps-spec.ts indexa los volúmenes por `vol_<id>` para colgar de cada prim
    // su celda hero y el anclaje al relieve: una prim con el volId equivocado
    // pierde la superficie que el motor narrativo pidió para ella.
    const plan = makePlan();
    const gates = plan.volumes.filter((v): v is GateVolume => v.type === "gate");
    for (const v of plan.volumes) {
      const prims = volumePrimsForTile(v, gates);
      assert.ok(prims.length > 0, `${v.id} sin prims`);
      for (const p of prims) assert.equal(p.volId, `vol_${v.id}`, `${v.id}: ${p.shape}`);
    }
  });

  it("la muralla talla el vano de la puerta (ninguna prim pisa el hueco)", () => {
    const plan = makePlan();
    const muralla = plan.volumes.find((v) => v.id === "muralla")!;
    const gates = plan.volumes.filter((v): v is GateVolume => v.type === "gate");
    const prims = volumePrimsForTile(muralla, gates);
    // 128 celdas de muro ⇒ se trocea (el troceado es lo que permite saltarse
    // el vano; un muro de una pieza lo taparía). Los tramos son las cajas a
    // la altura del muro (h:7); las de 1×1 son merlones.
    const tramos = prims.filter((p) => p.shape === "box" && p.size[1] === 7);
    assert.ok(tramos.length >= 8, `muralla en ${tramos.length} tramos`);
    for (const [i, p] of prims.entries()) {
      const c = Math.abs(Math.cos(p.rotY ?? 0));
      const s = Math.abs(Math.sin(p.rotY ?? 0));
      const eu = (c * p.size[0] + s * (p.size[2] ?? p.size[0])) / 2;
      const [minU, maxU] = [p.pos[0] - eu, p.pos[0] + eu];
      assert.ok(
        maxU <= 64 - 4.5 + 0.01 || minU >= 64 + 4.5 - 0.01,
        `prim ${i} (${p.shape}) invade el vano [${minU}, ${maxU}]`,
      );
    }
  });

  it("suelo: la base cubre EXACTAMENTE el cuadrado del tile (la prim del relieve fps)", () => {
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
