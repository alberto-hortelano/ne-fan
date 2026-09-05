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
  checkNpcBodies,
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
import { BODY_RADIUS_M, celdasLibresParaRadio } from "../src/scene/terrain-collision.js";
import { TILE_MPC } from "../src/scene/tile.js";

/** Tile de mentira desde un grid ASCII con el alfabeto del engine: "w" agua
 *  (el único sólido del grid: los muros son volúmenes del plan), lo demás
 *  pisable. */
function vista(filas: string[], over: Partial<TileView> = {}): TileView {
  return {
    cols: filas[0].length,
    rows: filas.length,
    grid: filas,
    raw: {},
    scene: {},
    solid: new Set(["w"]),
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
const SIN_PLAN: PlanMask = { solid: () => false, volumes: 0, blockerAt: () => null };

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

  it("un grid que no es 128×128 con la marca `__expanded` se rechaza nombrando la fila", () => {
    // Aquí vivía el normalizador tolerante (rellenar cortas, recortar largas):
    // esa tolerancia era saneo mudo con cero cobertura real, y las escenas que
    // la necesitaban reventaban igual en `computeTileEdges` como 500 (#195).
    // Ahora la marca no exime del contrato: se rechaza con el defecto exacto.
    const terrain: unknown[] = Array.from({ length: 128 }, (_, r) => (r === 3 ? "gg" : "g".repeat(128)));
    const r = openTile({ tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.rejected.errors[0], /terrain\[3\] tiene 2 chars/);
    assert.match(r.rejected.errors[0], /quita `__expanded`/, "el mensaje trae la salida, no solo el defecto");
  });

  it("las filas de sobra tampoco se recortan: se rechaza con el número de filas", () => {
    const terrain = Array.from({ length: 130 }, () => "g".repeat(128));
    const r = openTile({ tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.rejected.errors[0], /terrain tiene 130 filas/);
  });

  it("el grid de la vista es la MISMA referencia que scene.terrain: no hay doble grid", () => {
    // `computeTileEdges` lee `scene.terrain` y las pasadas leen `view.grid`;
    // si volvieran a ser dos objetos, podrían divergir en silencio.
    const terrain = Array.from({ length: 128 }, () => "g".repeat(128));
    const r = openTile({ tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.view.grid, r.view.scene.terrain, "misma referencia, no una copia");
  });

  it("abre un tile ya expandido con los sólidos que fija el engine", () => {
    // La escena no puede añadir ni quitar solidez: la vista lleva exactamente
    // `DEFAULT_SOLID_CHARS`, venga el tile con lo que venga.
    const terrain = Array.from({ length: 128 }, () => "g".repeat(128));
    const r = openTile({ tile: { tx: 0, ty: 0 }, biome: "meadow", __expanded: true, terrain, entities: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.view.cols, 128);
    assert.deepEqual([...r.view.solid].sort(), ["w"]);
  });
});

describe("buildWalkableMap", () => {
  it("el terreno sólido no se pisa y el resto sí", () => {
    const { map, found } = mapaDe(["gwg", "gwg"]);
    assert.equal(map.walkableCells, 4);
    assert.equal(found.stats.walkable_cells, 4);
    assert.equal(map.isWalkable([1, 0]), false, "el agua");
    assert.equal(map.isWalkable([1, 1]), false, "en cualquier fila");
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
    const tapa = (c: number, r: number) => r === 0 && c >= 3;
    const plan: PlanMask = {
      solid: tapa,
      volumes: 1,
      blockerAt: (c, r) => (tapa(c, r) ? { volumeId: "tapia" } : null),
    };
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
    assert.deepEqual(map.player, { id: "player", cell: [2, 0], declarada: [2, 0] });
    assert.deepEqual(map.npcs, [{ id: "herrero", cell: [1, 0], declarada: [1, 0] }]);
    assert.equal(found.stats.npcs_total, 1);
    assert.equal(map.walkableCells, 3, "ni player ni NPC bloquean");
  });

  it("la celda se NORMALIZA aquí: `declarada` es lo que dijo el motor, `cell` dónde está de pie", () => {
    // El zod admite fracción a propósito («media celda importa en el
    // z-order»), así que `cell:[1.5, 0.5]` es legítimo. Usarla como índice
    // daba `undefined` en la máscara, y en `checkPlayerSpawn` un THROW al
    // leer `grid[r][c]` — en vez del error estructurado que el motor necesita.
    const { map } = mapaDe(["ggg", "ggg"], {
      entities: [
        { id: "player", kind: "player", cell: [1.5, 0.5] },
        { id: "herrero", kind: "npc", cell: [2.9, 1.9] },
      ],
    });
    assert.deepEqual(map.player, { id: "player", cell: [1, 0], declarada: [1.5, 0.5] });
    assert.deepEqual(map.npcs[0].cell, [2, 1]);
    assert.equal(map.isWalkable(map.player!.cell), true, "y la celda normalizada SÍ indexa la máscara");
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
        entities: [{ id: "granero", kind: "building", name: "granero", cell: [40, 40], footprint: [6, 4] }],
      }),
    );
    assert.equal(mask.solid(42, 41), true, "dentro de la huella");
    assert.equal(mask.solid(60, 60), false, "lejos, no");
  });

  it("un item no es geometría: no bloquea", () => {
    const { mask } = abrir(
      tileConPlan({
        ground: [{ id: "senda", kind: "path", points: [[0, 64], [128, 64]], w: 4, material: "dirt" }],
        entities: [{ id: "moneda", kind: "item", name: "moneda", cell: [40, 40], footprint: [2, 2] }],
      }),
    );
    assert.equal(mask.solid(40, 40), false);
  });

  it("blockerAt atribuye la celda bloqueada a SU volumen, al agua del plan, o a nadie", () => {
    // La atribución de #337: la máscara compuesta no guardaba procedencia
    // celda→volumen, así que el error de spawn nombraba causas inventadas.
    const { mask } = abrir(
      tileConPlan({
        ground: [{ id: "rio", kind: "water", rect: [0, 100, 128, 8] }],
        volumes: [{ id: "posada", label: "posada", type: "building", rect: [40, 40, 8, 6] }],
        entities: [{ id: "mesa", kind: "prop", name: "mesa", cell: [80, 80], footprint: [2, 2] }],
      }),
    );
    assert.deepEqual(mask.blockerAt(42, 42), { volumeId: "posada" }, "celda dentro del volumen declarado");
    // El derivado se nombra con SU id del plan compuesto (`derived_ent_<id>`,
    // blueprint/derive.ts): es el volumen que existe de verdad en el plan que
    // pinta el cliente, y el prefijo dice de qué entity sale.
    assert.deepEqual(mask.blockerAt(80, 80), { volumeId: "derived_ent_mesa" }, "el volumen DERIVADO de una entity también se nombra");
    assert.equal(mask.blockerAt(64, 103), "ground", "el agua del plan no tiene volumen: es el ground");
    assert.equal(mask.blockerAt(5, 5), null, "una celda libre no tiene culpable");
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
  const grid = ["ggg", "gwg"];

  it("fuera de bootstrap sobra, y no siembra el flood", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [0, 0] }] });
    assert.equal(checkPlayerSpawn(view, map, SIN_PLAN, { required_crossings: [] }, found), null);
    assert.match(found.errors[0], /no llevan entity kind "player"/);
  });

  it("en bootstrap es obligatorio", () => {
    const { view, map, found } = mapaDe(grid);
    assert.equal(checkPlayerSpawn(view, map, SIN_PLAN, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, ['falta la entity kind "player" (spawn del jugador)']);
  });

  it("fuera del grid se rechaza antes de mirar el terreno, por los cuatro lados", () => {
    // Los cuatro desbordes por separado: cada uno tiene que dar el mensaje de
    // «fuera del grid» y no el de «no es transitable», que se leería como que
    // la celda existe y está ocupada — y el motor movería el spawn en vano.
    for (const cell of [[9, 9], [-1, 1], [1, -1], [3, 1], [1, 2]] as Cell[]) {
      const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell }] });
      assert.equal(checkPlayerSpawn(view, map, SIN_PLAN, { required_crossings: [], bootstrap: true }, found), null);
      assert.deepEqual(found.errors, [`el player está fuera del grid: [${cell[0]}, ${cell[1]}]`]);
    }
  });

  it("la esquina [0, 0] es un spawn legal como cualquier otro", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [0, 0] }] });
    assert.deepEqual(checkPlayerSpawn(view, map, SIN_PLAN, { required_crossings: [], bootstrap: true }, found), [0, 0]);
    assert.deepEqual(found.errors, []);
  });

  it("bloqueado por la masa de un volumen del plan, el error nombra SU id (#337)", () => {
    // El char de debajo es "g" (pisable): la causa es el plan, no el terreno.
    // Antes el mensaje culpaba a la celda y a un «footprint» que ya no
    // estampa nadie — el motor movía el spawn a ciegas.
    const plan: PlanMask = {
      solid: (c, r) => c === 2 && r === 1,
      volumes: 1,
      blockerAt: (c, r) => (c === 2 && r === 1 ? { volumeId: "posada" } : null),
    };
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [2, 1] }] }, plan);
    assert.equal(checkPlayerSpawn(view, map, plan, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, [
      'el spawn del player [2, 1] no es transitable: lo cubre la masa del volumen "posada" del plan — muévelo fuera o mueve el volumen',
    ]);
  });

  it("sobre terreno sólido se rechaza citando el char que pisa, a secas (QA #337)", () => {
    // Ningún char tiene nombre: el mensaje nombra el char tal cual y nada
    // más — no puede prometer un rótulo que ninguna escena declara.
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [1, 1] }] });
    assert.equal(checkPlayerSpawn(view, map, SIN_PLAN, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, [
      'el spawn del player [1, 1] no es transitable: la celda es "w", terreno sólido — muévelo a una celda pisable',
    ]);
  });

  it("bloqueado por un volumen DERIVADO de una entity, el consejo manda mover la entity (QA #337)", () => {
    // El motor declaró una entity `mesa`, no un volumen: «mueve el volumen»
    // le pedía tocar algo que no está en su escena. El prefijo derived_ent_
    // es la marca del derivador (blueprint/derive.ts) y de él sale el id real.
    const plan: PlanMask = {
      solid: (c, r) => c === 2 && r === 1,
      volumes: 1,
      blockerAt: (c, r) => (c === 2 && r === 1 ? { volumeId: "derived_ent_mesa" } : null),
    };
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [2, 1] }] }, plan);
    assert.equal(checkPlayerSpawn(view, map, plan, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, [
      'el spawn del player [2, 1] no es transitable: lo cubre la masa de la entity "mesa" ' +
        '(volumen derivado "derived_ent_mesa" del plan) — muévelo fuera o mueve la entity',
    ]);
  });

  it("bloqueado por el agua del ground del plan, el error lo dice sin inventar un volumen", () => {
    const plan: PlanMask = {
      solid: (c, r) => c === 2 && r === 1,
      volumes: 0,
      blockerAt: (c, r) => (c === 2 && r === 1 ? "ground" : null),
    };
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [2, 1] }] }, plan);
    assert.equal(checkPlayerSpawn(view, map, plan, { required_crossings: [], bootstrap: true }, found), null);
    assert.deepEqual(found.errors, [
      "el spawn del player [2, 1] no es transitable: lo cubre el agua del ground del plan — muévelo a tierra firme",
    ]);
  });

  it("un spawn válido vuelve como semilla del flood", () => {
    const { view, map, found } = mapaDe(grid, { entities: [{ id: "p", kind: "player", cell: [2, 1] }] });
    assert.deepEqual(checkPlayerSpawn(view, map, SIN_PLAN, { required_crossings: [], bootstrap: true }, found), [2, 1]);
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
    const { view, map, found } = mapaDe(["wg", "wg"]);
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
    const { view, map, found } = mapaDe(["wg", "gg"]);
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
    const { view, map, found } = mapaDe(["wg", "wg"]);
    const edges: TileEdges = { ...SIN_CRUCES, west: { biome: "grass", crossings: [{ type: "river", at: 1, width: 2 }] } };
    const seams = checkSeams(view, map, edges, { required_crossings: [], entry: { edge: "west", at: 1 } }, null, found);
    assert.deepEqual(seams.startCells, []);
  });
});

describe("collectDoorCells", () => {
  /** La geometría de los vanos, aplanada: el AGRUPADO por vano tiene su
   *  propio caso abajo (es lo que consume el veredicto, no el orden). */
  const celdasDe = (vanos: ReturnType<typeof collectDoorCells>): Cell[] => vanos.flatMap((v) => v.cells);

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
    const found = hallazgos(view);
    assert.deepEqual(celdasDe(collectDoorCells(view, found)), [[12, 20], [12, 25], [10, 21], [17, 21]]);
    assert.equal(found.stats.doors_total, 4);
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
    assert.deepEqual(celdasDe(collectDoorCells(view, hallazgos(view))), [
      [12, 20], [13, 20], [12, 25], [13, 25], [10, 21], [10, 22], [17, 21], [17, 22],
    ]);
  });

  it("lo que no tiene forma de vano se salta sin reventar y sin inventarse celdas", () => {
    const view = vista(["gg"], {
      scene: {
        volumes: [
          { id: "a", type: "building", cutaway: true, rect: [0, 0, 4], doors: [{ edge: "n", at: 1 }] },   // rect de 3
          { id: "b", type: "building", cutaway: true, rect: [0, 0, 4, 4], doors: [null, { edge: "n" }] }, // puerta sin `at`
          { id: "c", type: "building", cutaway: true, rect: [0, 0, 4, 4], doors: [{ edge: "arriba", at: 1 }] },
        ],
      },
    });
    const found = hallazgos(view);
    assert.deepEqual(celdasDe(collectDoorCells(view, found)), []);
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
    assert.deepEqual(celdasDe(collectDoorCells(view, found)), []);
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
  // Seis filas escritas a mano: dos orillas separadas por un canal, la de la
  // derecha con un vano. Esto es lo que ANTES exigía un tile de 128×128.
  const MAPA = [
    "gggwggg",
    "gggwggg",
    "ggggggg",
    "gggwggg",
    "gggwggg",
    "gggwggg",
  ];

  it("solo alcanza lo conectado por celdas pisables", () => {
    const { view, map } = mapaDe(MAPA);
    const reach = floodFill(view, map, [[0, 0]], 1);
    assert.equal(reach.has([6, 0]), true, "se rodea por el vano de la fila 2");
    assert.equal(reach.has([3, 0]), false, "el agua no");
    assert.equal(reach.count, map.walkableCells);
  });

  it("con el vano tapiado quedan dos mitades", () => {
    const { view, map } = mapaDe(MAPA.map((f, r) => (r === 2 ? "gggwggg" : f)));
    const reach = floodFill(view, map, [[0, 0]], 1);
    assert.equal(reach.has([6, 0]), false, "ya no hay paso");
    assert.equal(reach.count, 18, "solo la mitad izquierda");
  });

  it("varias semillas siembran a la vez y no se cuentan dos veces", () => {
    const { view, map } = mapaDe(MAPA.map((f, r) => (r === 2 ? "gggwggg" : f)));
    const reach = floodFill(view, map, [[0, 0], [6, 0], [0, 0]], 1);
    assert.equal(reach.count, 36, "las dos mitades enteras");
  });

  it("no se envuelve por el borde: la última columna no toca la primera de la fila siguiente", () => {
    // Mismo peligro que en la máscara, del otro lado: sobre un grid plano,
    // [cols, r] y [0, r+1] son el mismo índice. Si el corte por columna se
    // cae, el flood atraviesa el mapa entero por los lados y todo sale
    // «alcanzable» — el fallo más caro posible en un validador de
    // alcanzabilidad, porque aprueba mapas injugables en silencio.
    const { view, map } = mapaDe(["wgg", "gww"]);
    const reach = floodFill(view, map, [[2, 0]], 1);
    assert.equal(reach.count, 2, "solo las dos celdas del tramo de arriba");
    assert.equal(reach.has([0, 1]), false, "la esquina de abajo queda aislada");
  });

  it("fuera del grid nunca está alcanzado", () => {
    const { view, map } = mapaDe(MAPA);
    const reach = floodFill(view, map, [[0, 0]], 1);
    for (const fuera of [[-1, 0], [0, -1], [7, 0], [0, 6]] as Cell[]) {
      assert.equal(reach.has(fuera), false, `[${fuera}]`);
    }
  });

  it("una semilla que no es pisable no siembra nada", () => {
    // Antes se marcaba alcanzada por decreto (sin mirar la máscara). Con
    // cuerpo la pregunta es si CABE ahí, y un flood que arranca dentro de una
    // roca aprueba el mapa entero desde una posición imposible.
    const { view, map } = mapaDe(MAPA);
    assert.equal(floodFill(view, map, [[3, 0]], 1).count, 0, "el agua no siembra");
  });
});

/** LA TRAMPA DE #289, en el algoritmo. Un corredor de 2 celdas mide 1,00 m:
 *  lo cruza el jugador (radio 0,4) y NUNCA un NPC (0,5), porque el AABB de
 *  `blocksCircle` se recorre con floor() INCLUSIVE y hace falta `n·mpc > 2R`.
 *
 *  Si la erosión se escribe con el AABB (`2R/mpc` = 2 celdas) en vez de con
 *  `floor(2R/mpc)+1` (3), el candado NACE VERDE sobre el caso que dice
 *  impedir. Por eso el `k=2` de aquí abajo no es redundante: es el criterio
 *  que más pesa de la tanda, y su aserto es que k=2 PASA. */
describe("floodFill con cuerpo · la puerta de 1 m", () => {
  /** Dos orillas de 3 columnas separadas por un canal de 3 celdas de ancho
   *  (cols 3-5) con un VANO de `hueco` filas. `hueco` es exactamente lo que
   *  mide la puerta: 2 celdas = 1,00 m, 3 = 1,50 m. Grid 9×9 en los dos
   *  casos, para que el destino sea la misma celda. */
  const conVano = (hueco: number): string[] => {
    const desde = Math.floor((9 - hueco) / 2);
    return Array.from({ length: 9 }, (_, r) =>
      "ggg" + (r >= desde && r < desde + hueco ? "ggg" : "www") + "ggg");
  };
  const IZQ: Cell = [0, 4];
  const DER: Cell = [8, 4];

  /** La tabla del issue, de una vez: (vano, k) → ¿lo cruza el cuerpo?
   *
   *  La fila que decide la tanda es `k=2` sobre el vano de 1 m. Con la
   *  erosión escrita como el AABB (`2R/mpc` = 2 celdas) el candado NACE VERDE
   *  sobre el caso que dice impedir, porque el corredor de puerta contiene un
   *  bloque 2×2 libre. Por eso la fila `k=2 → cruza` no es redundante: es el
   *  aserto que más pesa de la tanda, y el que se pondría rojo si alguien
   *  escribe `ceil` o reusa la constante del productor.
   *
   *  (Que el COLLIDER real diga lo mismo sobre este vano vive donde vive
   *  `blocksCircle`: `terrain-collision.test.ts`.) */
  const TABLA: Array<[hueco: number, k: number, cruza: boolean, por: string]> = [
    [2, 1, true, "el flood de siempre (un punto sin dimensión) lo aprobaba"],
    [2, 2, true, "EL AABB TAMBIÉN: aquí es donde el candado nacería verde"],
    [2, 3, false, "floor(2R/mpc)+1 es el único que ve el vano de 1,00 m"],
    [3, 3, true, "y a 1,50 m el cuerpo pasa: el candado no rechaza de más"],
  ];
  for (const [hueco, k, cruza, por] of TABLA) {
    const metros = (hueco * TILE_MPC).toFixed(2).replace(".", ",");
    it(`vano de ${hueco} celdas (${metros} m) con k=${k}: ${cruza ? "CRUZA" : "no cruza"} — ${por}`, () => {
      const { view, map } = mapaDe(conVano(hueco));
      assert.equal(floodFill(view, map, [IZQ], k).has(DER), cruza);
    });
  }

  it("y el `k` que usa el validador sale del cuerpo mayor: 3 celdas, no el AABB", () => {
    assert.equal(celdasLibresParaRadio(BODY_RADIUS_M, TILE_MPC), 3);
  });

  it("el cuerpo que no cabe en el grid entero no alcanza nada (no revienta)", () => {
    const { view, map } = mapaDe(["ggg", "ggg"]);
    assert.equal(floodFill(view, map, [[0, 0]], 3).count, 0, "3 celdas no caben en 2 filas");
    assert.equal(floodFill(view, map, [[0, 0]], 3).has([0, 0]), false);
  });

  it("k=1 es EXACTAMENTE el flood de siempre, así que no hay dos algoritmos", () => {
    const { view, map } = mapaDe(conVano(2));
    assert.equal(floodFill(view, map, [IZQ], 1).count, map.walkableCells, "sin cuerpo, alcanzable = pisable y conectado");
  });
});

describe("checkReachability", () => {
  const ABIERTO = ["ggggg", "ggggg", "ggggg"];

  it("sin cruces ni entrada avisa y no corre el flood", () => {
    const { view, map, found } = mapaDe(ABIERTO);
    checkReachability(view, map, { startCells: [], crossingTargets: [] }, [], [], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, []);
    assert.deepEqual(found.warnings, ["tile sin cruces de vecinos ni entrada conocida: alcanzabilidad no verificada"]);
    assert.equal(found.stats.reachable_cells, 0);
    assert.equal(found.stats.border_reachable, false);
  });

  it("con vecino enlazado y NADA que pisar es injugable", () => {
    const { view, map, found } = mapaDe(["www", "www"]);
    checkReachability(view, map, { startCells: [], crossingTargets: [] }, [], [], {
      required_crossings: [], entry: { edge: "west", at: 1 },
    }, found);
    assert.deepEqual(found.errors, ["tile sin terreno transitable: el jugador no podría moverse dentro (injugable)"]);
  });

  it("hay dónde pisar pero ningún arranque cae ahí: se avisa en vez de aprobar en silencio", () => {
    const { view, map, found } = mapaDe(ABIERTO);
    checkReachability(view, map, { startCells: [], crossingTargets: [] }, [], [], {
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
    const { view, map, found } = mapaDe(["gwg"]);
    checkReachability(view, map, { startCells: [[1, 0]], crossingTargets: [] }, [], [], {
      required_crossings: [], entry: { edge: "west", at: 0 },
    }, found);
    assert.deepEqual(found.warnings, ["la entrada del tile no cae en terreno transitable: alcanzabilidad no verificada"]);
    assert.equal(found.stats.reachable_cells, 0, "el flood no llegó a correr");
  });

  /** Dos mitades de 3 columnas separadas por un río: la mínima que admite el
   *  cuerpo mayor a los dos lados (3 celdas = 1,5 m). Los grids de 2-3
   *  columnas de antes cabían para un punto sin dimensión y para nadie más. */
  const PARTIDO = ["gggwggg", "gggwggg", "gggwggg", "gggwggg", "gggwggg"];

  it("un cruce al otro lado del río es error, y lo dice con su nombre", () => {
    const { view, map, found } = mapaDe(PARTIDO);
    checkReachability(view, map, {
      startCells: [[0, 0]],
      crossingTargets: [{ cell: [6, 0], label: "cruce path del borde east (celda 0)" }],
    }, [], [], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, ["el cruce path del borde east (celda 0) no es alcanzable desde la entrada del tile"]);
    assert.equal(found.stats.border_reachable, false);
  });

  /** Un VANO con las celdas que ocupa, que es la unidad del veredicto. */
  const vano = (label: string, ...cells: Cell[]) => ({ label, cells });

  it("un vano que el cuerpo no cruza es ERROR y lo NOMBRA; una celda suelta sigue siendo aviso", () => {
    // La severidad la decide la clase, no quién la encuentra: «el hueco no
    // admite el cuerpo» es error lo descubra un NPC o una puerta. Antes esto
    // era aviso, y los avisos no rechazan: un prop delante de una puerta
    // dejaba pasar la escena entera.
    const { view, map, found } = mapaDe(PARTIDO);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] },
      [vano("puerta este", [5, 0], [5, 1])], [], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, [
      "el vano de la puerta este no lo cruza un cuerpo: ninguna de sus 2 celda(s) es alcanzable desde " +
        "la entrada del tile (¿lo tapa un volumen, o es más estrecho que un NPC?)",
    ]);
    assert.deepEqual(found.warnings, [], "no se dice DOS veces lo mismo: el vano entero ya se dijo");

    // Un vano al que le sobra alguna celda sin cubrir es aviso, no error: en
    // el corpus eso viene de declarar el MISMO edificio por los dos caminos
    // con anchos distintos (`alta_fantasia`), no de que el hueco sea estrecho.
    const b = mapaDe(PARTIDO);
    checkReachability(b.view, b.map, { startCells: [[0, 0]], crossingTargets: [] },
      [vano("puerta oeste", [1, 1], [5, 1])], [], { required_crossings: [] }, b.found);
    assert.deepEqual(b.found.errors, []);
    assert.deepEqual(b.found.warnings, ["1 celda(s) de puerta no alcanzables desde el player"]);
    assert.equal(b.found.stats.doors_reachable, 1);
  });

  /** Sala abierta de 5×6, un NICHO de una celda al que el cuerpo no entra
   *  ([5,5]) y un tramo aislado de 3 columnas al este, donde el cuerpo SÍ
   *  cabe pero no se llega. Los dos defectos son error y llevan mensajes
   *  distintos porque son arreglos distintos: ensanchar vs. abrir un paso. */
  const CON_NICHO = [
    "gggggwwggg",
    "gggggwwggg",
    "gggggwwggg",
    "gggggwwggg",
    "gggggwwggg",
    "ggggggwggg",
  ];

  it("un NPC en un NICHO de una celda es ERROR aunque se le llegue al lado", () => {
    // EL AGUJERO QUE ESTA TANDA EXISTÍA PARA CERRAR. Hasta la revisión, el
    // predicado era `isWalkable` —el punto sin dimensión— con ±1 celda de
    // tolerancia encima: el herrero daba pisable, daba vecina alcanzable y
    // PASABA, aunque su cuerpo no cupiera ahí y no pudiera moverse jamás. Es
    // el caso literal de la crítica (dos props a 1,2 m) y es el bug que costó
    // #247, #262 y #284.
    const { view, map, found } = mapaDe(CON_NICHO, {
      entities: [
        { id: "herrero", kind: "npc", cell: [5, 5] },
        { id: "ermitaño", kind: "npc", cell: [8, 0] },
      ],
    });
    assert.equal(map.isWalkable([5, 5]), true, "el nicho es PISABLE: por eso colaba");
    assert.equal(map.isWalkable([4, 5]), true, "y tiene vecina libre y alcanzable");
    const sanos = checkNpcBodies(view, map, found);
    assert.deepEqual(sanos.map((n) => n.id), ["ermitaño"], "el del nicho no llega a juzgarse por alcanzabilidad");
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], sanos, { required_crossings: [] }, found);
    assert.equal(found.stats.npcs_reachable, 0);
    assert.deepEqual(found.warnings, [], "un NPC que no puede moverse no es «jugable, pero revísalo»");
    assert.deepEqual(found.errors, [
      'el NPC "herrero" nace en [5, 5], un hueco donde su cuerpo no cabe: hacen falta 3 celdas libres ' +
        "seguidas en cada eje y ahí no las hay, así que no podría moverse",
      'el NPC "ermitaño" en [8, 0] no es alcanzable desde el player',
    ]);
  });

  it("…y el mismo NPC en sitio con hueco para su cuerpo pasa (el candado no rechaza de más)", () => {
    const { view, map, found } = mapaDe(CON_NICHO, {
      entities: [{ id: "herrero", kind: "npc", cell: [2, 2] }],
    });
    const sanos = checkNpcBodies(view, map, found);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], sanos, { required_crossings: [] }, found);
    assert.deepEqual(found.errors, []);
    assert.equal(found.stats.npcs_reachable, 1);
  });

  it("un NPC que nace en celda SÓLIDA es error aunque tenga vecina libre", () => {
    // El residuo de #262 que ya ocurrió: el tabernero empotrado en el prop
    // `mostrador` daba «ok:true · npcs 1/1» porque bastaba una vecina
    // transitable. Él no podía salir de ahí, y su parálisis se leyó durante
    // semanas como ambiente.
    const { view, map, found } = mapaDe(CON_NICHO, {
      entities: [{ id: "tabernero", kind: "npc", cell: [5, 0] }],
    });
    assert.equal(map.isWalkable([4, 0]), true, "la vecina oeste SÍ es transitable");
    assert.deepEqual(checkNpcBodies(view, map, found), [], "no pasa el chequeo local");
    assert.deepEqual(found.errors, [
      'el NPC "tabernero" nace en [5, 0], celda no transitable (muro, agua o huella de un volumen): no podría moverse de ahí',
    ]);
  });

  it("y el cuerpo se juzga SIN flood: no hay `return` temprano que lo salte", () => {
    // El agujero de la primera entrega: «¿cabe su cuerpo?» vivía detrás del
    // `return` de `checkReachability`, así que un tile sin costuras ni entrada
    // —el prefetch del anillo— no le miraba el cuerpo a nadie.
    const { view, map, found } = mapaDe(CON_NICHO, {
      entities: [{ id: "tabernero", kind: "npc", cell: [5, 0] }],
    });
    checkNpcBodies(view, map, found);
    assert.equal(found.errors.length, 1, "sin semillas, sin flood y sin `reach`: el cuerpo se juzga igual");
  });

  it("una celda fraccionaria se lee donde el NPC está de pie, no como índice roto", () => {
    // El contrato la declara entera (`generate_scene.json`) pero el zod admite
    // fracción; un índice fraccionario daba `undefined` en la máscara, o sea
    // «inalcanzable» para un NPC plantado en mitad de un prado. Con severidad
    // de error eso rechazaría el tile entero por una mentira.
    const { view, map, found } = mapaDe(CON_NICHO, {
      entities: [{ id: "arbol_w", kind: "npc", cell: [2.5, 1] }],
    });
    const sanos = checkNpcBodies(view, map, found);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], sanos, { required_crossings: [] }, found);
    assert.deepEqual(found.errors, []);
    assert.equal(found.stats.npcs_reachable, 1);
  });

  it("por debajo del 20% pisable, avisa de que el mapa es casi todo agua", () => {
    // Se mide sobre lo PISABLE declarado, no sobre lo alcanzado: la pregunta
    // es de composición («¿te has pasado de muro y agua?»). El arranque lleva
    // hueco para un cuerpo a propósito, o el flood no correría y la medida no
    // llegaría a hacerse.
    const { view, map, found } = mapaDe([
      "gggwwwwwwwwwwwwwwwww",
      "gggwwwwwwwwwwwwwwwww",
      "gggwwwwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwwwwwwww",
    ]);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], [], { required_crossings: [] }, found);
    assert.deepEqual(found.warnings, ["solo el 11% del mapa es transitable — ¿demasiado muro/agua?"]);
  });

  it("justo en el 20% NO avisa (el umbral es estricto)", () => {
    const { view, map, found } = mapaDe(["gggww", "gggww", "gggww", "wwwww"]);
    checkReachability(view, map, { startCells: [[0, 0]], crossingTargets: [] }, [], [], { required_crossings: [] }, found);
    assert.deepEqual(found.warnings, []);
  });

  it("un arranque PISABLE donde no cabe un cuerpo nombra la causa y NO lista media escena", () => {
    // Sin esto el flood salía vacío y el informe era una avalancha —todos los
    // cruces, todos los NPCs— sin decir nunca por qué.
    const { view, map, found } = mapaDe(["wgw", "wgw", "wgw"], {
      entities: [{ id: "herrero", kind: "npc", cell: [1, 1] }],
    });
    checkReachability(view, map, {
      startCells: [[1, 0]],
      crossingTargets: [{ cell: [1, 2], label: "cruce path del borde south (celda 1)" }],
    }, [], [], { required_crossings: [] }, found);
    assert.deepEqual(found.errors, [
      "por la entrada del tile no cabe un cuerpo: hacen falta 3 celdas libres seguidas en cada eje y " +
        "ninguno de sus arranques las tiene, así que nada del tile es alcanzable",
    ]);
  });
});
