// Fake ai_server para bench E2E del bridge SIN LLM ni GPU.
//
// Imita los endpoints que consume nefan-core AiClient:
//   GET  /health                → { status: "ready" }
//   POST /notify_session        → { ok: true }
//   POST /generate_scene        → la escena canned (el body ES la escena)
//   POST /report_player_choice  → { consequences: [] }
//
// Uso:
//   node narrative_lab/fake-ai-server.mjs                # escena v2 built-in
//   PORT=18765 SCENE_FILE=mi_escena.json node narrative_lab/fake-ai-server.mjs
//
// La escena built-in usa las primitivas Format D v2 (structures +
// vegetation_zones + decor attach:wall) para ejercitar la expansión y la
// validación del bridge end-to-end.

import http from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 18765);

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

const scene = process.env.SCENE_FILE
  ? JSON.parse(readFileSync(process.env.SCENE_FILE, "utf8"))
  : BUILTIN_SCENE;

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { status: "ready" });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    console.error(`[fake-ai] ${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === "/notify_session") return send(200, { ok: true });
    if (req.method === "POST" && req.url === "/generate_scene") return send(200, scene);
    if (req.method === "POST" && req.url === "/report_player_choice") return send(200, { consequences: [] });
    send(404, { detail: `fake-ai-server: ruta desconocida ${req.method} ${req.url}` });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[fake-ai] escuchando en http://127.0.0.1:${PORT} (escena: ${process.env.SCENE_FILE ?? "built-in v2"})`);
});
