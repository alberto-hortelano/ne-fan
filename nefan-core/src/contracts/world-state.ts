/** S2 · world-state — HTTP :9878 (hoy: State API del bridge,
 * `bridge/state-http-server.ts`, co-desplegado en el proceso del gateway).
 *
 * Fuente de verdad del mundo: NarrativeState (ÚNICO escritor de
 * saves/{id}/state.json), WorldMapManager, NpcDirector y plugins runtime.
 * Consumidores: narrative-mcp (las 18 tools de estado son wrappers 1:1 de
 * esta tabla) y el cliente HTML (solo /styles/*, que migra a asset-store en
 * F2). Toda mutación dispara la persistencia del save (onMutation).
 *
 * Errores: `ErrorResponse` con status 400/404/500. Body máximo: 256 KiB.
 */
import type {
  EntityRecord,
  InventoryItem,
  NarrativePlayerState,
  LlmContext,
  WorldMap,
  Place,
  PlaceLink,
  PlaceUpsert,
  LinkSpec,
  PlaceTriggerSpec,
  NpcDirective,
  NpcPlaceInfo,
  NpcDirectorResult,
  PluginManifest,
  PluginInspectResult,
  SceneValidationResult,
  FormatDScene,
} from "./common.js";
import type { VocabularyEntry } from "../games/vocabulary.js";
import { endpoint } from "./http.js";

// ── Sobres request/response (hoy implícitos en state-http-server.ts) ──

export interface WorldStateHealthResponse {
  ok: true;
  session_id: string | null;
  has_session: boolean;
  game_id: string | null;
  /** A qué motor narrativo habla ESTE bridge (`AI_SERVER_URL` de
   *  ws-server.ts). Es la SEGUNDA vía de dinero del banco de pruebas y hasta
   *  hoy no salía del proceso: el `?ai=` de la página solo gobierna lo que
   *  pide el CLIENTE, mientras que las escenas y las consecuencias las pide el
   *  bridge por su cuenta. Un guion podía comprobar que la página apuntaba al
   *  motor falso y disparar igualmente generación de pago a través del bridge.
   *  Publicarlo es lo que permite al guardarraíl exigir las DOS vías. */
  ai_server_url: string;
  /** El gateway (WS) que vive en ESTE MISMO proceso.
   *
   *  Es la IDENTIDAD de la vía: sin ella, publicar a qué motor apunta el bridge
   *  no sirve de nada, porque quien pregunta no puede saber si le está
   *  preguntando al bridge que su página usa o al de al lado. Medido con el
   *  cliente real: `?bridge=ws://127.0.0.1:19877` mueve el gateway y **no**
   *  mueve `world-state` (`envFromQuery` solo mapea `NEFAN_URL_GAME_GATEWAY`),
   *  así que el guardarraíl de gasto interrogaba a la State API del bloque base
   *  mientras el juego hablaba con otro bridge — y ese otro, arrancado sin
   *  `NEFAN_AI_SERVER`, apunta por defecto al ai_server REAL, que cobra.
   *  Comparando esto con el gateway que la página usa de verdad, el desajuste
   *  deja de ser invisible. */
  gateway_url: string;
}

export interface PlaceDetailResponse {
  place: Place;
  children: Place[];
  /** Cadena de ancestros SIN el propio place (el server hace slice(1)). */
  ancestors: Place[];
  outgoing_links: PlaceLink[];
  npcs: NpcPlaceInfo[];
}

export interface PlaceUpsertResponse {
  ok: true;
  place: Place;
}

export interface MapLinkResponse {
  ok: true;
  link: PlaceLink;
}

/** Registro ADITIVO de assets usados por una escena (append con dedupe a
 *  scenes_loaded[scene_id].asset_refs): los hashes entran en la keep-list del
 *  prune del asset-store. Lo emite el cliente al instalar arte derivado (p.
 *  ej. las celdas de superficie de la vista fps). */
export interface SceneAssetRefsRequest {
  scene_id: string;
  refs: string[];
}

export interface SceneAssetRefsResponse {
  ok: true;
  /** Total de refs de la escena tras el append. */
  total: number;
}

export interface MapTriggerRequest {
  place_id: string;
  trigger: PlaceTriggerSpec;
}

export interface MapTriggerResponse {
  ok: true;
  place_id: string;
  trigger_id: string;
}

/** Resumen por entidad de GET /entities (subset de EntityRecord +
 *  data.name si existe — mismo shape compacto que el contexto LLM). */
export type EntitySummary = Pick<
  EntityRecord,
  "id" | "type" | "scene_id" | "position" | "spawn_reason"
> & { name?: string };

export interface EntityListResponse {
  entities: EntitySummary[];
}

/** GET /entity/player devuelve este shape especial en vez de un EntityRecord. */
export interface PlayerEntityResponse {
  id: "player";
  type: "player";
  player: NarrativePlayerState;
}

export interface InventoryGetResponse {
  entity_id: string;
  inventory: unknown[];
}

export interface InventoryAddRequest {
  /** Con `id` obligatorio: es por lo que `inventory_remove` lo encuentra. */
  item: InventoryItem;
}

export interface InventoryRemoveRequest {
  item_id: string;
}

export interface InventoryMutationResponse {
  ok: true;
  entity_id: string;
  inventory: unknown[];
}

export interface WorldDocResponse {
  game_id: string;
  world_name: string;
  /** world.md completo del juego (10 secciones). */
  world_doc: string;
}

/** POST /vocabulary (tool MCP vocabulary_set, solo génesis generate_game):
 *  el motor declara el vocabulario canónico reutilizable del mundo. El
 *  bridge lo persiste en data/games/{id}/world/vocabulary.json con el
 *  world_doc_hash de la sesión. */
export interface VocabularySetRequest {
  entries: VocabularyEntry[];
}

export interface VocabularySetResponse {
  ok: true;
  game_id: string;
  count: number;
}

/** GET /story (tool MCP story_get): la crónica COMPLETA de la sesión — el
 *  contexto por turno solo inline la cola reciente cuando crece. */
export interface StoryResponse {
  session_id: string;
  story_so_far: string;
  total_chars: number;
}

/** POST /scheduled_event/{id}/resolve (tool MCP scheduled_event_resolve):
 *  retira de la agenda un schedule_event ya disparado u obsoleto. */
export interface ScheduledEventResolveResponse {
  ok: true;
  id: string;
  /** Pendientes que quedan tras resolver. */
  remaining: number;
}

export interface UiDocResponse {
  /** Configuración ACTIVA (congelada en el save) de la sesión. */
  ui_state: {
    render_mode: string;
    combat_system: string;
    style_id: string | undefined;
    plugins: Array<Record<string, unknown>>;
  };
  /** data/contract/prompts/ui_systems.md — doc canónico de sistemas de UI. */
  ui_doc: string;
}

export interface SceneValidateRequest {
  scene: FormatDScene;
}

export interface PluginListResponse {
  /** Resumen por plugin activo: {id, name, version, description,
   *  origin_author, events_consumed, events_produced, derived_views}. */
  plugins: Array<Record<string, unknown>>;
}

export interface PluginRegisterRequest {
  manifest: PluginManifest;
}

export interface PluginRegisterResponse {
  ok: true;
  id: string;
  name: string;
  version: number;
  /** Fixtures replayadas EN ESTA LLAMADA. Con `action: "unchanged"` es 0: el
   *  manifest ya estaba activo y no se vuelve a validar nada. */
  fixturesPassed: number;
  /** Qué pasó con el registry (§7.3 "Evolución"): `created` plugin nuevo,
   *  `migrated` el mismo `name` con versión mayor sustituyó al vigente
   *  migrando su slice, `unchanged` el mismo manifest exacto (no-op). El motor
   *  narrativo tiene que poder distinguirlos: si creía crear y evolucionó, su
   *  modelo del mundo cambió. */
  action: "created" | "migrated" | "unchanged";
  /** Solo en `migrated`: versión sustituida. */
  from_version?: number;
  /** Solo en `migrated`: autor del record sustituido. `developer` significa
   *  que el motor acaba de tomar un plugin shipped y su JSON de disco queda
   *  inerte para esta sesión. */
  from_origin_author?: "developer" | "narrative_engine";
}

export interface NarrativeProgressRequest {
  /** Latido humano-legible del motor narrativo; el server trunca a 300 chars
   *  y lo difunde como narrative_status phase "progress". */
  message: string;
}

export interface NpcsInTransitResponse {
  npcs: NpcPlaceInfo[];
}

export interface NpcMoveToPlaceRequest {
  place_id: string;
}

export interface NpcDirectiveRequest {
  /** null = limpiar la directiva. */
  directive: NpcDirective | null;
}

/** Keep-list para el prune del asset-store (F2): hashes referenciados por
 *  algún save vivo (asset_refs de escenas/entidades), ordenados. Requiere que
 *  el server reciba sessionStorage. */
export interface AssetRefsResponse {
  refs: string[];
}

// ── Tabla de endpoints ──

/** Las rutas que escriben el save lo DECLARAN aquí (`Endpoint.mutates`), no
 *  solo en el `mutated` que devuelve su handler: el despacho exige sesión
 *  activa antes de dejarlas pasar (#453) y el motor sabe, leyendo el
 *  contrato, cuáles pueden fallar por «no hay partida». Doce hoy; la tabla
 *  de test/state-http-caracterizacion.test.ts sujeta que la declaración y
 *  el flag del handler no se separen. */
const MUTA = { mutates: true } as const;

export const WorldStateApi = {
  health: endpoint<void, WorldStateHealthResponse>("GET", "/health"),

  // Map
  getMap: endpoint<void, WorldMap>("GET", "/map"),
  getPlace: endpoint<void, PlaceDetailResponse, "id">("GET", "/map/place/{id}"),
  upsertPlace: endpoint<PlaceUpsert, PlaceUpsertResponse>("POST", "/map/place", MUTA),
  addLink: endpoint<LinkSpec, MapLinkResponse>("POST", "/map/link", MUTA),
  addTrigger: endpoint<MapTriggerRequest, MapTriggerResponse>("POST", "/map/trigger", MUTA),
  appendSceneAssetRefs: endpoint<SceneAssetRefsRequest, SceneAssetRefsResponse>(
    "POST",
    "/scene/asset_refs",
    MUTA,
  ),

  // Entities / inventario
  listEntities: endpoint<void, EntityListResponse>("GET", "/entities"),
  getEntity: endpoint<void, EntityRecord | PlayerEntityResponse, "id">("GET", "/entity/{id}"),
  getInventory: endpoint<void, InventoryGetResponse, "id">("GET", "/entity/{id}/inventory"),
  addInventoryItem: endpoint<InventoryAddRequest, InventoryMutationResponse, "id">(
    "POST",
    "/entity/{id}/inventory",
    MUTA,
  ),
  removeInventoryItem: endpoint<InventoryRemoveRequest, InventoryMutationResponse, "id">(
    "POST",
    "/entity/{id}/inventory/remove",
    MUTA,
  ),

  // Vocabulario canónico (génesis generate_game)
  setVocabulary: endpoint<VocabularySetRequest, VocabularySetResponse>("POST", "/vocabulary", MUTA),

  // Documentos para el motor narrativo
  getWorldDoc: endpoint<void, WorldDocResponse>("GET", "/world_doc"),
  getUiDoc: endpoint<void, UiDocResponse>("GET", "/ui_doc"),
  getStory: endpoint<void, StoryResponse>("GET", "/story"),
  resolveScheduledEvent: endpoint<void, ScheduledEventResolveResponse, "id">(
    "POST",
    "/scheduled_event/{id}/resolve",
    MUTA,
  ),

  // Validación de escenas (pre-flight de narrative_respond y tool
  // scene_validate; el SERVIDOR construye el TileValidationContext desde los
  // edges de los vecinos — el motor no puede olvidarse de pasarlo).
  validateScene: endpoint<SceneValidateRequest, SceneValidationResult>("POST", "/scene/validate"),

  // Plugins
  listPlugins: endpoint<void, PluginListResponse>("GET", "/plugins"),
  inspectPlugin: endpoint<void, PluginInspectResult, "id", { view?: string }>(
    "GET",
    "/plugins/{id}/inspect",
  ),
  registerPlugin: endpoint<PluginRegisterRequest, PluginRegisterResponse>(
    "POST",
    "/plugins/register",
    MUTA,
  ),

  // Progreso del motor narrativo
  narrativeProgress: endpoint<NarrativeProgressRequest, { ok: true }>(
    "POST",
    "/narrative_progress",
  ),

  // NPCs de alto nivel (NpcDirector)
  npcsInTransit: endpoint<void, NpcsInTransitResponse>("GET", "/npcs/in_transit"),
  getNpc: endpoint<void, NpcPlaceInfo, "id">("GET", "/npc/{id}"),
  moveNpcToPlace: endpoint<NpcMoveToPlaceRequest, NpcDirectorResult, "id">(
    "POST",
    "/npc/{id}/move_to_place",
    MUTA,
  ),
  arriveNpc: endpoint<void, NpcDirectorResult, "id">("POST", "/npc/{id}/arrive", MUTA),
  setNpcDirective: endpoint<NpcDirectiveRequest, NpcDirectorResult, "id">(
    "POST",
    "/npc/{id}/directive",
    MUTA,
  ),

  // GET /styles/{style_id}/{file} migró al asset-store en F2 (los covers de
  // un style pack son assets, no estado del mundo): AssetStoreApi.getStyleFile.

  /** PLANNED F5 — contexto LLM de la sesión, para des-stickyficar el
   *  LLMClient de narrative-llm (hoy ese contexto viaja empujado en cada
   *  petición y `session_info` vive en memoria del proceso Python). */
  getLlmContext: endpoint<void, LlmContext, "id">("GET", "/session/{id}/llm_context"),

  /** Keep-list para el prune del asset-store (F2). */
  getAssetRefs: endpoint<void, AssetRefsResponse>("GET", "/sessions/asset_refs"),
} as const;

export type WorldStateApi = typeof WorldStateApi;
