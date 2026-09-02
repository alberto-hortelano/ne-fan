/** HTTP state API — lets the narrative engine (Claude, via narrative-mcp tools)
 * query and mutate the authoritative NarrativeState without dumping the whole
 * world into the LLM context.
 *
 * The bridge owns NarrativeState; this server exposes a thin request/response
 * surface over it. It runs alongside the WebSocket server in ws-server.ts.
 *
 * Two cycles, as designed with the user:
 *  - generation cycle: bridge → ai_server → narrative-mcp → Claude (unchanged)
 *  - state cycle:      Claude → narrative-mcp → THIS server (new)
 *
 * ESTE fichero es solo el TRANSPORTE: node:http, CORS, leer el body, escribir
 * el JSON y disparar `onMutation`. Quién contesta cada ruta vive en
 * `state-http/` — el despacho en `dispatch.ts` y los 28 handlers agrupados por
 * concepto, todos invocables sin abrir un puerto (#225).
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SessionStorage } from "../src/narrative/session-storage.js";
import type { NpcDirector } from "../src/world-map/npc-director.js";
import { dispatchStateRequest } from "./state-http/dispatch.js";
import type { PluginHooks, StateHttpContext } from "./state-http/context.js";

export interface StateHttpServerOptions {
  port: number;
  narrative: NarrativeState;
  npcDirector: NpcDirector;
  /** Directorio de juegos (data/games) — GET /world_doc lee de ahí el
   *  world.md del juego de la sesión activa (tool MCP world_doc_get). */
  gamesDir: string;
  /** Storage de saves — GET /sessions/asset_refs (F2) recorre TODOS los
   *  saves para construir la keep-list del prune del asset-store. Opcional:
   *  sin él la ruta no existe (404), los tests viejos no lo pasan. */
  sessionStorage?: SessionStorage;
  /** Called after any mutation so the bridge can persist the session. */
  onMutation: () => void | Promise<void>;
  /** Latido de progreso del motor narrativo (POST /narrative_progress desde
   *  narrative-mcp): el bridge lo difunde como narrative_status "progress"
   *  para que el loader del cliente muestre qué está pasando. */
  onProgress: (message: string) => void;
  /** El mapa cambió a mitad de sesión (`map_upsert_place`, `map_link`): el
   *  bridge difunde las salidas de los tiles cargados (#179). */
  onMapChanged: () => void;
  /** Hooks de plugins (F5) — viven en ws-server porque el registry activo del
   *  dispatcher (`activePlugins`) es estado del bridge. */
  plugins: PluginHooks;
  /** A qué motor narrativo habla este bridge (`AI_SERVER_URL`). Obligatorio a
   *  propósito: es lo que publica GET /health para que el banco de pruebas
   *  pueda comprobar la vía de gasto que no pasa por el `?ai=` del cliente, y
   *  un default vacío la haría invisible otra vez sin que nadie lo notara. */
  aiServerUrl: string;
  /** El gateway WS de este proceso. Obligatorio por el mismo motivo que
   *  `aiServerUrl`: es lo que permite comprobar que la State API a la que se
   *  pregunta es la del bridge que uno está usando, y no la del vecino. */
  gatewayUrl: string;
}

const MAX_BODY_BYTES = 256 * 1024;

export function createStateHttpServer(opts: StateHttpServerOptions): Server {
  const { onMutation } = opts;
  const ctx: StateHttpContext = {
    narrative: opts.narrative,
    npcDirector: opts.npcDirector,
    plugins: opts.plugins,
    gamesDir: opts.gamesDir,
    onProgress: opts.onProgress,
    onMapChanged: opts.onMapChanged,
    sessionStorage: opts.sessionStorage,
    aiServerUrl: opts.aiServerUrl,
    gatewayUrl: opts.gatewayUrl,
  };

  const server = createServer((req, res) => {
    // CORS: el cliente (localhost:3000) registra asset_refs de escena
    // (/scene/asset_refs) directamente contra el State API — mismo criterio
    // permisivo que el asset-store (362cc74: solo dev local en 127.0.0.1).
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }
    const claimed = req.headers["x-nefan-session"];
    dispatchStateRequest(ctx, {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      session: typeof claimed === "string" ? claimed : undefined,
      readBody: () => readJson(req),
    })
      .then(async (result) => {
        if (result.mutated) {
          try {
            await onMutation();
          } catch (err) {
            console.warn("StateHttpServer: onMutation failed:", err);
          }
        }
        sendJson(res, result.status, result.body);
      })
      .catch((err) => {
        sendJson(res, 500, { ok: false, error: String((err as Error)?.message ?? err) });
      });
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(`NEFan State HTTP API listening on http://127.0.0.1:${opts.port}`);
  });
  return server;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

// GET /styles/{style_id}/{file} vive ahora en el asset-store (F2):
// services/asset-store/blob-store.ts (readStyleFile). Aquí ya no hay rama
// binaria — el único consumidor (covers de la title screen) apunta a :8767.
