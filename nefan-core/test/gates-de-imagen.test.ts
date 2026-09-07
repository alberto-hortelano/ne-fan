/** Los gates de imagen (#508): cada rama de los tres predicados es una puerta
 *  de GASTO, así que cada caso de la tabla escribe la respuesta a mano — el
 *  mutante que invierta una comparación, cambie la caída al toggle o quite el
 *  candado de `aiSkin` se lleva un caso. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  gatesDeImagen,
  modoEfectivoDePersonajes,
  normalizarModo,
  type EntradaDeGates,
  type GatesDeImagen,
  type Modo,
} from "../src/session/gates-de-imagen.js";

describe("normalizarModo", () => {
  it("deja pasar los dos modos y colapsa todo lo demás a «sin elegir»", () => {
    assert.equal(normalizarModo("image"), "image");
    assert.equal(normalizarModo("vector"), "vector");
    assert.equal(normalizarModo(""), "");
    // Lo que trae un save viejo o un wire con un valor que nadie conoce.
    for (const raro of [undefined, null, "IMAGE", "imagen", "foo", 1, true, {}]) {
      assert.equal(normalizarModo(raro), "", `${JSON.stringify(raro)} debía colapsar a ""`);
    }
  });
});

describe("modoEfectivoDePersonajes", () => {
  const casos: Array<[Modo, Modo, Modo]> = [
    // renderMode, characterMode, efectivo
    ["image", "", "image"],
    ["vector", "", "vector"],
    ["image", "vector", "vector"],
    ["vector", "image", "image"],
    ["image", "image", "image"],
    ["", "", ""],
    ["", "image", "image"],
    ["", "vector", "vector"],
  ];
  for (const [renderMode, characterMode, esperado] of casos) {
    it(`escenarios=${JSON.stringify(renderMode)} personajes=${JSON.stringify(characterMode)} → ${JSON.stringify(esperado)}`, () => {
      assert.equal(modoEfectivoDePersonajes({ renderMode, characterMode }), esperado);
    });
  }
});

describe("gatesDeImagen", () => {
  const conSesion = (renderMode: Modo, characterMode: Modo, resto: Partial<EntradaDeGates> = {}): EntradaDeGates => ({
    renderMode,
    characterMode,
    toggleLocalEscenarios: false,
    toggleLocalPersonajes: false,
    aiSkin: true,
    ...resto,
  });
  const sinSesion = (resto: Partial<EntradaDeGates> = {}): EntradaDeGates => conSesion("", "", resto);
  const TOGGLES_ON = { toggleLocalEscenarios: true, toggleLocalPersonajes: true };

  const casos: Array<[string, EntradaDeGates, GatesDeImagen]> = [
    // --- con sesión: manda la partida, no los toggles ---
    ["image/image gasta en las dos aunque los toggles estén OFF", conSesion("image", "image"), { escenarios: true, personajes: true }],
    ["vector/vector no gasta en ninguna aunque los toggles estén ON", conSesion("vector", "vector", TOGGLES_ON), { escenarios: false, personajes: false }],
    ["image/vector: atlas sí, skins no", conSesion("image", "vector"), { escenarios: true, personajes: false }],
    ["vector/image: atlas no, skins sí", conSesion("vector", "image"), { escenarios: false, personajes: true }],
    // --- «""» de personajes SIGUE a escenarios, y no al toggle local ---
    ["image/«» → skins siguen a escenarios (sí) con el toggle OFF", conSesion("image", ""), { escenarios: true, personajes: true }],
    ["vector/«» → skins siguen a escenarios (no) aunque el toggle esté ON", conSesion("vector", "", TOGGLES_ON), { escenarios: false, personajes: false }],
    // --- sin sesión (fixtures): mandan los toggles, cada uno el suyo ---
    ["sin sesión y toggles OFF: nada gasta (una fixture con NPCs no paga sola)", sinSesion(), { escenarios: false, personajes: false }],
    ["sin sesión y toggles ON: las dos", sinSesion(TOGGLES_ON), { escenarios: true, personajes: true }],
    ["sin sesión, solo escenarios ON: los skins NO siguen al toggle de escenarios", sinSesion({ toggleLocalEscenarios: true }), { escenarios: true, personajes: false }],
    ["sin sesión, solo personajes ON", sinSesion({ toggleLocalPersonajes: true }), { escenarios: false, personajes: true }],
    // --- backend de skins apagado por config: personajes nunca, escenarios igual ---
    ["aiSkin=false apaga personajes con la partida en image/image", conSesion("image", "image", { aiSkin: false }), { escenarios: true, personajes: false }],
    ["aiSkin=false apaga personajes también sin sesión con el toggle ON", sinSesion({ ...TOGGLES_ON, aiSkin: false }), { escenarios: true, personajes: false }],
    ["aiSkin=false no enciende nada por sí solo", conSesion("vector", "vector", { aiSkin: false }), { escenarios: false, personajes: false }],
  ];
  for (const [nombre, entrada, esperado] of casos) {
    it(nombre, () => {
      assert.deepEqual(gatesDeImagen(entrada), esperado);
    });
  }

  it("no toca la entrada (función pura)", () => {
    const entrada = conSesion("image", "");
    const copia = { ...entrada };
    gatesDeImagen(entrada);
    assert.deepEqual(entrada, copia);
  });
});
