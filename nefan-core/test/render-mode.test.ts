/** Unidad de applyRenderModeChange — la lógica pura image⇄vector por faceta
 *  que comparten las dos ramas de handleSetRenderMode. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyRenderModeChange } from "../src/narrative/render-mode.js";
import type { NarrativeWorldState } from "../src/narrative/types.js";
import { mundoDePrueba } from "./helpers.js";

const world = (over: Partial<NarrativeWorldState>): NarrativeWorldState =>
  mundoDePrueba({ render_mode: "vector", ...over });

describe("applyRenderModeChange", () => {
  it("scenes: vector → image y FIJA character_mode=vector (no arrastra skins legacy)", () => {
    const w = world({ render_mode: "vector", character_mode: "" });
    const res = applyRenderModeChange(w, "scenes", "image");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "image");
    assert.equal(w.character_mode, "vector");
  });

  it("scenes: image → vector y FIJA character_mode=image (no apaga skins legacy)", () => {
    const w = world({ render_mode: "image", character_mode: "" });
    const res = applyRenderModeChange(w, "scenes", "vector");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "vector");
    assert.equal(w.character_mode, "image");
  });

  it("scenes: respeta un character_mode ya fijado", () => {
    const w = world({ render_mode: "vector", character_mode: "image" });
    applyRenderModeChange(w, "scenes", "image");
    assert.equal(w.character_mode, "image");
  });

  it("characters: vector → image, deja escenarios intactos", () => {
    const w = world({ render_mode: "vector", character_mode: "vector" });
    const res = applyRenderModeChange(w, "characters", "image");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "vector");
    assert.equal(w.character_mode, "image");
  });

  it("characters: image → vector (materializa el '' legacy con valor propio)", () => {
    const w = world({ render_mode: "image", character_mode: "" });
    const res = applyRenderModeChange(w, "characters", "vector");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "image");
    assert.equal(w.character_mode, "vector");
  });

  it("characters: '' legacy sigue a render_mode para el estado EFECTIVO", () => {
    // render_mode=image + character_mode "" ⇒ efectivo=image ⇒ nada que cambiar.
    const w = world({ render_mode: "image", character_mode: "" });
    const res = applyRenderModeChange(w, "characters", "image");
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /ya tiene los personajes/);
    assert.equal(w.character_mode, "");
  });

  it("characters: un character_mode DESCONOCIDO cuenta como propio, no hereda y se deja cambiar", () => {
    // Save editado a mano o corrupto. La conducta de siempre: un valor que no
    // es image|vector no es igual a ninguno de los dos, así que el cambio se
    // acepta y lo materializa — el jugador puede salir del estado raro. Si en
    // vez de eso se colapsara a «sin elegir», heredaría de escenarios y el
    // bridge rechazaría el cambio dejando el valor corrupto puesto.
    const w = world({ render_mode: "image", character_mode: "foo" });
    const res = applyRenderModeChange(w, "characters", "image");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.character_mode, "image");

    const w2 = world({ render_mode: "vector", character_mode: "foo" });
    assert.deepEqual(applyRenderModeChange(w2, "characters", "vector"), { ok: true });
    assert.equal(w2.character_mode, "vector");

    // Y el campo AUSENTE (save anterior a que existiera) no es «desconocido»:
    // es «sin elegir» y hereda, igual que "".
    const w3 = world({ render_mode: "image", character_mode: undefined as unknown as string });
    const res3 = applyRenderModeChange(w3, "characters", "image");
    assert.equal(res3.ok, false);
    assert.match((res3 as { error: string }).error, /ya tiene los personajes/);
  });

  it("scenes ya en el modo pedido: Result de error sin mutar", () => {
    const w = world({ render_mode: "image", character_mode: "vector" });
    const res = applyRenderModeChange(w, "scenes", "image");
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, /ya tiene los escenarios/);
    assert.equal(w.render_mode, "image");

    const w2 = world({ render_mode: "vector", character_mode: "image" });
    const res2 = applyRenderModeChange(w2, "scenes", "vector");
    assert.equal(res2.ok, false);
    assert.equal(w2.render_mode, "vector");
  });

  it("scenes desde '' legacy: permite fijar cualquiera de los dos modos", () => {
    // Save pre-render_mode: siempre fue image de facto — el pin lo refleja.
    const w = world({ render_mode: "", character_mode: "" });
    const res = applyRenderModeChange(w, "scenes", "vector");
    assert.deepEqual(res, { ok: true });
    assert.equal(w.render_mode, "vector");
    assert.equal(w.character_mode, "image");

    const w2 = world({ render_mode: "", character_mode: "" });
    assert.deepEqual(applyRenderModeChange(w2, "scenes", "image"), { ok: true });
    assert.equal(w2.render_mode, "image");
    assert.equal(w2.character_mode, "image");
  });
});
