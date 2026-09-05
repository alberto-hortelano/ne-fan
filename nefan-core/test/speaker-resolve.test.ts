/** Tests de la correspondencia hablante→entidad (src/narrative/speaker-resolve.ts).
 *
 *  El motor narrativo dice QUIÉN habla con un nombre; el cliente necesita la
 *  entidad para enseñar su cara en el panel de diálogo. Aquí se comprueba que
 *  esa traducción acierta en los casos reales de una partida (homónimos,
 *  acentos, narrador) y que NUNCA inventa un hablante. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSpeaker } from "../src/narrative/speaker-resolve.js";
import type { EntityRecord } from "../src/narrative/types.js";

function npc(
  id: string,
  name: string,
  sceneId = "plaza",
  data: Record<string, unknown> = {},
): EntityRecord {
  return {
    id,
    type: "npc",
    scene_id: sceneId,
    spawned_at: "2026-08-20T00:00:00.000Z",
    spawn_reason: "scene_init",
    spawn_event_id: "",
    position: [0, 0, 0],
    data: { name, ...data },
    asset_refs: [],
  };
}

describe("hablante → entidad", () => {
  it("casa por nombre exacto y devuelve el prompt con el que se pinta", () => {
    const entities = [npc("npc_1", "Marta la Herrera", "plaza", { description: "una herrera fornida" })];
    const who = resolveSpeaker(entities, "plaza", "Marta la Herrera");
    assert.equal(who?.id, "npc_1");
    assert.equal(who?.skinPrompt, "una herrera fornida");
  });

  it("sin descripción usa el nombre (misma identidad que pide el sprite)", () => {
    const who = resolveSpeaker([npc("npc_1", "Marta")], "plaza", "Marta");
    assert.equal(who?.skinPrompt, "Marta");
  });

  it("con homónimos gana el de la escena activa", () => {
    const entities = [npc("npc_lejos", "Guardia", "muralla"), npc("npc_aqui", "Guardia", "plaza")];
    assert.equal(resolveSpeaker(entities, "plaza", "Guardia")?.id, "npc_aqui");
  });

  it("la entidad con la que se está hablando desempata", () => {
    const entities = [npc("g1", "Guardia"), npc("g2", "Guardia")];
    assert.equal(resolveSpeaker(entities, "plaza", "Guardia", "g1")?.id, "g1");
    assert.equal(resolveSpeaker(entities, "plaza", "Guardia", "g2")?.id, "g2");
  });

  it("un speaker vacío o '?' cae en el NPC con el que se interactúa", () => {
    const entities = [npc("npc_1", "Marta")];
    assert.equal(resolveSpeaker(entities, "plaza", "", "npc_1")?.id, "npc_1");
    assert.equal(resolveSpeaker(entities, "plaza", "?", "npc_1")?.id, "npc_1");
  });

  it("tolera acentos, mayúsculas y puntuación del modelo", () => {
    const entities = [npc("npc_1", "Íñigo el Tuerto")];
    assert.equal(resolveSpeaker(entities, "plaza", "inigo el tuerto,")?.id, "npc_1");
  });

  it("un narrador o un nombre inventado NO resuelve a nadie", () => {
    const entities = [npc("npc_1", "Marta")];
    assert.equal(resolveSpeaker(entities, "plaza", "Voz en la niebla"), null);
    assert.equal(resolveSpeaker([], "plaza", "Marta"), null);
  });

  it("ignora entidades que no son NPC", () => {
    const forja = { ...npc("obj_1", "Forja"), type: "object" } as EntityRecord;
    assert.equal(resolveSpeaker([forja], "plaza", "Forja"), null);
  });

  it("arrastra la ref de personaje elegida por el motor", () => {
    const entities = [npc("npc_1", "Marta", "plaza", { style_ref: "warrior" })];
    assert.equal(resolveSpeaker(entities, "plaza", "Marta")?.styleRef, "warrior");
  });
});
