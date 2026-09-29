/** Levantar el bridge a partir de una configuración ya leída (#769).
 *
 *  `ws-server.ts` es la ENTRADA del proceso —lee el entorno, las rutas y los
 *  puertos— y llama aquí. Todo lo que hay debajo de esa lectura vive en este
 *  módulo para que un test pueda arrancar el bridge de verdad, en puertos 0, y
 *  cerrarlo: antes era código de nivel de módulo en `ws-server.ts`, y
 *  importarlo ya era arrancar. */

import { Agent, fetch as undiciFetch } from "undici";
import { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import type { EventEmitter } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { FsSessionStorage } from "../src/narrative/session-storage.js";
import { AiClient } from "../src/narrative/ai-client.js";
import type { Entorno } from "../src/session/gates-de-imagen.js";
import type { CombatConfig } from "../src/types.js";
import { createStateHttpServer } from "./state-http-server.js";
import { difundirSalidasDeLosTilesCargados } from "./salidas.js";
import { crearContextoDelBridge } from "./contexto-del-bridge.js";
import { hooksDePluginsDelBridge } from "./hooks-de-plugins.js";
import { atenderConexion } from "./conexion.js";
import type { BridgeContext } from "./context.js";

export interface ConfigDelBridge {
  /** Puerto del gateway WS; 0 = el que dé el sistema (tests). */
  port: number;
  /** Puerto del State API HTTP; 0 = el que dé el sistema (tests). */
  statePort: number;
  entorno: Entorno;
  /** `nefan-core/data`: de aquí sale `combat_config.json`. */
  dataDir: string;
  gamesDir: string;
  stylesDir: string;
  savesDir: string;
  aiServerUrl: string;
}

export interface BridgeArrancado {
  ctx: BridgeContext;
  puertoWs: number;
  puertoStateApi: number;
  /** Los dos servidores, para que un test pueda comprobar que `cerrar()` los
   *  cerró —y soltarlos él si no, en vez de dejar el proceso colgado—. */
  servidores: { ws: WebSocketServer; stateApi: Server };
  /** Cierra los dos servidores y el Agent de undici. */
  cerrar(): Promise<void>;
}

/** Resuelve con el puerto REAL cuando el servidor escucha, o rechaza con el
 *  error de `listen` (puerto ocupado): sin oyente de `error`, un EADDRINUSE
 *  tumbaba el proceso con una traza de `events` en vez de decir qué puerto. */
function escuchando(
  server: EventEmitter & { address(): AddressInfo | string | null },
  que: string,
  pedido: number,
): Promise<number> {
  return new Promise((ok, falla) => {
    const alFallar = (err: Error): void => falla(new Error(`Bridge: ${que} no pudo escuchar en :${pedido}: ${err.message}`));
    server.once("error", alFallar);
    server.once("listening", () => {
      server.off("error", alFallar);
      ok((server.address() as AddressInfo).port);
    });
  });
}

function cerrarServidor(server: { close(cb: (err?: Error) => void): unknown }): Promise<void> {
  return new Promise((ok, falla) => server.close((err) => (err ? falla(err) : ok())));
}

export async function arrancarBridge(cfg: ConfigDelBridge): Promise<BridgeArrancado> {
  const config: CombatConfig = loadConfig(
    JSON.parse(readFileSync(resolve(cfg.dataDir, "combat_config.json"), "utf-8")),
  );
  const store = new GameStore();
  const sim = new GameSimulation(config, store, Date.now());
  const sessionStorage = new FsSessionStorage(cfg.savesDir);
  const narrative = new NarrativeState(sessionStorage);
  // Sin headersTimeout/bodyTimeout: el default de undici (300 s hasta recibir
  // cabeceras) mataba /generate_scene con "fetch failed" mientras el motor
  // narrativo seguía escribiendo. El AbortController del cliente
  // (llm_timeout_s + margen) es quien acota la espera.
  //
  // OJO: fetch y Agent deben venir del MISMO undici (el paquete npm). El fetch
  // GLOBAL de Node usa su undici interno y rechaza un Agent ajeno al instante
  // con "fetch failed: invalid onRequestStart method".
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  const { ctx, suscriptores } = crearContextoDelBridge({
    sim,
    combatConfig: config,
    store,
    narrative,
    sessionStorage,
    aiClient: new AiClient({
      baseUrl: cfg.aiServerUrl,
      fetchImpl: undiciFetch as unknown as typeof fetch,
      dispatcher,
    }),
    gamesDir: cfg.gamesDir,
    stylesDir: cfg.stylesDir,
    persistWorldSnapshots: true,
  });

  // El jugador NO se siembra al arrancar el PROCESO. Aquí había un combatiente
  // en (0,0,0) desde el primer segundo del bridge, y con él la guarda de
  // `handleInput` («sim aún sin sembrar») no saltaba nunca: cualquier socket
  // conducía el sim antes de que hubiera partida. Quien siembra al jugador es
  // quien sabe dónde está: `reseedSimForSession` (start/resume, con la posición
  // del save) o `handleLoadRoom` (fixtures del selector «Room»).

  const wss = new WebSocketServer({ port: cfg.port });
  // El oyente se ata ANTES de esperar a nada (QA de #769, H3): el socket que
  // conecte en cuanto el gateway escuche —antes de que el State API esté
  // arriba— es un socket aceptado, y sin oyente completaba el handshake y no
  // oía nunca su `bridge_hello` ni se atendían sus frames.
  wss.on("connection", (ws) => atenderConexion(ws, ctx, { entorno: cfg.entorno, suscriptores }));
  const puertoWs = await escuchando(wss, "el gateway WS", cfg.port);

  // State HTTP API: the narrative engine (Claude via narrative-mcp tools) queries
  // and mutates the authoritative NarrativeState here, instead of receiving the
  // whole world in the LLM context.
  const stateApi = createStateHttpServer({
    port: cfg.statePort,
    narrative,
    npcDirector: ctx.npcDirector,
    gamesDir: cfg.gamesDir,
    sessionStorage,
    aiServerUrl: cfg.aiServerUrl,
    gatewayUrl: `ws://127.0.0.1:${puertoWs}`,
    onMutation: async () => {
      await narrative.save();
    },
    onProgress: (message) => {
      ctx.broadcastNarrative({ type: "narrative_status", phase: "progress", kind: "scene", message });
    },
    onMapChanged: () => difundirSalidasDeLosTilesCargados(ctx),
    plugins: hooksDePluginsDelBridge(ctx),
  });
  let puertoStateApi: number;
  try {
    puertoStateApi = await escuchando(stateApi, "el State API", cfg.statePort);
  } catch (err) {
    // Medio bridge no es un bridge: sin State API el motor no puede tocar el
    // mundo. Se suelta el gateway que ya escuchaba y se propaga el motivo.
    await cerrarServidor(wss);
    await dispatcher.close();
    throw err;
  }

  return {
    ctx,
    puertoWs,
    puertoStateApi,
    servidores: { ws: wss, stateApi },
    async cerrar() {
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([cerrarServidor(wss), cerrarServidor(stateApi)]);
      await dispatcher.close();
    },
  };
}
