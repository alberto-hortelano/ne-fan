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

/** Los kinds del índice, cada uno con su PRODUCTOR vivo (#257, #376).
 *
 *  - `surface`: la celda de superficie de la vista fps, que produce
 *    `ai_server/remote_gen_main.py`.
 *  - `sprite_sheet` y `sprite_hero`: el arte de personaje vestido y su
 *    hero-shot de identidad, que produce el adaptador de sprite-forge
 *    (`ai_server/routers/remote_generation.py`, `/skin_sprite_sheet`).
 *
 *  Los siete kinds que el store sirvió hasta septiembre de 2026 (texturas
 *  PBR, modelos, skins, sprites, repintados, recortes SAM2 y un render
 *  huérfano) ya no tenían productor y se purgaron; sus filas viven en
 *  archivo/cache/manifest-retirado.json. El invariante que se defiende NO es
 *  «un solo kind» sino «ningún kind SIN productor»: hasta #376 los dos del
 *  arte de personaje lo tenían y no estaban indexados, o sea que el índice
 *  mentía por omisión — el hero-shot son ~60 % de los bytes pagados en
 *  personajes y su prompt no se guardaba en ningún sitio.
 *
 *  Es una unión DERIVADA de esta tupla, no tres literales sueltos: los mapas
 *  que hay que ampliar al añadir un kind (`blobDirs` del servicio) son
 *  `Record<AssetKind, …>`, así que un kind sin directorio de blobs NO
 *  COMPILA. Esa es la totalidad, y está en el tipo. */
export const ASSET_KINDS = ["surface", "sprite_sheet", "sprite_hero"] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export function esAssetKind(kind: string): kind is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(kind);
}

/** El ÚNICO kind que sirve el catch-all `GET /cache/{kind}/{hash}` con un PNG
 *  plano ({dir}/{hash}/surface.png).
 *
 *  Existe porque desde #376 «kinds del ÍNDICE» y «kinds servibles por esa
 *  ruta» dejan de coincidir, y eso tiene que decirlo una constante y no un
 *  comentario: los sheets vestidos son un DIRECTORIO de N frames
 *  (`/cache/sprite_sheet/{hash}/{filename}`, 4 segmentos) y el hero-shot un
 *  PNG bajo `heroes/` con su propia ruta y su propia validación de clave
 *  (`/cache/sprite_hero/{key}`). Meterlos en el catch-all cambiaría el cable
 *  observable de los dos (el 400 de una clave mal formada dejaría de decir
 *  «Invalid filename»). */
export const KIND_BLOB_PLANO: AssetKind = "surface";

/** Los dos kinds del arte de un personaje. Van SIEMPRE juntos: el hero-shot
 *  es la llamada de identidad que fija su cara y los sheets son sus anims
 *  repintadas a partir de él, así que un hero sin sus frames —o al revés— es
 *  arte pagado que ya no sirve para nada (#376). Se registran por una ruta
 *  propia (`registerCharacterArt`) y no por `POST /assets`: ver ahí por qué. */
export const KINDS_DE_PERSONAJE = ["sprite_sheet", "sprite_hero"] as const;

export type AssetKindDePersonaje = (typeof KINDS_DE_PERSONAJE)[number];

export function esKindDePersonaje(kind: string): kind is AssetKindDePersonaje {
  return (KINDS_DE_PERSONAJE as readonly string[]).includes(kind);
}

/** La forma que tienen de verdad todas las claves del índice: 16 hex.
 *
 *  `sha256(...)[:16]` en los dos productores — `AssetCache.hash_key`
 *  (superficies) y `hero_key`/`_skin_sheet_key` (personaje). El LECTOR ya la
 *  exigía para el hero (`HERO_KEY_RE`, blob-store.ts); el ESCRITOR no, y por
 *  ahí se colaba una fila cuyo blob el lector iba a rechazar con «Invalid
 *  filename», y algo peor: el prune borra `rutaDeBlob(kind, hash)` con
 *  `rmSync recursive`, así que un `hash` que fuera un nombre de directorio
 *  plausible —`heroes`— se llevaba la carpeta ENTERA de hero-shots dejando
 *  sus filas apuntando a nada, y un `../..` salía de `cache/`. Medido por QA
 *  el 2026-09-03 con el prune real. Que el hash sea contenido y no un nombre
 *  elegido es lo que hace segura la ruta derivada, y hasta hoy solo lo
 *  garantizaba la buena educación del productor. */
export const HASH_DE_ASSET = /^[0-9a-f]{16}$/;

/** El `ref` bajo el que se pinan el hero-shot de un personaje y TODOS sus
 *  sheets vestidos.
 *
 *  Se DERIVA del `hero_key` **en el servidor**, y esa es toda la garantía de
 *  «se pinan y se sueltan juntos»: con un solo ref,
 *  `DELETE /assets/pin/{ref}` los retira a la vez POR CONSTRUCCIÓN, sin que
 *  nadie tenga que acordarse de recorrer los frames.
 *
 *  Que lo derive el servidor y no lo mande el cliente NO es cosmética: fue la
 *  primera forma de esta PR y el QA la tumbó midiéndola. Con `character_ref`
 *  como campo de entrada por fila, un `sprite_sheet` podía declarar el ref de
 *  OTRO personaje y el store lo aceptaba: soltar A se llevaba los frames de
 *  B (`removed: 3`) y soltar B dejaba los suyos colgando de A (`removed: 1`)
 *  — literalmente «un hero sin sus frames», que es la frase del criterio de
 *  cierre de #376. No era un test que faltara: el estado malo seguía siendo
 *  EXPRESABLE. Hoy no hay campo en el que mentir, porque el ref no es una
 *  entrada.
 *
 *  El pin es PERMANENTE porque no existe keep-list de arte de personaje
 *  (`entity.asset_refs` es `[]` y no lo rellena ningún llamante): indexar
 *  este arte sin pin lo volvería evictable y el prune podría borrar por LRU
 *  la skin de un NPC vivo. Hoy son invisibles; volverlos borrables sería
 *  empeorar. El unpin llega con esa keep-list, que es issue aparte. */
export function refDeArteDePersonaje(heroKey: string): string {
  return `character:${heroKey}`;
}

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
  /** `cache_url` solo para el kind que sirve el catch-all `/cache/{kind}/{hash}`
   *  (`KIND_BLOB_PLANO`): el sheet vestido es un directorio de frames y el
   *  hero-shot tiene su propia ruta, así que una URL de esa forma no serviría
   *  ninguno de los dos. Ausente = «este kind no se sirve por ahí», no «no
   *  hay blob». */
  matches: Array<ManifestEntry & { cache_url?: string }>;
}

/** POST /assets/pin — protege hashes del prune bajo una referencia lógica.
 *  Dos refs vivas: la aplicación de estilo a juego
 *  ("game_style:{game}:{style}"), que se pina desde el cliente, y el arte de
 *  un personaje ("character:{hero_key}", `refDeArteDePersonaje`), que lo pina
 *  el propio store al registrar (#376) — ese no se pide por aquí.
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

/** Registro de una superficie ya escrita en disco por remote-gen. */
export interface AssetRegisterSurface {
  hash: string;
  type: "surface";
  subtype: "surface";
  prompt: string;
  size_bytes: number;
  extra?: Record<string, unknown>;
}

/** Registro de un asset ya escrito en disco por un generador.
 *
 *  `POST /assets` es la puerta de la SUPERFICIE y solo de ella. El arte de
 *  personaje tiene la suya (`registerCharacterArt`) porque no se registra fila
 *  a fila: se registra un PERSONAJE. */
export type AssetRegisterRequest = AssetRegisterSurface;

/** Una fila de arte de personaje dentro de la petición de su personaje.
 *
 *  No lleva `type`, ni `subtype`, ni `ref`: los pone el store. Lo único que
 *  aporta quien registra es lo que solo él sabe — qué blob es, cuánto pesa,
 *  con qué texto se pidió y con qué se volvería a pedir. */
export interface ArteDePersonajeFila {
  /** 16 hex (`HASH_DE_ASSET`): el `hero_key` para el hero, la clave del sheet
   *  vestido para cada anim. */
  hash: string;
  /** La descripción con la que se pagó. NO puede ir vacía: este arte se
   *  indexa para poder regenerarlo con un modelo mejor («la descripción es la
   *  procedencia», #293), y una fila muda es la mentira que #376 denuncia,
   *  con la agravante de estar escrita en el índice. */
  prompt: string;
  size_bytes: number;
  /** Con qué se vuelve a pedir exactamente este arte (triple, modelo de
   *  imagen, estilo, identidad de la hoja base, perfil de repintado). El
   *  `character_ref` NO se manda: lo estampa el store desde `hero_key`. */
  extra?: Record<string, unknown>;
}

/** `POST /assets/character` — el arte de UN personaje, en una sola petición.
 *
 *  POR QUÉ ES UNA RUTA APARTE Y NO `POST /assets` CON OTRO `type`. La primera
 *  forma de #376 registraba fila a fila con un `character_ref` por fila, y el
 *  QA la tumbó midiéndola: un `sprite_sheet` podía declarar el ref de otro
 *  personaje, así que soltar A se llevaba los frames de B y soltar B dejaba
 *  los suyos colgando de A. «Un hero sin sus frames» —la frase del criterio de
 *  cierre— seguía siendo un estado EXPRESABLE, y el contrato prometía lo
 *  contrario. Aquí el `ref` no es un campo: se DERIVA de `hero_key` y lo mismo
 *  para las N filas, así que no hay dónde escribir la contradicción.
 *
 *  Y de paso arregla una segunda grieta que la forma anterior tenía y nadie
 *  había mirado: con dos POST, si el primero pasaba y el segundo no, quedaba
 *  un hero pineado sin sus frames en el índice hasta la siguiente servida. Una
 *  petición es UNA transacción: o entran todos, o no entra ninguno.
 *
 *  Las dos mitades son opcionales por separado, y las dos ausencias son
 *  estados reales del productor:
 *  - `hero` ausente = su PNG no está en disco (un sheet servido de caché cuyo
 *    hero se archivó). Registrar su fila sería prometer un blob que no está.
 *  - `sheets` vacío = todavía no hay ninguna anim vestida bajo esa identidad,
 *    o se archivaron todas (es el caso del barrido de
 *    `ai_server/tools/arte_de_personaje.py`).
 *  Las dos a la vez, no: una petición que no registra nada es un error del
 *  llamante y sale por 400. */
export interface AssetCharacterRegisterRequest {
  /** La identidad del personaje (`hero_key`, 16 hex) y la ÚNICA fuente del
   *  `ref` de pin. */
  hero_key: string;
  /** El hero-shot, si su blob está en disco. Su `hash` es `hero_key` y por eso
   *  no se manda: no puede discrepar de él. */
  hero?: Omit<ArteDePersonajeFila, "hash">;
  /** Las anims vestidas de ESTE personaje que hay en disco. */
  sheets?: ArteDePersonajeFila[];
}

export interface AssetCharacterRegisterResponse {
  ok: true;
  /** El ref derivado bajo el que quedó todo pineado. */
  ref: string;
  /** Cuántas filas se registraron (las repetidas cuentan: es idempotente). */
  rows: number;
}

export interface AssetRegisterResponse {
  ok: true;
}

export const AssetStoreApi = {
  /** kind = KIND_BLOB_PLANO (cualquier otro → 400 texto plano "Invalid kind"); PNG. */
  getBlob: endpoint<void, BinaryResponse, "kind" | "hash">("GET", "/cache/{kind}/{hash}"),
  /** filename con regex dir_\d+_frame_\d{3}\.png. */
  getSpriteSheetFrame: endpoint<void, BinaryResponse, "hash" | "filename">(
    "GET",
    "/cache/sprite_sheet/{hash}/{filename}",
  ),
  /** Hero-shot de identidad del pipeline de skins (1024², figura entera
   *  sobre fondo neutro): el cliente lo recorta a busto para el retrato del
   *  diálogo. `key` = `hero_key` del adaptador de sprite-forge
   *  (ai_server/routers/remote_generation.py), que es también el `hash` de su
   *  fila del índice y el `character_ref` con el que se pina. */
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
  /** El arte de UN personaje, hero y sheets en una transacción, pineado bajo
   *  un `ref` que DERIVA el store. Ver AssetCharacterRegisterRequest. */
  registerCharacterArt: endpoint<AssetCharacterRegisterRequest, AssetCharacterRegisterResponse>(
    "POST",
    "/assets/character",
  ),
  /** Movido desde world-state :9878 en F2 (mismo contrato binario). */
  getStyleFile: endpoint<void, BinaryResponse, "style_id" | "file">(
    "GET",
    "/styles/{style_id}/{file}",
  ),
} as const;

export type AssetStoreApi = typeof AssetStoreApi;
