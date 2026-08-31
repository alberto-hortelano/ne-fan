/** El candado de #216: ofrecer un modelo es CONSECUENCIA de tener su set
 *  completo de hojas — `modelosCompletos` es la única puerta entre el censo
 *  crudo del disco y el desplegable del título.
 *
 *  Las constantes se fijan a sus literales A PROPÓSITO: son el contrato de
 *  disco de las hojas (`/sprites/{model}/{anim}/{angle}/…`) y entran en la
 *  clave de caché de los skins IA. Un mutante que cambie `HOJAS_ANGLE` o una
 *  anim del set haría que el censo validara hojas que el cliente no pide (o
 *  repagara arte ya generado), y ningún otro test de core lo vería.
 *
 *  PROBADO EN NEGATIVO (2026-08-31): con `every` → `some` en
 *  `modelosCompletos`, «falta UNA anim → fuera» se pone rojo; revertido. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HOJAS_ANGLE,
  HOJAS_BASE_ANIMS,
  modelosCompletos,
  type SpriteCensusResponse,
} from "../src/contracts/sprite-census.js";

/** Censo como el que emite el middleware: `required` desde las constantes. */
function censo(models: { id: string; anims: string[] }[]): SpriteCensusResponse {
  return { required: { anims: [...HOJAS_BASE_ANIMS], angle: HOJAS_ANGLE }, models };
}

const SET_COMPLETO = [...HOJAS_BASE_ANIMS];

describe("sprite-census · el contrato de disco de las hojas", () => {
  it("el ángulo del set es frontal_8 (entra en la clave de caché de los skins)", () => {
    assert.equal(HOJAS_ANGLE, "frontal_8");
  });

  it("el set base son exactamente las 10 anims, en su orden", () => {
    assert.deepEqual(
      [...HOJAS_BASE_ANIMS],
      ["idle", "walk", "run", "quick", "heavy", "medium", "defensive", "precise", "hit_react", "death"],
    );
  });
});

describe("sprite-census · modelosCompletos", () => {
  it("un modelo con el set completo se ofrece", () => {
    assert.deepEqual(modelosCompletos(censo([{ id: "y_bot", anims: SET_COMPLETO }])), ["y_bot"]);
  });

  it("falta UNA anim → fuera (por cada una de las 10)", () => {
    for (const ausente of HOJAS_BASE_ANIMS) {
      const anims = SET_COMPLETO.filter((a) => a !== ausente);
      assert.deepEqual(
        modelosCompletos(censo([{ id: "casi", anims }])),
        [],
        `sin "${ausente}" no puede ofrecerse`,
      );
    }
  });

  it("censo sin modelos → [] (el clon limpio)", () => {
    assert.deepEqual(modelosCompletos(censo([])), []);
  });

  it("un modelo sin ninguna hoja → fuera", () => {
    assert.deepEqual(modelosCompletos(censo([{ id: "vacio", anims: [] }])), []);
  });

  it("anims de sobra no penalizan, y el orden del censo se conserva", () => {
    const resultado = modelosCompletos(
      censo([
        { id: "paladin", anims: ["idle"] },
        { id: "y_bot", anims: [...SET_COMPLETO, "dance"] },
        { id: "eve", anims: SET_COMPLETO },
      ]),
    );
    assert.deepEqual(resultado, ["y_bot", "eve"]);
  });

  it("la exigencia es la del CENSO (required), no una copia local", () => {
    // Un censo con exigencia menor ofrece más: la decisión viaja en los datos.
    const relajado: SpriteCensusResponse = {
      required: { anims: ["idle"], angle: HOJAS_ANGLE },
      models: [{ id: "solo_idle", anims: ["idle"] }],
    };
    assert.deepEqual(modelosCompletos(relajado), ["solo_idle"]);
  });
});
