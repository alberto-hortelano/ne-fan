/** WebSocket bridge — runs GameSimulation + NarrativeState; los clientes
 * conectan al puerto del gateway (SERVICES["game-gateway"], CONFIG.ports.bridge).
 *
 *  Este archivo es sólo bootstrap: construye las instancias, el BridgeContext
 *  y el wiring de transporte (WS + state HTTP API). La lógica de cada mensaje
 *  vive en bridge/handlers/* y se enruta en bridge/router.ts. */

import { Agent, fetch as undiciFetch } from "undici";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { FsSessionStorage } from "../src/narrative/session-storage.js";
import { AiClient } from "../src/narrative/ai-client.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { createSimCollisionProvider } from "./sim-collision.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin, pluginListSummary } from "../src/plugins/views.js";
import { CONFIG } from "../src/config.js";
import { resolveServiceUrl } from "../src/contracts/common.js";
import { createStateHttpServer, pluginRegisterBody } from "./state-http-server.js";
import { routeMessage } from "./router.js";
import { SceneGenQueue } from "./scene-gen-queue.js";
import { intakeClientMessage } from "./message-intake.js";
import type { BridgeContext } from "./context.js";
import type { CombatConfig } from "../src/types.js";
import type { ServerMessage } from "../src/protocol/messages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve paths relative to project root (works from both src/ and dist/)
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "data").replace("/dist/data", "/data");
const PORT = Number(process.env.NEFAN_BRIDGE_PORT ?? CONFIG.ports.bridge);
// State HTTP API for the narrative engine's tools (map / entities / inventory).
const STATE_HTTP_PORT = Number(process.env.NEFAN_STATE_HTTP_PORT ?? CONFIG.ports.state_api);
// Override para benches (labs/narrative): con el motor FAKE, los snapshots de
// mundo se escriben en data/games/{id}/world/ — un games dir temporal evita
// contaminar los juegos reales con génesis de bench.
const GAMES_DIR = process.env.NEFAN_GAMES_DIR ?? resolve(dataDir, "games");
const STYLES_DIR = resolve(dataDir, "styles");

// Saves live in a shared filesystem location accessible to every client:
// <repo>/saves, igual que start.sh ($PROJECT_DIR/saves). Override with
// NEFAN_SAVES_DIR.
const SAVES_DIR = process.env.NEFAN_SAVES_DIR ?? resolve(dataDir, "..", "..", "saves");
/** Destino del ai_server (S3 narrative-llm). NEFAN_AI_SERVER es el alias
 *  histórico y gana (lo usa el bench de labs/narrative documentado);
 *  @deprecated — usar NEFAN_URL_NARRATIVE_LLM (contrato F1); retirada en F5. */
const AI_SERVER_URL = process.env.NEFAN_AI_SERVER ?? resolveServiceUrl("narrative-llm", process.env);

// Load combat config
const configPath = resolve(dataDir, "combat_config.json");
const config: CombatConfig = loadConfig(JSON.parse(readFileSync(configPath, "utf-8")));

const store = new GameStore();
const sim = new GameSimulation(config, store, Date.now());
const sessionStorage = new FsSessionStorage(SAVES_DIR);
const narrative = new NarrativeState(sessionStorage);
const npcDirector = new NpcDirector(narrative);
const simCollision = createSimCollisionProvider(narrative);

// Players currently subscribed to narrative events (broadcast targets).
const narrativeSubscribers = new Set<WebSocket>();

const ctx: BridgeContext = {
  sim,
  combatConfig: config,
  store,
  narrative,
  sessionStorage,
  aiClient: new AiClient({
    baseUrl: AI_SERVER_URL,
    // Sin headersTimeout/bodyTimeout: el default de undici (300 s hasta
    // recibir cabeceras) mataba /generate_scene con "fetch failed" mientras
    // el motor narrativo seguía escribiendo. El AbortController del cliente
    // (llm_timeout_s + margen) es quien acota la espera.
    //
    // OJO: fetch y Agent deben venir del MISMO undici (el paquete npm). El
    // fetch GLOBAL de Node usa su undici interno y rechaza un Agent ajeno al
    // instante con "fetch failed: invalid onRequestStart method".
    fetchImpl: undiciFetch as unknown as typeof fetch,
    dispatcher: new Agent({ headersTimeout: 0, bodyTimeout: 0 }),
  }),
  mapTriggers: new MapTriggerEvaluator(narrative),
  npcDirector,
  simCollision,
  gamesDir: GAMES_DIR,
  stylesDir: STYLES_DIR,
  persistWorldSnapshots: true,
  activePlugins: new Map(),
  sceneGen: new SceneGenQueue(),
  posTracking: { cellKey: null, placeId: null },
  subscribe(ws) {
    narrativeSubscribers.add(ws as WebSocket);
  },
  send(ws, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  },
  broadcastNarrative(msg: ServerMessage) {
    for (const ws of narrativeSubscribers) ctx.send(ws, msg);
  },
};

// Add player
sim.addCombatant(
  createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
);

// Don't crash the bridge if a downstream service (ai_server) is offline.
process.on("unhandledRejection", (reason) => {
  console.warn("Bridge: unhandled rejection:", reason);
});

const wss = new WebSocketServer({ port: PORT });
console.log(`NEFan Logic Bridge listening on ws://localhost:${PORT}`);

// State HTTP API: the narrative engine (Claude via narrative-mcp tools) queries
// and mutates the authoritative NarrativeState here, instead of receiving the
// whole world in the LLM context.
createStateHttpServer({
  port: STATE_HTTP_PORT,
  narrative,
  npcDirector,
  gamesDir: GAMES_DIR,
  sessionStorage,
  onMutation: async () => {
    await narrative.save();
  },
  onProgress: (message) => {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "progress",
      kind: "scene",
      message,
    });
  },
  plugins: {
    register: (raw) => {
      const result = registerRuntimePlugin(narrative, ctx.activePlugins, raw);
      const name = result.manifest.name;
      const version = result.manifest.version;
      const short = result.id.slice(0, 12);
      // Que el motor haya EVOLUCIONADO un plugin —y sobre todo que haya tomado
      // uno shipped— no puede ser algo que se deduzca del warning del siguiente
      // resume: se dice aquí, cuando pasa.
      if (result.action === "migrated" && result.fromOriginAuthor === "developer") {
        console.warn(
          `Bridge: el motor narrativo TOMA el plugin de disco '${name}' ` +
            `v${result.fromVersion}→v${version} (${short}…) — el JSON de data/…/plugins/ ` +
            `queda inerte para esta sesión: el manifest vigente vive ya en el save`,
        );
      } else {
        console.log(
          result.action === "migrated"
            ? `Bridge: plugin '${name}' migrado v${result.fromVersion}→v${version} en runtime (${short}…)`
            : result.action === "unchanged"
              ? `Bridge: plugin '${name}' v${version} ya activo (${short}…) — registro idempotente`
              : `Bridge: plugin '${name}' v${version} activado en runtime ` +
                `(${short}…, ${result.fixturesPassed} fixtures)`,
        );
      }
      // plugin_activated (§7.3 paso 5): se notifica con el status existente
      // para no tocar los parsers de cliente.
      ctx.broadcastNarrative({
        type: "narrative_status",
        phase: "ready",
        kind: "consequences",
        message:
          result.action === "migrated"
            ? `Plugin evolucionado: ${name} v${result.fromVersion}→v${version}` +
              (result.fromOriginAuthor === "developer" ? " (sustituye al de disco)" : "")
            : result.action === "unchanged"
              ? `Plugin ya activo: ${name} v${version}`
              : `Plugin activado: ${name} (${short}…)`,
      });
      // …y para que llegue A LA PANTALLA, por el feed de eventos, que es el
      // único canal de estos que el cliente pinta hoy (un narrative_status
      // `ready/consequences` lo descarta en silencio). Solo la migración: es
      // la que cambia un sistema con el que el jugador ya estaba tratando, y
      // si el que cambia es un plugin del juego, el cambio es IRREVERSIBLE
      // para ese save — el JSON del disco deja de mandar.
      if (result.action === "migrated") {
        ctx.broadcastNarrative({
          type: "narrative_event",
          eventId: "plugin_register",
          consequences: [],
          effects: [
            {
              kind: "ambient_message",
              message:
                `⚙️ el sistema «${name}» ha cambiado de versión (v${result.fromVersion} → v${version})` +
                (result.fromOriginAuthor === "developer"
                  ? " — a partir de ahora manda la del motor narrativo, no la del juego"
                  : ""),
            },
          ],
        });
      }
      return pluginRegisterBody(result);
    },
    list: () =>
      [...ctx.activePlugins.entries()].map(([id, m]) =>
        pluginListSummary(id, m, narrative.getPluginRecord(id)?.origin.author),
      ),
    inspect: (id, view) =>
      inspectPlugin(
        {
          plugins: narrative.plugins,
          world: narrative.world,
          player: narrative.player,
          entities: narrative.entities,
        },
        ctx.activePlugins,
        id,
        view,
      ),
  },
});

wss.on("connection", (ws: WebSocket) => {
  console.log("Bridge: client connected");

  ws.on("message", async (raw: Buffer) => {
    // Borde fail-loud: el input del cliente (WS sin auth) NO llega crudo a los
    // handlers. JSON inválido o shape no conforme al contrato → se rechaza con
    // el error preciso, en vez de petar dentro de un handler con un TypeError.
    const intake = intakeClientMessage(raw.toString());
    if (!intake.ok) {
      const preview = raw.toString().slice(0, 200);
      console.error(`Bridge: WS frame rejected (${intake.reason}): ${intake.error} — ${preview}`);
      ctx.send(ws, {
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message:
          intake.reason === "json"
            ? `Bridge recibió un frame WS inválido: ${intake.error}`
            : `Bridge rechazó un mensaje inválido: ${intake.error}`,
      });
      return;
    }
    await routeMessage(intake.msg, ws, ctx);
  });

  ws.on("close", () => {
    narrativeSubscribers.delete(ws);
    console.log("Bridge: client disconnected");
  });
});
