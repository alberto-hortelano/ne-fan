import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { escenaExpandidaDePrueba } from "./helpers.js";

function makeTileScene(tx: number, ty: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return expandScenePrimitives({
    tile: { tx, ty },
    scene_id: `tile_${tx}_${ty}`,
    scene_description: "campo",
    biome: "grass",
    entities: [],
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
        entities: [{ id: "guia", kind: "npc", name: "Guía", cell: [0, 0], footprint: [1, 1] }],
      }),
    );
    const npc = s.entities.find((e) => e.id === "guia")!;
    // Tile (1,0): rect [32..96, -32..32]; celda (0,0) centro → (32.25, -31.75).
    assert.deepEqual(npc.position, [32.25, 0, -31.75]);
  });

  it("role y description del NPC de escena fluyen a entity.data", () => {
    // Hasta #334 este test sembraba además `behavior: {...}` en la entity —
    // una clave que el contrato de entity NUNCA admitió (strict, 12 campos) y
    // que el gate de recordSceneLoaded ahora hace inexpresable desde escena.
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded(
      "tile_0_0",
      makeTileScene(0, 0, {
        entities: [{
          id: "guardia_1", kind: "npc", name: "Guardia", cell: [10, 10],
          footprint: [1, 1], role: "guard",
          description: "guardia con lanza y capa parda",
        }],
      }),
    );
    const npc = s.entities.find((e) => e.id === "guardia_1")!;
    assert.equal(npc.data.role, "guard");
    assert.equal(npc.data.description, "guardia con lanza y capa parda");
  });

  it("re-registrar una escena preserva posición y data de sus NPCs vivos", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    const scene = makeTileScene(0, 0, {
      entities: [
        { id: "aldeana", kind: "npc", name: "Aldeana", cell: [10, 10], footprint: [1, 1] },
        { id: "viejo", kind: "npc", name: "Viejo", cell: [20, 20], footprint: [1, 1] },
      ],
    });
    s.recordSceneLoaded("tile_0_0", scene);
    const npc = s.entities.find((e) => e.id === "aldeana")!;
    // La vida ambiental la movió y el LLM le dejó una directiva.
    npc.position = [5, 0, 5];
    npc.data.directive = { type: "wander" };

    // Re-broadcast del mismo tile (re-entrada): no duplica ni resetea.
    s.recordSceneLoaded("tile_0_0", scene);
    const after = s.entities.filter((e) => e.id === "aldeana");
    assert.equal(after.length, 1);
    assert.deepEqual(after[0].position, [5, 0, 5], "la posición viva no se pisa");
    assert.deepEqual(after[0].data.directive, { type: "wander" }, "la directiva sobrevive");

    // Un NPC que YA no está en la escena sí se retira.
    const scene2 = makeTileScene(0, 0, {
      entities: [
        { id: "aldeana", kind: "npc", name: "Aldeana", cell: [10, 10], footprint: [1, 1] },
      ],
    });
    s.recordSceneLoaded("tile_0_0", scene2);
    assert.equal(s.entities.some((e) => e.id === "viejo"), false);
    assert.equal(s.entities.filter((e) => e.id === "aldeana").length, 1);
  });

  it("mismo id en una escena NUEVA mueve al personaje (caso Nogala), y la re-entrada no lo devuelve", () => {
    // Regresión del playtest 2026-08-13: un NPC spawneado dinámicamente en el
    // tile y redeclarado en la escena realizada después debe ser UN solo
    // record. El contrato: la escena nueva lo declara con su MISMO id y el
    // registro lo MUEVE (scene_id + posición declarada) conservando data.
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0, { entities: [] }));
    s.recordEntitySpawned(
      "nogala", "npc", "tile_0_0", [3, 0, -10],
      { name: "Nogala Tres-Tratos", inventory: [{ id: "contratos" }] },
      "react_to_player",
    );

    // El motor realiza la posada y declara a Nogala con su id existente.
    const posada = escenaExpandidaDePrueba("posada_interior", {
      tile: { tx: 0, ty: 1 },
      entities: [
        { id: "nogala", kind: "npc", name: "Nogala Tres-Tratos", cell: [10, 10], footprint: [1, 1] },
      ],
    });
    s.recordSceneLoaded("posada_interior", posada);
    const records = s.entities.filter((e) => e.id === "nogala");
    assert.equal(records.length, 1, "un solo record — sin duplicado");
    assert.equal(records[0].scene_id, "posada_interior", "movida a la escena nueva");
    // Celda [10,10] 1×1 del tile (0,1): x = −32 + 10,5·0,5 = −26,75 ; z = 32 + 10,5·0,5 = 37,25.
    assert.deepEqual(records[0].position, [-26.75, 0, 37.25], "toma la posición declarada, en metros globales de su tile");
    assert.deepEqual(records[0].data.inventory, [{ id: "contratos" }], "el estado viaja con ella");
    assert.equal(records[0].spawn_reason, "react_to_player", "la procedencia se conserva");

    // La vida ambiental la mueve dentro de la posada…
    records[0].position = [4, 0, 4];
    // …y RE-ENTRAR al tile cacheado (que no la declara) no la toca; re-entrar
    // a la posada cacheada tampoco la teletransporta a su celda declarada.
    s.recordSceneLoaded("tile_0_0", makeTileScene(0, 0, { entities: [] }));
    s.recordSceneLoaded("posada_interior", posada);
    const after = s.entities.filter((e) => e.id === "nogala");
    assert.equal(after.length, 1);
    assert.equal(after[0].scene_id, "posada_interior");
    assert.deepEqual(after[0].position, [4, 0, 4], "re-broadcast cacheado no resetea la posición viva");
  });

  it("NPC nuevo con nombre exacto de otro record → warning de duplicado (sin dedupe)", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordEntitySpawned("narr_npc_1", "npc", "tile_0_0", [0, 0, 0], { name: "Nogala Tres-Tratos" }, "react_to_player");
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
    try {
      s.recordSceneLoaded("posada_interior", escenaExpandidaDePrueba("posada_interior", {
        tile: { tx: 0, ty: 1 },
        entities: [
          { id: "nogala_tres_tratos", kind: "npc", name: "Nogala Tres-Tratos", cell: [10, 10], footprint: [1, 1] },
        ],
      }));
    } finally {
      console.warn = origWarn;
    }
    // Ambos records existen (no se dedupea por nombre) pero queda la traza.
    assert.equal(s.entities.filter((e) => e.data.name === "Nogala Tres-Tratos").length, 2);
    assert.ok(
      warnings.some((w) => w.includes("comparte nombre exacto") && w.includes("narr_npc_1")),
      `warning de gemelo emitido (${warnings.length} warnings)`,
    );
  });
});
