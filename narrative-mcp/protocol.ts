// WebSocket protocol between narrative-mcp and Python AI server

// ── Python → MCP server ──

export interface RoomRequestMsg {
  type: 'room_request';
  request_id: string;
  world_state: Record<string, unknown>;
  /** "extended" = legacy enclosed-room schema (Godot still uses it).
   *  "scene"    = open-world schema for the HTML client. */
  format?: 'extended' | 'scene';
}

export interface VisionImage {
  view: string;             // 'front' | 'side' | 'top' | 'combat_pose' | ...
  media_type: string;       // 'image/png' | 'image/jpeg'
  data_b64: string;         // raw base64, no data: prefix
}

export interface VisionRequestMsg {
  type: 'vision_request';
  request_id: string;
  kind: 'weapon_orient' | 'weapon_verify' | 'scene_classify' | 'image_review';
  /** Solo kinds weapon_*; scene_classify no lo envía. */
  weapon_type?: string;
  images: VisionImage[];
  context?: Record<string, unknown>;
}

export interface NarrativeEventMsg {
  type: 'narrative_event';
  request_id: string;
  kind: 'dialogue_choice' | 'develop_world';
  event_id: string;
  speaker: string;
  chosen_text: string;
  free_text: string;
  context: Record<string, unknown>;
}

/** El cliente 2D pide a Claude que REVISE el blueprint pintado (la imagen que
 *  verá Meshy) contra la escena Format D antes de gastar créditos: incoherencias
 *  tipo río cortado, puente que no toca las orillas, edificio flotando. */
export interface BlueprintReviewMsg {
  type: 'blueprint_review';
  request_id: string;
  image: VisionImage;                 // view: 'blueprint', PNG del schematic
  scene: Record<string, unknown>;     // la escena Format D actual
  context?: Record<string, unknown>;
}

export interface HelloMsg {
  type: 'hello';
}

export interface BridgeStatusRequestMsg {
  type: 'bridge_status_request';
  request_id: string;
}

export type ClientMsg = RoomRequestMsg | VisionRequestMsg | NarrativeEventMsg | BlueprintReviewMsg | HelloMsg | BridgeStatusRequestMsg;

// Requests that flow through the bridge queue (excluding hello and status)
export type RequestMsg = RoomRequestMsg | VisionRequestMsg | NarrativeEventMsg | BlueprintReviewMsg;

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

export interface BlueprintReviewResponseMsg {
  type: 'blueprint_review_response';
  request_id: string;
  /** { approved: bool, issues: string[], fixes?: { terrain?, terrain_features?, entity_moves? } } */
  result: Record<string, unknown>;
}

export interface BridgeStatusResponseMsg {
  type: 'bridge_status_response';
  request_id: string;
  listener_active: boolean;
  listener_ever_connected: boolean;
  last_listen_seconds_ago: number;  // -1 if never
}

export type ServerMsg = RoomResponseMsg | VisionResponseMsg | NarrativeEventResponseMsg | BlueprintReviewResponseMsg | BridgeStatusResponseMsg;

// ── Peer-to-peer ──

export interface TakeoverMsg {
  type: 'takeover';
}

export type PeerMsg = TakeoverMsg;
