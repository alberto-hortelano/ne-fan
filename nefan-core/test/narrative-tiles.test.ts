import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type { SessionData } from "../src/narrative/types.js";

function makeTileScene(tx: number, ty: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return expandScenePrimitives({
    tile: { tx, ty },
    scene_id: `tile_${tx}_${ty}`,
    scene_description: "campo",
    biome: "grass",
    entities: [],
    ambient_event: "",
    ...extra,
  });
}

describe("NarrativeState — registro de tiles (v4)", () => {
  it("recordSceneLoaded deriva tile/edges y alimenta el tileIndex", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0));
    const rec = s.getTile(0, 0);
    assert.ok(rec, "getTile(0,0)");
    assert.deepEqual(rec!.tile, { tx: 0, ty: 0 });
    assert.ok(rec!.edges, "edges computados al registrar");
    assert.ok(s.hasTile(0, 0));
    assert.ok(!s.hasTile(1, 0));
  });

  it("activate:false registra sin activar; setActiveTile activa por posición", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0));
    s.recordSceneLoaded("tile_1_0", makeTileScene(1, 0), [], { activate: false });
    assert.equal(s.world.active_scene_id, "tile_0_0", "el prefetch no roba la escena activa");
    assert.ok(s.hasTile(1, 0));
    assert.ok(s.setActiveTile(1, 0));
    assert.equal(s.world.active_scene_id, "tile_1_0");
    assert.equal(s.player.current_scene_id, "tile_1_0");
    assert.ok(!s.setActiveTile(9, 9), "tile inexistente → false");
  });

  it("neighborsOf devuelve los adyacentes existentes por borde", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0));
    s.recordSceneLoaded("tile_1_0", makeTileScene(1, 0), [], { activate: false });
    s.recordSceneLoaded("tile_0_-1", makeTileScene(0, -1), [], { activate: false });
    const n = s.neighborsOf(0, 0);
    assert.ok(n.east, "vecino este");
    assert.ok(n.north, "vecino norte");
    assert.equal(n.west, undefined);
    assert.equal(n.south, undefined);
  });

  it("los NPCs de un tile se registran con posición GLOBAL", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded(
      "tile_1_0",
      makeTileScene(1, 0, {
        entities: [{ id: "guia", kind: "npc", name: "Guía", cell: [0, 0], footprint: [1, 1], glyph: "n" }],
      }),
    );
    const npc = s.entities.find((e) => e.id === "guia")!;
    // Tile (1,0): rect [32..96, -32..32]; celda (0,0) centro → (32.25, -31.75).
    assert.deepEqual(npc.position, [32.25, 0, -31.75]);
  });
});

describe("NarrativeState — migración v3→v4", () => {
  it("envuelve la escena activa como tile (0,0) sin mover nada en el mundo", async () => {
    const storage = new MemorySessionStorage();
    const s = new NarrativeState(storage);
    const sessionId = s.startNewSession("plugtest");
    // Escena legacy Format D expandida: 10×6 a mpc 2 (20×12 m), un NPC en
    // celda (2,1) y un muro en (0,0).
    const legacy = {
      scene_id: "aldea",
      scene_description: "la aldea",
      size: { cols: 10, rows: 6, meters_per_cell: 2 },
      terrain: ["W" + "g".repeat(9), ...Array.from({ length: 5 }, () => "g".repeat(10))],
      terrain_legend: { W: { name: "muro", solid: true } },
      entities: [
        { id: "vecina", kind: "npc", name: "Vecina", cell: [2, 1], footprint: [1, 1], glyph: "n" },
      ],
      ambient_event: "",
      __expanded: true,
    };
    s.worldMap.upsertPlace({ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea" });
    s.recordSceneLoaded("aldea", legacy);
    // Spawn dinámico post-init en celda (5,2) → mundo ((5.5)*2-10, (2.5)*2-6) = (1, -1).
    s.recordEntitySpawned("forastero", "npc", "aldea", { x: 5, y: 0, z: 2 }, { name: "Forastero" }, "react_to_player");
    await s.save();

    // Degradar el save a v3 (como los reales pre-tiles).
    const raw = (await storage.read(sessionId))! as SessionData;
    raw.schema_version = 3;
    for (const rec of Object.values(raw.scenes_loaded)) {
      delete (rec as Record<string, unknown>).tile;
      delete (rec as Record<string, unknown>).edges;
    }
    await storage.write(sessionId, raw);

    const s2 = new NarrativeState(storage);
    assert.ok(await s2.loadSession(sessionId));
    // La escena vieja ya no existe; el tile (0,0) sí, con tile/edges.
    assert.equal(s2.scenes_loaded["aldea"], undefined);
    const rec = s2.getTile(0, 0);
    assert.ok(rec, "tile_0_0 registrado");
    assert.equal(s2.world.active_scene_id, "tile_0_0");
    // El place apunta al tile.
    assert.equal(s2.worldMap.get("aldea")?.realized_scene_id, "tile_0_0");
    // El NPC scene_init conserva su posición FÍSICA: celda (2,1) de 10×6@2
    // centrada = mundo (-5, -3).
    const vecina = s2.entities.find((e) => e.id === "vecina")!;
    assert.deepEqual(vecina.position, [-5, 0, -3]);
    assert.equal(vecina.scene_id, "tile_0_0");
    // El spawn dinámico migra a global: celda (5,2) → (1, -1).
    const forastero = s2.entities.find((e) => e.id === "forastero")!;
    assert.deepEqual(forastero.position, [1, 0, -1]);
    // El muro viejo sobrevive re-muestreado 4×4 en el grid del tile:
    // celda vieja (0,0) → celdas nuevas (44..47, 52..55).
    const grid = rec!.scene_data.terrain as string[];
    assert.equal(grid[52].slice(44, 48), "WWWW");
    // Y las costuras del tile no inventan cruces.
    assert.deepEqual(rec!.edges!.north.crossings, []);
  });

  it("un save ya v4 no se re-migra (idempotente)", async () => {
    const storage = new MemorySessionStorage();
    const s = new NarrativeState(storage);
    const sessionId = s.startNewSession("plugtest");
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0));
    await s.save();
    const s2 = new NarrativeState(storage);
    assert.ok(await s2.loadSession(sessionId));
    assert.ok(s2.hasTile(0, 0));
    assert.equal(Object.keys(s2.scenes_loaded).length, 1);
  });
});

describe("NarrativeState — análisis de imagen por tile (mundo derivado)", () => {
  const MURALLA = {
    label: "muralla", solid: true, tall: true,
    rect: { minX: -32, maxX: 32, minZ: 4, maxZ: 12 },
  };
  const ROBLE = {
    label: "roble", solid: true, tall: true,
    rect: { minX: -20, maxX: -14, minZ: -10, maxZ: -2 },
  };

  it("setTileAnalysis guarda en el SceneRecord y sobrevive a save/load", async () => {
    const storage = new MemorySessionStorage();
    const s = new NarrativeState(storage);
    s.startNewSession("plugtest");
    const sessionId = s.session_id;
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0));
    assert.ok(s.setTileAnalysis(0, 0, { analyzed_at: "2026-07-05T00:00:00Z", elements: [MURALLA] }));
    assert.ok(!s.setTileAnalysis(9, 9, { analyzed_at: "x", elements: [] }), "tile inexistente → false");
    await s.save();

    const s2 = new NarrativeState(storage);
    assert.ok(await s2.loadSession(sessionId));
    assert.equal(s2.getTile(0, 0)!.analysis!.elements[0].label, "muralla");
  });

  it("serializeForLlm resume el análisis del tile ACTIVO como scene_analysis", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0));
    s.recordSceneLoaded("tile_1_0", makeTileScene(1, 0), [], { activate: false });
    s.setTileAnalysis(1, 0, { analyzed_at: "x", elements: [ROBLE] });

    // El tile activo (0,0) no tiene análisis → sin scene_analysis.
    assert.equal(s.serializeForLlm().scene_analysis, undefined);

    s.setTileAnalysis(0, 0, { analyzed_at: "x", elements: [MURALLA, ROBLE] });
    const ctx = s.serializeForLlm();
    assert.ok(ctx.scene_analysis);
    assert.equal(ctx.scene_analysis!.scene_id, "tile_0_0");
    assert.equal(ctx.scene_analysis!.total, 2);
    assert.match(ctx.scene_analysis!.elements[0], /muralla \(sólido, alto\) x\[-32\.\.32\] z\[4\.\.12\]/);
  });
});
