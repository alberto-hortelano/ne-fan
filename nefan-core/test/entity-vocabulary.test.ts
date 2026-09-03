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
import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";

import { VocabularioDeEntity } from "../src/contract/model-io/entity-vocabulary.js";
import { EntitySchema } from "../src/contract/model-io/scene-schema.js";
import { ConsequenceSchema, NarrativeReactionSchema } from "../src/contract/model-io/schemas.js";
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
      assert.equal(acepta(shape.name, undefined), false, `${puerta}: sin \`name\` no hay entity`);
      assert.equal(acepta(shape.description, undefined), true, `${puerta}: la procedencia es opcional`);
      assert.equal(acepta(shape.description, "posadera de manos grandes"), true, `${puerta}: una procedencia normal`);
      assert.equal(acepta(shape.description, ""), false, `${puerta}: vacía no`);
      assert.equal(acepta(shape.description, "   "), false, `${puerta}: en blanco tampoco (#237)`);
    }
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
