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
import type { NarrativeState } from "../src/narrative/narrative-state.js";

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

});

describe("bridge viaje a un place sin realizar (plano continuo)", () => {
  /** Tile mínimo válido que devuelve el motor falso (sin cruces que continuar
   *  ni player: no es el bootstrap). */
  const tileScene = () => ({
    biome: "grass",
    scene_description: "la forja al borde del camino",
    ground: [],
    entities: [],
  });

  /** Mundo de tiles con el jugador en el tile (0,0) = place "claro", y un
   *  link hacia "forja" que sale por el ESTE. */
  function seedTravelWorld(narrative: NarrativeState): void {
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "claro", kind: "landmark", parent_id: "world", name: "El Claro" });
    narrative.worldMap.upsertPlace({ id: "forja", kind: "site", parent_id: "world", name: "La Forja" });
    narrative.worldMap.addLink({ from: "claro", to: "forja", kind: "path", edge: "east" });
    narrative.recordSceneLoaded(
      "tile_0_0",
      expandScenePrimitives({
        tile: { tx: 0, ty: 0 },
        scene_id: "tile_0_0",
        place_id: "claro",
        ...tileScene(),
      }),
    );
  }

  it("el destino se ancla a un tile libre y se genera como TILE, con el place en el contexto", async () => {
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
    });
    seedTravelWorld(narrative);
    // El anillo de pre-generación ya ocupa el vecino este: el rayo sigue.
    narrative.recordSceneLoaded(
      "tile_1_0",
      expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", ...tileScene() }),
      [],
      { activate: false },
    );

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    // Se pidió un TILE (nunca una escena suelta), en el primer hueco del rayo
    // hacia el este, y el motor sabe QUÉ lugar construye ahí.
    const gen = aiCalls.scene.at(-1) as { generate_tile?: Record<string, unknown> };
    assert.ok(gen.generate_tile, "la petición es generate_tile");
    assert.equal(gen.generate_tile.tx, 2);
    assert.equal(gen.generate_tile.ty, 0);
    assert.deepEqual(gen.generate_tile.place, {
      id: "forja",
      name: "La Forja",
      kind: "site",
      description: "",
      attrs: {},
    });
    // …y el place vecino ya anclado viaja como referencia del vecindario.
    assert.deepEqual(gen.generate_tile.nearby_places, [
      { id: "claro", name: "El Claro", kind: "landmark", tile: [0, 0] },
    ]);

    // El place queda anclado y con su escena realizada = ese tile.
    assert.deepEqual(narrative.worldMap.get("forja")?.anchor, { tx: 2, ty: 0 });
    assert.equal(narrative.worldMap.get("forja")?.realized_scene_id, "tile_2_0");
    assert.ok(narrative.hasTile(2, 0));

    // Feedback al jugador: "Viajando a…" mientras genera, y el ready PIDE el
    // spawn en el centro del tile (2,0) → x = 128, z = 0.
    const generating = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "generating",
    );
    assert.equal(generating?.kind, "tile");
    assert.match(generating?.message ?? "", /Viajando a La Forja/);
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    assert.deepEqual(ready?.spawn, { x: 128, z: 0 });
    assert.deepEqual(ready?.tile, { tx: 2, ty: 0 });

    // Las exits difundidas con el tile son las del DESTINO, no las del origen.
    const sceneEvent = broadcasts.findLast(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const scene = sceneEvent?.effects?.[0]?.data?.scene as { exits?: { place_id: string }[] };
    assert.deepEqual(scene.exits?.map((e) => e.place_id), ["claro"]);
  });

  it("si el motor acota el lugar con `place_anchors`, el spawn cae DENTRO del rect", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => ({
          ok: true,
          // El motor decide que la forja ocupa las celdas 20..29 × 30..39 del
          // tile: el anclaje se afina y el jugador debe aparecer ahí, no en
          // el centro del tile.
          scene: { ...tileScene(), place_anchors: [{ place_id: "forja", rect: [20, 30, 10, 10] }] },
        }),
      },
    });
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    assert.deepEqual(narrative.worldMap.get("forja")?.anchor, { tx: 1, ty: 0, rect: [20, 30, 10, 10] });
    // Tile (1,0): minX 32, minZ −32. Centro del rect = celda (25, 35) →
    // x = 32 + 25·0.5 = 44.5, z = −32 + 35·0.5 = −14.5.
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    assert.deepEqual(ready?.spawn, { x: 44.5, z: -14.5 });
  });

  it("los triggers del destino los dispara la POSICIÓN, no el viaje", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
    });
    seedTravelWorld(narrative);
    narrative.worldMap.addTrigger("forja", {
      id: "yunque",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Suena el yunque." }],
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));
    assert.ok(!narrative.story_so_far.includes("Suena el yunque."), "aún no ha llegado");

    // El cliente aplica el spawn y su siguiente sim_input lo delata.
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: ready!.spawn!.x, y: 0, z: ready!.spawn!.z },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
        },
      },
      socket,
      ctx,
    );
    await waitFor(() => narrative.story_so_far.includes("Suena el yunque."));
    assert.equal(narrative.worldMap.serialize().active_place_id, "forja");
    assert.equal(narrative.world.active_scene_id, "tile_1_0");
  });

  it("volver a un place YA anclado re-difunde su tile y pide el spawn otra vez", async () => {
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    seedTravelWorld(narrative);
    narrative.recordSceneLoaded(
      "tile_1_0",
      expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", place_id: "forja", ...tileScene() }),
      [],
      { activate: false },
    );
    narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0 };
    narrative.worldMap.addTrigger("forja", {
      id: "yunque",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Suena el yunque." }],
    });
    broadcasts.length = 0;

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 0, "sin LLM: la escena ya existía");
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    assert.deepEqual(ready?.spawn, { x: 64, z: 0 }, "centro del tile (1,0)");
    assert.ok(narrative.story_so_far.includes("Suena el yunque."), "trigger de llegada");

    // …y el sim_input que llega después NO los repite.
    const antes = narrative.story_so_far.split("Suena el yunque.").length;
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 64, y: 0, z: 0 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
        },
      },
      socket,
      ctx,
    );
    assert.equal(narrative.story_so_far.split("Suena el yunque.").length, antes, "sin re-disparo");
  });

  it("sin tile bajo el jugador el viaje es fail-loud, no un destino inventado", async () => {
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "forja", kind: "site", parent_id: "world", name: "La Forja" });
    // Escena activa que NO es un tile: el rayo no tiene de dónde partir.
    narrative.recordSceneLoaded("plato", { scene_id: "plato", stage: {} });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /No se pudo viajar a La Forja/);
    assert.equal(err?.kind, "scene", "el loader del cliente lo muestra");
    assert.equal(aiCalls.scene.length, 0, "no se gastó una llamada al motor");
    assert.equal(narrative.worldMap.get("forja")?.anchor, undefined);
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

