/** S4 · gpu-worker — HTTP :8766 (extraído en F3: ai_server/gpu_worker_main.py;
 * narrative-llm proxya los endpoints en :8765 para Godot).
 *
 * Generación LOCAL con GPU (RTX 3060): texturas PBR SD1.5+LCM, skins img2img,
 * sprites, modelos TripoSG (fallback sin MESHY_API_KEY) e inpainting LaMa.
 * Restricción dura: 1 proceso = 1 GPU — el asyncio.Lock (deps.gpu_lock) NO
 * desaparece con la extracción: además de CUDA protege la COHERENCIA del
 * pipe SD compartido (Skin/Sprite/ModelGenerator lo mutan y restauran).
 * Escalar = añadir procesos (uno por GPU) vía NEFAN_URL_GPU_WORKER.
 *
 * Todos los endpoints registran su resultado en asset-store (hash
 * content-addressed, `cached: true` en hit) y el blob se recupera por las
 * URLs devueltas (`/cache/...`). Wire snake_case (Pydantic). Errores:
 * `FastApiErrorResponse`.
 */
import { endpoint } from "./http.js";

export interface GenerateTextureRequest {
  prompt: string;
  seed?: number;
}

export interface GenerateTextureResponse {
  hash: string;
  cached: boolean;
  albedo_url: string;
  normal_url: string;
  generation_time_ms?: number;
}

export interface GenerateModelRequest {
  prompt: string;
  /** Default [0.5, 0.5, 0.5]. */
  scale?: [number, number, number];
  seed?: number;
  quality?: string;
}

export interface GenerateModelResponse {
  hash: string;
  cached: boolean;
  model_url: string;
  generation_time_ms?: number;
}

export interface GenerateSkinRequest {
  prompt: string;
  /** -1 = default del server. */
  strength?: number;
  gamma?: number;
  seed?: number;
}

export interface GenerateSkinResponse {
  hash: string;
  cached: boolean;
  skin_url: string;
  generation_time_ms?: number;
}

export interface GenerateSpriteRequest {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** "top_down" default. */
  angle?: string;
  style_token?: string;
}

export interface GenerateSpriteResponse {
  hash: string;
  cached: boolean;
  sprite_url: string;
  angle: string;
  generation_time_ms?: number;
}

/** Placa de fondo del tile: imagen + máscara unión de los segmentos `tall`
 *  (blanco = hueco); LaMa continúa solo el suelo, sin inventar. */
export interface InpaintScenePlateRequest {
  image_b64: string;
  mask_b64: string;
}

export interface InpaintScenePlateResponse {
  hash: string;
  cached: boolean;
  plate_url: string;
  generation_time_ms?: number;
}

/** Pelado de UNA capa del plató (proscenio). La máscara sale SIEMPRE de
 *  segmentar lo pintado (SAM2), jamás de una silueta declarada. */
export interface PeelSceneLayerRequest {
  image_b64: string;
  mask_b64: string;
  prompt: string;
  /** "lama" (default del plató, local y determinista) | "flux" (FLUX Fill
   *  vía fal DIRECTO — FAL_KEY opcional en gpu-worker) | "auto" (flux si hay
   *  FAL_KEY, si no lama). */
  backend?: "auto" | "lama" | "flux";
}

export interface PeelSceneLayerResponse {
  hash: string;
  cached: boolean;
  peeled_url: string;
  /** Algoritmo REAL usado ("lama_lama-v1" | "fluxfill1") — con backend
   *  "auto"/"flux" puede degradar a LaMa y la clave de caché lo refleja. */
  backend: string;
  generation_time_ms?: number;
}

/** `model_backend` alimenta el /backend_status de narrative-llm (agregación
 *  best-effort — el shape del panel de Godot no cambia con la extracción). */
export interface GpuWorkerHealthResponse {
  status: "ready" | "loading";
  texture_pipeline: "loaded" | "lazy";
  model_backend: "meshy" | "triposg" | "none";
}

export const GpuWorkerApi = {
  health: endpoint<void, GpuWorkerHealthResponse>("GET", "/health"),
  generateTexture: endpoint<GenerateTextureRequest, GenerateTextureResponse>(
    "POST",
    "/generate_texture",
  ),
  generateModel: endpoint<GenerateModelRequest, GenerateModelResponse>("POST", "/generate_model"),
  generateSkin: endpoint<GenerateSkinRequest, GenerateSkinResponse>("POST", "/generate_skin"),
  generateSprite: endpoint<GenerateSpriteRequest, GenerateSpriteResponse>(
    "POST",
    "/generate_sprite",
  ),
  inpaintScenePlate: endpoint<InpaintScenePlateRequest, InpaintScenePlateResponse>(
    "POST",
    "/inpaint_scene_plate",
  ),
} as const;

export type GpuWorkerApi = typeof GpuWorkerApi;
