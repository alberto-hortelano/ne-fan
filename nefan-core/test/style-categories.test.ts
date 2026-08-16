/** styleCategoryForTile: la etiqueta del motor narrativo afinada por el bioma
 *  real del tile. Las zonas construidas/interiores mandan; las naturales
 *  siguen al terreno; "nature" es alias legacy de forest. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STYLE_CATEGORIES,
  STYLE_ENV_CATEGORIES,
  STYLE_FPS_CATEGORIES,
  STYLE_MANIFEST_CATEGORIES,
  STYLE_STAGE_CATEGORIES,
  ZONE_TO_STAGE,
  stageCategoryForScene,
  styleCategoryForTile,
  viewForCategory,
} from "../src/games/style-categories.js";

describe("styleCategoryForTile", () => {
  it("las zonas construidas/interiores mandan sobre el bioma", () => {
    assert.equal(styleCategoryForTile("settlement", "forest_floor"), "settlement");
    assert.equal(styleCategoryForTile("fortress", "sand"), "fortress");
    assert.equal(styleCategoryForTile("farmland", "grass"), "farmland");
    assert.equal(styleCategoryForTile("interior", "swamp"), "interior");
    assert.equal(styleCategoryForTile("underground", "snow"), "underground");
  });

  it("las zonas naturales se afinan por el bioma del tile", () => {
    // Un tile de pantano al borde de una escena de bosque usa wetland.
    assert.equal(styleCategoryForTile("forest", "swamp"), "wetland");
    assert.equal(styleCategoryForTile("forest", "sand"), "desert");
    assert.equal(styleCategoryForTile("desert", "snow"), "snow");
    assert.equal(styleCategoryForTile("wetland", "forest_floor"), "forest");
  });

  it("sin bioma, la etiqueta natural se respeta", () => {
    assert.equal(styleCategoryForTile("wetland", undefined), "wetland");
    assert.equal(styleCategoryForTile("snow", undefined), "snow");
  });

  it("alias legacy: nature equivale a forest", () => {
    assert.equal(styleCategoryForTile("nature", undefined), "forest");
    assert.equal(styleCategoryForTile("nature", "swamp"), "wetland");
  });

  it("sin etiqueta, decide el bioma; sin nada, cadena vacía (default del server)", () => {
    assert.equal(styleCategoryForTile(undefined, "dirt"), "farmland");
    assert.equal(styleCategoryForTile(undefined, "grass"), "forest");
    assert.equal(styleCategoryForTile("", "snow"), "snow");
    assert.equal(styleCategoryForTile(undefined, undefined), "");
    assert.equal(styleCategoryForTile("volcán_inventado", undefined), "");
  });

  it("todo bioma del catálogo mapea a una categoría de entorno", () => {
    const biomes = ["grass", "forest_floor", "meadow", "sand", "dirt", "stone", "snow", "swamp"];
    for (const b of biomes) {
      const cat = styleCategoryForTile(undefined, b);
      assert.ok(
        (STYLE_ENV_CATEGORIES as readonly string[]).includes(cat),
        `bioma sin zona: ${b} → "${cat}"`,
      );
    }
  });

  it("el enum de manifest admite canónicas, plató, fps y el alias legacy", () => {
    assert.equal(
      STYLE_MANIFEST_CATEGORIES.length,
      STYLE_CATEGORIES.length + STYLE_STAGE_CATEGORIES.length + STYLE_FPS_CATEGORIES.length + 1,
    );
    assert.ok((STYLE_MANIFEST_CATEGORIES as readonly string[]).includes("nature"));
    assert.ok((STYLE_MANIFEST_CATEGORIES as readonly string[]).includes("stage_interior"));
    assert.ok((STYLE_MANIFEST_CATEGORIES as readonly string[]).includes("fps_surfaces"));
  });
});

describe("viewForCategory", () => {
  it("el namespace stage_ es proscenium; zonas y personajes, overworld", () => {
    assert.equal(viewForCategory("stage_street"), "proscenium");
    assert.equal(viewForCategory("stage_interior"), "proscenium");
    assert.equal(viewForCategory("settlement"), "overworld");
    assert.equal(viewForCategory("character_noble"), "overworld");
    assert.equal(viewForCategory("nature"), "overworld");
  });

  it("el namespace fps_ es fps", () => {
    assert.equal(viewForCategory("fps_surfaces"), "fps");
  });
});

describe("stageCategoryForScene", () => {
  it("una categoría de plató explícita se respeta", () => {
    assert.equal(stageCategoryForScene("stage_harbor", false), "stage_harbor");
    assert.equal(stageCategoryForScene("stage_gate", true), "stage_gate");
  });

  it("las zonas cenitales legacy mapean a su plató más cercano", () => {
    assert.equal(stageCategoryForScene("interior", false), "stage_interior");
    assert.equal(stageCategoryForScene("underground", false), "stage_interior");
    assert.equal(stageCategoryForScene("settlement", false), "stage_street");
    assert.equal(stageCategoryForScene("fortress", false), "stage_gate");
    assert.equal(stageCategoryForScene("forest", false), "stage_nature");
    assert.equal(stageCategoryForScene("nature", false), "stage_nature");
  });

  it("sin etiqueta: la cuarta pared implica interior; sin nada, default del server", () => {
    assert.equal(stageCategoryForScene(undefined, true), "stage_interior");
    assert.equal(stageCategoryForScene("", true), "stage_interior");
    assert.equal(stageCategoryForScene(undefined, false), "");
    assert.equal(stageCategoryForScene("zona_inventada", false), "");
  });

  it("toda zona cenital (y el alias legacy) tiene mapeo a plató", () => {
    for (const zone of [...STYLE_ENV_CATEGORIES, "nature"]) {
      const stage = ZONE_TO_STAGE[zone];
      assert.ok(
        (STYLE_STAGE_CATEGORIES as readonly string[]).includes(stage),
        `zona sin plató: ${zone} → "${stage}"`,
      );
    }
  });
});
