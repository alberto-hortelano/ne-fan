import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { SCHEMA_VERSION } from "../src/narrative/types.js";
import { LLM_ENTITIES_MAX, LLM_STORY_MAX_CHARS } from "../src/narrative/serialize-llm.js";
import { escenaExpandidaDePrueba, makeNarrativeState } from "./helpers.js";

function makeState() {
  return makeNarrativeState().narrative;
}

describe("las puertas del save (#334, #336)", () => {
  it("recordSceneLoaded rechaza una escena que viola el contrato, nombrando entity y campo", () => {
    const s = makeState();
    s.startNewSession("toledo_1200");
    const escena = escenaExpandidaDePrueba("s1", {
      entities: [
        { id: "gigante", kind: "npc", name: "Gigante", cell: [1, 1], footprint: [8, 8], glyph: "n" },
      ],
    });
    assert.throws(
      () => s.recordSceneLoaded("s1", escena),
      (err: Error) => {
        assert.match(err.message, /"s1"/, "nombra la escena");
        assert.match(err.message, /"gigante"/, "nombra la entity");
        assert.match(err.message, /footprint/, "nombra el campo");
        return true;
      },
    );
    assert.equal(s.scenes_loaded["s1"], undefined, "la escena inválida no se registró");
  });

  it("un save cuya escena viola el contrato NO carga: rejects nombrando save, escena, entity y campo", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("toledo_1200");
    s1.recordSceneLoaded("s1", escenaExpandidaDePrueba("s1"));
    await s1.establecer();
    // Corromper el save EN DISCO, como lo dejaría una era anterior del
    // contrato (el caso #300: footprint inflado en un kind móvil).
    const data = (await storage.read(id))!;
    (data.scenes_loaded["s1"].scene_data.entities as unknown[]).push({
      id: "gigante", kind: "npc", name: "Gigante", cell: [1, 1], footprint: [8, 8], glyph: "n",
    });
    await storage.write(id, data);
    const s2 = new NarrativeState(storage);
    await assert.rejects(
      () => s2.loadSession(id),
      (err: Error) => {
        assert.match(err.message, new RegExp(`"${id}"`), "nombra el save");
        assert.match(err.message, /"s1"/, "nombra la escena");
        assert.match(err.message, /"gigante"/, "nombra la entity");
        assert.match(err.message, /footprint/, "nombra el campo");
        return true;
      },
    );
    assert.equal(s2.session_id, "", "el throw llega ANTES de mutar la sesión");
  });

  it("un save de versión anterior rejects por versión — distinguible de «no existe»", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("toledo_1200");
    await s1.establecer();
    const data = (await storage.read(id))!;
    (data as { schema_version: number }).schema_version = 4;
    await storage.write(id, data);
    const s2 = new NarrativeState(storage);
    await assert.rejects(
      () => s2.loadSession(id),
      (err: Error) => {
        assert.match(err.message, /schema_version 4/, "nombra la versión del save");
        assert.match(err.message, new RegExp(`"${id}"`), "nombra el save");
        return true;
      },
    );
  });

  it("false queda SOLO para «no existe»", async () => {
    const s = makeState();
    assert.equal(await s.loadSession("no_existe"), false);
  });
});

describe("NarrativeState lifecycle", () => {
  it("startNewSession populates session_id and defaults", () => {
    const s = makeState();
    const id = s.startNewSession("toledo_1200");
    assert.ok(id.length > 0);
    assert.equal(s.game_id, "toledo_1200");
    assert.equal(s.player.level, 1);
    assert.equal(s.story_so_far, "");
    assert.deepEqual(s.entities, []);
  });

  it("save persists schema version and roundtrips through loadSession", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("toledo_1200");
    s1.appendStory("Once upon a time...");
    s1.recordEntitySpawned("npc_1", "npc", "scene_1", [1, 0, 2], { name: "Aldo" });
    s1.recordDialogueEvent("Aldo", "Hola", ["a", "b"], 1, "");
    await s1.establecer();

    const s2 = new NarrativeState(storage);
    const ok = await s2.loadSession(id);
    assert.equal(ok, true);
    assert.equal(s2.game_id, "toledo_1200");
    assert.equal(s2.story_so_far, "Once upon a time...");
    assert.equal(s2.entities.length, 1);
    assert.equal(s2.entities[0].id, "npc_1");
    assert.equal(s2.dialogue_history.length, 1);
  });

  it("una versión de schema desconocida LANZA (canal distinguible de «no existe»)", async () => {
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
      _next_event_seq: 0,
    });
    const s = new NarrativeState(storage);
    await assert.rejects(() => s.loadSession("badsess"), /schema_version 99/);
  });

  it("save v5 sin campos aditivos de player → defaults (sin NaN en economy)", async () => {
    // La convención ADITIVA declarada en loadSession: un campo nuevo de
    // player sin bump de schema cae a su default en saves que no lo traen.
    // Regresión original: this.player = data.player copiaba el save tal cual;
    // sin gold/inventory quedaba undefined y la aritmética de plugins
    // (inc/dec sobre player.gold) producía NaN, el push a inventory crasheaba.
    const storage = new MemorySessionStorage();
    const seed = new NarrativeState(storage);
    seed.startNewSession("toledo_1200");
    const data = seed.toSessionData();
    data.session_id = "oldsess";
    // Quitar los campos "aditivos" del player (simula el save de antes de
    // que existieran), conservando lo esencial.
    data.player = {
      level: 3,
      class: "rogue",
      health: 80,
      position: [1, 0, 2],
      current_scene_id: "s1",
    } as never;
    await storage.write("oldsess", data);
    const s = new NarrativeState(storage);
    assert.equal(await s.loadSession("oldsess"), true);
    // Lo presente en el save se conserva; lo ausente cae al default.
    assert.equal(s.player.level, 3);
    assert.equal(s.player.health, 80);
    assert.deepEqual(s.player.position, [1, 0, 2]);
    assert.equal(s.player.gold, 0, "gold default 0 — la aritmética no da NaN");
    assert.equal(s.player.gold + 25, 25);
    assert.deepEqual(s.player.inventory, [], "inventory default []");
    assert.equal(s.player.appearance.model_id, "", "appearance default: \"\" = ninguna elección (el cliente cae a su base)");
    // El array default no se comparte entre instancias del default.
    s.player.inventory.push({ id: "moneda" });
    const s2 = new NarrativeState(new MemorySessionStorage());
    s2.startNewSession("g");
    assert.deepEqual(s2.player.inventory, []);
  });

  it("listSessions returns metadata sorted by updated_at desc", async () => {
    const storage = new MemorySessionStorage();
    const s = new NarrativeState(storage);
    s.startNewSession("a");
    await s.establecer();
    await new Promise((r) => setTimeout(r, 5));
    s.startNewSession("b");
    await s.establecer();
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

/** #279 — la puerta del disco. Una partida existe en `saves/` cuando el
 *  jugador ha llegado a jugarla, y no antes: un arranque que falla después del
 *  `ok:true` (el clon sin hojas de sprite, el motor que no responde) no puede
 *  dejar en el título la tarjeta de una partida que nadie jugó. */
describe("NarrativeState: la partida existe cuando el jugador entra", () => {
  it("una sesión recién arrancada NO se escribe, por muchos save() que reciba", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    s.startNewSession("g");
    s.appendStory("el motor ya está construyendo el mundo");

    assert.deepEqual(await s.save(), { escrito: false });
    assert.deepEqual(await s.save(), { escrito: false });
    assert.deepEqual(await storage.list(), [], "cero directorios nuevos en saves/");
    assert.equal(s.enDisco, false);
  });

  it("establecer() la escribe con TODO lo acumulado durante el arranque", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    const id = s.startNewSession("g");
    // El world map del bootstrap y la escena del snapshot llegan ANTES del
    // ack: la primera escritura tiene que llevárselos dentro.
    s.appendStory("el mundo del bootstrap");
    s.recordEntitySpawned("npc_1", "npc", "tile_0_0", [1, 0, 2], { name: "Aldo" });

    await s.establecer();

    assert.equal(s.enDisco, true);
    const enDisco = (await storage.read(id))!;
    assert.equal(enDisco.story_so_far, "el mundo del bootstrap");
    assert.equal(enDisco.entities.length, 1, "lo acumulado antes del ack no se pierde");
    // Y a partir de aquí guarda como siempre.
    s.appendStory("y el jugador siguió");
    assert.deepEqual(await s.save(), { escrito: true });
    assert.match((await storage.read(id))!.story_so_far, /y el jugador siguió/);
  });

  it("reanudar no necesita ack: lo cargado del disco ya existe", async () => {
    const { narrative: s1, storage } = makeNarrativeState();
    const id = s1.startNewSession("g");
    await s1.establecer();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(id), true);
    assert.equal(s2.enDisco, true);
    s2.appendStory("reanudada y jugando");
    assert.deepEqual(await s2.save(), { escrito: true });
    assert.match((await storage.read(id))!.story_so_far, /reanudada y jugando/);
  });

  it("guardar SIN sesión lanza: es un caller roto, no un estado", async () => {
    const { narrative: s } = makeNarrativeState();
    await assert.rejects(() => s.save(), /no hay sesión que guardar/);
  });

  it("establecer SIN sesión lanza (no se puede establecer la nada)", async () => {
    const { narrative: s } = makeNarrativeState();
    await assert.rejects(() => s.establecer(), /no hay sesión que establecer/);
  });

  it("borrar la partida activa la devuelve a «no hay ninguna»", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    const id = s.startNewSession("g");
    await s.establecer();
    assert.equal(await s.deleteSession(id), "deleted");
    assert.equal(s.session_id, "");
    assert.equal(s.enDisco, false);
    assert.deepEqual(await storage.list(), []);
  });

  /** La sesión EFÍMERA de la pre-generación de mundos: su artefacto es el
   *  snapshot, nunca un save. Antes se borraba del disco en un `finally`; hoy
   *  no hay nada que borrar y lo que se suelta es la identidad — que es lo que
   *  leen «¿hay partida?» y el 409 del State API. */
  it("descartar una sesión provisional suelta la identidad sin tocar el disco", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    s.startNewSession("g");
    s.descartarProvisional();
    assert.equal(s.session_id, "");
    assert.deepEqual(await storage.list(), []);
  });

  it("…y NO se puede descartar una partida que sí existe (esa se borra)", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    const id = s.startNewSession("g");
    await s.establecer();
    assert.throws(() => s.descartarProvisional(), /existe en disco/);
    assert.equal(s.session_id, id);
    assert.equal((await storage.list()).length, 1, "el save sigue ahí");
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
    await s1.establecer();

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
    s.recordSceneLoaded("scene_r_v1", escenaExpandidaDePrueba("scene_r_v1", { place_id: "robledo" }));
    const r = s.worldMap.get("robledo")!;
    assert.equal(r.realized_scene_id, "scene_r_v1");
    assert.equal(r.visited, true);
    assert.equal(s.worldMap.serialize().active_place_id, "robledo");
  });

  // Aquí vivían «migrates a v1 session (no world_map) into v2» y «migrates a
  // v2 session (no plugins) into v3»: murieron con migrations.ts entero
  // (#336) — un save viejo ya no migra, LANZA (las puertas del save, arriba).

  it("round-trips plugin records through save/load", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    s1.startNewSession("toledo_1200");
    s1.plugins.push({
      id: "a".repeat(64),
      name: "test_counter",
      version: 1,
      slice: { count: 3 },
      origin: { author: "developer", rationale: "test" },
      activated_at: "2026-01-01T00:00:00Z",
    });
    await s1.establecer();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(s1.session_id), true);
    assert.equal(s2.plugins.length, 1);
    assert.equal(s2.plugins[0].id, "a".repeat(64));
    assert.deepEqual(s2.plugins[0].slice, { count: 3 });
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

  it("removeInventoryItem removes by item id from entity and player", () => {
    const s = makeState();
    s.startNewSession("g");
    s.recordEntitySpawned("boris", "npc", "scene_1", [0, 0, 0], {
      inventory: [{ id: "hammer" }, { id: "iron_key" }],
    });
    s.addInventoryItem("player", { id: "coin", name: "Moneda" });

    assert.equal(s.removeInventoryItem("boris", "hammer"), true);
    assert.deepEqual(s.getInventory("boris"), [{ id: "iron_key" }]);
    assert.equal(s.removeInventoryItem("player", "coin"), true);
    assert.deepEqual(s.getInventory("player"), []);

    // No-match y entidad inexistente devuelven false sin tocar nada.
    assert.equal(s.removeInventoryItem("boris", "hammer"), false);
    assert.equal(s.removeInventoryItem("ghost", "hammer"), false);
    assert.deepEqual(s.getInventory("boris"), [{ id: "iron_key" }]);
    // Items sin campo `id` nunca casan (inventario sin tipar).
    s.addInventoryItem("player", "una nota suelta");
    assert.equal(s.removeInventoryItem("player", "una nota suelta"), false);
    assert.deepEqual(s.getInventory("player"), ["una nota suelta"]);
  });

  it("addInventoryItem persists through save/load", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    const id = s1.startNewSession("g");
    s1.recordEntitySpawned("boris", "npc", "scene_1", [0, 0, 0], {});
    s1.addInventoryItem("boris", { id: "iron_key", name: "Llave de hierro" });
    await s1.establecer();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(id), true);
    assert.deepEqual(s2.getInventory("boris"), [
      { id: "iron_key", name: "Llave de hierro" },
    ]);
  });
});

describe("NarrativeState.serializeForLlm", () => {
  it("produces compact context with last 10 dialogues", () => {
    const s = makeState();
    s.startNewSession("g");
    for (let i = 0; i < 12; i++) {
      s.recordDialogueEvent(`speaker${i}`, `text${i}`, [`a${i}`, `b${i}`], 0);
    }
    const ctx = s.serializeForLlm();
    assert.equal(ctx.recent_dialogues.length, 10);
    assert.equal(ctx.recent_dialogues[0].speaker, "speaker2");
    assert.equal(ctx.recent_dialogues[0].chosen, "a2");
  });

  it("exposes the chosen text of bridge dialogue_choice events (choices vacías) y la réplica del NPC", () => {
    const s = makeState();
    s.startNewSession("g");
    // El bridge registra las elecciones con el texto elegido en `text` y
    // choices: [] (handleDialogueChoice) — el motor debe ver qué se eligió.
    const evtId = s.recordDialogueEvent("Yishaq", "Pregunto por los libros", [], 2);
    s.recordNarrativeConsequence(evtId, {
      type: "dialogue",
      speaker: "Yishaq",
      text: "Curiosa cosa: sois el segundo que pregunta.",
    });
    const ctx = s.serializeForLlm();
    const last = ctx.recent_dialogues.at(-1)!;
    assert.equal(last.chosen, "Pregunto por los libros");
    assert.equal(last.npc_reply, "Curiosa cosa: sois el segundo que pregunta.");
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
    assert.equal(ctx.entities_total, undefined, "sin recorte no hay entities_total");
  });

  it("cota de entities: escena activa completa + spawns recientes, entities_total avisa", () => {
    // Regresión (contexto sin cotas): TODAS las entidades del playthrough
    // viajaban en cada turno. Ahora: cap LLM_ENTITIES_MAX priorizando la
    // escena activa entera y el resto por spawn reciente, en orden
    // cronológico, con entities_total marcando el recorte.
    const s = makeState();
    s.startNewSession("g");
    // 5 entidades viejas de otra escena (deben caer las más antiguas).
    for (let i = 0; i < 5; i++) {
      s.recordEntitySpawned(`viejo_${i}`, "npc", "tile_lejano", [i, 0, 0], {});
    }
    // Escena activa con 10 entidades — TODAS deben sobrevivir al recorte.
    // (recordSceneLoaded ANTES de spawnear: registrar el record purga y
    // re-registra los NPCs de esa escena desde scene_data.)
    s.recordSceneLoaded("tile_activo", escenaExpandidaDePrueba("tile_activo"));
    for (let i = 0; i < 10; i++) {
      s.recordEntitySpawned(`activo_${i}`, "npc", "tile_activo", [i, 0, 0], {});
    }
    // Relleno de otras escenas hasta desbordar el cap con holgura.
    for (let i = 0; i < LLM_ENTITIES_MAX; i++) {
      s.recordEntitySpawned(`otro_${i}`, "npc", `tile_${i % 7}x`, [i, 0, 0], {});
    }
    const total = 5 + 10 + LLM_ENTITIES_MAX;
    const ctx = s.serializeForLlm();
    assert.equal(ctx.entities.length, LLM_ENTITIES_MAX, "lista al cap");
    assert.equal(ctx.entities_total, total, "total real expuesto");
    for (let i = 0; i < 10; i++) {
      assert.ok(
        ctx.entities.some((e) => e.id === `activo_${i}`),
        `la escena activa sobrevive entera (activo_${i})`,
      );
    }
    assert.ok(
      ctx.entities.some((e) => e.id === `otro_${LLM_ENTITIES_MAX - 1}`),
      "el spawn más reciente sobrevive",
    );
    assert.ok(
      !ctx.entities.some((e) => e.id === "viejo_0"),
      "lo más viejo de otras escenas cae",
    );
    // Orden cronológico original preservado en la selección.
    const ids = ctx.entities.map((e) => e.id);
    assert.ok(
      ids.indexOf("activo_0") < ids.indexOf(`otro_${LLM_ENTITIES_MAX - 1}`),
      "selección emitida en orden de spawn",
    );
  });

  it("cota de story_so_far: por encima del cap solo viaja la cola con marcador", () => {
    const s = makeState();
    s.startNewSession("g");
    // Crónica larga: párrafos numerados hasta superar el cap con holgura.
    for (let i = 0; i < 200; i++) {
      s.appendStory(`Párrafo ${i}: ${"x".repeat(60)}`);
    }
    assert.ok(s.story_so_far.length > LLM_STORY_MAX_CHARS, "precondición: crónica > cap");
    const ctx = s.serializeForLlm();
    assert.ok(ctx.story_so_far.length <= LLM_STORY_MAX_CHARS + 200, "contexto acotado");
    assert.match(ctx.story_so_far, /earlier chronicle omitted .* story_get/, "marcador con la tool");
    assert.ok(ctx.story_so_far.includes("Párrafo 199"), "la cola reciente viaja");
    assert.ok(!ctx.story_so_far.includes("Párrafo 0:"), "el arranque queda fuera");
    // El save NO se toca: la crónica completa sigue en el estado.
    assert.ok(s.story_so_far.startsWith("Párrafo 0:"), "el save conserva todo");

    // Crónica corta: pasa entera, sin marcador.
    const s2 = makeState();
    s2.startNewSession("g");
    s2.appendStory("El herrero juró venganza.");
    assert.equal(s2.serializeForLlm().story_so_far, "El herrero juró venganza.");
  });
});

/** La frescura del jugador viaja con el OBJETO, no con la llamada: quien
 *  guarda no tiene que acordarse de refrescar nada. Es lo que hace que el save
 *  número catorce —el que alguien escriba mañana— nazca fresco. */
describe("NarrativeState: runtime del jugador atado al save", () => {
  it("save() tira de la fuente atada: el save no se escribe con el arranque", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    const id = s.startNewSession("g");
    let vivo = { position: { x: 3, y: 1, z: -4 }, health: 61 };
    s.bindPlayerRuntime(() => vivo);

    await s.establecer();
    assert.deepEqual((await storage.read(id))!.player.position, [3, 1, -4]);
    assert.equal((await storage.read(id))!.player.health, 61);

    // Y el SIGUIENTE save, sin que nadie vuelva a atar nada.
    vivo = { position: { x: -9, y: 1, z: 12 }, health: 8 };
    await s.save();
    assert.deepEqual((await storage.read(id))!.player.position, [-9, 1, 12]);
    assert.equal((await storage.read(id))!.player.health, 8);
  });

  it("sin jugador vivo se conserva lo persistido (no es un error)", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    const id = s.startNewSession("g");
    s.bindPlayerRuntime(() => ({ position: { x: 5, y: 1, z: 5 }, health: 50 }));
    await s.establecer();
    // Título, o bootstrap antes de sembrar el sim: la fuente da null.
    s.bindPlayerRuntime(() => null);
    await s.save();
    assert.deepEqual((await storage.read(id))!.player.position, [5, 1, 5], "no se pisa con nada");
    assert.equal((await storage.read(id))!.player.health, 50);
  });

  it("la atadura es de UNA sesión: start y load la sueltan", async () => {
    const { narrative: s, storage } = makeNarrativeState();
    const primera = s.startNewSession("g");
    s.bindPlayerRuntime(() => ({ position: { x: 20, y: 1, z: 20 }, health: 7 }));
    await s.establecer();

    // Partida nueva en el mismo proceso: el runtime atado era de la otra.
    const segunda = s.startNewSession("g");
    await s.establecer();
    assert.deepEqual(
      (await storage.read(segunda))!.player.position,
      [0, 1, 0],
      "el arranque, no el final de la partida anterior",
    );
    assert.equal((await storage.read(segunda))!.player.health, 100);

    // Y reanudar la primera tampoco arrastra el runtime de la segunda.
    s.bindPlayerRuntime(() => ({ position: { x: 33, y: 1, z: 33 }, health: 3 }));
    assert.equal(await s.loadSession(primera), true);
    await s.save();
    assert.deepEqual((await storage.read(primera))!.player.position, [20, 1, 20]);
    assert.equal((await storage.read(primera))!.player.health, 7);
  });
});

describe("NarrativeState: el runtime de los ENEMIGOS también viaja en el save", () => {
  /** Sesión con un hostil ya registrado en el ledger (como lo deja
   *  `registerSceneNpcs` para el bandido de la escena inicial). */
  async function conUnHostil() {
    const { narrative: s, storage } = makeNarrativeState();
    const id = s.startNewSession("g");
    s.recordEntitySpawned("bandido_1", "npc", "tile_0_0", [3, 0, 4], { name: "Bandido", role: "hostile" }, "scene_init");
    await s.establecer();
    return { s, storage, id };
  }

  const combatDe = async (
    storage: Awaited<ReturnType<typeof conUnHostil>>["storage"],
    id: string,
  ) => {
    const save = await storage.read(id);
    return save!.entities.find((e) => e.id === "bandido_1")!.data.combat as
      | Record<string, unknown>
      | undefined;
  };

  it("save() vuelca la vida VIVA del combatiente sobre su EntityRecord", async () => {
    const { s, storage, id } = await conUnHostil();
    // Sin atadura, el ledger no sabe nada de combate: es el estado de HOY sin
    // esta tanda, y por eso reanudar devolvía a todos con la vida del contrato.
    assert.equal(await combatDe(storage, id), undefined);

    s.bindCombatantRuntime(() => [
      { id: "bandido_1", position: { x: 9, y: 0, z: -1 }, health: 23, maxHealth: 60 },
    ]);
    await s.save();
    assert.deepEqual(await combatDe(storage, id), { health: 23, max_health: 60 });
    const save = await storage.read(id);
    assert.deepEqual(
      save!.entities.find((e) => e.id === "bandido_1")!.position,
      [9, 0, -1],
      "y su posición: al enemigo lo mueve la IA de combate, no la vida ambiental",
    );
  });

  it("LA MUERTE ES ABSORBENTE: un record a 0 no vuelve a subir aunque el sim lo cure", async () => {
    const { s, storage, id } = await conUnHostil();
    let vivo = { id: "bandido_1", position: { x: 0, y: 0, z: 0 }, health: 0, maxHealth: 60 };
    s.bindCombatantRuntime(() => [vivo]);
    await s.save();
    assert.deepEqual(await combatDe(storage, id), { health: 0, max_health: 60 });

    // Esto es exactamente lo que hace `sim.respawn()` al pulsar R: cura a
    // TODOS los enemigos a su máximo. Sin el candado, morir y reaparecer
    // deshacía una muerte YA guardada.
    vivo = { id: "bandido_1", position: { x: 0, y: 0, z: 0 }, health: 60, maxHealth: 60 };
    await s.save();
    assert.deepEqual(
      await combatDe(storage, id),
      { health: 0, max_health: 60 },
      "el muerto lo está para siempre en el save (decisión del usuario, 2026-08-31)",
    );
  });

  it("la atadura es de UNA sesión, como la del jugador: start y load la sueltan", async () => {
    const { s, storage } = await conUnHostil();
    s.bindCombatantRuntime(() => [
      { id: "bandido_1", position: { x: 0, y: 0, z: 0 }, health: 5, maxHealth: 60 },
    ]);
    const segunda = s.startNewSession("g");
    s.recordEntitySpawned("bandido_1", "npc", "tile_0_0", [3, 0, 4], { name: "Bandido" }, "scene_init");
    await s.establecer();
    assert.equal(
      await combatDe(storage, segunda),
      undefined,
      "la partida nueva no hereda la vida del enemigo de la vieja",
    );
  });
});
