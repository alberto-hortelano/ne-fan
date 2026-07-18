import { WebSocketServer, WebSocket as WsWebSocket, type WebSocket } from 'ws';
import type { ClientMsg, PeerMsg, RequestMsg } from './protocol.js';
import { RUNTIME_CONFIG } from './runtime-config.js';

const PORT = Number(process.env.NARRATIVE_WS_PORT) || RUNTIME_CONFIG.ports.narrative_ws;

interface PendingResponse {
  resolve: (data: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WsBridge {
  // null until the port is actually bound. Binding is LAZY by default: it
  // happens on the first narrative_listen, NOT at process startup. This is the
  // crux — every Claude Code instance in the project spawns its own
  // narrative-mcp via .mcp.json, so binding (and taking over) at startup means
  // opening ANY second terminal — even one only used for code work — steals
  // the bridge from an active narrative session. Binding on first listen makes
  // "the terminal that calls narrative_listen owns the bridge" the rule.
  private wss: WebSocketServer | null = null;
  private bindPromise: Promise<void> | null = null;
  private client: WebSocket | null = null;

  // Request queue: Python pushes requests, narrative_listen pops
  private requestQueue: RequestMsg[] = [];
  private requestWaiter: ((msg: RequestMsg) => void) | null = null;
  // Rejects a narrative_listen that's waiting when this bridge gets taken over,
  // so the displaced terminal returns a clear error instead of hanging forever.
  private requestRejecter: ((err: Error) => void) | null = null;

  // MCP listener tracking: is there a Claude Code instance actively
  // calling narrative_listen? Used to fail-fast on unattended requests.
  private mcpEverConnected = false;
  private lastListenAt = 0;
  // Petición entregada a narrative_listen y aún sin narrative_respond: el
  // listener está OCUPADO generándola (un tile con map_svg puede llevar
  // minutos), no ausente. Sin esto, una petición que llegue justo tras un
  // respond tardío (p. ej. el blueprint_review que el cliente dispara al
  // recibir el tile) se rechazaba como "idle" con la sesión viva.
  private inFlightSince = 0;

  // Pending responses: Claude responds, Python receives
  private pendingResponses = new Map<string, PendingResponse>();

  // Socket que ORIGINÓ cada request_id: la respuesta y el progreso vuelven a
  // ese socket, no a "el último cliente que conectó". Sin esto, un ai_server
  // moribundo (drenando su cola tras un SIGTERM) que se reconecta tarde roba
  // el canal y la respuesta del motor se pierde (el ai_server vivo agota sus
  // 900 s y devuelve 504 con la escena ya generada). Fallback a `client` si
  // el socket de origen cerró.
  private requestOrigins = new Map<string, WebSocket>();
  // Todos los sockets de ai_server abiertos: cuando el vigente cierra, otro
  // abierto toma el relevo (sin esto, la muerte del zombie dejaba `client` a
  // null con el ai_server vivo aún conectado — canal medio muerto).
  private clients = new Set<WebSocket>();

  private constructor() {}

  /** Create the bridge. By default the port is NOT bound yet — the first
   *  narrative_listen binds it (see ensureBound). Set NARRATIVE_EAGER_BIND to
   *  bind immediately: used by the start.sh placeholder so its wait_for_port
   *  passes and the port is held until a Claude Code terminal takes over. */
  static async create(): Promise<WsBridge> {
    const bridge = new WsBridge();
    if (process.env.NARRATIVE_EAGER_BIND) {
      await bridge.ensureBound();
    }
    return bridge;
  }

  /** Bind the port (taking over any existing bridge) exactly once. Concurrent
   *  callers share the same in-flight promise; once bound it's a no-op. */
  private ensureBound(): Promise<void> {
    if (this.wss) return Promise.resolve();
    if (!this.bindPromise) this.bindPromise = this.bind();
    return this.bindPromise;
  }

  private async bind(): Promise<void> {
    let wss: WebSocketServer;
    try {
      wss = await WsBridge.tryBind();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        this.bindPromise = null;
        throw err;
      }
      console.error(`[narrative-mcp] port ${PORT} in use — requesting takeover`);
      await WsBridge.requestTakeover();
      // Retry the bind: the previous owner's wss.close() may not release the
      // port instantly, so poll briefly instead of failing on the first EADDRINUSE.
      wss = await WsBridge.tryBindWithRetry();
    }
    this.attach(wss);
  }

  private attach(wss: WebSocketServer): void {
    this.wss = wss;

    wss.on('connection', (ws) => {
      ws.once('message', (raw) => {
        try {
          const msg: PeerMsg = JSON.parse(String(raw));
          if (msg.type === 'takeover') {
            console.error('[narrative-mcp] takeover requested — shutting down');
            this.shutdown();
            return;
          }
        } catch {
          // Not a peer message
        }

        this.setupClient(ws);
        this.handleClientMessage(ws, raw);
      });
    });

    console.error(`[narrative-mcp] WebSocket listening on ws://localhost:${PORT}`);
  }

  private static tryBind(): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: PORT });
      wss.once('listening', () => resolve(wss));
      wss.once('error', (err) => reject(err));
    });
  }

  /** Bind, retrying on EADDRINUSE for a short window — the prior owner may need
   *  a moment to release the port after its wss.close() during takeover. */
  private static async tryBindWithRetry(attempts = 15, delayMs = 100): Promise<WebSocketServer> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await WsBridge.tryBind();
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
        lastErr = err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  private static requestTakeover(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WsWebSocket(`ws://localhost:${PORT}`);
      ws.once('open', () => ws.send(JSON.stringify({ type: 'takeover' })));
      ws.once('close', () => setTimeout(resolve, 200));
      ws.once('error', (err) => reject(err));
    });
  }

  private setupClient(ws: WebSocket): void {
    if (this.client && this.client !== ws && this.client.readyState === this.client.OPEN) {
      // Dos ai_server vivos a la vez (p. ej. uno viejo drenando tras un
      // restart del stack). No se expulsa a nadie: el enrutado por
      // request_id decide a quién va cada respuesta.
      console.error('[narrative-mcp] WARNING: second AI server connected while another is still open');
    }
    this.client = ws;
    this.clients.add(ws);
    console.error('[narrative-mcp] Python AI server connected');

    ws.on('message', (raw) => this.handleClientMessage(ws, raw));
    ws.on('close', () => {
      this.clients.delete(ws);
      // Olvidar los orígenes de este socket: sus respuestas pendientes caen
      // al fallback (el cliente vigente) en vez de a un socket muerto.
      for (const [id, origin] of this.requestOrigins) {
        if (origin === ws) this.requestOrigins.delete(id);
      }
      if (this.client === ws) {
        // Relevo: otro socket abierto (p. ej. el ai_server vivo cuando el
        // zombie por fin muere) pasa a ser el vigente.
        this.client = [...this.clients].find((c) => c.readyState === c.OPEN) ?? null;
        if (!this.client) console.error('[narrative-mcp] Python AI server disconnected');
      }
    });
  }

  private handleClientMessage(ws: WebSocket, raw: unknown): void {
    try {
      const msg: ClientMsg = JSON.parse(String(raw));

      if (msg.type === 'hello') return;

      if (msg.type === 'bridge_status_request') {
        this.sendBridgeStatus(ws, msg.request_id);
        return;
      }

      if (msg.type === 'room_request' || msg.type === 'vision_request' || msg.type === 'narrative_event' || msg.type === 'blueprint_review') {
        this.requestOrigins.set(msg.request_id, ws);
        // Fail-fast: if no MCP client (Claude Code) has ever called
        // narrative_listen, reject the request immediately so the AI server
        // can fall back to API or report an error to Godot.
        if (!this.isListenerActive()) {
          this.sendNoListenerError(msg);
          return;
        }
        this.enqueueRequest(msg);
      }
    } catch {
      // ignore malformed
    }
  }

  /** Socket al que enviar tráfico de una petición: el que la originó si sigue
   *  abierto; si no, el cliente vigente (reconexión del mismo ai_server). */
  private targetFor(requestId: string): WebSocket | null {
    const origin = this.requestOrigins.get(requestId);
    if (origin && origin.readyState === origin.OPEN) return origin;
    if (this.client && this.client.readyState === this.client.OPEN) return this.client;
    return null;
  }

  private sendBridgeStatus(ws: WebSocket, requestId: string): void {
    if (ws.readyState !== ws.OPEN) return;
    const sinceLast = this.lastListenAt > 0 ? (Date.now() - this.lastListenAt) / 1000 : -1;
    ws.send(JSON.stringify({
      type: 'bridge_status_response',
      request_id: requestId,
      listener_active: this.isListenerActive(),
      listener_ever_connected: this.mcpEverConnected,
      last_listen_seconds_ago: sinceLast,
    }));
  }

  /** True if a Claude Code MCP client is currently waiting on narrative_listen
   * (waiter set), is BUSY generating a delivered request (in-flight, con tope
   * de 10 min por si el modelo murió sin responder), or has listened/responded
   * within the last 60 seconds. */
  private isListenerActive(): boolean {
    if (this.requestWaiter !== null) return true;
    if (!this.mcpEverConnected) return false;
    if (this.inFlightSince > 0 && Date.now() - this.inFlightSince < 600_000) return true;
    const sinceLast = Date.now() - this.lastListenAt;
    return sinceLast < 60_000;
  }

  /** Un narrative_respond acaba de llegar: el listener está vivo y va a
   *  re-escuchar en segundos — refrescar actividad y cerrar el in-flight. */
  private markResponded(): void {
    this.inFlightSince = 0;
    this.lastListenAt = Date.now();
  }

  private sendNoListenerError(msg: RequestMsg): void {
    const target = this.targetFor(msg.request_id);
    this.requestOrigins.delete(msg.request_id);
    if (!target) return;
    const reason = this.mcpEverConnected
      ? 'mcp_listener_idle'
      : 'mcp_listener_never_connected';
    const errorPayload = {
      error: 'no_mcp_listener',
      reason,
      message: 'No Claude Code instance is calling narrative_listen on the bridge. ' +
               'Start Claude Code from the project directory so .mcp.json loads narrative-mcp.',
    };
    if (msg.type === 'vision_request') {
      target.send(JSON.stringify({
        type: 'vision_response',
        request_id: msg.request_id,
        result: errorPayload,
      }));
    } else if (msg.type === 'narrative_event') {
      target.send(JSON.stringify({
        type: 'narrative_event_response',
        request_id: msg.request_id,
        result: errorPayload,
      }));
    } else if (msg.type === 'blueprint_review') {
      target.send(JSON.stringify({
        type: 'blueprint_review_response',
        request_id: msg.request_id,
        result: errorPayload,
      }));
    } else if (msg.type === 'room_request') {
      target.send(JSON.stringify({
        type: 'room_response',
        request_id: msg.request_id,
        room_data: errorPayload,
      }));
    }
    console.error(`[narrative-mcp] No MCP listener — rejected ${msg.type} (${reason})`);
  }

  private enqueueRequest(msg: RequestMsg): void {
    if (this.requestWaiter) {
      const resolve = this.requestWaiter;
      this.requestWaiter = null;
      this.requestRejecter = null;
      resolve(msg);
    } else {
      this.requestQueue.push(msg);
    }
  }

  /** Block until Python sends a request. Called by narrative_listen tool.
   *  Binds the port lazily on first call (taking over a placeholder/idle bridge
   *  if needed) so only a terminal that actually listens owns the bridge. */
  async waitForRequest(): Promise<RequestMsg> {
    await this.ensureBound();
    if (!this.mcpEverConnected) {
      console.error('[narrative-mcp] MCP listener attached');
    }
    this.mcpEverConnected = true;
    this.lastListenAt = Date.now();

    const queued = this.requestQueue.shift();
    if (queued !== undefined) {
      this.inFlightSince = Date.now();
      return Promise.resolve(queued);
    }

    return new Promise((resolve, reject) => {
      this.requestWaiter = (msg: RequestMsg) => {
        this.lastListenAt = Date.now();
        this.inFlightSince = Date.now();
        resolve(msg);
      };
      this.requestRejecter = reject;
    });
  }

  /** Latido de progreso hacia ai_server: resetea su timeout de inactividad
   *  para la petición en curso. Silencioso sin cliente (no es un error: el
   *  progreso es best-effort). */
  sendProgress(requestId: string, message: string): void {
    const target = this.targetFor(requestId);
    if (!target) return;
    target.send(JSON.stringify({
      type: 'narrative_progress',
      request_id: requestId,
      message,
    }));
  }

  /** Envía la respuesta al socket que originó la petición (targetFor) y
   *  olvida el origen — la respuesta es terminal. */
  private sendToOrigin(requestId: string, payload: Record<string, unknown>, what: string): void {
    const target = this.targetFor(requestId);
    this.requestOrigins.delete(requestId);
    if (!target) {
      console.error(`[narrative-mcp] Cannot send ${what}: no client connected`);
      return;
    }
    this.markResponded();
    target.send(JSON.stringify(payload));
  }

  /** Send room data back to Python. Called by narrative_respond tool. */
  sendResponse(requestId: string, roomData: Record<string, unknown>): void {
    this.sendToOrigin(requestId, {
      type: 'room_response',
      request_id: requestId,
      room_data: roomData,
    }, 'response');
  }

  /** Send vision analysis result back to Python. Called by narrative_respond. */
  sendVisionResponse(requestId: string, result: Record<string, unknown>): void {
    this.sendToOrigin(requestId, {
      type: 'vision_response',
      request_id: requestId,
      result,
    }, 'vision response');
  }

  /** Send blueprint review result back to Python. Called by narrative_respond. */
  sendBlueprintReviewResponse(requestId: string, result: Record<string, unknown>): void {
    this.sendToOrigin(requestId, {
      type: 'blueprint_review_response',
      request_id: requestId,
      result,
    }, 'blueprint_review response');
  }

  /** Send narrative reaction result back to Python. Called by narrative_respond. */
  sendNarrativeEventResponse(requestId: string, result: Record<string, unknown>): void {
    this.sendToOrigin(requestId, {
      type: 'narrative_event_response',
      request_id: requestId,
      result,
    }, 'narrative_event response');
  }

  private shutdown(): void {
    // Wake a narrative_listen that was waiting so the displaced terminal sees a
    // clear error instead of hanging on a dead bridge.
    if (this.requestRejecter) {
      this.requestRejecter(new Error('bridge taken over by another Claude Code instance'));
    }
    this.requestWaiter = null;
    this.requestRejecter = null;
    this.inFlightSince = 0;
    this.client = null;
    this.requestOrigins.clear();
    this.clients.clear();
    if (this.wss) {
      for (const ws of this.wss.clients) ws.close();
      this.wss.close();
    }
    // Reset bind state so a later narrative_listen in THIS process can re-acquire
    // the port (take the bridge back) instead of returning a stale bound handle.
    this.wss = null;
    this.bindPromise = null;
  }
}
