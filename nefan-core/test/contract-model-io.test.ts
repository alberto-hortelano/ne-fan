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
import {
  NarrativeReactionSchema,
  WeaponOrientSchema,
  WeaponVerifySchema,
} from "../src/contract/model-io/schemas.js";

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
        { type: "spawn_entity", entity_kind: "npc", name: "Herrero", description: "a blacksmith", role: "merchant" },
        // `description` es OPCIONAL (la procedencia); `name` es el rótulo (#397).
        { type: "spawn_entity", entity_kind: "object", name: "Farol del zaguán" },
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
    [{ consequences: [{ type: "spawn_entity", name: "x" }] }, /entity_kind/], // falta kind
    [{ consequences: [{ type: "spawn_entity", entity_kind: "animal", name: "x" }] }, /entity_kind/],
    // #397: `name` obligatorio y no vacío (es el rótulo); `description`, si va, no en blanco.
    [{ consequences: [{ type: "spawn_entity", entity_kind: "npc", description: "un lobo" }] }, /name/],
    [{ consequences: [{ type: "spawn_entity", entity_kind: "npc", name: "", description: "un lobo" }] }, /name/],
    [{ consequences: [{ type: "spawn_entity", entity_kind: "npc", name: "Lobo", description: "   " }] }, /description/],
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

test("weapon_orient: acepta un frame válido, rechaza degenerado/paralelo", () => {
  const good = {
    grip_point_normalized: [0.5, 0.1, 0.5],
    blade_direction: [0, 1, 0],
    up_direction: [0, 0, 1],
    weapon_type: "sword",
    confidence: 0.9,
  };
  assert.equal(validateContract(WeaponOrientSchema, good).ok, true);

  // vector degenerado
  const degenerate = { ...good, up_direction: [0, 0, 0] };
  const r1 = validateContract(WeaponOrientSchema, degenerate);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.match(r1.error, /up_direction/);

  // blade y up casi paralelos → frame singular
  const parallel = { ...good, up_direction: [0, 1, 0] };
  const r2 = validateContract(WeaponOrientSchema, parallel);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.error, /paralelo|singular/);

  // falta un campo requerido
  const noConf = { ...good } as Record<string, unknown>;
  delete noConf.confidence;
  assert.equal(validateContract(WeaponOrientSchema, noConf).ok, false);

  // weapon_type fuera del enum
  assert.equal(validateContract(WeaponOrientSchema, { ...good, weapon_type: "gun" }).ok, false);
});

test("weapon_verify: ok solo es válido; issue/delta opcionales", () => {
  assert.equal(validateContract(WeaponVerifySchema, { ok: true }).ok, true);
  assert.equal(
    validateContract(WeaponVerifySchema, {
      ok: false,
      issue: "gira 90º",
      suggested_delta_euler: [0, 90, 0],
    }).ok,
    true,
  );
  assert.equal(validateContract(WeaponVerifySchema, {}).ok, false); // falta ok
  assert.equal(
    validateContract(WeaponVerifySchema, { ok: false, suggested_delta_euler: [1, 2] }).ok,
    false, // delta debe ser 3 números
  );
});
