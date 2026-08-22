/** Detalle fps del tile (fps-detail): variedad de formas post-proceso —
 *  copas esféricas por species, rocas facetadas con material pétreo,
 *  tejados de torre, arcos de gate, ventanas/chimeneas de building. Todo
 *  determinista y SIN tocar el builder compartido. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { buildTileGreyboxSpec } from "../src/scene/blueprint/greybox.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";
import { canonicalGreyboxJson } from "../src/scene/greybox/common.js";

function vols(raw: unknown[]) {
  const parsed = parseVolumes(raw);
  assert.ok(parsed.ok, !parsed.ok ? parsed.error : "");
  return parsed.volumes;
}

describe("fps-detail", () => {
  it("árbol frondoso (default) = tronco + esferas; conífera conserva el cono", () => {
    const volumes = vols([
      { id: "roble", label: "roble", type: "tree", at: [30, 30] },
      { id: "pino", label: "pino", type: "tree", at: [60, 60], species: "pino carrasco" },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    const roble = primsM.filter((p) => p.volId === "vol_roble");
    assert.ok(roble.some((p) => p.shape === "cylinder"), "tronco");
    assert.ok(roble.filter((p) => p.shape === "sphere").length >= 1, "copa esférica");
    assert.equal(roble.some((p) => p.shape === "cone"), false, "sin cono en frondosa");
    const pino = primsM.filter((p) => p.volId === "vol_pino");
    assert.ok(pino.some((p) => p.shape === "cone"), "la conífera conserva el cono");
  });

  it("rocas = esferas facetadas con mat rock_stone (no tablones); matorral = esferas", () => {
    const volumes = vols([
      { id: "pena", label: "peña", type: "rock", at: [40, 40], s: 1.5 },
      { id: "mata", label: "mata", type: "bush", at: [70, 70] },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    const rocas = primsM.filter((p) => p.volId === "vol_pena");
    assert.ok(rocas.length >= 2, "varias esferas por roca");
    for (const r of rocas) {
      assert.equal(r.shape, "sphere");
      assert.equal(r.mat, "rock_stone");
      assert.ok(r.scale && r.scale[1] < 1, "achatada");
    }
    const matas = primsM.filter((p) => p.volId === "vol_mata");
    assert.ok(matas.every((p) => p.shape === "sphere"), "matorral esférico");
  });

  it("torre sin almenas gana tejado cónico; la almenada no", () => {
    const volumes = vols([
      { id: "t1", label: "torre", type: "tower", at: [30, 30] },
      { id: "t2", label: "torreón", type: "tower", at: [80, 80], crenellated: true },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "dirt" }, "k");
    assert.ok(
      primsM.some((p) => p.volId === "vol_t1" && p.shape === "cone" && p.mat === "roof_tile"),
      "cono de tejado",
    );
    assert.equal(primsM.some((p) => p.volId === "vol_t2" && p.shape === "cone"), false);
  });

  it("gate gana corbeles (arco escalonado) y building ventanas con mat window_glass", () => {
    const volumes = vols([
      {
        id: "muralla", label: "muralla", type: "wall",
        points: [[10, 64], [118, 64]], crenellated: true,
      },
      { id: "puerta", label: "puerta", type: "gate", at: [64, 64], orient: "x" },
      {
        id: "casa", label: "casa", type: "building",
        rect: [30, 20, 14, 10], doors: [{ edge: "s", at: 5 }],
      },
    ]);
    const { primsM } = buildFpsTileSpec({ volumes, biome: "dirt" }, "k");
    const corbeles = primsM.filter(
      (p) => p.volId === "vol_puerta" && p.shape === "box" && p.size[1] < 0.5 && p.pos[1] > 1,
    );
    assert.ok(corbeles.length >= 4, `≥4 corbeles (hay ${corbeles.length})`);
    // Por la CLASE que declaran, no por "tiene mat de tipo objeto": ese
    // proxy dejó de distinguir cuando el cuerpo del edificio empezó a
    // declarar también su material de fachada.
    const conMat = primsM.filter((p) => p.volId === "vol_casa" && typeof p.mat === "object");
    const ventanas = conMat.filter((p) => (p.mat as Record<string, string>).side === "window_glass");
    assert.ok(ventanas.length >= 1, `la casa tiene ventanas (mats: ${JSON.stringify(conMat.map((p) => p.mat))})`);
    assert.ok(
      conMat.some((p) => (p.mat as Record<string, string>).side === "wall_stone"),
      "el cuerpo declara su material de fachada",
    );
    for (const w of ventanas) {
      assert.equal((w.mat as Record<string, string>).side, "window_glass");
      assert.ok(w.pos[1] > 0.5, "ventana elevada del suelo");
    }
  });

  it("determinista y sin mutar las prims base del builder compartido", () => {
    const raw = [
      { id: "casa", label: "casa", type: "building", rect: [30, 20, 14, 10] },
      { id: "roble", label: "roble", type: "tree", at: [80, 80] },
      { id: "pena", label: "peña", type: "rock", at: [100, 40] },
    ];
    const volumes = vols(raw);
    const a = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    const b = buildFpsTileSpec({ volumes, biome: "grass" }, "k");
    assert.deepEqual(a.primsM, b.primsM, "mismo seedKey ⇒ mismas prims");
    // El `spec` que devuelve buildFpsTileSpec es el del builder, INTACTO: el
    // enriquecimiento (cutaways cerrados, detalle, scatter, celdas → metros)
    // vive solo en primsM. Si un post-proceso mutase las prims base, el
    // siguiente partiría de otra geometría y las celdas del atlas —lo que se
    // paga con IA— dejarían de ser estables.
    const base = buildTileGreyboxSpec({ volumes, biome: "grass" }, "k");
    assert.equal(canonicalGreyboxJson(a.spec), canonicalGreyboxJson(base));
  });
});
