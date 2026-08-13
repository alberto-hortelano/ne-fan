/** Unidad de applyRenderModeUpgrade — la lógica pura vector→image por faceta
 *  que comparten las dos ramas de handleSetRenderMode. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyRenderModeUpgrade } from "../src/narrative/render-mode.js";
import type { NarrativeWorldState } from "../src/narrative/types.js";

function world(over: Partial<NarrativeWorldState>): NarrativeWorldState {
  return {
    name: "",
    atmosphere: "",
    view: "proscenium",
    style_token: "",
    active_scene_id: "",
    description: "",
    style_id: "",
    world_doc_hash: "",
    render_mode: "vector",
    character_mode: "",
    combat_system: "",
    ...over,
  };
}

describe("applyRenderModeUpgrade", () => {
  it("scenes: vector → image y FIJA character_mode=vector (no arrastra skins legacy)", () => {
    const w = world({ render_mode: "vector", character_mode: "" });
    const res = applyRenderModeUpgrade(w, "scenes");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "image");
    assert.equal(w.character_mode, "vector");
  });

  it("scenes: respeta un character_mode ya fijado", () => {
    const w = world({ render_mode: "vector", character_mode: "image" });
    applyRenderModeUpgrade(w, "scenes");
    assert.equal(w.character_mode, "image");
  });

  it("characters: vector → image, deja escenarios intactos", () => {
    const w = world({ render_mode: "vector", character_mode: "vector" });
    const res = applyRenderModeUpgrade(w, "characters");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "vector");
    assert.equal(w.character_mode, "image");
  });

  it("characters: character_mode '' legacy sigue a render_mode para el estado EFECTIVO", () => {
    // render_mode=image + character_mode "" ⇒ efectivo=image ⇒ ya activo.
    const w = world({ render_mode: "image", character_mode: "" });
    const res = applyRenderModeUpgrade(w, "characters");
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /ya tiene los personajes/);
  });

  it("scenes ya en image: Result de error sin mutar", () => {
    const w = world({ render_mode: "image", character_mode: "vector" });
    const res = applyRenderModeUpgrade(w, "scenes");
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /ya tiene los escenarios/);
    assert.equal(w.render_mode, "image");
  });

  it("scenes con render_mode inesperado ('' legacy): error explícito, no adivina", () => {
    const w = world({ render_mode: "", character_mode: "" });
    const res = applyRenderModeUpgrade(w, "scenes");
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /no está en modo vector/);
  });
});
