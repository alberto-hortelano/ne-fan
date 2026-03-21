// WebSocket protocol between narrative-mcp and Python AI server

// ── Python → MCP server ──

export interface RoomRequestMsg {
  type: 'room_request';
  request_id: string;
  world_state: Record<string, unknown>;
}

export interface HelloMsg {
  type: 'hello';
}

export type ClientMsg = RoomRequestMsg | HelloMsg;

// ── MCP server → Python ──

export interface RoomResponseMsg {
  type: 'room_response';
  request_id: string;
  room_data: Record<string, unknown>;
}

export type ServerMsg = RoomResponseMsg;

// ── Peer-to-peer ──

export interface TakeoverMsg {
  type: 'takeover';
}

export type PeerMsg = TakeoverMsg;
