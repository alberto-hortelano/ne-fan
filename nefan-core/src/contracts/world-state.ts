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
import { endpoint } from "./http.js";

// ── Sobres request/response (hoy implícitos en state-http-server.ts) ──

export interface WorldStateHealthResponse {
  ok: true;
  session_id: string | null;
  has_session: boolean;
  game_id: string | null;
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
  item: unknown;
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
    view: string;
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
  fixturesPassed: number;
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
 *  algún save vivo (asset_refs de escenas/entidades + asset_index_snapshot),
 *  ordenados. Requiere que el server reciba sessionStorage. */
export interface AssetRefsResponse {
  refs: string[];
}

// ── Tabla de endpoints ──

export const WorldStateApi = {
  health: endpoint<void, WorldStateHealthResponse>("GET", "/health"),

  // Map
  getMap: endpoint<void, WorldMap>("GET", "/map"),
  getPlace: endpoint<void, PlaceDetailResponse, "id">("GET", "/map/place/{id}"),
  upsertPlace: endpoint<PlaceUpsert, PlaceUpsertResponse>("POST", "/map/place"),
  addLink: endpoint<LinkSpec, MapLinkResponse>("POST", "/map/link"),
  addTrigger: endpoint<MapTriggerRequest, MapTriggerResponse>("POST", "/map/trigger"),

  // Entities / inventario
  listEntities: endpoint<void, EntityListResponse>("GET", "/entities"),
  getEntity: endpoint<void, EntityRecord | PlayerEntityResponse, "id">("GET", "/entity/{id}"),
  getInventory: endpoint<void, InventoryGetResponse, "id">("GET", "/entity/{id}/inventory"),
  addInventoryItem: endpoint<InventoryAddRequest, InventoryMutationResponse, "id">(
    "POST",
    "/entity/{id}/inventory",
  ),
  removeInventoryItem: endpoint<InventoryRemoveRequest, InventoryMutationResponse, "id">(
    "POST",
    "/entity/{id}/inventory/remove",
  ),

  // Documentos para el motor narrativo
  getWorldDoc: endpoint<void, WorldDocResponse>("GET", "/world_doc"),
  getUiDoc: endpoint<void, UiDocResponse>("GET", "/ui_doc"),
  getStory: endpoint<void, StoryResponse>("GET", "/story"),
  resolveScheduledEvent: endpoint<void, ScheduledEventResolveResponse, "id">(
    "POST",
    "/scheduled_event/{id}/resolve",
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
  ),
  arriveNpc: endpoint<void, NpcDirectorResult, "id">("POST", "/npc/{id}/arrive"),
  setNpcDirective: endpoint<NpcDirectiveRequest, NpcDirectorResult, "id">(
    "POST",
    "/npc/{id}/directive",
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
