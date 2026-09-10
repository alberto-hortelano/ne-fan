/** Los gates de imagen (#508): cada rama de los dos predicados es una puerta
 *  de GASTO, así que cada caso de la tabla escribe la respuesta a mano — el
 *  mutante que invierta una comparación, gire la herencia del modo vacío o
 *  cambie la caída al toggle se lleva un caso. `CONFIG.graphics.ai_skin` NO
 *  entra aquí (es del cliente, ver la cabecera del módulo), así que tampoco
 *  hay casos suyos. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  esModo,
  gatesDeImagen,
  modoEfectivoDePersonajes,
  normalizarModo,
  type EntradaDeGates,
  type GatesDeImagen,
  type Modo,
} from "../src/session/gates-de-imagen.js";

/** `esModo` no es un detalle de `normalizarModo`: es la pregunta que las
 *  PUERTAS necesitan (#522, la del save). Se mide aparte porque a través de
 *  `normalizarModo` su rama del «sin elegir» es invisible —quitarla devuelve
 *  `""` igual— y un mutante así no lo mata ningún test de normalización. */
describe("esModo", () => {
  it("los tres valores que el juego sabe leer, y ninguno más", () => {
    for (const bueno of ["image", "vector", ""]) {
      assert.equal(esModo(bueno), true, `${JSON.stringify(bueno)} SÍ es un modo`);
    }
    for (const raro of [undefined, null, "IMAGE", "imagen", "vectorial", " ", "foo", 1, 0, true, {}, []]) {
      assert.equal(esModo(raro), false, `${JSON.stringify(raro)} NO es un modo`);
    }
  });
});

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
    toggleLocalPersonajes: false,
    ...resto,
  });
  const sinSesion = (resto: Partial<EntradaDeGates> = {}): EntradaDeGates => conSesion("", "", resto);
  const TOGGLES_ON = { toggleLocalPersonajes: true };

  const casos: Array<[string, EntradaDeGates, GatesDeImagen]> = [
    // --- con sesión: manda la partida, no los toggles ---
    ["image/image gasta en las dos aunque los toggles estén OFF", conSesion("image", "image"), { escenarios: true, personajes: true }],
    ["vector/vector no gasta en ninguna aunque el toggle esté ON", conSesion("vector", "vector", TOGGLES_ON), { escenarios: false, personajes: false }],
    ["image/vector: atlas sí, skins no", conSesion("image", "vector"), { escenarios: true, personajes: false }],
    ["vector/image: atlas no, skins sí", conSesion("vector", "image"), { escenarios: false, personajes: true }],
    // --- «""» de personajes SIGUE a escenarios, y no al toggle local ---
    ["image/«» → skins siguen a escenarios (sí) con el toggle OFF", conSesion("image", ""), { escenarios: true, personajes: true }],
    ["vector/«» → skins siguen a escenarios (no) aunque el toggle esté ON", conSesion("vector", "", TOGGLES_ON), { escenarios: false, personajes: false }],
    // --- sin sesión (fixtures): los escenarios NO se generan pase lo que pase
    //     (#519: sin partida no hay tile que pedir, así que no hay toggle que
    //     valga); los personajes caen a su toggle local ---
    ["sin sesión y toggle OFF: nada gasta (una fixture con NPCs no paga sola)", sinSesion(), { escenarios: false, personajes: false }],
    ["sin sesión, el toggle de personajes ON no enciende los escenarios", sinSesion(TOGGLES_ON), { escenarios: false, personajes: true }],
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
