/** S6 · asset-store — HTTP :8767 (hoy co-vive en ai_server :8765; se extrae
 * en F2, la PRIMERA extracción: desbloquea la concurrencia de todos los
 * generadores).
 *
 * Almacén content-addressed: blobs bajo cache/{tipo}/{hash}/ + índice
 * (manifest). Hoy el índice es cache/manifest.json (~5,8 MB, reescrito ENTERO
 * en cada registro, lock de proceso) — en F2 migra a SQLite y los
 * generadores pasan de escribir el manifest en memoria compartida a
 * `POST /assets`. Clave: sha256(prompt normalizado + context ordenado)[:16];
 * los contexts llevan versiones de pipeline que invalidan a propósito
 * (pipeline=, schema=, algo=, model=, devcache=).
 *
 * También sirve los style packs binarios (movidos desde world-state :9878 en
 * F2). El prune es LRU con techo cache_max_bytes; los saves referencian
 * assets por hash (asset_refs) — el cruce save↔manifest se resuelve con la
 * keep-list de world-state (/sessions/asset_refs) o validando con
 * /assets/by_hash. Errores: `FastApiErrorResponse` (Python hoy; ErrorResponse
 * cuando se reimplemente en Node).
 */
import type { AssetEntry } from "./common.js";
import { endpoint, type BinaryResponse } from "./http.js";

/** Tipos de blob servibles por /cache/{kind}/{hash}. OJO orden de rutas: en
 *  FastAPI /cache/{map_type}/{hash} se registra ANTES que /cache/check/{hash}
 *  — contrato observable que cualquier reimplementación debe preservar. */
export type AssetKind =
  | "albedo"
  | "normal"
  | "roughness"
  | "model"
  | "skin"
  | "sprite"
  | "scene"
  | "plate"
  | "segment"
  /** Celda de superficie de la vista fps (librería reutilizable). */
  | "surface";

/** Entrada del manifest — mismo shape que AssetEntry del save
 *  (asset_index_snapshot) más el touch LRU. */
export interface ManifestEntry extends AssetEntry {
  /** ISO-8601; lo estampa el touch de los GET (debounce 60 s). */
  last_used?: string;
}

export interface CacheCheckResponse {
  exists: boolean;
  /** Mapas presentes para el hash (albedo/normal/roughness…). */
  maps: string[];
}

export interface CachePruneResponse {
  ok: boolean;
  pruned: number;
  freed_bytes: number;
  total_bytes: number;
}

export interface AssetSummary {
  hash: string;
  type: string;
  /** Subtipo de la fila ganadora del collapse por (hash,type) — desambigua
   *  texturas (albedo/normal) y viaja al motor narrativo en available_assets. */
  subtype: string;
  prompt: string;
  created_at: string;
}

export interface AssetListResponse {
  assets: AssetSummary[];
  total: number;
}

export interface AssetByHashResponse {
  /** cache_url solo para texture (→ /cache/{subtype}/{hash}) y
   *  model|skin|sprite|surface (→ /cache/{type}/{hash}); scene/segment van
   *  SIN él (cable real del router original). */
  matches: Array<ManifestEntry & { cache_url?: string }>;
}

/** PLANNED F2 — registro remoto de un asset ya subido/escrito por un
 *  generador (sustituye la escritura in-process del manifest). */
/** POST /assets/pin — protege hashes del prune bajo una referencia lógica
 *  (aplicación de estilo a juego: "game_style:{game}:{style}").
 *  Re-pinear el mismo ref AÑADE hashes; DELETE /assets/pin/{ref} los retira
 *  todos (regenerar estilo = unpin del ref viejo + pin del nuevo). */
export interface AssetPinRequest {
  ref: string;
  hashes: string[];
}

export interface AssetPinResponse {
  ok: true;
  ref: string;
  pinned: number;
}

export interface AssetUnpinResponse {
  ok: true;
  ref: string;
  removed: number;
}

export interface AssetRegisterRequest {
  hash: string;
  type: string;
  subtype: string;
  prompt: string;
  size_bytes: number;
  extra?: Record<string, unknown>;
}

export interface AssetRegisterResponse {
  ok: true;
}

export const AssetStoreApi = {
  /** kind ∈ AssetKind; el content-type depende del kind (PNG salvo
   *  model → model/gltf-binary). */
  getBlob: endpoint<void, BinaryResponse, "kind" | "hash">("GET", "/cache/{kind}/{hash}"),
  /** filename con regex dir_\d+_frame_\d{3}\.png. */
  getSpriteSheetFrame: endpoint<void, BinaryResponse, "hash" | "filename">(
    "GET",
    "/cache/sprite_sheet/{hash}/{filename}",
  ),
  /** Hero-shot de identidad del pipeline de skins (1024², figura entera
   *  sobre fondo neutro): el cliente lo recorta a busto para el retrato del
   *  diálogo. `key` = `hero_key` del adaptador de sprite-forge
   *  (ai_server/routers/remote_generation.py). Almacén
   *  paralelo sin manifest, como los frames. */
  getSpriteHero: endpoint<void, BinaryResponse, "key">("GET", "/cache/sprite_hero/{key}"),
  /** @deprecated RUTA MUERTA desde que existe el catch-all: /cache/{kind}/
   *  {hash} se registró siempre ANTES, así que /cache/check/{h} matchea con
   *  kind="check" → 400 "Invalid map type". El shape CacheCheckResponse nunca
   *  ha sido servible; la reimplementación Node preserva el 400 (test fija el
   *  comportamiento). Revivirla sería un cambio de cable, no un fix. */
  checkHash: endpoint<void, CacheCheckResponse, "hash">("GET", "/cache/check/{hash}"),
  prune: endpoint<void, CachePruneResponse>("POST", "/cache/prune"),
  listAssets: endpoint<void, AssetListResponse, never, { asset_type?: string; limit?: number }>(
    "GET",
    "/assets",
  ),
  getAssetByHash: endpoint<void, AssetByHashResponse, "hash">("GET", "/assets/by_hash/{hash}"),
  pinAssets: endpoint<AssetPinRequest, AssetPinResponse>("POST", "/assets/pin"),
  unpinAssets: endpoint<void, AssetUnpinResponse, "ref">("DELETE", "/assets/pin/{ref}"),
  /** PLANNED F2. */
  registerAsset: endpoint<AssetRegisterRequest, AssetRegisterResponse>("POST", "/assets"),
  /** Movido desde world-state :9878 en F2 (mismo contrato binario). */
  getStyleFile: endpoint<void, BinaryResponse, "style_id" | "file">(
    "GET",
    "/styles/{style_id}/{file}",
  ),
} as const;

export type AssetStoreApi = typeof AssetStoreApi;
