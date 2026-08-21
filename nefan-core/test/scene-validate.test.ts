import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateScene, type TileValidationContext } from "../src/scene/scene-validate.js";
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

  it("avisa (no da error) de un NPC inalcanzable", () => {
    const s = makeScene();
    // NPC encerrado en una segunda sala sin puertas.
    (s.structures as Record<string, unknown>[]).push({ type: "room", rect: [40, 90, 3, 3], doors: [] });
    (s.entities as Record<string, unknown>[])[0].cell = [41, 91];
    const r = validateScene(s, bootstrap);
    assert.equal(r.ok, true, r.errors.join(" | "));
    assert.ok(r.warnings.some((w) => w.includes("barkeep")), r.warnings.join(" | "));
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
      vegetation_zones: [{ type: "pino", area: "rest", density: 0.05 }],
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
    assert.ok(r.errors.some((e) => e.includes("density")), r.errors.join(" | "));
  });
});
