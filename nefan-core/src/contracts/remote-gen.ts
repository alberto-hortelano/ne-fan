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

/** Etiqueta de estilo del wire: id LIBRE de una ref del style pack (ver
 *  StyleManifestSchema en games/loader.ts). El server resuelve por id dentro
 *  de la vista del blueprint y degrada con aviso a la primera ref de la
 *  vista si no existe — el pre-flight fail-loud vive en el bridge. */
export type StyleTag = string;

/** Repintado de la escena completa (tile oblicuo o plató proscenio). */
export interface GenerateSceneImageRequest {
  /** PNG base64 del plano base: schematic Canvas (boxes/svg) o render
   *  greybox three.js (stage). */
  image_b64: string;
  prompt: string;
  /** Bordes cuya franja exterior es arte REAL ya pintado del tile vecino
   *  (continuidad de costuras). Valores: north|south|east|west. */
  context_sides?: string[];
  /** "boxes" (schematic legacy) | "tile" (clay greybox del tile oblicuo,
   *  pipeline tile_greybox1) | "stage" (plató greybox → gpt-image-2 vía fal
   *  directo, ~210 s). Default "boxes". El valor "svg" murió con los
   *  compositores SVG (agosto 2026) — el Pydantic (remote_generation.py) ya
   *  solo acepta estos tres. */
  blueprint_kind?: "boxes" | "tile" | "stage";
  /** false = el plano NO tiene agua (omite las cláusulas de agua: mencionarla
   *  en planos secos ceba ríos alucinados). Default true. */
  has_water?: boolean;
  /** Style pack congelado en la sesión; vacío = referencia global fija. */
  style_id?: string;
  /** Ref del pack elegida por el motor para esta escena (id del manifest);
   *  vacío/desconocido = primera ref de la vista del blueprint. */
  style_ref?: StyleTag | "";
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

/** Celda del atlas de superficies de la vista fps (espejo del Pydantic
 *  SurfaceCellSpec). `desc` + estilo son la IDENTIDAD del asset: misma
 *  descripción + mismo estilo ⇒ mismo hash ⇒ reuso entre escenas. */
export interface SurfaceCellSpec {
  key: string;
  mat: string;
  kind: "tile" | "unique";
  desc: string;
  /** Ref temática fps/ del pack (surface_ref del motor) — solo celdas
   *  unique; guía como imagen la página que pinta esta celda. */
  ref?: string;
  base_color: string;
  world_w: number;
  world_h: number;
  hints?: [number, number, number, number, string][];
}

export interface GenerateSurfaceAtlasRequest {
  cells: SurfaceCellSpec[];
  scene_description: string;
  style_id?: string;
  /** Hash del layout canónico del cliente — logging/debug (la caché es por
   *  celda, no por atlas). */
  layout_key?: string;
  /** true = solo resolver contra la librería ($0): devuelve las celdas ya
   *  pintadas + `missing`, sin pintar. Camino del resume. */
  resolve_only?: boolean;
}

export interface SurfaceCellResult {
  hash: string;
  /** Relativa al asset-store: /cache/surface/{hash}. */
  url: string;
  cached: boolean;
}

export interface GenerateSurfaceAtlasResponse {
  cells: Record<string, SurfaceCellResult>;
  pages_painted: number;
  cached: boolean;
  cost_usd: number;
  generation_time_ms: number;
  /** Celdas de la petición SIN pintar aún (con resolve_only no se pintan). */
  missing: number;
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
  /** Id de la ref de personaje del pack (characters/) elegida para este NPC.
   *  Vacío/desconocido ⇒ primera ref de characters/ del manifest. El nombre
   *  del campo es legacy (era el rol commoner/noble/warrior). */
  style_role?: string;
}

export interface SkinSpriteSheetResponse {
  ok: boolean;
  hash: string;
  /** meta.json del sheet SKINNEADO (dims, frames, anclas). */
  meta: Record<string, unknown>;
  /** URLs por dirección → frames, servidas por asset-store
   *  (/cache/sprite_sheet/{hash}/dir_D_frame_FFF.png). Índice = dirección:
   *  el wire manda un array de arrays, no un objeto (estaba mal tipado). */
  frame_urls: string[][];
  /** Clave del hero-shot de identidad de este personaje. */
  hero_key?: string;
  /** URL del hero-shot si está en disco (relativa al asset-store): el
   *  pipeline ya lo pagó y el cliente lo reusa como retrato del diálogo.
   *  `null` = no hay (sheet de un cache anterior al hero) ⇒ el cliente cae
   *  al busto del sprite. Consultarlo NUNCA dispara una generación. */
  hero_url?: string | null;
  generation_time_ms: number;
}

// ── Style packs de usuario ──

export interface StyleUploadImage {
  /** Vista de destino: la carpeta del pack donde vive la imagen. */
  view: "overworld" | "proscenium" | "fps" | "characters";
  /** Qué muestra la imagen (español, una frase) — lo que lee el motor
   *  narrativo para elegirla. Opcional solo para la lámina fps_surfaces. */
  description: string;
  image_b64: string;
  /** Id estable de la ref; derivado de la descripción si falta. */
  id?: string;
  /** "fps_surfaces" = lámina de materiales (máx 1, vista fps). */
  role?: "fps_surfaces";
}

export interface StyleUploadRequest {
  name: string;
  description?: string;
  style_token?: string;
  /** Etiquetas temáticas del estilo (min 1): casan con las de los juegos. */
  tags: string[];
  /** 1–12 imágenes. */
  images: StyleUploadImage[];
}

/** Ref declarada sin imagen aún (se generaría en /complete). */
export interface StyleMissingRef {
  id: string;
  view: string;
  description: string;
}

export interface StyleUploadResponse {
  style_id: string;
  uploaded: string[];
  missing: StyleMissingRef[];
  cost_per_image_usd: number;
  estimated_cost_usd: number;
}

/** GET /styles/{style_id}/missing — dry-run del completado de un pack (vale
 *  para cualquier pack, shipped incluidos): refs declaradas sin imagen +
 *  coste estimado. NO gasta. Es la mitad "estimación" del flujo
 *  upload→complete, usada por el diálogo de coste de "aplicar estilo". */
export interface StylesMissingResponse {
  style_id: string;
  missing: StyleMissingRef[];
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

// ── Estado agregado del panel de dev del cliente 2D ──

/** Una llamada REAL a una API de pago (nunca cache-hits). Coste ESTIMADO por
 *  tabla estática (meshy_client.py), no facturación real. */
export interface DevSpendCall {
  /** Epoch seconds. */
  t: number;
  usd: number;
  /** Qué se generó (prompt recortado, categoría de style pack…). */
  what: string;
  /** Proceso que lanzó la llamada ("remote-gen", "gpu-worker"…). */
  service: string;
}

export interface DevSpendStatus {
  total_usd: number;
  call_count: number;
  /** Últimas N llamadas (append-only en cache/spend/events.jsonl). */
  calls: DevSpendCall[];
}

/** GET /dev/status — un solo poll para el panel de dev: dev-cache + gasto +
 *  config de generación activa + presencia de claves (nunca sus valores). */
export interface DevStatus {
  api_cache: DevApiCacheStatus;
  spend: DevSpendStatus;
  config: {
    scene_model: string;
    stage_scene_model: string;
    sprite_skin_model: string;
    /** Tasa fija USD→EUR (config.ts → runtime_config.json). */
    usd_eur_rate: number;
  };
  keys: {
    meshy: boolean;
    fal: boolean;
  };
}

export const RemoteGenApi = {
  generateSceneImage: endpoint<GenerateSceneImageRequest, GenerateSceneImageResponse>(
    "POST",
    "/generate_scene_image",
  ),
  /** Atlas de superficies de la vista fps: pinta solo las celdas que faltan
   *  en la librería (kind "surface") y devuelve el mapping por celda. */
  generateSurfaceAtlas: endpoint<GenerateSurfaceAtlasRequest, GenerateSurfaceAtlasResponse>(
    "POST",
    "/generate_surface_atlas",
  ),
  skinSpriteSheet: endpoint<SkinSpriteSheetRequest, SkinSpriteSheetResponse>(
    "POST",
    "/skin_sprite_sheet",
  ),
  uploadStyle: endpoint<StyleUploadRequest, StyleUploadResponse>("POST", "/styles/upload"),
  stylesMissing: endpoint<void, StylesMissingResponse, "style_id">(
    "GET",
    "/styles/{style_id}/missing",
  ),
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
  /** Panel de dev del cliente 2D (routers/cache_assets.py). */
  devStatus: endpoint<void, DevStatus>("GET", "/dev/status"),
} as const;

export type RemoteGenApi = typeof RemoteGenApi;
