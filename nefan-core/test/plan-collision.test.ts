/** Colisión del PLAN declarado: la función canónica de core (planCollisionGrid
 *  + unionCollisionGrids) y la consistencia bridge↔cliente — ambos lados
 *  derivan la MISMA colisión del mismo plan (jugador y NPCs no divergen). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseGround,
  parseVolumes,
  planCollisionGrid,
  planCollisionGridEnElAire,
  unionCollisionGrids,
} from "../src/scene/blueprint/index.js";
import { createTerrainCollider, type TerrainGridData } from "../src/scene/terrain-collision.js";
import { DEFAULT_SOLID_CHARS, formatDToWorld } from "../src/scene/scene-normalize.js";
import { escenaCargable } from "../src/scene/escena-cargable.js";
import { GROUND_WATER_CHAR } from "../src/scene/blueprint/ground-collision.js";
import { tileWorldRect } from "../src/scene/tile.js";
import { solidoBloquea } from "../src/simulation/salida-del-solido.js";
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
    const a: TerrainGridData = { ...mk(["Sg"]), solid_chars: ["S"] };
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
    const world = formatDToWorld(escenaCargable({
      scene_id: "tile_0_0",
      scene_description: "vega con río y puente",
      tile: { tx: 0, ty: 0 },
      biome: "grass",
      ground: rawGround,
      entities: [],
    })) as { terrain_grid: TerrainGridData };
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

// ── En el aire (tanda BY) ──────────────────────────────────────────────────
// El jugador saltando consulta un segundo grid: el mismo cálculo sin lo
// saltable. Lo que se afirma es QUÉ desaparece y qué no, celda a celda.
describe("planCollisionGridEnElAire", () => {
  const rect = tileWorldRect(0, 0);
  const aPieYAire = (rawVolumes: unknown[], rawGround?: unknown[]) => {
    const g = rawGround ? groundOf(rawGround) : undefined;
    const v = volumesOf(rawVolumes);
    return { pie: planCollisionGrid(g, v, rect), aire: planCollisionGridEnElAire(g, v, rect) };
  };
  const tramo = (id: string, extra: Record<string, unknown>) => ({
    id, label: "cerca", type: "wall", points: [[20, 60], [100, 60]], ...extra,
  });

  it("una valla (h 2) desaparece en el aire; un muro por defecto sigue entero", () => {
    const valla = aPieYAire([tramo("v", { h: 2 })]);
    assert.ok(solidCount(valla.pie) > 0, "a pie la valla es sólida");
    assert.equal(valla.aire, null, "en el aire no queda nada");
    const muro = aPieYAire([tramo("m", {})]);
    assert.equal(solidCount(muro.aire), solidCount(muro.pie), "el muro de 2,5 m sigue igual");
    assert.ok(solidCount(muro.pie) > 0);
  });

  it("la frontera es exacta: h 2,4 celdas (1,2 m) se salta, h 2,41 no", () => {
    assert.equal(aPieYAire([tramo("a", { h: 2.4 })]).aire, null);
    const b = aPieYAire([tramo("b", { h: 2.41 })]);
    assert.equal(solidCount(b.aire), solidCount(b.pie));
  });

  it("la almena cuenta: un muro de 1,6 celdas almenado mide 1,3 m y no se salta", () => {
    const liso = aPieYAire([tramo("l", { h: 1.6 })]);
    assert.equal(liso.aire, null, "liso, 0,8 m: se salta");
    const almenado = aPieYAire([tramo("a", { h: 1.6, crenellated: true })]);
    assert.equal(solidCount(almenado.aire), solidCount(almenado.pie), "almenado, 1,3 m: no");
  });

  it("el agua va SIEMPRE: en el aire el río bloquea igual, con una valla encima o sin ella", () => {
    const rio = [{ id: "rio", kind: "water", rect: [40, 50, 12, 20] }];
    const conValla = aPieYAire([tramo("v", { h: 2 })], rio);
    const soloRio = planCollisionGrid(groundOf(rio), undefined, rect);
    assert.deepEqual(conValla.aire?.grid, soloRio?.grid, "en el aire queda exactamente el río");
  });

  it("sin volúmenes (solo suelo, o nada) contesta igual que a pie, no revienta", () => {
    const rio = groundOf([{ id: "rio", kind: "water", rect: [40, 50, 12, 20] }]);
    assert.deepEqual(planCollisionGridEnElAire(rio, undefined, rect)?.grid, planCollisionGrid(rio, undefined, rect)?.grid);
    assert.equal(planCollisionGridEnElAire(undefined, undefined, rect), null);
  });

  it("un prop por defecto (1 m) se salta; uno `passable` es igual en los dos grids (vacío)", () => {
    const barril = aPieYAire([{ id: "b", label: "barril", type: "prop", shape: "cylinder", at: [64, 64] }]);
    assert.ok(solidCount(barril.pie) > 0);
    assert.equal(barril.aire, null);
    const alfombra = aPieYAire([{ id: "a", label: "alfombra", type: "prop", shape: "box", rect: [60, 60, 4, 4], passable: true }]);
    assert.equal(alfombra.pie, null);
    assert.equal(alfombra.aire, null);
  });

  it("lo alto no se salta: casa, torre, árbol y las jambas del gate siguen en el aire", () => {
    const altos = aPieYAire([
      { id: "casa", label: "casa", type: "building", rect: [10, 10, 8, 6] },
      { id: "torre", label: "torre", type: "tower", at: [40, 40] },
      { id: "roble", label: "roble", type: "tree", at: [100, 100] },
      { id: "muralla", label: "muralla", type: "wall", points: [[0, 80], [128, 80]] },
      { id: "puerta", label: "puerta", type: "gate", at: [64, 80], orient: "x" },
    ]);
    assert.deepEqual(altos.aire?.grid, altos.pie?.grid, "ni una celda de diferencia");
  });

  it("un gate en una valla: la valla se va, las jambas se quedan", () => {
    const g = aPieYAire([
      tramo("v", { h: 2 }),
      { id: "puerta", label: "portón", type: "gate", at: [60, 60], orient: "x" },
    ]);
    const jambas = planCollisionGrid(undefined, volumesOf([{ id: "puerta", label: "portón", type: "gate", at: [60, 60], orient: "x" }]), rect);
    assert.deepEqual(g.aire?.grid, jambas?.grid);
    assert.ok(solidCount(g.pie) > solidCount(g.aire));
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

  it("el PASO coincide entrando al edificio desde fuera Y saliendo desde dentro (#616)", () => {
    // Rehecho sobre `solidoBloquea` con la tanda G. Lo que este caso vigila es
    // la consistencia bridge↔cliente, así que tiene que preguntar a los dos por
    // el MISMO camino: el bridge por su proveedor, el cliente montando el suelo
    // igual que `world/collision.ts` — su collider del plan, consulta de punto.
    //
    // Y ahora mide las DOS direcciones. Entrar era lo único que se comparaba, y
    // entrar salía igual incluso con el defecto de #616 puesto: es SALIR lo que
    // cambia de veredicto, y quien no lo pregunte no se entera de que el bridge
    // y el cliente han dejado de colisionar igual por dentro de un edificio.
    const provider = serverProvider();
    const client = clientCollider();
    const suelo = { ocupado: (x: number, z: number, r: number) => client!.solapaSolido(x, z, r) };

    const fuera = cell(70, 82);
    const dentro = cell(83, 82);
    assert.equal(
      provider.algoImpideElPaso(fuera.x, fuera.z, dentro.x, dentro.z, 0.4),
      solidoBloquea(fuera, dentro, 0.4, suelo),
      "entrar al edificio",
    );
    assert.ok(provider.blocksCircle(dentro.x, dentro.z, 0.4), "control: (83,82) está dentro de la casa");

    // Salir: la casa ocupa [80..87] × [80..85] en celdas, así que desde (83,82)
    // la cara más cercana en Z está a 3 celdas y en X a 4 — el paso hacia −z
    // saca, y ninguno de los dos lados puede frenarlo.
    const saliendo = cell(83, 79);
    assert.equal(
      provider.algoImpideElPaso(dentro.x, dentro.z, saliendo.x, saliendo.z, 0.4),
      solidoBloquea(dentro, saliendo, 0.4, suelo),
      "salir del edificio",
    );
    assert.equal(
      provider.algoImpideElPaso(dentro.x, dentro.z, saliendo.x, saliendo.z, 0.4),
      false,
      "y de dentro se SALE: el paso que reduce la penetración no lo frena nadie (#616)",
    );
  });
});
