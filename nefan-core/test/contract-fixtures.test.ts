/** Candado anti-divergencia del contrato narrativo (lado TS).
 *
 *  Ejecuta cada fixture de data/contract/fixtures/ contra los validadores
 *  espejo de narrative-mcp (validators.ts). El MISMO set lo ejecuta ai_server
 *  con sus validadores Python (ai_server/tests/test_contract_fixtures.py):
 *  si alguien endurece o relaja un lado sin el otro, uno de los dos suites
 *  rompe en CI en vez de divergir en silencio. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  validateNarrativeReaction,
  validateVolumes,
} from "../../narrative-mcp/validators.js";
import { parseGround } from "../src/scene/blueprint/ground.js";

const FIXTURES_DIR = fileURLToPath(new URL("../data/contract/fixtures", import.meta.url));

interface Fixture {
  description: string;
  expect: "accept" | "reject";
  payload: unknown;
  expected_indices?: number[];
  /** Para sanitizadores que normalizan: output exacto esperado tras aceptar. */
  expected_output?: string;
}

function loadFixtures(kind: string): Array<{ name: string; fx: Fixture }> {
  const out: Array<{ name: string; fx: Fixture }> = [];
  for (const verdict of ["valid", "invalid"] as const) {
    const dir = resolve(FIXTURES_DIR, kind, verdict);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      out.push({
        name: `${verdict}/${file}`,
        fx: JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as Fixture,
      });
    }
  }
  assert.ok(out.length > 0, `sin fixtures para ${kind}`);
  return out;
}

const VALIDATORS: Record<string, (fx: Fixture) => { ok: boolean; svg?: string }> = {
  reaction: (fx) => validateNarrativeReaction(fx.payload),
  // El plan de suelo declarativo lo valida el zod de producción (parseGround)
  // — el espejo Python (validate_ground) corre el MISMO set de fixtures.
  ground_plan: (fx) => parseGround((fx.payload as { ground: unknown }).ground),
  // volumes: el pre-flight ESTRICTO del MCP (narrative_respond rechaza con el
  // error preciso y el motor re-responde — fail-loud, nunca descartar).
  volumes_plan: (fx) => validateVolumes((fx.payload as { volumes: unknown }).volumes),
};

for (const [kind, run] of Object.entries(VALIDATORS)) {
  describe(`contrato — fixtures ${kind} (validador TS de narrative-mcp)`, () => {
    for (const { name, fx } of loadFixtures(kind)) {
      it(`${name}: ${fx.description}`, () => {
        const result = run(fx);
        const expected = fx.expect === "accept";
        assert.equal(
          result.ok,
          expected,
          `esperaba ${fx.expect}, obtuve ${JSON.stringify(result)} — si el cambio de regla es intencional, actualiza el validador Python Y la fixture`,
        );
        if (fx.expected_output !== undefined && result.ok) {
          assert.equal(result.svg, fx.expected_output, "la normalización TS difiere del output esperado");
        }
      });
    }
  });
}
