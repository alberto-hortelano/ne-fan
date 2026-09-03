/** Colisión del PLAN declarado: la función canónica de core (planCollisionGrid
 *  + unionCollisionGrids) y la consistencia bridge↔cliente — ambos lados
 *  derivan la MISMA colisión del mismo plan (jugador y NPCs no divergen). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseGround,
  parseVolumes,
  planCollisionGrid,
  unionCollisionGrids,
} from "../src/scene/blueprint/index.js";
import { createTerrainCollider, type TerrainGridData } from "../src/scene/terrain-collision.js";
import { DEFAULT_SOLID_CHARS, formatDToWorld } from "../src/scene/scene-normalize.js";
import { GROUND_WATER_CHAR } from "../src/scene/blueprint/ground-collision.js";
import { tileWorldRect } from "../src/scene/tile.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";

function groundOf(raw: unknown[]) {
  const p = parseGround(raw);
  assert.ok(p.ok, `ground fixture inválido: ${p.ok ? "" : p.error}`);
  return p.features;
}
function volumesOf(raw: unknown[]) {
  const p = parseVolumes(raw);
  assert.ok(p.ok, `volumes fixture inválido: ${p.ok ? "" : p.error}`);
  return p.volumes;
}

/** Cuenta celdas sólidas de un grid (o 0 si null). */
function solidCount(grid: TerrainGridData | null): number {
  if (!grid) return 0;
  const solid = new Set(grid.solid_chars ?? ["S"]);
  let n = 0;
  for (const row of grid.grid) for (const ch of row) if (solid.has(ch)) n++;
  return n;
}

describe("unionCollisionGrids", () => {
  const mk = (rows: string[]): TerrainGridData => ({
    grid: rows,
    cols: rows[0].length,
    rows: rows.length,
    meters_per_cell: 0.5,
    origin: [0, 0],
    solid_chars: ["S"],
  });

  it("null ∪ X = X", () => {
    const g = mk(["Sg", "gg"]);
    assert.equal(unionCollisionGrids(null, g), g);
    assert.equal(unionCollisionGrids(g, null), g);
    assert.equal(unionCollisionGrids(null, null), null);
  });

  it("celda sólida si lo es en cualquiera de los dos", () => {
    const a = mk(["Sg", "gg"]);
    const b = mk(["gg", "gS"]);
    const u = unionCollisionGrids(a, b);
    assert.deepEqual(u?.grid, ["Sg", "gS"]);
    assert.deepEqual(u?.solid_chars, ["S"]);
  });

  it("una fuente SIN solid_chars declara sus sólidos con \"S\", que es el char de los grids derivados", () => {
    // Los grids que salen de `volumeCollisionGrid`/`groundCollisionGrid` llevan
    // `solid_chars: ["S"]`, pero el campo es opcional en `TerrainGridData`: sin
    // él, el default tiene que seguir siendo "S" en las DOS posiciones de la
    // unión, o una fuente entera dejaría de bloquear en silencio.
    const sinLista = (rows: string[]): TerrainGridData => {
      const { solid_chars: _omitido, ...resto } = mk(rows);
      return resto;
    };
    const a = sinLista(["Sg", "gg"]);
    const b = sinLista(["gg", "gS"]);
    assert.deepEqual(unionCollisionGrids(a, mk(["gg", "gg"]))?.grid, ["Sg", "gg"], "la fuente A sin lista bloquea con S");
    assert.deepEqual(unionCollisionGrids(mk(["gg", "gg"]), b)?.grid, ["gg", "gS"], "la fuente B sin lista bloquea con S");
    assert.deepEqual(unionCollisionGrids(a, b)?.grid, ["Sg", "gS"]);
  });

  it("respeta solid_chars distintos de cada fuente", () => {
    const a: TerrainGridData = { ...mk(["Wg"]), solid_chars: ["W"] };
    const b: TerrainGridData = { ...mk(["gw"]), solid_chars: ["w"] };
    const u = unionCollisionGrids(a, b);
    assert.deepEqual(u?.grid, ["SS"]);
  });
});

describe("planCollisionGrid", () => {
  it("null si no hay ni ground ni volumes con sólidos", () => {
    const rect = tileWorldRect(0, 0);
    assert.equal(planCollisionGrid(undefined, undefined, rect), null);
    assert.equal(planCollisionGrid([], [], rect), null);
  });

  it("une agua del ground con las huellas de los volumes", () => {
    const rect = tileWorldRect(0, 0);
    const ground = groundOf([{ id: "charca", kind: "water", rect: [0, 0, 20, 20] }]);
    const volumes = volumesOf([{ id: "t1", label: "roble", type: "tree", at: [100, 100] }]);
    const waterOnly = planCollisionGrid(ground, undefined, rect);
    const volOnly = planCollisionGrid(undefined, volumes, rect);
    const both = planCollisionGrid(ground, volumes, rect);
    assert.ok(solidCount(waterOnly) > 0);
    assert.ok(solidCount(volOnly) > 0);
    // La unión tiene al menos tantas sólidas como cualquiera de las fuentes
    // (regiones disjuntas ⇒ exactamente la suma).
    assert.equal(solidCount(both), solidCount(waterOnly) + solidCount(volOnly));
  });

  // ── El agua bloquea en las DOS fuentes, y el deck la abre en las dos ─────
  // El agua de `ground` se rasteriza al grid como GROUND_WATER_CHAR y ese char
  // está en `DEFAULT_SOLID_CHARS`; el plan la bloquea analíticamente. Son la
  // MISMA agua y nadie puede declararla vadeable por escena: si las dos
  // fuentes discreparan, el jugador rebotaría contra un río que la otra abre.
  it("el agua del ground bloquea por el grid Y por el plan, y el deck la abre en los dos", () => {
    const rect = tileWorldRect(0, 0);
    const rawGround = [
      { id: "rio", kind: "water", rect: [40, 40, 12, 12] },
      { id: "puente", kind: "deck", rect: [40, 44, 12, 3], material: "wood" },
    ];
    const world = formatDToWorld({
      scene_id: "tile_0_0",
      scene_description: "vega con río y puente",
      tile: { tx: 0, ty: 0 },
      biome: "grass",
      ground: rawGround,
      entities: [],
    }) as { terrain_grid: TerrainGridData };
    // Fuente 1: el grid. Los sólidos son exactamente los del engine.
    assert.deepEqual(world.terrain_grid.solid_chars, [...DEFAULT_SOLID_CHARS]);
    assert.ok(world.terrain_grid.solid_chars!.includes(GROUND_WATER_CHAR));
    assert.equal(world.terrain_grid.grid[41][45], GROUND_WATER_CHAR, "el río está en el grid");
    assert.equal(world.terrain_grid.grid[45][45], "b", "el puente perfora el agua en el grid");
    // Fuente 2: el plan, sin ningún dial de solidez que pasar.
    const plan = planCollisionGrid(groundOf(rawGround), [], rect)!;
    assert.equal(plan.grid[41][45], "S", "el río bloquea por el plan");
    assert.equal(plan.grid[45][45], "g", "el puente lo abre por el plan");
    assert.equal(solidCount(plan), 144 - 36, "12×12 de río menos 12×3 de puente");
  });
});

// ── Consistencia bridge↔cliente ────────────────────────────────────────────
// El cliente (applyPlanCollision) y el bridge (sim-collision) llaman ambos a
// planCollisionGrid con el mismo rect del tile. Este test comprueba que las
// decisiones de bloqueo del PROVIDER del bridge coinciden con las de un
// collider construido como el cliente, sobre los mismos puntos.
describe("consistencia de colisión del plan bridge↔cliente", () => {
  const rawGround = [{ id: "rio", kind: "water", rect: [40, 40, 12, 12] }];
  const rawVolumes = [{ id: "casa", label: "casa de piedra", type: "building", rect: [80, 80, 8, 6] }];

  function serverProvider() {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plantest");
    const scene = expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      scene_description: "campo con río y casa",
      biome: "grass",
      entities: [],
      ground: rawGround,
      volumes: rawVolumes,
    }) as Record<string, unknown>;
    s.recordSceneLoaded("tile_0_0", scene);
    return createSimCollisionProvider(s);
  }

  function clientCollider() {
    const rect = tileWorldRect(0, 0);
    const grid = planCollisionGrid(groundOf(rawGround), volumesOf(rawVolumes), rect);
    assert.ok(grid, "el plan debería producir un grid con sólidos");
    return createTerrainCollider(grid);
  }

  // Centro de celda del tile 0,0 (mpc 0.5, rect [-32,32)).
  const cell = (c: number, r: number) => ({ x: -32 + (c + 0.5) * 0.5, z: -32 + (r + 0.5) * 0.5 });

  it("blocksCircle coincide en agua, edificio y campo abierto", () => {
    const provider = serverProvider();
    const client = clientCollider();
    assert.ok(client, "cliente sin collider");
    const points = [cell(45, 45), cell(83, 82), cell(10, 10), cell(120, 120), cell(60, 60)];
    for (const pt of points) {
      const server = provider.blocksCircle(pt.x, pt.z, 0.4);
      const clientBlocks = client!.blocksCircle(pt.x, pt.z, 0.4);
      assert.equal(server, clientBlocks, `desync en (${pt.x.toFixed(2)}, ${pt.z.toFixed(2)}): bridge=${server} cliente=${clientBlocks}`);
    }
  });

  it("blocksMove coincide al entrar al edificio desde fuera", () => {
    const provider = serverProvider();
    const client = clientCollider();
    const from = cell(70, 82);
    const to = cell(83, 82);
    assert.equal(
      provider.blocksMove(from.x, from.z, to.x, to.z, 0.4),
      client!.blocksMove(from.x, from.z, to.x, to.z, 0.4),
    );
  });
});
