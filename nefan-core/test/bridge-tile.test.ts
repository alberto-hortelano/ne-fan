/** Plano continuo: request_tile y análisis del vecino en la costura.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
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
  /** Tile mínimo válido: bioma + camino que continúa los cruces pedidos. */
  const tileScene = (features: Record<string, unknown>[] = []) => ({
    biome: "grass",
    scene_description: "campo de bench",
    terrain_features: features,
    entities: [],
    ambient_event: "",
  });

  function seedTile00(narrative: NarrativeState): void {
    narrative.startNewSession("plugtest");
    // Tile (0,0) con un camino que muere en su borde ESTE en la fila 41.
    const t = {
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      ...tileScene([
        { type: "path", points: [[64, 41], [128, 41]], width: 2, at_edges: [{ edge: "east", at: 41 }] },
      ]),
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
            scene: tileScene([
              { type: "path", points: [[0, 41], [128, 41]], width: 2, at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 41 }] },
            ]),
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

  it("map_plan_update persiste el plan revisado; uno inválido se rechaza sin tocar el record", async () => {
    const { ctx, narrative } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g id="ground"/><g id="water"/></svg>';
    const volumes = [{ id: "roble", label: "roble", type: "tree", at: [10, 10] }];
    await routeMessage({ type: "map_plan_update", tx: 0, ty: 0, map_ground: svg, volumes }, socket, ctx);
    const rec = narrative.getTile(0, 0)!;
    assert.equal(rec.scene_data.map_ground, svg);
    assert.deepEqual(rec.scene_data.volumes, volumes);
    assert.equal(rec.scene_data.map_plan_reviewed, true);
    // Sin la capa #water el sanitizador lo rechaza y el persistido no cambia.
    await routeMessage(
      { type: "map_plan_update", tx: 0, ty: 0, map_ground: svg.replace('<g id="water"/>', "") },
      socket,
      ctx,
    );
    assert.equal(narrative.getTile(0, 0)!.scene_data.map_ground, svg);
    // Volumes inválidos (id duplicado) también se rechazan enteros.
    await routeMessage(
      { type: "map_plan_update", tx: 0, ty: 0, volumes: [...volumes, ...volumes] },
      socket,
      ctx,
    );
    assert.deepEqual(narrative.getTile(0, 0)!.scene_data.volumes, volumes);
    // Tile no registrado: se ignora con warn, sin lanzar.
    await routeMessage({ type: "map_plan_update", tx: 5, ty: 5, map_ground: svg }, socket, ctx);
    assert.ok(!narrative.hasTile(5, 5));
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
    assert.ok(err?.message?.includes("no es jugable"), err?.message);
    assert.ok(!narrative.hasTile(1, 0));
  });

  it("player_crossed_frontier delega en el pipeline de tiles cuando el activo es un tile", async () => {
    const { ctx, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async (llmCtx) => {
          assert.ok(llmCtx.generate_tile, "usa generate_tile, no frontier_request");
          assert.equal(llmCtx.frontier_request, undefined);
          assert.equal(llmCtx.generate_tile!.entry?.edge, "west", "entra por el opuesto al cruzado");
          return {
            ok: true,
            scene: tileScene([
              { type: "path", points: [[0, 41], [128, 41]], width: 2, at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 41 }] },
            ]),
          };
        },
      },
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    await waitFor(() => narrative.hasTile(1, 0));
    assert.equal(aiCalls.scene.length, 1);
  });

  it("blocking repetido mientras genera → generating re-difundido, una sola llamada", async () => {
    let release: (() => void) | null = null;
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          return {
            ok: true,
            scene: tileScene([
              { type: "path", points: [[0, 41], [128, 41]], width: 2, at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 41 }] },
            ]),
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

describe("imageElementsAtSharedEdge — análisis del vecino en la costura", () => {
  const record = (tx: number, ty: number, elements: unknown[]): never =>
    ({
      scene_data: {}, loaded_at: "x", asset_refs: [],
      tile: { tx, ty },
      analysis: { analyzed_at: "x", elements },
    }) as never;

  it("elementos que tocan el borde compartido salen con celdas a lo largo del borde", async () => {
    const { imageElementsAtSharedEdge } = await import("../bridge/handlers/tile.js");
    // Vecino al ESTE del tile nuevo: tile (1,0), rect x 32..96, z -32..32.
    // Su borde compartido es el oeste (x=32).
    const rec = record(1, 0, [
      { label: "muralla", solid: true, tall: true, rect: { minX: 30, maxX: 60, minZ: 4, maxZ: 12 } },
      { label: "roble", solid: true, tall: true, rect: { minX: 80, maxX: 90, minZ: 0, maxZ: 8 } },
    ]);
    const out = imageElementsAtSharedEdge(rec, "east");
    assert.equal(out.length, 1, "solo la muralla toca la costura");
    assert.equal(out[0].label, "muralla");
    // z 4..12 → celdas (z+32)/0.5 = 72..88
    assert.deepEqual(out[0].at, [72, 88]);
  });

  it("vecino al NORTE: banda sobre su borde sur y celdas a lo largo de x", async () => {
    const { imageElementsAtSharedEdge } = await import("../bridge/handlers/tile.js");
    // Vecino (0,-1): rect x -32..32, z -96..-32. Borde compartido = su sur (z=-32).
    const rec = record(0, -1, [
      { label: "río", solid: true, tall: false, rect: { minX: -10, maxX: 6, minZ: -96, maxZ: -30 } },
    ]);
    const out = imageElementsAtSharedEdge(rec, "north");
    assert.equal(out.length, 1);
    // x -10..6 → celdas (x+32)/0.5 = 44..76
    assert.deepEqual(out[0].at, [44, 76]);
  });

  it("sin análisis → []", async () => {
    const { imageElementsAtSharedEdge } = await import("../bridge/handlers/tile.js");
    const rec = { scene_data: {}, loaded_at: "x", asset_refs: [], tile: { tx: 1, ty: 0 } } as never;
    assert.deepEqual(imageElementsAtSharedEdge(rec, "east"), []);
  });
});

