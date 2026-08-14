/** Codegen de los contratos entrada/salida del modelo desde el zod SoT.
 *
 *  Para cada entrada de CONTRACTS (src/contract/model-io/schemas.ts):
 *    - inyecta el bloque de tipo renderizado en la región SCHEMA:AUTO del
 *      prompt `.md` (lo que ve el modelo por MCP y por el system prompt de la
 *      API directa — ai_server carga el mismo `.md`),
 *    - regenera el `input_schema` del tool JSON del fallback por API,
 *      preservando su `name` y `description` escritos a mano.
 *
 *  Idempotente: correrlo dos veces no cambia nada. El test contract-model-io
 *  falla si el repo tiene los artefactos desincronizados del zod (guardia de
 *  deriva). Ejecutar: `npm run gen:contract` desde nefan-core.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTRACTS } from "../src/contract/model-io/schemas.js";
import { renderContract } from "../src/contract/model-io/render.js";
import { toJsonSchema } from "../src/contract/model-io/json-schema.js";
import { injectRegion } from "../src/contract/model-io/regions.js";
import { renderStyleCategoriesArtifact } from "../src/contract/style-categories-artifact.js";

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, "..", "data", "contract", "prompts");
const toolsDir = join(here, "..", "data", "contract", "tools");

let changed = 0;

for (const c of CONTRACTS) {
  const contractText = renderContract(c.name, c.schema);

  // 1. Prompt .md — inyectar/actualizar la región SCHEMA:AUTO.
  const mdPath = join(promptsDir, c.promptFile);
  if (!existsSync(mdPath)) {
    throw new Error(`gen-contract: falta el prompt ${c.promptFile} para el kind '${c.kind}'`);
  }
  const md = readFileSync(mdPath, "utf-8");
  const nextMd = injectRegion(md, contractText);
  if (nextMd !== md) {
    writeFileSync(mdPath, nextMd, "utf-8");
    console.log(`prompt: actualizado ${c.promptFile}`);
    changed++;
  }

  // 2. Tool JSON — regenerar input_schema preservando name/description.
  if (c.toolFile) {
    const toolPath = join(toolsDir, c.toolFile);
    if (!existsSync(toolPath)) {
      throw new Error(`gen-contract: falta el tool ${c.toolFile} para el kind '${c.kind}'`);
    }
    const tool = JSON.parse(readFileSync(toolPath, "utf-8")) as {
      name: string;
      description: string;
      input_schema: unknown;
    };
    const nextTool = {
      name: tool.name,
      description: tool.description,
      input_schema: toJsonSchema(c.schema),
    };
    const nextJson = JSON.stringify(nextTool, null, 2) + "\n";
    const prevJson = readFileSync(toolPath, "utf-8");
    if (nextJson !== prevJson) {
      writeFileSync(toolPath, nextJson, "utf-8");
      console.log(`tool: regenerado ${c.toolFile}`);
      changed++;
    }
  }
}

// 3. Enum de categorías de estilo — artefacto puente para el lado Python
// (ai_server/tests/test_style_categories_sync.py lo compara con
// ai_server/style_categories.py).
const styleCatsPath = join(here, "..", "data", "contract", "style_categories.json");
const styleCatsNext = renderStyleCategoriesArtifact();
const styleCatsPrev = existsSync(styleCatsPath) ? readFileSync(styleCatsPath, "utf-8") : "";
if (styleCatsNext !== styleCatsPrev) {
  writeFileSync(styleCatsPath, styleCatsNext, "utf-8");
  console.log("artefacto: regenerado style_categories.json");
  changed++;
}

console.log(changed === 0 ? "gen-contract: sin cambios (sincronizado)" : `gen-contract: ${changed} artefacto(s) actualizados`);
