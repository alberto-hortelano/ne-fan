/** WebSocket client for nefan-core logic bridge (:9877).
 *  Mirrors Godot's logic_bridge.gd WebSocket protocol. */

import type {
  StateUpdateMessage,
  ServerMessage,
  NarrativeEventMessage,
  SessionsListedMessage,
  SessionStartedMessage,
  GamesListedMessage,
  SessionDeletedMessage,
  SessionSavedMessage,
} from "../../../nefan-core/src/protocol/messages.js";
import type { Vec3, EnemyPersonality } from "../../../nefan-core/src/types.js";

export type BridgeEvent = "state_update" | "connected" | "disconnected" | "narrative_event";

type EventPayload = {
  state_update: StateUpdateMessage;
  connected: undefined;
  disconnected: undefined;
  narrative_event: NarrativeEventMessage;
};

type Handler<E extends BridgeEvent> = (data: EventPayload[E]) => void;

interface PendingRequest {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private retryInterval = 5000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<BridgeEvent, Handler<BridgeEvent>[]> = new Map();
  private _connected = false;
  private pending = new Map<string, PendingRequest>();
  private nextRequestId = 0;

  constructor(url = "ws://127.0.0.1:9877") {
    this.url = url;
    this.connect();
  }

  get isConnected(): boolean {
    return this._connected;
  }

  on<E extends BridgeEvent>(event: E, handler: Handler<E>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<BridgeEvent>);
    this.handlers.set(event, list);
  }

  off<E extends BridgeEvent>(event: E, handler: Handler<E>): void {
    const list = this.handlers.get(event);
    if (list) {
      this.handlers.set(event, list.filter((h) => h !== (handler as Handler<BridgeEvent>)));
    }
  }

  private emit<E extends BridgeEvent>(event: E, data?: EventPayload[E]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (d: EventPayload[E] | undefined) => void)(data);
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
      // Reject any in-flight requests
      for (const [id, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error("Bridge disconnected"));
        this.pending.delete(id);
      }
      this.scheduleRetry();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        this.dispatch(msg);
      } catch {
        // Ignore parse errors
      }
    };
  }

  private dispatch(msg: ServerMessage): void {
    if ("requestId" in msg && typeof msg.requestId === "string") {
      const pending = this.pending.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.requestId);
        pending.resolve(msg);
        return;
      }
    }
    switch (msg.type) {
      case "state_update":
        this.emit("state_update", msg);
        break;
      case "narrative_event":
        this.emit("narrative_event", msg);
        break;
    }
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

  private async request<T extends ServerMessage>(
    msg: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (!this._connected) {
      throw new Error("Bridge not connected");
    }
    const requestId = `req_${++this.nextRequestId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Bridge request timeout: ${msg.type}`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: resolve as (m: ServerMessage) => void,
        reject,
        timer,
      });
      this.send({ ...msg, requestId });
    });
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

  // ── Narrative requests (correlated by requestId) ──

  listSessions(): Promise<SessionsListedMessage> {
    return this.request<SessionsListedMessage>({ type: "list_sessions" });
  }

  listGames(): Promise<GamesListedMessage> {
    return this.request<GamesListedMessage>({ type: "list_games" });
  }

  startSession(gameId: string, appearance?: { model_id: string; skin_path: string }): Promise<SessionStartedMessage> {
    return this.request<SessionStartedMessage>({ type: "start_session", gameId, appearance });
  }

  resumeSession(sessionId: string): Promise<SessionStartedMessage> {
    return this.request<SessionStartedMessage>({ type: "resume_session", sessionId });
  }

  deleteSession(sessionId: string): Promise<SessionDeletedMessage> {
    return this.request<SessionDeletedMessage>({ type: "delete_session", sessionId });
  }

  saveSession(): Promise<SessionSavedMessage> {
    return this.request<SessionSavedMessage>({ type: "save_session" });
  }

  sendDialogueChoice(payload: {
    eventId: string;
    choiceIndex: number;
    speaker: string;
    chosenText: string;
    freeText?: string;
  }): void {
    this.send({ type: "dialogue_choice", ...payload });
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
