/** Mapa del mundo: player_entered_place + triggers, cruce de frontera y activación por posición.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { registerRuntimePlugin } from "../src/plugins/register.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type {
  ExitsChangedMessage,
  NarrativeEventMessage,
  NarrativeStatusDeSesion,
  NarrativeStatusMessage,
  ServerMessage,
  } from "../src/protocol/messages.js";
import { difundirSalidasDeLosTilesCargados } from "../bridge/salidas.js";
import { sessionDataForClient } from "../bridge/wire-scene.js";
import {
  capturarLogDelBridge,
  entrarEnLaPartida,
  escenaExpandidaDePrueba,
  makeCtx,
  makeSocket,
  porElBorde,
  waitFor,
} from "./helpers.js";
import { PLAYER_RADIUS_M } from "../src/scene/terrain-collision.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";

/** El `ready` DE PARTIDA: el status de juego (`game_gen`) no lleva `spawn`,
 *  `tile` ni `source`, y el tipo lo dice — de ahí que el filtro lo excluya en
 *  vez de abrir la unión con un `as`. */
const readyDeSesion = (m: ServerMessage): m is NarrativeStatusDeSesion =>
  m.type === "narrative_status" && m.kind !== "game_gen" && m.phase === "ready";

/** La world scene que difundió un `scene_init`: viaja en su propio effect
 *  `scene_loaded` (#397), no en el `data` de un spawn. */
function escenaDelEvento(
  ev: NarrativeEventMessage | undefined,
): { exits?: { place_id: string; edge?: string }[] } | undefined {
  const efecto = ev?.effects?.[0];
  if (!efecto || efecto.kind !== "scene_loaded") return undefined;
  return efecto.scene as { exits?: { place_id: string; edge?: string }[] };
}

describe("bridge player_entered_place + map triggers", () => {
  it("lugar desconocido → narrative_status: error", async () => {
    const { ctx, broadcasts } = makeCtx();
    ctx.narrative.startNewSession("plugtest");
    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "nowhere" }, socket, ctx);
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("nowhere"));
    // Es el desenlace de ESE viaje: sin su placeId el cliente no lo cierra (#737).
    assert.equal(err?.kind, "scene");
    assert.equal(err?.placeId, "nowhere");
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
    narrative.recordSceneLoaded("scene_tavern", escenaExpandidaDePrueba("scene_tavern", { place_id: "tavern" }));
    narrative.worldMap.addTrigger("tavern", {
      id: "greet",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Huele a estofado." }],
    });

    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "tavern" }, socket, ctx);

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
    narrative.recordSceneLoaded("scene_cueva", escenaExpandidaDePrueba("scene_cueva", { place_id: "cueva" }));
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
    await porElBorde({ type: "player_entered_place", placeId: "cueva" }, socket, ctx);

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
    narrative.recordSceneLoaded("scene_cueva", escenaExpandidaDePrueba("scene_cueva", { place_id: "cueva" }));
    narrative.worldMap.addTrigger("cueva", {
      id: "al_entrar",
      when: { type: "player_entered" },
      consequences: [
        { type: "plugin_event", plugin_id: "f".repeat(64), event_type: "visita", payload: {} },
        { type: "story_update", delta: "La cueva huele a humedad." },
      ],
    });

    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "cueva" }, socket, ctx);

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
    narrative.recordSceneLoaded("scene_aldea", escenaExpandidaDePrueba("scene_aldea", { place_id: "aldea" }));
    narrative.recordSceneLoaded("scene_bosque", escenaExpandidaDePrueba("scene_bosque", { place_id: "bosque" }));

    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "aldea" }, socket, ctx);
    const fromAldea = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const aldeaScene = escenaDelEvento(fromAldea);
    assert.equal(aldeaScene?.exits?.[0]?.place_id, "bosque");
    assert.equal(aldeaScene?.exits?.[0]?.edge, "south");

    broadcasts.length = 0;
    await porElBorde({ type: "player_entered_place", placeId: "bosque" }, socket, ctx);
    const fromBosque = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const bosqueScene = escenaDelEvento(fromBosque);
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

  /** El mismo tile CON el edificio del lugar dentro, en las celdas 20..29 ×
   *  30..39 — o sea justo donde el `anchor.rect` de la forja dice que está.
   *
   *  Es lo que produce el mundo de verdad y lo que `tileScene()` no tiene:
   *  `planCollisionGrid` rasteriza la HUELLA ENTERA del volumen (los edificios
   *  del plan son macizos, no cuatro muros), así que el centro del rect —lo
   *  que devuelve `resolvePlaceTarget`— es un punto sólido. Con el tile vacío
   *  los dos caminos del spawn salen verdes midiendo aire. */
  const tileConLaNave = () => ({
    ...tileScene(),
    entities: [
      {
        id: "nave_de_la_forja",
        kind: "building",
        name: "la nave de la forja",
        cell: [20, 30],
        footprint: [10, 10],
      },
    ],
  });

  /** El rect de la forja en celdas del tile (1,0) y su centro en metros:
   *  minX 32 + 25·0,5 = 44,5; minZ −32 + 35·0,5 = −14,5. */
  const RECT_DE_LA_FORJA: [number, number, number, number] = [20, 30, 10, 10];
  const CENTRO_DEL_RECT = { x: 44.5, z: -14.5 };

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
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
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
      (m): m is NarrativeStatusDeSesion =>
        m.type === "narrative_status" && m.phase === "generating" && m.kind === "scene",
    );
    assert.equal(acuse?.placeId, "forja");
    const generating = broadcasts.find(
      (m): m is NarrativeStatusDeSesion =>
        m.type === "narrative_status" && m.phase === "generating" && m.kind === "tile",
    );
    assert.ok(generating, "el tile del viaje también anuncia que se está generando");
    assert.match(generating.message ?? "", /Viajando a La Forja/);
    const ready = broadcasts.find(readyDeSesion);
    assert.deepEqual(ready?.spawn, { x: 128, z: 0 });
    assert.deepEqual(ready?.tile, { tx: 2, ty: 0 });

    // Las exits difundidas con el tile son las del DESTINO, no las del origen.
    const sceneEvent = broadcasts.findLast(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const scene = escenaDelEvento(sceneEvent);
    assert.deepEqual(scene?.exits?.map((e) => e.place_id), ["claro"]);
  });

  it("si el motor acota el lugar con `map_upsert_place.anchor.rect` mientras genera, el spawn cae DENTRO del rect", async () => {
    // El holder existe porque el motor alcanza una sesión que todavía no
    // existe cuando se construye el ctx: igual que el de verdad, muta el mapa
    // DENTRO de la llamada, por la tool, no por un campo de la escena (#408).
    const sesion: { narrative?: NarrativeState } = {};
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => {
          // El motor decide que la forja ocupa las celdas 20..29 × 30..39 del
          // tile: el anclaje se afina y el jugador debe aparecer ahí, no en
          // el centro del tile. Llega DESPUÉS de que el bridge fijara el
          // anchor sin rect para generar: el spawn se resuelve al difundir.
          sesion.narrative!.worldMap.upsertPlace({
            id: "forja", kind: "site", parent_id: "world", name: "La Forja",
            anchor: { tx: 1, ty: 0, rect: [20, 30, 10, 10] },
          });
          return { ok: true as const, scene: tileScene() };
        },
      },
    });
    sesion.narrative = narrative;
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    assert.deepEqual(narrative.worldMap.get("forja")?.anchor, { tx: 1, ty: 0, rect: [20, 30, 10, 10] });
    // Tile (1,0): minX 32, minZ −32. Centro del rect = celda (25, 35) →
    // x = 32 + 25·0.5 = 44.5, z = −32 + 35·0.5 = −14.5.
    const ready = broadcasts.find(readyDeSesion);
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
    ctx.world.claimForSession(socket, narrative.session_id);
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));
    assert.ok(!narrative.story_so_far.includes("Suena el yunque."), "aún no ha llegado");

    // El cliente aplica el spawn y su siguiente sim_input lo delata.
    const ready = broadcasts.find(readyDeSesion);
    await porElBorde(
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
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 0, "sin LLM: la escena ya existía");
    const ready = broadcasts.find(readyDeSesion);
    assert.deepEqual(ready?.spawn, { x: 64, z: 0 }, "centro del tile (1,0)");
    assert.ok(narrative.story_so_far.includes("Suena el yunque."), "trigger de llegada");

    // …y el sim_input que llega después NO los repite.
    const antes = narrative.story_so_far.split("Suena el yunque.").length;
    await porElBorde(
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
    // Sin escena activa el rayo no tiene de dónde partir. Hasta #405 esto se
    // sembraba con una escena SIN `tile` («plató»): esa variante ya no entra
    // por el gate, así que el único «sin tile bajo el jugador» que queda es
    // «sin escena».

    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /No se pudo viajar a La Forja/);
    assert.equal(err?.kind, "scene", "el loader del cliente lo muestra");
    assert.equal(err?.placeId, "forja", "el viaje abierto se cierra por su id (#737)");
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
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
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
    const ready = broadcasts.find(readyDeSesion);
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
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /No se pudo llegar a La Forja/, "nombra el destino que se pulsó");
    assert.match(err?.message ?? "", /no responde/, "y traduce el motivo");
    assert.doesNotMatch(err?.message ?? "", /fetch failed/, "sin el volcado de la excepción");
    assert.doesNotMatch(err?.message ?? "", /tile \(\d/, "sin coordenadas de tile");
    // #737 y el regreso de #693: el fallo REAL del destino sale por el `fail()`
    // de `runTileGeneration`, como kind "tile". Sin su placeId, el cliente lo
    // leería como un tile ajeno y el «Viajando...» pagaría la expiración.
    assert.equal(err?.kind, "tile");
    assert.equal(err?.placeId, "forja", "el fallo del destino lleva el id del viaje");
  });

  it("un request_tile que falla SIN viaje no se marca: su error va sin placeId (#737)", async () => {
    // El gemelo del de arriba: la marca es de los viajes y SOLO de ellos. Un
    // tile de frontera o de prefetch que fallara con un placeId cerraría un
    // viaje que no es suyo en cuanto el id casara.
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: false, error: "fetch failed" }) },
    });
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await porElBorde({ type: "request_tile", tx: 3, ty: 0, reason: "prefetch" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.equal(err?.kind, "tile");
    assert.deepEqual(err && "tile" in err ? err.tile : undefined, { tx: 3, ty: 0 });
    assert.equal(err?.placeId, undefined, "un tile sin viaje no habla de ningún lugar");
  });

  it("acusa el viaje SIEMPRE, diciendo cómo lo encoló", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
    });
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    // El acuse va ANTES de que el job corra: es lo que el cliente apunta para
    // saber que el bridge cogió el viaje, y en qué estado.
    const acuse = broadcasts.find(
      (m): m is NarrativeStatusDeSesion =>
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
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
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

  // ── #616, mitad de ARRIBA: el juego no mete a nadie dentro ────────────────
  //
  // Los dos caminos del spawn —el lugar ya realizado y el que se genera ahora—
  // difundían el centro del `anchor.rect` SIN una sola consulta de solidez, y
  // el cliente teletransporta ahí (`main.ts:946`). Sobre las fixtures del
  // selector «Room» eso son los 13 `building` de robledo y puerto ocupados en
  // su centro, 13 de 13: estado sin salida. Estos cuatro tests miden el CABLE
  // (que el bridge pregunte) y no la cuenta (que la mide `salida-del-solido`).

  it("viajar a un lugar YA realizado deja al jugador en la PUERTA, no dentro del edificio (#616)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    seedTravelWorld(narrative);
    narrative.recordSceneLoaded(
      "tile_1_0",
      expandScenePrimitives({
        tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", place_id: "forja", ...tileConLaNave(),
      }),
      [],
      { activate: false },
    );
    narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0, rect: RECT_DE_LA_FORJA };
    broadcasts.length = 0;

    // CONTROL: el punto que se difundía hasta hoy está OCUPADO. Sin esto, lo
    // de abajo saldría igual de verde sobre un tile de aire.
    assert.equal(
      ctx.simCollision.ocupado(CENTRO_DEL_RECT.x, CENTRO_DEL_RECT.z, PLAYER_RADIUS_M),
      true,
      "el centro del rect de la forja es sólido: es el estado sin salida de #616",
    );

    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);

    const ready = broadcasts.find(readyDeSesion);
    // La nave ocupa x 42..47: se sale por su cara ESTE, a un radio de ella.
    assert.deepEqual(ready?.spawn, { x: 47.4, z: -14.5 }, "la puerta, no la cocina");
    assert.equal(
      ctx.simCollision.ocupado(ready!.spawn!.x, ready!.spawn!.z, PLAYER_RADIUS_M),
      false,
      "y el sitio al que se manda al jugador está libre",
    );
    assert.ok(
      Math.hypot(ready!.spawn!.x - CENTRO_DEL_RECT.x, ready!.spawn!.z - CENTRO_DEL_RECT.z) <= 4,
      "sin teletransportarlo a otro barrio: el desplazamiento es el mínimo",
    );
  });

  it("si el motor ancla el lugar SOBRE lo que acaba de construir, el spawn sale a la puerta (#616)", async () => {
    // El camino del `viaje.sitio`: el motor afina el `anchor.rect` DURANTE la
    // generación (`map_upsert_place.anchor`) y lo pone encima del edificio que
    // está declarando. Es el caso que #465 convierte en rutinario el día que
    // el motor real escriba rects.
    const sesion: { narrative?: NarrativeState } = {};
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => {
          sesion.narrative!.worldMap.upsertPlace({
            id: "forja", kind: "site", parent_id: "world", name: "La Forja",
            anchor: { tx: 1, ty: 0, rect: RECT_DE_LA_FORJA },
          });
          return { ok: true as const, scene: tileConLaNave() };
        },
      },
    });
    sesion.narrative = narrative;
    seedTravelWorld(narrative);
    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    const ready = broadcasts.find(readyDeSesion);
    assert.deepEqual(ready?.spawn, { x: 47.4, z: -14.5 });
    assert.equal(
      ctx.simCollision.ocupado(ready!.spawn!.x, ready!.spawn!.z, PLAYER_RADIUS_M),
      false,
      "el jugador aparece EN el lugar, pero no dentro de su geometría",
    );
  });

  it("un lugar realizado SIN sitio libre: error con el nombre, y NI escena NI spawn mudo (#616)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    seedTravelWorld(narrative);
    narrative.recordSceneLoaded(
      "tile_1_0",
      expandScenePrimitives({
        tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", place_id: "forja", ...tileConLaNave(),
      }),
      [],
      { activate: false },
    );
    narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0, rect: RECT_DE_LA_FORJA };
    // Un mundo sin una sola salida: `sitioParaAparecer` satura el tope las
    // cuatro veces y devuelve `null`. Se monta sustituyendo la consulta de
    // PUNTO y no el mundo porque alcanzarlo con geometría de verdad pide 160 m
    // de sólido continuo (25 tiles de agua), y lo que se mide aquí es qué hace
    // el bridge con ese `null`, no cuándo se produce.
    const provider = ctx.simCollision;
    ctx.simCollision = { ...provider, ocupado: () => true };
    broadcasts.length = 0;
    const log = capturarLogDelBridge();

    const { socket } = makeSocket();
    try {
      await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    } finally {
      log.soltar();
    }

    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /No se pudo viajar a La Forja/, "nombra el lugar que se pulsó");
    assert.match(err?.message ?? "", /No hay un sitio libre donde aparecer allí/);
    assert.equal(err?.kind, "scene");
    assert.equal(err?.placeId, "forja", "el cliente cierra su «Viajando…» por el id");
    // Un spawn mudo —escena nueva, `spawn: undefined`— dejaba al jugador en el
    // tile viejo mirando el de otro sitio, sin que nada se lo dijera.
    assert.equal(
      broadcasts.some((m) => m.type === "narrative_event" && m.eventId === "scene_init"),
      false,
      "no se difunde la escena del destino",
    );
    assert.equal(broadcasts.some(readyDeSesion), false, "ni un ready sin spawn");
    // Y el estado no se toca: el place no queda activo en un sitio al que el
    // jugador nunca llegó.
    assert.notEqual(narrative.worldMap.serialize().active_place_id, "forja");
    assert.ok(
      log.lineas.some((l) => l.includes("forja") && l.includes("sitio libre")),
      `el motivo técnico queda en el log del bridge: ${log.lineas.join(" | ")}`,
    );
  });

  it("un viaje que GENERA y no encuentra sitio: error con el destino y sin difundir el tile (#616)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileConLaNave() }) },
    });
    seedTravelWorld(narrative);
    ctx.simCollision = { ...ctx.simCollision, ocupado: () => true };
    const log = capturarLogDelBridge();

    const { socket } = makeSocket();
    await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    log.soltar();

    const err = broadcasts.findLast(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /No se pudo llegar a La Forja/, "nombra el destino");
    assert.match(err?.message ?? "", /No hay un sitio libre donde aparecer allí/);
    assert.equal(err?.kind, "tile");
    assert.equal(err?.placeId, "forja", "el throw de viaje.sitio sale por el fail() del viaje, con su id (#737)");
    assert.doesNotMatch(
      err?.message ?? "",
      /no pudo construirlo/,
      "y NO lo cuelga del motor, que construyó el tile perfectamente",
    );
    assert.equal(broadcasts.some(readyDeSesion), false, "ningún ready: nada de spawn mudo");
  });

  // ── #742: el `ready` del viaje lleva su `placeId`, rama a rama ────────────
  //
  // Con él core reconoce la LLEGADA del viaje abierto (`esperasQueTermina`) y
  // un `ready` ajeno —un prefetch, un `request_tile` de un tile que ya
  // existe— deja de quitarle el «Viajando...». Es el mismo contrato que el
  // `fail()` de #737, en la otra punta: una rama que difunda el tile del
  // viaje SIN la marca devuelve el muro a la expiración. Por eso un test por
  // rama, y no uno por el camino feliz: las cuatro difunden por sitios
  // distintos (`already`, `exists`, `engine` en `runTileGeneration`; el lugar
  // realizado en `difundirPlaceRealizado`, con punto y `sin ancla`).
  describe("el ready de un viaje lleva el placeId del viaje, por cualquier rama (#742)", () => {
    /** El único `ready` de partida difundido, afirmando que es uno. */
    function elReady(broadcasts: ServerMessage[]): NarrativeStatusDeSesion {
      const readys = broadcasts.filter(readyDeSesion);
      assert.equal(readys.length, 1, `un ready y solo uno: ${JSON.stringify(readys)}`);
      return readys[0];
    }

    it("engine: el tile del destino se genera ahora", async () => {
      const { ctx, broadcasts, narrative } = makeCtx({
        ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
      });
      seedTravelWorld(narrative);
      const { socket } = makeSocket();
      await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
      await waitFor(() => broadcasts.some(readyDeSesion));
      const ready = elReady(broadcasts);
      assert.equal(ready.source, "engine", "la rama que se quería medir");
      assert.equal(ready.placeId, "forja");
    });

    it("already: el anchor del lugar cae sobre un tile que ya existía (sin ser suyo)", async () => {
      const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
      seedTravelWorld(narrative);
      narrative.recordSceneLoaded(
        "tile_1_0",
        expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", ...tileScene() }),
        [],
        { activate: false },
      );
      narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0 };
      assert.equal(narrative.worldMap.get("forja")?.realized_scene_id, undefined, "no está realizado: va por runTileGeneration");
      const { socket } = makeSocket();
      await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
      await waitFor(() => broadcasts.some(readyDeSesion));
      const ready = elReady(broadcasts);
      assert.equal(aiCalls.scene.length, 0, "sin motor: el tile ya estaba");
      assert.equal(
        broadcasts.some((m) => m.type === "narrative_status" && m.kind === "tile" && m.phase === "generating"),
        false,
        "la rama `already` no anuncia generación",
      );
      assert.equal(ready.source, "cache");
      assert.equal(ready.placeId, "forja");
    });

    it("exists: el tile aparece mientras se generaba (otro camino lo registró)", async () => {
      const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
      seedTravelWorld(narrative);
      narrative.recordSceneLoaded(
        "tile_1_0",
        expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", ...tileScene() }),
        [],
        { activate: false },
      );
      narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0 };
      // La carrera, sin relojes: el PRIMER `getTile` de (1,0) —el de la rama
      // `already`— no lo ve, y `generateTileScene` sí (`hasTile`). Es el
      // orden que produce otro camino registrando el tile entre las dos.
      const getTile = narrative.getTile.bind(narrative);
      let primera = true;
      narrative.getTile = (tx, ty) => {
        if (tx === 1 && ty === 0 && primera) {
          primera = false;
          return undefined;
        }
        return getTile(tx, ty);
      };
      const { socket } = makeSocket();
      await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
      await waitFor(() => broadcasts.some(readyDeSesion));
      const ready = elReady(broadcasts);
      assert.equal(aiCalls.scene.length, 0, "el motor no llegó a llamarse");
      assert.ok(
        broadcasts.some((m) => m.type === "narrative_status" && m.kind === "tile" && m.phase === "generating"),
        "pasó por el anuncio de generación: es la rama `exists`, no `already`",
      );
      assert.equal(ready.source, "cache");
      assert.equal(ready.placeId, "forja");
    });

    it("lugar realizado con punto: el ready lleva spawn Y placeId", async () => {
      const { ctx, broadcasts, narrative } = makeCtx();
      seedTravelWorld(narrative);
      narrative.recordSceneLoaded(
        "tile_1_0",
        expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", place_id: "forja", ...tileScene() }),
        [],
        { activate: false },
      );
      narrative.worldMap.get("forja")!.anchor = { tx: 1, ty: 0 };
      const { socket } = makeSocket();
      await porElBorde({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
      const ready = elReady(broadcasts);
      assert.deepEqual(ready.spawn, { x: 64, z: 0 });
      assert.equal(ready.placeId, "forja");
    });

    it("lugar realizado SIN ancla: nadie se mueve, y el viaje llega igual — el ready lleva el placeId", async () => {
      // Sin esto el viaje `sin ancla` no se cerraba nunca: el ledger del
      // cliente solo se cerraba con `spawn`, y este `ready` no lo trae.
      const { ctx, broadcasts, narrative } = makeCtx();
      narrative.startNewSession("plugtest");
      narrative.worldMap.upsertPlace({ id: "tavern", kind: "site", parent_id: "world", name: "La Posada" });
      narrative.recordSceneLoaded("scene_tavern", escenaExpandidaDePrueba("scene_tavern", { place_id: "tavern" }));
      broadcasts.length = 0;
      const { socket } = makeSocket();
      await porElBorde({ type: "player_entered_place", placeId: "tavern" }, socket, ctx);
      const ready = elReady(broadcasts);
      assert.equal(ready.spawn, undefined, "sin ancla: no se pide spawn");
      assert.equal(ready.placeId, "tavern");
    });

    it("un request_tile NO es un viaje: su ready va sin placeId, del disco o del motor", async () => {
      // El gemelo de todo lo de arriba: un `ready` de frontera o de prefetch
      // con `placeId` cerraría un viaje que no es suyo en cuanto el id casara.
      const { ctx, broadcasts, narrative } = makeCtx({
        ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
      });
      seedTravelWorld(narrative);
      const { socket } = makeSocket();
      // Del disco: el tile activo, re-difundido al momento.
      await porElBorde({ type: "request_tile", tx: 0, ty: 0, reason: "prefetch" }, socket, ctx);
      const delDisco = elReady(broadcasts);
      assert.equal(delDisco.source, "cache");
      assert.equal(delDisco.placeId, undefined);
      broadcasts.length = 0;
      // Del motor: un tile nuevo por la cola.
      await porElBorde({ type: "request_tile", tx: 0, ty: 1, reason: "prefetch" }, socket, ctx);
      await waitFor(() => broadcasts.some(readyDeSesion));
      const delMotor = elReady(broadcasts);
      assert.equal(delMotor.source, "engine");
      assert.equal(delMotor.placeId, undefined);
    });
  });
});

describe("bridge activación por posición (tiles + anchors)", () => {
  it("pisar un tile lo activa y pisar el anchor de un place dispara sus triggers", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    const t00 = expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", scene_description: "campo", biome: "grass", entities: [] });
    const t10 = expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", scene_description: "campo", biome: "grass", entities: [] });
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
    ctx.world.claimForSession(socket, narrative.session_id);
    const input = (x: number, z: number) => porElBorde(
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

/** El hecho «el jugador ha cambiado de tile» ESCRIBE el save (#395). Hasta la
 *  tanda solo marcaba un `dirty` sin lector: un viaje por «Salidas» al que no
 *  siguiera otra escritura reanudaba en el tile de antes. Se mide contando
 *  escrituras del storage, que es lo que el disco ve — no llamadas a `save()`,
 *  que con la partida sin establecer no escriben nada. */
describe("bridge cambiar de tile guarda la partida (#395)", () => {
  const dosTiles = (narrative: NarrativeState) => {
    narrative.recordSceneLoaded(
      "tile_0_0",
      expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", scene_description: "campo", biome: "grass", entities: [] }),
    );
    narrative.recordSceneLoaded(
      "tile_1_0",
      expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", scene_description: "campo", biome: "grass", entities: [] }),
      [],
      { activate: false },
    );
  };

  /** Una partida EN DISCO que escucha al sim, con las escrituras contadas. */
  async function partidaEnMarcha() {
    const h = makeCtx();
    h.narrative.startNewSession("plugtest");
    dosTiles(h.narrative);
    const { socket } = makeSocket();
    h.ctx.world.claimForSession(socket, h.narrative.session_id);
    await entrarEnLaPartida(h.ctx, socket, h.narrative.session_id);
    const escrituras: string[] = [];
    const write = h.storage.write.bind(h.storage);
    h.storage.write = async (id, data) => {
      escrituras.push(id);
      await write(id, data);
    };
    const input = (x: number, z: number) =>
      porElBorde(
        { type: "input", delta: 0.016, inputs: { playerPosition: { x, y: 0, z }, playerForward: { x: 0, y: 0, z: -1 }, playerMoving: true } },
        socket,
        h.ctx,
      );
    return { ...h, socket, escrituras, input };
  }

  it("cambiar de TILE escribe el save con el destino y la posición; cambiar de celda dentro del mismo tile, no", async () => {
    const { narrative, storage, escrituras, input } = await partidaEnMarcha();
    // El primer input arranca el gate (tile desconocido → hay tile): escribe.
    await input(0, 0);
    const trasElPrimero = escrituras.length;
    assert.ok(trasElPrimero >= 1, "el primer tile pisado se guarda");
    // Dos celdas más del mismo tile: ni una escritura.
    await input(0.7, 0);
    await input(1.4, 0.7);
    assert.equal(escrituras.length, trasElPrimero, "cambiar de celda dentro del tile no escribe");
    // Cruzar a (1,0): UNA escritura, y el save lleva el destino y la posición.
    await input(40, -20);
    assert.equal(escrituras.length, trasElPrimero + 1, "cambiar de tile escribe una vez");
    assert.equal(narrative.world.active_scene_id, "tile_1_0");
    const guardado = await storage.read(narrative.session_id);
    assert.equal(guardado?.world.active_scene_id, "tile_1_0", "el save lleva el tile del destino");
    assert.deepEqual(guardado?.player.position, [40, 0, -20], "…y la posición viva del jugador en él");
  });

  it("si el save del cambio de tile falla, el jugador lo lee (narrative_status error, kind save)", async () => {
    const { ctx, broadcasts, storage, input } = await partidaEnMarcha();
    await input(0, 0);
    storage.write = async () => {
      throw new Error("disco lleno (simulado)");
    };
    const log = capturarLogDelBridge();
    try {
      await input(40, -20);
    } finally {
      log.soltar();
    }
    const aviso = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error" && m.kind === "save",
    );
    assert.ok(aviso, "el fallo del save se difunde como narrative_status error kind save");
    assert.match(aviso.message ?? "", /podría no guardarse/);
    assert.ok(log.lineas.some((l) => l.includes("el cambio de tile") && l.includes("disco lleno")), log.lineas.join(" | "));
    // Y el tile SÍ cambió: el fallo del disco no deja al jugador en el tile de antes.
    assert.equal(ctx.narrative.world.active_scene_id, "tile_1_0");
  });
});


/** El panel «Salidas» del cliente se dibuja desde `scene.exits`, que el
 *  bridge calcula al servir con las salidas del place de la escena. Si la
 *  escena activa no queda atada a ningún place, `placeDeLaEscena` cae al
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
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1] },
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
    return escenaDelEvento(ev)?.exits?.map((e) => e.place_id);
  };

  it("el bootstrap SIN place_id, habiendo mapa, es error — no un panel vacío", async () => {
    const { ctx, broadcasts } = bootstrapWith(tileScene());
    const { socket } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
      await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    } finally {
      log.soltar();
    }

    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    // Lo que lee QUIEN JUEGA: una frase, no el diagnóstico (#180). Un
    // `place_id` que falta no le dice nada y es del motor, no suyo.
    assert.equal(err?.message, "El motor narrativo no pudo construirlo; inténtalo de nuevo.");
    // Y el diagnóstico, entero, donde ahora vive: el log del bridge. Es lo que
    // dice QUÉ añadir, y sin esto la traducción habría borrado la pista.
    const diagnostico = log.lineas.join(" | ");
    assert.match(diagnostico, /place_id/, diagnostico);
    assert.match(diagnostico, /salidas/i, diagnostico);
    // Y lo que NO pasa: difundir una escena muda con el panel apagado.
    assert.equal(exitsOf(broadcasts), undefined, "ninguna escena difundida");
  });

  it("el bootstrap CON place_id queda atado y el panel ofrece el destino", async () => {
    const { ctx, broadcasts, narrative } = bootstrapWith(tileScene({ place_id: "robledo" }));
    const { socket } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));

    assert.equal(narrative.worldMap.serialize().active_place_id, "robledo");
    assert.deepEqual(exitsOf(broadcasts), ["molino"], "el panel ofrece el molino");
  });

  it("un link creado a mitad de sesión llega como exits_changed del tile activo, sin escena y sin sellar el save (#179)", async () => {
    const { ctx, broadcasts, narrative } = bootstrapWith(tileScene({ place_id: "robledo" }));
    const { socket } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));
    assert.deepEqual(exitsOf(broadcasts), ["molino"]);
    // La escena PERSISTIDA sigue siendo Format D crudo: las salidas no se sellan.
    assert.equal(narrative.scenes_loaded["tile_0_0"].scene_data.exits, undefined, "scene_data sin exits");

    // El motor crea un lugar y un enlace a mitad de sesión (lo que hace
    // `map_link` por el State API), y el bridge difunde SOLO las salidas.
    broadcasts.length = 0;
    narrative.worldMap.upsertPlace({ id: "ermita", kind: "site", parent_id: "world", name: "La Ermita" });
    narrative.worldMap.addLink({ from: "robledo", to: "ermita", kind: "path", edge: "north" });
    difundirSalidasDeLosTilesCargados(ctx);
    const cambio = broadcasts.find((m): m is ExitsChangedMessage => m.type === "exits_changed");
    assert.ok(cambio, "exits_changed difundido");
    assert.equal(cambio.sceneId, "tile_0_0");
    assert.deepEqual(cambio.exits.map((e) => [e.place_id, e.name, e.edge]), [
      ["molino", "El Molino", "east"],
      ["ermita", "La Ermita", "north"],
    ]);
    assert.equal(broadcasts.some((m) => m.type === "narrative_event"), false, "ni una escena re-difundida");
    assert.equal(narrative.scenes_loaded["tile_0_0"].scene_data.exits, undefined, "y el save sigue sin sello");

    // Y el RESUME re-calcula: la escena que sirve `sessionDataForClient` trae
    // el destino nuevo, que es lo que hasta #179 se quedaba congelado.
    const servida = sessionDataForClient(ctx, narrative.toSessionData()).state.scenes_loaded["tile_0_0"].scene_data;
    assert.deepEqual((servida.exits as { place_id: string }[]).map((e) => e.place_id), ["molino", "ermita"]);
  });

  it("un link a un lugar cuyo tile está CARGADO pero no activo llega a ESE tile (QA T6, H-1)", async () => {
    // El jugador está en el molino (tile_1_0 activo) y el motor enlaza la aldea
    // (tile_0_0, cargado) con la ermita. Hasta la vuelta de QA solo se
    // difundían las salidas del activo, y al volver A PIE a la aldea el cliente
    // pintaba su copia vieja hasta Reanudar.
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    seedMapLikeEngine(narrative);
    const tile = (tx: number, place_id?: string) =>
      expandScenePrimitives({ tile: { tx, ty: 0 }, scene_id: `tile_${tx}_0`, scene_description: "campo", biome: "grass", entities: [], ...(place_id ? { place_id } : {}) });
    narrative.recordSceneLoaded("tile_0_0", tile(0, "robledo"));
    narrative.recordSceneLoaded("tile_1_0", tile(1, "molino"));
    // Campo abierto cargado: sin lugar, sin salidas que puedan cambiar.
    narrative.recordSceneLoaded("tile_2_0", tile(2), [], { activate: false });
    assert.equal(narrative.world.active_scene_id, "tile_1_0");
    broadcasts.length = 0;
    narrative.worldMap.upsertPlace({ id: "ermita", kind: "site", parent_id: "world", name: "La Ermita" });
    narrative.worldMap.addLink({ from: "robledo", to: "ermita", kind: "path", edge: "north" });
    difundirSalidasDeLosTilesCargados(ctx);
    const cambios = broadcasts.filter((m): m is ExitsChangedMessage => m.type === "exits_changed");
    assert.deepEqual(
      cambios.map((c) => [c.sceneId, c.exits.map((e) => e.place_id)]),
      [
        ["tile_0_0", ["molino", "ermita"]],
        ["tile_1_0", ["robledo"]],
      ],
      "uno por tile cargado CON lugar: el de la aldea trae la ermita; el campo abierto no recibe nada",
    );
    assert.equal(broadcasts.length, cambios.length, "solo exits_changed: ni escena ni status");
  });

  it("sin escena activa, un cambio del mapa no difunde nada: la escena que llegue traerá sus salidas", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    seedMapLikeEngine(narrative);
    difundirSalidasDeLosTilesCargados(ctx);
    assert.deepEqual(broadcasts, []);
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
    await porElBorde({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() => narrative.hasTile(1, 0));

    const persisted = narrative.scenes_loaded["tile_1_0"].scene_data;
    assert.equal(persisted.place_id, undefined, "el place_id inventado se descarta");
    assert.equal(narrative.worldMap.get("molino")?.realized_scene_id, undefined, "el molino sigue sin realizar");
    assert.equal(narrative.worldMap.serialize().active_place_id, "robledo", "el jugador sigue en su lugar");
  });
});
