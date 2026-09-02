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

/** Camino oeste↔este del fixture + un edificio enterable con puerta al sur y
 *  un NPC dentro. Es el tile jugable de referencia.
 *
 *  El edificio es un `building` CUTAWAY, que desde #301 es la única forma de
 *  declarar un interior: la primitiva de salas que ocupaba este sitio
 *  estampaba además muro `W` y suelo `o` en el grid ASCII, y por eso los casos
 *  de abajo que sellan a alguien dentro razonan sobre la MÁSCARA DEL PLAN (el
 *  anillo de muro del cutaway), que es la que sobrevive. */
function escenaBootstrap(over: Record<string, unknown> = {}): Record<string, unknown> {
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

/** Tile YA expandido: la única forma de poner un char concreto en una fila
 *  concreta sin pasar por el rasterizador. El grid tiene que ser 128×128 de
 *  verdad: el gate de `openTile` rechaza al que lleva la marca y miente. */
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

/** Plan declarativo de un tile SIN edificio enterable: el que mide la telemetría. */
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
      name: "vegetation-zone-invalida",
      cubre: "expansión: densidad fuera de rango",
      scene: () => planDeTile({ vegetation_zones: [{ type: "pino", area: "rest", density: 2 }] }),
    },

    // ── Gate del grid: la marca `__expanded` no exime del contrato ────────
    // Los tres primeros REVENTABAN el validador (throw → 500 del state API,
    // #195): una escena que afirma venir expandida y miente debe rechazarse
    // con el error accionable, no tumbar la ruta. El cuarto es el candado de
    // no-regresión C6: sin la marca, el expander ya rechazaba con mensaje.
    {
      name: "expandido-con-terrain-vacio",
      cubre: "gate del grid: `__expanded` con 0 filas → rechazo, no un 500",
      scene: () => tileExpandido([]),
      ctx: AISLADO,
    },
    {
      name: "expandido-sin-terrain",
      cubre: "gate del grid: `__expanded` sin terrain → rechazo, no un TypeError",
      scene: () => {
        const s = tileExpandido([]);
        delete s.terrain;
        return s;
      },
      ctx: AISLADO,
    },
    {
      name: "expandido-con-biome-desconocido",
      cubre: "gate del grid: bioma fuera de catálogo con grid perfecto → rechazo, no un 500",
      scene: () => tileExpandido(gridLlano(), { biome: "bogus" }),
      ctx: AISLADO,
    },
    {
      name: "tile-con-127-filas-sin-marca",
      cubre: "no-regresión: sin `__expanded`, size/terrain completos los rechaza el expander con mensaje",
      scene: () => {
        const s = tileExpandido(gridLlano().slice(0, 127));
        delete s.__expanded;
        return s;
      },
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
      cubre: "el tile completo aceptado: spawn, el vano del cutaway, NPC y costuras",
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
    // Las TRES caras de «este NPC no puede estar ahí», que son tres arreglos
    // distintos para el motor y por eso tres mensajes. La sala sellada sube de
    // tamaño en cada una: bajo la máscara del plan, el anillo de muro se come
    // media celda por lado, así que una 3×3 no deja NI UNA celda pisable, una
    // 5×5 deja una (donde el cuerpo no cabe) y una 7×7 deja 3×3 (donde cabe,
    // pero no conecta con nada).
    {
      name: "npc-en-celda-solida",
      cubre: "flood: NPC empotrado en un sólido → error, aunque tenga vecina libre",
      // El residuo de #262 que ya ocurrió: el tabernero nació dentro del prop
      // `mostrador` y se leyó durante semanas como «la huida está rota». Se
      // le podía hablar desde al lado, así que el validador lo daba por bueno.
      scene: () => {
        const s = escenaBootstrap();
        (s.volumes as Record<string, unknown>[]).push({ id: "cubil", label: "cubil", type: "building", rect: [40, 90, 3, 3], cutaway: true });
        (s.entities as Record<string, unknown>[])[0].cell = [41, 91];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "npc-sin-sitio-para-el-cuerpo",
      cubre: "flood: NPC en una celda pisable donde su CUERPO no cabe → error",
      // El nicho de UNA celda: `isWalkable` decía que sí y la tolerancia de
      // ±1 celda encontraba vecina alcanzable, así que pasaba. Es el «cuarto
      // de 5×5» del issue #289.
      scene: () => {
        const s = escenaBootstrap();
        (s.volumes as Record<string, unknown>[]).push({ id: "cubil", label: "cubil", type: "building", rect: [40, 90, 5, 5], cutaway: true });
        (s.entities as Record<string, unknown>[])[0].cell = [42, 92];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "npc-inalcanzable",
      cubre: "flood: NPC encerrado en una sala sin puertas (el cuerpo cabe, pero no conecta) → error",
      scene: () => {
        const s = escenaBootstrap();
        (s.volumes as Record<string, unknown>[]).push({ id: "cubil", label: "cubil", type: "building", rect: [40, 90, 7, 7], cutaway: true });
        (s.entities as Record<string, unknown>[])[0].cell = [43, 93];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "puertas-en-los-cuatro-lados",
      cubre: "puertas: los cuatro lados de dos cutaways",
      scene: () => {
        const s = escenaBootstrap();
        // Vanos de 3 celdas: el mínimo que admite el cuerpo mayor (#289).
        s.volumes = [
          {
            id: "posada", label: "posada", type: "building", rect: [20, 20, 12, 12], cutaway: true,
            doors: [{ edge: "n", at: 5, w: 3 }, { edge: "s", at: 5, w: 3 }, { edge: "w", at: 5, w: 3 }, { edge: "e", at: 5, w: 3 }],
          },
          {
            id: "granero", label: "granero", type: "building", rect: [60, 60, 12, 12], cutaway: true,
            doors: [{ edge: "n", at: 4, w: 3 }, { edge: "s", at: 4, w: 3 }, { edge: "w", at: 4, w: 3 }, { edge: "e", at: 4, w: 3 }],
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
      cubre: "puertas: el player arranca encerrado (con sitio para su cuerpo), el vano de la posada no se cruza",
      scene: () => {
        const s = escenaBootstrap();
        (s.volumes as Record<string, unknown>[]).push({
          id: "cubil", label: "cubil", type: "building", rect: [60, 60, 7, 7], cutaway: true,
        });
        (s.entities as Record<string, unknown>[])[1].cell = [63, 63];
        return s;
      },
      ctx: BOOTSTRAP,
    },
    {
      name: "entrada-sin-sitio-para-el-cuerpo",
      cubre: "flood: el arranque es pisable pero no admite un cuerpo → se nombra la causa, no se lista media escena",
      // La misma sala de 5×5, con el PLAYER dentro: su única celda pisable no
      // admite un cuerpo. Antes el flood salía vacío y el informe era una
      // avalancha (todos los cruces, todos los NPCs) sin nombrar la causa.
      scene: () => {
        const s = escenaBootstrap();
        (s.volumes as Record<string, unknown>[]).push({
          id: "cubil", label: "cubil", type: "building", rect: [60, 60, 5, 5], cutaway: true,
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
      name: "tres-pasadas-fallando-a-la-vez",
      cubre: "orden: scatter → spawn → costuras",
      scene: () => {
        const s = escenaBootstrap();
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
