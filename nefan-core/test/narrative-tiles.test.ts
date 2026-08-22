import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { FsSessionStorage, MemorySessionStorage } from "../src/narrative/session-storage.js";
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

  it("role y behavior del NPC de escena fluyen a entity.data", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    s.recordSceneLoaded(
      "tile_0_0",
      makeTileScene(0, 0, {
        entities: [{
          id: "guardia_1", kind: "npc", name: "Guardia", cell: [10, 10],
          footprint: [1, 1], glyph: "n", role: "guard",
          behavior: { perception_radius: 20 },
        }],
      }),
    );
    const npc = s.entities.find((e) => e.id === "guardia_1")!;
    assert.equal(npc.data.role, "guard");
    assert.deepEqual(npc.data.behavior, { perception_radius: 20 });
  });

  it("re-registrar una escena preserva posición y data de sus NPCs vivos", () => {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    const scene = makeTileScene(0, 0, {
      entities: [
        { id: "aldeana", kind: "npc", name: "Aldeana", cell: [10, 10], footprint: [1, 1], glyph: "n" },
        { id: "viejo", kind: "npc", name: "Viejo", cell: [20, 20], footprint: [1, 1], glyph: "n" },
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
        { id: "aldeana", kind: "npc", name: "Aldeana", cell: [10, 10], footprint: [1, 1], glyph: "n" },
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
    const posada = {
      scene_id: "posada_interior",
      entities: [
        { id: "nogala", kind: "npc", name: "Nogala Tres-Tratos", cell: [10, 10], footprint: [1, 1], glyph: "n" },
      ],
    };
    s.recordSceneLoaded("posada_interior", posada);
    const records = s.entities.filter((e) => e.id === "nogala");
    assert.equal(records.length, 1, "un solo record — sin duplicado");
    assert.equal(records[0].scene_id, "posada_interior", "movida a la escena nueva");
    assert.deepEqual(records[0].position, [10, 0, 10], "toma la posición declarada (legacy: celdas locales)");
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
      s.recordSceneLoaded("posada_interior", {
        scene_id: "posada_interior",
        entities: [
          { id: "nogala_tres_tratos", kind: "npc", name: "Nogala Tres-Tratos", cell: [10, 10], footprint: [1, 1], glyph: "n" },
        ],
      });
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
    // Spawn dinámico post-init: dispatchConsequences guarda METROS de mundo
    // (resolvePositionHint parte de la posición del jugador), nunca celdas.
    s.recordEntitySpawned("forastero", "npc", "aldea", { x: 1, y: 0, z: -1 }, { name: "Forastero" }, "narrative_request");
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
    // El spawn dinámico CONSERVA sus metros de mundo (el tile (0,0) centrado
    // es el mismo espacio físico): re-convertir celda→mundo aquí era el bug
    // que teletransportaba spawns al resumir saves v3.
    const forastero = s2.entities.find((e) => e.id === "forastero")!;
    assert.deepEqual(forastero.position, [1, 0, -1], "posición en metros intacta");
    assert.equal(forastero.scene_id, "tile_0_0");
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

  it("fixture v3 real de disco: spawns dinámicos conservan metros; el distante queda latente en su tile", async () => {
    // Save v3 COMMITEADO con la forma real pre-tiles: los narrative_request
    // guardan metros de mundo (resolvePositionHint), los scene_init salen de
    // las celdas de la escena. Se copia a tmp porque loadSession marca dirty
    // y el flujo real re-guarda.
    // OJO: el dir se llama saves-v3 (no saves/) — el .gitignore raíz ignora
    // cualquier dir "saves/" y una fixture ahí jamás llegaría a CI.
    const src = fileURLToPath(new URL("./fixtures/saves-v3/v3_aldea", import.meta.url));
    const tmp = await fs.mkdtemp(join(tmpdir(), "nefan-v3-"));
    try {
      await fs.cp(src, join(tmp, "v3_aldea"), { recursive: true });
      const storage = new FsSessionStorage(tmp);
      const s = new NarrativeState(storage);
      assert.ok(await s.loadSession("v3_aldea"), "el save v3 carga");

      // La escena vieja se envolvió como tile (0,0) y el place la sigue.
      assert.equal(s.scenes_loaded["aldea"], undefined);
      assert.ok(s.hasTile(0, 0));
      assert.equal(s.world.active_scene_id, "tile_0_0");
      assert.equal(s.worldMap.get("aldea")?.realized_scene_id, "tile_0_0");

      // scene_init: recreada desde la celda re-muestreada — misma posición
      // física (celda (3,2) de 12×8@2 centrada = mundo (-5, -3)).
      const vecina = s.entities.find((e) => e.id === "vecina")!;
      assert.deepEqual(vecina.position, [-5, 0, -3]);
      assert.equal(vecina.scene_id, "tile_0_0");

      // narrative_request cercano: metros INTACTOS (el bug los re-convertía
      // como celdas y lo teletransportaba), estado preservado.
      const forastero = s.entities.find((e) => e.id === "narr_npc_1748772600")!;
      assert.deepEqual(forastero.position, [3, 0, -2], "metros de mundo intactos");
      assert.equal(forastero.scene_id, "tile_0_0");
      assert.equal(forastero.data.name, "Forastero");
      assert.equal(forastero.spawn_reason, "narrative_request");

      // narrative_request distante (hint distant_north, z=-50): fuera del
      // tile (0,0) — queda latente etiquetado con el tile que CONTIENE su
      // posición, sin moverse.
      const jinete = s.entities.find((e) => e.id === "narr_npc_1748773200")!;
      assert.deepEqual(jinete.position, [0, 0, -50]);
      assert.equal(jinete.scene_id, "tile_0_-1");

      // Round-trip: el save migrado persiste como v4 y el segundo load es
      // idempotente (nada vuelve a moverse).
      await s.save();
      const s2 = new NarrativeState(storage);
      assert.ok(await s2.loadSession("v3_aldea"));
      assert.deepEqual(s2.entities.find((e) => e.id === "narr_npc_1748772600")!.position, [3, 0, -2]);
      assert.deepEqual(s2.entities.find((e) => e.id === "vecina")!.position, [-5, 0, -3]);
      assert.ok(s2.hasTile(0, 0));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
