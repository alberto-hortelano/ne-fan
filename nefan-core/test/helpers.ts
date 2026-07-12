/** Helpers compartidos de test: NarrativeState en memoria, combatConfig
 *  cargado una sola vez, y el harness del bridge (socket capturador, AiClient
 *  falso, BridgeContext completo) que antes vivía copiado en cada archivo.
 *  Los tests de bridge nuevos deben construir su ctx con makeCtx() de aquí. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";
import { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import { SceneGenQueue } from "../bridge/scene-gen-queue.js";
import type { BridgeContext, ClientSocket, NarrativeAiClient } from "../bridge/context.js";
import type { ServerMessage } from "../src/protocol/messages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = resolve(__dirname, "..", "data");
export const REAL_GAMES_DIR = resolve(DATA_DIR, "games");
export const REAL_STYLES_DIR = resolve(DATA_DIR, "styles");
export const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));
export const FIXTURE_STYLES = fileURLToPath(new URL("fixtures/styles", import.meta.url));

/** Config de combate real, parseada UNA vez para toda la suite. */
export const combatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(DATA_DIR, "combat_config.json"), "utf-8")),
);

/** NarrativeState respaldado por storage en memoria — el constructor más
 *  repetido de la suite. Devuelve también el storage para tests de resume
 *  (dos states sobre el mismo storage). */
export function makeNarrativeState(storage = new MemorySessionStorage()): {
  narrative: NarrativeState;
  storage: MemorySessionStorage;
} {
  return { narrative: new NarrativeState(storage), storage };
}

/** Socket capturador: acumula en `sent` todo lo que el bridge envía. */
export function makeSocket(): { socket: ClientSocket; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const socket: ClientSocket = {
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
    readyState: 1,
    OPEN: 1,
  };
  return { socket, sent };
}

/** Overrides opcionales del AiClient falso de makeCtx. */
export interface FakeAi {
  generateScene?: NarrativeAiClient["generateScene"];
  reportPlayerChoice?: NarrativeAiClient["reportPlayerChoice"];
  developWorld?: NarrativeAiClient["developWorld"];
}

/** BridgeContext completo con fakes: sim determinista (seed 12345), storage
 *  en memoria, AiClient falso (respuestas mínimas, overrides vía opts.ai) y
 *  broadcast capturado en `broadcasts`. */
export function makeCtx(opts: { gamesDir?: string; stylesDir?: string; ai?: FakeAi } = {}) {
  const store = new GameStore();
  const sim = new GameSimulation(combatConfig, store, 12345);
  sim.addCombatant(
    createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
  );
  const storage = new MemorySessionStorage();
  const narrative = new NarrativeState(storage);
  const broadcasts: ServerMessage[] = [];
  const subscribers = new Set<ClientSocket>();
  const aiCalls: Record<string, unknown[]> = { notify: [], scene: [], choice: [], develop: [] };

  const aiClient: NarrativeAiClient = {
    async notifySessionStart(sessionId, gameId, isResume) {
      aiCalls.notify.push({ sessionId, gameId, isResume });
      return true;
    },
    async generateScene(ctx) {
      aiCalls.scene.push(ctx);
      if (opts.ai?.generateScene) return opts.ai.generateScene(ctx);
      return { ok: true, scene: { room_id: "scene_test", room_description: "una escena" } };
    },
    async reportPlayerChoice(payload) {
      aiCalls.choice.push(payload);
      if (opts.ai?.reportPlayerChoice) return opts.ai.reportPlayerChoice(payload);
      return { ok: true, consequences: [] };
    },
    async developWorld(draftText: string) {
      aiCalls.develop.push(draftText);
      if (opts.ai?.developWorld) return opts.ai.developWorld(draftText);
      return {
        ok: true as const,
        game: {
          game_id: "mundo_prueba",
          title: "Mundo de Prueba",
          description: "Un mundo inventado por el jugador.",
          style_id: "estilo_test",
          world_brief: "b".repeat(150),
          world_md: "# Mundo de Prueba\n" + "lore ".repeat(500),
        },
      };
    },
  };

  const ctx: BridgeContext = {
    sim,
    combatConfig,
    store,
    narrative,
    sessionStorage: storage,
    aiClient,
    mapTriggers: new MapTriggerEvaluator(narrative),
    npcDirector: new NpcDirector(narrative),
    simCollision: createSimCollisionProvider(narrative),
    initialSceneCache: new InitialSceneCache(join(tmpdir(), "nefan-test-scene-cache-unused")),
    gamesDir: opts.gamesDir ?? FIXTURE_GAMES,
    stylesDir: opts.stylesDir ?? FIXTURE_STYLES,
    cacheInitialScene: false,
    activePlugins: new Map(),
    sceneGen: new SceneGenQueue(),
    posTracking: { cellKey: null, placeId: null },
    subscribe(ws) {
      subscribers.add(ws);
    },
    send(ws, msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    broadcastNarrative(msg) {
      broadcasts.push(msg);
      for (const ws of subscribers) ctx.send(ws, msg);
    },
  };
  return { ctx, broadcasts, storage, narrative, store, sim, aiCalls, subscribers };
}

/** Espera a que se cumpla una condición (para el trabajo fire-and-forget de
 *  start_session/player_entered_place, que no se awaitea en el handler). */
export async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
