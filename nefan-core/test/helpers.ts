/** Helpers compartidos de test: NarrativeState en memoria, combatConfig
 *  cargado una sola vez, y el harness del bridge (socket capturador, AiClient
 *  falso, BridgeContext completo) que antes vivía copiado en cada archivo.
 *  Los tests de bridge nuevos deben construir su ctx con makeCtx() de aquí. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { createSimCollisionProvider } from "../bridge/sim-collision.js";
import { SceneGenQueue } from "../bridge/scene-gen-queue.js";
import { createWorldClaim } from "../bridge/world-claim.js";
import { routeMessage } from "../bridge/router.js";
import {
  sellarSesion,
  type BridgeContext,
  type ClientSocket,
  type NarrativeAiClient,
} from "../bridge/context.js";
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

/** Escena EXPANDIDA mínima que pasa el gate de `recordSceneLoaded`
 *  (`ExpandedSceneSchema`, #334): lo que antes se sembraba como
 *  `{ id: "scene_1" }` eran escenas que el juego jamás produciría y que el
 *  gate rechaza. SIN `tile` a propósito: un tile exige grid 128×128
 *  (`computeTileEdges`) y la mayoría de tests no lo necesita — quien lo
 *  necesite, que expanda un tile de verdad (`expandScenePrimitives`). */
export function escenaExpandidaDePrueba(
  id: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    scene_id: id,
    scene_description: "Escena de prueba.",
    size: { cols: 4, rows: 4, meters_per_cell: 0.5 },
    terrain: Array.from({ length: 4 }, () => "gggg"),
    __expanded: true,
    entities: [],
    ...over,
  };
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

/** Escena que devuelve el motor FALSO: un TILE (0,0) mínimo con spawn del
 *  jugador. Format D solo tiene dos formas —tile y plató— desde la retirada
 *  de la escena suelta (issue #172), y el bootstrap del plano continuo hace
 *  fail-loud si le llega otra cosa. `over` sustituye campos (p. ej. una
 *  descripción distinta para distinguir dos respuestas en un test). */
export function fakeBootstrapTile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tile: { tx: 0, ty: 0 },
    scene_id: "tile_0_0",
    biome: "grass",
    scene_description: "una escena",
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [64, 64], footprint: [1, 1], glyph: "@" },
    ],
    ...over,
  };
}

/** BridgeContext completo con fakes: sim determinista (seed 12345), storage
 *  en memoria, AiClient falso (respuestas mínimas, overrides vía opts.ai) y
 *  broadcast capturado en `broadcasts`. */
/** Espejo del escritor crudo de `ws-server.ts`: `send` no admite mensajes con
 *  sello, así que el doble tampoco puede escribirlos a mano. */
function escribir(ws: ClientSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function makeCtx(
  opts: { gamesDir?: string; stylesDir?: string; ai?: FakeAi; persistWorldSnapshots?: boolean } = {},
) {
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
      return { ok: true, scene: fakeBootstrapTile() };
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
    gamesDir: opts.gamesDir ?? FIXTURE_GAMES,
    stylesDir: opts.stylesDir ?? FIXTURE_STYLES,
    // Apagado por defecto: la escritura pasiva contaminaría los fixtures (y
    // el siguiente start_session replayearía el snapshot saltándose el fake).
    persistWorldSnapshots: opts.persistWorldSnapshots ?? false,
    activePlugins: new Map(),
    sceneGen: new SceneGenQueue(),
    posTracking: { cellKey: null, placeId: null },
    world: createWorldClaim(narrative, sim),
    subscribe(ws) {
      subscribers.add(ws);
    },
    send(ws, msg) {
      escribir(ws, msg);
    },
    // Sella por la MISMA función que `ws-server.ts` (#282). No es una copia
    // por comodidad: si el doble no sellara igual, los tests de bridge
    // medirían un cable que no existe y el sello se podría romper en
    // producción con todo en verde.
    broadcastNarrative(msg) {
      const sellado = sellarSesion(msg, narrative.session_id);
      broadcasts.push(sellado);
      for (const ws of subscribers) escribir(ws, sellado);
    },
    enviarNarrativo(ws, msg) {
      escribir(ws, sellarSesion(msg, narrative.session_id));
    },
    // El doble del verbo que NO sella (#313), y por el mismo motivo que los de
    // arriba: si el doble sellara lo que en producción va sin sello, los tests
    // de bridge medirían un cable que no existe. Entra en `broadcasts` como
    // todo lo difundido — lo que cambia es qué lleva dentro, no por dónde sale.
    difundirDeJuego(msg) {
      broadcasts.push(msg);
      for (const ws of subscribers) escribir(ws, msg);
    },
  };
  return { ctx, broadcasts, storage, narrative, store, sim, aiCalls, subscribers };
}

/** El ack del cliente: «el jugador ya entró en la partida».
 *
 *  Desde #279 es lo ÚNICO que hace que una sesión exista en `saves/`: nace
 *  provisional y solo se escribe cuando el cliente confirma que se ha vestido
 *  Y ha pintado el mundo. Un test de bridge que quiera un save en el storage
 *  lo manda igual que el cliente —por el router, no llamando a `establecer()`
 *  a mano—, así que además ejerce el camino de verdad. */
export async function entrarEnLaPartida(
  ctx: BridgeContext,
  ws: ClientSocket,
  sessionId: string,
): Promise<void> {
  await routeMessage({ type: "session_entered", sessionId }, ws, ctx);
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

/** Captura el log del BRIDGE (console.warn/error) hasta que se suelta.
 *
 *  Desde 2026-08-24 el `narrative_status` de error lleva el motivo escrito
 *  para QUIEN JUEGA (#180): el volcado técnico —qué excepción, qué `place_id`
 *  falta, qué job se descartó— ya no viaja por el wire, se queda en el
 *  `console.warn` del bridge. Los tests que afirmaban sobre ese diagnóstico no
 *  pierden su sujeto: cambian al canal donde el diagnóstico vive ahora.
 *
 *  Devuelve las líneas (argumentos unidos, los Error por su `message`) y el
 *  `soltar()` que hay que llamar SIEMPRE en un `finally`: sin él, el resto de
 *  la suite se quedaría sin consola. */
export function capturarLogDelBridge(): { lineas: string[]; soltar: () => void } {
  const lineas: string[] = [];
  const warn = console.warn;
  const error = console.error;
  const recoger = (...args: unknown[]): void => {
    lineas.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  console.warn = recoger;
  console.error = recoger;
  return {
    lineas,
    soltar: () => {
      console.warn = warn;
      console.error = error;
    },
  };
}
