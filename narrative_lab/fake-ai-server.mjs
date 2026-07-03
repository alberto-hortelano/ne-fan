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

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { status: "ready" });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    void (async () => {
      console.error(`[fake-ai] ${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === "/notify_session") return send(200, { ok: true });
      if (req.method === "POST" && req.url === "/report_player_choice") return send(200, { consequences: [] });
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
