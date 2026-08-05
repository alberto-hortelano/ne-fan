/** S5 · remote-gen — HTTP :8768 (extraído en F4: ai_server/remote_gen_main.py;
 * sin proxy en :8765 — sus únicos clientes, el HTML, resuelven por
 * serviceUrl).
 *
 * Adaptador de APIs de pago (Meshy i2i, fal.ai gpt-image-2/nano-banana-pro,
 * fal SAM2, FLUX Fill): repintado de tiles/platós, sprite sheets skinneados,
 * style packs y segmentación. Sin GPU local, sin estado — escala por
 * concurrencia HTTP (latencias de 30–300 s por llamada remota). Registra sus
 * resultados en asset-store. Wire snake_case (Pydantic). Errores:
 * `FastApiErrorResponse`; sin FAL_KEY los endpoints que la requieren dan 503.
 */
import { endpoint } from "./http.js";

/** Zonas de estilo (espejo de games/style-categories; "nature" = legacy). */
export type StyleTag =
  | "settlement"
  | "farmland"
  | "forest"
  | "wetland"
  | "desert"
  | "snow"
  | "fortress"
  | "interior"
  | "underground"
  | "nature";

/** Repintado de la escena completa (tile oblicuo o plató proscenio). */
export interface GenerateSceneImageRequest {
  /** PNG base64 del plano base: schematic Canvas (boxes/svg) o render
   *  greybox three.js (stage). */
  image_b64: string;
  prompt: string;
  /** Bordes cuya franja exterior es arte REAL ya pintado del tile vecino
   *  (continuidad de costuras). Valores: north|south|east|west. */
  context_sides?: string[];
  /** "boxes" (schematic legacy) | "svg" (blueprint oblicuo) | "stage"
   *  (plató greybox → gpt-image-2 vía fal directo, ~210 s). Default "boxes". */
  blueprint_kind?: "boxes" | "svg" | "stage";
  /** false = el plano NO tiene agua (omite las cláusulas de agua: mencionarla
   *  en planos secos ceba ríos alucinados). Default true. */
  has_water?: boolean;
  /** Style pack congelado en la sesión; vacío = referencia global fija. */
  style_id?: string;
  style_tag?: StyleTag | "";
  /** Clave de layout ESTABLE del cliente (hash hex ≤64 del GreyboxSpec
   *  canónico). El render WebGL no es byte-determinista: sin ella cada
   *  arranque haría cache-miss (~$0.2/plató). Vacía = se hashea el PNG. */
  layout_key?: string;
}

export interface GenerateSceneImageResponse {
  hash: string;
  cached: boolean;
  scene_url: string;
  width?: number;
  height?: number;
  generation_time_ms?: number;
}

/** Sprite sheet de personaje skinneado por IA (Meshy i2i hero-shot + atlas
 *  por dirección + rembg). OJO: el endpoint actual lee JSON crudo, sin
 *  modelo Pydantic — este shape es el contrato observado del wire. */
export interface SkinSpriteSheetRequest {
  /** Modelo base del sheet (p. ej. "y_bot"). */
  model: string;
  anim?: string;
  angle?: string;
  /** Descripción del personaje a skinnear. */
  prompt: string;
  style_id?: string;
  style_role?: "commoner" | "noble" | "warrior";
}

export interface SkinSpriteSheetResponse {
  ok: boolean;
  hash: string;
  /** meta.json del sheet SKINNEADO (dims, frames, anclas). */
  meta: Record<string, unknown>;
  /** URLs por dirección → frames, servidas por asset-store
   *  (/cache/sprite_sheet/{hash}/dir_D_frame_FFF.png). */
  frame_urls: Record<string, string[]>;
  generation_time_ms: number;
}

// ── Style packs de usuario ──

export interface StyleUploadImage {
  /** Una de las 9 categorías de entorno o 3 de personaje. */
  category: string;
  image_b64: string;
}

export interface StyleUploadRequest {
  name: string;
  description?: string;
  style_token?: string;
  /** 1–12 imágenes. */
  images: StyleUploadImage[];
}

export interface StyleUploadResponse {
  style_id: string;
  uploaded: string[];
  /** Categorías que faltan (se generarían en /complete). */
  missing: string[];
  cost_per_image_usd: number;
  estimated_cost_usd: number;
}

export interface StyleCompleteRequest {
  /** Confirmación explícita: gasta créditos Meshy. 422 si no es true. */
  confirm: boolean;
}

export interface StyleCompleteResponse {
  generated: string[];
  cost_usd: number;
  skipped?: string[];
  /** Presente cuando no había nada que generar. */
  message?: string;
}

// ── Segmentación (F4 — extrae la ÚNICA llamada fal SAM2 del stack para que
//    narrative-llm no dependa de FAL_KEY) ──

export interface SegmentBox {
  id: string;
  /** [x0, y0, x1, y1] px — el box prompt de SAM2 tal cual. */
  box_xyxy: [number, number, number, number];
}

export interface SegmentRequest {
  image_b64: string;
  /** "auto" = SAM2 auto-segment; "boxes" = un prompt de caja por elemento. */
  mode: "auto" | "boxes";
  /** Obligatorio (no vacío, ids únicos) con mode "boxes"; 422 si falta. */
  boxes?: SegmentBox[];
}

export interface SegmentMask {
  /** id de la caja de entrada (mode "boxes") o sintético `auto_i` en orden
   *  de detección (mode "auto"). */
  id: string;
  /** PNG CRUDO de fal en base64 (cutout RGBA o máscara según el modelo) —
   *  la conversión a máscara booleana es del consumidor (mask_from_png /
   *  _mask_from_fal), igual que cuando la llamada era in-process: los blobs
   *  de los canales dev del consumidor siguen valiendo byte a byte. */
  mask_b64: string;
}

export interface SegmentResponse {
  masks: SegmentMask[];
}

export interface RemoteGenHealthResponse {
  status: "ready" | "loading";
  /** false = sin FAL_KEY en el proceso remote-gen (/segment dará 503). */
  segment_available: boolean;
}

// ── Cache de modo dev (respuestas de APIs de pago congeladas) ──

export interface DevApiCacheChannel {
  saved_at: string;
  note?: string;
  bytes: number;
  blobs: number;
}

export interface DevApiCacheStatus {
  enabled: boolean;
  channels: Record<string, DevApiCacheChannel>;
}

export interface DevApiCacheToggleRequest {
  enabled: boolean;
}

export const RemoteGenApi = {
  generateSceneImage: endpoint<GenerateSceneImageRequest, GenerateSceneImageResponse>(
    "POST",
    "/generate_scene_image",
  ),
  skinSpriteSheet: endpoint<SkinSpriteSheetRequest, SkinSpriteSheetResponse>(
    "POST",
    "/skin_sprite_sheet",
  ),
  uploadStyle: endpoint<StyleUploadRequest, StyleUploadResponse>("POST", "/styles/upload"),
  completeStyle: endpoint<StyleCompleteRequest, StyleCompleteResponse, "style_id">(
    "POST",
    "/styles/{style_id}/complete",
  ),
  health: endpoint<void, RemoteGenHealthResponse>("GET", "/health"),
  /** Interno — consumido por narrative-llm (remote_gen_client.py). */
  segment: endpoint<SegmentRequest, SegmentResponse>("POST", "/segment"),
  /** El toggle vive aquí: los canales cacheados son las respuestas de las
   *  APIs de pago, sus únicos consumidores. Cada canal es global — compartir
   *  canal entre pipelines distintos empareja blobs con el item equivocado
   *  EN SILENCIO (gotcha documentado en routers/generation.py). */
  devApiCacheStatus: endpoint<void, DevApiCacheStatus>("GET", "/dev/api_cache"),
  devApiCacheToggle: endpoint<DevApiCacheToggleRequest, DevApiCacheStatus>(
    "POST",
    "/dev/api_cache",
  ),
} as const;

export type RemoteGenApi = typeof RemoteGenApi;
