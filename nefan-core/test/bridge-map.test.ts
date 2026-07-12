/** Mapa del mundo: player_entered_place + triggers, cruce de frontera y activación por posición.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
  } from "../src/protocol/messages.js";
import {
  makeCtx,
  makeSocket,
  waitFor,
  } from "./helpers.js";

describe("bridge player_entered_place + map triggers", () => {
  it("lugar desconocido → narrative_status: error", async () => {
    const { ctx, broadcasts } = makeCtx();
    ctx.narrative.startNewSession("plugtest");
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "nowhere" }, socket, ctx);
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("nowhere"));
  });

  it("lugar realizado → re-broadcast de la escena cacheada + trigger player_entered", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({
      id: "tavern",
      kind: "site",
      parent_id: "world",
      name: "La Posada",
    });
    narrative.recordSceneLoaded("scene_tavern", {
      room_id: "scene_tavern",
      place_id: "tavern",
      room_description: "la posada",
    });
    narrative.worldMap.addTrigger("tavern", {
      id: "greet",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Huele a estofado." }],
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "tavern" }, socket, ctx);

    // Escena cacheada re-difundida…
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage =>
        m.type === "narrative_event" && m.eventId === "scene_init",
    );
    assert.ok(sceneEvent, "scene_init re-broadcast");
    // …y el trigger disparado con su consequence aplicada.
    const triggerEvent = broadcasts.find(
      (m): m is NarrativeEventMessage =>
        m.type === "narrative_event" && m.eventId === "map_trigger",
    );
    assert.ok(triggerEvent, "map_trigger difundido");
    assert.ok(narrative.story_so_far.includes("Huele a estofado."));
  });

  it("las exits de la escena difundida llevan edge (directo e inverso)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea" });
    narrative.worldMap.upsertPlace({ id: "bosque", kind: "landmark", parent_id: "world", name: "Bosque" });
    // Desde la aldea se sale al bosque por el sur ⇒ desde el bosque, por el norte.
    narrative.worldMap.addLink({ from: "aldea", to: "bosque", kind: "path", edge: "south" });
    narrative.recordSceneLoaded("scene_aldea", { room_id: "scene_aldea", place_id: "aldea", room_description: "x" });
    narrative.recordSceneLoaded("scene_bosque", { room_id: "scene_bosque", place_id: "bosque", room_description: "x" });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "aldea" }, socket, ctx);
    const fromAldea = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const aldeaScene = fromAldea?.effects?.[0]?.data?.scene as { exits?: { place_id: string; edge?: string }[] };
    assert.equal(aldeaScene?.exits?.[0]?.place_id, "bosque");
    assert.equal(aldeaScene?.exits?.[0]?.edge, "south");

    broadcasts.length = 0;
    await routeMessage({ type: "player_entered_place", placeId: "bosque" }, socket, ctx);
    const fromBosque = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const bosqueScene = fromBosque?.effects?.[0]?.data?.scene as { exits?: { place_id: string; edge?: string }[] };
    assert.equal(bosqueScene?.exits?.[0]?.place_id, "aldea");
    assert.equal(bosqueScene?.exits?.[0]?.edge, "north");
  });

  it("lugar sin escena → lazy realize vía generateScene y trigger tras la escena", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => ({
          ok: true,
          scene: { room_id: "scene_forge", room_description: "la forja" },
        }),
      },
    });
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({
      id: "forge",
      kind: "site",
      parent_id: "world",
      name: "La Forja",
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forge" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    // La escena generada queda ligada al place y registrada.
    assert.equal(narrative.worldMap.get("forge")?.realized_scene_id, "scene_forge");
    assert.ok(narrative.scenes_loaded["scene_forge"]);
    const phases = broadcasts
      .filter((m): m is NarrativeStatusMessage => m.type === "narrative_status")
      .map((m) => m.phase);
    assert.deepEqual(phases, ["generating", "ready"]);
  });
});

describe("bridge player_crossed_frontier", () => {
  /** Sesión con un place activo "aldea" realizado, listo para cruzar fronteras. */
  function seedAldea(narrative: NarrativeState): void {
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea" });
    narrative.recordSceneLoaded("scene_aldea", { room_id: "scene_aldea", place_id: "aldea", room_description: "x" });
  }

  it("camino feliz: el motor crea place+link, el bridge estampa el edge y difunde la escena", async () => {
    let nref: NarrativeState | null = null;
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async (llmCtx) => {
          assert.equal((llmCtx.frontier_request as { edge: string }).edge, "east");
          // El fake imita al motor: crea el place y el link SIN edge (probamos
          // que el bridge lo estampa con la geometría real del cruce).
          nref!.worldMap.upsertPlace({ id: "bosque_este", kind: "landmark", parent_id: "world", name: "Bosque" });
          nref!.worldMap.addLink({ from: "aldea", to: "bosque_este", kind: "path" });
          return { ok: true, scene: { room_id: "scene_bosque", place_id: "bosque_este", room_description: "el bosque" } };
        },
      },
    });
    nref = narrative;
    seedAldea(narrative);

    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );

    assert.equal(narrative.worldMap.get("bosque_este")?.realized_scene_id, "scene_bosque");
    assert.equal(narrative.worldMap.serialize().active_place_id, "bosque_este");
    // Edge estampado por el bridge sobre el link que dejó el motor.
    const link = narrative.worldMap.getOutgoingLinks("aldea")[0];
    assert.equal(link.edge, "east");
    // La escena difundida lleva el exit de vuelta con el edge opuesto.
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const scene = sceneEvent?.effects?.[0]?.data?.scene as { exits?: { place_id: string; edge?: string }[] };
    assert.equal(scene?.exits?.[0]?.place_id, "aldea");
    assert.equal(scene?.exits?.[0]?.edge, "west");
    assert.equal(ctx.sceneGen.current, null, "cola drenada");
  });

  it("el motor no crea el place → error accionable con map_upsert_place", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => ({
          ok: true,
          scene: { room_id: "scene_x", place_id: "no_existe", room_description: "x" },
        }),
      },
    });
    seedAldea(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "north" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("map_upsert_place"), err?.message);
    assert.equal(ctx.sceneGen.current, null);
  });

  it("el motor no linkea el place nuevo → error accionable con map_link", async () => {
    let nref: NarrativeState | null = null;
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => {
          nref!.worldMap.upsertPlace({ id: "paramo", kind: "landmark", parent_id: "world", name: "Páramo" });
          return { ok: true, scene: { room_id: "scene_p", place_id: "paramo", room_description: "x" } };
        },
      },
    });
    nref = narrative;
    seedAldea(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "south" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("map_link"), err?.message);
  });

  it("cola: la misma frontera repetida durante la generación se dedupea", async () => {
    let release: (() => void) | null = null;
    let nref: NarrativeState | null = null;
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          nref!.worldMap.upsertPlace({ id: "colina", kind: "landmark", parent_id: "world", name: "Colina" });
          nref!.worldMap.addLink({ from: "aldea", to: "colina", kind: "path" });
          return { ok: true, scene: { room_id: "scene_c", place_id: "colina", room_description: "x" } };
        },
      },
    });
    nref = narrative;
    seedAldea(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    await waitFor(() => release !== null);
    // Misma frontera repetida mientras genera → dedupe + re-broadcast generating.
    const before = broadcasts.length;
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 1, "una sola llamada al motor");
    assert.equal(
      (broadcasts[before] as NarrativeStatusMessage)?.phase,
      "generating",
      "re-broadcast de generating para mantener el loader",
    );
    release!();
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    assert.equal(ctx.sceneGen.current, null);
  });

  it("lazy realize en vuelo → la frontera se dropea (y viceversa el guard cubre entered_place)", async () => {
    let release: (() => void) | null = null;
    const { ctx, narrative, aiCalls, broadcasts } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          return { ok: true, scene: { room_id: "scene_f", room_description: "x" } };
        },
      },
    });
    seedAldea(narrative);
    narrative.worldMap.upsertPlace({ id: "forja", kind: "site", parent_id: "world", name: "Forja" });
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => release !== null);
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 1, "la frontera no dispara una segunda generación");
    release!();
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
  });
});

describe("bridge activación por posición (tiles + anchors)", () => {
  it("pisar un tile lo activa y pisar el anchor de un place dispara sus triggers", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    const t00 = expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", biome: "grass", entities: [] });
    const t10 = expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", biome: "grass", entities: [] });
    narrative.recordSceneLoaded("tile_0_0", t00);
    narrative.recordSceneLoaded("tile_1_0", t10, [], { activate: false });
    narrative.worldMap.upsertPlace({
      id: "claro",
      kind: "landmark",
      parent_id: "world",
      name: "El Claro",
      anchor: { tx: 1, ty: 0, rect: [40, 50, 20, 20] },
    });
    narrative.worldMap.addTrigger("claro", {
      id: "bienvenida",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Llegas al claro." }],
    });

    const { socket } = makeSocket();
    const input = (x: number, z: number) => routeMessage(
      { type: "input", delta: 0.016, inputs: { playerPosition: { x, y: 0, z }, playerForward: { x: 0, y: 0, z: -1 }, playerMoving: true } },
      socket, ctx,
    );

    // Dentro del tile (0,0): nada cambia de más.
    await input(0, 0);
    assert.equal(narrative.world.active_scene_id, "tile_0_0");

    // Cruzar al tile (1,0) fuera del anchor: se activa el tile, no el place.
    await input(40, -20);
    assert.equal(narrative.world.active_scene_id, "tile_1_0");
    assert.ok(!narrative.story_so_far.includes("Llegas al claro."));

    // Pisar el rect del anchor (celdas 40..59 × 50..59 → mundo x 52..62, z -7..-2).
    await input(55, -4);
    await waitFor(() => narrative.story_so_far.includes("Llegas al claro."));
    assert.equal(narrative.worldMap.serialize().active_place_id, "claro");
    const trigger = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "map_trigger",
    );
    assert.ok(trigger, "map_trigger difundido");

    // Re-pisar el anchor no re-dispara player_entered en bucle (gate por celda
    // + place ya activo).
    const count = broadcasts.filter((m) => m.type === "narrative_event" && m.eventId === "map_trigger").length;
    await input(55.2, -4);
    await input(55.4, -4);
    const count2 = broadcasts.filter((m) => m.type === "narrative_event" && m.eventId === "map_trigger").length;
    assert.equal(count2, count, "sin re-disparos");
  });
});

