// Fake ai_server para bench E2E del bridge SIN LLM ni GPU.
//
// Imita los endpoints que consume nefan-core AiClient:
//   GET  /health                → { status: "ready" }
//   POST /notify_session        → { ok: true }
//   POST /generate_scene        → escena según el request (ver abajo)
//   POST /report_player_choice  → { consequences: [] }
//
// /generate_scene LEE el body y responde como lo haría el motor narrativo:
//   - sin flags            → escena inicial built-in (taberna con patio)
//   - realize_place        → escena memoizada para ese place (campo abierto)
//   - frontier_request     → imita al motor: hace los mismos POST HTTP a la
//     State API que hace narrative-mcp (map_upsert_place + map_link con edge)
//     y responde la escena del place nuevo con el player junto al borde
//     opuesto. Idempotente: newId = `${from}_${edge}` y escena memoizada.
//
// Env:
//   PORT          puerto HTTP (default 18765)
//   SCENE_FILE    escena inicial custom (JSON)
//   STATE_API     State API del bridge (default http://127.0.0.1:9878)
//   FRONTIER_MODE "no_place" | "no_link" — omite pasos para reproducir los
//                 errores fail-loud del handler de frontera en E2E.

import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 18765);
const STATE_API = process.env.STATE_API ?? "http://127.0.0.1:9878";
const FRONTIER_MODE = process.env.FRONTIER_MODE ?? "";
// Retardo artificial en fronteras (ms) — simula los minutos del motor real
// para poder observar el velo/freeze en E2E. 0 = instantáneo.
const FRONTIER_DELAY_MS = Number(process.env.FRONTIER_DELAY_MS ?? 0);
// Retardo artificial de TODO /generate_scene (ms), ANTES de responder nada
// (ni cabeceras): reproduce las esperas de minutos del motor real. Regresión
// del headersTimeout de undici (300 s) en el fetch del bridge.
const SCENE_DELAY_MS = Number(process.env.SCENE_DELAY_MS ?? 0);

// ── Skin de sprite sheets (bench del cliente 2D, sin GPU) ────────────────
// POST /skin_sprite_sheet: en vez del img2img real, el "skin" son los frames
// de OTRO modelo (SKIN_SPRITE_MODEL, default paladin — solo tiene idle) para
// que la sustitución base→skin sea VISIBLE en el cliente. Las anims sin
// sheet del modelo responden 500, ejercitando la cancelación de la cola de
// skins del cliente (character-sprites.ts).
const SKIN_SPRITE_MODEL = process.env.SKIN_SPRITE_MODEL ?? "paladin";
let fakeDevCacheEnabled = false;
const SPRITES_DIR = fileURLToPath(new URL("../nefan-html/public/sprites/", import.meta.url));

const BUILTIN_SCENE = {
  scene_id: "taberna_bench",
  place_id: "taberna_bench_place",
  scene_description: "Una taberna de bench con patio y camino al sur.",
  size: { cols: 28, rows: 16, meters_per_cell: 0.5 },
  terrain: Array.from({ length: 16 }, () => "g".repeat(28)),
  terrain_legend: {},
  structures: [
    { type: "room", rect: [4, 2, 20, 10], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 9, width: 2 }] },
  ],
  terrain_features: [
    { type: "path", points: [[14, 12], [14, 16]], width: 1.5 },
  ],
  vegetation_zones: [
    { type: "pino", area: [0, 12, 28, 4], density: 0.08 },
  ],
  entities: [
    { id: "mostrador", kind: "prop", name: "mostrador de roble", cell: [6, 3], footprint: [6, 1], glyph: "=" },
    { id: "barkeep", kind: "npc", name: "Tabernero corpulento", cell: [9, 4], footprint: [1, 1], glyph: "n" },
    { id: "antorcha_1", kind: "decor", name: "antorcha de pared", cell: [8, 3], footprint: [1, 1], glyph: "i", attach: "wall" },
    { id: "player", kind: "player", name: "Tú", cell: [13, 13], footprint: [1, 1], glyph: "@" },
  ],
  ambient_event: "El fuego crepita dentro.",
};

const initialScene = process.env.SCENE_FILE
  ? JSON.parse(readFileSync(process.env.SCENE_FILE, "utf8"))
  : BUILTIN_SCENE;

/** Celda de entrada del player en un grid 28x16 según el borde OPUESTO al
 *  cruzado (cruzó east ⇒ entra por el west del mapa nuevo). */
const ENTRY_CELL = {
  east: [2, 8],   // cruzó east → entra por el oeste
  west: [25, 8],
  south: [13, 2], // cruzó south → entra por el norte
  north: [13, 13],
};

/** Escena de campo abierto para places realizados/frontera: transitable de
 *  borde a borde, con un camino que vuelve hacia el lado de entrada. */
function openFieldScene(placeId, name, crossedEdge) {
  const [pc, pr] = crossedEdge ? ENTRY_CELL[crossedEdge] : [13, 8];
  return {
    scene_id: `scene_${placeId}`,
    place_id: placeId,
    scene_description: `${name} — campo abierto de bench.`,
    size: { cols: 28, rows: 16, meters_per_cell: 0.5 },
    terrain: Array.from({ length: 16 }, () => "g".repeat(28)),
    terrain_legend: {},
    terrain_features: [
      { type: "path", points: [[pc, pr], [14, 8]], width: 1.2 },
    ],
    vegetation_zones: [
      { type: "abeto", area: [0, 0, 28, 3], density: 0.1 },
    ],
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [pc, pr], footprint: [1, 1], glyph: "@" },
    ],
    ambient_event: "El viento peina la hierba.",
  };
}

/** Escenas ya servidas (idempotencia en retries y re-entradas). */
const sceneByPlace = new Map();

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
 *  estanque al oeste y — a propósito — la capa #deck VACÍA: el mock de
 *  /review_scene_blueprint devuelve el fix que añade el embarcadero sobre el
 *  agua, para ejercitar el retoque E2E) + volúmenes tipados (taberna cutaway
 *  con puerta sur, mostrador, pinos). El cliente compone el blueprint con la
 *  perspectiva de la sesión.  */
// Sin rect de fondo: el compositor pone el bioma con su textura (manchas,
// flores) y el arte del LLM dibuja SOLO features encima. El bootstrap es el
// PUEBLO de las demos del blueprint lab (taberna cutaway amueblada, plaza
// empedrada con fuente, casa de entramado, muralla sur con torres y puerta,
// mercado) — el bench de calidad visual del compositor, comparable 1:1 con
// referencia.html. Camino con doble trazo, plaza con adoquines.
const COBBLES = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  const r = 3 + (i % 3) * 3.4;
  const cx = (64 + Math.cos(a) * r * 1.9).toFixed(1);
  const cy = (80 + Math.sin(a) * r).toFixed(1);
  const tone = ["#8f887a", "#b0a999", "#988f7e"][i % 3];
  return `<ellipse cx="${cx}" cy="${cy}" rx="1.4" ry="0.9" fill="${tone}" opacity="0.85"/>`;
}).join("");
const BOOTSTRAP_MAP_GROUND =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
  '<g id="ground">' +
  // camino N-S que cruza el pueblo y sale por la puerta sur de la muralla
  '<path d="M64,30 L64,128" fill="none" stroke="#8a7650" stroke-width="5.4" stroke-linecap="round" opacity="0.6"/>' +
  '<path d="M64,30 L64,128" fill="none" stroke="#a29b8b" stroke-width="4" stroke-linecap="round"/>' +
  // ramal este hacia el vecino
  '<path d="M64,80 C84,84 110,86 128,88" fill="none" stroke="#8a7650" stroke-width="4.6" stroke-linecap="round" opacity="0.6"/>' +
  '<path d="M64,80 C84,84 110,86 128,88" fill="none" stroke="#a89162" stroke-width="3.4" stroke-linecap="round"/>' +
  // plaza empedrada con adoquines
  '<ellipse cx="64" cy="80" rx="15" ry="8.5" fill="#8f887a"/>' +
  '<ellipse cx="64" cy="80" rx="14" ry="7.8" fill="#a29b8b"/>' +
  COBBLES +
  // tierra pisada ante la puerta de la taberna y orilla del estanque
  '<ellipse cx="65" cy="66" rx="6" ry="3" fill="#a89162" opacity="0.55"/>' +
  '<ellipse cx="26" cy="94" rx="12" ry="8" fill="#b8ab8a" opacity="0.5"/>' +
  "</g>" +
  '<g id="water"><ellipse cx="25" cy="92" rx="9" ry="5.5" fill="#4d7fa8"/></g>' +
  '<g id="deck"/>' +
  "</svg>";

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
  },
  // ── mercado junto a la plaza ──
  { id: "puesto_mercado", label: "puesto de mercado", type: "prop", rect: [80, 74, 7, 4], shape: "box", h: 3, color: "#8a6a40" },
  { id: "caja_mercado", label: "caja de fruta", type: "prop", at: [88.5, 76.5], shape: "box", h: 1.2, color: "#a8853f" },
  { id: "carro", label: "carro de mano", type: "prop", rect: [44, 76, 6, 3.4], shape: "box", h: 2, color: "#77572f" },
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
];

/** Tile de bootstrap (0,0): la taberna estampada en el plano + camino al este. */
function bootstrapTile() {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    place_id: "taberna_bench_place",
    scene_description: "Claro de la taberna de bench en el plano continuo.",
    biome: "grass",
    structures: [
      { type: "room", rect: [52, 48, 24, 16], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 11, width: 2 }] },
    ],
    terrain_features: [
      { type: "path", points: [[64, 64], [64, 90], [128, 100]], width: 2, at_edges: [{ edge: "east", at: 100 }] },
    ],
    vegetation_zones: [{ type: "pino", area: [4, 4, 40, 30], density: 0.08 }],
    entities: [
      { id: "barkeep", kind: "npc", name: "Tabernero corpulento", cell: [60, 52], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [64, 70], footprint: [1, 1], glyph: "@" },
      // Casa declarada como ENTITY (sin volume ni structure): el compositor
      // debe derivarle un edificio con techo — regresión del bug "casas como
      // cuadrados sin proyectar en iso".
      { id: "casa_lenador", kind: "building", name: "casa del leñador", cell: [92, 82], footprint: [20, 14], glyph: "C" },
    ],
    place_anchors: [{ place_id: "taberna_bench_place", rect: [52, 48, 24, 16] }],
    map_ground: BOOTSTRAP_MAP_GROUND,
    volumes: BOOTSTRAP_VOLUMES,
    ambient_event: "El fuego crepita dentro.",
  };
}

/** Tile normal: continúa cada crossing de los vecinos hasta el borde opuesto
 *  (el camino atraviesa el tile y siembra crecimiento futuro). Sin crossings,
 *  un camino oeste↔este por la fila 64. Determinista y memoizado. */
function makeTile(gt) {
  const { tx, ty, neighbors } = gt ?? {};
  const feats = [];
  for (const [edge, n] of Object.entries(neighbors ?? {})) {
    for (const c of n.crossings ?? []) {
      const type = c.type === "river" || c.type === "bridge" ? "river" : "path";
      feats.push({
        type,
        points: [edgePoint(edge, c.at), [64, 64], edgePoint(OPP[edge], c.at)],
        width: Math.max(2, c.width ?? 2),
        at_edges: [{ edge, at: c.at }, { edge: OPP[edge], at: c.at }],
      });
    }
  }
  if (feats.length === 0) {
    feats.push({
      type: "path",
      points: [[0, 64], [128, 64]],
      width: 2,
      at_edges: [{ edge: "west", at: 64 }, { edge: "east", at: 64 }],
    });
  }
  return {
    tile: { tx, ty },
    scene_id: `tile_${tx}_${ty}`,
    scene_description: `Campo de bench (${tx}, ${ty}).`,
    biome: "grass",
    terrain_features: feats,
    vegetation_zones: [{ type: "abeto", area: [4, 4, 30, 20], density: 0.08 }],
    entities: [
      { id: `hito_${tx}_${ty}`, kind: "prop", name: `hito del tile (${tx},${ty})`, cell: [70, 58], footprint: [1, 1], glyph: "o" },
    ],
    ambient_event: "El viento peina la hierba.",
  };
}

async function handleGenerateTile(gt) {
  // Visibilidad del "mapa real": lo que el bridge resume de los análisis de
  // imagen de los vecinos (mundo derivado). El motor real lo usa para
  // continuar murallas/ríos; aquí solo se loguea.
  for (const [edge, n] of Object.entries(gt?.neighbors ?? {})) {
    if (n?.image_elements?.length) {
      const desc = n.image_elements
        .map((e) => `${e.label}${e.solid ? "·sólido" : ""}${e.tall ? "·alto" : ""}@${e.at[0]}..${e.at[1]}`)
        .join(", ");
      console.error(`[fake-ai] tile(${gt.tx},${gt.ty}) vecino ${edge} image_elements: ${desc}`);
    }
  }
  if (TILE_DELAY_MS > 0 && !gt?.bootstrap) await new Promise((r) => setTimeout(r, TILE_DELAY_MS));
  if (TILE_MODE === "error" && !gt?.bootstrap) {
    throw new Error("fake-ai: TILE_MODE=error — el motor rechazó el tile");
  }
  if (gt?.bootstrap) {
    // Como el motor real: crear el place del arranque en el world map.
    await statePost("/map/place", {
      id: "taberna_bench_place",
      kind: "settlement",
      parent_id: "world",
      name: "Taberna del bench",
    }).catch((err) => console.error("[fake-ai] bootstrap place:", err.message));
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

/** Imita el contrato FRONTIER del motor: crea place + link (con edge) vía la
 *  State API y devuelve la escena del place nuevo. */
async function handleFrontier(frontier) {
  if (FRONTIER_DELAY_MS > 0) await new Promise((r) => setTimeout(r, FRONTIER_DELAY_MS));
  const { from_place_id: from, edge } = frontier;
  const newId = `${from}_${edge}`;
  const name = `Más allá (${edge})`;

  if (FRONTIER_MODE !== "no_place") {
    // Parent del place nuevo = parent del place de origen (hermanos).
    let parentId = "world";
    const res = await fetch(`${STATE_API}/map/place/${encodeURIComponent(from)}`);
    if (res.ok) {
      const info = await res.json();
      parentId = info.place?.parent_id ?? "world";
    }
    await statePost("/map/place", { id: newId, kind: "landmark", parent_id: parentId, name });
    if (FRONTIER_MODE !== "no_link") {
      await statePost("/map/link", { from, to: newId, kind: "path", edge });
    }
  }

  if (!sceneByPlace.has(newId)) sceneByPlace.set(newId, openFieldScene(newId, name, edge));
  return sceneByPlace.get(newId);
}

// --- Imágenes de escena (mock del pipeline Meshy, sin créditos) ---
// /generate_scene_image devuelve el PROPIO esquema como "imagen": el cliente
// la instala 1:1 y cualquier desalineación del recorte/bandas se ve a ojo.
// Guardado en memoria por sha256[:16] y servido por /cache/scene/{hash}.
const sceneImages = new Map();

// Sprites de recorte falsos: PNGs 1×1 semitransparentes (cian, naranja,
// magenta, verde) que el cliente estira al bbox del occluder.
const FAKE_SPRITES = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMIuHOnBwAGHQKV3JjdWwAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGN4tsCmBwAGgQJPjhIj/wAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4E3WnBwAGxwKfkjsaLAAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPIO5HXAwAFfQIxxipcbgAAAABJRU5ErkJggg==",
].map((b64) => Buffer.from(b64, "base64"));

/** Placa de fondo falsa: 1×1 verde hierba (el cliente lo estira al tile). */
const FAKE_PLATE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMIKTIGAAIXAPrbayeaAAAAAElFTkSuQmCC",
  "base64",
);

/** Dimensiones de un PNG (IHDR: width/height big-endian en bytes 16..23). */
function pngDims(imageB64) {
  const b64 = String(imageB64 ?? "").replace(/^data:image\/png;base64,/, "");
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452 /* "IHDR" */) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const server = http.createServer((req, res) => {
  // CORS: el navegador (cliente 2D) llama cross-origin; el bridge server-side
  // lo ignora. ACAO en TODAS las respuestas + preflight OPTIONS.
  const cors = {
    "Access-Control-Allow-Origin": "*",
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
  // Toggle del dev API cache (espejo trivial del ai_server real, en memoria):
  // el fake no llama APIs de pago, pero el checkbox del cliente debe operar.
  if (req.method === "GET" && req.url === "/dev/api_cache") {
    return send(200, { enabled: fakeDevCacheEnabled, channels: {} });
  }
  if (req.method === "GET" && req.url?.startsWith("/cache/scene/")) {
    const hash = req.url.slice("/cache/scene/".length);
    const png = sceneImages.get(hash);
    if (!png) return send(404, { detail: `fake-ai: imagen ${hash} no encontrada` });
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(png);
  }
  if (req.method === "GET" && req.url?.startsWith("/fake/sprite/")) {
    const idx = Number(req.url.slice("/fake/sprite/".length));
    const png = FAKE_SPRITES[idx];
    if (!png) return send(404, { detail: `fake-ai: sprite ${idx} no existe` });
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(png);
  }
  if (req.method === "GET" && req.url === "/fake/plate") {
    res.writeHead(200, { "Content-Type": "image/png", ...cors });
    return res.end(FAKE_PLATE);
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
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    void (async () => {
      console.error(`[fake-ai] ${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === "/notify_session") return send(200, { ok: true });
      if (req.method === "POST" && req.url === "/report_player_choice") return send(200, { consequences: [] });
      if (req.method === "POST" && req.url === "/dev/api_cache") {
        try {
          fakeDevCacheEnabled = !!JSON.parse(raw || "{}").enabled;
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        return send(200, { enabled: fakeDevCacheEnabled, channels: {} });
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
        return send(200, { ok: true, meta, frame_urls });
      }
      if (req.method === "POST" && req.url === "/generate_scene_image") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const b64 = String(body.image_b64 ?? "").replace(/^data:image\/png;base64,/, "");
        if (!b64) return send(422, { detail: "fake-ai: image_b64 requerido" });
        const png = Buffer.from(b64, "base64");
        const hash = createHash("sha256").update(png).digest("hex").slice(0, 16);
        sceneImages.set(hash, png);
        console.error(
          `[fake-ai] scene_image ${hash} (${png.length}b` +
          `${body.context_sides?.length ? `, contexto: ${body.context_sides.join("+")}` : ""})`,
        );
        return send(200, { hash, cached: false, scene_url: `/cache/scene/${hash}` });
      }
      // Retoque falso del blueprint: si el map_ground trae la capa #deck
      // vacía (el bug plantado en BOOTSTRAP_MAP_GROUND), el fix añade el
      // embarcadero sobre el estanque; si no, se aprueba. Ejercita la fase
      // "revisión" completa: aplicar, perforar el agua y persistir al bridge.
      if (req.method === "POST" && req.url === "/review_scene_blueprint") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const svg = body.scene?.map_ground;
        if (typeof svg === "string" && svg.includes('<g id="deck"/>')) {
          console.error("[fake-ai] review: deck vacío → fix con embarcadero");
          return send(200, {
            approved: false,
            issues: ["el embarcadero no está dibujado sobre el estanque (capa deck vacía)"],
            fixes: {
              map_ground: svg.replace(
                '<g id="deck"/>',
                '<g id="deck"><rect x="36" y="87.5" width="7" height="3" fill="#8a6238"/></g>',
              ),
            },
          });
        }
        console.error("[fake-ai] review: aprobado");
        return send(200, { approved: true, issues: [] });
      }
      // Análisis falso (mundo derivado de imagen): 3 segmentos fijos con
      // sprites de color plano (1×1 estirado por el cliente): árbol
      // (solid+tall), roca (solid), estandarte (tall). Posiciones en fracción
      // del tamaño de la imagen, lejos del spawn central. Verifica a ojo el
      // overlay B (celdas violetas, recortes con etiqueta/baseline) y la
      // colisión derivada sin gastar créditos fal/visión.
      if (req.method === "POST" && req.url === "/analyze_scene_image") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const dims = pngDims(body.image_b64);
        if (!dims) return send(422, { detail: "fake-ai: image_b64 no es un PNG" });
        const { w, h } = dims;
        const segments = [
          { id: "seg_0", label: "árbol", solid: true, tall: true, box: [0.15, 0.60, 0.14, 0.16] },
          // La roca TOCA el borde derecho (este): al generar el tile vecino,
          // el bridge debe pasarla como image_elements de la costura.
          { id: "seg_1", label: "roca", solid: true, tall: false, box: [0.91, 0.40, 0.09, 0.18] },
          { id: "seg_2", label: "estandarte", solid: false, tall: true, box: [0.64, 0.22, 0.06, 0.12] },
        ].map((s, i) => ({
          id: s.id,
          label: s.label,
          solid: s.solid,
          tall: s.tall,
          sprite_url: `/fake/sprite/${i % FAKE_SPRITES.length}`,
          image_bbox: [
            Math.round(s.box[0] * w), Math.round(s.box[1] * h),
            Math.round(s.box[2] * w), Math.round(s.box[3] * h),
          ],
          img_w: w,
          img_h: h,
        }));
        console.error(`[fake-ai] analyze: ${segments.length} segmentos jugables`);
        return send(200, { segments, discarded: 5 });
      }
      // Placa de fondo falsa (inpainting de huecos): un 1×1 verde hierba que
      // el cliente estira como imagen base del tile. Basta para verificar el
      // flujo entero (máscara → endpoint → instalación) y a ojo: al fundirse
      // un cutout por proximidad se ve el verde plano de la placa, no una
      // copia del objeto.
      if (req.method === "POST" && req.url === "/inpaint_scene_plate") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        if (!pngDims(body.image_b64) || !pngDims(body.mask_b64)) {
          return send(422, { detail: "fake-ai: image_b64 y mask_b64 deben ser PNG" });
        }
        console.error("[fake-ai] inpaint_scene_plate: placa 1×1 verde");
        return send(200, { hash: "fakeplate", cached: false, plate_url: "/fake/plate" });
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
        if (body.frontier_request) {
          try {
            return send(200, await handleFrontier(body.frontier_request));
          } catch (err) {
            console.error(`[fake-ai] frontera falló:`, err.message);
            return send(500, { detail: err.message });
          }
        }
        if (body.realize_place?.id) {
          const id = body.realize_place.id;
          if (!sceneByPlace.has(id)) {
            sceneByPlace.set(id, openFieldScene(id, body.realize_place.name ?? id, null));
          }
          return send(200, sceneByPlace.get(id));
        }
        return send(200, initialScene);
      }
      send(404, { detail: `fake-ai-server: ruta desconocida ${req.method} ${req.url}` });
    })();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(
    `[fake-ai] escuchando en http://127.0.0.1:${PORT} (state API: ${STATE_API}` +
    `${FRONTIER_MODE ? `, FRONTIER_MODE=${FRONTIER_MODE}` : ""})`,
  );
});
