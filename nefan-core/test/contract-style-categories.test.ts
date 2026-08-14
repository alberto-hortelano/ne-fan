/** Candado del artefacto puente de categorías de estilo.
 *
 *  data/contract/style_categories.json lo emite `npm run gen:contract` desde
 *  la fuente única games/style-categories.ts; el lado Python
 *  (ai_server/style_categories.py) se compara contra ese JSON en su propio
 *  test. Este verifica el eslabón TS→JSON: si alguien toca las constantes sin
 *  regenerar (o edita el JSON a mano), falla con la orden de correr el
 *  codegen. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderStyleCategoriesArtifact } from "../src/contract/style-categories-artifact.js";

const ARTIFACT_PATH = fileURLToPath(
  new URL("../data/contract/style_categories.json", import.meta.url),
);

describe("contrato — style_categories.json (artefacto puente TS→Python)", () => {
  it("está sincronizado con games/style-categories.ts", () => {
    const onDisk = readFileSync(ARTIFACT_PATH, "utf-8");
    assert.equal(
      onDisk,
      renderStyleCategoriesArtifact(),
      "style_categories.json desincronizado de la fuente única — corre `npm run gen:contract`",
    );
  });
});
