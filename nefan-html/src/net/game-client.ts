/** Game client over the WebSocket bridge. There is no local-simulation
 *  fallback any more: per CONFIG.session.require_bridge, the bridge MUST be
 *  reachable or the game refuses to start (see `createGameClient` below). */

import { GameStore } from "../../../nefan-core/src/store/game-store.js";
import type { CombatEvent, Vec3, EnemyPersonality } from "../../../nefan-core/src/types.js";
import type { NpcUpdate, ScenarioUpdate } from "../../../nefan-core/src/scenario/scenario-types.js";
import { CONFIG } from "../../../nefan-core/src/config.js";
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
  npcs?: NpcUpdate[];
  scenario?: ScenarioUpdate;
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
  health: number;
  weaponId: string;
  personality: EnemyPersonality;
}

export type GameClientEvent = "scenario_update" | "connected" | "disconnected";
type EventHandler = (...args: unknown[]) => void;

export interface GameClient {
  tick(delta: number, inputs: TickInputs): FrameResult;
  loadRoom(roomData: Record<string, unknown>, roomId: string, enemies: RoomEnemy[]): void;
  loadGame(gameId: string): void;
  respawn(pos: Vec3): void;
  sendScenarioEvent(event: string, data?: Record<string, unknown>): void;
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
        scenario: msg.scenario,
      };
      this.pendingFrame = frame;
      this.lastState = { ...frame, scenario: undefined }; // Keep last state without one-shot scenario
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

    // Return pending frame if available, otherwise last known state with no events
    if (this.pendingFrame) {
      const frame = this.pendingFrame;
      this.pendingFrame = null;
      return frame;
    }

    return { ...this.lastState, events: [] };
  }

  loadRoom(roomData: Record<string, unknown>, roomId: string, enemies: RoomEnemy[]): void {
    const dims = roomData.dimensions as { width?: number; depth?: number } | undefined;
    this.bridge.sendLoadRoom(
      roomId,
      enemies.map(e => ({
        id: e.id, position: e.position, health: e.health,
        weaponId: e.weaponId, personality: e.personality,
      })),
      dims ? { width: dims.width ?? 20, depth: dims.depth ?? 20 } : undefined,
    );
  }

  loadGame(gameId: string): void {
    this.bridge.sendLoadGame(gameId);
  }

  respawn(_pos: Vec3): void {
    this.bridge.sendRespawn();
  }

  sendScenarioEvent(event: string, data?: Record<string, unknown>): void {
    this.bridge.sendScenarioEvent(event, data);
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
      const msg = `bridge did not connect within ${timeoutMs}ms — is nefan-core bridge running on ws://localhost:9877?`;
      errors.push("session", msg);
      reject(new Error(msg));
    }, timeoutMs);
    bridge.on("connected", () => {
      clearTimeout(timer);
      resolve(new BridgeGameClient(bridge, store));
    });
  });
}
