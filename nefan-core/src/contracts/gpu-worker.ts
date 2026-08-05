/** S4 · gpu-worker — HTTP :8766 (hoy co-vive en ai_server :8765; se extrae
 * en F3).
 *
 * Generación LOCAL con GPU (RTX 3060): texturas PBR SD1.5+LCM, skins img2img,
 * sprites, modelos TripoSG (fallback sin MESHY_API_KEY) e inpainting LaMa.
 * Restricción dura: 1 proceso = 1 GPU — hoy un asyncio.Lock (deps.gpu_lock)
 * serializa; tras F3 la serialización es la cola natural del proceso
 * mono-GPU y escalar = añadir procesos (uno por GPU).
 *
 * Todos los endpoints registran su resultado en asset-store (hash
 * content-addressed, `cached: true` en hit) y el blob se recupera por las
 * URLs devueltas (`/cache/...`). Wire snake_case (Pydantic). Errores:
 * `FastApiErrorResponse`.
 */
import { endpoint, type BinaryResponse } from "./http.js";

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
   *  vía remote-gen) | "auto" (flux si hay FAL_KEY, si no lama). */
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

export const GpuWorkerApi = {
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
  /** El camino LaMa es local (GPU); el camino flux delega en remote-gen. El
   *  contrato externo no cambia según el backend. */
  peelSceneLayer: endpoint<PeelSceneLayerRequest, PeelSceneLayerResponse>(
    "POST",
    "/peel_scene_layer",
  ),

  /** @internal Solo con expose_diagnostic=true; devuelven PNG crudo. */
  diagnosticSkinTestControlnet: endpoint<Record<string, unknown>, BinaryResponse>(
    "POST",
    "/diagnostic/skin_test_controlnet",
  ),
  /** @internal */
  diagnosticSkinTestFrame: endpoint<Record<string, unknown>, BinaryResponse>(
    "POST",
    "/diagnostic/skin_test_frame",
  ),
} as const;

export type GpuWorkerApi = typeof GpuWorkerApi;
