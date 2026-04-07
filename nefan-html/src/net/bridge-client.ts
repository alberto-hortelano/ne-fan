/** WebSocket client for nefan-core logic bridge (:9877).
 *  Mirrors Godot's logic_bridge.gd WebSocket protocol. */

import type { StateUpdateMessage } from "../../../nefan-core/src/protocol/messages.js";
import type { Vec3, EnemyPersonality } from "../../../nefan-core/src/types.js";

export type BridgeEvent = "state_update" | "connected" | "disconnected";

type BridgeHandler = (data?: StateUpdateMessage) => void;

export class BridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private retryInterval = 5000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<BridgeEvent, BridgeHandler[]> = new Map();
  private _connected = false;

  constructor(url = "ws://127.0.0.1:9877") {
    this.url = url;
    this.connect();
  }

  get isConnected(): boolean {
    return this._connected;
  }

  on(event: BridgeEvent, handler: BridgeHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: BridgeEvent, handler: BridgeHandler): void {
    const list = this.handlers.get(event);
    if (list) {
      this.handlers.set(event, list.filter(h => h !== handler));
    }
  }

  private emit(event: BridgeEvent, data?: StateUpdateMessage): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.emit("connected");
      console.log("BridgeClient: connected to", this.url);
    };

    this.ws.onclose = () => {
      const wasConnected = this._connected;
      this._connected = false;
      if (wasConnected) {
        this.emit("disconnected");
        console.log("BridgeClient: disconnected");
      }
      this.scheduleRetry();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "state_update") {
          this.emit("state_update", msg as StateUpdateMessage);
        }
      } catch {
        // Ignore parse errors
      }
    };
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryInterval);
  }

  private send(msg: Record<string, unknown>): void {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendInput(delta: number, inputs: {
    playerPosition: Vec3;
    playerForward: Vec3;
    playerMoving: boolean;
    attackRequested?: boolean;
    attackType?: string;
  }): void {
    this.send({ type: "input", delta, inputs });
  }

  sendLoadRoom(roomId: string, enemies: {
    id: string;
    position: Vec3;
    health: number;
    weaponId: string;
    personality: EnemyPersonality;
  }[], dimensions?: { width: number; depth: number }): void {
    this.send({ type: "load_room", roomId, enemies, dimensions });
  }

  sendLoadGame(gameId: string): void {
    this.send({ type: "load_game", gameId });
  }

  sendRespawn(): void {
    this.send({ type: "respawn" });
  }

  sendScenarioEvent(event: string, data?: Record<string, unknown>): void {
    this.send({ type: "scenario_event", event, data });
  }

  destroy(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }
}
