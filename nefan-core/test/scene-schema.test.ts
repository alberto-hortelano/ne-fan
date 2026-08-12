/** Gate estructural de escena Format D (FormatDSceneSchema).
 *
 *  Verifica que ACEPTA las escenas reales del repo y que RECHAZA con error
 *  preciso justo lo que ai_server/validate_scene_response degradaba en
 *  silencio (filas de terrain mal dimensionadas, entities malformadas, un tile
 *  con grid…). El pre-flight MCP usa este schema para que el error vuelva al
 *  modelo en vez de mutilar la escena. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { FormatDSceneSchema } from "../src/contract/model-io/scene-schema.js";

const SCENES = fileURLToPath(new URL("../data/scenes", import.meta.url));

function accepts(scene: unknown): true | string {
  const r = FormatDSceneSchema.safeParse(scene);
  if (r.success) return true;
  return `${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}`;
}

describe("FormatDSceneSchema — acepta las escenas reales", () => {
  const files = [
    "robledo_village.json",
    "zorder_test.json",
    ...readdirSync(resolve(SCENES, "proscenio"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => `proscenio/${f}`),
  ];
  for (const f of files) {
    it(f, () => {
      const scene = JSON.parse(readFileSync(resolve(SCENES, f), "utf-8"));
      assert.equal(accepts(scene), true);
    });
  }
});

describe("FormatDSceneSchema — rechaza lo que el saneador degradaba", () => {
  const base = {
    scene_id: "s",
    scene_description: "una escena de prueba",
    size: { cols: 4, rows: 2, meters_per_cell: 2 },
    terrain: ["gggg", "gggg"],
    entities: [{ id: "p", kind: "player", name: "Tú", cell: [1, 1], footprint: [1, 1], glyph: "@" }],
  };

  it("acepta la escena base válida", () => {
    assert.equal(accepts(base), true);
  });

  it("fila de terrain con ancho != cols (antes: padding silencioso)", () => {
    const r = FormatDSceneSchema.safeParse({ ...base, terrain: ["gggg", "ggg"] });
    assert.equal(r.success, false);
    if (!r.success) assert.match(r.error.issues[0].message, /chars.*cols|size\.cols/);
  });

  it("nº de filas != size.rows (antes: truncado/relleno silencioso)", () => {
    const r = FormatDSceneSchema.safeParse({ ...base, terrain: ["gggg"] });
    assert.equal(r.success, false);
    if (!r.success) assert.match(r.error.issues[0].message, /filas|rows/);
  });

  it("size sin terrain (antes: todo hierba)", () => {
    const noTerrain: Record<string, unknown> = { ...base };
    delete noTerrain.terrain;
    assert.equal(FormatDSceneSchema.safeParse(noTerrain).success, false);
  });

  it("entity con kind fuera del enum (antes: → prop)", () => {
    const r = FormatDSceneSchema.safeParse({
      ...base,
      entities: [{ id: "x", kind: "monster", name: "X", cell: [0, 0], footprint: [1, 1], glyph: "x" }],
    });
    assert.equal(r.success, false);
  });

  it("entity sin glyph / footprint (antes: glifo de reserva / clamp)", () => {
    assert.equal(
      FormatDSceneSchema.safeParse({ ...base, entities: [{ id: "x", kind: "prop", name: "X", cell: [0, 0], footprint: [1, 1] }] }).success,
      false,
    );
    assert.equal(
      FormatDSceneSchema.safeParse({ ...base, entities: [{ id: "x", kind: "prop", name: "X", cell: [0, 0], glyph: "x" }] }).success,
      false,
    );
  });

  it("entities ausente o no-lista", () => {
    const noEnt: Record<string, unknown> = { ...base };
    delete noEnt.entities;
    assert.equal(FormatDSceneSchema.safeParse(noEnt).success, false);
    assert.equal(FormatDSceneSchema.safeParse({ ...base, entities: "nope" }).success, false);
  });

  it("tile con size/terrain o sin biome (variante tile)", () => {
    const tileBad = { scene_id: "tile_0_0", scene_description: "d", tile: { tx: 0, ty: 0 }, size: { cols: 4, rows: 2, meters_per_cell: 0.5 }, terrain: ["gggg", "gggg"], entities: [] };
    assert.equal(FormatDSceneSchema.safeParse(tileBad).success, false); // tile no lleva size/terrain
    const tileNoBiome = { scene_id: "tile_0_0", scene_description: "d", tile: { tx: 0, ty: 0 }, entities: [] };
    assert.equal(FormatDSceneSchema.safeParse(tileNoBiome).success, false); // falta biome
    const tileOk = { scene_id: "tile_0_0", scene_description: "d", tile: { tx: 0, ty: 0 }, biome: "grass", entities: [] };
    assert.equal(accepts(tileOk), true);
  });

  it("tolera campos legacy/retirados por passthrough (no rechaza)", () => {
    assert.equal(
      accepts({ ...base, terrain_features: [], room_id: "s", ambient_event: "viento", style_tag: "x", exits: [] }),
      true,
    );
  });
});
