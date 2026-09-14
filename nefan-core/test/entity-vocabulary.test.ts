/** Un solo vocabulario de entity para las DOS puertas (#397).
 *
 *  `generate_scene` (`EntitySchema`) y `spawn_entity` (`SpawnEntityConsequence`)
 *  declaran `name` y `description` cogiendo EL MISMO objeto zod de
 *  `entity-vocabulary.ts` — no dos copias que digan lo mismo hoy y se separen
 *  mañana, que es exactamente lo que pasó: la escena decía «`name` obligatorio,
 *  `description` opcional» y el spawn lo contrario, y el mismo modelo escribía
 *  `description` con dos semánticas según el tool. Esto compara la IDENTIDAD
 *  (`===`) de los schemas, no su forma: dos copias idénticas también pasarían
 *  un test de forma, y son la deuda que se cierra aquí. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";

import { MOTIVO_NAME_INVALIDO, VocabularioDeEntity } from "../src/contract/model-io/entity-vocabulary.js";
import { EntitySchema } from "../src/contract/model-io/scene-schema.js";
import {
  ConsequenceSchema,
  MOTIVO_CAMPO_DE_NPC_EN_OTRA_CLASE,
  MOTIVO_FOOTPRINT_DEMASIADO_GRANDE,
  MOTIVO_FOOTPRINT_EN_NPC,
  NarrativeReactionSchema,
  TOPE_DE_FOOTPRINT_CELDAS,
} from "../src/contract/model-io/schemas.js";
import { validateContract } from "../src/contract/model-io/validate.js";
import { renderContract } from "../src/contract/model-io/render.js";

/** El shape de la entity de escena: `EntitySchema` es `EntityBase.strict()
 *  .superRefine(…)`, un ZodEffects sobre el objeto; `innerType()` lo abre. */
const shapeDeEscena = (EntitySchema.innerType() as ZodObject<ZodRawShape>).shape;

/** El shape del spawn: la opción del discriminated union con `type: "spawn_entity"`. */
const shapeDeSpawn = (() => {
  const opcion = ConsequenceSchema.options.find(
    (o) => (o.shape.type as { value?: unknown }).value === "spawn_entity",
  ) as ZodObject<ZodRawShape> | undefined;
  assert.ok(opcion, "ConsequenceSchema declara spawn_entity");
  return opcion.shape;
})();

/** La raíz del repo BUSCÁNDOLA hacia arriba, no contándola con `../..`.
 *
 *  Este test lee el espejo Python, que vive FUERA de `nefan-core`, y el salto
 *  fijo se rompió en cuanto el fichero dejó de estar donde el autor lo contó:
 *  Stryker copia la batería a `nefan-core/.stryker-tmp/sandbox-XXXX/`, un nivel
 *  más hondo, así que `../../ai_server` caía en `.stryker-tmp/ai_server` y el
 *  dry-run moría con ENOENT. No falló el test: falló el módulo ENTERO — la
 *  corrida 33790710680 dejó `contrato-escena` SIN INFORME (290 mutantes sin
 *  medir) y salió en rojo, y nada lo dijo hasta el reparto, porque la mutación
 *  no corre por PR. Buscar la raíz sobrevive a cualquier profundidad. */
function raizDelRepo(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "ai_server")) && existsSync(join(dir, "nefan-core"))) return dir;
    const arriba = dirname(dir);
    if (arriba === dir) break;
    dir = arriba;
  }
  throw new Error(
    `no encuentro la raíz del repo subiendo desde ${dirname(fileURLToPath(import.meta.url))}: ` +
      `busco un directorio que tenga a la vez ai_server/ y nefan-core/`,
  );
}

describe("entity-vocabulary · las dos puertas cogen EL MISMO objeto", () => {
  it("`name` es el mismo schema en la escena y en el spawn", () => {
    assert.equal(shapeDeEscena.name, VocabularioDeEntity.name, "generate_scene tiene su propia copia de `name`");
    assert.equal(shapeDeSpawn.name, VocabularioDeEntity.name, "spawn_entity tiene su propia copia de `name`");
  });

  it("`description` es el mismo schema en la escena y en el spawn", () => {
    assert.equal(shapeDeEscena.description, VocabularioDeEntity.description, "generate_scene tiene su propia copia de `description`");
    assert.equal(shapeDeSpawn.description, VocabularioDeEntity.description, "spawn_entity tiene su propia copia de `description`");
  });

  it("y por eso dicen lo mismo: `name` obligatorio y no vacío, `description` opcional y nunca en blanco", () => {
    const acepta = (s: ZodTypeAny, v: unknown) => s.safeParse(v).success;
    for (const [puerta, shape] of [["escena", shapeDeEscena], ["spawn", shapeDeSpawn]] as const) {
      assert.equal(acepta(shape.name, "Nogala"), true, `${puerta}: un nombre normal`);
      assert.equal(acepta(shape.name, ""), false, `${puerta}: el rótulo vacío no es un rótulo`);
      assert.equal(acepta(shape.name, "   "), false, `${puerta}: el rótulo en blanco tampoco (QA PR-C, H1)`);
      assert.equal(acepta(shape.name, undefined), false, `${puerta}: sin \`name\` no hay entity`);
      assert.equal(acepta(shape.description, undefined), true, `${puerta}: la procedencia es opcional`);
      assert.equal(acepta(shape.description, "posadera de manos grandes"), true, `${puerta}: una procedencia normal`);
      assert.equal(acepta(shape.description, ""), false, `${puerta}: vacía no`);
      assert.equal(acepta(shape.description, "   "), false, `${puerta}: en blanco tampoco (#237)`);
    }
  });

  it("un `name` en blanco se rechaza NOMBRANDO el campo, con la misma frase que el espejo Python", () => {
    // H1 de la QA de PR-C: `"   "` pasaba el zod y lo rechazaba Python — la
    // divergencia de espejo que #397 vino a cerrar, en el campo nuevo. La
    // frase es una y vive en el vocabulario; el Python la copia literal y aquí
    // se comprueba que sigue copiada (el modelo entra por las dos vías).
    const r = VocabularioDeEntity.name.safeParse("   ");
    assert.equal(r.success, false);
    if (!r.success) assert.equal(r.error.issues[0].message, MOTIVO_NAME_INVALIDO);
    const python = readFileSync(join(raizDelRepo(), "ai_server", "narrative_schemas.py"), "utf-8");
    // El f-string de Python parte la frase en dos literales adyacentes; se
    // compara sin los saltos de línea ni las comillas del medio.
    const plano = python.replace(/"\s*\n\s*"/g, "");
    assert.ok(plano.includes(MOTIVO_NAME_INVALIDO), "narrative_schemas.py no dice la misma frase que el zod para `name`");
  });

  it("el vocabulario no transforma: lo que entra es lo que sale (predicado, no saneador)", () => {
    const r = VocabularioDeEntity.description.safeParse("  tabernero  ");
    assert.ok(r.success);
    assert.equal(r.data, "  tabernero  ", "un `.trim()` aquí reescribiría los snapshots al cargarlos");
  });
});

describe("entity-vocabulary · lo que el motor VE por spawn_entity", () => {
  it("un spawn con `name` y sin `description` pasa; sin `name` se rechaza nombrando el campo", () => {
    const ok = validateContract(NarrativeReactionSchema, {
      consequences: [{ type: "spawn_entity", entity_kind: "object", name: "Farol del zaguán" }],
    });
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
    const ko = validateContract(NarrativeReactionSchema, {
      consequences: [{ type: "spawn_entity", entity_kind: "building", description: "forja de piedra" }],
    });
    assert.equal(ko.ok, false);
    if (!ko.ok) assert.match(ko.error, /name/);
  });

  it("lo que OCUPA y lo que FRENA son dos cosas, y el contrato las separa (#532)", () => {
    const acepta = (c: Record<string, unknown>) =>
      validateContract(NarrativeReactionSchema, { consequences: [{ type: "spawn_entity", ...c }] });
    // `item` es la clase que no frena; `footprint` (celdas) solo afina.
    assert.equal(acepta({ entity_kind: "item", name: "Bolsa de monedas" }).ok, true);
    assert.equal(acepta({ entity_kind: "object", name: "Carro", footprint: [6, 6] }).ok, true);
    // Y lo que no se admite: un tamaño en un personaje, medias celdas, y el 0.
    const enNpc = acepta({ entity_kind: "npc", name: "Telmo", footprint: [2, 2] });
    assert.equal(enNpc.ok, false);
    if (!enNpc.ok) assert.equal(enNpc.error, `consequences[0].footprint: ${MOTIVO_FOOTPRINT_EN_NPC}`);
    assert.equal(acepta({ entity_kind: "object", name: "Carro", footprint: [2.5, 3] }).ok, false);
    assert.equal(acepta({ entity_kind: "object", name: "Carro", footprint: [0, 3] }).ok, false);
    assert.equal(acepta({ entity_kind: "object", name: "Carro", footprint: [3] }).ok, false);
  });

  it("la huella tiene TECHO, y es el suelo sobre el que se pone (#532, H-5 de QA)", () => {
    const acepta = (c: Record<string, unknown>) =>
      validateContract(NarrativeReactionSchema, { consequences: [{ type: "spawn_entity", ...c }] });
    // 200×200 m sobre un tile de 64: el tile entero sólido, sin un aviso. El
    // tope no se inventa —es `TILE_CELLS`— y el gate de la escena ya acotaba.
    const enorme = acepta({ entity_kind: "object", name: "Muro", footprint: [400, 400] });
    assert.equal(enorme.ok, false);
    if (!enorme.ok) assert.equal(enorme.error, `consequences[0].footprint: ${MOTIVO_FOOTPRINT_DEMASIADO_GRANDE}`);
    // Y la asimetría: un lado enorme y el otro de una celda también.
    assert.equal(acepta({ entity_kind: "object", name: "Muro", footprint: [1, 100000] }).ok, false);
    // El tile entero SÍ cabe: el tope es «no mayor que el suelo», no «pequeño».
    assert.equal(
      acepta({ entity_kind: "building", name: "Muralla", footprint: [TOPE_DE_FOOTPRINT_CELDAS, TOPE_DE_FOOTPRINT_CELDAS] }).ok,
      true,
    );
  });

  it("`role` y `style_ref` solo valen en un `npc`, con la misma vara que `footprint` (H-8 de QA)", () => {
    const acepta = (c: Record<string, unknown>) =>
      validateContract(NarrativeReactionSchema, { consequences: [{ type: "spawn_entity", ...c }] });
    // `combatForHostileRole` solo corre para `npc`, así que un `item` con
    // `role:"hostile"` dejaba al motor creyendo que puso algo contra lo que
    // pelear. Se aceptaba en silencio mientras el `footprint` de un npc era
    // fail-loud: dos varas para la misma clase de error.
    const item = acepta({ entity_kind: "item", name: "Bolsa maldita", role: "hostile" });
    assert.equal(item.ok, false);
    if (!item.ok) assert.equal(item.error, `consequences[0].role: ${MOTIVO_CAMPO_DE_NPC_EN_OTRA_CLASE}`);
    assert.equal(acepta({ entity_kind: "object", name: "Cofre", style_ref: "bandido" }).ok, false);
    assert.equal(acepta({ entity_kind: "building", name: "Forja", role: "guard" }).ok, false);
    // Y en un `npc` siguen siendo lo que eran.
    assert.equal(acepta({ entity_kind: "npc", name: "Bandido", role: "hostile", style_ref: "bandido" }).ok, true);
  });

  it("y el espejo Python rechaza el `footprint` de un npc con la MISMA frase", () => {
    // Mismo criterio que `name`: el modelo entra por las dos vías (pre-flight
    // MCP y API directa) y el motivo que lee tiene que ser el mismo, o corrige
    // hacia dos sitios distintos. La frase vive en el zod y Python la copia.
    const python = readFileSync(join(raizDelRepo(), "ai_server", "narrative_schemas.py"), "utf-8");
    // Los literales adyacentes de Python se pegan; el f-string del tope lleva
    // el número interpolado, así que se compara la parte que no lo es.
    // Los literales adyacentes se pegan sin mirar con qué comilla están
    // escritos: una frase que lleva comillas dentro alterna las dos en Python.
    const plano = python.replace(/["']\s*\n\s*["']/g, "");
    for (const [que, frase] of [
      ["`footprint` en un npc", MOTIVO_FOOTPRINT_EN_NPC],
      ["`role`/`style_ref` fuera de un npc", MOTIVO_CAMPO_DE_NPC_EN_OTRA_CLASE],
      ["la huella demasiado grande", MOTIVO_FOOTPRINT_DEMASIADO_GRANDE.slice(MOTIVO_FOOTPRINT_DEMASIADO_GRANDE.indexOf("): ") + 3)],
    ] as const) {
      assert.ok(plano.includes(frase), `narrative_schemas.py no dice la misma frase que el zod para ${que}`);
    }
  });

  it("el bloque renderizado del prompt enseña `name` obligatorio y `description?` opcional, y en ese orden", () => {
    // Es lo que el modelo LEE (narrative_event.md se renderiza de aquí): si el
    // prompt dijera lo contrario que el validador, el modelo no podría acertar.
    const texto = renderContract("NarrativeReaction", NarrativeReactionSchema);
    const spawn = texto.slice(texto.indexOf('type: "spawn_entity"'));
    const name = spawn.indexOf("name: string");
    const description = spawn.indexOf("description?: string");
    assert.ok(name >= 0, `el prompt no declara \`name\` obligatorio:\n${spawn.slice(0, 400)}`);
    assert.ok(description >= 0, `el prompt no declara \`description?\` opcional:\n${spawn.slice(0, 400)}`);
    assert.ok(name < description, "la etiqueta va antes que la procedencia, como en generate_scene");
    assert.equal(spawn.includes("name?: string"), false, "el prompt vuelve a ofrecer `name` opcional");
  });
});
