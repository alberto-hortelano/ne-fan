/** Game client over the WebSocket bridge. There is no local-simulation
 *  fallback any more: per CONFIG.session.require_bridge, the bridge MUST be
 *  reachable or the game refuses to start (see `createGameClient` below).
 *
 *  Lo que SÍ existe sin bridge es `ViewerGameClient`: un cliente inerte que no
 *  simula nada y solo deja que el game loop pinte. No es un modo de juego —es
 *  el visor de fixtures del preset `html-fixtures`— y quien lo instala
 *  (main.ts, bootstrap) lo hace DESPUÉS de decir el error, nunca en su lugar. */

import { GameStore } from "@nefan-core/src/store/game-store.js";
import type { CombatEvent, Vec3, EnemyPersonality } from "@nefan-core/src/types.js";
import type { StateUpdateMessage } from "@nefan-core/src/protocol/messages.js";
import type { WorldScene } from "@nefan-core/src/scene/scene-normalize.js";
import { CONFIG } from "@nefan-core/src/config.js";
import { errors } from "../ui/error-log.js";
import { BridgeClient } from "./bridge-client.js";

export interface FrameResult {
  events: CombatEvent[];
  playerHp: number;
  enemies: {
    id: string;
    hp: number;
    state: string;
    alive: boolean;
    pos?: { x: number; y: number; z: number };
    forward?: { x: number; y: number; z: number };
    attackType?: string;
  }[];
  /** Vida ambiental de NPCs del bridge (state_update.npcs). */
  npcs?: StateUpdateMessage["npcs"];
}

export interface TickInputs {
  playerPosition: Vec3;
  playerForward: Vec3;
  playerMoving: boolean;
  attackRequested?: boolean;
  attackType?: string;
}

export interface RoomEnemy {
  id: string;
  position: Vec3;
  /** La vida que le queda AHORA: la del contrato en un enemigo nuevo, la del
   *  save en uno que vuelve herido. */
  health: number;
  /** Y sobre cuánta. Sin este campo el bridge ponía `maxHealth = health` y un
   *  herido reanudado volvía con la barra llena (#326). */
  maxHealth: number;
  weaponId: string;
  personality: EnemyPersonality;
}

export type GameClientEvent = "connected" | "disconnected";
type EventHandler = (...args: unknown[]) => void;

export interface GameClient {
  tick(delta: number, inputs: TickInputs): FrameResult;
  /** Un frame SIN conducir la simulación: se pinta, pero no se manda input.
   *  Es lo que corre mientras el título cubre la pantalla — ahí no hay
   *  jugador que simular, y el frame que se mandaba llevaba la posición por
   *  defecto del cliente. Con el save arrastrando la posición viva del sim
   *  (#245), ese frame se llevaba por delante la partida guardada. */
  idle(): FrameResult;
  loadRoom(roomData: Pick<WorldScene, "dimensions">, roomId: string, enemies: RoomEnemy[]): void;
  /** Alta aditiva de combatientes (enemigos de un tile nuevo): no resetea el
   *  sim ni al player — el mundo es un plano continuo. */
  addEnemies(enemies: RoomEnemy[]): void;
  respawn(pos: Vec3): void;
  getCombatant(id: string): { health: number; maxHealth: number; weaponId: string } | undefined;
  isConnected: boolean;
  isBridge: boolean;
  on(event: GameClientEvent, handler: EventHandler): void;
  store: GameStore;
}

// --- Bridge mode: WebSocket to nefan-core ---

export class BridgeGameClient implements GameClient {
  private bridge: BridgeClient;
  store: GameStore;
  private lastState: FrameResult = { events: [], playerHp: 100, enemies: [] };
  private pendingFrame: FrameResult | null = null;
  isConnected = false;
  isBridge = true;
  private handlers: Map<GameClientEvent, EventHandler[]> = new Map();

  constructor(bridge: BridgeClient, store: GameStore) {
    this.bridge = bridge;
    this.store = store;

    bridge.on("state_update", (msg) => {
      if (!msg) return;
      const frame: FrameResult = {
        events: msg.events ?? [],
        playerHp: msg.playerHp,
        enemies: msg.enemies ?? [],
        npcs: msg.npcs,
      };
      this.pendingFrame = frame;
      this.lastState = frame;
    });

    bridge.on("connected", () => {
      this.isConnected = true;
      this.emit("connected");
    });

    bridge.on("disconnected", () => {
      this.isConnected = false;
      this.emit("disconnected");
    });

    this.isConnected = bridge.isConnected;
  }

  on(event: GameClientEvent, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  private emit(event: GameClientEvent, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  tick(delta: number, inputs: TickInputs): FrameResult {
    this.bridge.sendInput(delta, inputs);
    return this.idle();
  }

  /** Lo mismo SIN mandar input: consume el frame pendiente si lo hay (un
   *  state_update en vuelo sigue siendo estado real) y si no repite el último
   *  conocido sin eventos. */
  idle(): FrameResult {
    if (this.pendingFrame) {
      const frame = this.pendingFrame;
      this.pendingFrame = null;
      return frame;
    }
    return { ...this.lastState, events: [] };
  }

  loadRoom(roomData: Pick<WorldScene, "dimensions">, roomId: string, enemies: RoomEnemy[]): void {
    const { width, depth } = roomData.dimensions;
    this.bridge.sendLoadRoom(
      roomId,
      enemies.map(e => ({
        id: e.id, position: e.position, health: e.health, maxHealth: e.maxHealth,
        weaponId: e.weaponId, personality: e.personality,
      })),
      { width, depth },
    );
  }

  addEnemies(enemies: RoomEnemy[]): void {
    if (enemies.length === 0) return;
    this.bridge.sendAddCombatants(
      enemies.map(e => ({
        id: e.id, position: e.position, health: e.health, maxHealth: e.maxHealth,
        weaponId: e.weaponId, personality: e.personality,
      })),
    );
  }

  respawn(pos: Vec3): void {
    this.bridge.sendRespawn(pos);
  }

  getCombatant(id: string) {
    if (id === "player") {
      return { health: this.lastState.playerHp, maxHealth: 100, weaponId: "short_sword" };
    }
    const e = this.lastState.enemies.find(e => e.id === id);
    if (!e) return undefined;
    return { health: e.hp, maxHealth: e.hp, weaponId: "unarmed" };
  }
}

/** Cliente INERTE: no simula, no habla con nadie, no guarda. Existe para que
 *  el game loop pueda pintar cuando no hay bridge — sin esto `gameClient` se
 *  queda a null, el loop sale por su guarda antes de `render()` y el lienzo se
 *  queda NEGRO con la escena cargada (issue #215): el preset `html-fixtures`
 *  prometía iterar renderer y UI sin backend y no pintaba nada.
 *
 *  Lo que NO hace es tan importante como lo que hace: sin combate (los ataques
 *  animan y no aplican daño), sin enemigos, sin narrativa y sin partida. La
 *  vida se queda quieta al máximo porque nadie la baja, no porque el jugador
 *  sea invulnerable: aquí no hay quien pegue. */
export class ViewerGameClient implements GameClient {
  store: GameStore;
  /** Frame neutro y CONSTANTE: se reusa en cada tick porque no cambia nunca —
   *  un objeto nuevo por frame sería basura para el GC a 60 fps. */
  private readonly frame: FrameResult = { events: [], playerHp: 100, enemies: [] };
  isConnected = false;
  isBridge = false;

  constructor(store: GameStore) {
    this.store = store;
  }

  tick(): FrameResult {
    return this.frame;
  }

  /** Sin simulación, conducir y no conducir son lo mismo. */
  idle(): FrameResult {
    return this.frame;
  }

  /** Los enemigos de una fixture se ignoran a propósito: sin simulación,
   *  pintarlos sería enseñar muñecos que no reaccionan a nada. */
  loadRoom(): void {}
  addEnemies(): void {}
  respawn(): void {}

  getCombatant(id: string) {
    return id === "player"
      ? { health: this.frame.playerHp, maxHealth: 100, weaponId: "unarmed" }
      : undefined;
  }

  /** Nunca emite: no hay conexión que se caiga ni que vuelva. */
  on(): void {}
}

/** Visor de fixtures para cuando el bridge no está. Ver `ViewerGameClient`. */
export function createViewerClient(): GameClient {
  return new ViewerGameClient(new GameStore());
}

/** Wait for the BridgeClient to connect and then build a BridgeGameClient.
 *  If the bridge fails to connect within `timeoutMs`, the returned promise
 *  rejects — there is no local-simulation fallback. */
export function createGameClient(
  bridge: BridgeClient,
  timeoutMs = 5000,
): Promise<GameClient> {
  if (!CONFIG.session.require_bridge) {
    const msg = "session.require_bridge is false but no offline mode exists — refusing to start";
    errors.push("session", msg);
    return Promise.reject(new Error(msg));
  }
  const store = new GameStore();
  if (bridge.isConnected) {
    return Promise.resolve(new BridgeGameClient(bridge, store));
  }
  return new Promise<GameClient>((resolve, reject) => {
    const timer = setTimeout(() => {
      // La URL que se cita es la EFECTIVA (`bridge.url`), no el puerto del
      // snapshot: este texto lo pinta el muro que ve el jugador
      // (`setLoaderState` en bootstrap), y con `?offset=` o `?bridge=` el
      // socket no está donde dice el snapshot (#341).
      const msg = `bridge did not connect within ${timeoutMs}ms — is nefan-core bridge running on ${bridge.url}?`;
      errors.push("session", msg);
      reject(new Error(msg));
    }, timeoutMs);
    bridge.on("connected", () => {
      clearTimeout(timer);
      resolve(new BridgeGameClient(bridge, store));
    });
  });
}
