/** Protocolo WS :3737 entre narrative-llm (ai_server Python) y su sidecar
 * narrative-mcp (que a su vez habla MCP stdio con Claude Code).
 *
 * Este módulo es LA FUENTE del protocolo (F0): `narrative-mcp/protocol.ts` es
 * un reexport de compatibilidad con los nombres históricos (ClientMsg,
 * RequestMsg, ServerMsg, PeerMsg) y `narrative-mcp/contract-check.ts`
 * verifica en compile-time que los unions siguen siendo idénticos.
 *
 * Nota histórica: `NarrativeProgressMsg` está en el union `McpToAiMsg` — el
 * wire real siempre lo emitió (ws-bridge.ts sendProgress) aunque el union
 * original de protocol.ts lo omitiera.
 */

// ── narrative-llm (Python) → narrative-mcp ──

export interface RoomRequestMsg {
  type: "room_request";
  request_id: string;
  world_state: Record<string, unknown>;
  /** Único formato soportado; el legacy "extended" (sala cerrada) se retiró
   *  y narrative-mcp rechaza cualquier otro valor con isError. */
  format?: "scene";
}

export interface VisionImage {
  /** 'front' | 'side' | 'top' | 'combat_pose' | 'blueprint' | ... */
  view: string;
  media_type: string;
  /** Base64 crudo, sin prefijo data:. */
  data_b64: string;
}

export interface VisionRequestMsg {
  type: "vision_request";
  request_id: string;
  kind: "weapon_orient" | "weapon_verify";
  /** Solo kinds weapon_*. */
  weapon_type?: string;
  images: VisionImage[];
  context?: Record<string, unknown>;
}

export interface NarrativeEventMsg {
  type: "narrative_event";
  request_id: string;
  kind: "dialogue_choice" | "develop_world";
  event_id: string;
  speaker: string;
  chosen_text: string;
  free_text: string;
  context: Record<string, unknown>;
}

export interface HelloMsg {
  type: "hello";
}

export type AiToMcpMsg =
  | RoomRequestMsg
  | VisionRequestMsg
  | NarrativeEventMsg
  | HelloMsg;

/** Peticiones que pasan por la cola del listener (excluye hello). */
export type McpRequestMsg = RoomRequestMsg | VisionRequestMsg | NarrativeEventMsg;

// ── narrative-mcp → narrative-llm (Python) ──

export interface RoomResponseMsg {
  type: "room_response";
  request_id: string;
  room_data: Record<string, unknown>;
}

export interface VisionResponseMsg {
  type: "vision_response";
  request_id: string;
  result: Record<string, unknown>;
}

export interface NarrativeEventResponseMsg {
  type: "narrative_event_response";
  request_id: string;
  result: Record<string, unknown>;
}

/** Latido de progreso mientras el motor genera: resetea el timeout de
 *  INACTIVIDAD de ai_server y alimenta el loader del cliente (vía
 *  POST /narrative_progress del world-state en paralelo). */
export interface NarrativeProgressMsg {
  type: "narrative_progress";
  request_id: string;
  message: string;
}

export type McpToAiMsg =
  | RoomResponseMsg
  | VisionResponseMsg
  | NarrativeEventResponseMsg
  | NarrativeProgressMsg;

// ── Peer-to-peer (instancias de narrative-mcp entre sí) ──

/** Toma de control del puerto :3737 entre terminales de Claude Code (bind
 *  perezoso en el primer narrative_listen). */
export interface TakeoverMsg {
  type: "takeover";
}

export type McpPeerMsg = TakeoverMsg;
