/** Guardia de deriva de los contratos entrada/salida del modelo.
 *
 *  La fuente única de verdad es el zod de src/contract/model-io/schemas.ts.
 *  Este test falla si el repo tiene los artefactos DERIVADOS desincronizados
 *  del zod: la región SCHEMA:AUTO de cada prompt `.md` y el `input_schema` de
 *  cada tool JSON. Si falla, corre `npm run gen:contract` y commitea. Así la
 *  prosa/tool no puede volver a decir "opcional" cuando el tipo exige el campo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTRACTS } from "../src/contract/model-io/schemas.js";
import { renderContract } from "../src/contract/model-io/render.js";
import { toJsonSchema } from "../src/contract/model-io/json-schema.js";
import { extractRegion } from "../src/contract/model-io/regions.js";
import { validateContract } from "../src/contract/model-io/validate.js";
import { NarrativeReactionSchema } from "../src/contract/model-io/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, "..", "data", "contract", "prompts");
const toolsDir = join(here, "..", "data", "contract", "tools");

test("cada prompt .md tiene la región SCHEMA:AUTO sincronizada con el zod", () => {
  for (const c of CONTRACTS) {
    const md = readFileSync(join(promptsDir, c.promptFile), "utf-8");
    const region = extractRegion(md);
    assert.ok(region !== null, `${c.promptFile} no tiene región SCHEMA:AUTO (corre npm run gen:contract)`);
    assert.equal(
      region,
      renderContract(c.name, c.schema),
      `${c.promptFile} desincronizado del zod — corre npm run gen:contract`,
    );
  }
});

test("cada tool JSON tiene input_schema sincronizado con el zod", () => {
  for (const c of CONTRACTS) {
    if (!c.toolFile) continue;
    const tool = JSON.parse(readFileSync(join(toolsDir, c.toolFile), "utf-8")) as {
      input_schema: unknown;
    };
    assert.deepEqual(
      tool.input_schema,
      toJsonSchema(c.schema),
      `${c.toolFile} desincronizado del zod — corre npm run gen:contract`,
    );
  }
});

test("narrative_event: el validador acepta formas válidas", () => {
  const ok = [
    { consequences: [] },
    { consequences: [{ type: "noop" }] },
    { consequences: [{ type: "dialogue", speaker: "Herrero", text: "Hola" }] },
    {
      consequences: [
        { type: "dialogue", speaker: "Herrero", text: "Hola", choices: ["Comprar", "Irme"] },
        { type: "story_update", delta: "El jugador saludó al herrero." },
        { type: "spawn_entity", entity_kind: "npc", description: "a blacksmith", role: "merchant" },
      ],
    },
    { consequences: [{ type: "plugin_event", plugin_id: "abc", event_type: "trade_offered", payload: { item: "x" } }] },
  ];
  for (const payload of ok) {
    const res = validateContract(NarrativeReactionSchema, payload);
    assert.equal(res.ok, true, `debería aceptar ${JSON.stringify(payload)}: ${res.ok ? "" : res.error}`);
  }
});

test("narrative_event: el validador rechaza (y da error preciso) formas inválidas", () => {
  const bad: [unknown, RegExp][] = [
    [{ consequences: [{ type: "dialogue", speaker: "X" }] }, /text/], // falta text
    [{ consequences: [{ type: "dialogue", text: "hi" }] }, /speaker/], // falta speaker
    [{ consequences: [{ type: "story_update" }] }, /delta/], // falta delta
    [{ consequences: [{ type: "spawn_entity", description: "x" }] }, /entity_kind/], // falta kind
    [{ consequences: [{ type: "spawn_entity", entity_kind: "animal", description: "x" }] }, /entity_kind/],
    [{ consequences: [{ type: "show_dialogue", speaker: "a", text: "b" }] }, /type/], // alias
    [{ consequences: [{ type: "dialogue", speaker: "a", text: "b", choices: ["1", "2", "3", "4"] }] }, /choices/],
    [{ consequences: [1, 2, 3, 4, 5].map(() => ({ type: "noop" })) }, /at most 4|4 element/], // >4
    [{ notconsequences: [] }, /consequences/], // falta la lista
  ];
  for (const [payload, re] of bad) {
    const res = validateContract(NarrativeReactionSchema, payload);
    assert.equal(res.ok, false, `debería rechazar ${JSON.stringify(payload)}`);
    if (!res.ok) assert.match(res.error, re, `error de ${JSON.stringify(payload)}: "${res.error}"`);
  }
});
