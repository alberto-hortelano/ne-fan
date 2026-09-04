/** WebSocket client for the nefan-core logic bridge (game-gateway; la URL la
 *  resuelve el caller con serviceUrl("game-gateway")). */

import type {
  AddCombatantsMessage,
  LoadRoomMessage,
  StateUpdateMessage,
  ServerMessage,
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionsListedMessage,
  SessionStartedMessage,
  GamesListedMessage,
  GameCreatedMessage,
  GameGeneratedMessage,
  WorldSnapshotMessage,
  StyleApplicationRecordedMessage,
  SessionDeletedMessage,
  RenderModeSetMessage,
  RenderModeChangedMessage,
  ExitsChangedMessage,
} from "@nefan-core/src/protocol/messages.js";
import type { Vec3 } from "@nefan-core/src/types.js";
import { AVISO_PARTIDA, AVISO_TRAMA_ILEGIBLE, errors } from "../ui/error-log.js";

export type BridgeEvent =
  | "state_update"
  | "connected"
  | "disconnected"
  | "narrative_event"
  | "narrative_status"
  | "render_mode_changed"
  | "exits_changed";

type EventPayload = {
  state_update: StateUpdateMessage;
  connected: undefined;
  disconnected: undefined;
  narrative_event: NarrativeEventMessage;
  narrative_status: NarrativeStatusMessage;
  render_mode_changed: RenderModeChangedMessage;
  exits_changed: ExitsChangedMessage;
};

type Handler<E extends BridgeEvent> = (data: EventPayload[E]) => void;

interface PendingRequest {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private _url: string;
  private retryInterval = 5000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: Map<BridgeEvent, Handler<BridgeEvent>[]> = new Map();
  private _connected = false;
  private pending = new Map<string, PendingRequest>();
  private nextRequestId = 0;

  constructor(url: string) {
    this._url = url;
    this.connect();
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /** La URL EFECTIVA del socket: la que resolvió `serviceUrl("game-gateway")`
   *  con los overrides de la query ya aplicados (`?offset=`, `?bridge=`).
   *
   *  Existe para que el fail-loud pueda citarla (#341). Antes el muro de
   *  arranque interpolaba `localhost` y el puerto del snapshot, así que con un
   *  bloque de puertos desplazado o con el bridge en otra máquina mandaba al
   *  jugador a mirar un sitio donde no había nada. Solo lectura: quien quiera
   *  cambiar de socket construye otro cliente. */
  get url(): string {
    return this._url;
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
      this.ws = new WebSocket(this._url);
    } catch {
      this.scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.emit("connected");
      console.log("BridgeClient: connected to", this._url);
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
      // Y A LA PANTALLA (#306): sin este socket no hay partida ninguna, y el
      // aviso llega mucho antes que el muro de `bootstrap` —que espera cinco
      // segundos a que el bridge conteste—. Es idempotente por su texto, que
      // no cambia: el reintento cada 5 s no lo repite.
      errors.push("bridge", `WebSocket onerror on ${this._url}`, event, {
        alJugador: AVISO_PARTIDA,
      });
    };

    this.ws.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      try {
        const msg = JSON.parse(raw) as ServerMessage;
        this.dispatch(msg);
      } catch (err) {
        const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
        // Titular PROPIO y no el de «sin conexión» (#306): aquí el socket está
        // abierto y contestando, así que decirle al jugador que no hay conexión
        // sería mandarlo a mirar su red por un fallo que no es suyo. La partida
        // está igual de rota, pero por otro motivo.
        errors.push("bridge", `Failed to parse WS frame: ${preview}`, err, {
          alJugador: AVISO_TRAMA_ILEGIBLE,
        });
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
      case "render_mode_changed":
        this.emit("render_mode_changed", msg);
        break;
      case "exits_changed":
        this.emit("exits_changed", msg);
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
      // A la pantalla con el mismo titular que el `onerror` (#306): para quien
      // juega, «se perdió lo que acabas de pedir porque no hay socket» y «el
      // socket no abre» son la misma noticia, y colapsan en un aviso. El tipo
      // de trama perdida sigue en el detalle.
      errors.push("bridge", `Dropped '${type}' frame: bridge not connected`, undefined, {
        alJugador: AVISO_PARTIDA,
      });
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

  // La forma de `enemies` se IMPORTA del contrato, no se copia: al añadirle
  // `maxHealth` (#326) esta copia y la del alta aditiva de abajo habrían
  // seguido compilando con el campo de menos, y el bridge lo habría rechazado
  // en el zod en tiempo de partida.
  sendLoadRoom(
    roomId: string,
    enemies: LoadRoomMessage["enemies"],
    dimensions?: { width: number; depth: number },
  ): void {
    this.send({ type: "load_room", roomId, enemies, dimensions });
  }

  sendRespawn(pos?: { x: number; y: number; z: number }): void {
    this.send({ type: "respawn", pos });
  }

  /** Pide un tile del plano continuo (prefetch en 2º plano o blocking). */
  sendRequestTile(tx: number, ty: number, reason: "prefetch" | "blocking", edge?: "north" | "south" | "east" | "west"): void {
    this.send({ type: "request_tile", tx, ty, reason, edge });
  }

  /** Alta ADITIVA de combatientes en el sim del bridge (enemigos de un tile
   *  nuevo) — no resetea nada, ids ya presentes se ignoran. */
  sendAddCombatants(enemies: AddCombatantsMessage["enemies"]): void {
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

  /** Pre-generar el mundo de un juego. La respuesta llega
   *  al ENCOLAR; el progreso y el final viajan por narrative_status kind
   *  "game_gen". */
  generateGame(gameId: string): Promise<GameGeneratedMessage> {
    return this.request<GameGeneratedMessage>({ type: "generate_game", gameId });
  }

  /** Snapshot de mundo pre-generado + vocabulario (batch de aplicar estilo).
   *  Timeout largo: el snapshot con anillo+places puede pesar varios MB. */
  getWorldSnapshot(gameId: string): Promise<WorldSnapshotMessage> {
    return this.request<WorldSnapshotMessage>(
      { type: "get_world_snapshot", gameId },
      120_000,
    );
  }

  recordStyleApplication(
    record: Record<string, unknown>,
  ): Promise<StyleApplicationRecordedMessage> {
    return this.request<StyleApplicationRecordedMessage>({
      type: "record_style_application",
      record,
    });
  }

  startSession(
    gameId: string,
    appearance?: { model_id: string; skin_path: string },
    styleId?: string,
    renderMode?: string,
    characterMode?: string,
  ): Promise<SessionStartedMessage> {
    return this.request<SessionStartedMessage>({ type: "start_session", gameId, appearance, styleId, renderMode, characterMode });
  }

  resumeSession(sessionId: string): Promise<SessionStartedMessage> {
    return this.request<SessionStartedMessage>({ type: "resume_session", sessionId });
  }

  deleteSession(sessionId: string): Promise<SessionDeletedMessage> {
    return this.request<SessionDeletedMessage>({ type: "delete_session", sessionId });
  }

  /** Cambia el modo de render de un save (image⇄vector), por faceta:
   *  escenarios o personajes. Bajar a vector solo bloquea generación nueva. */
  setRenderMode(sessionId: string, renderMode: "image" | "vector", facet: "scenes" | "characters"): Promise<RenderModeSetMessage> {
    return this.request<RenderModeSetMessage>({ type: "set_render_mode", sessionId, renderMode, facet });
  }

  sendDialogueChoice(payload: {
    eventId: string;
    choiceIndex: number;
    speaker: string;
    speakerId?: string;
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

  /** El jugador ENTRÓ en la partida: ya está vestido y el mundo pintado. Con
   *  esto el bridge la establece en `saves/` — antes no existía (#279). Sin
   *  respuesta: es un hecho, no una petición. Un frame perdido con el bridge
   *  caído se registra loud como cualquier otro one-shot, y ahí la señal es
   *  que la partida no llega a escribirse. */
  sendSessionEntered(sessionId: string): void {
    this.send({ type: "session_entered", sessionId });
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
