/** S3 · narrative-llm — HTTP :8765 (subconjunto narrativo del ai_server
 * Python) + sidecar narrative-mcp (WS :3737, ver narrative-mcp-ws.ts).
 *
 * Todo lo que necesita el motor narrativo (Claude vía MCP) o visión LLM:
 * generación de escenas, consecuencias de elecciones, desarrollo de mundos,
 * reviews de blueprint/plató, orientación de armas. Cero GPU. Depende de:
 * canal WS con narrative-mcp (o fallback API Anthropic) y, para la
 * segmentación SAM2 de analyze/review, de remote-gen (`/segment`, F4 — hoy
 * la llamada fal vive en el mismo proceso).
 *
 * Convención: el wire es snake_case (implementación Python/Pydantic; los
 * shapes de referencia son los modelos de ai_server/routers/{narrative,
 * generation}.py y la spec ejecutable labs/narrative/fake-ai-server.mjs).
 * Errores: `FastApiErrorResponse` (422 validación, 503 sin backend/listener,
 * 504 timeout del LLM — el reintento del mismo tile recupera la respuesta
 * tardía).
 */
import type {
  LlmContext,
  Consequence,
  FormatDScene,
  StageReviewItem,
  PaintedFloor,
} from "./common.js";
import { endpoint } from "./http.js";

// ── Sesión ──

export interface NotifySessionRequest {
  session_id: string;
  game_id: string;
  is_resume?: boolean;
}

export interface NotifySessionResponse {
  ok: true;
  session_id: string;
  game_id: string;
  is_resume: boolean;
}

// ── Generación narrativa ──

/** El request de /generate_scene ES el LlmContext del bridge
 *  (src/narrative/types.ts). Pydantic valida que session_id/game_id/world/
 *  player estén presentes y deja pasar el resto de campos tal cual
 *  (extra="allow"): el lado TS puede añadir contexto sin deploy lockstep. */
export type GenerateSceneRequest = LlmContext;

/** Escena Format D cruda del motor narrativo. El gateway la persiste tal
 *  cual y la normaliza con formatDToWorld antes de emitirla a los clientes. */
export type GenerateSceneResponse = FormatDScene;

export interface ReportPlayerChoiceRequest {
  event_id: string;
  speaker?: string;
  chosen_text?: string;
  free_text?: string;
  context?: Record<string, unknown>;
}

export interface ReportPlayerChoiceResponse {
  consequences: Consequence[];
}

export interface DevelopWorldRequest {
  /** Borrador del jugador, 20–64 000 chars. */
  draft_text: string;
}

export interface DevelopWorldResponse {
  game: {
    game_id: string;
    title: string;
    description: string;
    style_id: string;
    world_brief: string;
    world_md: string;
  };
}

// ── Reviews con visión ──

export interface ReviewSceneBlueprintRequest {
  scene_id: string;
  /** PNG base64 del schematic — el mismo que iría al modelo de imagen. */
  image_b64: string;
  scene: FormatDScene;
}

export interface ReviewSceneBlueprintResponse {
  approved: boolean;
  issues: string[];
  /** Overrides parciales { terrain?, terrain_features?, entity_moves? }. */
  fixes?: Record<string, unknown>;
}

export interface AnalyzeWeaponRequest {
  /** Base64 crudos (sin prefijo data:). */
  images: string[];
  weapon_type?: string;
  kind?: "weapon_orient" | "weapon_verify";
  context?: Record<string, unknown>;
}

/** Orientación del arma (grip + vectores), validada por
 *  validate_weapon_orient_response en el server; el shape fino vive en el
 *  contrato del prompt (data/contract/prompts/weapon_orient.md). */
export type AnalyzeWeaponResponse = Record<string, unknown>;

// ── Análisis/review de imagen pintada (segmentar SIEMPRE lo pintado) ──

export interface AnalyzeSceneImageRequest {
  image_b64: string;
  /** Viaja al modelo de visión; admite context.expected_elements
   *  [{id, bbox_px}] como PISTA del compositor (nunca como máscara). */
  context?: Record<string, unknown>;
}

export interface SceneSegment {
  id: string;
  /** id del expected_element casado, si la visión lo emparejó. */
  element_id?: string;
  label: string;
  solid: boolean;
  tall: boolean;
  sprite_url: string;
  /** [x, y, w, h] px de la imagen analizada. */
  image_bbox: [number, number, number, number];
  img_w: number;
  img_h: number;
}

export interface AnalyzeSceneImageResponse {
  segments: SceneSegment[];
  /** Nº de segmentos descartados por la visión. */
  discarded: number;
}

export interface ReviewStageImageRequest {
  image_b64: string;
  /** context.expected_elements: StageExpectedElement[] del MANIFEST del
   *  greybox (cajas proyectadas exactas). Obligatorio: cada elemento con id y
   *  label no vacíos, sin duplicados (422 si no). */
  context: {
    expected_elements: Array<{
      id: string;
      label: string;
      box_px?: [number, number, number, number];
      tall?: boolean;
      solid?: boolean;
    }>;
    [key: string]: unknown;
  };
}

export interface ReviewStageImageResponse {
  items: StageReviewItem[];
  /** ids de expected_elements que la visión NO encontró pintados. */
  missing: string[];
  /** Línea/trapecio de suelo pintado — telemetría de calibración. */
  floor?: PaintedFloor;
}

// ── Estado de backends ──

export interface BackendState {
  state: string;
  message: string;
}

export interface BackendStatusResponse {
  meshy_3d: BackendState;
  ai_vision: BackendState;
}

export interface AiServerHealthResponse {
  status: "ready" | "loading";
  mode: "narrative";
  texture_pipeline: "loaded" | "lazy";
  cache_total_bytes: number;
  cache_max_bytes: number;
  cache_over_limit: boolean;
}

// ── Tabla de endpoints ──

export const NarrativeLlmApi = {
  /** Shape actual del monolito; tras F2–F4 los campos de cache/texturas
   *  migran al health de asset-store/gpu-worker. */
  health: endpoint<void, AiServerHealthResponse>("GET", "/health"),
  notifySession: endpoint<NotifySessionRequest, NotifySessionResponse>("POST", "/notify_session"),
  generateScene: endpoint<GenerateSceneRequest, GenerateSceneResponse>("POST", "/generate_scene"),
  reportPlayerChoice: endpoint<ReportPlayerChoiceRequest, ReportPlayerChoiceResponse>(
    "POST",
    "/report_player_choice",
  ),
  developWorld: endpoint<DevelopWorldRequest, DevelopWorldResponse>("POST", "/develop_world"),
  reviewSceneBlueprint: endpoint<ReviewSceneBlueprintRequest, ReviewSceneBlueprintResponse>(
    "POST",
    "/review_scene_blueprint",
  ),
  analyzeWeapon: endpoint<AnalyzeWeaponRequest, AnalyzeWeaponResponse>("POST", "/analyze_weapon"),
  analyzeSceneImage: endpoint<AnalyzeSceneImageRequest, AnalyzeSceneImageResponse>(
    "POST",
    "/analyze_scene_image",
  ),
  reviewStageImage: endpoint<ReviewStageImageRequest, ReviewStageImageResponse>(
    "POST",
    "/review_stage_image",
  ),
  backendStatus: endpoint<void, BackendStatusResponse>("GET", "/backend_status"),
  // /review_scene_image (muerto, sin clientes) ELIMINADO en F4 junto con
  // LLMClient.review_scene_image y pipe_server.py.
} as const;

export type NarrativeLlmApi = typeof NarrativeLlmApi;
