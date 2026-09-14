/** Candado anti-divergencia del contrato narrativo (lado TS).
 *
 *  Ejecuta cada fixture de data/contract/fixtures/ contra los validadores
 *  espejo de narrative-mcp (validators.ts). El MISMO set lo ejecuta ai_server
 *  con sus validadores Python (ai_server/tests/test_contract_fixtures.py):
 *  si alguien endurece o relaja un lado sin el otro, uno de los dos suites
 *  rompe en CI en vez de divergir en silencio.
 *
 *  Y desde #532, DOS candados más — porque comparar accept/reject no es
 *  comparar el contrato. Medido por la crítica: con `footprint` declarado en
 *  el zod y ausente de la allow-list de `validate_narrative_reaction`, las dos
 *  suites salían VERDES y el campo moría en el wire, vivo de contrato y muerto
 *  de datos, como ya había pasado con `role` y `style_ref` (#397):
 *
 *   1. **`sobrevive`**: los pares campo/valor que deben SALIR del validador,
 *      comparados como SUBCONJUNTO (Python normaliza `position_hint` y
 *      `trigger`; el zod no). Un campo ausente o cambiado pone rojo.
 *   2. **totalidad**: toda propiedad de la variante `spawn_entity` del tool
 *      JSON está en el `sobrevive` de alguna fixture válida, o exenta con
 *      motivo. Sin esto el candado envejece en una tarde: el campo nuevo
 *      entra, nadie le escribe fixture y volvemos al punto de partida. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  validateFormatDScene,
  validateNarrativeReaction,
  validateVolumes,
} from "../../narrative-mcp/validators.js";
import { parseGround } from "../src/scene/blueprint/ground.js";
import { NarrativeReactionSchema } from "../src/contract/model-io/schemas.js";

const FIXTURES_DIR = fileURLToPath(new URL("../data/contract/fixtures", import.meta.url));

interface Fixture {
  description: string;
  expect: "accept" | "reject";
  payload: unknown;
  expected_indices?: number[];
  /** Para sanitizadores que normalizan: output exacto esperado tras aceptar. */
  expected_output?: string;
  /** Lo que el validador tiene que DEVOLVER, como subconjunto (#532). Solo en
   *  fixtures `valid/`. */
  sobrevive?: Record<string, unknown>;
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
  // La escena Format D entera. Es el set que impide que el VOCABULARIO de
  // `role` vuelva a separarse entre los dos procesos: el zod lo canda con
  // `z.enum(NPC_ROLES)` y el saneador Python leyendo el enum del tool, y aquí
  // los dos contestan a las mismas seis escenas. Sin esto, la divergencia no
  // tiene señal — que es exactamente cómo llegó a existir.
  scene: (fx) => validateFormatDScene(fx.payload),
};

/** Los validadores que además DEVUELVEN el dato saneado, para el candado de
 *  supervivencia. `validateContract` tira el resultado del `safeParse` a
 *  propósito (se usa como predicado en la ruta de carga de los snapshots: un
 *  schema que transforma ahí reescribiría el disco), así que aquí se llama al
 *  zod directamente en vez de aflojar esa función. */
const SUPERVIVENCIA: Record<string, (payload: unknown) => unknown> = {
  reaction: (payload) => NarrativeReactionSchema.safeParse(payload).data,
};

/** ¿Está `esperado` contenido en `obtenido`? Objeto: cada clave del esperado
 *  existe y casa. Array: MISMA longitud y elemento a elemento — un `consequences`
 *  más corto o más largo que el declarado es una divergencia, no un detalle, y
 *  con «prefijo» un saneador que se comiera la primera consequence saldría
 *  verde. Escalar: igualdad estricta. */
function contenidoEn(esperado: unknown, obtenido: unknown, ruta: string): string | null {
  if (Array.isArray(esperado)) {
    if (!Array.isArray(obtenido)) return `${ruta}: esperaba un array, obtuve ${JSON.stringify(obtenido)}`;
    if (esperado.length !== obtenido.length) {
      return `${ruta}: el array tiene ${obtenido.length} elemento(s) y "sobrevive" declara ${esperado.length}`;
    }
    for (let i = 0; i < esperado.length; i++) {
      const fallo = contenidoEn(esperado[i], obtenido[i], `${ruta}[${i}]`);
      if (fallo) return fallo;
    }
    return null;
  }
  if (esperado !== null && typeof esperado === "object") {
    if (obtenido === null || typeof obtenido !== "object" || Array.isArray(obtenido)) {
      return `${ruta}: esperaba un objeto, obtuve ${JSON.stringify(obtenido)}`;
    }
    for (const [k, v] of Object.entries(esperado as Record<string, unknown>)) {
      if (!(k in (obtenido as Record<string, unknown>))) {
        return `${ruta}.${k}: NO SOBREVIVE al validador (el campo se cae en silencio)`;
      }
      const fallo = contenidoEn(v, (obtenido as Record<string, unknown>)[k], `${ruta}.${k}`);
      if (fallo) return fallo;
    }
    return null;
  }
  return esperado === obtenido
    ? null
    : `${ruta}: sale ${JSON.stringify(obtenido)} y "sobrevive" declara ${JSON.stringify(esperado)}`;
}

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
        if (fx.sobrevive !== undefined) {
          assert.equal(fx.expect, "accept", "`sobrevive` solo tiene sentido en una fixture que se acepta");
          const saneado = SUPERVIVENCIA[kind];
          assert.ok(saneado, `${kind}: la fixture declara \`sobrevive\` y este kind no sabe devolver el dato saneado`);
          const fallo = contenidoEn(fx.sobrevive, saneado(fx.payload), "salida");
          assert.equal(
            fallo,
            null,
            `${fallo} — lo que el contrato declara tiene que LLEGAR, no solo pasar el gate. ` +
              "Si el campo ya no viaja, quítalo del zod y de la fixture; si viaja, arregla el validador",
          );
        }
      });
    }
  });
}

// ── Totalidad: ningún campo del spawn sin quien pruebe que llega vivo ──────

/** Campos de `spawn_entity` que NINGUNA fixture puede afirmar, con su motivo.
 *  Vacío hoy, y el mecanismo se queda escrito: una exención se ve en el diff y
 *  un olvido no. `type` no entra en la cuenta — es el discriminante, y sin él
 *  la consequence ni siquiera se despacha. */
const CAMPOS_EXENTOS: Record<string, string> = {};

describe("contrato — totalidad del spawn: todo campo declarado tiene quien lo mida (#532)", () => {
  it("cada propiedad de `spawn_entity` está en el `sobrevive` de alguna fixture válida", () => {
    const tool = JSON.parse(
      readFileSync(resolve(FIXTURES_DIR, "..", "tools", "narrative_react.json"), "utf-8"),
    ) as { input_schema: { properties: { consequences: { items: { anyOf: Array<{ properties: Record<string, unknown> }> } } } } };
    const variantes = tool.input_schema.properties.consequences.items.anyOf;
    const spawn = variantes.find(
      (v) => (v.properties.type as { const?: string } | undefined)?.const === "spawn_entity",
    );
    assert.ok(spawn, "narrative_react.json no declara la variante spawn_entity");

    const cubiertos = new Set<string>();
    for (const { fx } of loadFixtures("reaction")) {
      for (const c of (fx.sobrevive?.consequences as Array<Record<string, unknown>> | undefined) ?? []) {
        if (c.type === "spawn_entity") for (const k of Object.keys(c)) cubiertos.add(k);
      }
    }
    const huerfanos = Object.keys(spawn.properties).filter(
      (campo) => campo !== "type" && !cubiertos.has(campo) && !(campo in CAMPOS_EXENTOS),
    );
    assert.deepEqual(
      huerfanos,
      [],
      `estos campos de \`spawn_entity\` no los prueba ninguna fixture: ${huerfanos.join(", ")}. ` +
        "Añade el campo al `sobrevive` de una fixture `valid/` (y mira que el espejo Python lo " +
        "propague) o exímelo en CAMPOS_EXENTOS con su motivo. Un campo sin fixture es un campo " +
        "que puede morir en el saneador sin que nada se ponga rojo",
    );
  });

  it("una exención sin motivo escrito no vale", () => {
    for (const [campo, motivo] of Object.entries(CAMPOS_EXENTOS)) {
      assert.ok(motivo.trim().length > 20, `la exención de \`${campo}\` no explica por qué`);
    }
  });
});
