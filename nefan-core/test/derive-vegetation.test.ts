/** Ruta A de `vegetation_zones` (re-expuesto en el contrato 2026-08-17): el
 *  blueprint deriva volúmenes tree/bush REALES de las zonas declaradas —
 *  determinista, respetando blockers, bandas y árboles declarados como
 *  semillas de separación. (La ruta B — entities del grid — la cubren
 *  tile.test.ts y scene-expand.test.ts.) */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveVolumesFromSchema } from "../src/scene/blueprint/derive.js";
import { parseVolumes, type Volume } from "../src/scene/blueprint/volumes.js";

function vols(raw: unknown[]): Volume[] {
  const p = parseVolumes(raw);
  assert.ok(p.ok, !p.ok ? p.error : "");
  return p.ok ? p.volumes : [];
}

describe("deriveVolumesFromSchema: vegetation_zones", () => {
  it("puebla una zona 'rest' con árboles, determinista", () => {
    const input = {
      scene_id: "tile_0_0",
      vegetation_zones: [{ type: "pino", area: "rest" as const, density: 0.4 }],
    };
    const a = deriveVolumesFromSchema(input, []);
    const b = deriveVolumesFromSchema(input, []);
    assert.deepEqual(a, b, "misma entrada → mismos volúmenes");
    assert.ok(a.length >= 30, `derivados: ${a.length}`);
    assert.ok(a.every((v) => v.type === "tree"), "todo trees");
  });

  it("density 0 apaga la zona (control local)", () => {
    const out = deriveVolumesFromSchema(
      { scene_id: "t", vegetation_zones: [{ type: "pino", area: "rest", density: 0 }] },
      [],
    );
    assert.equal(out.length, 0);
  });

  it("respeta blockers declarados y usa los trees del motor como semillas de separación", () => {
    const declared = vols([
      { id: "nave", label: "nave", type: "building", rect: [0, 0, 128, 60] },
      { id: "roble_viejo", label: "roble", type: "tree", at: [96, 96], s: 1.5 },
    ]);
    const out = deriveVolumesFromSchema(
      { scene_id: "tile_0_0", vegetation_zones: [{ type: "pino", area: "rest", density: 0.6 }] },
      declared,
    );
    assert.ok(out.length > 0);
    for (const v of out) {
      const at = (v as Extract<Volume, { type: "tree" }>).at;
      assert.ok(at[1] > 60, `no planta dentro/margen del blocker: ${JSON.stringify(at)}`);
      const d2 = (at[0] - 96) ** 2 + (at[1] - 96) ** 2;
      assert.ok(d2 >= 8 * 8, `separación del árbol declarado: ${JSON.stringify(at)}`);
    }
  });

  it("un type de matorral produce bush", () => {
    const out = deriveVolumesFromSchema(
      { scene_id: "t", vegetation_zones: [{ type: "matorral", area: [0, 0, 60, 60], density: 0.8 }] },
      [],
    );
    assert.ok(out.length > 0);
    assert.ok(out.every((v) => v.type === "bush"), "todo bushes");
  });
});
