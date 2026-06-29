#!/usr/bin/env node
// narrative_lab/replay-server.mjs
//
// Reproduce una sesión grabada (events.ndjson) como "película" para el cliente
// 2D (nefan-html), SIN motor narrativo, SIN ai_server y SIN jugador.
//
// Suplanta al bridge en :9877: el cliente 2D se conecta igual que siempre, y
// este servidor le va sirviendo los frames `in` que el bridge real le mandó en
// la sesión grabada. Material ideal para depurar el renderer 2D (terreno,
// layout de objetos/NPCs, exits, UI de diálogo) de forma determinista.
//
// Cómo funciona:
//   - Las respuestas correlacionadas por requestId (list_games / list_sessions /
//     start_session / resume_session / save / delete) se contestan con el frame
//     grabado correspondiente, REESCRIBIENDO el requestId al que use el cliente
//     en vivo (así su Promise pendiente resuelve). Ver bridge-client.ts:dispatch.
//   - Los broadcasts (narrative_status / narrative_event / state_update) se
//     reemiten en el orden grabado con un ritmo de "película" configurable.
//   - El input por frame, load_room, dialogue_choice, etc. del cliente se
//     ignoran: la película auto-avanza sola.
//
// Requisitos: que el bridge real NO esté en :9877 (lo suplantamos). No hace
// falta ai_server: las entidades de la escena traen texture_hash (no
// sprite_hash), así que el renderer 2D dibuja cajas+etiquetas sin backend.
//
// Uso:
//   node narrative_lab/replay-server.mjs                 # usa el run por defecto
//   LOG=narrative_lab/runs/<otro>/events.ndjson node narrative_lab/replay-server.mjs
//   HOLD_MS=2000 FLASH_MS=200 LOOP=1 node narrative_lab/replay-server.mjs
//   REAL_TIMING=1 node narrative_lab/replay-server.mjs   # respeta deltas reales (clamp)
//
// Luego: en otra terminal `cd nefan-html && npm run dev`, abre el navegador,
// pulsa "Nueva partida" y elige tavern_intro. La sesión se reproduce sola.
//
// Variables de entorno:
//   LOG          ruta a events.ndjson (default: runs/session-2026-06-25/...)
//   PORT         puerto WS (default 9877, el del bridge)
//   HOLD_MS      ms que se mantiene cada escena/diálogo (default 3000)
//   FLASH_MS     ms del loader "generando" antes de cada escena (default 200)
//   REAL_TIMING  =1 respeta los deltas de tiempo reales (clamp 150..HOLD_MS)
//   LOOP         =1 reinicia la película al terminar

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "../nefan-core/node_modules/ws/wrapper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOG =
  process.env.LOG ??
  resolve(__dirname, "runs", "session-2026-06-25", "events.ndjson");
const PORT = Number(process.env.PORT ?? 9877);
const HOLD_MS = Number(process.env.HOLD_MS ?? 3000);
const FLASH_MS = Number(process.env.FLASH_MS ?? 200);
const REAL_TIMING = process.env.REAL_TIMING === "1";
const LOOP = process.env.LOOP === "1";

// ---------------------------------------------------------------------------
// Cargar y particionar el log
// ---------------------------------------------------------------------------
function loadFrames(path) {
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l)).filter((e) => e.dir === "in");
}

const inFrames = loadFrames(LOG);

// Respuestas correlacionadas por requestId, en cola FIFO por tipo.
const RESPONSE_TYPES = new Set([
  "games_listed",
  "sessions_listed",
  "session_started",
  "session_saved",
  "session_deleted",
]);
const responseQueues = {};
for (const t of RESPONSE_TYPES) responseQueues[t] = [];

// Broadcasts que componen la "película", en orden grabado.
const BROADCAST_TYPES = new Set([
  "narrative_status",
  "narrative_event",
  "state_update",
]);
const timeline = [];

for (const f of inFrames) {
  const t = f.msg?.type;
  if (RESPONSE_TYPES.has(t)) responseQueues[t].push(f.msg);
  else if (BROADCAST_TYPES.has(t)) timeline.push(f);
}

// Mapea el tipo de request entrante -> tipo de respuesta esperada.
const REQUEST_TO_RESPONSE = {
  list_games: "games_listed",
  list_sessions: "sessions_listed",
  start_session: "session_started",
  resume_session: "session_started",
  save_session: "session_saved",
  delete_session: "session_deleted",
};

console.error(
  `[replay] log=${LOG}\n[replay] respuestas: ` +
    Object.entries(responseQueues)
      .map(([k, v]) => `${k}:${v.length}`)
      .join(" ") +
    `\n[replay] broadcasts en timeline: ${timeline.length}` +
    `\n[replay] modo=${REAL_TIMING ? "real-timing" : `fijo hold=${HOLD_MS}ms flash=${FLASH_MS}ms`}` +
    (LOOP ? " loop=on" : ""),
);

// Síntesis de respuestas no grabadas (p.ej. el emulador no llamó list_sessions).
function synthResponse(respType) {
  switch (respType) {
    case "sessions_listed":
      return { type: "sessions_listed", sessions: [] };
    case "games_listed":
      return {
        type: "games_listed",
        games: [{ game_id: "tavern_intro", title: "The Calling" }],
      };
    case "session_saved":
      return { type: "session_saved", ok: true };
    case "session_deleted":
      return { type: "session_deleted", ok: true };
    default:
      return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function delayAfter(frame, nextFrame) {
  if (REAL_TIMING && nextFrame) {
    const d = new Date(nextFrame.ts) - new Date(frame.ts);
    return clamp(d, 150, HOLD_MS);
  }
  const m = frame.msg;
  if (m?.type === "narrative_status" && m?.phase === "generating") return FLASH_MS;
  return HOLD_MS;
}

// ---------------------------------------------------------------------------
// Servidor WS que suplanta al bridge
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" });
console.error(`[replay] suplantando al bridge en ws://127.0.0.1:${PORT}`);
console.error(`[replay] arranca el cliente 2D (cd nefan-html && npm run dev) y pulsa "Nueva partida".`);

wss.on("connection", (ws) => {
  console.error("[replay] cliente conectado");
  let streaming = false;
  // Copia local de las colas para esta conexión (cada reproducción es limpia).
  const queues = {};
  for (const t of RESPONSE_TYPES) queues[t] = [...responseQueues[t]];

  const sendMsg = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  async function streamMovie() {
    do {
      for (let i = 0; i < timeline.length; i++) {
        if (ws.readyState !== ws.OPEN) return;
        const frame = timeline[i];
        sendMsg(frame.msg);
        const label =
          frame.msg.type === "narrative_event"
            ? `narrative_event ${frame.msg.eventId ?? ""}`
            : frame.msg.type === "narrative_status"
              ? `status ${frame.msg.phase}`
              : frame.msg.type;
        console.error(`[replay] » ${label}`);
        await sleep(delayAfter(frame, timeline[i + 1]));
      }
      if (LOOP && ws.readyState === ws.OPEN) console.error("[replay] (loop) reiniciando película");
    } while (LOOP && ws.readyState === ws.OPEN);
    console.error("[replay] fin de la película");
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const type = msg?.type;

    if (type === "ping") {
      sendMsg({ type: "pong" });
      return;
    }

    // Request correlacionado por requestId.
    if (typeof msg?.requestId === "string" && REQUEST_TO_RESPONSE[type]) {
      const respType = REQUEST_TO_RESPONSE[type];
      const recorded = queues[respType].shift() ?? synthResponse(respType);
      if (!recorded) {
        console.error(`[replay] sin respuesta para ${type}; ignorado`);
        return;
      }
      const reply = { ...recorded, requestId: msg.requestId };
      sendMsg(reply);
      console.error(`[replay] « ${type} → ${respType} (req=${msg.requestId})`);

      // Arranca la película tras la primera sesión iniciada/reanudada.
      if ((type === "start_session" || type === "resume_session") && !streaming) {
        streaming = true;
        void streamMovie();
      }
      return;
    }

    // Fire-and-forget del cliente (input, load_room, dialogue_choice, …): ignorar.
  });

  ws.on("close", () => console.error("[replay] cliente desconectado"));
  ws.on("error", (e) => console.error(`[replay] error WS: ${e?.message ?? e}`));
});

process.on("SIGINT", () => {
  console.error("[replay] SIGINT, cerrando.");
  process.exit(0);
});
