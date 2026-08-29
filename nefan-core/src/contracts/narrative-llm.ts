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
 * generation}.py y la spec ejecutable labs/narrative/fake-ai-server.ts).
 * Errores: `FastApiErrorResponse` (422 validación, 503 sin backend/listener,
 * 504 timeout del LLM — el reintento del mismo tile recupera la respuesta
 * tardía).
 */
import type {
  LlmContext,
  Consequence,
  FormatDScene,
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
  context?: LlmContext;
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
    /** Etiquetas temáticas del mundo (3-5): filtran los estilos ofrecidos. */
    tags: string[];
  };
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

// ── Estado de backends ──

export interface BackendState {
  state: string;
  message: string;
}

export interface BackendStatusResponse {
  ai_vision: BackendState;
}

/** Lo que declara de sí mismo CUALQUIER motor narrativo en `GET /health` —
 *  el real (`ai_server/main.py`) y el falso (`labs/narrative/fake-ai-server.ts`).
 *
 *  `fake` es el campo del que cuelga el guardarraíl de cero créditos del banco
 *  de pruebas, y por eso es OBLIGATORIO y AFIRMATIVO. La versión anterior no
 *  existía: el guion miraba si la URL del `?ai=` contenía el puerto 18765, o
 *  sea leía de vuelta la constante que el propio runner acababa de escribir en
 *  esa URL — una tautología que siempre decía «sí, es falso» y que nunca llegó
 *  a mirar el backend. Aquí la regla es la contraria y no admite término medio:
 *
 *   - `fake: true`  → lo dice el backend, y solo lo dice quien no puede gastar.
 *   - `fake: false` → un backend real, que sí cobra.
 *   - campo ausente, respuesta ilegible, timeout, puerto muerto → **no es
 *     falso**. Nunca «no lo sé, sigo»: el desenlace caro es bendecir como
 *     gratis algo que cobra.
 *
 *  Queda descartado a propósito discriminar por AUSENCIA de los campos del
 *  real (`mode`, `cache_*`): eso bendeciría como falso a cualquier cosa que
 *  conteste poco — un proxy, un 404 con JSON, un servicio a medio arrancar. */
export interface NarrativeHealthResponse {
  status: "ready" | "loading";
  fake: boolean;
}

export interface AiServerHealthResponse extends NarrativeHealthResponse {
  mode: "narrative";
  cache_total_bytes: number;
  cache_max_bytes: number;
  cache_over_limit: boolean;
}

// ── Tabla de endpoints ──

export const NarrativeLlmApi = {
  /** Shape actual del monolito; tras F2–F4 los campos de cache migran al
   *  health de asset-store. */
  health: endpoint<void, AiServerHealthResponse>("GET", "/health"),
  notifySession: endpoint<NotifySessionRequest, NotifySessionResponse>("POST", "/notify_session"),
  generateScene: endpoint<GenerateSceneRequest, GenerateSceneResponse>("POST", "/generate_scene"),
  reportPlayerChoice: endpoint<ReportPlayerChoiceRequest, ReportPlayerChoiceResponse>(
    "POST",
    "/report_player_choice",
  ),
  developWorld: endpoint<DevelopWorldRequest, DevelopWorldResponse>("POST", "/develop_world"),
  analyzeWeapon: endpoint<AnalyzeWeaponRequest, AnalyzeWeaponResponse>("POST", "/analyze_weapon"),
  backendStatus: endpoint<void, BackendStatusResponse>("GET", "/backend_status"),
  // /review_scene_image (muerto, sin clientes) ELIMINADO en F4 junto con
  // LLMClient.review_scene_image y pipe_server.py.
} as const;

export type NarrativeLlmApi = typeof NarrativeLlmApi;
