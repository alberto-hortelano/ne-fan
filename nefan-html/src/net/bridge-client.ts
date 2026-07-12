/** WebSocket client for nefan-core logic bridge (:9877).
 *  Mirrors Godot's logic_bridge.gd WebSocket protocol. */

import type {
  StateUpdateMessage,
  ServerMessage,
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionsListedMessage,
  SessionStartedMessage,
  GamesListedMessage,
  GameCreatedMessage,
  SessionDeletedMessage,
  SessionSavedMessage,
} from "@nefan-core/src/protocol/messages.js";
import type { Vec3, EnemyPersonality } from "@nefan-core/src/types.js";
import { errors } from "../ui/error-log.js";
import { CONFIG } from "@nefan-core/src/config.js";

export type BridgeEvent =
  | "state_update"
  | "connected"
  | "disconnected"
  | "narrative_event"
  | "narrative_status";

type EventPayload = {
  state_update: StateUpdateMessage;
  connected: undefined;
  disconnected: undefined;
  narrative_event: NarrativeEventMessage;
  narrative_status: NarrativeStatusMessage;
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

  constructor(url = `ws://127.0.0.1:${CONFIG.ports.bridge}`) {
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

    this.ws.onerror = (event) => {
      // The browser hides the underlying error for security; onclose fires
      // right after with a useful close code, so we surface the event here
      // mostly as a breadcrumb. Without this push the user sees only a
      // generic "disconnected" later, with no hint that the disconnect
      // came from an error rather than a clean close.
      errors.push("bridge", `WebSocket onerror on ${this.url}`, event);
    };

    this.ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      try {
        const msg = JSON.parse(raw) as ServerMessage;
        this.dispatch(msg);
      } catch (err) {
        const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
        errors.push("bridge", `Failed to parse WS frame: ${preview}`, err);
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
      case "narrative_status":
        this.emit("narrative_status", msg);
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

  /** Send a frame to the bridge. When disconnected the message is dropped;
   *  unless `opts.quietOnDisconnect` is set we log it to ErrorLog so a lost
   *  one-shot (start_session, dialogue_choice…) is visible. High-frequency calls
   *  like `sendInput` pass `quietOnDisconnect: true` — losing one frame is
   *  harmless and we'd otherwise flood the log. */
  private send(msg: Record<string, unknown>, opts: { quietOnDisconnect?: boolean } = {}): void {
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    if (!opts.quietOnDisconnect) {
      const type = typeof msg.type === "string" ? msg.type : "<no type>";
      errors.push("bridge", `Dropped '${type}' frame: bridge not connected`);
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
    // Per-frame call: dropping while disconnected is fine, the next reconnect
    // resyncs from the player's current position.
    this.send({ type: "input", delta, inputs }, { quietOnDisconnect: true });
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

  sendRespawn(pos?: { x: number; y: number; z: number }): void {
    this.send({ type: "respawn", pos });
  }

  /** Pide un tile del plano continuo (prefetch en 2º plano o blocking). */
  sendRequestTile(tx: number, ty: number, reason: "prefetch" | "blocking", edge?: "north" | "south" | "east" | "west"): void {
    this.send({ type: "request_tile", tx, ty, reason, edge });
  }

  /** Análisis de imagen del tile (mundo derivado): fire-and-forget, el bridge
   *  lo persiste en el save y lo resume al motor narrativo. */
  sendTileAnalysis(
    tx: number,
    ty: number,
    elements: Array<{
      label: string;
      solid: boolean;
      tall: boolean;
      rect: { minX: number; maxX: number; minZ: number; maxZ: number };
    }>,
  ): void {
    this.send({ type: "tile_analysis", tx, ty, elements });
  }

  sendMapPlanUpdate(tx: number, ty: number, plan: { map_ground?: string; volumes?: unknown[] }): void {
    this.send({ type: "map_plan_update", tx, ty, map_ground: plan.map_ground, volumes: plan.volumes });
  }

  /** Alta ADITIVA de combatientes en el sim del bridge (enemigos de un tile
   *  nuevo) — no resetea nada, ids ya presentes se ignoran. */
  sendAddCombatants(enemies: {
    id: string;
    position: { x: number; y: number; z: number };
    health: number;
    weaponId: string;
    personality: EnemyPersonality;
  }[]): void {
    this.send({ type: "add_combatants", enemies });
  }

  // ── Narrative requests (correlated by requestId) ──

  listSessions(): Promise<SessionsListedMessage> {
    return this.request<SessionsListedMessage>({ type: "list_sessions" });
  }

  listGames(): Promise<GamesListedMessage> {
    return this.request<GamesListedMessage>({ type: "list_games" });
  }

  /** Desarrollar un mundo de usuario tarda como un bootstrap (~1-3 min):
   *  timeout largo explícito. */
  createGame(draftText: string): Promise<GameCreatedMessage> {
    return this.request<GameCreatedMessage>({ type: "create_game", draftText }, 400_000);
  }

  startSession(
    gameId: string,
    appearance?: { model_id: string; skin_path: string },
    styleId?: string,
    perspective?: string,
    renderMode?: string,
  ): Promise<SessionStartedMessage> {
    return this.request<SessionStartedMessage>({ type: "start_session", gameId, appearance, styleId, perspective, renderMode });
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

  /** Tell the bridge the player entered a world-map place. The bridge lazily
   *  realizes the place's scene and broadcasts it as a narrative_event. */
  sendPlayerEnteredPlace(placeId: string): void {
    this.send({ type: "player_entered_place", placeId });
  }

  /** Tell the bridge the player walked off a scene edge with NO known
   *  destination: the narrative engine extends the world in that direction
   *  (place + link + scene, on the fly). */
  sendPlayerCrossedFrontier(edge: "north" | "south" | "east" | "west"): void {
    this.send({ type: "player_crossed_frontier", edge });
  }

  /** Tell the bridge the player walked up to an NPC and pressed interact. The
   *  bridge reports it to the narrative engine and broadcasts the reply. */
  sendInteractEntity(entityId: string, entityName: string): void {
    this.send({ type: "interact_entity", entityId, entityName });
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
