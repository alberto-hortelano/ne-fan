/** Mapa del mundo: player_entered_place + triggers, cruce de frontera y activación por posición.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
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

  it("un trigger con el plugin_id de ANTES de migrar sigue sirviendo, y sin overlay", async () => {
    // El caso de #164 visto desde el mapa: el motor deja triggers escritos y
    // sigue narrando; cuando el jugador llega, el sistema al que apuntan puede
    // haber cambiado de versión — y migrar le cambia el id (es el hash del
    // manifest). Antes: el tick entero abortaba, el jugador no compraba y se
    // comía un narrative_status de error.
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    const v1 = {
      version: 1,
      name: "contador",
      description: "cuenta visitas",
      origin: { author: "narrative_engine" as const, rationale: "test" },
      slice: { schema: { type: "object" }, initial: { visitas: 0 } },
      events_consumed: [{ type: "visita", do: [{ op: "inc" as const, path: "slice.visitas", value: 1 }] }],
      fixtures: [{ before: { visitas: 0 }, event: { type: "visita" }, after: { visitas: 1 } }],
    };
    const alta = registerRuntimePlugin(narrative, ctx.activePlugins, v1);

    narrative.worldMap.upsertPlace({ id: "cueva", kind: "site", parent_id: "world", name: "Cueva" });
    narrative.recordSceneLoaded("scene_cueva", {
      room_id: "scene_cueva",
      place_id: "cueva",
      room_description: "la cueva",
    });
    narrative.worldMap.addTrigger("cueva", {
      id: "al_entrar",
      when: { type: "player_entered" },
      consequences: [
        // El id de la v1, que es el que existía cuando se escribió el trigger.
        { type: "plugin_event", plugin_id: alta.id, event_type: "visita", payload: {} },
        { type: "story_update", delta: "La cueva huele a humedad." },
      ],
    });

    // El motor evoluciona el sistema DESPUÉS de haber escrito el trigger.
    const v2 = {
      ...v1,
      version: 2,
      description: "cuenta visitas y ecos",
      slice: { schema: { type: "object" }, initial: { visitas: 0, ecos: 0 } },
      migrate: { "1": [{ op: "set" as const, path: "slice.ecos", value: 0 }] },
    };
    const migrado = registerRuntimePlugin(narrative, ctx.activePlugins, v2);
    assert.equal(migrado.action, "migrated");
    assert.notEqual(migrado.id, alta.id);

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "cueva" }, socket, ctx);

    assert.deepEqual(
      narrative.getPluginRecord(migrado.id)?.slice,
      { visitas: 1, ecos: 0 },
      "el evento llegó al sistema vigente por la dirección que dejó la migración",
    );
    assert.equal(
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
      false,
      "y al jugador no se le enseña nada roto",
    );
  });

  it("un plugin_id que no es de nadie no se lleva por delante el resto del trigger", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "cueva", kind: "site", parent_id: "world", name: "Cueva" });
    narrative.recordSceneLoaded("scene_cueva", {
      room_id: "scene_cueva",
      place_id: "cueva",
      room_description: "la cueva",
    });
    narrative.worldMap.addTrigger("cueva", {
      id: "al_entrar",
      when: { type: "player_entered" },
      consequences: [
        { type: "plugin_event", plugin_id: "f".repeat(64), event_type: "visita", payload: {} },
        { type: "story_update", delta: "La cueva huele a humedad." },
      ],
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "cueva" }, socket, ctx);

    assert.ok(
      narrative.story_so_far.includes("La cueva huele a humedad."),
      "la consequence inocente del mismo trigger se aplica igual",
    );
    assert.equal(
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
      false,
      "una referencia colgante se dice en el log del bridge, no en la cara del jugador",
    );
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
    // Dos "generating": el acuse del viaje (kind scene, con placeId) y el del
    // tile que lo materializa. Los dos nombran el destino.
    const acuse = broadcasts.find(
      (m): m is NarrativeStatusMessage =>
        m.type === "narrative_status" && m.phase === "generating" && m.kind === "scene",
    );
    assert.equal(acuse?.placeId, "forja");
    const generating = broadcasts.find(
      (m): m is NarrativeStatusMessage =>
        m.type === "narrative_status" && m.phase === "generating" && m.kind === "tile",
    );
    assert.ok(generating, "el tile del viaje también anuncia que se está generando");
    assert.match(generating.message ?? "", /Viajando a La Forja/);
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

  it("si el lugar se realiza MIENTRAS el viaje espera en la cola, el jugador llega igual", async () => {
    // H2 de QA: `runPlaceTravel` volvía con un `return` mudo al descubrir que
    // el lugar ya estaba realizado. La entrega resolvía en verde, nadie
    // difundía escena ni spawn ni error, y el cliente se quedaba con el velo
    // puesto para siempre — el cuelgue del #210 sobreviviendo DENTRO de su
    // propio arreglo. Ahora ese camino ENTREGA: es un viaje a un lugar que ya
    // existe, y se difunde como tal.
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    seedTravelWorld(narrative);
    let soltar!: () => void;
    ctx.sceneGen.enqueue({
      key: "bloqueo",
      blocking: true,
      run: () => new Promise<void>((r) => { soltar = r; }).then(() => ({ delivered: true as const })),
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    assert.deepEqual(ctx.sceneGen.pending, ["place_forja"], "el viaje espera en la cola");

    // Mientras espera, OTRO camino realiza el lugar (el jugador exploró hasta
    // su tile, o el motor lo realizó por su cuenta con las tools de mapa).
    narrative.recordSceneLoaded(
      "tile_1_0",
      expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", place_id: "forja", ...tileScene() }),
      [],
      { activate: false },
    );
    narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0 };
    broadcasts.length = 0;

    soltar();
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"), 2000)
      .catch(() => assert.fail("el viaje terminó MUDO: ni escena, ni spawn, ni error — velo eterno"));

    const scene = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    assert.ok(scene, "la escena del destino se difunde");
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    assert.deepEqual(ready?.spawn, { x: 64, z: 0 }, "y con el spawn: viajar es APARECER allí");
    assert.equal(ready?.source, "cache", "el bridge declara que no lo generó ahora");
    assert.equal(aiCalls.scene.length, 0, "no se gastó motor en un lugar que ya existía");
  });

  it("un viaje que falla le dice al jugador A DÓNDE iba, sin vomitar la excepción", async () => {
    // H5 de QA, capturado en vivo con el motor caído: el jugador pulsaba
    // «Molino del bench» y leía «Error: No se pudo generar el tile (2, 0).
    // fetch failed» — coordenadas de tile y una expresión en inglés, sin
    // nombrar el sitio al que quería ir. El motivo técnico no se pierde: se
    // queda en el log del bridge, que es su sitio.
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: false, error: "fetch failed" }) },
    });
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /No se pudo llegar a La Forja/, "nombra el destino que se pulsó");
    assert.match(err?.message ?? "", /no responde/, "y traduce el motivo");
    assert.doesNotMatch(err?.message ?? "", /fetch failed/, "sin el volcado de la excepción");
    assert.doesNotMatch(err?.message ?? "", /tile \(\d/, "sin coordenadas de tile");
  });

  it("acusa el viaje SIEMPRE, diciendo cómo lo encoló", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
    });
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    // El acuse va ANTES de que el job corra: es lo que el cliente apunta para
    // saber que el bridge cogió el viaje, y en qué estado.
    const acuse = broadcasts.find(
      (m): m is NarrativeStatusMessage =>
        m.type === "narrative_status" && m.phase === "generating" && m.kind === "scene",
    );
    assert.equal(acuse?.placeId, "forja");
    assert.equal(acuse?.enqueued, "queued");
    assert.match(acuse?.message ?? "", /Viajando a La Forja/);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));
  });

  it("abandonar la cola con el viaje esperando difunde error a TODOS los que esperan", async () => {
    // El cuelgue del guion 09 (#210), en su costura: el viaje se queda en la
    // cola detrás de otro job, un segundo click recibe "duplicate" y se cuelga
    // del gemelo, y un takeover (start_session / generate_game) vacía la cola.
    // Sin garantía de entrega, el job se borra en silencio: cero errores, cero
    // escena y el jugador esperando para siempre — la firma exacta observada
    // (240 s sin que `currentTile` cambiara y sin una sola excepción).
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    seedTravelWorld(narrative);
    let soltarBloqueo!: () => void;
    ctx.sceneGen.enqueue({
      key: "bloqueo",
      blocking: true,
      run: () => new Promise<void>((r) => { soltarBloqueo = r; }).then(() => ({ delivered: true as const })),
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    assert.deepEqual(ctx.sceneGen.pending, ["place_forja"], "el viaje espera en la cola");

    ctx.sceneGen.abandonAll();
    await waitFor(
      () => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
      1000,
    ).catch(() => {
      assert.fail(
        "nadie difundió error al abandonar el viaje: los dos clientes que lo pidieron esperan para siempre",
      );
    });

    const errores = broadcasts.filter(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.equal(
      errores.length,
      1,
      "UN error por viaje fallido, no uno por click: el panel del cliente no deduplica",
    );
    for (const e of errores) {
      assert.equal(e.kind, "scene", "el loader del cliente lo muestra");
      assert.equal(e.placeId, "forja");
      assert.match(e.message ?? "", /No se pudo viajar a La Forja/);
    }
    assert.equal(aiCalls.scene.length, 0, "el job abandonado no llegó a correr");
    soltarBloqueo();
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


/** El panel «Salidas» del cliente se dibuja desde `scene.exits`, que el
 *  bridge adjunta con las salidas del place de la escena. Si la escena no
 *  queda atada a ningún place, `enrichSceneWithExits` cae al
 *  `active_place_id`, que en un mapa recién sembrado es la raíz "world" — sin
 *  links, o sea panel VACÍO y sin un solo error. Como el panel es la única
 *  vía viva de viaje a un lugar, ahí desaparece el juego entero en silencio.
 *
 *  De ahí estas dos reglas, que son la misma vista desde los dos lados: el
 *  bridge etiqueta el place ÉL (nunca se lo pide al prompt) y, donde no puede
 *  saberlo —solo el bootstrap—, grita en vez de callarse. */
describe("el tile queda atado a su lugar (issue #172, hallazgo 3 de QA)", () => {
  const tileScene = (over: Record<string, unknown> = {}) => ({
    biome: "grass",
    scene_description: "el claro del arranque",
    ground: [],
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1], glyph: "@" },
    ],
    ...over,
  });

  /** Lo que hace el motor de verdad en el bootstrap: sembrar el world map con
   *  las map tools DURANTE la llamada, antes de responder la escena. Por eso
   *  el bridge no puede saber de antemano cuál es el lugar de partida. */
  function seedMapLikeEngine(narrative: NarrativeState): void {
    narrative.worldMap.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "Robledo" });
    narrative.worldMap.upsertPlace({ id: "molino", kind: "landmark", parent_id: "world", name: "El Molino" });
    narrative.worldMap.addLink({ from: "robledo", to: "molino", kind: "road", edge: "east" });
  }

  /** start_session contra un motor que siembra el mapa y responde `scene`. */
  function bootstrapWith(scene: Record<string, unknown>) {
    // El holder existe porque el fake tiene que alcanzar una sesión que
    // todavía no existe cuando se construye: igual que el motor de verdad,
    // siembra el mapa DENTRO de la llamada, no antes.
    const sesion: { narrative?: NarrativeState } = {};
    const h = makeCtx({
      ai: {
        generateScene: async () => {
          seedMapLikeEngine(sesion.narrative!);
          return { ok: true as const, scene };
        },
      },
    });
    sesion.narrative = h.narrative;
    return h;
  }

  const exitsOf = (broadcasts: { type: string }[]) => {
    const ev = (broadcasts as NarrativeEventMessage[]).findLast(
      (m) => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const scene = ev?.effects?.[0]?.data?.scene as { exits?: { place_id: string }[] } | undefined;
    return scene?.exits?.map((e) => e.place_id);
  };

  it("el bootstrap SIN place_id, habiendo mapa, es error — no un panel vacío", async () => {
    const { ctx, broadcasts } = bootstrapWith(tileScene());
    const { socket } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));

    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    // El motivo llega al motor y le dice qué añadir.
    assert.match(err?.message ?? "", /place_id/);
    assert.match(err?.message ?? "", /panel de \s*salidas sale VACÍO|salidas/);
    // Y lo que NO pasa: difundir una escena muda con el panel apagado.
    assert.equal(exitsOf(broadcasts), undefined, "ninguna escena difundida");
  });

  it("el bootstrap CON place_id queda atado y el panel ofrece el destino", async () => {
    const { ctx, broadcasts, narrative } = bootstrapWith(tileScene({ place_id: "robledo" }));
    const { socket } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    assert.equal(narrative.worldMap.serialize().active_place_id, "robledo");
    assert.deepEqual(exitsOf(broadcasts), ["molino"], "el panel ofrece el molino");
  });

  it("el bootstrap sin place_id pero con place_anchors se ata igual (el bridge lo deduce)", async () => {
    // Es el caso que QA provocó a mano quitándole el place_id al motor de
    // bench: con el anchor declarado, el bridge no necesita la prosa.
    const { ctx, broadcasts, narrative } = bootstrapWith(
      tileScene({ place_anchors: [{ place_id: "robledo", rect: [52, 48, 24, 16] }] }),
    );
    const { socket } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    assert.equal(narrative.scenes_loaded["tile_0_0"].scene_data.place_id, "robledo");
    assert.deepEqual(exitsOf(broadcasts), ["molino"]);
  });

  it("un tile de exploración NO hereda el place_id que invente el motor", async () => {
    // Campo abierto: ningún place está anclado en (1,0). Si el place_id del
    // modelo pasara, `recordSceneLoaded` activaría ese place y el panel
    // pasaría a pintar las salidas de un sitio donde el jugador no está.
    const { ctx, narrative } = makeCtx({
      ai: {
        generateScene: async () => ({
          ok: true as const,
          // Sin entity `player`: solo el tile de bootstrap la lleva.
          scene: tileScene({ place_id: "molino", scene_description: "campo abierto", entities: [] }),
        }),
      },
    });
    narrative.startNewSession("plugtest");
    seedMapLikeEngine(narrative);
    narrative.recordSceneLoaded(
      "tile_0_0",
      expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", place_id: "robledo", ...tileScene() }),
    );

    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() => narrative.hasTile(1, 0));

    const persisted = narrative.scenes_loaded["tile_1_0"].scene_data;
    assert.equal(persisted.place_id, undefined, "el place_id inventado se descarta");
    assert.equal(narrative.worldMap.get("molino")?.realized_scene_id, undefined, "el molino sigue sin realizar");
    assert.equal(narrative.worldMap.serialize().active_place_id, "robledo", "el jugador sigue en su lugar");
  });
});
