import { WebSocketServer, WebSocket as WsWebSocket, type WebSocket } from 'ws';
import type { ClientMsg, PeerMsg, RequestMsg } from './protocol.js';

const PORT = Number(process.env.NARRATIVE_WS_PORT) || 3737;

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

  // Pending responses: Claude responds, Python receives
  private pendingResponses = new Map<string, PendingResponse>();

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
    this.client = ws;
    console.error('[narrative-mcp] Python AI server connected');

    ws.on('message', (raw) => this.handleClientMessage(ws, raw));
    ws.on('close', () => {
      if (this.client === ws) {
        this.client = null;
        console.error('[narrative-mcp] Python AI server disconnected');
      }
    });
  }

  private handleClientMessage(_ws: WebSocket, raw: unknown): void {
    try {
      const msg: ClientMsg = JSON.parse(String(raw));

      if (msg.type === 'hello') return;

      if (msg.type === 'bridge_status_request') {
        this.sendBridgeStatus(msg.request_id);
        return;
      }

      if (msg.type === 'room_request' || msg.type === 'vision_request' || msg.type === 'narrative_event') {
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

  private sendBridgeStatus(requestId: string): void {
    if (!this.client || this.client.readyState !== this.client.OPEN) return;
    const sinceLast = this.lastListenAt > 0 ? (Date.now() - this.lastListenAt) / 1000 : -1;
    this.client.send(JSON.stringify({
      type: 'bridge_status_response',
      request_id: requestId,
      listener_active: this.isListenerActive(),
      listener_ever_connected: this.mcpEverConnected,
      last_listen_seconds_ago: sinceLast,
    }));
  }

  /** True if a Claude Code MCP client is currently waiting on narrative_listen
   * (waiter set) OR has called it within the last 60 seconds. */
  private isListenerActive(): boolean {
    if (this.requestWaiter !== null) return true;
    if (!this.mcpEverConnected) return false;
    const sinceLast = Date.now() - this.lastListenAt;
    return sinceLast < 60_000;
  }

  private sendNoListenerError(msg: RequestMsg): void {
    if (!this.client || this.client.readyState !== this.client.OPEN) return;
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
      this.client.send(JSON.stringify({
        type: 'vision_response',
        request_id: msg.request_id,
        result: errorPayload,
      }));
    } else if (msg.type === 'narrative_event') {
      this.client.send(JSON.stringify({
        type: 'narrative_event_response',
        request_id: msg.request_id,
        result: errorPayload,
      }));
    } else if (msg.type === 'room_request') {
      this.client.send(JSON.stringify({
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
    if (queued !== undefined) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      this.requestWaiter = (msg: RequestMsg) => {
        this.lastListenAt = Date.now();
        resolve(msg);
      };
      this.requestRejecter = reject;
    });
  }

  /** Send room data back to Python. Called by narrative_respond tool. */
  sendResponse(requestId: string, roomData: Record<string, unknown>): void {
    if (!this.client || this.client.readyState !== this.client.OPEN) {
      console.error('[narrative-mcp] Cannot send response: no client connected');
      return;
    }

    this.client.send(JSON.stringify({
      type: 'room_response',
      request_id: requestId,
      room_data: roomData,
    }));
  }

  /** Send vision analysis result back to Python. Called by narrative_respond. */
  sendVisionResponse(requestId: string, result: Record<string, unknown>): void {
    if (!this.client || this.client.readyState !== this.client.OPEN) {
      console.error('[narrative-mcp] Cannot send vision response: no client connected');
      return;
    }

    this.client.send(JSON.stringify({
      type: 'vision_response',
      request_id: requestId,
      result,
    }));
  }

  /** Send narrative reaction result back to Python. Called by narrative_respond. */
  sendNarrativeEventResponse(requestId: string, result: Record<string, unknown>): void {
    if (!this.client || this.client.readyState !== this.client.OPEN) {
      console.error('[narrative-mcp] Cannot send narrative_event response: no client connected');
      return;
    }

    this.client.send(JSON.stringify({
      type: 'narrative_event_response',
      request_id: requestId,
      result,
    }));
  }

  private shutdown(): void {
    // Wake a narrative_listen that was waiting so the displaced terminal sees a
    // clear error instead of hanging on a dead bridge.
    if (this.requestRejecter) {
      this.requestRejecter(new Error('bridge taken over by another Claude Code instance'));
    }
    this.requestWaiter = null;
    this.requestRejecter = null;
    this.client = null;
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
