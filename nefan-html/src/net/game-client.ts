/** Dual-mode game client abstraction: local simulation or bridge WebSocket. */

import { GameSimulation } from "../../../nefan-core/src/simulation/game-loop.js";
import { createCombatant } from "../../../nefan-core/src/combat/combatant.js";
import { loadConfig } from "../../../nefan-core/src/combat/combat-data.js";
import { GameStore } from "../../../nefan-core/src/store/game-store.js";
import type { CombatConfig, CombatEvent, Vec3, EnemyPersonality } from "../../../nefan-core/src/types.js";
import type { StateUpdateMessage } from "../../../nefan-core/src/protocol/messages.js";
import type { NpcUpdate, ScenarioUpdate } from "../../../nefan-core/src/scenario/scenario-types.js";
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

// --- Local mode: in-process simulation (current behavior) ---

export class LocalGameClient implements GameClient {
  private sim: GameSimulation;
  store: GameStore;
  private config: CombatConfig;
  isConnected = true;
  isBridge = false;
  private handlers: Map<GameClientEvent, EventHandler[]> = new Map();

  constructor(configJson: Record<string, unknown>) {
    this.config = loadConfig(configJson);
    this.store = new GameStore();
    this.sim = new GameSimulation(this.config, this.store, Date.now());
    this.sim.addCombatant(
      createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }),
    );
  }

  on(event: GameClientEvent, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  tick(delta: number, inputs: TickInputs): FrameResult {
    // Update player position in combatant
    const player = this.sim.getCombatant("player");
    if (player) {
      player.position = { ...inputs.playerPosition };
      player.forward = { ...inputs.playerForward };
    }

    const result = this.sim.tick(delta, {
      playerPosition: inputs.playerPosition,
      playerForward: inputs.playerForward,
      playerMoving: inputs.playerMoving,
      attackRequested: inputs.attackRequested,
      attackType: inputs.attackType,
    });

    const enemies: FrameResult["enemies"] = [];
    for (const e of this.store.state.enemies) {
      const c = this.sim.getCombatant(e.id);
      if (c) {
        enemies.push({
          id: c.id,
          hp: c.health,
          state: c.state,
          alive: c.health > 0,
          pos: { x: c.position.x, y: c.position.y, z: c.position.z },
          forward: { x: c.forward.x, y: c.forward.y, z: c.forward.z },
          attackType: c.currentAttackType || undefined,
        });
      }
    }

    return {
      events: result.events,
      playerHp: player?.health ?? 0,
      enemies,
    };
  }

  loadRoom(roomData: Record<string, unknown>, roomId: string, enemies: RoomEnemy[]): void {
    this.sim.reset();
    this.sim.addCombatant(
      createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }),
    );
    const dims = roomData.dimensions as { width?: number; depth?: number } | undefined;
    if (dims) {
      this.sim.setRoomBounds(dims.width ?? 20, dims.depth ?? 20);
    }
    for (const e of enemies) {
      const combatant = createCombatant(e.id, e.health, e.weaponId, e.position, { x: 0, y: 0, z: 1 });
      this.sim.addCombatant(combatant, e.personality);
    }
    this.store.dispatch("room_changed", {
      room_id: roomId,
      enemies: enemies.map(e => ({
        id: e.id, pos: [e.position.x, e.position.y, e.position.z],
        hp: e.health, max_hp: e.health, weapon_id: e.weaponId,
        combat_state: "idle", alive: true,
      })),
    });
  }

  loadGame(_gameId: string): void {
    console.warn("LocalGameClient: loadGame requires bridge connection");
  }

  respawn(pos: Vec3): void {
    this.sim.respawn(pos);
  }

  sendScenarioEvent(_event: string, _data?: Record<string, unknown>): void {
    // No-op in local mode
  }

  getCombatant(id: string) {
    const c = this.sim.getCombatant(id);
    if (!c) return undefined;
    return { health: c.health, maxHealth: c.maxHealth, weaponId: c.weaponId };
  }
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

/** Try to create a bridge client; returns BridgeGameClient if connected within
 *  timeout, else LocalGameClient. Accepts an existing BridgeClient (the same
 *  one used by NarrativeClient) so we don't open two parallel sockets to the
 *  bridge. */
export function createGameClient(
  configJson: Record<string, unknown>,
  bridge: BridgeClient,
  onReady: (client: GameClient) => void,
): void {
  const store = new GameStore();
  let resolved = false;

  const timeout = setTimeout(() => {
    if (resolved) return;
    resolved = true;
    if (bridge.isConnected) {
      console.log("GameClient: using bridge mode");
      onReady(new BridgeGameClient(bridge, store));
    } else {
      console.log("GameClient: using local mode (bridge not available)");
      onReady(new LocalGameClient(configJson));
    }
  }, 2000);

  bridge.on("connected", () => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeout);
    console.log("GameClient: using bridge mode");
    onReady(new BridgeGameClient(bridge, store));
  });
}
