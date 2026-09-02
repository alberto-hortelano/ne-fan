/** S6 · asset-store — HTTP :8767 (`services/asset-store/`, extraído de
 * ai_server en F2).
 *
 * Almacén content-addressed: blobs bajo cache/surfaces/{hash}/surface.png +
 * índice SQLite (cache/manifest.sqlite3). Los generadores registran con
 * `POST /assets`. Clave: sha256(prompt normalizado + context ordenado)[:16];
 * los contexts llevan versiones de pipeline que invalidan a propósito
 * (pipeline=, schema=, algo=, model=, devcache=). El REUSO que ve el motor
 * narrativo (`available_assets`) es por DESCRIPCIÓN verbatim, no por hash.
 *
 * También sirve los style packs binarios (movidos desde world-state :9878 en
 * F2). El prune es LRU con techo cache_max_bytes; los saves referencian
 * assets por hash (asset_refs) — el cruce save↔manifest se resuelve con la
 * keep-list de world-state (/sessions/asset_refs). Errores JSON:
 * `ErrorResponse`; errores de blob: texto plano.
 */
import type { AssetEntry } from "./common.js";
import { endpoint, type BinaryResponse } from "./http.js";

/** El ÚNICO kind del índice (#257): la celda de superficie de la vista fps,
 *  que produce `ai_server/remote_gen_main.py`. Los siete kinds que el store
 *  sirvió hasta septiembre de 2026 (texturas PBR, modelos, skins, sprites,
 *  repintados, recortes SAM2 y un render huérfano) ya no tenían productor y
 *  se purgaron; sus filas viven en archivo/cache/manifest-retirado.json.
 *  Es un literal y no una unión a propósito: añadir un kind exige tocar esta
 *  línea, el `z.literal` del registro y `surfaceDir` del servicio. El
 *  invariante que se defiende es «ningún kind sin productor». */
export type AssetKind = "surface";

/** La fuente del literal para el zod del registro, la DB y el lector de blobs. */
export const ASSET_KIND: AssetKind = "surface";

/** Entrada del manifest — mismo shape que AssetEntry (la librería del motor,
 *  `available_assets`) más el touch LRU. */
export interface ManifestEntry extends AssetEntry {
  /** ISO-8601; lo estampa el touch de los GET (debounce 60 s). */
  last_used?: string;
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
  /** Subtipo de la fila ganadora del collapse por (hash,type); viaja al motor
   *  narrativo en available_assets. */
  subtype: string;
  prompt: string;
  created_at: string;
}

export interface AssetListResponse {
  assets: AssetSummary[];
  total: number;
}

export interface AssetByHashResponse {
  /** cache_url = /cache/{type}/{hash}, siempre: un solo kind, una sola forma. */
  matches: Array<ManifestEntry & { cache_url?: string }>;
}

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

/** Registro de un asset ya escrito en disco por un generador. `type` y
 *  `subtype` son el kind vivo: cualquier otro es 400 en el zod
 *  (request-schemas.ts), no una fila que el prune no sabrá tocar. */
export interface AssetRegisterRequest {
  hash: string;
  type: AssetKind;
  subtype: AssetKind;
  prompt: string;
  size_bytes: number;
  extra?: Record<string, unknown>;
}

export interface AssetRegisterResponse {
  ok: true;
}

export const AssetStoreApi = {
  /** kind = AssetKind (cualquier otro → 400 texto plano "Invalid kind"); PNG. */
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
  prune: endpoint<void, CachePruneResponse>("POST", "/cache/prune"),
  listAssets: endpoint<void, AssetListResponse, never, { asset_type?: string; limit?: number }>(
    "GET",
    "/assets",
  ),
  getAssetByHash: endpoint<void, AssetByHashResponse, "hash">("GET", "/assets/by_hash/{hash}"),
  pinAssets: endpoint<AssetPinRequest, AssetPinResponse>("POST", "/assets/pin"),
  unpinAssets: endpoint<void, AssetUnpinResponse, "ref">("DELETE", "/assets/pin/{ref}"),
  registerAsset: endpoint<AssetRegisterRequest, AssetRegisterResponse>("POST", "/assets"),
  /** Movido desde world-state :9878 en F2 (mismo contrato binario). */
  getStyleFile: endpoint<void, BinaryResponse, "style_id" | "file">(
    "GET",
    "/styles/{style_id}/{file}",
  ),
} as const;

export type AssetStoreApi = typeof AssetStoreApi;
