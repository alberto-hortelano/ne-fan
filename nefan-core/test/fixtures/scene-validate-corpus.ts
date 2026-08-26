/** Corpus de caracterización de `validateScene`: las escenas que ejercen sus
 *  pasadas, una a una y varias a la vez.
 *
 *  Vive suelto (sin el harness de bridge de helpers.ts) porque lo consumen el
 *  golden `scene-validate-golden.test.ts` y los tests por pasada. Cada caso
 *  declara QUÉ pasada ejerce: cuando el golden salta, el `cubre` dice dónde
 *  mirar sin releer el validador entero.
 *
 *  Los casos construyen la escena en una FUNCIÓN, no en una constante: el
 *  validador recibe objetos crudos del motor y ningún test debe poder
 *  contaminar al siguiente por compartir la misma referencia. */

import type { TileValidationContext } from "../../src/scene/scene-validate.js";
import { forestTile, CAMINO_OESTE_ESTE } from "./tiles.js";

export interface CasoValidacion {
  /** Clave estable en el golden: renombrar uno es reescribir su entrada. */
  name: string;
  /** Pasada(s) del validador que ejerce este caso. */
  cubre: string;
  scene: () => Record<string, unknown>;
  ctx?: TileValidationContext;
}

/** Contexto del tile de bootstrap: sin costuras que continuar, player obligatorio. */
const BOOTSTRAP: TileValidationContext = { required_crossings: [], bootstrap: true };
/** Contexto de un tile normal aislado: ni cruces requeridos ni entrada. */
const AISLADO: TileValidationContext = { required_crossings: [] };

const pathCrossing = (edge: "north" | "south" | "east" | "west", at: number) =>
  ({ edge, type: "path" as const, at, width: 2 });

/** Camino oeste↔este del fixture + una sala enterable con puerta al sur y un
 *  NPC dentro. Es el tile jugable de referencia. */
function escenaBootstrap(over: Record<string, unknown> = {}): Record<string, unknown> {
  return forestTile({
    scene_id: "claro_val",
    structures: [
      { type: "room", rect: [10, 70, 10, 7], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 4, width: 2 }] },
    ],
    entities: [
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [14, 73], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1], glyph: "@" },
    ],
    ...over,
  });
}

/** Tile YA expandido: la única forma de poner un char concreto en una fila
 *  concreta sin pasar por el rasterizador, y de darle al normalizador filas
 *  cortas, largas y de sobra. */
function tileExpandido(terrain: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    biome: "meadow",
    __expanded: true,
    terrain,
    entities: [],
    ...over,
  };
}

/** 128 filas de hierba, con las que se indiquen sustituidas. */
function gridLlano(filas: Record<number, unknown> = {}): unknown[] {
  return Array.from({ length: 128 }, (_, r) => filas[r] ?? "g".repeat(128));
}

/** Plan declarativo puro (sin structures): el que mide la telemetría. */
function planDeTile(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    // 0,01 ejemplares/m² = 41 pinos en el tile: la densidad se elige a
    // propósito para que el golden siga midiendo lo que medía (un tile
    // jugable con algo de bosque) y no 205 troncos que taparían el resto.
    vegetation_zones: [{ type: "pino", area: "rest", density: 0.01 }],
    scatter_generators: { guijarro: { parts: [{ shape: "box", size: [0.4, 0.3, 0.4] }] } },
    scatter_zones: [
      { kind: "guijarro", shape: { type: "rect", x0: 0, z0: 80, x1: 30, z1: 110 }, density: 0.1 },
    ],
    ...over,
  };
}

export function casosDeValidacion(): CasoValidacion[] {
  return [
    // ── Gate de variante ──────────────────────────────────────────────────
    {
      name: "sin-tile",
      cubre: "gate de variante: Format D tiene UNA variante",
      scene: () => ({ scene_id: "suelta", entities: [] }),
    },
    {
      name: "tile-con-coords-no-enteras",
      cubre: "gate de variante: tile.tx/ty enteros",
      scene: () => ({ tile: { tx: 1.5, ty: 0 }, scene_id: "tile_raro", entities: [] }),
    },

    // ── Expansión de primitivas ───────────────────────────────────────────
    {
      name: "structure-fuera-del-grid",
      cubre: "expansión: el fail-loud del expander se vuelve error legible",
      scene: () =>
        escenaBootstrap({
          structures: [{ type: "room", rect: [124, 70, 10, 7], wall_char: "W", floor_char: "o", doors: [] }],
        }),
      ctx: BOOTSTRAP,
    },
    {
      name: "vegetation-zone-invalida",
      cubre: "expansión: densidad fuera de rango",
      scene: () => planDeTile({ vegetation_zones: [{ type: "pino", area: "rest", density: 2 }] }),
    },

    // ── Chars declarados + solidez ────────────────────────────────────────
    {
      name: "char-de-terreno-sin-declarar",
      cubre: "chars declarados: floor_char ausente de terrain_legend",
      scene: () =>
        escenaBootstrap({
          structures: [
            { type: "room", rect: [10, 70, 10, 7], wall_char: "W", floor_char: "X", doors: [{ side: "south", at: 4, width: 2 }] },
          ],
        }),
      ctx: BOOTSTRAP,
    },

    {
      name: "dos-chars-sin-declarar",
      cubre: "chars declarados: se listan TODOS los que faltan, en orden de barrido",
      // El wall_char lo declara el expander al tallar el muro; el floor_char no.
      scene: () =>
        escenaBootstrap({
          structures: [
            { type: "room", rect: [10, 70, 10, 7], wall_char: "W", floor_char: "Y", doors: [{ side: "south", at: 4, width: 2 }] },
            { type: "room", rect: [40, 90, 6, 6], wall_char: "W", floor_char: "Z", doors: [{ side: "north", at: 2 }] },
          ],
        }),
      ctx: BOOTSTRAP,
    },
    {
      name: "chars-reservados-todos-legales",
      cubre: "chars declarados: los nueve reservados no necesitan leyenda",
      scene: () => tileExpandido(gridLlano({ 0: "gw_sbdaoW".padEnd(128, "g") })),
      ctx: AISLADO,
    },

    // ── Scatter declarativo (vista fps) ───────────────────────────────────
    {
      name: "scatter-sin-generadores",
      cubre: "scatter: zonas declaradas sin generadores",
      scene: () => planDeTile({ scatter_generators: undefined }),
    },
    {
      name: "scatter-con-kind-desconocido",
      cubre: "scatter: la zona referencia un generador que no existe",
      scene: () =>
        planDeTile({
          scatter_zones: [{ kind: "fantasma", shape: { type: "rect", x0: 0, z0: 80, x1: 30, z1: 110 }, density: 0.1 }],
        }),
    },

    // ── Spawn del jugador ─────────────────────────────────────────────────
    {
      name: "bootstrap-jugable",
      cubre: "el tile completo aceptado: spawn, puertas, NPC y costuras",
      scene: escenaBootstrap,
      ctx: BOOTSTRAP,
    },
    {
      name: "player-sobre-muro",
      cubre: "spawn: la celda del player es sólida",
      scene: () => {
        const s = escenaBootstrap();
        (s.entities as Record<string, unknown>[])[1].cell = [10, 70];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "player-bajo-la-huella-de-un-prop",
      cubre: "spawn: la celda del player la ocupa un footprint",
      scene: () => {
        const s = escenaBootstrap();
        (s.entities as Record<string, unknown>[]).push({
          id: "mesa", kind: "prop", name: "mesa", cell: [15, 80], footprint: [2, 2], glyph: "m",
        });
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "huellas-que-bloquean-el-paso",
      cubre: "máscara walkable: building, prop y tree estampan su footprint; un item no",
      scene: () =>
        escenaBootstrap({
          entities: [
            { id: "barkeep", kind: "npc", name: "Tabernero", cell: [14, 73], footprint: [1, 1], glyph: "n" },
            { id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1], glyph: "@" },
            { id: "roble", kind: "tree", name: "roble", cell: [20, 84], footprint: [2, 2], glyph: "t" },
            { id: "granero", kind: "building", name: "granero", cell: [30, 84], footprint: [4, 3], glyph: "B" },
            { id: "moneda", kind: "item", name: "moneda", cell: [40, 84], footprint: [2, 2], glyph: "$" },
          ],
        }),
      ctx: BOOTSTRAP,
    },
    {
      name: "player-fuera-del-grid",
      cubre: "spawn: la celda del player cae fuera del tile",
      scene: () => {
        const s = escenaBootstrap();
        (s.entities as Record<string, unknown>[])[1].cell = [200, 200];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "player-en-un-tile-normal",
      cubre: "spawn: solo el tile de bootstrap lleva player",
      scene: () =>
        forestTile({
          entities: [{ id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1], glyph: "@" }],
        }),
      ctx: AISLADO,
    },
    {
      name: "bootstrap-sin-player",
      cubre: "spawn: el tile de bootstrap lo exige",
      scene: () => forestTile(),
      ctx: BOOTSTRAP,
    },

    // ── Costuras (tiles) ──────────────────────────────────────────────────
    {
      name: "costuras-continuadas",
      cubre: "costuras: los dos cruces del camino continúan",
      scene: () => forestTile(),
      ctx: { required_crossings: [pathCrossing("west", 41), pathCrossing("east", 52)] },
    },
    {
      name: "cruce-requerido-sin-continuacion",
      cubre: "costuras: un río del vecino muere en la costura",
      scene: () => forestTile(),
      ctx: { required_crossings: [{ edge: "north", type: "river", at: 30, width: 3 }] },
    },
    {
      name: "rio-continuado-por-rio",
      cubre: "costuras: al agua no se le exige alcanzabilidad a pie",
      scene: () => forestTile({ ground: [CAMINO_OESTE_ESTE, { id: "rio", kind: "water", rect: [28, 0, 4, 18] }] }),
      ctx: {
        required_crossings: [
          pathCrossing("west", 41),
          pathCrossing("east", 52),
          { edge: "north", type: "river", at: 30, width: 4 },
        ],
        entry: { edge: "west", at: 41 },
      },
    },
    {
      name: "entrada-que-casa-con-un-rio",
      cubre: "costuras: ningún arranque cae en terreno transitable",
      scene: () => forestTile({ ground: [{ id: "rio", kind: "water", rect: [0, 38, 128, 4] }] }),
      ctx: {
        required_crossings: [
          { edge: "west", type: "river", at: 40, width: 4 },
          { edge: "east", type: "river", at: 40, width: 4 },
        ],
        entry: { edge: "west", at: 40 },
      },
    },
    {
      name: "tile-sin-terreno-transitable",
      cubre: "costuras: tile enteramente sólido con vecino enlazado",
      scene: () => forestTile({ ground: [{ id: "mar", kind: "water", rect: [0, 0, 128, 128] }] }),
      ctx: {
        required_crossings: [{ edge: "west", type: "river", at: 40, width: 4 }],
        entry: { edge: "west", at: 40 },
      },
    },
    {
      name: "entrada-sin-cruces-requeridos",
      cubre: "costuras: la entrada declarada es el ÚNICO arranque del flood",
      scene: () => forestTile(),
      ctx: { required_crossings: [], entry: { edge: "west", at: 41 } },
    },
    {
      name: "tile-aislado-sin-cruces-ni-entrada",
      cubre: "costuras: prefetch diagonal, alcanzabilidad no verificada",
      scene: () => forestTile({ ground: [] }),
      ctx: AISLADO,
    },
    {
      name: "tile-con-place-id",
      cubre: "costuras: el plano continuo no exige links a un place",
      scene: () => forestTile({ place_id: "claro_del_bosque" }),
      ctx: { required_crossings: [pathCrossing("west", 41)] },
    },

    // ── Flood-fill de alcanzabilidad ──────────────────────────────────────
    {
      name: "cruce-continuado-pero-inalcanzable",
      cubre: "flood: el río parte el camino por la mitad",
      scene: () =>
        forestTile({ ground: [CAMINO_OESTE_ESTE, { id: "rio", kind: "water", rect: [58, 0, 4, 128] }] }),
      ctx: {
        required_crossings: [pathCrossing("west", 41), pathCrossing("east", 52)],
        entry: { edge: "west", at: 41 },
      },
    },
    {
      name: "npc-inalcanzable",
      cubre: "flood: NPC encerrado en una sala sin puertas → aviso",
      scene: () => {
        const s = escenaBootstrap();
        (s.structures as Record<string, unknown>[]).push({ type: "room", rect: [40, 90, 3, 3], doors: [] });
        (s.entities as Record<string, unknown>[])[0].cell = [41, 91];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "puertas-cutaway-en-volumes",
      cubre: "puertas: el vano de un building cutaway cuenta y se alcanza",
      scene: () => {
        const s = escenaBootstrap();
        delete s.structures;
        s.volumes = [
          { id: "posada", label: "posada", type: "building", rect: [10, 70, 10, 7], cutaway: true, doors: [{ edge: "s", at: 4, w: 3 }] },
        ];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "puertas-en-los-cuatro-lados",
      cubre: "puertas: los cuatro lados de una structure y los cuatro de un cutaway",
      scene: () => {
        const s = escenaBootstrap();
        (s.structures as Record<string, unknown>[])[0] = {
          type: "room", rect: [20, 20, 12, 12], wall_char: "W", floor_char: "o",
          doors: [
            { side: "north", at: 5 }, { side: "south", at: 5 },
            { side: "west", at: 5 }, { side: "east", at: 5 },
          ],
        };
        s.volumes = [
          {
            id: "granero", label: "granero", type: "building", rect: [60, 60, 12, 12], cutaway: true,
            doors: [{ edge: "n", at: 4, w: 2 }, { edge: "s", at: 4, w: 2 }, { edge: "w", at: 4, w: 2 }, { edge: "e", at: 4, w: 2 }],
          },
        ];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "prop-dentro-de-un-edificio-no-tapa-su-vano",
      cubre: "puertas: el mobiliario bajo techo se PINTA pero no colisiona (lo tapa el volumen del edificio)",
      // Un carro en el vano de la posada. En el PLAN —el que compone el juego—
      // una entity cuyo rect ya cubre un volumen no deriva el suyo: el
      // mobiliario de un interior es atrezo, no geometría. Hasta esta tanda el
      // validador estampaba su huella igual y avisaba de una puerta bloqueada
      // que en partida se cruzaba sin tocar nada.
      scene: () => {
        const s = escenaBootstrap();
        (s.entities as Record<string, unknown>[]).push({
          id: "carro", kind: "prop", name: "carro", cell: [14, 76], footprint: [1, 1], glyph: "c",
        });
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "ninguna-puerta-alcanzable",
      cubre: "puertas: el player arranca encerrado, ninguna puerta se alcanza",
      scene: () => {
        const s = escenaBootstrap();
        (s.structures as Record<string, unknown>[]).push({
          type: "room", rect: [60, 60, 5, 5], wall_char: "W", floor_char: "o", doors: [],
        });
        (s.entities as Record<string, unknown>[])[1].cell = [62, 62];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "mapa-casi-todo-agua",
      cubre: "flood: proporción jugable bajo el 20% → aviso",
      scene: () =>
        forestTile({
          ground: [
            { id: "mar_norte", kind: "water", rect: [0, 0, 128, 35] },
            { id: "mar_sur", kind: "water", rect: [0, 60, 128, 68] },
            CAMINO_OESTE_ESTE,
          ],
        }),
      ctx: { required_crossings: [pathCrossing("west", 41), pathCrossing("east", 52)] },
    },

    // ── Utilización de presupuestos del plan ──────────────────────────────
    {
      name: "telemetria-del-plan",
      cubre: "presupuestos: volumes/ground/scatter/vegetación y alturas distintas",
      scene: () => planDeTile(),
    },

    // ── El dial del bosque y su presupuesto ───────────────────────────────
    {
      name: "pinar-cerrado-al-tope",
      cubre: "plan: la densidad máxima del contrato sobre media zona, compuesta entera",
      // Media zona a 0,08 = 164 pinos: el bosque más cerrado que cabe en el
      // presupuesto de un tile que además tiene pueblo.
      scene: () => planDeTile({ vegetation_zones: [{ type: "pino", area: [0, 0, 64, 128], density: 0.08 }] }),
    },
    {
      name: "plan-que-no-cabe-en-el-presupuesto",
      cubre: "plan: el recorte se DICE con los tres números, no se trunca en silencio",
      scene: () =>
        planDeTile({
          entities: Array.from({ length: 100 }, (_, i) => ({
            id: `trasto_${i}`,
            kind: "prop",
            name: "trasto",
            cell: [(i % 20) * 3, Math.floor(i / 20) * 6],
            footprint: [1, 1],
            glyph: "x",
          })),
          vegetation_zones: [{ type: "pino", area: "rest", density: 0.08 }],
        }),
    },

    // ── Varias pasadas a la vez: el ORDEN de los mensajes es contrato ─────
    {
      name: "cuatro-pasadas-fallando-a-la-vez",
      cubre: "orden: chars → scatter → spawn → costuras",
      scene: () => {
        const s = escenaBootstrap({
          structures: [
            { type: "room", rect: [10, 70, 10, 7], wall_char: "W", floor_char: "X", doors: [{ side: "south", at: 4, width: 2 }] },
          ],
        });
        (s.entities as Record<string, unknown>[])[1].cell = [10, 70];
        s.scatter_generators = { guijarro: { parts: [{ shape: "box", size: [0.4, 0.3, 0.4] }] } };
        s.scatter_zones = [{ kind: "fantasma", shape: { type: "rect", x0: 0, z0: 80, x1: 30, z1: 110 }, density: 0.1 }];
        return s;
      },
      ctx: {
        required_crossings: [{ edge: "north", type: "river", at: 30, width: 3 }],
        bootstrap: true,
      },
    },
  ];
}
