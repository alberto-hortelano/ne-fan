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
