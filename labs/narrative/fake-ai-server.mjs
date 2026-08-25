// Fake ai_server para bench E2E del bridge SIN LLM ni GPU.
//
// Imita los endpoints que consume nefan-core AiClient:
//   GET  /health                → { status: "ready" }
//   POST /notify_session        → { ok: true }
//   POST /generate_scene        → escena según el request (ver abajo)
//   POST /report_player_choice  → { consequences: [] }
//
// /generate_scene LEE el body y responde como lo haría el motor narrativo.
// Format D tiene UNA variante y el fake solo sirve esa:
//   - generate_tile        → tile del plano continuo (bootstrap o normal)
//   - cualquier otra cosa  → 422, igual que el gate del contrato: la escena
//     "suelta" y el plató proscenio se retiraron.
//
// Env:
//   PORT          puerto HTTP (default 18765)
//   STATE_API     State API del bridge (default http://127.0.0.1:9878)

import http from "node:http";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 18765);
const STATE_API = process.env.STATE_API ?? "http://127.0.0.1:9878";
// Retardo artificial de TODO /generate_scene (ms), ANTES de responder nada
// (ni cabeceras): reproduce las esperas de minutos del motor real. Regresión
// del headersTimeout de undici (300 s) en el fetch del bridge.
const SCENE_DELAY_MS = Number(process.env.SCENE_DELAY_MS ?? 0);

// ── Skin de sprite sheets (bench del cliente, sin GPU) ────────────────
// POST /skin_sprite_sheet: en vez del img2img real, el "skin" son los frames
// de OTRO modelo (SKIN_SPRITE_MODEL, default paladin — solo tiene idle) para
// que la sustitución base→skin sea VISIBLE en el cliente. Las anims sin
// sheet del modelo responden 500, ejercitando la cancelación de la cola de
// skins del cliente (character-sprites.ts).
const SKIN_SPRITE_MODEL = process.env.SKIN_SPRITE_MODEL ?? "paladin";
let fakeDevCacheEnabled = false;
/** Turnos de diálogo servidos (el texto los numera: se ve el ida y vuelta). */
let fakeDialogueTurn = 0;
const SPRITES_DIR = fileURLToPath(new URL("../../nefan-html/public/sprites/", import.meta.url));
// Imágenes de los packs de estilo (portadas y refs). Son ficheros COMMITEADOS
// del repo, no generación: aquí no se paga ni se inventa nada — se sirve lo
// mismo que serviría el asset-store con GET /styles/{id}/{file}.
const STYLES_DIR = fileURLToPath(new URL("../../nefan-core/data/styles/", import.meta.url));
/** `path.extname` sin importar `node:path`: la extensión en minúsculas, y ""
 *  cuando no hay (incluido el fichero-punto `.jpg`, que para `extname` NO
 *  tiene extensión). El original llama a `extname`; escribirlo «parecido» era
 *  otra vía de desvío, así que se escribe la regla entera. */
function extension(file) {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
}

/** Mismos tipos y mismo filtro de nombre que `readStyleFile` / `SAFE_ID`. */
const STYLE_FILE_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

// ── Tiles del plano continuo ─────────────────────────────────────────────
// TILE_DELAY_MS: retardo por tile (simula el motor real). TILE_MODE=error →
// HTTP 500 en tiles no-bootstrap (test de reintento del cliente).
const TILE_DELAY_MS = Number(process.env.TILE_DELAY_MS ?? 0);
const TILE_MODE = process.env.TILE_MODE ?? "";
const tileByKey = new Map();

/** Punto de una feature sobre la línea del borde (celdas, floats ok). */
function edgePoint(edge, at) {
  switch (edge) {
    case "west": return [0, at];
    case "east": return [128, at];
    case "north": return [at, 0];
    case "south": return [at, 128];
  }
}
const OPP = { west: "east", east: "west", north: "south", south: "north" };

/** Plan del bootstrap: arte plano del suelo (camino que copia la feature,
 *  estanque al oeste) + volúmenes tipados (taberna cutaway
 *  con puerta sur, mostrador, pinos). El cliente compone el blueprint con la
 *  perspectiva de la sesión.  */
// Sin rect de fondo: el compositor pone el bioma con su textura (manchas,
// flores) y los rasgos declarativos del LLM van encima. El bootstrap es el
// PUEBLO de las demos del blueprint lab (taberna cutaway amueblada, plaza
// empedrada con fuente, casa de entramado, muralla sur con torres y puerta,
// mercado) — el bench de calidad visual, comparable 1:1 con referencia.html.
const BOOTSTRAP_GROUND = [
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

const BOOTSTRAP_VOLUMES = [
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
const BOOTSTRAP_SCATTER = {
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

/** Tile de bootstrap (0,0): la taberna estampada en el plano + camino al este. */
function bootstrapTile() {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    place_id: "taberna_bench_place",
    scene_description: "Claro de la taberna de bench en el plano continuo.",
    // Ref de estilo elegida "por el motor" (id del catálogo del pack): el
    // bench ejercita el camino explícito además del fallback.
    style_ref: "settlement",
    biome: "grass",
    structures: [
      { type: "room", rect: [52, 48, 24, 16], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 11, width: 2 }] },
    ],
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
      { id: "barkeep", kind: "npc", name: "Tabernero corpulento", cell: [60, 52], footprint: [1, 1], glyph: "n",
        role: "merchant", description: "tabernero corpulento de mandil manchado" },
      { id: "player", kind: "player", name: "Tú", cell: [64, 70], footprint: [1, 1], glyph: "@" },
      // Casa declarada como ENTITY (sin volume ni structure): el compositor
      // debe derivarle un edificio con techo — regresión del bug "casas como
      // cuadrados sin proyectar en iso".
      { id: "casa_lenador", kind: "building", name: "casa del leñador", cell: [92, 82], footprint: [20, 14], glyph: "C" },
    ],
    place_anchors: [{ place_id: "taberna_bench_place", rect: [52, 48, 24, 16] }],
    ground: BOOTSTRAP_GROUND,
    volumes: BOOTSTRAP_VOLUMES,
    ...BOOTSTRAP_SCATTER,
    ambient_event: "El fuego crepita dentro.",
  };
}

/** Volúmenes del lugar anclado a un tile (generate_tile.place): una casa
 *  grande con puerta al sur y dos anexos, para que se VEA que el tile ES ese
 *  lugar y no campo abierto. */
function placeVolumes(place) {
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
 *  Determinista y memoizado. */
function makeTile(gt) {
  const { tx, ty, neighbors, place } = gt ?? {};
  const ground = [];
  for (const [edge, n] of Object.entries(neighbors ?? {})) {
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
    style_ref: place ? "settlement" : "forest",
    biome: "grass",
    ground,
    ...(place ? { volumes: placeVolumes(place) } : {}),
    // El motor acota DÓNDE vive el lugar dentro del tile: el bridge afina el
    // anclaje con esto y el jugador aparece dentro, no en el centro geométrico.
    ...(place ? { place_anchors: [{ place_id: place.id, rect: [48, 68, 32, 20] }] } : {}),
    vegetation_zones: [{ type: "abeto", area: [4, 4, 30, 20], density: 0.08 }],
    entities: [
      { id: `hito_${tx}_${ty}`, kind: "prop", name: `hito del tile (${tx},${ty})`, cell: [70, 58], footprint: [1, 1], glyph: "o" },
      ...(place
        ? [{ id: `${place.id}_vecino`, kind: "npc", name: `Vecino de ${place.name}`,
            cell: [72, 84], footprint: [1, 1], glyph: "n",
            // Un GUARDIA: el único rol con conducta distinta (se planta y
            // entra a la pelea en vez de huir). Es el que hace que el bench
            // recorra el camino entero de #173, no solo el del skin.
            role: "guard", description: `guardia de ${place.name} con lanza y capa parda` }]
        : []),
    ],
    ambient_event: place ? `Llegas a ${place.name}.` : "El viento peina la hierba.",
  };
}

async function handleGenerateTile(gt) {
  if (TILE_DELAY_MS > 0 && !gt?.bootstrap) await new Promise((r) => setTimeout(r, TILE_DELAY_MS));
  if (TILE_MODE === "error" && !gt?.bootstrap) {
    throw new Error("fake-ai: TILE_MODE=error — el motor rechazó el tile");
  }
  if (gt?.bootstrap) {
    // Como el motor real: sembrar el world map con las map tools. Dos places
    // y un link — el segundo NO se realiza aquí: es el destino del panel
    // «Salidas», que se ancla a un tile libre al viajar.
    await statePost("/map/place", {
      id: "taberna_bench_place",
      kind: "settlement",
      parent_id: "world",
      name: "Taberna del bench",
    }).catch((err) => console.error("[fake-ai] bootstrap place:", err.message));
    await statePost("/map/place", {
      id: "molino_bench_place",
      kind: "settlement",
      parent_id: "world",
      name: "Molino del bench",
      description: "Un molino de agua río abajo, con su presa y cuatro casas alrededor.",
    }).catch((err) => console.error("[fake-ai] bootstrap place:", err.message));
    await statePost("/map/link", {
      from: "taberna_bench_place",
      to: "molino_bench_place",
      kind: "road",
      edge: "east",
      travel_hours: 2,
      description: "El camino del este, siguiendo el río.",
    }).catch((err) => console.error("[fake-ai] bootstrap link:", err.message));
    return bootstrapTile();
  }
  const key = `tile_${gt.tx}_${gt.ty}`;
  if (!tileByKey.has(key)) tileByKey.set(key, makeTile(gt));
  return tileByKey.get(key);
}

async function statePost(path, body) {
  const res = await fetch(`${STATE_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`fake-ai: ${path} → HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ── Atlas de superficies fps: celdas como PNG de damero del color base ──
// (plumbing E2E sin créditos: identidad por desc+estilo, cached en la 2ª
// petición, servidas por /cache/surface/{hash} como el asset-store real).
const surfaceImages = new Map();

/** PNG RGB válido generado a pelo (zlib): damero 2 tonos del color base. */
function checkerPng(hexColor, size = 64, cells = 8) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const lite = [Math.min(255, r + 25), Math.min(255, g + 25), Math.min(255, b + 25)];
  const dark = [Math.max(0, r - 25), Math.max(0, g - 25), Math.max(0, b - 25)];
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const c = ((x * cells / size) | 0) + ((y * cells / size) | 0);
      const [cr, cg, cb] = c % 2 === 0 ? lite : dark;
      const o = row + 1 + x * 3;
      raw[o] = cr; raw[o + 1] = cg; raw[o + 2] = cb;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const server = http.createServer((req, res) => {
  // CORS: el navegador (cliente) llama cross-origin; el bridge server-side
  // lo ignora. ACAO en TODAS las respuestas + preflight OPTIONS.
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") return send(200, { status: "ready" });
  // Unpin fake (batch "aplicar estilo" — el re-pin va por POST /assets/pin).
  if (req.method === "DELETE" && (req.url ?? "").startsWith("/assets/pin/")) {
    return send(200, { ok: true, ref: decodeURIComponent((req.url ?? "").slice("/assets/pin/".length)), removed: 0 });
  }
  // Dry-run del pack de estilo (batch "aplicar estilo" sin créditos).
  if (req.method === "GET" && /^\/styles\/[A-Za-z0-9_.-]+\/missing$/.test(req.url ?? "")) {
    return send(200, {
      style_id: (req.url ?? "").split("/")[2],
      missing: [],
      cost_per_image_usd: 0.18,
      estimated_cost_usd: 0,
    });
  }
  // GET /styles/{style_id}/{file} — la portada del estilo y las refs del pack.
  //
  // Bajo `?ai=`, el cliente resuelve el asset-store a ESTE server (los tres
  // servicios a la vez, service-urls.ts), así que sin esta ruta las cuatro
  // portadas del selector daban 404 en el bench y el título del preset
  // e2e-sin-creditos se abría con cuatro marcos rotos (#218). Va DESPUÉS de
  // /styles/{id}/missing, que es otra ruta y no lleva extensión.
  //
  // Se COPIA el contrato de `readStyleFile` (nefan-core/services/asset-store/
  // blob-store.ts), no se importa: el fake es .mjs y el único JS de nefan-core
  // es `dist/`, que el preset e2e-sin-creditos no construye. Si aquella cambia
  // (MIME nuevo, dos subcarpetas), esto se queda atrás — lo caza el guion 26,
  // que exige una portada REAL pintada.
  if (req.method === "GET" && /^\/styles\//.test(req.url ?? "")) {
    // Las tres líneas siguientes son las de `http-server.ts:82-85`, COPIADAS
    // TAL CUAL, y esa literalidad es el arreglo: la primera versión de esta
    // ruta las escribió «a su manera» (con `decodeURIComponent` por segmento y
    // sin recortar la barra final) y se desvió del original en dos casos el
    // mismo día — `cover%2Ejpg` daba 200 donde el real da 400, y una barra
    // final daba 400 donde el real da 200 (QA C4). `new URL` normaliza además
    // `..` y `%2e%2e`; los checks por segmento son defensa en profundidad,
    // como en el original.
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const partes = path.split("/").filter(Boolean);
    if (partes.length === 3 || partes.length === 4) {
      const [, styleId, ...resto] = partes;
      const file = resto.join("/");
      const mime = STYLE_FILE_MIME[extension(file)];
      const seguro = partes.slice(1).every((s) => SAFE_ID.test(s) && !s.includes(".."));
      if (!mime || !seguro) {
        return send(400, { ok: false, error: "expected GET /styles/{style_id}/{file.(jpg|png|webp|json)}" });
      }
      const fichero = `${STYLES_DIR}${styleId}/${file}`;
      if (!existsSync(fichero) || !statSync(fichero).isFile()) {
        return send(404, { ok: false, error: `style file not found: ${styleId}/${file}` });
      }
      const cuerpo = readFileSync(fichero);
      res.writeHead(200, {
        "Content-Type": mime,
        // El real lo manda (`Content-Length: r.body.byteLength`); sin él esto
        // salía chunked. No lo nota un <img>, pero la ruta existe para
        // PARECERSE al original, y una diferencia que nadie mide es la que
        // luego explica una hora de bench.
        "Content-Length": cuerpo.byteLength,
        "Cache-Control": "max-age=300",
        ...cors,
      });
      return res.end(cuerpo);
    }
  }
  // Contadores del estado de proceso del fake (qa/run.mjs --diag): mirar sin
  // tocar. Va aparte de /dev/status a propósito — ese espeja un contrato real
  // del ai_server y no puede llevar campos que solo existen en el bench.
  if (req.method === "GET" && req.url === "/dev/counters") {
    return send(200, {
      tiles: tileByKey.size,
      surfaces: surfaceImages.size,
      dialogueTurn: fakeDialogueTurn,
      apiCache: fakeDevCacheEnabled,
    });
  }
  // Toggle del dev API cache (espejo trivial del ai_server real, en memoria):
  // el fake no llama APIs de pago, pero el checkbox del cliente debe operar.
  if (req.method === "GET" && req.url === "/dev/api_cache") {
    return send(200, { enabled: fakeDevCacheEnabled, channels: {} });
  }
  // Estado agregado del panel de dev (contrato DevStatus): el fake no gasta
  // créditos, así el E2E ejercita el panel con spend 0 y claves "presentes".
  if (req.method === "GET" && req.url === "/dev/status") {
    return send(200, {
      api_cache: { enabled: fakeDevCacheEnabled, channels: {} },
      spend: { total_usd: 0, call_count: 0, calls: [] },
      config: {
        scene_model: "fake-scene-model",
        sprite_skin_model: "fake-skin-model",
        usd_eur_rate: 0.86,
      },
      keys: { meshy: true, fal: true },
    });
  }
  if (req.method === "GET" && req.url?.startsWith("/cache/surface/")) {
    const hash = req.url.slice("/cache/surface/".length);
    const png = surfaceImages.get(hash);
    if (!png) return send(404, { detail: `fake-ai: superficie ${hash} no encontrada` });
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(png);
  }
  if (req.method === "GET" && req.url?.startsWith("/cache/sprite_sheet/fake/")) {
    const rel = req.url.slice("/cache/sprite_sheet/fake/".length);
    if (!/^[a-z0-9_]+\/[a-z0-9_]+\/dir_\d+_frame_\d{3}\.png$/.test(rel)) {
      return send(400, { detail: `fake-ai: ruta de frame inválida ${rel}` });
    }
    const file = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/${rel}`;
    if (!existsSync(file)) return send(404, { detail: `fake-ai: frame ${rel} no existe` });
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(readFileSync(file));
  }
  // Hero-shot de identidad (retrato del diálogo): en el bench no hay Meshy,
  // así que se sirve el frame frontal del personaje de prueba. El cliente lo
  // recorta a busto igual que haría con el hero real.
  if (req.method === "GET" && req.url?.startsWith("/cache/sprite_hero/")) {
    const key = req.url.slice("/cache/sprite_hero/".length);
    if (!/^[0-9a-f]{16}$/.test(key)) return send(400, { detail: "fake-ai: hero key inválida" });
    const file = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/idle/frontal_8/dir_0_frame_000.png`;
    if (!existsSync(file)) return send(404, { detail: `fake-ai: sin frame para el hero ${key}` });
    console.error(`[fake-ai] sprite_hero ${key} (frame frontal de ${SKIN_SPRITE_MODEL})`);
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(readFileSync(file));
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    void (async () => {
      console.error(`[fake-ai] ${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === "/notify_session") return send(200, { ok: true });
      // Mundo de usuario fake (E2E de crear mundo + encadenado generate_game).
      if (req.method === "POST" && req.url === "/develop_world") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        console.error(`[fake-ai] develop_world (${String(body.draft_text ?? "").length} chars)`);
        return send(200, {
          game: {
            game_id: "mundo_bench",
            title: "Mundo del Bench",
            description: "Mundo de prueba desarrollado por el fake.",
            style_id: "acuarela_luminosa",
            world_brief: "b".repeat(150),
            world_md: "# Mundo del Bench\n\n" + "lore del bench. ".repeat(200),
          },
        });
      }
      if (req.method === "POST" && req.url === "/report_player_choice") {
        // Responder con una línea de diálogo (no con silencio): es lo que
        // ejercita el panel, el retrato y las opciones en el E2E sin créditos.
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const speaker = String(body.speaker || "Aldeano");
        fakeDialogueTurn += 1;
        return send(200, {
          consequences: [
            {
              type: "dialogue",
              speaker,
              text:
                `(bench ${fakeDialogueTurn}) Te escucho, forastero. ` +
                `Dijiste: "${String(body.chosenText || body.freeText || "").slice(0, 60)}".`,
              choices: ["Seguir preguntando", "Despedirse"],
            },
          ],
        });
      }
      // Reset del ESTADO DE PROCESO del fake (qa/run.mjs entre guiones). El
      // fake acumula estado que ningún reinicio de página borra —tiles ya
      // servidos, atlas ya "pintados", turnos de diálogo— y con él un guion
      // hereda la caché caliente del anterior: el batch de estilo pide menos
      // páginas de las que su plan anunció y el guion cuenta peticiones que
      // nunca llegan. Reiniciar el proceso entero costaba el arranque del
      // stack; esto cuesta un POST.
      if (req.method === "POST" && req.url === "/dev/reset") {
        const antes = {
          tiles: tileByKey.size,
          surfaces: surfaceImages.size,
          dialogueTurn: fakeDialogueTurn,
          apiCache: fakeDevCacheEnabled,
        };
        tileByKey.clear();
        surfaceImages.clear();
        fakeDialogueTurn = 0;
        fakeDevCacheEnabled = false;
        console.error(`[fake-ai] /dev/reset: ${JSON.stringify(antes)} → todo a cero`);
        return send(200, { ok: true, limpiado: antes });
      }
      if (req.method === "POST" && req.url === "/dev/api_cache") {
        try {
          fakeDevCacheEnabled = !!JSON.parse(raw || "{}").enabled;
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        return send(200, { enabled: fakeDevCacheEnabled, channels: {} });
      }
      if (req.method === "GET" && req.url === "/sprite_catalog") {
        // El catálogo del servicio de sprites, tal como lo reexpone remote-gen.
        // Sin esta ruta el cliente caería a su cota baja de coste y el bench
        // estaría probando el camino de respaldo para siempre en vez del bueno.
        // Los perfiles son los del set que usa el juego: idle 8 keyframes (8
        // llamadas), walk/run 4 (4 lotes de 2 direcciones).
        const perfiles = { idle: [8, 2.2, 8], walk: [4, 3.6, 4], run: [4, 6.0, 4] };
        const animaciones = [];
        for (const [id, [kf, fps, calls]] of Object.entries(perfiles)) {
          const metaPath = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/${id}/frontal_8/meta.json`;
          if (!existsSync(metaPath)) continue; // el catálogo sale del DISCO, como el de verdad
          animaciones.push({ id, keyframes: kf, play_fps: fps, calls_per_anim: calls });
        }
        return send(200, {
          service: "sprite-forge", version: "fake", set: "fake",
          models: [{ id: SKIN_SPRITE_MODEL }],
          animations: animaciones,
          angles: [{ id: "frontal_8", directions: 8 }],
          skin: { enabled: true, api: "fake", ai_model: "gpt-image-2", cost_usd_per_call: 0 },
          warnings: [],
        });
      }
      if (req.method === "POST" && req.url === "/skin_sprite_sheet") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const anim = String(body.anim ?? "");
        const angle = String(body.angle ?? "");
        if (!anim || !angle || !body.prompt) {
          return send(422, { detail: "fake-ai: anim/angle/prompt requeridos" });
        }
        const metaPath = `${SPRITES_DIR}${SKIN_SPRITE_MODEL}/${anim}/${angle}/meta.json`;
        if (!existsSync(metaPath)) {
          return send(500, {
            detail: `fake-ai: ${SKIN_SPRITE_MODEL} no tiene sheet ${anim}/${angle} ` +
              `(esperado en bench: el cliente cancela la cola de ese skin)`,
          });
        }
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        const frame_urls = Array.from({ length: meta.directions }, (_, d) =>
          Array.from({ length: meta.frame_count }, (_, f) =>
            `/cache/sprite_sheet/fake/${anim}/${angle}/dir_${d}_frame_${String(f).padStart(3, "0")}.png`));
        console.error(
          `[fake-ai] skin_sprite_sheet ${anim}/${angle} ← "${String(body.prompt).slice(0, 40)}" ` +
          `(sirviendo frames de ${SKIN_SPRITE_MODEL})`,
        );
        const heroKey = createHash("sha256")
          .update(`${body.prompt}|${angle}|${body.style_id ?? ""}`)
          .digest("hex")
          .slice(0, 16);
        return send(200, {
          ok: true, cached: false, meta, frame_urls,
          hero_key: heroKey, hero_url: `/cache/sprite_hero/${heroKey}`,
        });
      }
      if (req.method === "POST" && req.url === "/generate_surface_atlas") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const cells = Array.isArray(body.cells) ? body.cells : [];
        if (cells.length === 0) return send(422, { detail: "fake-ai: cells requerido" });
        // resolve_only ($0, camino del resume y del plan de "aplicar estilo"):
        // solo lo ya pintado, con el recuento de missing — como el server real.
        const resolveOnly = body.resolve_only === true;
        const out = {};
        let painted = 0;
        let missing = 0;
        for (const cell of cells) {
          const hash = createHash("sha256")
            .update(`${cell.desc}\n${body.style_id ?? ""}\n${cell.mat}\n${cell.ref ?? ""}`)
            .digest("hex")
            .slice(0, 16);
          const cached = surfaceImages.has(hash);
          if (!cached && resolveOnly) {
            missing += 1;
            continue;
          }
          if (!cached) {
            surfaceImages.set(hash, checkerPng(cell.base_color ?? "#808080"));
            painted += 1;
          }
          out[cell.key] = { hash, url: `/cache/surface/${hash}`, cached };
        }
        console.error(
          `[fake-ai] surface_atlas: ${painted} nuevas de ${cells.length} celdas` +
          (resolveOnly ? ` (resolve_only, ${missing} missing)` : ""),
        );
        return send(200, {
          cells: out,
          pages_painted: painted > 0 ? 1 : 0,
          cached: painted === 0,
          cost_usd: 0,
          generation_time_ms: 5,
          missing,
        });
      }
      // Pins del asset-store (batch "aplicar estilo"): en memoria, para que
      // el run del bench termine sin el store real.
      if (req.method === "POST" && req.url === "/assets/pin") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { ok: false, error: "fake-ai: body no es JSON" });
        }
        const hashes = Array.isArray(body.hashes) ? body.hashes : [];
        console.error(`[fake-ai] assets/pin ${body.ref}: ${hashes.length} hashes`);
        return send(200, { ok: true, ref: String(body.ref ?? ""), pinned: hashes.length });
      }
      // Completado fake del pack (batch "aplicar estilo" sin créditos).
      if (req.method === "POST" && /^\/styles\/[A-Za-z0-9_.-]+\/complete$/.test(req.url ?? "")) {
        return send(200, { generated: [], cost_usd: 0, message: "fake: pack ya completo" });
      }
      if (req.method === "POST" && req.url === "/generate_scene") {
        if (SCENE_DELAY_MS > 0) {
          console.error(`[fake-ai] /generate_scene retenido ${SCENE_DELAY_MS} ms (SCENE_DELAY_MS)`);
          await new Promise((r) => setTimeout(r, SCENE_DELAY_MS));
        }
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        if (body.generate_tile) {
          try {
            return send(200, await handleGenerateTile(body.generate_tile));
          } catch (err) {
            console.error(`[fake-ai] tile falló:`, err.message);
            return send(500, { detail: err.message });
          }
        }
        // Sin generate_tile no hay escena que servir: la variante "suelta" y
        // el plató proscenio se retiraron del contrato, así que el fake
        // responde lo mismo que el gate del motor real.
        const pedido = body.realize_place?.id ? ` (realize_place "${body.realize_place.id}")` : "";
        console.error(`[fake-ai] /generate_scene sin generate_tile${pedido} → 422`);
        return send(422, {
          detail:
            "fake-ai: una escena es un tile (generate_tile); la variante suelta y el " +
            `plató proscenio se retiraron del contrato${pedido}`,
        });
      }
      send(404, { detail: `fake-ai-server: ruta desconocida ${req.method} ${req.url}` });
    })();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[fake-ai] escuchando en http://127.0.0.1:${PORT} (state API: ${STATE_API})`);
});
