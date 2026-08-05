/** Protocolo WS :3737 entre narrative-llm (ai_server Python) y su sidecar
 * narrative-mcp (que a su vez habla MCP stdio con Claude Code).
 *
 * HOY la fuente es `narrative-mcp/protocol.ts` (paquete aparte, fuera del
 * rootDir de nefan-core). Este módulo es su espejo tipado dentro de los
 * contratos; en F0 la fuente se muda aquí y narrative-mcp/protocol.ts pasa a
 * reexportar de `nefan-core/dist/contracts/` (reexport de compatibilidad).
 * Hasta entonces: cualquier cambio se hace en LOS DOS o el test de contrato
 * de F0 lo detecta.
 *
 * Diferencia deliberada con protocol.ts: aquí `NarrativeProgressMsg` SÍ está
 * en el union `McpToAiMsg` — el wire real lo emite (ws-bridge.ts
 * sendProgress) aunque el union original lo omita.
 */

// ── narrative-llm (Python) → narrative-mcp ──

export interface RoomRequestMsg {
  type: "room_request";
  request_id: string;
  world_state: Record<string, unknown>;
  /** "extended" = schema legacy de sala cerrada (Godot); "scene" = schema
   *  open-world del cliente HTML. */
  format?: "extended" | "scene";
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
  kind: "weapon_orient" | "weapon_verify" | "scene_classify" | "image_review" | "stage_review";
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

export interface BlueprintReviewMsg {
  type: "blueprint_review";
  request_id: string;
  /** view: 'blueprint', PNG del schematic. */
  image: VisionImage;
  /** Escena Format D actual. */
  scene: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface HelloMsg {
  type: "hello";
}

export interface BridgeStatusRequestMsg {
  type: "bridge_status_request";
  request_id: string;
}

export type AiToMcpMsg =
  | RoomRequestMsg
  | VisionRequestMsg
  | NarrativeEventMsg
  | BlueprintReviewMsg
  | HelloMsg
  | BridgeStatusRequestMsg;

/** Peticiones que pasan por la cola del listener (excluye hello y status). */
export type McpRequestMsg = RoomRequestMsg | VisionRequestMsg | NarrativeEventMsg | BlueprintReviewMsg;

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

export interface BlueprintReviewResponseMsg {
  type: "blueprint_review_response";
  request_id: string;
  /** { approved, issues, fixes? } — ver ReviewSceneBlueprintResponse. */
  result: Record<string, unknown>;
}

export interface BridgeStatusResponseMsg {
  type: "bridge_status_response";
  request_id: string;
  listener_active: boolean;
  listener_ever_connected: boolean;
  /** -1 = nunca. */
  last_listen_seconds_ago: number;
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
  | BlueprintReviewResponseMsg
  | BridgeStatusResponseMsg
  | NarrativeProgressMsg;

// ── Peer-to-peer (instancias de narrative-mcp entre sí) ──

/** Toma de control del puerto :3737 entre terminales de Claude Code (bind
 *  perezoso en el primer narrative_listen). */
export interface TakeoverMsg {
  type: "takeover";
}

export type McpPeerMsg = TakeoverMsg;
