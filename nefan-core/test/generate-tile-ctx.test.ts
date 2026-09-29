/** buildGenerateTileCtx lleva al motor los places que YA viven en el tile que
 *  genera (#465, H1). Antes todo place anclado a (tx,ty) que no fuera el
 *  elegido como `place` se saltaba con `continue`: una entrada regenerada
 *  (#578) no sabía que la posada tenía su huella en el mapa, la construía en
 *  otro sitio y el mapa se quedaba con rects sobre una geometría que ya no
 *  existía. Y el `place` no llevaba su propio rect.
 *
 *  Lo que esto NO sujeta: que el motor construya cada lugar DENTRO de su rect
 *  (conducta del modelo; se mide en playtest) ni que no los re-ancle con
 *  map_upsert_place (solo prosa). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildGenerateTileCtx } from "../bridge/handlers/tile.js";
import { makeCtx } from "./helpers.js";

function mundo() {
  const { ctx, narrative } = makeCtx();
  narrative.startNewSession("plugtest");
  const wm = narrative.worldMap;
  wm.upsertPlace({
    id: "postas", kind: "settlement", parent_id: "world", name: "Postas del Sedal",
    description: "El pueblo de las postas.", anchor: { tx: 0, ty: 0, rect: [20, 20, 80, 80] },
  });
  wm.upsertPlace({
    id: "posta_del_farol", kind: "site", parent_id: "postas", name: "La Posta del Farol",
    description: "La lleva Marela Tresgavillas.", anchor: { tx: 0, ty: 0, rect: [40, 34, 22, 16] },
  });
  wm.upsertPlace({
    id: "plaza", kind: "site", parent_id: "postas", name: "Plaza de las Postas",
    description: "Fuente y puestos.", anchor: { tx: 0, ty: 0 },
  });
  wm.upsertPlace({
    id: "vado", kind: "landmark", parent_id: "world", name: "Vado Almar",
    description: "Un vado.", anchor: { tx: 1, ty: 0 },
  });
  return ctx;
}

const SITIOS = [
  {
    id: "posta_del_farol", name: "La Posta del Farol", kind: "site",
    description: "La lleva Marela Tresgavillas.", rect: [40, 34, 22, 16],
  },
  { id: "plaza", name: "Plaza de las Postas", kind: "site", description: "Fuente y puestos." },
];

describe("buildGenerateTileCtx — los places anclados en el tile viajan con su rect (#465, H1)", () => {
  it("con placeId: el place lleva su rect y los DEMÁS anclados aquí van a anchored_places", () => {
    const gt = buildGenerateTileCtx(mundo(), 0, 0, undefined, "postas");
    assert.equal(gt.place?.id, "postas");
    assert.deepEqual(gt.place?.rect, [20, 20, 80, 80]);
    assert.deepEqual(gt.anchored_places, SITIOS);
    // El sin rect no lleva la clave (ni `rect: undefined`).
    assert.equal("rect" in gt.anchored_places[1]!, false);
    // El del tile vecino sigue siendo cercano, no anclado aquí.
    assert.deepEqual(gt.nearby_places, [{ id: "vado", name: "Vado Almar", kind: "landmark", tile: [1, 0] }]);
  });

  it("sin placeId: el primero anclado es el place y los otros no se pierden", () => {
    const gt = buildGenerateTileCtx(mundo(), 0, 0);
    assert.equal(gt.place?.id, "postas");
    assert.deepEqual(gt.anchored_places, SITIOS);
  });

  it("el place de placeId nunca se repite en anchored_places, aunque esté anclado aquí", () => {
    const gt = buildGenerateTileCtx(mundo(), 0, 0, undefined, "posta_del_farol");
    assert.equal(gt.place?.id, "posta_del_farol");
    assert.deepEqual(gt.place?.rect, [40, 34, 22, 16]);
    assert.deepEqual(
      gt.anchored_places.map((p) => p.id),
      ["postas", "plaza"],
    );
  });

  it("un tile sin nada anclado lleva anchored_places vacío, no ausente", () => {
    const gt = buildGenerateTileCtx(mundo(), 5, 5);
    assert.equal(gt.place, undefined);
    assert.deepEqual(gt.anchored_places, []);
  });

  it("cada clave que emite generate_tile, y las de sus lugares, las nombra el prompt", () => {
    const prompt = readFileSync(
      fileURLToPath(new URL("../data/contract/prompts/tile_instructions.md", import.meta.url)),
      "utf8",
    );
    const gt = buildGenerateTileCtx(mundo(), 0, 0, "west", "postas");
    const claves = new Set([
      ...Object.keys(gt),
      ...Object.keys(gt.place!),
      ...Object.keys(gt.anchored_places[0]!),
    ]);
    for (const clave of claves) {
      assert.match(prompt, new RegExp(`\\b${clave}\\b`), `tile_instructions.md no nombra «${clave}»`);
    }
  });
});
