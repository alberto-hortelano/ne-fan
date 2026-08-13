import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import type { Consequence } from "../src/narrative/types.js";

function makeState() {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("game");
  s.recordSceneLoaded("scene_1", { id: "scene_1" });
  return s;
}

describe("dispatchConsequences", () => {
  it("emits ambient message when consequences are empty", () => {
    const s = makeState();
    const r = dispatchConsequences(s, "evt_1", []);
    assert.equal(r.injectedDialogue, false);
    assert.equal(r.effects.length, 1);
    assert.equal(r.effects[0].kind, "ambient_message");
  });

  it("dialogue consequence becomes show_dialogue effect", () => {
    const s = makeState();
    const cs: Consequence[] = [
      { type: "dialogue", speaker: "Aldo", text: "Hola", choices: ["a", "b"] },
    ];
    const r = dispatchConsequences(s, "evt_1", cs);
    assert.equal(r.injectedDialogue, true);
    assert.equal(r.effects[0].kind, "show_dialogue");
    if (r.effects[0].kind === "show_dialogue") {
      assert.equal(r.effects[0].speaker, "Aldo");
      assert.equal(r.effects[0].text, "Hola");
    }
  });

  it("story_update appends to story_so_far", () => {
    const s = makeState();
    const cs: Consequence[] = [{ type: "story_update", delta: "Algo cambia" }];
    dispatchConsequences(s, "evt_1", cs);
    assert.equal(s.story_so_far, "Algo cambia");
  });

  it("spawn_entity records on state and emits effect with resolved position", () => {
    const s = makeState();
    s.recordDialogueEvent("Aldo", "?", [], -1); // event_id evt_0001
    const cs: Consequence[] = [
      {
        type: "spawn_entity",
        entity_kind: "npc",
        description: "guard",
        position_hint: "near_player",
        name: "Marcus",
      },
    ];
    const r = dispatchConsequences(s, "evt_0001", cs, {
      playerPosition: [10, 0, 5],
      playerForward: [0, 0, -1],
      generateEntityId: () => "narr_npc_test",
    });
    assert.equal(s.entities.length, 1);
    assert.equal(s.entities[0].id, "narr_npc_test");
    assert.equal(s.entities[0].type, "npc");
    assert.deepEqual(s.entities[0].position, [10, 0, 0]); // player + fwd*5
    assert.equal(r.effects[0].kind, "spawn_entity");
    if (r.effects[0].kind === "spawn_entity") {
      assert.equal(r.effects[0].name, "Marcus");
      assert.equal(r.effects[0].entityKind, "npc");
    }
  });

  it("varios spawns del mismo turno reciben ids únicos (no colisionan)", () => {
    const s = makeState();
    const cs: Consequence[] = [
      { type: "spawn_entity", entity_kind: "npc", description: "guardia 1" },
      { type: "spawn_entity", entity_kind: "npc", description: "guardia 2" },
      { type: "spawn_entity", entity_kind: "npc", description: "guardia 3" },
    ];
    const r = dispatchConsequences(s, "evt_1", cs); // sin generateEntityId → default
    const ids = s.entities.map((e) => e.id);
    assert.equal(new Set(ids).size, 3, `ids duplicados: ${ids.join(",")}`);
    // El effect emitido lleva el id realmente registrado.
    const effIds = r.effects
      .filter((e): e is Extract<typeof e, { kind: "spawn_entity" }> => e.kind === "spawn_entity")
      .map((e) => e.entityId);
    assert.deepEqual(effIds.sort(), ids.sort());
  });

  it("recordEntitySpawned sufija ids duplicados en vez de colapsarlos", () => {
    const s = makeState();
    const a = s.recordEntitySpawned("dup", "npc", "scene", [0, 0, 0], {});
    const b = s.recordEntitySpawned("dup", "npc", "scene", [1, 0, 0], {});
    assert.equal(a, "dup");
    assert.equal(b, "dup_2");
    assert.equal(s.entities.length, 2);
  });

  it("schedule_event persiste en la agenda, reaparece en el contexto y se resuelve", () => {
    // Regresión (playtest 2026-08-13): el schedule_event se emitía como effect
    // y se PERDÍA — el motor jamás volvía a ver sus eventos pendientes y los
    // duplicaba en story_update por miedo. Ahora: agenda persistida + contexto.
    const s = makeState();
    const cs: Consequence[] = [
      { type: "schedule_event", description: "ambush", trigger: "timer:60" },
    ];
    const r = dispatchConsequences(s, "evt_1", cs);
    const eff = r.effects[0];
    assert.equal(eff.kind, "schedule_event");
    const schedId = (eff as { id: string }).id;
    assert.match(schedId, /^sched_\d{4}$/, "el effect lleva el id de la agenda");

    // Persistido y visible para el motor en cada turno.
    assert.equal(s.scheduled_events.length, 1);
    const ctx = s.serializeForLlm();
    assert.deepEqual(ctx.scheduled_events, [
      { id: schedId, description: "ambush", trigger: "timer:60" },
    ]);

    // Resolver lo retira del contexto; id desconocido → false.
    assert.equal(s.resolveScheduledEvent("sched_9999"), false);
    assert.equal(s.resolveScheduledEvent(schedId), true);
    assert.equal(s.scheduled_events.length, 0);
    assert.equal(s.serializeForLlm().scheduled_events, undefined, "agenda vacía no viaja");
  });

  it("la agenda sobrevive al save/load y tiene cap 20 (cae el más antiguo)", async () => {
    const storage = new MemorySessionStorage();
    const s = new NarrativeState(storage);
    const id = s.startNewSession("g");
    for (let i = 0; i < 22; i++) {
      s.addScheduledEvent(`evento ${i}`, undefined, "evt_1");
    }
    assert.equal(s.scheduled_events.length, 20, "cap 20");
    assert.equal(
      s.scheduled_events.some((e) => e.description === "evento 0"),
      false,
      "el más antiguo cayó",
    );
    await s.save();
    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(id), true);
    assert.equal(s2.scheduled_events.length, 20, "la agenda sobrevive al load");
    // El contador no se resetea: el siguiente id no colisiona con los vivos.
    const nextId = s2.addScheduledEvent("nuevo", undefined, "evt_2");
    assert.equal(s2.scheduled_events.some((e) => e.id === nextId && e.description === "nuevo"), true);
    assert.equal(new Set(s2.scheduled_events.map((e) => e.id)).size, 20, "ids únicos tras resume");
  });

  it("records every consequence on the matching dialogue event", () => {
    const s = makeState();
    const eventId = s.recordDialogueEvent("a", "b", [], -1);
    const cs: Consequence[] = [
      { type: "story_update", delta: "x" },
      { type: "schedule_event", description: "y" },
    ];
    dispatchConsequences(s, eventId, cs);
    assert.equal(s.dialogue_history[0].narrative_consequences.length, 2);
  });

  it("plugin_event is collected, produces no core effect, and is audited", () => {
    const s = makeState();
    const eventId = s.recordDialogueEvent("a", "b", [], -1);
    const cs: Consequence[] = [
      {
        type: "plugin_event",
        plugin_id: "a".repeat(64),
        event_type: "trade_offered",
        payload: { item_id: "iron_sword" },
      },
    ];
    const r = dispatchConsequences(s, eventId, cs);
    assert.deepEqual(r.effects, []);
    assert.deepEqual(r.pluginEvents, [
      { pluginId: "a".repeat(64), type: "trade_offered", payload: { item_id: "iron_sword" } },
    ]);
    assert.equal(s.dialogue_history[0].narrative_consequences[0].type, "plugin_event");
  });
});
