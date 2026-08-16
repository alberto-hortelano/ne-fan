/** Scatter declarativo del tile (scatter.ts): gramática fail-loud con ruta
 *  exacta (espejo de labs/authoring/gen-json.js, run 003), poblado
 *  determinista con exclusiones automáticas y tope duro reportado. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SCATTER_INSTANCES,
  buildScatterExclusions,
  parseScatter,
  runScatter,
} from "../src/scene/blueprint/scatter.js";
import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { parseGround } from "../src/scene/blueprint/ground.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";

/** Generador de pino del run 003 adaptado (pos.y = BASE, celdas). */
const PINO = {
  vars: {
    h: [5, 10],
    trunkH: { op: "*", a: { var: "h" }, b: [0.25, 0.35] },
    n: { int: [2, 4] },
  },
  materials: {
    tronco: { color: "#5a4632", roughness: 1 },
    copa: { color: "#35482c", hslJitter: [0.05, 0.15, 0.07] },
  },
  parts: [
    { shape: "cylinder", mat: "tronco", rTop: [0.2, 0.3], rBottom: [0.3, 0.5], h: { var: "trunkH" }, pos: [0, 0, 0] },
    {
      shape: "cone", mat: "copa", seg: 7, repeat: { count: { var: "n" } },
      r: { op: "*", a: { var: "h" }, b: { lerp: [0.3, 0.12] } },
      h: { op: "*", a: { var: "h" }, b: 0.4 },
      pos: [[-0.1, 0.1], { op: "*", a: { var: "trunkH" }, b: { op: "+", a: { var: "i" }, b: 0.8 } }, [-0.1, 0.1]],
    },
  ],
};

const ZONA = { kind: "pino", shape: { type: "rect", x0: 10, z0: 10, x1: 60, z1: 60 }, density: 0.05 };

describe("scatter: gramática", () => {
  it("valida el generador del run 003 y zonas rect/ellipse/poly", () => {
    const res = parseScatter({ pino: PINO }, [
      ZONA,
      { kind: "pino", shape: { type: "ellipse", cx: 90, cz: 90, rx: 15, rz: 10 }, density: 0.1 },
      { kind: "pino", shape: { type: "poly", pts: [[70, 10], [110, 20], [80, 50]] }, density: 0.02 },
    ]);
    assert.ok(res.ok, !res.ok ? res.error : "");
  });

  it("fail-loud con ruta exacta", () => {
    const shapeMal = parseScatter(
      { roca: { parts: [{ shape: "dodecaedro", r: 1 }] } },
      [{ kind: "roca", shape: { type: "rect", x0: 0, z0: 0, x1: 10, z1: 10 }, density: 0.1 }],
    );
    assert.equal(shapeMal.ok, false);
    assert.match(!shapeMal.ok ? shapeMal.error : "", /scatter_generators\.roca\.parts\[0\].*dodecaedro/);

    const campoMal = parseScatter(
      { p: { parts: [{ shape: "sphere", r: 1, displace: 2 }] } },
      [{ kind: "p", shape: { type: "rect", x0: 0, z0: 0, x1: 10, z1: 10 }, density: 0.1 }],
    );
    assert.equal(campoMal.ok, false);
    assert.match(!campoMal.ok ? campoMal.error : "", /campo desconocido 'displace'/);

    const kindMal = parseScatter({ pino: PINO }, [
      { kind: "olivo", shape: { type: "rect", x0: 0, z0: 0, x1: 10, z1: 10 }, density: 0.1 },
    ]);
    assert.equal(kindMal.ok, false);
    assert.match(!kindMal.ok ? kindMal.error : "", /scatter_zones\[0\].*olivo/);

    const matMal = parseScatter(
      { p: { parts: [{ shape: "sphere", r: 1, mat: "hoja" }] } },
      [{ kind: "p", shape: { type: "rect", x0: 0, z0: 0, x1: 10, z1: 10 }, density: 0.1 }],
    );
    assert.equal(matMal.ok, false);
    assert.match(!matMal.ok ? matMal.error : "", /mat 'hoja' no declarado/);
  });
});

describe("scatter: poblado", () => {
  const parsed = () => {
    const r = parseScatter({ pino: PINO }, [ZONA]);
    assert.ok(r.ok);
    return r;
  };

  it("determinista, dentro de la zona, con variedad estructural", () => {
    const p = parsed();
    const a = runScatter(p.generators, p.zones, { seedKey: "tile_0_0" });
    const b = runScatter(p.generators, p.zones, { seedKey: "tile_0_0" });
    assert.deepEqual(a, b, "mismo seedKey ⇒ mismo scatter");
    const c = runScatter(p.generators, p.zones, { seedKey: "tile_1_0" });
    assert.notDeepEqual(a.prims, c.prims, "otro tile ⇒ otro scatter");
    assert.ok(a.counts[0].placed > 5, `coloca instancias (${a.counts[0].placed})`);
    for (const prim of a.prims) {
      assert.ok(prim.pos[0] >= 9 && prim.pos[0] <= 61, "x dentro de la zona (+parts)");
      assert.equal(prim.cat, "decor");
    }
    // Variedad: no todos los troncos son idénticos.
    const troncos = a.prims.filter((pr) => pr.shape === "cylinder");
    assert.ok(new Set(troncos.map((t) => t.size[1].toFixed(3))).size > 1, "alturas variadas");
    // hslJitter: no todas las copas comparten color exacto.
    const copas = a.prims.filter((pr) => pr.shape === "cone");
    assert.ok(new Set(copas.map((t) => t.color)).size > 1, "tonos variados");
  });

  it("exclusiones automáticas: huellas de volúmenes, agua y caminos", () => {
    const volumes = parseVolumes([{ id: "casa", label: "casa", type: "building", rect: [20, 20, 20, 20] }]);
    const ground = parseGround([
      { id: "rio", kind: "water", rect: [0, 40, 60, 10] },
      { id: "senda", kind: "path", points: [[10, 12], [60, 12]], w: 4 },
    ]);
    assert.ok(volumes.ok && ground.ok);
    const excluded = buildScatterExclusions(volumes.volumes, ground.features);
    assert.equal(excluded(30, 30), true, "dentro de la casa");
    assert.equal(excluded(30, 45), true, "en el agua");
    assert.equal(excluded(30, 12), true, "sobre el camino");
    assert.equal(excluded(30, 58), false, "campo libre");
    const p = parsed();
    const run = runScatter(p.generators, p.zones, { seedKey: "k", excluded });
    for (const prim of run.prims) {
      assert.ok(!(prim.pos[0] >= 20 && prim.pos[0] <= 40 && prim.pos[2] >= 20 && prim.pos[2] <= 40) || prim.pos[1] > 5,
        `prim en la huella de la casa: ${prim.pos}`);
    }
  });

  it("tope duro de instancias, reportado en counts (no-silent-caps)", () => {
    const r = parseScatter({ pino: PINO }, [
      { kind: "pino", shape: { type: "rect", x0: 0, z0: 0, x1: 128, z1: 128 }, density: 1.5 },
    ]);
    assert.ok(r.ok);
    const run = runScatter(r.generators, r.zones, { seedKey: "k" });
    assert.equal(run.counts[0].placed, MAX_SCATTER_INSTANCES);
    assert.ok(run.counts[0].wanted > run.counts[0].placed, "el recorte queda visible");
  });

  it("integrado en buildFpsTileSpec: prims decor + telemetría; inválido no tumba el tile", () => {
    const volumes = parseVolumes([{ id: "casa", label: "casa", type: "building", rect: [20, 20, 20, 20] }]);
    assert.ok(volumes.ok);
    const ok = buildFpsTileSpec(
      {
        volumes: volumes.volumes,
        biome: "grass",
        scatter_generators: { pino: PINO },
        scatter_zones: [ZONA],
      },
      "k",
    );
    assert.ok(ok.scatterCounts && ok.scatterCounts[0].placed > 0);
    assert.equal(ok.scatterError, undefined);
    assert.ok(ok.primsM.some((p) => p.cat === "decor" && p.shape === "cone"), "copas de scatter en primsM");
    const bad = buildFpsTileSpec(
      {
        volumes: volumes.volumes,
        biome: "grass",
        scatter_generators: { pino: { parts: [] } },
        scatter_zones: [ZONA],
      },
      "k",
    );
    assert.match(bad.scatterError ?? "", /parts\[\] no vacío/);
    assert.ok(bad.primsM.length > 0, "el tile compone sin el scatter");
  });
});
