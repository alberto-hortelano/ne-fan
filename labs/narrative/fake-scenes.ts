/** Las escenas que emite el motor FALSO del banco — módulo PURO, sin
 *  `listen` ni puertos, para que un test pueda importarlo (#334-B).
 *
 *  `fake-ai-server.ts` hace `server.listen` en top-level, así que importarlo
 *  desde un test levantaba un servidor: los builders viven aquí y el server
 *  los importa. El candado es `nefan-core/test/fake-motor-contract.test.ts`:
 *  cada escena de este fichero debe pasar `EmittedSceneSchema`, el contrato
 *  del rol que el fake suplanta — el banco no puede ejercitar el juego con
 *  escenas que el motor real tendría prohibido emitir. (La validación del
 *  bridge no vale como candado: su gate de lectura es `ExpandedSceneSchema`,
 *  que tolera campos que el emitido rechaza.) */

import type { LlmContext } from "../../nefan-core/src/narrative/types.js";

/** Lo que el motor pide cuando pide un TILE, tal como lo declara el contexto
 *  del LLM. No es una copia: es el mismo tipo que construye el bridge. */
export type GenerateTile = NonNullable<LlmContext["generate_tile"]>;
export type Neighbor = NonNullable<GenerateTile["neighbors"]["north"]>;
export type Edge = "north" | "south" | "east" | "west";

/** Punto de una feature sobre la línea del borde (celdas, floats ok). */
export function edgePoint(edge: Edge, at: number): [number, number] {
  switch (edge) {
    case "west": return [0, at];
    case "east": return [128, at];
    case "north": return [at, 0];
    case "south": return [at, 128];
  }
}
export const OPP: Record<Edge, Edge> = { west: "east", east: "west", north: "south", south: "north" };

/** Plan del bootstrap: arte plano del suelo (camino que copia la feature,
 *  estanque al oeste) + volúmenes tipados (taberna cutaway
 *  con puerta sur, mostrador, pinos). El cliente compone el blueprint con la
 *  perspectiva de la sesión.  */
// Sin rect de fondo: el compositor pone el bioma con su textura (manchas,
// flores) y los rasgos declarativos del LLM van encima. El bootstrap es el
// PUEBLO de las demos del blueprint lab (taberna cutaway amueblada, plaza
// empedrada con fuente, casa de entramado, muralla sur con torres y puerta,
// mercado) — el bench de calidad visual, comparable 1:1 con referencia.html.
export const BOOTSTRAP_GROUND = [
  // camino N-S que cruza el pueblo y sale por la puerta sur de la muralla
  { id: "camino_ns", kind: "path", label: "camino principal", points: [[64, 30], [64, 128]], w: 5, material: "cobble" },
  // ramal este hacia el vecino
  { id: "camino_este", kind: "path", label: "ramal del este", points: [[64, 80], [96, 85], [128, 88]], w: 4, material: "dirt" },
  // plaza empedrada
  { id: "plaza", kind: "area", label: "plaza empedrada", ellipse: { center: [64, 80], rx: 15, ry: 8.5 }, material: "cobble" },
  // tierra pisada ante la puerta de la taberna y orilla del estanque
  { id: "tierra_taberna", kind: "area", label: "tierra pisada", ellipse: { center: [65, 66], rx: 6, ry: 3 }, material: "dirt" },
  { id: "orilla", kind: "area", label: "orilla arenosa", ellipse: { center: [26, 94], rx: 12, ry: 8 }, material: "sand" },
  // estanque (agua: bloquea) — SIN deck a propósito (lo añade el review)
  { id: "estanque", kind: "water", label: "estanque", ellipse: { center: [25, 92], rx: 9, ry: 5.5 } },
];

export const BOOTSTRAP_VOLUMES = [
  // ── taberna cutaway amueblada ──
  {
    id: "taberna",
    label: "taberna",
    type: "building",
    rect: [52, 48, 24, 16],
    cutaway: true,
    walls: { material: "wood" },
    doors: [{ edge: "s", at: 11, w: 4 }],
  },
  { id: "mostrador", label: "mostrador", type: "prop", rect: [55, 51, 6, 2], shape: "box", h: 2.4 },
  { id: "mesa_1", label: "mesa", type: "prop", at: [59, 57], shape: "cylinder", h: 1.7, color: "#9a7040" },
  { id: "mesa_2", label: "mesa", type: "prop", at: [66, 55], shape: "cylinder", h: 1.7, color: "#9a7040" },
  { id: "mesa_3", label: "mesa", type: "prop", at: [71, 59], shape: "cylinder", h: 1.7, color: "#9a7040" },
  { id: "barril_tab_1", label: "barril", type: "prop", at: [54, 60], shape: "cylinder", h: 2.2, color: "#7a5a34" },
  { id: "barril_tab_2", label: "barril", type: "prop", at: [56.5, 61], shape: "cylinder", h: 2.2, color: "#7a5a34" },
  // ── plaza con fuente ──
  { id: "fuente", label: "fuente", type: "fountain", at: [64, 80], r: 4.5 },
  // ── casa de entramado con tejado de pizarra ──
  {
    id: "casa_entramado",
    label: "casa de entramado",
    type: "building",
    rect: [84, 38, 22, 14],
    wall_h: 5.5,
    roof: { kind: "gable", material: "slate" },
    walls: { material: "timber" },
    doors: [{ edge: "s", at: 9, w: 4 }],
    surface_desc: {
      side: "half-timbered facade with flower boxes under the windows",
      roof: "mossy slate roof tiles",
      door: "arched oak door with iron studs",
    },
  },
  // ── mercado junto a la plaza ──
  { id: "puesto_mercado", label: "puesto de mercado", type: "prop", rect: [80, 74, 7, 4], shape: "box", h: 3, color: "#8a6a40" },
  { id: "caja_mercado", label: "caja de fruta", type: "prop", at: [88.5, 76.5], shape: "box", h: 1.2, color: "#a8853f" },
  // Carro como volumen CUSTOM (composición 3D libre del motor): caja elevada
  // + 4 ruedas tumbadas + toldo con superficie hero propia + varal. El caso
  // que motivó la herramienta (antes: prop box con "skin" de carro).
  {
    id: "carro",
    label: "carro de mano entoldado",
    type: "custom",
    at: [47, 77.7],
    angle: -14,
    parts: [
      { shape: "box", size: [6, 1.4, 3], pos: [0, 1.1, 0], color: "#77572f",
        desc: "weathered wooden cart bed with iron-banded side planks" },
      { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [-1.7, 0, 1.55], rotX: 1.5708, color: "#4a3a26" },
      { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [1.7, 0, 1.55], rotX: 1.5708, color: "#4a3a26" },
      { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [-1.7, 0, -1.55], rotX: 1.5708, color: "#4a3a26" },
      { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [1.7, 0, -1.55], rotX: 1.5708, color: "#4a3a26" },
      { shape: "cylinder", rBottom: 1.5, rTop: 1.5, h: 5.6, pos: [2.8, 1.52, 0], rotZ: 1.5708,
        scale: [0.72, 1, 0.95], color: "#8a7d63",
        desc: "dark waxed canvas wagon tilt over hooped ribs, small hanging trinkets" },
      { shape: "box", size: [0.35, 2.4, 0.35], pos: [3.1, 0.4, 0.9], rotY: 0.5, color: "#5a4632" },
      { shape: "box", size: [0.35, 2.4, 0.35], pos: [3.1, 0.4, -0.9], rotY: -0.5, color: "#5a4632" }
    ],
  },
  // ── muralla sur con torres y puerta (el camino la cruza) ──
  { id: "muralla_sur", label: "muralla", type: "wall", points: [[0, 108], [128, 108]], width: 5, h: 7, crenellated: true },
  { id: "torre_o", label: "torre", type: "tower", at: [38, 108], r: 6.5, h: 11 },
  { id: "torre_e", label: "torre", type: "tower", at: [90, 108], r: 6.5, h: 11 },
  { id: "puerta_sur", label: "puerta de la ciudad", type: "gate", at: [64, 108], w: 9, h: 10, orient: "x", banners: true },
  // ── vegetación y rocas de carácter ──
  { id: "roble_1", label: "roble", type: "tree", at: [30, 34], s: 1.15 },
  { id: "roble_2", label: "roble", type: "tree", at: [98, 62], s: 1.0 },
  { id: "pino_1", label: "pino", type: "tree", at: [20, 20], species: "pino" },
  { id: "pino_2", label: "pino", type: "tree", at: [108, 26], species: "pino" },
  { id: "mata_1", label: "arbusto", type: "bush", at: [46, 68], s: 1.0 },
  { id: "mata_2", label: "arbusto", type: "bush", at: [84, 90], s: 0.9 },
  { id: "roca_1", label: "roca", type: "rock", at: [14, 74], s: 1.3 },
  // ── heroes por cara (vista fps): cartel con anverso≠reverso y casa con
  //    fachada/tejado/puerta separados — el fake atlas pinta un damero
  //    DISTINTO por celda, así el E2E delata cualquier colapso de caras. ──
  {
    id: "cartel_plaza",
    label: "cartel de la plaza",
    type: "prop",
    rect: [70, 72, 6, 0.8],
    shape: "box",
    h: 5,
    surface_desc: {
      s: "painted wooden sign reading LA POSADA with a boar emblem",
      n: "weathered plank back of the sign with two crossbars",
    },
  },
];

/** Scatter declarativo del bootstrap (vista fps): pinar de fondo al norte y
 *  matorral alrededor de la plaza, con el generador del run 003. */
export const BOOTSTRAP_SCATTER = {
  scatter_generators: {
    pino: {
      vars: { h: [5, 10], trunkH: { op: "*", a: { var: "h" }, b: 0.3 }, n: { int: [2, 4] } },
      materials: {
        tronco: { color: "#5a4632" },
        copa: { color: "#35482c", hslJitter: [0.05, 0.15, 0.07] },
      },
      parts: [
        { shape: "cylinder", mat: "tronco", rTop: 0.25, rBottom: 0.4, h: { var: "trunkH" }, pos: [0, 0, 0] },
        {
          shape: "cone", mat: "copa", seg: 7, repeat: { count: { var: "n" } },
          r: { op: "*", a: { var: "h" }, b: { lerp: [0.3, 0.12] } },
          h: { op: "*", a: { var: "h" }, b: 0.4 },
          pos: [0, { op: "*", a: { var: "trunkH" }, b: { op: "+", a: { var: "i" }, b: 0.8 } }, 0],
        },
      ],
    },
    matorral: {
      vars: { s: [0.7, 1.6] },
      materials: { hoja: { color: "#4a5a30", hslJitter: [0.06, 0.2, 0.08] } },
      parts: [
        {
          shape: "sphere", mat: "hoja", repeat: { count: { int: [1, 3] } },
          r: { op: "*", a: { var: "s" }, b: [0.6, 1.1] },
          pos: [{ op: "*", a: { var: "s" }, b: [-0.8, 0.8] }, 0, { op: "*", a: { var: "s" }, b: [-0.8, 0.8] }],
          scale: [1, [0.55, 0.8], 1],
        },
      ],
    },
  },
  scatter_zones: [
    { kind: "pino", shape: { type: "rect", x0: 2, z0: 2, x1: 126, z1: 26 }, density: 0.05 },
    { kind: "matorral", shape: { type: "ellipse", cx: 64, cz: 88, rx: 34, rz: 20 }, density: 0.06 },
  ],
};

/** Dónde VIVE cada lugar dentro de su tile, en celdas [col, row, ancho, alto]:
 *  el rect del anchor que el motor del banco fija por `map_upsert_place`
 *  (el canal real, #408) y que el bridge usa para que el jugador aparezca
 *  dentro del lugar, no en el centro del tile. La taberna casa con su cutaway
 *  de `BOOTSTRAP_VOLUMES`; el de un lugar anclado, con `placeVolumes`. */
export const BOOTSTRAP_PLACE_RECT: [number, number, number, number] = [52, 48, 24, 16];
export const ANCHORED_PLACE_RECT: [number, number, number, number] = [48, 68, 32, 20];

/** Tile de bootstrap (0,0): la taberna estampada en el plano + camino al este. */
export function bootstrapTile() {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    place_id: "taberna_bench_place",
    scene_description: "Claro de la taberna de bench en el plano continuo.",
    biome: "grass",
    // La taberna la declara `BOOTSTRAP_VOLUMES` como building CUTAWAY con el
    // mismo rect: hasta el 2026-08-30 aquí había además una primitiva de sala
    // con ese rect exacto, que el derive ya saltaba por estar cubierta por el
    // volume declarado. Lo único que aportaba era estampar muros y suelo en
    // el grid ASCII; retirada la primitiva (#301), la geometría de la taberna
    // no se mueve: la sigue poniendo el cutaway.
    vegetation_zones: [{ type: "pino", area: [4, 4, 40, 30], density: 0.08 }],
    entities: [
      // El NPC va VESTIDO y con oficio, como lo declara el motor de verdad:
      // `description` es el prompt de su skin y `role` el preset de conducta
      // (vocabulario cerrado NPC_ROLES). Sin los dos, el bench mediría un
      // mundo donde todos son el mismo aldeano anónimo — que es el bug #173.
      //
      // Y una advertencia sobre lo que ESTE fichero NO puede probar: al
      // llevarlos escritos a mano, la batería de qa/ seguiría verde si
      // mañana el contrato dejara de pedirlos. Quien sujeta eso es el
      // candado de deriva de nefan-core/test/contract-prompts.test.ts (el
      // enum del tool == NPC_ROLES, y el prompt nombrando los dos campos);
      // el bench no es una segunda red ahí, es el doble de un motor
      // conforme.
      // FUERA de la taberna, junto a su esquina sureste y en campo abierto, y
      // eso es parte del doble: hasta el 2026-08-26 nacía en la celda [60, 52],
      // que cae DENTRO del `mostrador` (`rect [55, 51, 6, 2]`). Un NPC
      // empotrado en un sólido puede salir pero no entrar
      // (`terrain-collision.ts`, «celda que ya solapábamos no bloquea la
      // salida»), así que se despegaba 0,73 m y ahí se quedaba: encajonado
      // entre el mostrador y el muro norte, en una ranura de 0,5 m por la que
      // su círculo de 0,5 m de radio no cabe. Con eso, el guion 15 medía si un
      // mercader acorralado huye —que no puede— en vez de si huye un mercader
      // (#247). Aquí tiene 12 m de calle por delante y el jugador arranca a
      // 8,3 m, justo la distancia de ataque que el guion busca.
      { id: "barkeep", kind: "npc", name: "Tabernero corpulento", cell: [79, 63], footprint: [1, 1],
        role: "merchant", description: "tabernero corpulento de mandil manchado" },
      // Un HOSTIL declarado como lo declara el motor de verdad: `role:"hostile"`
      // y nada más. Ni bloque `combat`, ni vida, ni `entity_kind` inventado —
      // los números los deriva el core (`combatForHostileRole`), que es justo
      // lo que este doble tiene que ejercer. Hasta el 2026-08-29 el bench no
      // tenía un solo enemigo y por eso ningún guion podía comprobar que algo
      // pierde vida.
      //
      // La celda está elegida, no puesta a ojo. [88,65] cae al SUR de la
      // taberna (rect cols 52..75, filas 48..63), al NORTE de la elipse de
      // matorrales del scatter (filas 68..108) y al SUR de la casa de
      // entramado (filas 38..51): campo abierto, sin nada sólido entre él y el
      // jugador, que arranca en [64,70].
      //
      // Y a 12,5 m, no a 4,5 como estaba el 2026-08-29 hasta que QA lo jugó:
      // eso es FUERA del radio de enganche del hostil (10 m,
      // `HOSTILE_AGGRO_M`), así que una partida nueva no se abre con una pelea
      // que el jugador no ha pedido — se abre con un bandido a la vista, al
      // que hay que acercarse. Con 4,5 m el banco medía una ejecución.
      { id: "bandido_1", kind: "npc", name: "Bandido de camino", cell: [88, 65], footprint: [1, 1],
        role: "hostile", description: "bandido de camino con cota remendada y la cara marcada" },
      { id: "player", kind: "player", name: "Tú", cell: [64, 70], footprint: [1, 1] },
      // Casa declarada como ENTITY (sin volume ni structure): el compositor
      // debe derivarle un edificio con techo — regresión del bug "casas como
      // cuadrados sin proyectar en iso".
      { id: "casa_lenador", kind: "building", name: "casa del leñador", cell: [92, 82], footprint: [20, 14] },
    ],
    ground: BOOTSTRAP_GROUND,
    volumes: BOOTSTRAP_VOLUMES,
    ...BOOTSTRAP_SCATTER,
  };
}

/** Volúmenes del lugar anclado a un tile (generate_tile.place): una casa
 *  grande con puerta al sur y dos anexos, para que se VEA que el tile ES ese
 *  lugar y no campo abierto. */
export function placeVolumes(place: NonNullable<GenerateTile["place"]>) {
  return [
    {
      id: `${place.id}_principal`,
      label: place.name,
      type: "building",
      rect: [50, 50, 28, 18],
      wall_h: 5,
      roof: { kind: "gable", material: "slate" },
      walls: { material: "stone" },
      doors: [{ edge: "s", at: 13, w: 4 }],
    },
    { id: `${place.id}_anexo`, label: "anexo", type: "building", rect: [82, 56, 12, 10], doors: [{ edge: "w", at: 4, w: 3 }] },
    { id: `${place.id}_pozo`, label: "pozo", type: "prop", at: [52, 82], shape: "cylinder", h: 1.2, color: "#7b7268" },
  ];
}

/** Tile normal: continúa cada crossing de los vecinos hasta el borde opuesto
 *  (el camino atraviesa el tile y siembra crecimiento futuro). Sin crossings,
 *  un camino oeste↔este por la fila 64. Si el tile lleva un `place` anclado
 *  (viaje desde el panel «Salidas»), se construye ESE lugar.
 *  Determinista; la memoización vive en el server. */
export function makeTile(gt: GenerateTile) {
  const { tx, ty, neighbors, place } = gt;
  const ground: Record<string, unknown>[] = [];
  for (const [edge, n] of Object.entries(neighbors ?? {}) as [Edge, Neighbor][]) {
    for (const c of n.crossings ?? []) {
      const w = Math.max(2, c.width ?? 2);
      const i = ground.length;
      if (c.type === "river" || c.type === "bridge") {
        // El agua de `ground` es una FORMA, no una polilínea: banda recta que
        // cruza el tile entero a la altura del cruce (misma costura).
        const vertical = edge === "north" || edge === "south";
        ground.push({
          id: `rio_${i}`, kind: "water", label: "río",
          rect: vertical ? [c.at - w / 2, 0, w, 128] : [0, c.at - w / 2, 128, w],
        });
      } else {
        ground.push({
          id: `camino_${i}`, kind: "path", label: "camino",
          points: [edgePoint(edge, c.at), [64, 64], edgePoint(OPP[edge], c.at)],
          w,
        });
      }
    }
  }
  if (ground.length === 0) {
    ground.push({ id: "camino_oe", kind: "path", label: "camino", points: [[0, 64], [128, 64]], w: 2 });
  }
  if (place) {
    // Plaza de tierra ante la puerta, para que el lugar se lea desde arriba.
    ground.push({ id: "plaza_place", kind: "area", label: "plaza", ellipse: { center: [64, 76], rx: 16, ry: 9 }, material: "dirt" });
  }
  return {
    tile: { tx, ty },
    scene_id: `tile_${tx}_${ty}`,
    scene_description: place
      ? `${place.name}: ${place.description || "el lugar al que llegó el jugador"} (bench ${tx}, ${ty}).`
      : `Campo de bench (${tx}, ${ty}).`,
    biome: "grass",
    ground,
    ...(place ? { volumes: placeVolumes(place) } : {}),
    vegetation_zones: [{ type: "abeto", area: [4, 4, 30, 20], density: 0.08 }],
    entities: [
      { id: `hito_${tx}_${ty}`, kind: "prop", name: `hito del tile (${tx},${ty})`, cell: [70, 58], footprint: [1, 1] },
      ...(place
        ? [{ id: `${place.id}_vecino`, kind: "npc", name: `Vecino de ${place.name}`,
            cell: [72, 84], footprint: [1, 1],
            // Un GUARDIA: el único rol con conducta distinta (se planta y
            // entra a la pelea en vez de huir). Es el que hace que el bench
            // recorra el camino entero de #173, no solo el del skin.
            role: "guard", description: `guardia de ${place.name} con lanza y capa parda` }]
        : []),
    ],
  };
}
