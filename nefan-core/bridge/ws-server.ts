/** WebSocket bridge — runs GameSimulation + ScenarioRunner, communicates with Godot on :9877.
 *
 *  Este archivo es sólo bootstrap: construye las instancias, el BridgeContext
 *  y el wiring de transporte (WS + state HTTP API). La lógica de cada mensaje
 *  vive en bridge/handlers/* y se enruta en bridge/router.ts. */

import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { ScenarioRunner } from "../src/scenario/scenario-runner.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { FsSessionStorage } from "../src/narrative/session-storage.js";
import { AiClient } from "../src/narrative/ai-client.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin } from "../src/plugins/views.js";
import { CONFIG } from "../src/config.js";
import { createStateHttpServer } from "./state-http-server.js";
import { routeMessage } from "./router.js";
import type { BridgeContext } from "./context.js";
import type { CombatConfig } from "../src/types.js";
import type { ClientMessage, ServerMessage } from "../src/protocol/messages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve paths relative to project root (works from both src/ and dist/)
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "data").replace("/dist/data", "/data");
const PORT = Number(process.env.NEFAN_BRIDGE_PORT ?? 9877);
// State HTTP API for the narrative engine's tools (map / entities / inventory).
const STATE_HTTP_PORT = Number(process.env.NEFAN_STATE_HTTP_PORT ?? 9878);
const GAMES_DIR = resolve(dataDir, "games");

// Saves live in a shared filesystem location accessible to every client
// (HTML cannot read user:// from Godot). Override with NEFAN_SAVES_DIR.
const SAVES_DIR = process.env.NEFAN_SAVES_DIR ?? resolve(homedir(), "code", "ne-fan", "saves");
const AI_SERVER_URL = process.env.NEFAN_AI_SERVER ?? "http://127.0.0.1:8765";

// Load combat config
const configPath = resolve(dataDir, "combat_config.json");
const config: CombatConfig = loadConfig(JSON.parse(readFileSync(configPath, "utf-8")));

const store = new GameStore();
const sim = new GameSimulation(config, store, Date.now());
const sessionStorage = new FsSessionStorage(SAVES_DIR);
const narrative = new NarrativeState(sessionStorage);
const npcDirector = new NpcDirector(narrative);

// Players currently subscribed to narrative events (broadcast targets).
const narrativeSubscribers = new Set<WebSocket>();

const ctx: BridgeContext = {
  sim,
  store,
  scenario: new ScenarioRunner(),
  narrative,
  sessionStorage,
  aiClient: new AiClient({ baseUrl: AI_SERVER_URL }),
  mapTriggers: new MapTriggerEvaluator(narrative),
  initialSceneCache: new InitialSceneCache(resolve(dataDir, "initial_scene_cache")),
  gamesDir: GAMES_DIR,
  cacheInitialScene: CONFIG.dev.cache_initial_scene,
  activePlugins: new Map(),
  pendingSceneGen: null,
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
  onMutation: async () => {
    await narrative.save();
  },
  plugins: {
    register: (raw) => {
      const result = registerRuntimePlugin(narrative, ctx.activePlugins, raw);
      console.log(
        `Bridge: plugin '${result.manifest.name}' v${result.manifest.version} ` +
          `activado en runtime (${result.id.slice(0, 12)}…, ${result.fixturesPassed} fixtures)`,
      );
      // plugin_activated (§7.3 paso 5): se notifica con el status existente
      // para no tocar los parsers de cliente.
      ctx.broadcastNarrative({
        type: "narrative_status",
        phase: "ready",
        kind: "consequences",
        message: `Plugin activado: ${result.manifest.name} (${result.id.slice(0, 12)}…)`,
      });
      return {
        id: result.id,
        name: result.manifest.name,
        version: result.manifest.version,
        fixturesPassed: result.fixturesPassed,
      };
    },
    list: () =>
      [...ctx.activePlugins.entries()].map(([id, m]) => ({
        id,
        name: m.name,
        version: m.version,
        description: m.description,
        origin_author: narrative.getPluginRecord(id)?.origin.author ?? m.origin.author,
        events_consumed: m.events_consumed.map((e) => e.type),
        events_produced: m.events_produced,
        derived_views: m.derived_views.map((v) => v.name),
      })),
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
      ) as unknown as Record<string, unknown>,
  },
});

wss.on("connection", (ws: WebSocket) => {
  console.log("Bridge: client connected");

  ws.on("message", async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch (err) {
      const preview = raw.toString().slice(0, 200);
      console.error(`Bridge: invalid WS frame, dropping: ${preview}`, err);
      ctx.send(ws, {
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message: `Bridge recibió un frame WS inválido: ${(err as Error).message}`,
      });
      return;
    }
    await routeMessage(msg, ws, ctx);
  });

  ws.on("close", () => {
    narrativeSubscribers.delete(ws);
    console.log("Bridge: client disconnected");
  });
});
