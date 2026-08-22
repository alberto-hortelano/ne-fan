/** S4 · gpu-worker — HTTP :8766 (extraído en F3: ai_server/gpu_worker_main.py;
 * narrative-llm proxya los endpoints en :8765 para clientes no migrados).
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

/** `model_backend` alimenta el /backend_status de narrative-llm (agregación
 *  best-effort — el shape de la respuesta no cambia con la extracción). */
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
} as const;

export type GpuWorkerApi = typeof GpuWorkerApi;
