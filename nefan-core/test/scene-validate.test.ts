import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateScene, type TileValidationContext } from "../src/scene/scene-validate.js";
import { forestTile, CAMINO_OESTE_ESTE } from "./fixtures/tiles.js";

/** Tile de bootstrap jugable: el camino del fixture, un edificio enterable
 *  (`building` con `cutaway`, la única forma de declarar un interior desde
 *  #301) con puerta al sur lejos de él, un NPC dentro y el jugador fuera.
 *  Format D
 *  tiene UNA variante desde que se retiraron la escena suelta (issue #172) y
 *  el plató proscenio, así que lo que estos tests comprueban —muros, puertas,
 *  chars sin declarar, spawn del jugador, alcanzabilidad— se mide sobre el
 *  tile, que es donde vive. El bootstrap es el único tile que lleva player. */
function makeScene(over: Record<string, unknown> = {}): Record<string, unknown> {
  return forestTile({
    scene_id: "claro_val",
    volumes: [
      { id: "posada", label: "posada", type: "building", rect: [10, 70, 10, 7], cutaway: true, doors: [{ edge: "s", at: 4, w: 3 }] },
    ],
    entities: [
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [14, 73], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1], glyph: "@" },
    ],
    ...over,
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
    // Las 3 celdas del vano del cutaway cuentan y son alcanzables. Es la
    // regresión del playtest 2026-08-13: una posada cutaway CON doors
    // reportaba doors_total 0 porque solo se contaban los vanos de la
    // primitiva de salas, que ya no existe (#301).
    assert.equal(r.stats.doors_total, 3);
    assert.equal(r.stats.doors_reachable, 3);
    assert.equal(r.stats.npcs_reachable, 1);
  });

  it("rechaza un player sobre un muro o sobre la huella de un prop", () => {
    const s1 = makeScene();
    (s1.entities as Record<string, unknown>[])[1].cell = [10, 70]; // esquina del anillo de muro del cutaway
    const r1 = validateScene(s1, bootstrap);
    assert.ok(r1.errors.some((e) => e.includes("spawn del player")), r1.errors.join(" | "));

    const s2 = makeScene();
    (s2.entities as Record<string, unknown>[]).push({ id: "mesa", kind: "prop", name: "mesa", cell: [15, 80], footprint: [2, 2], glyph: "m" });
    const r2 = validateScene(s2, bootstrap);
    assert.ok(r2.errors.some((e) => e.includes("spawn del player")), r2.errors.join(" | "));
  });

  it("un NPC encerrado en una sala sin puertas es ERROR, no aviso", () => {
    // Hasta esta tanda era un aviso, y los avisos no rechazan: el motor
    // entregaba la escena que encierra al NPC. La sala es 7×7 porque el
    // anillo de muro del plan se come media celda por lado: es el tamaño
    // mínimo cuyo interior admite un CUERPO, y así el caso mide lo que dice
    // —encerrado— y no «no cabe», que tiene su propio mensaje y su caso.
    const s = makeScene();
    (s.volumes as Record<string, unknown>[]).push({ id: "cubil", label: "cubil", type: "building", rect: [40, 90, 7, 7], cutaway: true });
    (s.entities as Record<string, unknown>[])[0].cell = [43, 93];
    const r = validateScene(s, bootstrap);
    assert.equal(r.ok, false, "una escena que encierra a un NPC no se entrega");
    assert.deepEqual(r.errors, ['el NPC "barkeep" en [43, 93] no es alcanzable desde el player']);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.stats.npcs_reachable, 0);
  });

  it("y el «cuarto de 5×5» del issue, donde el cuerpo NO cabe, lo dice con otro mensaje", () => {
    // Son dos arreglos distintos para el motor: abrir un paso vs. ensanchar.
    const s = makeScene();
    (s.volumes as Record<string, unknown>[]).push({ id: "cubil", label: "cubil", type: "building", rect: [40, 90, 5, 5], cutaway: true });
    (s.entities as Record<string, unknown>[])[0].cell = [42, 92];
    const r = validateScene(s, bootstrap);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [
      'el NPC "barkeep" nace en [42, 92], un hueco donde su cuerpo no cabe: hacen falta 3 celdas ' +
        "libres seguidas en cada eje y ahí no las hay, así que no podría moverse",
    ]);
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
      'el vano de la puerta "s" de "posada" no lo cruza un cuerpo: ninguna de sus 4 celda(s) es ' +
        "alcanzable desde la entrada del tile (¿lo tapa un volumen, o es más estrecho que un NPC?)",
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

  it("un NPC DENTRO del pinzamiento de 1 m es ERROR, aunque su celda sea pisable y la vecina alcanzable", () => {
    // El caso literal de la crítica que reencuadró la tanda, extremo a
    // extremo: el NPC no está detrás del hueco, está EN él. Su celda es
    // pisable y tiene vecina alcanzable, así que con el predicado viejo
    // —`isWalkable` con ±1 celda de tolerancia— pasaba, y no podía moverse.
    const escena = conBarriles(63, 65);
    (escena.entities as Record<string, unknown>[])[0] = {
      id: "posadero", kind: "npc", name: "Posadero", cell: [64, 63], footprint: [1, 1], glyph: "n",
    };
    const r = validateScene(escena, bootstrap);
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some((e) => e.includes('el NPC "posadero" nace en [64, 63], un hueco donde su cuerpo no cabe')),
      r.errors.join(" | "),
    );
    assert.equal(r.stats.npcs_reachable, 0);
  });

  it("y el cuerpo se juzga TAMBIÉN en un tile sin costuras ni entrada (el prefetch del anillo)", () => {
    // El caso donde el candado callaba: «¿cabe su cuerpo?» vivía detrás del
    // `return` temprano de `checkReachability`, así que un tile sin entrada
    // declarada —los que `game-gen.ts` genera para el anillo 3×3, SIN
    // `approachEdge`— se iba con un aviso que no rechaza y a su NPC empotrado
    // no se le miraba nada. Medido: 3 de los 8 tiles del anillo de un mundo
    // embarcado no recibieron ni un chequeo de cuerpo.
    const enElAnillo = {
      tile: { tx: 9, ty: 9 },
      scene_id: "tile_9_9",
      scene_description: "Un prado con un carro.",
      biome: "meadow",
      volumes: [{ id: "carro", label: "carro", type: "prop", shape: "box", rect: [60, 60, 6, 4] }],
      entities: [{ id: "carretero", kind: "npc", name: "Carretero", cell: [62, 61], footprint: [1, 1], glyph: "n" }],
    };
    const r = validateScene(enElAnillo, { required_crossings: [] });
    assert.equal(r.ok, false, "sin entrada declarada el cuerpo se juzga igual");
    assert.deepEqual(r.errors, [
      'el NPC "carretero" nace en [62, 61], celda no transitable (muro, agua o huella de un volumen): ' +
        "no podría moverse de ahí",
    ]);
    // La alcanzabilidad sí sigue sin verificarse: no hay desde dónde. Son dos
    // preguntas distintas y solo una necesita el flood.
    assert.deepEqual(r.warnings, ["tile sin cruces de vecinos ni entrada conocida: alcanzabilidad no verificada"]);
  });

  it("…y el mismo tile del anillo con el NPC bien puesto pasa", () => {
    const sano = {
      tile: { tx: 9, ty: 9 },
      scene_id: "tile_9_9",
      scene_description: "Un prado con un carro.",
      biome: "meadow",
      volumes: [{ id: "carro", label: "carro", type: "prop", shape: "box", rect: [60, 60, 6, 4] }],
      entities: [{ id: "carretero", kind: "npc", name: "Carretero", cell: [68, 61], footprint: [1, 1], glyph: "n" }],
    };
    const r = validateScene(sano, { required_crossings: [] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
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
