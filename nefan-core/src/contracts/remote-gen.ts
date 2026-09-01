/** S5 · remote-gen — HTTP :8768 (extraído en F4: ai_server/remote_gen_main.py;
 * sin proxy en :8765 — sus únicos clientes, el HTML, resuelven por
 * serviceUrl).
 *
 * Adaptador de APIs de pago (Meshy i2i, fal.ai gpt-image-2/nano-banana-pro):
 * atlas de superficies de la vista fps, sprite sheets skinneados y style
 * packs. Sin GPU local, sin estado — escala por
 * concurrencia HTTP (latencias de 30–300 s por llamada remota). Registra sus
 * resultados en asset-store. Wire snake_case (Pydantic). Errores:
 * `FastApiErrorResponse`; sin FAL_KEY los endpoints que la requieren dan 503.
 */
import { endpoint } from "./http.js";
import type { SpriteSheetMeta } from "./sprite-forge.js";

/** Etiqueta de estilo del wire: id LIBRE de una ref del style pack (ver
 *  StyleManifestSchema en games/loader.ts). El server resuelve por id dentro
 *  de la CARPETA que pide cada petición y, donde hay fallback (personajes),
 *  degrada con aviso a la primera de esa carpeta — el pre-flight fail-loud
 *  vive en el bridge. */
export type StyleTag = string;

/** Celda del atlas de superficies de la vista fps (espejo del Pydantic
 *  SurfaceCellSpec). `desc` + estilo son la IDENTIDAD del asset: misma
 *  descripción + mismo estilo ⇒ mismo hash ⇒ reuso entre escenas. */
export interface SurfaceCellSpec {
  key: string;
  mat: string;
  kind: "tile" | "unique";
  desc: string;
  /** Ref de cara del pack (`faces/`, surface_ref del motor) — solo celdas
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

/** Sprite sheet de personaje vestido por IA. Lo produce **sprite-forge** (repo
 *  aparte, `sprite_forge_url`): hero-shot de identidad + atlas de keyframes por
 *  dirección. remote-gen es solo el ADAPTADOR — resuelve la ref de personaje
 *  del style pack, guarda lo generado y apunta el gasto, porque el servicio
 *  devuelve imágenes y no guarda nada.
 *
 *  Espejo de `SkinSpriteSheetRequest` (`ai_server/routers/remote_generation.py`),
 *  que desde #366 es un `BaseModel` de verdad: un campo ausente o mal escrito
 *  sale como 422 estructurado en vez de convertirse en `""` y viajar. */
export interface SkinSpriteSheetRequest {
  /** Modelo base del sheet (p. ej. "y_bot"). */
  model: string;
  /** Anim a vestir. Ausente ⇒ "idle" (default del server); nunca vacía. */
  anim?: string;
  /** OBLIGATORIO, y el espejo lo declaraba opcional: el server lo EXIGE desde
   *  que se retiró la vista cuyo ángulo era el default, y una petición sin él
   *  cruzaba medio sistema para morir en un 404 sin explicación. */
  angle: string;
  /** Descripción del personaje a skinnear. */
  prompt: string;
  style_id?: string;
  /** Id de la ref de personaje del pack (characters/) elegida para este NPC.
   *  Vacío/desconocido ⇒ primera ref de characters/ del manifest. El nombre
   *  del campo es legacy (era el rol commoner/noble/warrior). */
  style_role?: string;
}

// El meta.json de un sprite sheet vive en ./sprite-forge.ts: es zod (no
// interface) y se valida contra las fixtures canónicas que emite el propio
// servicio (test/contract-sprite-forge.test.ts), porque este espejo llegó a
// declarar obligatorio un `generated_at` que el sheet vestido nunca llevó.

export interface SkinSpriteSheetResponse {
  ok: boolean;
  hash: string;
  /** true = el sheet salió de la caché de remote-gen sin repagar. El cliente
   *  lo usa para contabilidad VISIBLE (LED «reusado» vs «pintado» del batch
   *  de estilo); lo emite siempre el servicio real
   *  (routers/remote_generation.py). */
  cached: boolean;
  /** meta.json del sheet SKINNEADO (dims, frames, anclas + bloque skin). */
  meta: SpriteSheetMeta;
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
  /** Carpeta del pack donde vive la imagen, que es su ROL: la lámina de
   *  materiales, una cara del mundo o un model sheet de personaje. */
  folder: "surfaces" | "faces" | "characters";
  /** Qué muestra la imagen (español, una frase) — lo que lee el motor
   *  narrativo para elegirla. Opcional solo para la lámina (surfaces/). */
  description: string;
  image_b64: string;
  /** Id estable de la ref; derivado de la descripción si falta. */
  id?: string;
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
  /** Carpeta del pack a la que pertenece la ref (rol del contenido, no una
   *  vista de mundo: el juego tiene una sola y no se elige). */
  folder: string;
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

export interface RemoteGenHealthResponse {
  status: "ready" | "loading";
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

// ── Estado agregado del panel de dev del cliente ──

/** Una llamada REAL a una API de pago (nunca cache-hits). Coste ESTIMADO por
 *  tabla estática (meshy_client.py), no facturación real. */
export interface DevSpendCall {
  /** Epoch seconds. */
  t: number;
  usd: number;
  /** Qué se generó (prompt recortado, categoría de style pack…). */
  what: string;
  /** Proceso que lanzó la llamada ("remote-gen", "narrative-llm"…). */
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
    /** Modelo del atlas de superficies de la vista fps (celdas tileables). */
    surface_model: string;
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
  /** El toggle vive aquí: los canales cacheados son las respuestas de las
   *  APIs de pago, sus únicos consumidores. Cada canal es global — compartir
   *  canal entre pipelines distintos empareja blobs con el item equivocado
   *  EN SILENCIO (gotcha documentado en routers/generation.py). */
  devApiCacheStatus: endpoint<void, DevApiCacheStatus>("GET", "/dev/api_cache"),
  devApiCacheToggle: endpoint<DevApiCacheToggleRequest, DevApiCacheStatus>(
    "POST",
    "/dev/api_cache",
  ),
  /** Panel de dev del cliente (routers/cache_assets.py). */
  devStatus: endpoint<void, DevStatus>("GET", "/dev/status"),
} as const;

export type RemoteGenApi = typeof RemoteGenApi;
