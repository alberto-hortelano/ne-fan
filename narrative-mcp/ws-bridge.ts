import { WebSocketServer, WebSocket as WsWebSocket, type WebSocket } from 'ws';
import type { ClientMsg, PeerMsg, RoomRequestMsg } from './protocol.js';

const PORT = Number(process.env.NARRATIVE_WS_PORT) || 3737;

interface PendingResponse {
  resolve: (data: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WsBridge {
  private wss: WebSocketServer;
  private client: WebSocket | null = null;

  // Request queue: Python pushes room requests, narrative_listen pops
  private requestQueue: RoomRequestMsg[] = [];
  private requestWaiter: ((msg: RoomRequestMsg) => void) | null = null;

  // Pending responses: Claude responds, Python receives
  private pendingResponses = new Map<string, PendingResponse>();

  private constructor(wss: WebSocketServer) {
    this.wss = wss;

    this.wss.on('connection', (ws) => {
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

  static async create(): Promise<WsBridge> {
    try {
      const wss = await WsBridge.tryBind();
      return new WsBridge(wss);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;

      console.error(`[narrative-mcp] port ${PORT} in use — requesting takeover`);
      await WsBridge.requestTakeover();

      const wss = await WsBridge.tryBind();
      return new WsBridge(wss);
    }
  }

  private static tryBind(): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port: PORT });
      wss.once('listening', () => resolve(wss));
      wss.once('error', (err) => reject(err));
    });
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

      if (msg.type === 'room_request') {
        this.enqueueRequest(msg);
      }
    } catch {
      // ignore malformed
    }
  }

  private enqueueRequest(msg: RoomRequestMsg): void {
    if (this.requestWaiter) {
      const resolve = this.requestWaiter;
      this.requestWaiter = null;
      resolve(msg);
    } else {
      this.requestQueue.push(msg);
    }
  }

  /** Block until Python sends a room request. Called by narrative_listen tool. */
  waitForRequest(): Promise<RoomRequestMsg> {
    const queued = this.requestQueue.shift();
    if (queued !== undefined) return Promise.resolve(queued);

    return new Promise((resolve) => {
      this.requestWaiter = resolve;
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

  private shutdown(): void {
    this.requestWaiter = null;
    for (const ws of this.wss.clients) ws.close();
    this.client = null;
    this.wss.close();
  }
}
