// WebSocket protocol between narrative-mcp and Python AI server

// ── Python → MCP server ──

export interface RoomRequestMsg {
  type: 'room_request';
  request_id: string;
  world_state: Record<string, unknown>;
}

export interface VisionImage {
  view: string;             // 'front' | 'side' | 'top' | 'combat_pose' | ...
  media_type: string;       // 'image/png' | 'image/jpeg'
  data_b64: string;         // raw base64, no data: prefix
}

export interface VisionRequestMsg {
  type: 'vision_request';
  request_id: string;
  kind: 'weapon_orient' | 'weapon_verify';
  weapon_type: string;
  images: VisionImage[];
  context?: Record<string, unknown>;
}

export interface NarrativeEventMsg {
  type: 'narrative_event';
  request_id: string;
  kind: 'dialogue_choice';
  event_id: string;
  speaker: string;
  chosen_text: string;
  free_text: string;
  context: Record<string, unknown>;
}

export interface HelloMsg {
  type: 'hello';
}

export interface BridgeStatusRequestMsg {
  type: 'bridge_status_request';
  request_id: string;
}

export type ClientMsg = RoomRequestMsg | VisionRequestMsg | NarrativeEventMsg | HelloMsg | BridgeStatusRequestMsg;

// Requests that flow through the bridge queue (excluding hello and status)
export type RequestMsg = RoomRequestMsg | VisionRequestMsg | NarrativeEventMsg;

// ── MCP server → Python ──

export interface RoomResponseMsg {
  type: 'room_response';
  request_id: string;
  room_data: Record<string, unknown>;
}

export interface VisionResponseMsg {
  type: 'vision_response';
  request_id: string;
  result: Record<string, unknown>;
}

export interface NarrativeEventResponseMsg {
  type: 'narrative_event_response';
  request_id: string;
  result: Record<string, unknown>;
}

export interface BridgeStatusResponseMsg {
  type: 'bridge_status_response';
  request_id: string;
  listener_active: boolean;
  listener_ever_connected: boolean;
  last_listen_seconds_ago: number;  // -1 if never
}

export type ServerMsg = RoomResponseMsg | VisionResponseMsg | NarrativeEventResponseMsg | BridgeStatusResponseMsg;

// ── Peer-to-peer ──

export interface TakeoverMsg {
  type: 'takeover';
}

export type PeerMsg = TakeoverMsg;
