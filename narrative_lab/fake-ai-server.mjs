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
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 18765);
const STATE_API = process.env.STATE_API ?? "http://127.0.0.1:9878";
const FRONTIER_MODE = process.env.FRONTIER_MODE ?? "";
// Retardo artificial en fronteras (ms) — simula los minutos del motor real
// para poder observar el velo/freeze en E2E. 0 = instantáneo.
const FRONTIER_DELAY_MS = Number(process.env.FRONTIER_DELAY_MS ?? 0);

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
    ],
    place_anchors: [{ place_id: "taberna_bench_place", rect: [52, 48, 24, 16] }],
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
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    void (async () => {
      console.error(`[fake-ai] ${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === "/notify_session") return send(200, { ok: true });
      if (req.method === "POST" && req.url === "/report_player_choice") return send(200, { consequences: [] });
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
      // Segmentación falsa: cada occluder pedido devuelve un sprite de color
      // plano (1×1 estirado por el cliente) con bbox = caja pedida encogida un
      // 8% por lado (simula el ajuste fino de SAM). Sirve para verificar a ojo
      // el overlay B (recortes, baselines, z-index) sin gastar créditos fal.
      if (req.method === "POST" && req.url === "/segment_scene_image") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const dims = pngDims(body.image_b64);
        if (!dims) return send(422, { detail: "fake-ai: image_b64 no es un PNG" });
        const segments = (body.occluders ?? []).map((occ, i) => {
          const [x0, y0, x1, y1] = occ.box_px;
          const inset = 0.08;
          const bx = Math.round(x0 + (x1 - x0) * inset);
          const by = Math.round(y0 + (y1 - y0) * inset);
          const bw = Math.round((x1 - x0) * (1 - 2 * inset));
          const bh = Math.round((y1 - y0) * (1 - 2 * inset));
          return {
            id: occ.id,
            sprite_url: `/fake/sprite/${i % FAKE_SPRITES.length}`,
            image_bbox: [bx, by, bw, bh],
            img_w: dims.w,
            img_h: dims.h,
          };
        });
        console.error(`[fake-ai] segment: ${segments.length} occluders`);
        return send(200, { segments });
      }
      // Descubrimiento falso: 2 props inventados en posiciones fijas (fracción
      // del tamaño de la imagen) que no pisan el centro.
      if (req.method === "POST" && req.url === "/discover_scene_objects") {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(400, { detail: "fake-ai: body no es JSON" });
        }
        const dims = pngDims(body.image_b64);
        if (!dims) return send(422, { detail: "fake-ai: image_b64 no es un PNG" });
        const { w, h } = dims;
        const discovered = [
          { id: "discovered_0", box: [0.10, 0.62, 0.16, 0.14], concept: "boulder" },
          { id: "discovered_1", box: [0.72, 0.18, 0.12, 0.18], concept: "tree stump" },
        ].map((d, i) => ({
          id: d.id,
          sprite_url: `/fake/sprite/${(i + 2) % FAKE_SPRITES.length}`,
          image_bbox: [
            Math.round(d.box[0] * w), Math.round(d.box[1] * h),
            Math.round(d.box[2] * w), Math.round(d.box[3] * h),
          ],
          img_w: w,
          img_h: h,
          score: 0.9,
          concept: d.concept,
        }));
        console.error(`[fake-ai] discover: ${discovered.length} props`);
        return send(200, { discovered });
      }
      if (req.method === "POST" && req.url === "/generate_scene") {
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
