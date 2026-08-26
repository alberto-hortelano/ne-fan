/** Las pasadas de `validateScene`, una a una.
 *
 *  Este fichero es la razón del refactor por pasadas, y su prueba: cada
 *  comprobación se ejerce con un grid de SEIS filas escrito a mano, sin
 *  fabricar un tile de 128×128 que sobreviva a la expansión y a las siete
 *  comprobaciones anteriores. Antes, para probar el flood-fill había que
 *  construir una escena legal de arriba abajo; ahora se le pasa una máscara.
 *
 *  Reparto con `scene-validate-golden.test.ts`: allí vive el comportamiento
 *  del validador COMPLETO (texto y orden de los mensajes, contrato con el
 *  motor); aquí, el de cada pieza en aislamiento, incluidos los estados que
 *  el pipeline entero no puede alcanzar hoy. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildWalkableMap,
  composePlan,
  checkDeclaredChars,
  checkPlayerSpawn,
  checkReachability,
  checkScatter,
  checkSeams,
  collectDoorCells,
  emptyFindings,
  floodFill,
  openTile,
  reportPlanBudget,
  type Cell,
  type Findings,
  type PlanMask,
  type TileView,
  type WalkableMap,
} from "../src/scene/scene-validate.js";
import type { TileEdges } from "../src/scene/tile-edges.js";

/** Tile de mentira desde un grid ASCII: "W" muro, "~" agua, lo demás pisable. */
function vista(filas: string[], over: Partial<TileView> = {}): TileView {
  return {
    cols: filas[0].length,
    rows: filas.length,
    grid: filas,
    raw: {},
    scene: {},
    legend: {},
    solid: new Set(["W", "~"]),
    ...over,
  };
}

/** Tile de tamaño REAL (128×128) todo hierba. Lo piden las pasadas de costura,
 *  porque `edgeCell` habla en coordenadas de tile, no del grid que le pases. */
const vistaTile = (over: Partial<TileView> = {}): TileView =>
  vista(Array.from({ length: 128 }, () => "g".repeat(128)), over);

const hallazgos = (view: TileView): Findings => emptyFindings(view.cols, view.rows);

/** Plan que no bloquea nada: el neutro para probar las pasadas que solo miran
 *  el terreno. Lo que el PLAN aporta a la máscara se prueba aparte, sobre un
 *  tile de verdad (describe «composePlan»), porque componerlo pide las
 *  dimensiones reales del tile. */
const SIN_PLAN: PlanMask = { solid: () => false, volumes: 0 };

/** Máscara + hallazgos de un grid, que es lo que consumen media docena de pasadas. */
function mapaDe(
  filas: string[],
  scene: Record<string, unknown> = {},
  plan: PlanMask = SIN_PLAN,
): { view: TileView; map: WalkableMap; found: Findings } {
  const view = vista(filas, { scene });
  const found = hallazgos(view);
  return { view, map: buildWalkableMap(view, plan, found), found };
}

/** Bordes sin ningún cruce: el punto de partida para declarar solo los que importan. */
const SIN_CRUCES: TileEdges = {
  north: { biome: "grass", crossings: [] },
  south: { biome: "grass", crossings: [] },
  east: { biome: "grass", crossings: [] },
  west: { biome: "grass", crossings: [] },
};

describe("openTile — gate de variante", () => {
  it("una escena sin `tile` se rechaza con stats vacíos y sin tocar el expander", () => {
    const r = openTile({ scene_id: "suelta" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.rejected.errors[0], /única variante de Format D/);
    assert.equal(r.rejected.stats.cols, 0, "no hay grid que medir");
  });

  it("coords no enteras se rechazan citando lo recibido", () => {
    const r = openTile({ tile: { tx: 1.5, ty: 0 } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.rejected.errors[0], 'tile.tx/ty deben ser enteros, got {"tx":1.5,"ty":0}');
  });

  it("normaliza el grid a cols×rows: rellena las cortas, recorta las largas y no deja huecos", () => {
    // El grid de trabajo tiene que ser rectangular pase lo que pase: media
    // docena de pasadas indexan `grid[r][c]` a pelo. OJO: esta tolerancia solo
    // se puede ejercer AQUÍ — el pipeline completo revienta antes en
    // `computeTileEdges`, que exige 128×128 exacto (ver el informe de la PR).
    const terrain: unknown[] = Array.from({ length: 100 }, (_, r) =>
      r === 3 ? "gg" : r === 4 ? "g".repeat(200) : r === 5 ? null : "g".repeat(128),
    );
    const r = openTile({ tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.view.grid.length, 128, "28 filas de relleno hasta el alto del tile");
    assert.deepEqual([...new Set(r.view.grid.map((f) => f.length))], [128], "todas de 128 chars");
    assert.equal(r.view.grid[3], "gg".padEnd(128, "g"), "la corta se rellena con hierba");
    assert.equal(r.view.grid[5], "g".repeat(128), "la que no es texto se sustituye entera");
  });

  it("las filas que sobran del terrain no entran en el grid", () => {
    const terrain = Array.from({ length: 130 }, () => "g".repeat(128));
    const r = openTile({ tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.view.grid.length, 128);
  });

  it("abre un tile ya expandido con su leyenda resuelta", () => {
    const terrain = Array.from({ length: 128 }, () => "g".repeat(128));
    const r = openTile({
      tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [],
      terrain_legend: { m: { name: "musgo", solid: false }, R: { name: "roca", solid: true } },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.view.cols, 128);
    assert.equal(r.view.legend.m, "musgo");
    assert.ok(r.view.solid.has("R"), "roca declarada sólida");
    assert.ok(!r.view.solid.has("m"));
  });
});

describe("checkDeclaredChars", () => {
  it("acepta los chars reservados sin leyenda y delata los demás en orden de barrido", () => {
    const view = vista(["ggwW", "_sbd", "aoQZ"]);
    const found = hallazgos(view);
    checkDeclaredChars(view, found);
    assert.deepEqual(found.errors, ['chars de terreno sin declarar en terrain_legend: "Q", "Z"']);
  });

  it("un char declarado en la leyenda deja de ser error", () => {
    const view = vista(["ggQ"], { legend: { Q: "musgo" } });
    const found = hallazgos(view);
    checkDeclaredChars(view, found);
    assert.deepEqual(found.errors, []);
  });
});

describe("buildWalkableMap", () => {
  it("el terreno sólido no se pisa y el resto sí", () => {
    const { map, found } = mapaDe(["gWg", "g~g"]);
    assert.equal(map.walkableCells, 4);
    assert.equal(found.stats.walkable_cells, 4);
    assert.equal(map.isWalkable([1, 0]), false, "el muro");
    assert.equal(map.isWalkable([1, 1]), false, "el agua");
    assert.equal(map.isWalkable([0, 0]), true);
    // Los cuatro desbordes, y `false` de verdad: un `undefined` de índice
    // fuera de rango cuela en un `if` pero no en un deepEqual de stats.
    assert.equal(map.isWalkable([-1, 0]), false, "fuera del grid no es excepción, es «no»");
    assert.equal(map.isWalkable([3, 0]), false);
    assert.equal(map.isWalkable([0, -1]), false);
    assert.equal(map.isWalkable([0, 2]), false);
  });

  it("lo que bloquea el PLAN tampoco se pisa, y no muerde la fila siguiente", () => {
    // La máscara es fila-mayor: sin el corte por columna, la celda [cols, r]
    // escribe en el índice de [0, r+1]. El bug clásico del grid plano.
    const plan: PlanMask = { solid: (c, r) => r === 0 && c >= 3, volumes: 1 };
    const { map } = mapaDe(["gggg", "gggg", "gggg"], {}, plan);
    assert.equal(map.isWalkable([3, 0]), false, "lo que el plan tapa no se pisa");
    assert.equal(map.isWalkable([0, 1]), true, "la fila siguiente queda intacta");
    assert.equal(map.walkableCells, 11);
  });

  it("separa al player y a los NPCs del decorado, y las entities rotas se ignoran", () => {
    const { map, found } = mapaDe(["ggg"], {
      entities: [
        { id: "player", kind: "player", cell: [2, 0] },
        { id: "herrero", kind: "npc", cell: [1, 0] },
        null,
        { id: "sin_celda", kind: "npc" },
      ],
    });
    assert.deepEqual(map.player, [2, 0]);
    assert.deepEqual(map.npcs, [{ id: "herrero", cell: [1, 0] }]);
    assert.equal(found.stats.npcs_total, 1);
    assert.equal(map.walkableCells, 3, "ni player ni NPC bloquean");
  });
});

/** La pasada que ATA el validador al juego: la máscara con la que se juzga la
 *  jugabilidad sale del MISMO plan que pinta el cliente y colisiona el bridge.
 *  Antes esta pasada tenía su propia idea de qué bloquea —la huella de cada
 *  entity—, así que veía los postes de vegetación que el juego atravesaba y no
 *  veía ni uno de los árboles que el juego sí frena. */
describe("composePlan", () => {
  const tileConPlan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "Un claro.",
    biome: "meadow",
    entities: [],
    ...over,
  });

  const abrir = (scene: Record<string, unknown>) => {
    const r = openTile(scene);
    assert.ok(r.ok, "el tile tiene que abrir");
    if (!r.ok) throw new Error("unreachable");
    const found = hallazgos(r.view);
    return { view: r.view, found, mask: composePlan(r.view, found) };
  };

  it("la vegetación de masa BLOQUEA en el validador (antes no veía ni un árbol)", () => {
    // 0,04/m² sobre el tile entero = 164 pinos: el bosque de tile entero más
    // denso que cabe en el presupuesto (a 0,05 son 205 y el recorte entraría
    // en escena, que es lo que mide el caso de al lado).
    const { mask, found } = abrir(
      tileConPlan({ vegetation_zones: [{ type: "pino", area: "rest", density: 0.04 }] }),
    );
    assert.equal(found.stats.volumes_total, 164, "164 pinos = 4096 m² × 0,04/m²");
    assert.deepEqual(found.errors, [], "y cabe: sin aviso de presupuesto");
    // Un tile de hierba sin plan no bloquea nada; con el pinar, sí.
    const bloqueadas = contarSolidas(mask);
    // ~2,8 celdas por tronco (el disco de 0,9-1,08 celdas de radio).
    assert.ok(bloqueadas > 400, `troncos rasterizados: ${bloqueadas} celdas`);
    const { mask: pelado } = abrir(tileConPlan());
    assert.equal(contarSolidas(pelado), 0, "sin plan no hay nada que bloquear");
  });

  it("una entity estática bloquea por SU VOLUMEN, que es lo que el jugador choca", () => {
    const { mask } = abrir(
      tileConPlan({
        entities: [{ id: "granero", kind: "building", name: "granero", cell: [40, 40], footprint: [6, 4], glyph: "B" }],
      }),
    );
    assert.equal(mask.solid(42, 41), true, "dentro de la huella");
    assert.equal(mask.solid(60, 60), false, "lejos, no");
  });

  it("un item no es geometría: no bloquea", () => {
    const { mask } = abrir(
      tileConPlan({
        ground: [{ id: "senda", kind: "path", points: [[0, 64], [128, 64]], w: 4, material: "dirt" }],
        entities: [{ id: "moneda", kind: "item", name: "moneda", cell: [40, 40], footprint: [2, 2], glyph: "$" }],
      }),
    );
    assert.equal(mask.solid(40, 40), false);
  });

  it("lo que el compositor no pudo componer sale como ERROR: el motor re-responde", () => {
    // En esta capa el aviso del plan es accionable de verdad — el motor puede
    // volver a mandar la escena. Por eso aquí es error y en el cliente es una
    // línea del log.
    const { found } = abrir(
      tileConPlan({ vegetation_zones: [{ type: "pino", area: "rest", density: 0.5 }] }),
    );
    assert.equal(found.errors.length, 1, found.errors.join(" | "));
    assert.match(found.errors[0], /EJEMPLARES POR m²/);
  });
});

/** Celdas que bloquea una máscara de plan sobre el tile entero. */
function contarSolidas(mask: PlanMask): number {
  let n = 0;
  for (let r = 0; r < 128; r++) for (let c = 0; c < 128; c++) if (mask.solid(c, r)) n++;
  return n;
}

describe("checkScatter", () => {
  it("sin bloques de scatter no dice nada", () => {
    const view = vista(["g"]);
    const found = hallazgos(view);
    checkScatter(view, found);
    assert.deepEqual(found.errors, []);
  });

  it("generadores declarados SIN zonas también se revisan", () => {
    // Medio bloque de scatter es un olvido del motor, no una intención: si se
    // saliera por la puerta de «no hay nada que validar», el tile llegaría al
    // cliente con generadores que no instancian nada y sin una palabra.
    const view = vista(["g"], {
      raw: { scatter_generators: { guijarro: { parts: [{ shape: "box", size: [0.4, 0.3, 0.4] }] } } },
    });
    const found = hallazgos(view);
    checkScatter(view, found);
    assert.deepEqual(found.errors, ["scatter inválido: scatter_zones: debe ser un array no vacío"]);
  });

  it("una zona sin su generador da la ruta exacta del fallo", () => {
    const view = vista(["g"], {
      raw: {
        scatter_generators: { guijarro: { parts: [{ shape: "box", size: [0.4, 0.3, 0.4] }] } },
        scatter_zones: [{ kind: "fantasma", shape: { type: "rect", x0: 0, z0: 0, x1: 4, z1: 4 }, density: 0.1 }],
      },
    });
    const found = hallazgos(view);
    checkScatter(view, found);
    assert.deepEqual(found.errors, [
      "scatter inválido: scatter_zones[0]: kind 'fantasma' sin generador en scatter_generators",
    ]);
  });
});

describe("checkPlayerSpawn", () => {
  const grid = ["ggg", "gWg"];

  it("fuera de bootstrap sobra, y no siembra el flood", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [0, 0] }] });
    assert.equal(checkPlayerSpawn(view, map, { required_crossings: [] }, found), null);
    assert.match(found.errors[0], /no llevan entity kind "player"/);
  });

  it("en bootstrap es obligatorio", () => {
    const { view, map, found } = mapaDe(grid);
    assert.equal(checkPlayerSpawn(view, map, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, ['falta la entity kind "player" (spawn del jugador)']);
  });

  it("fuera del grid se rechaza antes de mirar el terreno, por los cuatro lados", () => {
    // Los cuatro desbordes por separado: cada uno tiene que dar el mensaje de
    // «fuera del grid» y no el de «no es transitable», que se leería como que
    // la celda existe y está ocupada — y el motor movería el spawn en vano.
    for (const cell of [[9, 9], [-1, 1], [1, -1], [3, 1], [1, 2]] as Cell[]) {
      const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell }] });
      assert.equal(checkPlayerSpawn(view, map, { required_crossings: [], bootstrap: true }, found), null);
      assert.deepEqual(found.errors, [`el player está fuera del grid: [${cell[0]}, ${cell[1]}]`]);
    }
  });

  it("la esquina [0, 0] es un spawn legal como cualquier otro", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [0, 0] }] });
    assert.deepEqual(checkPlayerSpawn(view, map, { required_crossings: [], bootstrap: true }, found), [0, 0]);
    assert.deepEqual(found.errors, []);
  });

  it("sobre terreno sólido se rechaza citando el char que pisa", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [1, 1] }] });
    assert.equal(checkPlayerSpawn(view, map, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, [
      'el spawn del player [1, 1] no es transitable (celda "W" u ocupada por un footprint)',
    ]);
  });

  it("un spawn válido vuelve como semilla del flood", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [2, 1] }] });
    assert.deepEqual(checkPlayerSpawn(view, map, { required_crossings: [], bootstrap: true }, found), [2, 1]);
    assert.deepEqual(found.errors, []);
  });
});

describe("checkSeams", () => {
  const edgesConCaminoOeste: TileEdges = {
    ...SIN_CRUCES,
    west: { biome: "grass", crossings: [{ type: "path", at: 1, width: 2 }] },
  };

  it("un cruce del vecino sin continuación nombra el borde y las celdas donde buscarlo", () => {
    const { view, map, found } = mapaDe(["gg", "gg"]);
    const seams = checkSeams(view, map, SIN_CRUCES, {
      required_crossings: [{ edge: "north", type: "river", at: 30, width: 3 }],
    }, null, found);
    assert.deepEqual(found.errors, [
      "el vecino north tiene un river que muere en vuestra costura en la celda 30: " +
        "tu tile debe continuarlo con celdas transitables compatibles en el borde north, celdas 28..32",
    ]);
    assert.deepEqual(seams.crossingTargets, []);
    assert.deepEqual(seams.startCells, []);
  });

  it("el cruce continuado es objetivo de alcanzabilidad y, a falta de entrada, arranque", () => {
    const { view, map, found } = mapaDe(["gg", "gg"]);
    const seams = checkSeams(view, map, edgesConCaminoOeste, {
      required_crossings: [{ edge: "west", type: "path", at: 1, width: 2 }],
    }, null, found);
    assert.deepEqual(found.errors, []);
    assert.deepEqual(seams.crossingTargets, [{ cell: [0, 1], label: "cruce path del borde west (celda 1)" }]);
    assert.deepEqual(seams.startCells, [[0, 1]], "sin entrada declarada, arranca por el primer cruce");
  });

  it("el player, cuando lo hay, va DELANTE del resto de arranques", () => {
    const { view, map, found } = mapaDe(["gg", "gg"]);
    const seams = checkSeams(view, map, edgesConCaminoOeste, {
      required_crossings: [{ edge: "west", type: "path", at: 1, width: 2 }],
    }, [1, 0], found);
    assert.deepEqual(seams.startCells, [[1, 0], [0, 1]]);
  });

  it("un cruce que continúa en AGUA no se exige alcanzable a pie", () => {
    const { view, map, found } = mapaDe(["~g", "~g"]);
    const edges: TileEdges = { ...SIN_CRUCES, west: { biome: "grass", crossings: [{ type: "river", at: 1, width: 2 }] } };
    const seams = checkSeams(view, map, edges, {
      required_crossings: [{ edge: "west", type: "river", at: 1, width: 2 }],
    }, null, found);
    assert.deepEqual(found.errors, [], "la costura continúa: eso ya está validado");
    assert.deepEqual(seams.crossingTargets, [], "pero no se le pide llegar andando al río");
  });

  it("la entrada siembra el flood aunque no haya cruces requeridos", () => {
    const { view, map, found } = mapaDe(["gg", "gg"]);
    const edges: TileEdges = { ...SIN_CRUCES, west: { biome: "grass", crossings: [{ type: "path", at: 1, width: 1 }] } };
    const seams = checkSeams(view, map, edges, { required_crossings: [], entry: { edge: "west", at: 1 } }, null, found);
    assert.deepEqual(seams.startCells, [[0, 1]]);
    assert.deepEqual(seams.crossingTargets, [], "una entrada no es un cruce que haya que continuar");
  });

  it("la entrada casa con el PRIMER cruce dentro de ±2, no con el más cercano", () => {
    // `entry.at` es una pista con tolerancia, y el primero que cae dentro se
    // lleva el arranque: con dos cruces vecinos, el elegido es el declarado
    // antes, no el de la coordenada exacta. Da igual para el veredicto
    // (ambos arrancan en la misma región transitable), pero conviene saberlo
    // antes de leer un `reachable_cells` y no entender de dónde sale.
    const { view, map, found } = mapaDe(["gg", "gg"]);
    const edges: TileEdges = {
      ...SIN_CRUCES,
      west: { biome: "grass", crossings: [{ type: "path", at: 0, width: 1 }, { type: "path", at: 1, width: 1 }] },
    };
    const seams = checkSeams(view, map, edges, { required_crossings: [], entry: { edge: "west", at: 1 } }, null, found);
    assert.deepEqual(seams.startCells, [[0, 0]]);
  });

  it("sin `at`, la entrada vale con que el borde tenga un cruce pisable", () => {
    const { view, map, found } = mapaDe(["~g", "gg"]);
    const edges: TileEdges = {
      ...SIN_CRUCES,
      west: { biome: "grass", crossings: [{ type: "river", at: 0, width: 1 }, { type: "path", at: 1, width: 1 }] },
    };
    const seams = checkSeams(view, map, edges, { required_crossings: [], entry: { edge: "west" } }, null, found);
    assert.deepEqual(seams.startCells, [[0, 1]], "el primero cae en agua; se salta");
  });

  // ── Tolerancia y compatibilidad, sobre un tile de tamaño real ───────────
  // `edgeCell` habla en coordenadas de TILE (128), así que estos casos no se
  // pueden encoger a un grid de dos filas: la celda del borde sur caería fuera.
  const bordeCon = (edge: "north" | "south" | "east" | "west", crossings: { type: "path" | "river"; at: number; width: number }[]): TileEdges =>
    ({ ...SIN_CRUCES, [edge]: { biome: "grass", crossings } });

  it("el cruce continuado casa con tolerancia de ±2 celdas, incluida la última", () => {
    const view = vistaTile();
    const found = hallazgos(view);
    const map = buildWalkableMap(view, SIN_PLAN, found);
    const seams = checkSeams(view, map, bordeCon("north", [{ type: "path", at: 42, width: 2 }]), {
      required_crossings: [{ edge: "north", type: "path", at: 40, width: 2 }],
    }, null, found);
    assert.deepEqual(seams.crossingTargets, [{ cell: [42, 0], label: "cruce path del borde north (celda 42)" }]);
  });

  it("un cruce INCOMPATIBLE al lado no vale como continuación", () => {
    const view = vistaTile();
    const found = hallazgos(view);
    const map = buildWalkableMap(view, SIN_PLAN, found);
    const seams = checkSeams(view, map, bordeCon("south", [{ type: "path", at: 40, width: 2 }]), {
      required_crossings: [{ edge: "south", type: "river", at: 40, width: 2 }],
    }, null, found);
    assert.deepEqual(seams.crossingTargets, [], "un camino no continúa un río aunque esté en la misma celda");
    assert.equal(found.errors.length, 1, "y la costura se reporta rota");
  });

  it("un cruce compatible pero LEJOS no continúa nada", () => {
    const view = vistaTile();
    const found = hallazgos(view);
    const map = buildWalkableMap(view, SIN_PLAN, found);
    const seams = checkSeams(view, map, bordeCon("north", [{ type: "path", at: 100, width: 2 }]), {
      required_crossings: [{ edge: "north", type: "path", at: 40, width: 2 }],
    }, null, found);
    assert.deepEqual(seams.crossingTargets, [], "un camino a 60 celdas no es el mismo camino");
  });

  it("el borde sur mira la ÚLTIMA fila del tile", () => {
    const view = vistaTile();
    const found = hallazgos(view);
    const map = buildWalkableMap(view, SIN_PLAN, found);
    const seams = checkSeams(view, map, bordeCon("south", [{ type: "path", at: 7, width: 2 }]), {
      required_crossings: [{ edge: "south", type: "path", at: 7, width: 2 }],
    }, null, found);
    assert.deepEqual(seams.crossingTargets, [{ cell: [7, 127], label: "cruce path del borde south (celda 7)" }]);
  });

  it("el borde este mira su propia columna del grid", () => {
    const view = vistaTile();
    const found = hallazgos(view);
    const map = buildWalkableMap(view, SIN_PLAN, found);
    const seams = checkSeams(view, map, bordeCon("east", [{ type: "path", at: 7, width: 2 }]), {
      required_crossings: [{ edge: "east", type: "path", at: 7, width: 2 }],
    }, null, found);
    assert.deepEqual(seams.crossingTargets, [{ cell: [127, 7], label: "cruce path del borde east (celda 7)" }]);
  });

  it("la entrada también tiene tolerancia ±2, y fuera de ella no siembra", () => {
    const view = vistaTile();
    const cerca = checkSeams(view, buildWalkableMap(view, SIN_PLAN, hallazgos(view)), bordeCon("north", [{ type: "path", at: 42, width: 2 }]),
      { required_crossings: [], entry: { edge: "north", at: 40 } }, null, hallazgos(view));
    assert.deepEqual(cerca.startCells, [[42, 0]]);

    const lejos = checkSeams(view, buildWalkableMap(view, SIN_PLAN, hallazgos(view)), bordeCon("north", [{ type: "path", at: 43, width: 2 }]),
      { required_crossings: [], entry: { edge: "north", at: 40 } }, null, hallazgos(view));
    assert.deepEqual(lejos.startCells, [], "a tres celdas ya no es la misma entrada");
  });

  it("con entrada Y cruce requerido, el arranque es UNO: la entrada", () => {
    const view = vistaTile();
    const found = hallazgos(view);
    const map = buildWalkableMap(view, SIN_PLAN, found);
    const edges = bordeCon("west", [{ type: "path", at: 40, width: 2 }]);
    const seams = checkSeams(view, map, edges, {
      required_crossings: [{ edge: "west", type: "path", at: 40, width: 2 }],
      entry: { edge: "west", at: 40 },
    }, null, found);
    assert.deepEqual(seams.startCells, [[0, 40]], "el cruce es objetivo, no un segundo arranque");
    assert.equal(seams.crossingTargets.length, 1);
  });

  it("una entrada que solo casa con celdas sólidas no siembra nada", () => {
    const { view, map, found } = mapaDe(["~g", "~g"]);
    const edges: TileEdges = { ...SIN_CRUCES, west: { biome: "grass", crossings: [{ type: "river", at: 1, width: 2 }] } };
    const seams = checkSeams(view, map, edges, { required_crossings: [], entry: { edge: "west", at: 1 } }, null, found);
    assert.deepEqual(seams.startCells, []);
  });
});

describe("collectDoorCells", () => {
  it("los cuatro lados de una structure", () => {
    const view = vista(["gg"], {
      scene: {
        structures: [
          {
            type: "room", rect: [10, 20, 6, 4],
            doors: [{ side: "north", at: 2 }, { side: "south", at: 2 }, { side: "west", at: 1 }, { side: "east", at: 1 }],
          },
        ],
      },
    });
    const found = hallazgos(view);
    assert.deepEqual(collectDoorCells(view, found), [[12, 20], [12, 23], [10, 21], [15, 21]]);
    assert.equal(found.stats.doors_total, 4);
  });

  it("una puerta ancha ocupa tantas celdas como pide", () => {
    const view = vista(["gg"], {
      scene: { structures: [{ type: "room", rect: [0, 0, 8, 4], doors: [{ side: "north", at: 2, width: 3 }] }] },
    });
    assert.deepEqual(collectDoorCells(view, hallazgos(view)), [[2, 0], [3, 0], [4, 0]]);
  });

  it("los cuatro lados de un building cutaway, con su ancho por defecto", () => {
    const view = vista(["gg"], {
      scene: {
        volumes: [
          {
            id: "granero", type: "building", cutaway: true, rect: [10, 20, 8, 6],
            doors: [{ edge: "n", at: 2, w: 1 }, { edge: "s", at: 2, w: 1 }, { edge: "w", at: 1, w: 1 }, { edge: "e", at: 1, w: 1 }],
          },
        ],
      },
    });
    assert.deepEqual(collectDoorCells(view, hallazgos(view)), [[12, 20], [12, 25], [10, 21], [17, 21]]);
  });

  it("un vano ancho se extiende HACIA DELANTE desde su `at`, en los cuatro lados", () => {
    const view = vista(["gg"], {
      scene: {
        volumes: [
          {
            id: "granero", type: "building", cutaway: true, rect: [10, 20, 8, 6],
            doors: [{ edge: "n", at: 2, w: 2 }, { edge: "s", at: 2, w: 2 }, { edge: "w", at: 1, w: 2 }, { edge: "e", at: 1, w: 2 }],
          },
        ],
      },
    });
    assert.deepEqual(collectDoorCells(view, hallazgos(view)), [
      [12, 20], [13, 20], [12, 25], [13, 25], [10, 21], [10, 22], [17, 21], [17, 22],
    ]);
  });

  it("lo que no tiene forma de vano se salta sin reventar y sin inventarse celdas", () => {
    const view = vista(["gg"], {
      scene: {
        structures: [
          { type: "room", doors: [{ side: "north", at: 1 }] },                       // sin rect
          { type: "room", rect: [0, 0, 4, 4], doors: [{ side: "arriba", at: 1 }] },  // lado inventado
        ],
        volumes: [
          { id: "a", type: "building", cutaway: true, rect: [0, 0, 4], doors: [{ edge: "n", at: 1 }] },   // rect de 3
          { id: "b", type: "building", cutaway: true, rect: [0, 0, 4, 4], doors: [null, { edge: "n" }] }, // puerta sin `at`
          { id: "c", type: "building", cutaway: true, rect: [0, 0, 4, 4], doors: [{ edge: "arriba", at: 1 }] },
        ],
      },
    });
    const found = hallazgos(view);
    assert.deepEqual(collectDoorCells(view, found), []);
    assert.equal(found.stats.doors_total, 0);
  });

  it("un volume que no es building cutaway no aporta vanos", () => {
    const view = vista(["gg"], {
      scene: {
        volumes: [
          { id: "torre", type: "tower", cutaway: true, rect: [0, 0, 4, 4], doors: [{ edge: "n", at: 1 }] },
          { id: "casa", type: "building", rect: [0, 0, 4, 4], doors: [{ edge: "n", at: 1 }] },
          { id: "roto", type: "building", cutaway: true, rect: [0, 0, 4, 4], doors: [{ edge: "n" }] },
        ],
      },
    });
    const found = hallazgos(view);
    assert.deepEqual(collectDoorCells(view, found), []);
    assert.equal(found.stats.doors_total, 0);
  });
});

describe("reportPlanBudget", () => {
  it("mide lo DECLARADO y cuenta las alturas distintas de los buildings", () => {
    const volumes = [
      { id: "a", type: "building", wall_h: 5 },
      { id: "b", type: "building", wall_h: 8 },
      { id: "c", type: "building" },
      { id: "d", type: "tower", wall_h: 12 },
    ];
    const view = vista(["gg"], {
      raw: { volumes, ground: [{ id: "senda" }], scatter_zones: [{}, {}], vegetation_zones: [{}] },
      scene: { volumes },
    });
    const found = hallazgos(view);
    reportPlanBudget(view, found);
    assert.equal(found.stats.volumes_declared, 4);
    assert.equal(found.stats.ground_features, 1);
    assert.equal(found.stats.scatter_zones, 2);
    assert.equal(found.stats.vegetation_zones, 1);
    // 5 (declarado), 8 (declarado) y 5 (el default de "c", que colisiona con el primero).
    assert.equal(found.stats.distinct_building_heights, 2);
    assert.equal(found.stats.volumes_cap, 160, "el cap viaja al motor con la medida");
  });

  it("las alturas se agrupan de medio metro en medio metro", () => {
    // La medida existe para decirle al motor si su pueblo tiene silueta o es
    // una fila de cajas iguales; dos casas que se llevan 10 cm son la MISMA
    // altura a ojo del jugador, y así se cuentan.
    const medir = (alturas: number[]): number => {
      const volumes = alturas.map((wall_h, i) => ({ id: `v${i}`, type: "building", wall_h }));
      const view = vista(["gg"], { raw: { volumes }, scene: { volumes } });
      const found = hallazgos(view);
      reportPlanBudget(view, found);
      return found.stats.distinct_building_heights;
    };
    assert.equal(medir([5.1, 5.2]), 1, "10 cm de diferencia es la misma altura a ojo");
    assert.equal(medir([1, 2]), 2, "un metro no lo es");
    assert.equal(medir([5.1, 5.2, 8]), 2);
  });

  it("un volume nulo o con altura absurda no rompe la medida", () => {
    const volumes = [
      null,
      { id: "a", type: "building", wall_h: Number.POSITIVE_INFINITY },
      { id: "b", type: "building", wall_h: 5 },
    ];
    const view = vista(["gg"], { raw: { volumes }, scene: { volumes } });
    const found = hallazgos(view);
    reportPlanBudget(view, found);
    assert.equal(found.stats.volumes_declared, 3, "declarados son los que declaró");
    assert.equal(found.stats.distinct_building_heights, 1, "la altura imposible cae al default de 5 m");
  });

  it("un plan vacío mide cero y no revienta", () => {
    const view = vista(["gg"]);
    const found = hallazgos(view);
    reportPlanBudget(view, found);
    assert.equal(found.stats.volumes_declared, 0);
    assert.equal(found.stats.distinct_building_heights, 0);
  });
});

describe("floodFill", () => {
  // Seis filas escritas a mano: dos salas separadas por un muro, la de la
  // derecha con un vano. Esto es lo que ANTES exigía un tile de 128×128.
  const MAPA = [
    "gggWggg",
    "gggWggg",
    "ggggggg",
    "gggWggg",
    "gggWggg",
    "gggWggg",
  ];

  it("solo alcanza lo conectado por celdas pisables", () => {
    const { view, map } = mapaDe(MAPA);
    const reach = floodFill(view, map, [[0, 0]]);
    assert.equal(reach.has([6, 0]), true, "se rodea por el vano de la fila 2");
    assert.equal(reach.has([3, 0]), false, "el muro no");
    assert.equal(reach.count, map.walkableCells);
  });

  it("con el vano tapiado quedan dos mitades", () => {
    const { view, map } = mapaDe(MAPA.map((f, r) => (r === 2 ? "gggWggg" : f)));
    const reach = floodFill(view, map, [[0, 0]]);
    assert.equal(reach.has([6, 0]), false, "ya no hay paso");
    assert.equal(reach.count, 18, "solo la mitad izquierda");
  });

  it("varias semillas siembran a la vez y no se cuentan dos veces", () => {
    const { view, map } = mapaDe(MAPA.map((f, r) => (r === 2 ? "gggWggg" : f)));
    const reach = floodFill(view, map, [[0, 0], [6, 0], [0, 0]]);
    assert.equal(reach.count, 36, "las dos mitades enteras");
  });

  it("no se envuelve por el borde: la última columna no toca la primera de la fila siguiente", () => {
    // Mismo peligro que en la máscara, del otro lado: sobre un grid plano,
    // [cols, r] y [0, r+1] son el mismo índice. Si el corte por columna se
    // cae, el flood atraviesa el mapa entero por los lados y todo sale
    // «alcanzable» — el fallo más caro posible en un validador de
    // alcanzabilidad, porque aprueba mapas injugables en silencio.
    const { view, map } = mapaDe(["Wgg", "gWW"]);
    const reach = floodFill(view, map, [[2, 0]]);
    assert.equal(reach.count, 2, "solo las dos celdas del tramo de arriba");
    assert.equal(reach.has([0, 1]), false, "la esquina de abajo queda aislada");
  });

  it("fuera del grid nunca está alcanzado", () => {
    const { view, map } = mapaDe(MAPA);
    const reach = floodFill(view, map, [[0, 0]]);
    for (const fuera of [[-1, 0], [0, -1], [7, 0], [0, 6]] as Cell[]) {
      assert.equal(reach.has(fuera), false, `[${fuera}]`);
    }
  });
});

describe("checkReachability", () => {
  const ABIERTO = ["ggggg", "ggggg", "ggggg"];

  it("sin cruces ni entrada avisa y no corre el flood", () => {
    const { view, map, found } = mapaDe(ABIERTO);
    checkReachability(view, map, { startCells: [], crossingTargets: [] }, [], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, []);
    assert.deepEqual(found.warnings, ["tile sin cruces de vecinos ni entrada conocida: alcanzabilidad no verificada"]);
    assert.equal(found.stats.reachable_cells, 0);
    assert.equal(found.stats.border_reachable, false);
  });

  it("con vecino enlazado y NADA que pisar es injugable", () => {
    const { view, map, found } = mapaDe(["~~~", "~~~"]);
    checkReachability(view, map, { startCells: [], crossingTargets: [] }, [], {
      required_crossings: [], entry: { edge: "west", at: 1 },
    }, found);
    assert.deepEqual(found.errors, ["tile sin terreno transitable: el jugador no podría moverse dentro (injugable)"]);
  });

  it("hay dónde pisar pero ningún arranque cae ahí: se avisa en vez de aprobar en silencio", () => {
    const { view, map, found } = mapaDe(ABIERTO);
    checkReachability(view, map, { startCells: [], crossingTargets: [] }, [], {
      required_crossings: [], entry: { edge: "west", at: 1 },
    }, found);
    assert.deepEqual(found.errors, []);
    assert.deepEqual(found.warnings, ["la entrada del tile no cae en terreno transitable: alcanzabilidad no verificada"]);
  });

  it("un arranque SÓLIDO se descarta como si no estuviera", () => {
    // Estado que el pipeline entero no alcanza hoy (las tres fuentes de
    // arranque ya filtran por transitable), pero que la pasada tiene que
    // sostener sola: es lo único que separa «no se verificó» de un flood
    // que arranca dentro de una roca.
    const { view, map, found } = mapaDe(["gWg"]);
    checkReachability(view, map, { startCells: [[1, 0]], crossingTargets: [] }, [], {
      required_crossings: [], entry: { edge: "west", at: 0 },
    }, found);
    assert.deepEqual(found.warnings, ["la entrada del tile no cae en terreno transitable: alcanzabilidad no verificada"]);
    assert.equal(found.stats.reachable_cells, 0, "el flood no llegó a correr");
  });

  it("un cruce al otro lado de un muro es error, y lo dice con su nombre", () => {
    const { view, map, found } = mapaDe(["gWg", "gWg"]);
    checkReachability(view, map, {
      startCells: [[0, 0]],
      crossingTargets: [{ cell: [2, 0], label: "cruce path del borde east (celda 0)" }],
    }, [], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, ["el cruce path del borde east (celda 0) no es alcanzable desde la entrada del tile"]);
    assert.equal(found.stats.border_reachable, false);
  });

  it("ninguna puerta alcanzable es error; algunas, aviso", () => {
    const { view, map, found } = mapaDe(["gWg", "gWg"]);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [[2, 0], [2, 1]], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, ["ninguna puerta de las structures es alcanzable desde el player"]);
    assert.equal(found.stats.doors_total, 0, "contarlas es de la pasada de puertas, no de esta");

    const b = mapaDe(["gWg", "gWg"]);
    checkReachability(b.view, b.map, { startCells: [[0, 0]], crossingTargets: [] }, [[0, 1], [2, 1]], { required_crossings: [] }, b.found);
    assert.deepEqual(b.found.errors, []);
    assert.deepEqual(b.found.warnings, ["1 celda(s) de puerta no alcanzables desde el player"]);
    assert.equal(b.found.stats.doors_reachable, 1);
  });

  it("un NPC vale con que se le llegue AL LADO", () => {
    const { view, map, found } = mapaDe(["ggWg", "ggWg"], {
      entities: [
        { id: "herrero", kind: "npc", cell: [1, 1] },
        { id: "ermitaño", kind: "npc", cell: [3, 0] },
      ],
    });
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], { required_crossings: [] }, found);
    assert.equal(found.stats.npcs_reachable, 1);
    assert.deepEqual(found.warnings, ['el NPC "ermitaño" en [3, 0] no es alcanzable desde el player']);
  });

  it("por debajo del 20% pisable, avisa de que el mapa es casi todo muro", () => {
    const { view, map, found } = mapaDe(["gWWWW", "WWWWW", "WWWWW", "WWWWW"]);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], { required_crossings: [] }, found);
    assert.deepEqual(found.warnings, ["solo el 5% del mapa es transitable — ¿demasiado muro/agua?"]);
  });

  it("justo en el 20% NO avisa (el umbral es estricto)", () => {
    const { view, map, found } = mapaDe(["ggWWW", "WWWWW"]);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], { required_crossings: [] }, found);
    assert.deepEqual(found.warnings, []);
  });
});
