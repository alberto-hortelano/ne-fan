import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { SCHEMA_VERSION } from "../src/narrative/types.js";

function makeState() {
  return new NarrativeState(new MemorySessionStorage());
}

describe("NarrativeState lifecycle", () => {
  it("startNewSession populates session_id and defaults", () => {
    const s = makeState();
    const id = s.startNewSession("tavern_intro");
    assert.ok(id.length > 0);
    assert.equal(s.game_id, "tavern_intro");
    assert.equal(s.player.level, 1);
    assert.equal(s.story_so_far, "");
    assert.deepEqual(s.entities, []);
    assert.ok(s.isDirty());
  });

  it("save persists schema version and roundtrips through loadSession", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("tavern_intro");
    s1.appendStory("Once upon a time...");
    s1.recordEntitySpawned("npc_1", "npc", "scene_1", [1, 0, 2], { name: "Aldo" });
    s1.recordDialogueEvent("Aldo", "Hola", ["a", "b"], 1, "");
    await s1.save();

    const s2 = new NarrativeState(storage);
    const ok = await s2.loadSession(id);
    assert.equal(ok, true);
    assert.equal(s2.game_id, "tavern_intro");
    assert.equal(s2.story_so_far, "Once upon a time...");
    assert.equal(s2.entities.length, 1);
    assert.equal(s2.entities[0].id, "npc_1");
    assert.equal(s2.dialogue_history.length, 1);
    assert.equal(s2.isDirty(), false);
  });

  it("rejects unsupported schema version", async () => {
    const storage = new MemorySessionStorage();
    await storage.write("badsess", {
      schema_version: 99,
      session_id: "badsess",
      game_id: "x",
      created_at: "",
      updated_at: "",
      world: { name: "", atmosphere: "", style_token: "", active_scene_id: "" },
      player: {
        level: 1,
        class: "rogue",
        health: 100,
        gold: 0,
        inventory: [],
        appearance: { model_id: "x", skin_path: "" },
        position: [0, 0, 0],
        current_scene_id: "",
      },
      story_so_far: "",
      scenes_loaded: {},
      entities: [],
      dialogue_history: [],
      asset_index_snapshot: [],
      _next_event_seq: 0,
    });
    const s = new NarrativeState(storage);
    const ok = await s.loadSession("badsess");
    assert.equal(ok, false);
  });

  it("listSessions returns metadata sorted by updated_at desc", async () => {
    const storage = new MemorySessionStorage();
    const s = new NarrativeState(storage);
    s.startNewSession("a");
    await s.save();
    await new Promise((r) => setTimeout(r, 5));
    s.startNewSession("b");
    await s.save();
    const list = await s.listSessions();
    assert.equal(list.length, 2);
    assert.ok(list[0].updated_at >= list[1].updated_at);
  });

  it("toSessionData carries the current SCHEMA_VERSION", () => {
    const s = makeState();
    s.startNewSession("x");
    assert.equal(s.toSessionData().schema_version, SCHEMA_VERSION);
  });
});

describe("NarrativeState mutations", () => {
  it("appendStory concatenates with double newline", () => {
    const s = makeState();
    s.startNewSession("g");
    s.appendStory("first");
    s.appendStory("second");
    assert.equal(s.story_so_far, "first\n\nsecond");
  });

  it("recordEntityDespawned removes by id", () => {
    const s = makeState();
    s.startNewSession("g");
    s.recordEntitySpawned("a", "npc", "s", [0, 0, 0], {});
    s.recordEntitySpawned("b", "npc", "s", [0, 0, 0], {});
    s.recordEntityDespawned("a");
    assert.equal(s.entities.length, 1);
    assert.equal(s.entities[0].id, "b");
  });

  it("recordDialogueEvent generates monotonic event IDs", () => {
    const s = makeState();
    s.startNewSession("g");
    const a = s.recordDialogueEvent("x", "hi", [], -1);
    const b = s.recordDialogueEvent("x", "again", [], -1);
    assert.equal(a, "evt_0001");
    assert.equal(b, "evt_0002");
  });

  it("recordNarrativeConsequence attaches to the right event", () => {
    const s = makeState();
    s.startNewSession("g");
    const id = s.recordDialogueEvent("x", "hi", [], -1);
    s.recordNarrativeConsequence(id, { type: "story_update", delta: "things happen" });
    assert.equal(s.dialogue_history[0].narrative_consequences.length, 1);
  });
});

describe("NarrativeState.worldMap", () => {
  it("startNewSession initializes a world_map with a root world place", () => {
    const s = makeState();
    s.startNewSession("g");
    const map = s.worldMap.serialize();
    assert.equal(map.root_id, "world");
    assert.equal(map.active_place_id, "world");
    assert.equal(map.places.world.kind, "world");
  });

  it("save/load roundtrips the world_map", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("g");
    s1.worldMap.upsertPlace({
      id: "robledo",
      kind: "settlement",
      parent_id: "world",
      name: "Robledo",
      approx_position: [12, 34],
    });
    await s1.save();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(id), true);
    const r = s2.worldMap.get("robledo");
    assert.equal(r?.name, "Robledo");
    assert.deepEqual(r?.approx_position, [12, 34]);
  });

  it("recordSceneLoaded attaches the scene to a matching place by place_id", () => {
    const s = makeState();
    s.startNewSession("g");
    s.worldMap.upsertPlace({
      id: "robledo",
      kind: "settlement",
      parent_id: "world",
      name: "Robledo",
    });
    s.recordSceneLoaded("scene_r_v1", { place_id: "robledo", terrain: [] });
    const r = s.worldMap.get("robledo")!;
    assert.equal(r.realized_scene_id, "scene_r_v1");
    assert.equal(r.visited, true);
    assert.equal(s.worldMap.serialize().active_place_id, "robledo");
  });

  it("migrates a v1 session (no world_map) into v2 on load", async () => {
    const storage = new MemorySessionStorage();
    const legacy = {
      schema_version: 1,
      session_id: "old_sess",
      game_id: "tavern_intro",
      created_at: "",
      updated_at: "",
      world: { name: "Vall", atmosphere: "", style_token: "", active_scene_id: "tavern" },
      player: {
        level: 1,
        class: "rogue",
        health: 100,
        gold: 0,
        inventory: [],
        appearance: { model_id: "pete", skin_path: "" },
        position: [0, 0, 0],
        current_scene_id: "tavern",
      },
      story_so_far: "",
      scenes_loaded: { tavern: { scene_data: {}, loaded_at: "", asset_refs: [] } },
      entities: [],
      dialogue_history: [],
      asset_index_snapshot: [],
      _next_event_seq: 0,
    };
    // Bypass type system: write legacy shape to test migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await storage.write("old_sess", legacy as any);

    const s = new NarrativeState(storage);
    assert.equal(await s.loadSession("old_sess"), true);
    const map = s.worldMap.serialize();
    assert.equal(map.places.world.name, "Vall");
    assert.equal(map.places.tavern?.kind, "interior");
    assert.equal(map.places.tavern?.realized_scene_id, "tavern");
    assert.equal(map.active_place_id, "tavern");
  });
});

describe("NarrativeState state queries", () => {
  it("getEntity finds a spawned entity by id", () => {
    const s = makeState();
    s.startNewSession("g");
    s.recordEntitySpawned("boris", "npc", "scene_1", [1, 0, 2], { name: "Boris", health: 80 });
    const e = s.getEntity("boris");
    assert.equal(e?.id, "boris");
    assert.equal(e?.data.health, 80);
    assert.equal(s.getEntity("ghost"), undefined);
  });

  it("getInventory reads entity.data.inventory and player.inventory", () => {
    const s = makeState();
    s.startNewSession("g");
    s.recordEntitySpawned("boris", "npc", "scene_1", [0, 0, 0], {
      inventory: [{ id: "hammer" }],
    });
    assert.deepEqual(s.getInventory("boris"), [{ id: "hammer" }]);
    assert.deepEqual(s.getInventory("player"), []);
    assert.deepEqual(s.getInventory("ghost"), []);
  });

  it("addInventoryItem appends to an entity and to the player", () => {
    const s = makeState();
    s.startNewSession("g");
    s.recordEntitySpawned("boris", "npc", "scene_1", [0, 0, 0], {});
    assert.equal(s.addInventoryItem("boris", { id: "iron_key" }), true);
    assert.deepEqual(s.getInventory("boris"), [{ id: "iron_key" }]);
    assert.equal(s.addInventoryItem("player", { id: "coin" }), true);
    assert.deepEqual(s.getInventory("player"), [{ id: "coin" }]);
    assert.equal(s.addInventoryItem("ghost", { id: "x" }), false);
  });

  it("addInventoryItem persists through save/load", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("g");
    s1.recordEntitySpawned("boris", "npc", "scene_1", [0, 0, 0], {});
    s1.addInventoryItem("boris", { id: "iron_key", name: "Llave de hierro" });
    await s1.save();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(id), true);
    assert.deepEqual(s2.getInventory("boris"), [
      { id: "iron_key", name: "Llave de hierro" },
    ]);
  });
});

describe("NarrativeState.serializeForLlm", () => {
  it("produces compact context with last 5 dialogues", () => {
    const s = makeState();
    s.startNewSession("g");
    for (let i = 0; i < 7; i++) {
      s.recordDialogueEvent(`speaker${i}`, `text${i}`, [`a${i}`, `b${i}`], 0);
    }
    const ctx = s.serializeForLlm();
    assert.equal(ctx.recent_dialogues.length, 5);
    assert.equal(ctx.recent_dialogues[0].speaker, "speaker2");
    assert.equal(ctx.recent_dialogues[0].chosen, "a2");
  });

  it("compacts entities to id/type/scene/position/spawn_reason", () => {
    const s = makeState();
    s.startNewSession("g");
    s.recordEntitySpawned("e1", "npc", "s1", [1, 2, 3], { extra: "data" }, "scene_init", "evt_1");
    const ctx = s.serializeForLlm();
    assert.equal(ctx.entities.length, 1);
    assert.equal(ctx.entities[0].id, "e1");
    assert.deepEqual(ctx.entities[0].position, [1, 2, 3]);
    assert.equal(ctx.entities[0].spawn_reason, "scene_init");
  });
});
