/** Plano continuo: request_tile y análisis del vecino en la costura.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import { runTileGeneration } from "../bridge/handlers/tile.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import {
  makeCtx,
  makeSocket,
  waitFor,
  } from "./helpers.js";

describe("bridge request_tile (plano continuo)", () => {
  /** Tile mínimo válido: bioma + los rasgos de `ground` que continúan los
   *  cruces pedidos (el suelo declarativo, única vía). */
  const tileScene = (ground: Record<string, unknown>[] = []) => ({
    biome: "grass",
    scene_description: "campo de bench",
    ground,
    entities: [],
    ambient_event: "",
  });

  /** Camino oeste↔este a la altura de la fila 41, el `at` de las costuras. */
  const caminoFila41 = (fromCol: number) =>
    ({ id: "camino", kind: "path", points: [[fromCol, 41], [128, 41]], w: 2 });

  function seedTile00(narrative: NarrativeState): void {
    narrative.startNewSession("plugtest");
    // Tile (0,0) con un camino que muere en su borde ESTE en la fila 41.
    const t = {
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      ...tileScene([caminoFila41(64)]),
    };
    narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives(t));
  }

  it("cache-hit: re-difunde el tile persistido sin llamar al motor", async () => {
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    seedTile00(narrative);
    broadcasts.length = 0;
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 0, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 0, "sin LLM");
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    assert.ok(sceneEvent, "re-broadcast del esquema persistido");
    // El wire lleva la world scene normalizada (contrato de render único);
    // la persistencia interna sigue en Format D crudo.
    const wireScene = (sceneEvent.effects[0].data as { scene: Record<string, unknown> }).scene;
    assert.ok(Array.isArray(wireScene.objects), "objects[] en metros");
    assert.ok(wireScene.dimensions, "dimensions derivadas");
    assert.ok(wireScene.__format_d, "el crudo viaja en __format_d");
    assert.equal(wireScene.size, undefined, "sin size top-level (no es Format D)");
    const persisted = narrative.scenes_loaded["tile_0_0"].scene_data;
    assert.ok(persisted.size, "la persistencia sigue en Format D crudo");
    assert.equal(persisted.__format_d, undefined);
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    assert.equal(ready?.kind, "tile");
    assert.deepEqual(ready?.tile, { tx: 0, ty: 0 });
  });

  it("miss: genera con contexto de costuras y el prefetch NO roba la escena activa", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async (llmCtx) => {
          const gt = llmCtx.generate_tile!;
          assert.equal(gt.tx, 1);
          assert.equal(gt.ty, 0);
          // El vecino oeste (tile 0,0) expone su cruce con el MISMO at.
          assert.equal(gt.neighbors.west?.crossings[0]?.at, 41);
          // Continuarlo: camino de oeste a este.
          return {
            ok: true,
            scene: tileScene([caminoFila41(0)]),
          };
        },
      },
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "prefetch", edge: "east" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready" && m.kind === "tile"),
    );
    assert.ok(narrative.hasTile(1, 0), "tile registrado");
    assert.equal(narrative.world.active_scene_id, "tile_0_0", "prefetch sin activar");
    // El registro persistió las costuras del tile nuevo.
    assert.equal(narrative.getTile(1, 0)!.edges!.west.crossings[0]?.at, 41);
  });

  it("un tile que no continúa los cruces del vecino se rechaza (red server-side)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) }, // sin camino
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    // El rechazo llega TRADUCIDO. Hasta 2026-08-24 aquí viajaba el texto del
    // validador («El tile (1, 0) no es jugable: …»), que es diagnóstico de
    // motor: sigue entero en el `console.warn` del bridge.
    assert.equal(
      err?.message,
      "El motor narrativo devolvió un terreno inservible; inténtalo de nuevo.",
    );
    assert.ok(!narrative.hasTile(1, 0));
  });

  it("un tile con un NPC que no cabe donde nace se rechaza ANTES de persistirse (#289)", async () => {
    // El candado donde de verdad se para la clase: el bridge valida CADA tile
    // que devuelve el motor y lanza si no es jugable, así que un NPC
    // encerrado no llega ni al save ni al snapshot de mundo. (Los snapshots
    // pre-generados no se versionan —`.gitignore`—, así que no hay fichero en
    // el repo que auditar: lo que se puede candar es esto.)
    //
    // Dos props a 1,2 m dejan 2 celdas libres = 1,00 m: lo cruza el jugador
    // (radio 0,4) y NUNCA un NPC (0,5). El vano de la posada es legal (w:4).
    const posadaPinzada = () => ({
      ...tileScene([caminoFila41(0)]),
      volumes: [
        { id: "posada", label: "posada", type: "building", rect: [52, 20, 24, 16], cutaway: true, doors: [{ edge: "s", at: 11, w: 4 }] },
        { id: "barril_o", label: "barril", type: "prop", shape: "box", rect: [61, 34, 2, 3] },
        { id: "barril_e", label: "barril", type: "prop", shape: "box", rect: [65, 34, 2, 3] },
      ],
      entities: [{ id: "posadero", kind: "npc", name: "Posadero", cell: [60, 27], footprint: [1, 1], glyph: "n" }],
    });
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: posadaPinzada() }) },
    });
    // El texto del validador viaja al `console.warn` del bridge (al jugador le
    // llega traducido), así que el motivo se recoge de ahí.
    const motivos: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void motivos.push(args.map(String).join(" "));
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"));
    assert.ok(!narrative.hasTile(1, 0), "el tile injugable NO se persiste");
    // Y se rechaza POR ESTO, no por otra cosa: sin el motivo, el test seguiría
    // verde el día que el tile empiece a fallar por una costura.
    console.warn = warn;
    assert.match(motivos.join(" | "), /no lo cruza un cuerpo|no es alcanzable desde el player/, motivos.join(" | "));
  });

  it("el motor mudo en el ARRANQUE no le enseña la excepción al jugador (#180)", async () => {
    // El camino que da nombre a la tanda: primer tile, sin `destino` que
    // nombrar. La traducción vivía en un ternario que solo entraba si el viaje
    // traía destino, así que justo aquí —el momento en que más falla— el
    // jugador leía «Error: No se pudo generar la escena. fetch failed».
    const crudo = "fetch failed";
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => {
          throw new Error(crudo);
        },
      },
    });
    narrative.startNewSession("plugtest");
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 0, ty: 0, reason: "blocking" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.equal(err?.kind, "tile");
    assert.ok(!err?.message?.includes(crudo), `la excepción llegó cruda: ${err?.message}`);
    assert.equal(
      err?.message,
      "El motor narrativo no responde; inténtalo de nuevo en un momento.",
    );
  });

  it("y en un VIAJE el destino es un PREFIJO del mismo motivo, no una condición", async () => {
    // La otra mitad de la misma decisión: con destino se antepone el nombre
    // del lugar; el motivo traducido es el mismo. Si alguien devolviera el
    // ternario, este par de tests se separa: uno pide destino, el otro no.
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => {
          throw new Error("fetch failed");
        },
      },
    });
    narrative.startNewSession("plugtest");
    await runTileGeneration(ctx, 3, 0, undefined, { destino: "Molino del bench" });
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.equal(
      err?.message,
      "No se pudo llegar a Molino del bench. El motor narrativo no responde; inténtalo de nuevo en un momento.",
    );
  });

  it("blocking repetido mientras genera → generating re-difundido, una sola llamada", async () => {
    let release: (() => void) | null = null;
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          return {
            ok: true,
            scene: tileScene([caminoFila41(0)]),
          };
        },
      },
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() => release !== null);
    const before = broadcasts.length;
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 1);
    const regen = broadcasts.slice(before).find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "generating",
    );
    assert.ok(regen, "re-broadcast de generating para el que espera");
    release!();
    await waitFor(() => narrative.hasTile(1, 0));
  });

  it("add_combatants es aditivo y respawn acepta pos", async () => {
    const { ctx, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "add_combatants",
        enemies: [
          {
            id: "lobo_1",
            position: { x: 70, y: 0, z: 5 },
            health: 40,
            weaponId: "unarmed",
            personality: { aggression: 0.7, preferred_attacks: ["quick"], reaction_time: 0.3 },
          },
        ],
      },
      socket,
      ctx,
    );
    assert.ok(sim.getCombatant("lobo_1"), "enemigo añadido");
    assert.ok(sim.getCombatant("player"), "player intacto (sin reset)");
    // Duplicado ignorado.
    await routeMessage(
      { type: "add_combatants", enemies: [{ id: "lobo_1", position: { x: 0, y: 0, z: 0 }, health: 99, weaponId: "unarmed", personality: { aggression: 0, preferred_attacks: ["quick"], reaction_time: 1 } }] },
      socket,
      ctx,
    );
    assert.equal(sim.getCombatant("lobo_1")!.health, 40, "el duplicado no pisa el HP");

    await routeMessage({ type: "respawn", pos: { x: 66, y: 0, z: 2 } }, socket, ctx);
    assert.deepEqual(sim.getCombatant("player")!.position, { x: 66, y: 0, z: 2 });
    assert.ok((sent.at(-1) as StateUpdateMessage).playerHp > 0);
  });
});

describe("bridge: de dónde salió la escena (`source` del ready)", () => {
  const tileScene = () => ({ biome: "grass", scene_description: "campo", ground: [], entities: [] });
  const readyDe = (broadcasts: unknown[]) =>
    (broadcasts as NarrativeStatusMessage[]).findLast(
      (m) => m.type === "narrative_status" && m.phase === "ready",
    );

  it("un tile generado AHORA se declara `engine`; su re-difusión, `cache`", async () => {
    // Sin esto, una generación viva y un HIT de caché llegan iguales al
    // cliente — y el guion 05, que dice comprobar que la rasterización sigue
    // viva, pasaba en verde sobre un tile servido de caché.
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) },
    });
    narrative.startNewSession("plugtest");
    narrative.recordSceneLoaded(
      "tile_0_0",
      expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", ...tileScene() }),
    );
    const { socket } = makeSocket();

    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"));
    assert.equal(readyDe(broadcasts)?.source, "engine", "recién generado por el motor");
    assert.equal(aiCalls.scene.length, 1);

    // Volver a pedirlo: mismo tile, sin LLM — y el cliente tiene que poder
    // distinguirlo.
    broadcasts.length = 0;
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    assert.equal(readyDe(broadcasts)?.source, "cache");
    assert.equal(aiCalls.scene.length, 1, "el re-render no gastó motor");
  });
});

describe("bridge: la cola abandonada avisa a quien la espera", () => {
  const tileScene = () => ({ biome: "grass", scene_description: "campo", ground: [], entities: [] });

  /** Ocupa el "en vuelo" para que el job siguiente se quede en la COLA, que es
   *  de donde lo borra abandonAll. Devuelve el suelte. */
  function ocuparCola(ctx: ReturnType<typeof makeCtx>["ctx"]): () => void {
    let soltar!: () => void;
    ctx.sceneGen.enqueue({
      key: "bloqueo",
      blocking: true,
      run: () => new Promise<void>((r) => { soltar = r; }),
    });
    return () => soltar();
  }

  it("request_tile abandonado ⇒ narrative_status error de ESE tile (el velo se levanta)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.recordSceneLoaded(
      "tile_0_0",
      expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", ...tileScene() }),
    );
    const soltar = ocuparCola(ctx);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    assert.deepEqual(ctx.sceneGen.pending, ["tile_1_0"]);

    ctx.sceneGen.abandonAll();
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"), 1000)
      .catch(() => assert.fail("nadie avisó del tile abandonado: el cliente se queda con el velo puesto"));
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.equal(err?.kind, "tile");
    assert.deepEqual(err?.tile, { tx: 1, ty: 0 }, "el error nombra el tile (el cliente lo necesita para liberar su key)");
    assert.equal(err?.edge, "east");
    soltar();
  });

  it("un PREFETCH abandonado también avisa (si no, esa key no se vuelve a pedir)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.recordSceneLoaded(
      "tile_0_0",
      expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", ...tileScene() }),
    );
    const soltar = ocuparCola(ctx);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 0, ty: 1, reason: "prefetch", edge: "south" }, socket, ctx);
    ctx.sceneGen.abandonAll();
    await waitFor(() => broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"), 1000)
      .catch(() => assert.fail("el prefetch abandonado se perdió en silencio"));
    soltar();
  });
});
