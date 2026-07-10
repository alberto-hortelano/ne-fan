import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";

/** Tile 0,0: rect mundo [-32,32). Celda (c,r) → mundo (-32 + (c+0.5)·0.5). */
function cellCenter(c: number, r: number): { x: number; z: number } {
  return { x: -32 + (c + 0.5) * 0.5, z: -32 + (r + 0.5) * 0.5 };
}

function makeState(extra: Record<string, unknown> = {}): NarrativeState {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("plugtest");
  const scene = expandScenePrimitives({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "campo",
    biome: "grass",
    entities: [],
    ambient_event: "",
    ...extra,
  }) as Record<string, unknown>;
  // Muro en la fila 10, columnas 10..20 (terrain_grid del esquema).
  const terrain = scene.terrain as string[];
  terrain[10] = terrain[10].slice(0, 10) + "W".repeat(11) + terrain[10].slice(21);
  s.recordSceneLoaded("tile_0_0", scene);
  return s;
}

describe("createSimCollisionProvider", () => {
  it("bloquea sobre los muros del terrain_grid y no en campo abierto", () => {
    const provider = createSimCollisionProvider(makeState());
    const wall = cellCenter(15, 10);
    assert.ok(provider.blocksCircle(wall.x, wall.z, 0.5), "celda W debe bloquear");
    const open = cellCenter(64, 64);
    assert.ok(!provider.blocksCircle(open.x, open.z, 0.5), "campo abierto no bloquea");
    // blocksMove: entrar al muro desde fuera bloquea; moverse en abierto no.
    const before = cellCenter(15, 6);
    assert.ok(provider.blocksMove(before.x, before.z, wall.x, wall.z, 0.5));
    assert.ok(!provider.blocksMove(open.x, open.z, open.x + 1, open.z, 0.5));
  });

  it("bloquea sobre las huellas de los volumes del plan", () => {
    const provider = createSimCollisionProvider(makeState({
      volumes: [{ id: "arbol_1", label: "roble viejo", type: "tree", at: [100, 100] }],
    }));
    const tree = cellCenter(100, 100);
    assert.ok(provider.blocksCircle(tree.x, tree.z, 0.5), "el árbol debe bloquear");
    const open = cellCenter(64, 64);
    assert.ok(!provider.blocksCircle(open.x, open.z, 0.5));
  });

  it("bloquea sobre los rects sólidos del análisis, tras invalidate", () => {
    const state = makeState();
    const provider = createSimCollisionProvider(state);
    // Punto abierto, cacheado sin análisis.
    assert.ok(!provider.blocksCircle(1, 1, 0.5));
    state.setTileAnalysis(0, 0, {
      analyzed_at: "2026-01-01T00:00:00.000Z",
      elements: [{ label: "roca", solid: true, tall: false,
        rect: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 } }],
    });
    // Caché vigente: sigue sin bloquear hasta invalidar.
    assert.ok(!provider.blocksCircle(1, 1, 0.5), "sin invalidate usa la caché");
    provider.invalidate("tile_0_0");
    assert.ok(provider.blocksCircle(1, 1, 0.5), "tras invalidate ve el análisis");
  });

  it("tile inexistente o escena legacy → sin colisión (degradación, no throw)", () => {
    const provider = createSimCollisionProvider(makeState());
    // Punto en el tile (5,5), que no existe.
    assert.ok(!provider.blocksCircle(320, 320, 0.5));
    // Escena legacy (no Format D) no rompe.
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("vieja_cripta", { room_id: "vieja_cripta", npcs: [] });
    const legacy = createSimCollisionProvider(s);
    assert.ok(!legacy.blocksCircle(0, 0, 0.5));
  });
});
