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

/** Leyenda por defecto (muro y agua bloquean) — lo que resuelve
 *  `resolveTerrainLegend` para una escena que no declara nada. */
const legendaPorDefecto = { solidChars: DEFAULT_SOLID_CHARS };

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
    assert.equal(planCollisionGrid(undefined, undefined, rect, legendaPorDefecto), null);
    assert.equal(planCollisionGrid([], [], rect, legendaPorDefecto), null);
  });

  it("une agua del ground con las huellas de los volumes", () => {
    const rect = tileWorldRect(0, 0);
    const ground = groundOf([{ id: "charca", kind: "water", rect: [0, 0, 20, 20] }]);
    const volumes = volumesOf([{ id: "t1", label: "roble", type: "tree", at: [100, 100] }]);
    const waterOnly = planCollisionGrid(ground, undefined, rect, legendaPorDefecto);
    const volOnly = planCollisionGrid(undefined, volumes, rect, legendaPorDefecto);
    const both = planCollisionGrid(ground, volumes, rect, legendaPorDefecto);
    assert.ok(solidCount(waterOnly) > 0);
    assert.ok(solidCount(volOnly) > 0);
    // La unión tiene al menos tantas sólidas como cualquiera de las fuentes
    // (regiones disjuntas ⇒ exactamente la suma).
    assert.equal(solidCount(both), solidCount(waterOnly) + solidCount(volOnly));
  });

  // ── El vado de la leyenda ────────────────────────────────────────────────
  // El agua de `ground` se rasteriza al grid como "w" y la leyenda decide si
  // ese char bloquea (`{name, solid:false}` = vado). Son la MISMA agua: si el
  // plan la bloqueara por su cuenta habría dos colisiones contradiciéndose
  // sobre el mismo río, y ganaría la que el autor NO escribió — el jugador
  // rebotando contra un vado que la escena abre.
  it("`solid:false` sobre el char del agua abre el vado también en el plan", () => {
    const rect = tileWorldRect(0, 0);
    const ground = groundOf([{ id: "rio", kind: "water", rect: [40, 40, 12, 12] }]);
    const volumes = volumesOf([{ id: "casa", label: "casa", type: "building", rect: [80, 80, 8, 6] }]);

    // Pareado: con la leyenda por defecto el río SÍ bloquea. Sin este par, un
    // plan que dejara de aportar agua por cualquier motivo pondría verde la
    // aserción de abajo sin comprobar nada.
    const conAgua = planCollisionGrid(ground, volumes, rect, legendaPorDefecto)!;
    const vadeable = planCollisionGrid(ground, volumes, rect, { solidChars: ["W"] })!;
    assert.equal(conAgua.grid[45][45], "S", "el agua bloquea con la leyenda por defecto");
    assert.equal(vadeable.grid[45][45], "g", "declarada vadeable, el plan no la bloquea");
    // Y lo que NO es agua sigue bloqueando: el vado abre el río, no la casa.
    assert.equal(vadeable.grid[82][83], "S", "la huella del edificio no depende de la leyenda");
    assert.equal(solidCount(vadeable), solidCount(conAgua) - 144, "solo se van las 12×12 celdas del río");
  });

  it("un tile SIN volúmenes y con el agua vadeable no aporta colisión de plan", () => {
    const rect = tileWorldRect(0, 0);
    const ground = groundOf([{ id: "rio", kind: "water", rect: [40, 40, 12, 12] }]);
    assert.ok(planCollisionGrid(ground, [], rect, legendaPorDefecto), "con agua sólida sí aporta");
    assert.equal(planCollisionGrid(ground, [], rect, { solidChars: ["W"] }), null);
  });

  // El camino completo, como lo recorre el juego: la leyenda que el AUTOR
  // escribe en Format D llega al plan por `terrain_grid.solid_chars`
  // (formatDToWorld), que es lo que pasan main.ts y sim-collision.
  it("la leyenda del Format D viaja hasta el plan por terrain_grid.solid_chars", () => {
    const escena = (legend: Record<string, unknown>) => ({
      scene_id: "tile_0_0",
      scene_description: "vega con río",
      tile: { tx: 0, ty: 0 },
      biome: "grass",
      terrain_legend: legend,
      ground: [{ id: "rio", kind: "water", rect: [40, 40, 12, 12] }],
      entities: [],
      ambient_event: "",
    });
    const bloqueada = formatDToWorld(escena({ w: "agua del río" })) as { terrain_grid: TerrainGridData };
    const vado = formatDToWorld(escena({ w: { name: "vado", solid: false } })) as { terrain_grid: TerrainGridData };
    assert.ok(bloqueada.terrain_grid.solid_chars?.includes("w"));
    assert.ok(!vado.terrain_grid.solid_chars?.includes("w"));

    const rect = tileWorldRect(0, 0);
    const ground = groundOf([{ id: "rio", kind: "water", rect: [40, 40, 12, 12] }]);
    assert.ok(planCollisionGrid(ground, [], rect, { solidChars: bloqueada.terrain_grid.solid_chars! }));
    assert.equal(planCollisionGrid(ground, [], rect, { solidChars: vado.terrain_grid.solid_chars! }), null);
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

  function serverProvider(terrain_legend?: Record<string, unknown>) {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plantest");
    const scene = expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      scene_description: "campo con río y casa",
      biome: "grass",
      entities: [],
      ambient_event: "",
      ...(terrain_legend ? { terrain_legend } : {}),
      ground: rawGround,
      volumes: rawVolumes,
    }) as Record<string, unknown>;
    s.recordSceneLoaded("tile_0_0", scene);
    return createSimCollisionProvider(s);
  }

  function clientCollider() {
    const rect = tileWorldRect(0, 0);
    const grid = planCollisionGrid(groundOf(rawGround), volumesOf(rawVolumes), rect, legendaPorDefecto);
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

  // El vado también: si el bridge siguiera bloqueando el agua que el autor
  // abrió, los NPCs no cruzarían por donde cruza el jugador — el desync que
  // esta suite existe para impedir.
  it("un vado declarado en la leyenda lo respetan los DOS lados", () => {
    const provider = serverProvider({ w: { name: "vado", solid: false } });
    const rect = tileWorldRect(0, 0);
    const client = createTerrainCollider(
      planCollisionGrid(groundOf(rawGround), volumesOf(rawVolumes), rect, { solidChars: ["W"] }),
    );
    const enElRio = cell(45, 45);
    assert.equal(serverProvider().blocksCircle(enElRio.x, enElRio.z, 0.4), true, "sin vado el río corta");
    assert.equal(provider.blocksCircle(enElRio.x, enElRio.z, 0.4), false, "el NPC vadea");
    assert.equal(client!.blocksCircle(enElRio.x, enElRio.z, 0.4), false, "y el jugador también");
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
