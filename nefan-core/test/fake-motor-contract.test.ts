/** El banco emite escenas que el CONTRATO DEL ROL acepta (#334-B).
 *
 *  El fake de labs/narrative suplanta al motor narrativo, así que sus escenas
 *  deben pasar `EmittedSceneSchema` — el mismo gate que el pre-flight de
 *  narrative_respond le aplica al motor real. Sin este candado, el banco
 *  ejercitaba el juego con escenas que el motor real tendría PROHIBIDO
 *  emitir (emitía `style_ref` de escena, retirado, y entraba porque nadie
 *  corría el zod en ese camino).
 *
 *  El candado NO puede ser «la validación del bridge ejercida por la
 *  batería»: el gate de lectura del bridge es `ExpandedSceneSchema`, que
 *  tolera por decisión escrita (#237) campos que el emitido rechaza. Por eso
 *  los builders viven en labs/narrative/fake-scenes.ts (módulo puro, sin
 *  listen) y se validan aquí contra el schema del EMISOR. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EmittedSceneSchema } from "../src/contract/model-io/scene-schema.js";
import { bootstrapTile, makeTile, type GenerateTile } from "../../labs/narrative/fake-scenes.js";

/** Vuelca los issues del zod en el mensaje: cuando esto salta, el fake ha
 *  divergido del contrato y hay que arreglar EL FAKE, no este test. */
function conforme(nombre: string, scene: Record<string, unknown>): void {
  const r = EmittedSceneSchema.safeParse(scene);
  assert.ok(
    r.success,
    `${nombre} viola el contrato del motor (EmittedSceneSchema):\n` +
      (r.success ? "" : r.error.issues.map((i) => `  ${i.path.join(".") || "(raíz)"}: ${i.message}`).join("\n")),
  );
}

describe("el motor falso emite lo que el contrato del rol acepta", () => {
  it("el tile de bootstrap pasa EmittedSceneSchema", () => {
    conforme("bootstrapTile()", bootstrapTile());
  });

  it("un tile normal (con crossings de vecinos) pasa EmittedSceneSchema", () => {
    const gt: GenerateTile = {
      tx: 1,
      ty: 0,
      neighbors: {
        west: {
          tile: [0, 0],
          scene_id: "tile_0_0",
          description: "el tile del pueblo",
          biome: "grass",
          crossings: [{ type: "path", at: 88, width: 4 }],
        },
      },
      nearby_places: [],
    };
    conforme("makeTile(tile normal)", makeTile(gt));
  });

  it("un tile con place anclado pasa EmittedSceneSchema", () => {
    const gt: GenerateTile = {
      tx: 2,
      ty: 0,
      neighbors: {},
      place: {
        id: "molino_bench_place",
        name: "Molino del bench",
        kind: "settlement",
        description: "Un molino de agua río abajo.",
        attrs: {},
      },
      nearby_places: [],
    };
    conforme("makeTile(tile con place)", makeTile(gt));
  });
});
