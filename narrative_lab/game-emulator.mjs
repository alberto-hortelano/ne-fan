#!/usr/bin/env node
// narrative_lab/game-emulator.mjs
//
// Emula ser el JUEGO (Godot/HTML) frente al bridge WebSocket de nefan-core.
// Permite testear el motor narrativo (otro Claude Code que llama
// narrative_listen/narrative_respond) sin gráficos, movimiento ni combate real:
// solo enviando los mismos mensajes que enviaría el juego y registrando ambos
// lados de la conversación.
//
// Cero dependencias: Node v22+ trae `WebSocket` global (undici) y `node:http`.
//
// Arquitectura:
//   [este proceso] --WS:9877--> bridge --HTTP:8765--> ai_server --WS:3737--> [motor]
//
// Uso:
//   node narrative_lab/game-emulator.mjs            # arranca en foreground
//   (recomendado: lanzarlo en background y conducirlo por su API HTTP de control)
//
// API de control (HTTP en CTRL_PORT, default 9899) — conducir con curl:
//   POST /send      body = mensaje de bridge JSON   -> { ok, sentSeq }
//   GET  /events?since=N                            -> { events:[{seq,ts,dir,msg}], cursor }
//   GET  /wait?since=N&type=narrative_event&timeoutMs=240000
//                   long-poll: resuelve al llegar un evento del `type` pedido
//                   (type acepta lista separada por comas)            -> { event|null, cursor }
//   GET  /health                                    -> { connected, eventCount, run }
//
// Variables de entorno:
//   BRIDGE_URL   (default ws://127.0.0.1:9877)
//   CTRL_PORT    (default 9899)
//   RUN_DIR      (default narrative_lab/runs/<timestamp>)

import http from "node:http";
import { mkdirSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRIDGE_URL = process.env.BRIDGE_URL ?? "ws://127.0.0.1:9877";
const CTRL_PORT = Number(process.env.CTRL_PORT ?? 9899);

// Sello de tiempo legible para el nombre del run (el script no usa Date.now en
// hot paths; aquí es solo para nombrar la carpeta una vez al arrancar).
const startedAt = new Date();
const stamp = startedAt
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace("T", "_")
  .slice(0, 19);
const RUN_DIR = process.env.RUN_DIR ?? resolve(__dirname, "runs", stamp);
mkdirSync(RUN_DIR, { recursive: true });
const EVENTS_LOG = join(RUN_DIR, "events.ndjson");

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------
let seq = 0;
const events = []; // { seq, ts, dir: "in"|"out", msg }
let ws = null;
let connected = false;
const waiters = []; // { types:Set|null, sinceSeq, resolve, timer }

function nowIso() {
  return new Date().toISOString();
}

function record(dir, msg) {
  const ev = { seq: ++seq, ts: nowIso(), dir, msg };
  events.push(ev);
  try {
    appendFileSync(EVENTS_LOG, JSON.stringify(ev) + "\n");
  } catch (err) {
    // fail-loud: lo dejamos visible en stderr, no lo tragamos.
    console.error(`[emulator] no pude escribir el log: ${err?.message ?? err}`);
  }
  if (dir === "in") notifyWaiters(ev);
  return ev;
}

function notifyWaiters(ev) {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (ev.seq <= w.sinceSeq) continue;
    const t = ev.msg?.type;
    if (w.types && !w.types.has(t)) continue;
    clearTimeout(w.timer);
    waiters.splice(i, 1);
    w.resolve(ev);
  }
}

// ---------------------------------------------------------------------------
// Conexión WebSocket al bridge
// ---------------------------------------------------------------------------
let pingTimer = null;

function connect() {
  console.error(`[emulator] conectando a ${BRIDGE_URL} ...`);
  ws = new WebSocket(BRIDGE_URL);

  ws.addEventListener("open", () => {
    connected = true;
    console.error(`[emulator] conectado al bridge. run=${RUN_DIR}`);
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (connected) sendRaw({ type: "ping" }, /*silent*/ true);
    }, 20_000);
  });

  ws.addEventListener("message", (event) => {
    let parsed;
    try {
      parsed = JSON.parse(String(event.data));
    } catch (err) {
      console.error(`[emulator] mensaje no-JSON del bridge: ${err?.message}`);
      parsed = { type: "_unparsed", raw: String(event.data) };
    }
    // El pong es ruido; lo registramos en log pero sin spamear consola.
    record("in", parsed);
    if (parsed?.type && parsed.type !== "pong") {
      console.error(`[emulator] << ${parsed.type}`);
    }
  });

  ws.addEventListener("close", () => {
    connected = false;
    console.error("[emulator] conexión cerrada; reintentando en 2s ...");
    clearInterval(pingTimer);
    setTimeout(connect, 2000);
  });

  ws.addEventListener("error", (err) => {
    connected = false;
    console.error(`[emulator] error WS: ${err?.message ?? "(sin detalle)"}`);
  });
}

function sendRaw(msg, silent = false) {
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WS no conectado al bridge");
  }
  ws.send(JSON.stringify(msg));
  const ev = record("out", msg);
  if (!silent) console.error(`[emulator] >> ${msg?.type ?? "(sin type)"}`);
  return ev;
}

// ---------------------------------------------------------------------------
// Servidor HTTP de control
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

const ctrl = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        connected,
        eventCount: events.length,
        run: RUN_DIR,
        bridge: BRIDGE_URL,
      });
    }

    if (req.method === "POST" && url.pathname === "/send") {
      const raw = await readBody(req);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        return json(res, 400, { ok: false, error: `JSON inválido: ${err?.message}` });
      }
      try {
        const ev = sendRaw(msg);
        return json(res, 200, { ok: true, sentSeq: ev.seq });
      } catch (err) {
        return json(res, 503, { ok: false, error: err?.message ?? String(err) });
      }
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const dirFilter = url.searchParams.get("dir"); // "in" | "out" | null
      const out = events.filter(
        (e) => e.seq > since && (!dirFilter || e.dir === dirFilter),
      );
      return json(res, 200, { events: out, cursor: seq });
    }

    if (req.method === "GET" && url.pathname === "/wait") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const typeParam = url.searchParams.get("type");
      const types = typeParam
        ? new Set(typeParam.split(",").map((s) => s.trim()).filter(Boolean))
        : null;
      const timeoutMs = Number(url.searchParams.get("timeoutMs") ?? 240_000);

      // ¿Ya hay un evento que cumple? Resuelve de inmediato.
      const existing = events.find(
        (e) => e.dir === "in" && e.seq > since && (!types || types.has(e.msg?.type)),
      );
      if (existing) return json(res, 200, { event: existing, cursor: seq });

      const w = { types, sinceSeq: since, resolve: null, timer: null };
      const p = new Promise((resolveP) => (w.resolve = resolveP));
      w.timer = setTimeout(() => {
        const idx = waiters.indexOf(w);
        if (idx >= 0) waiters.splice(idx, 1);
        w.resolve(null);
      }, timeoutMs);
      waiters.push(w);
      const ev = await p;
      return json(res, 200, { event: ev, cursor: seq });
    }

    return json(res, 404, { error: `ruta desconocida: ${req.method} ${url.pathname}` });
  } catch (err) {
    return json(res, 500, { error: err?.message ?? String(err) });
  }
});

ctrl.listen(CTRL_PORT, "127.0.0.1", () => {
  console.error(`[emulator] control HTTP en http://127.0.0.1:${CTRL_PORT}`);
});

process.on("SIGINT", () => {
  console.error("[emulator] SIGINT, cerrando.");
  process.exit(0);
});

connect();
