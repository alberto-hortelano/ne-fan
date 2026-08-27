import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildWalkableMap,
  composePlan,
  emptyFindings,
  floodFill,
  openTile,
  validateScene,
  type Cell,
  type TileValidationContext,
} from "../src/scene/scene-validate.js";
import { forestTile, CAMINO_OESTE_ESTE } from "./fixtures/tiles.js";

/** Tile de bootstrap jugable: el camino del fixture, una sala enterable con
 *  puerta al sur lejos de él, un NPC dentro y el jugador fuera. Format D
 *  tiene UNA variante desde que se retiraron la escena suelta (issue #172) y
 *  el plató proscenio, así que lo que estos tests comprueban —muros, puertas,
 *  chars sin declarar, spawn del jugador, alcanzabilidad— se mide sobre el
 *  tile, que es donde vive. El bootstrap es el único tile que lleva player. */
function makeScene(): Record<string, unknown> {
  return forestTile({
    scene_id: "claro_val",
    structures: [
      { type: "room", rect: [10, 70, 10, 7], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 4, width: 2 }] },
    ],
    entities: [
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [14, 73], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1], glyph: "@" },
    ],
  });
}

/** Contexto de bootstrap: sin costuras que continuar y con player obligatorio. */
const bootstrap: TileValidationContext = { required_crossings: [], bootstrap: true };

describe("validateScene", () => {
  it("acepta un tile jugable (puerta + npc alcanzables desde el spawn)", () => {
    const r = validateScene(makeScene(), bootstrap);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.stats.border_reachable, true);
    // width 2 pedida → auto-ensanchada a 3 celdas por el expander (mpc 0.5).
    assert.equal(r.stats.doors_total, 3);
    assert.equal(r.stats.doors_reachable, 3);
    assert.equal(r.stats.npcs_reachable, 1);
  });

  it("rechaza un player sobre un muro o sobre la huella de un prop", () => {
    const s1 = makeScene();
    (s1.entities as Record<string, unknown>[])[1].cell = [10, 70]; // esquina de muro
    const r1 = validateScene(s1, bootstrap);
    assert.ok(r1.errors.some((e) => e.includes("spawn del player")), r1.errors.join(" | "));

    const s2 = makeScene();
    (s2.entities as Record<string, unknown>[]).push({ id: "mesa", kind: "prop", name: "mesa", cell: [15, 80], footprint: [2, 2], glyph: "m" });
    const r2 = validateScene(s2, bootstrap);
    assert.ok(r2.errors.some((e) => e.includes("spawn del player")), r2.errors.join(" | "));
  });

  it("rechaza chars de terreno sin declarar en la leyenda", () => {
    const s = makeScene();
    // El char entra por la sala: floor_char sin entrada en terrain_legend.
    (s.structures as Record<string, unknown>[])[0].floor_char = "X";
    const r = validateScene(s, bootstrap);
    assert.ok(r.errors.some((e) => e.includes("sin declarar") && e.includes('"X"')), r.errors.join(" | "));
  });

  it("un NPC encerrado en una sala sin puertas es ERROR, no aviso", () => {
    // El «cuarto de 5×5» del issue #289, tal cual: su interior deja UNA celda
    // pisable (el anillo de muro del plan se come media celda por lado), así
    // que el NPC está de pie en sitio legal y no puede ir a ninguna parte.
    // Hasta esta tanda era un aviso, y los avisos no rechazan: el motor
    // entregaba la escena que encierra al NPC.
    const s = makeScene();
    (s.structures as Record<string, unknown>[]).push({ type: "room", rect: [40, 90, 5, 5], doors: [] });
    (s.entities as Record<string, unknown>[])[0].cell = [42, 92];
    const r = validateScene(s, bootstrap);
    assert.equal(r.ok, false, "una escena que encierra a un NPC no se entrega");
    assert.deepEqual(r.errors, ['el NPC "barkeep" en [42, 92] no es alcanzable desde el player']);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.stats.npcs_reachable, 0);
  });

  it("convierte una primitiva imposible en error legible (sin throw)", () => {
    const s = makeScene();
    (s.structures as Record<string, unknown>[])[0].rect = [124, 70, 10, 7];
    const r = validateScene(s, bootstrap);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("se sale del grid")), r.errors.join(" | "));
  });

  it("doors_total cuenta también las puertas de buildings cutaway en volumes", () => {
    // Regresión (playtest 2026-08-13): una posada declarada como volumes
    // cutaway CON doors reportaba doors_total: 0 (solo se contaban las
    // structures legacy) — telemetría engañosa para el motor.
    const s = makeScene();
    delete s.structures;
    s.volumes = [
      {
        id: "posada", label: "posada", type: "building",
        rect: [10, 70, 10, 7], cutaway: true,
        doors: [{ edge: "s", at: 4, w: 3 }],
      },
    ];
    const r = validateScene(s, bootstrap);
    assert.equal(r.stats.doors_total, 3, "las 3 celdas del vano cutaway cuentan");
    assert.equal(r.stats.doors_reachable, 3, "y son alcanzables desde el player");
  });
});

const makeTile = (ground?: Record<string, unknown>[]): Record<string, unknown> =>
  ground ? forestTile({ ground }) : forestTile();

const pathCrossing = (edge: "north" | "south" | "east" | "west", at: number) =>
  ({ edge, type: "path" as const, at, width: 2 });

describe("validateScene — tiles", () => {
  it("acepta un tile cuyas costuras continúan los cruces requeridos", () => {
    const ctx: TileValidationContext = {
      required_crossings: [pathCrossing("west", 41), pathCrossing("east", 52)],
    };
    const r = validateScene(makeTile(), ctx);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.stats.border_reachable, true, "todos los cruces conectados");
  });

  it("cruce requerido sin continuación → error con el borde y las celdas esperadas", () => {
    const ctx: TileValidationContext = {
      required_crossings: [{ edge: "north", type: "river", at: 30, width: 3 }],
    };
    const r = validateScene(makeTile(), ctx);
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some((e) => e.includes("borde north") && e.includes("28..32")),
      r.errors.join(" | "),
    );
  });

  it("cruce continuado pero NO alcanzable desde la entrada → error", () => {
    // El río vertical (pintado después) corta el camino por el medio: el
    // cruce este existe en el borde pero no se llega desde el oeste.
    const tile = makeTile([
      CAMINO_OESTE_ESTE,
      // El agua se rasteriza DESPUÉS del camino: corta la senda por la mitad.
      { id: "rio", kind: "water", rect: [58, 0, 4, 128] },
    ]);
    const ctx: TileValidationContext = {
      required_crossings: [pathCrossing("west", 41), pathCrossing("east", 52)],
      entry: { edge: "west", at: 41 },
    };
    const r = validateScene(tile, ctx);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("no es alcanzable")), r.errors.join(" | "));
  });

  it("acepta un río requerido continuado por río (no se exige llegar andando al agua)", () => {
    // Bug histórico: la continuación del río (celda de agua, sólida) entraba
    // como objetivo de alcanzabilidad y jamás era transitable → tile correcto
    // rechazado. Debe aceptarse: el camino da el arranque, el río solo se
    // valida como costura.
    const tile = makeTile([
      CAMINO_OESTE_ESTE,
      // Río corto que entra por el norte SIN cruzar el camino (acaba en fila 18).
      { id: "rio", kind: "water", rect: [28, 0, 4, 18] },
    ]);
    const ctx: TileValidationContext = {
      required_crossings: [
        pathCrossing("west", 41),
        pathCrossing("east", 52),
        { edge: "north", type: "river", at: 30, width: 4 },
      ],
      entry: { edge: "west", at: 41 },
    };
    const r = validateScene(tile, ctx);
    assert.deepEqual(r.errors, [], r.errors.join(" | "));
    assert.equal(r.ok, true);
  });

  it("entrada que casa con un río → avisa en vez de saltarse la validación en silencio", () => {
    // La entrada casa con un río: el único startCell caía en agua y el flood
    // no corría, aprobando el tile sin verificar nada. Ahora se avisa.
    const tile = makeTile([
      { id: "rio", kind: "water", rect: [0, 38, 128, 4] },
    ]);
    const ctx: TileValidationContext = {
      required_crossings: [
        { edge: "west", type: "river", at: 40, width: 4 },
        { edge: "east", type: "river", at: 40, width: 4 },
      ],
      entry: { edge: "west", at: 40 },
    };
    const r = validateScene(tile, ctx);
    assert.ok(
      r.warnings.some((w) => w.includes("no cae en terreno transitable")),
      `esperaba aviso de alcanzabilidad no verificada; warnings=${r.warnings.join(" | ")}`,
    );
  });

  it("player en un tile normal → error; en bootstrap es obligatorio", () => {
    const withPlayer = makeTile();
    (withPlayer.entities as Record<string, unknown>[]).push({
      id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1], glyph: "@",
    });
    const r1 = validateScene(withPlayer, { required_crossings: [] });
    assert.ok(r1.errors.some((e) => e.includes("no llevan entity")), r1.errors.join(" | "));

    const r2 = validateScene(makeTile(), { required_crossings: [], bootstrap: true });
    assert.ok(r2.errors.some((e) => e.includes('falta la entity kind "player"')), r2.errors.join(" | "));

    const r3 = validateScene(withPlayer, { required_crossings: [], bootstrap: true });
    assert.equal(r3.ok, true, r3.errors.join(" | "));
  });

  it("tile sin cruces ni entrada → aviso, no error (prefetch diagonal)", () => {
    const r = validateScene(makeTile([]), { required_crossings: [] });
    assert.equal(r.ok, true, r.errors.join(" | "));
    assert.ok(r.warnings.some((w) => w.includes("alcanzabilidad no verificada")));
  });

  it("un tile con place_id se valida igual: el plano continuo no exige links", () => {
    const tile = makeTile();
    tile.place_id = "claro_del_bosque";
    const r = validateScene(tile, { required_crossings: [pathCrossing("west", 41)] });
    assert.equal(r.ok, true, r.errors.join(" | "));
  });
});

describe("validateScene — telemetría del plan", () => {
  // ── Utilización de presupuestos: telemetría objetiva de vuelta al motor ────
  function makeTilePlan(): Record<string, unknown> {
    return {
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      scene_description: "Prado con dos casas.",
      biome: "meadow",
      entities: [],
      ground: [{ id: "senda", kind: "path", points: [[0, 64], [128, 64]], w: 4, material: "dirt" }],
      volumes: [
        { id: "casa_a", label: "casa", type: "building", rect: [20, 20, 10, 8], wall_h: 5 },
        { id: "casa_b", label: "casa", type: "building", rect: [40, 20, 10, 8], wall_h: 8 },
        { id: "torre", label: "torre", type: "tower", at: [70, 30] },
      ],
      vegetation_zones: [{ type: "pino", area: "rest", density: 0.01 }],
      scatter_generators: {
        guijarro: { parts: [{ shape: "box", size: [0.4, 0.3, 0.4] }] },
      },
      scatter_zones: [
        { kind: "guijarro", shape: { type: "rect", x0: 0, z0: 80, x1: 30, z1: 110 }, density: 0.1 },
      ],
    };
  }

  it("reporta la utilización de presupuestos del plan en stats", () => {
    const r = validateScene(makeTilePlan());
    assert.deepEqual(r.errors, [], r.errors.join(" | "));
    assert.equal(r.stats.volumes_declared, 3);
    assert.equal(r.stats.volumes_cap, 160);
    // Y lo que de verdad gasta el tile: 3 declarados + los 41 pinos que pide
    // la zona (4096 m² × 0,01/m²). El motor no puede componer el tile en su
    // cabeza, así que si no se le dice cuánto ocupa su bosque no puede
    // decidir si le queda presupuesto.
    assert.equal(r.stats.volumes_total, 44);
    assert.equal(r.stats.volumes_total_cap, 200);
    assert.equal(r.stats.ground_features, 1);
    assert.equal(r.stats.ground_cap, 64);
    assert.equal(r.stats.scatter_zones, 1);
    assert.equal(r.stats.vegetation_zones, 1);
    // Dos wall_h de building distintos (5 y 8); la torre no cuenta.
    assert.equal(r.stats.distinct_building_heights, 2);
  });

  it("rechaza vegetation_zones inválidas con error accionable (fail-loud del pre-flight)", () => {
    const s = makeTilePlan();
    s.vegetation_zones = [{ type: "pino", area: "rest", density: 2 }];
    const r = validateScene(s);
    assert.equal(r.ok, false);
    // El error le dice al motor la UNIDAD y el rango, no solo que está mal:
    // `density` cambió de significado en esta tanda y un "density inválida" a
    // secas le dejaría adivinando entre tres semánticas viejas.
    assert.ok(r.errors.some((e) => e.includes("EJEMPLARES POR m²")), r.errors.join(" | "));
  });
});

/** #289 · TODO HUECO ADMITE EL CUERPO MAYOR, sobre el tile de verdad.
 *
 *  El validador comprobaba la transitabilidad para un PUNTO sin dimensión.
 *  Un hueco de 2 celdas mide 1,00 m: lo cruza el jugador (radio 0,4) y NUNCA
 *  un NPC (0,5) — y desde #232 el bridge colisiona con esos muros, así que un
 *  NPC al otro lado queda encerrado para siempre.
 *
 *  El candado NO enumera productores. `doors[].w` y `gate.w` tienen suelo en
 *  el zod (fail-fast barato, `scene-schema.test.ts`), pero `prop`, `rock`,
 *  `tower`, `fountain`, `prism`, `custom` y `wall` estampan sólidos SIN
 *  ninguna regla de separación entre ellos: dos props a 1,2 m pinzan un paso
 *  exactamente igual que una puerta estrecha, y ninguna constante por
 *  productor los cubriría. Por eso el caso de aquí abajo —vano legal de 4
 *  celdas pinzado por dos barriles— es el que mide lo que compra la tanda. */
describe("validateScene — el hueco tiene que admitir el cuerpo mayor", () => {
  /** Posada CUTAWAY con puerta legal al sur (w:4 = 2 m) y dos barriles que la
   *  pinzan: libres las columnas de `libres`. Dentro, un NPC. */
  const conBarriles = (oesteFin: number, esteIni: number): Record<string, unknown> => ({
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    scene_description: "Una posada con dos barriles en la puerta.",
    biome: "meadow",
    volumes: [
      { id: "posada", label: "posada", type: "building", rect: [52, 48, 24, 16], cutaway: true, doors: [{ edge: "s", at: 11, w: 4 }] },
      { id: "barril_o", label: "barril", type: "prop", shape: "box", rect: [oesteFin - 2, 62, 2, 3] },
      { id: "barril_e", label: "barril", type: "prop", shape: "box", rect: [esteIni, 62, 2, 3] },
    ],
    entities: [
      { id: "posadero", kind: "npc", name: "Posadero", cell: [60, 55], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [64, 70], footprint: [1, 1], glyph: "@" },
    ],
  });

  it("dos props que dejan 1 m entre ellos encierran al NPC, y eso es ERROR", () => {
    const r = validateScene(conBarriles(63, 65), bootstrap);
    assert.equal(r.ok, false, "una escena que encierra a un NPC no es «jugable, pero revísala»");
    assert.deepEqual(r.errors, [
      "ninguna puerta de las structures es alcanzable desde el player",
      'el NPC "posadero" en [60, 55] no es alcanzable desde el player',
    ]);
    assert.equal(r.stats.npcs_reachable, 0);
  });

  it("con 1,5 m entre los mismos props, el mismo tile es jugable", () => {
    const r = validateScene(conBarriles(63, 66), bootstrap);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.stats.npcs_reachable, 1);
  });

  it("y con el punto sin dimensión de antes, el de 1 m salía APROBADO", () => {
    // La prueba en negativo de la severidad y de la erosión a la vez: el
    // mismo tile, medido con k=1 (el flood de siempre), da al NPC por
    // alcanzable. Si alguien devuelve el flood a un punto —o erosiona por el
    // AABB (k=2)— este test es el que se entera.
    const escena = conBarriles(63, 65);
    const abierto = openTile(escena);
    assert.equal(abierto.ok, true);
    if (!abierto.ok) return;
    const found = emptyFindings(abierto.view.cols, abierto.view.rows);
    const map = buildWalkableMap(abierto.view, composePlan(abierto.view, found), found);
    const semilla: Cell[] = [[64, 70]];
    assert.equal(floodFill(abierto.view, map, semilla, 1).has([60, 55]), true, "k=1: aprobado (el bug)");
    assert.equal(floodFill(abierto.view, map, semilla, 2).has([60, 55]), true, "k=2 (AABB): aprobado (la trampa)");
    assert.equal(floodFill(abierto.view, map, semilla, 3).has([60, 55]), false, "k=3: por fin lo ve");
  });

  it("un NPC empotrado en un prop es ERROR, aunque se le pueda hablar desde al lado", () => {
    // El residuo de #262 que YA ocurrió: el tabernero de alta_fantasia nació
    // dentro del prop `mostrador` y avanzó 0,72 m en 60 s. `validateScene`
    // daba el mismo veredicto que para un tile sano: ok:true, npcs 1/1.
    const escena = conBarriles(63, 66);
    (escena.volumes as Record<string, unknown>[]).push({
      id: "mostrador", label: "mostrador", type: "prop", shape: "box", rect: [58, 54, 6, 2],
    });
    const r = validateScene(escena, bootstrap);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [
      'el NPC "posadero" nace en [60, 55], celda no transitable (muro, agua o huella de un volumen): no podría moverse de ahí',
    ]);
    assert.equal(r.stats.npcs_reachable, 0);
  });

  it("un mostrador declarado `passable` no encierra a nadie (el candado no es «hay un prop cerca»)", () => {
    const escena = conBarriles(63, 66);
    (escena.volumes as Record<string, unknown>[]).push({
      id: "alfombra", label: "alfombra", type: "prop", shape: "box", rect: [58, 54, 6, 2], passable: true,
    });
    const r = validateScene(escena, bootstrap);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.npcs_reachable, 1);
  });
});
