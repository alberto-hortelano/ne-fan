/** styleCategoryForTile: la etiqueta del motor narrativo afinada por el bioma
 *  real del tile. Las zonas construidas/interiores mandan; las naturales
 *  siguen al terreno; "nature" es alias legacy de forest. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STYLE_CATEGORIES,
  STYLE_ENV_CATEGORIES,
  STYLE_MANIFEST_CATEGORIES,
  styleCategoryForTile,
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

  it("el enum de manifest admite las canónicas y el alias legacy", () => {
    assert.equal(STYLE_MANIFEST_CATEGORIES.length, STYLE_CATEGORIES.length + 1);
    assert.ok((STYLE_MANIFEST_CATEGORIES as readonly string[]).includes("nature"));
  });
});
