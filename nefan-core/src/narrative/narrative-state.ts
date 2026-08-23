/** Persistent narrative state for the open-world RPG.
 *
 * Canonical schema of the save. Persistence is delegated to a SessionStorage
 * implementation (filesystem in Node, could be IndexedDB in the browser if a
 * client ever runs the state itself).
 */
import {
  SCHEMA_VERSION,
  type AssetEntry,
  type Consequence,
  type DialogueChoice,
  type DialogueEvent,
  type EntityRecord,
  type LlmContext,
  type NarrativePlayerState,
  type SceneRecord,
  type SessionData,
  type ScheduledEventRecord,
  type SessionMetadata,
  type Vec3Like,
  type NarrativeWorldState,
  toTuple,
} from "./types.js";
import type { SessionStorage } from "./session-storage.js";
import { WorldMapManager } from "../world-map/world-map.js";
import type { Edge } from "../world-map/types.js";
import { neighborTile, tileKey, type TileCoord } from "../scene/tile.js";
import { computeTileEdges } from "../scene/tile-edges.js";
import type { PluginRecord, PluginManifest, PluginOrigin } from "../plugins/types.js";
import { computePluginId } from "../plugins/hash.js";
import { migrateActiveSceneToTile, migrateWorldMapFromV1 } from "./migrations.js";
import { buildLlmContext } from "./serialize-llm.js";
import { registerSceneNpcs } from "./npc-records.js";

export type AssetValidator = (hash: string) => Promise<boolean>;
export type LoadWarningSink = (source: string, message: string) => void;

export interface LoadSessionOptions {
  /** Probe each unique asset hash in `asset_index_snapshot` against the live
   *  manifest. Hashes the validator reports as missing (resolved `false`) are
   *  dropped from the snapshot. Errors thrown by the validator leave the entry
   *  intact — we don't conflate "uncertain" with "missing". */
  assetValidator?: AssetValidator;
  /** Optional channel for human-facing warnings during the load
   *  (orphan-asset drops, validation errors). Pair this with the HTML
   *  `errors.push("session", …)` to surface in the dev panel. */
  onWarning?: LoadWarningSink;
}

const DEFAULT_WORLD: NarrativeWorldState = {
  name: "",
  atmosphere: "",
  style_token: "",
  active_scene_id: "",
  description: "",
  style_id: "",
  world_doc_hash: "",
  render_mode: "",
  character_mode: "",
  combat_system: "",
  // Tratado como INMUTABLE (siempre se reasigna entero, nunca se muta): el
  // spread de DEFAULT_WORLD puede compartir esta instancia sin riesgo.
  style_refs: { characters: [] },
};

const DEFAULT_PLAYER: NarrativePlayerState = {
  level: 1,
  class: "rogue",
  health: 100.0,
  gold: 0,
  inventory: [],
  appearance: { model_id: "pete", skin_path: "" },
  position: [0.0, 1.0, 0.0],
  current_scene_id: "",
};

export class NarrativeState {
  session_id = "";
  game_id = "";
  created_at = "";
  updated_at = "";
  world: NarrativeWorldState = { ...DEFAULT_WORLD };
  player: NarrativePlayerState = structuredClone(DEFAULT_PLAYER);
  story_so_far = "";
  scenes_loaded: Record<string, SceneRecord> = {};
  entities: EntityRecord[] = [];
  dialogue_history: DialogueEvent[] = [];
  asset_index_snapshot: AssetEntry[] = [];
  worldMap: WorldMapManager = new WorldMapManager(WorldMapManager.createEmpty());
  plugins: PluginRecord[] = [];
  /** Log compacto de vida ambiental (guardia intervino, campesino huyó…) —
   *  transiciones del NpcBehaviorSystem, NUNCA per-tick. El LLM recibe las
   *  últimas 10 en serializeForLlm como `ambient_events`. */
  ambient_log: string[] = [];
  /** Agenda del director: schedule_event pendientes. Reaparecen en cada
   *  contexto LLM hasta que el motor los resuelve (antes se perdían al
   *  emitirse y el motor los duplicaba en story_update por miedo). */
  scheduled_events: ScheduledEventRecord[] = [];

  private nextEventSeq = 0;
  private nextSchedSeq = 0;
  private dirty = false;
  /** Índice en memoria tileKey → sceneId (reconstruido en load, actualizado en
   *  recordSceneLoaded). No se persiste: se deriva de scenes_loaded[].tile. */
  private tileIndex = new Map<string, string>();

  constructor(private storage: SessionStorage) {}

  // ── Tiles ──

  getTile(tx: number, ty: number): SceneRecord | undefined {
    const sceneId = this.tileIndex.get(tileKey(tx, ty));
    return sceneId ? this.scenes_loaded[sceneId] : undefined;
  }

  hasTile(tx: number, ty: number): boolean {
    return this.tileIndex.has(tileKey(tx, ty));
  }

  /** Records de los 4 tiles adyacentes que existen, por borde. */
  neighborsOf(tx: number, ty: number): Partial<Record<Edge, SceneRecord>> {
    const out: Partial<Record<Edge, SceneRecord>> = {};
    for (const edge of ["north", "south", "east", "west"] as Edge[]) {
      const n = neighborTile(tx, ty, edge);
      const rec = this.getTile(n.tx, n.ty);
      if (rec) out[edge] = rec;
    }
    return out;
  }

  /** Activa el tile (tx,ty) como escena actual (el jugador ha entrado en él
   *  por posición). No re-registra NPCs. Devuelve false si no existe. */
  setActiveTile(tx: number, ty: number): boolean {
    const sceneId = this.tileIndex.get(tileKey(tx, ty));
    if (!sceneId) return false;
    if (this.world.active_scene_id === sceneId) return true;
    this.world.active_scene_id = sceneId;
    this.player.current_scene_id = sceneId;
    this.dirty = true;
    return true;
  }

  private rebuildTileIndex(): void {
    this.tileIndex.clear();
    for (const [sceneId, rec] of Object.entries(this.scenes_loaded)) {
      if (rec.tile) this.tileIndex.set(tileKey(rec.tile.tx, rec.tile.ty), sceneId);
    }
  }

  // ── Lifecycle ──

  startNewSession(gameId: string): string {
    this.session_id = generateSessionId();
    this.game_id = gameId;
    this.created_at = nowIso();
    this.updated_at = this.created_at;
    this.world = { ...DEFAULT_WORLD };
    this.player = structuredClone(DEFAULT_PLAYER);
    this.story_so_far = "";
    this.scenes_loaded = {};
    this.entities = [];
    this.dialogue_history = [];
    this.asset_index_snapshot = [];
    this.worldMap = new WorldMapManager(WorldMapManager.createEmpty());
    this.plugins = [];
    this.ambient_log = [];
    this.scheduled_events = [];
    this.nextEventSeq = 0;
    this.nextSchedSeq = 0;
    this.tileIndex.clear();
    this.dirty = true;
    return this.session_id;
  }

  /** Programa un evento narrativo pendiente (consequence schedule_event).
   *  Devuelve su id. Cap 20: por encima cae el MÁS ANTIGUO con traza — una
   *  agenda que no se resuelve nunca no puede crecer el contexto sin cota. */
  addScheduledEvent(description: string, trigger: string | undefined, eventId: string): string {
    this.nextSchedSeq += 1;
    const id = `sched_${String(this.nextSchedSeq).padStart(4, "0")}`;
    this.scheduled_events.push({
      id,
      description,
      ...(trigger ? { trigger } : {}),
      created_at: nowIso(),
      event_id: eventId,
    });
    if (this.scheduled_events.length > 20) {
      const dropped = this.scheduled_events.shift()!;
      console.warn(
        `[narrative-state] agenda llena (20): cae el scheduled_event más antiguo ` +
        `"${dropped.id}" (${dropped.description.slice(0, 60)}…)`,
      );
    }
    this.dirty = true;
    return id;
  }

  /** Resuelve (retira) un evento programado — el motor lo ha disparado o ha
   *  quedado obsoleto. false si el id no existe. */
  resolveScheduledEvent(id: string): boolean {
    const idx = this.scheduled_events.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.scheduled_events.splice(idx, 1);
    this.dirty = true;
    return true;
  }

  /** Añade una entrada al log ambiental (cap 30 — los saves no crecen sin
   *  límite; el LLM solo consume las últimas 10). */
  appendAmbient(msg: string): void {
    this.ambient_log.push(msg);
    if (this.ambient_log.length > 30) {
      this.ambient_log.splice(0, this.ambient_log.length - 30);
    }
    this.markDirty();
  }

  /** Fija la identidad del mundo de la sesión (título, brief, estilo
   *  congelado y hash del world.md). Lo llama el bridge en start_session con
   *  los datos del game.json/style.json — la fuente de verdad es el FS, el
   *  save la congela. */
  setWorldInfo(info: {
    name: string;
    description: string;
    style_id: string;
    style_token: string;
    world_doc_hash: string;
    render_mode: string;
    character_mode: string;
    combat_system: string;
    style_refs?: NarrativeWorldState["style_refs"];
  }): void {
    this.world.name = info.name;
    this.world.description = info.description;
    this.world.style_id = info.style_id;
    this.world.style_token = info.style_token;
    this.world.world_doc_hash = info.world_doc_hash;
    this.world.render_mode = info.render_mode;
    this.world.character_mode = info.character_mode;
    this.world.combat_system = info.combat_system;
    if (info.style_refs) this.world.style_refs = info.style_refs;
    this.dirty = true;
  }

  /** Reemplaza el catálogo de refs de estilo que ve el motor (`style_ref`
   *  por NPC, `surface_ref` por cara). El bridge lo recalcula del style.json
   *  en start_session y resume_session — el save solo lo cachea. */
  setStyleRefs(refs: NarrativeWorldState["style_refs"]): void {
    this.world.style_refs = refs;
    this.dirty = true;
  }

  async loadSession(sessionId: string, opts?: LoadSessionOptions): Promise<boolean> {
    const data = await this.storage.read(sessionId);
    if (!data) return false;
    if (data.schema_version > SCHEMA_VERSION || data.schema_version < 1) {
      console.warn(`NarrativeState: unsupported schema_version ${data.schema_version}`);
      return false;
    }
    this.session_id = data.session_id;
    this.game_id = data.game_id;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Spread sobre defaults: los saves v4 anteriores a la era de mundos no
    // traen description/style_id/world_doc_hash (campos aditivos, sin bump).
    this.world = { ...DEFAULT_WORLD, ...data.world };
    // Ídem para player: un save viejo sin gold/inventory dejaría undefined en
    // la aritmética de los plugins (inc/dec sobre player.gold → NaN, push a
    // inventory → crash). Mismo criterio aditivo que world.
    this.player = { ...structuredClone(DEFAULT_PLAYER), ...data.player };
    this.story_so_far = data.story_so_far;
    this.scenes_loaded = data.scenes_loaded;
    this.entities = data.entities;
    this.dialogue_history = data.dialogue_history;
    this.asset_index_snapshot = data.asset_index_snapshot;
    const wm = data.world_map && data.schema_version >= 2
      ? data.world_map
      : migrateWorldMapFromV1(data);
    this.worldMap = new WorldMapManager(wm);
    // Migración v2→v3 trivial: los saves anteriores no tienen plugins.
    this.plugins = data.plugins ?? [];
    // Campos aditivos (sin bump de schema): saves previos no los traen.
    this.ambient_log = data.ambient_log ?? [];
    this.scheduled_events = data.scheduled_events ?? [];
    this.nextEventSeq = data._next_event_seq ?? data.dialogue_history.length;
    this.nextSchedSeq = data._next_sched_seq ?? this.scheduled_events.length;
    // Migración v3→v4: la escena activa se envuelve como tile (0,0) del plano
    // continuo. Con el tile centrado en el origen las posiciones mundo no
    // cambian (el jugador y los NPC no se mueven).
    if (data.schema_version < 4) {
      migrateActiveSceneToTile(this);
    }
    this.rebuildTileIndex();
    this.dirty = data.schema_version < SCHEMA_VERSION;
    if (opts?.assetValidator) {
      const pruned = await validateAssetSnapshot(
        this.asset_index_snapshot,
        opts.assetValidator,
        opts.onWarning,
        sessionId,
      );
      if (pruned.changed) {
        this.asset_index_snapshot = pruned.entries;
        this.dirty = true;
      }
    }
    return true;
  }

  async save(): Promise<boolean> {
    if (!this.session_id) return false;
    this.updated_at = nowIso();
    const payload = this.toSessionData();
    await this.storage.write(this.session_id, payload);
    this.dirty = false;
    return true;
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return this.storage.list();
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const ok = await this.storage.delete(sessionId);
    if (ok && sessionId === this.session_id) {
      this.session_id = "";
    }
    return ok;
  }

  // ── Recording mutations ──

  recordSceneLoaded(
    sceneId: string,
    sceneData: Record<string, unknown>,
    assetRefs: string[] = [],
    opts: { activate?: boolean } = {},
  ): void {
    const activate = opts.activate ?? true;
    // Primer registro vs re-broadcast de escena cacheada: decide la semántica
    // de "mismo id en otra escena" de registerSceneNpcs (mover vs conservar).
    const firstRegistration = !(sceneId in this.scenes_loaded);
    // Tile (Format D v3): coords derivadas del propio scene_data y costuras
    // computadas del grid expandido — el registro es autosuficiente.
    const rawTile = sceneData.tile as { tx?: unknown; ty?: unknown } | undefined;
    const tile: TileCoord | undefined =
      rawTile && Number.isInteger(rawTile.tx) && Number.isInteger(rawTile.ty)
        ? { tx: rawTile.tx as number, ty: rawTile.ty as number }
        : undefined;
    const record: SceneRecord = {
      scene_data: sceneData,
      loaded_at: nowIso(),
      asset_refs: assetRefs,
    };
    if (tile) {
      record.tile = tile;
      record.edges = computeTileEdges(sceneData);
      this.tileIndex.set(tileKey(tile.tx, tile.ty), sceneId);
    }
    this.scenes_loaded[sceneId] = record;
    if (activate) {
      this.world.active_scene_id = sceneId;
      this.player.current_scene_id = sceneId;
    }
    const placeId = typeof sceneData.place_id === "string" ? sceneData.place_id : sceneId;
    if (this.worldMap.get(placeId)) {
      this.worldMap.attachRealizedScene(placeId, sceneId);
      if (activate) {
        this.worldMap.markVisited(placeId);
        this.worldMap.setActivePlace(placeId);
      }
    }
    // Anclajes de places al plano: un tile puede declarar dónde VIVEN los
    // places dentro de él ({place_id, rect} en celdas). El bridge activará el
    // place por posición al pisar su rect.
    if (tile && Array.isArray(sceneData.place_anchors)) {
      for (const a of sceneData.place_anchors as Array<{ place_id?: string; rect?: [number, number, number, number] }>) {
        if (typeof a?.place_id !== "string") continue;
        const place = this.worldMap.get(a.place_id);
        if (!place) {
          console.warn(`recordSceneLoaded: place_anchor "${a.place_id}" no existe en el world map — ignorado`);
          continue;
        }
        place.anchor = { tx: tile.tx, ty: tile.ty, rect: Array.isArray(a.rect) ? a.rect : undefined };
        this.worldMap.attachRealizedScene(a.place_id, sceneId);
      }
    }
    registerSceneNpcs(this, sceneId, sceneData, { firstRegistration });
    this.dirty = true;
  }

  /** Append ADITIVO con dedupe a asset_refs de una escena cargada: los
   *  hashes entran en la keep-list del prune del asset-store (p. ej. las
   *  celdas de superficie que la vista fps instaló para ese tile). Devuelve
   *  el total tras el append; lanza si la escena no existe (fail-loud). */
  appendSceneAssetRefs(sceneId: string, refs: string[]): number {
    const record = this.scenes_loaded[sceneId];
    if (!record) throw new Error(`appendSceneAssetRefs: escena "${sceneId}" no cargada`);
    const current = new Set(record.asset_refs);
    for (const ref of refs) {
      if (!current.has(ref)) {
        current.add(ref);
        record.asset_refs.push(ref);
        this.dirty = true;
      }
    }
    return record.asset_refs.length;
  }

  recordEntitySpawned(
    entityId: string,
    entityType: string,
    sceneId: string,
    position: Vec3Like,
    data: Record<string, unknown>,
    spawnReason: string = "scene_init",
    spawnEventId: string = "",
    assetRefs: string[] = [],
  ): string {
    // Unicidad de id: dos entidades con el mismo id colapsarían en el sim
    // (behavior system keyed por id) y en getEntity. Si llega un duplicado
    // (LLM reusando id, o el generador por defecto en el mismo segundo entre
    // turnos), se sufija en vez de crear un choque silencioso. Devuelve el id
    // realmente usado para que el caller emita el effect con ese mismo id.
    let uniqueId = entityId;
    if (this.entities.some((e) => e.id === uniqueId)) {
      let n = 2;
      while (this.entities.some((e) => e.id === `${entityId}_${n}`)) n++;
      uniqueId = `${entityId}_${n}`;
      console.warn(
        `[narrative-state] id de entidad duplicado "${entityId}" → "${uniqueId}"`,
      );
    }
    this.entities.push({
      id: uniqueId,
      type: entityType,
      scene_id: sceneId,
      spawned_at: nowIso(),
      spawn_reason: spawnReason,
      spawn_event_id: spawnEventId,
      position: toTuple(position),
      data,
      asset_refs: assetRefs,
    });
    this.dirty = true;
    return uniqueId;
  }

  recordEntityDespawned(entityId: string): void {
    const idx = this.entities.findIndex((e) => e.id === entityId);
    if (idx >= 0) {
      this.entities.splice(idx, 1);
      this.dirty = true;
    }
  }

  // ── State queries (read by narrative-engine tools) ──

  getEntity(entityId: string): EntityRecord | undefined {
    return this.entities.find((e) => e.id === entityId);
  }

  /** Inventory of an entity. "player" returns the player's inventory; any
   * other id reads entity.data.inventory (empty array if absent). */
  getInventory(entityId: string): unknown[] {
    if (entityId === "player") return this.player.inventory;
    const entity = this.getEntity(entityId);
    if (!entity) return [];
    const inv = entity.data.inventory;
    return Array.isArray(inv) ? inv : [];
  }

  /** Append an item to an entity's inventory. Returns false if the entity
   * doesn't exist. The narrative engine uses this to materialize quest items
   * (e.g. a key in an NPC's pocket). */
  addInventoryItem(entityId: string, item: unknown): boolean {
    if (entityId === "player") {
      this.player.inventory.push(item);
      this.dirty = true;
      return true;
    }
    const entity = this.getEntity(entityId);
    if (!entity) return false;
    const inv = entity.data.inventory;
    if (Array.isArray(inv)) {
      inv.push(item);
    } else {
      entity.data.inventory = [item];
    }
    this.dirty = true;
    return true;
  }

  /** Remove the first inventory item whose `id` matches. Returns false if
   * the entity doesn't exist or no item carries that id — the items are
   * untyped (`unknown[]`), so entries without an `id` field never match. */
  removeInventoryItem(entityId: string, itemId: string): boolean {
    const inv = this.getInventory(entityId);
    if (entityId !== "player" && !this.getEntity(entityId)) return false;
    const idx = inv.findIndex(
      (item) => typeof item === "object" && item !== null &&
        (item as Record<string, unknown>).id === itemId,
    );
    if (idx === -1) return false;
    inv.splice(idx, 1);
    this.dirty = true;
    return true;
  }

  /** Notify that state was mutated out-of-band (e.g. by a narrative engine
   * tool through the bridge HTTP API: world map, NPC directives, triggers),
   * so the next save() persists it. */
  markDirty(): void {
    this.dirty = true;
  }

  // ── Plugins (next.md §7) ──

  getPluginRecord(id: string): PluginRecord | undefined {
    return this.plugins.find((p) => p.id === id);
  }

  /** Registra un plugin activado (génesis F3 o plugin_register F5). Id o
   *  `name` duplicados son un bug del caller — fail-loud.
   *
   *  El candado del `name` es el que hace irrepresentable el bug de #164: un
   *  plugin que sube de versión trae id nuevo (la version entra en el hash),
   *  así que el chequeo por id lo dejaba pasar y la sesión acababa con dos
   *  records del mismo sistema, el viejo huérfano. Un plugin que evoluciona
   *  pasa por `migratePluginRecord`, no por aquí. */
  addPlugin(record: PluginRecord): void {
    if (this.getPluginRecord(record.id)) {
      throw new Error(`NarrativeState.addPlugin: id duplicado ${record.id}`);
    }
    const sameName = this.plugins.find((p) => p.name === record.name);
    if (sameName) {
      throw new Error(
        `NarrativeState.addPlugin: ya hay un plugin '${record.name}' activo ` +
          `(v${sameName.version}, ${sameName.id.slice(0, 12)}…) — una versión nueva ` +
          `se MIGRA con migratePluginRecord, no se añade al lado`,
      );
    }
    this.plugins.push(record);
    this.dirty = true;
  }

  /** Sustituye un PluginRecord migrado (F7, §7.3 "Evolución"): nuevo
   *  id/version/slice/origin del manifest evolucionado, preservando name y
   *  activated_at (cuándo entró el sistema en la partida, no cuándo cambió de
   *  versión). Tras esto el save refleja la versión nueva y los próximos
   *  resume casan por id sin re-migrar.
   *
   *  `manifest` es OBLIGATORIO y decide quién define las reglas a partir de
   *  ahora: `null` cuando el manifest sigue viniendo del FS (resume de un
   *  shipped), el manifest normalizado cuando queda embebido en el save
   *  (registro en runtime, §7.6). No es ceremonia: si un record migrado
   *  conservara el manifest de la versión ANTERIOR bajo el id nuevo, todos los
   *  asserts de id/version/slice pasarían y el siguiente resume serviría las
   *  reglas viejas. Por eso además se comprueba el hash. */
  migratePluginRecord(
    oldId: string,
    next: {
      id: string;
      version: number;
      slice: unknown;
      manifest: PluginManifest | null;
      origin: PluginOrigin;
    },
  ): void {
    const record = this.getPluginRecord(oldId);
    if (!record) {
      throw new Error(`NarrativeState.migratePluginRecord: plugin desconocido ${oldId}`);
    }
    if (next.id !== oldId && this.getPluginRecord(next.id)) {
      throw new Error(`NarrativeState.migratePluginRecord: id destino duplicado ${next.id}`);
    }
    if (next.manifest) {
      const hash = computePluginId(next.manifest);
      if (hash !== next.id) {
        throw new Error(
          `NarrativeState.migratePluginRecord: el manifest embebido (v${next.manifest.version}, ` +
            `hash ${hash.slice(0, 12)}…) no es el del id ${next.id.slice(0, 12)}… — ` +
            `el record serviría reglas de otra versión en el próximo resume`,
        );
      }
    }
    record.id = next.id;
    record.version = next.version;
    record.slice = next.slice;
    record.origin = next.origin;
    if (next.manifest) record.manifest = next.manifest;
    else delete record.manifest;
    this.dirty = true;
  }

  /** Sustituye el slice de un plugin tras un tick del dispatcher (F4). */
  setPluginSlice(id: string, slice: unknown): void {
    const record = this.getPluginRecord(id);
    if (!record) {
      throw new Error(`NarrativeState.setPluginSlice: plugin desconocido ${id}`);
    }
    record.slice = slice;
    this.dirty = true;
  }

  recordDialogueEvent(
    speaker: string,
    text: string,
    choices: (DialogueChoice | string)[],
    chosenIndex: number,
    freeText: string = "",
  ): string {
    const eventId = this.nextEventId();
    this.dialogue_history.push({
      id: eventId,
      timestamp: nowIso(),
      scene_id: this.world.active_scene_id,
      speaker,
      text,
      choices: choices as DialogueChoice[],
      chosen_index: chosenIndex,
      free_text: freeText,
      narrative_consequences: [],
    });
    this.dirty = true;
    return eventId;
  }

  recordNarrativeConsequence(eventId: string, consequence: Consequence): void {
    const evt = this.dialogue_history.find((e) => e.id === eventId);
    if (evt) {
      evt.narrative_consequences.push(consequence);
      this.dirty = true;
    }
  }

  updatePlayerPosition(pos: Vec3Like, sceneId: string = ""): void {
    this.player.position = toTuple(pos);
    if (sceneId) this.player.current_scene_id = sceneId;
    this.dirty = true;
  }

  updatePlayerHealth(health: number): void {
    this.player.health = health;
    this.dirty = true;
  }

  updatePlayerAppearance(modelId: string, skinPath: string): void {
    this.player.appearance = { model_id: modelId, skin_path: skinPath };
    this.dirty = true;
  }

  appendStory(delta: string): void {
    if (!delta) return;
    this.story_so_far = this.story_so_far ? `${this.story_so_far}\n\n${delta}` : delta;
    this.dirty = true;
  }

  setAssetIndexSnapshot(entries: AssetEntry[]): void {
    this.asset_index_snapshot = entries;
    this.dirty = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  // ── Serialization ──

  toSessionData(): SessionData {
    return {
      schema_version: SCHEMA_VERSION,
      session_id: this.session_id,
      game_id: this.game_id,
      created_at: this.created_at,
      updated_at: this.updated_at,
      world: this.world,
      player: this.player,
      story_so_far: this.story_so_far,
      scenes_loaded: this.scenes_loaded,
      entities: this.entities,
      dialogue_history: this.dialogue_history,
      asset_index_snapshot: this.asset_index_snapshot,
      world_map: this.worldMap.serialize(),
      plugins: this.plugins,
      ambient_log: this.ambient_log,
      scheduled_events: this.scheduled_events,
      _next_event_seq: this.nextEventSeq,
      _next_sched_seq: this.nextSchedSeq,
    };
  }

  /** Contexto compacto para el motor narrativo — ver serialize-llm.ts.
   *  @param manifests resolutor de manifests de los plugins activos (el
   *   `activePlugins` del bridge). Sin él, sólo se proyectan los plugins cuyo
   *   manifest está embebido en el record (los generados por IA). */
  serializeForLlm(manifests?: Map<string, PluginManifest>): LlmContext {
    return buildLlmContext(this, manifests);
  }

  // ── Internals ──

  private nextEventId(): string {
    this.nextEventSeq += 1;
    return `evt_${String(this.nextEventSeq).padStart(4, "0")}`;
  }
}

async function validateAssetSnapshot(
  entries: AssetEntry[],
  validator: AssetValidator,
  warn: LoadWarningSink | undefined,
  sessionId: string,
): Promise<{ changed: boolean; entries: AssetEntry[] }> {
  if (entries.length === 0) return { changed: false, entries };
  const cache = new Map<string, boolean>();
  const kept: AssetEntry[] = [];
  let changed = false;
  for (const entry of entries) {
    let present: boolean;
    if (cache.has(entry.hash)) {
      present = cache.get(entry.hash)!;
    } else {
      try {
        present = await validator(entry.hash);
      } catch (err) {
        // Validator failed (network/HTTP error). Keep the entry — uncertain
        // is not the same as missing, and dropping on a transient blip would
        // silently corrupt the session.
        const msg = `could not validate asset ${entry.hash}: ${(err as Error).message}`;
        console.warn(`NarrativeState[${sessionId}]: ${msg}`);
        warn?.("session", msg);
        kept.push(entry);
        continue;
      }
      cache.set(entry.hash, present);
    }
    if (present) {
      kept.push(entry);
    } else {
      changed = true;
      const msg = `dropped orphan asset ${entry.hash} (${entry.type}/${entry.subtype}) from session ${sessionId}`;
      console.warn(`NarrativeState: ${msg}`);
      warn?.("session", msg);
    }
  }
  return { changed, entries: kept };
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateSessionId(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rnd = Math.floor(Math.random() * 0xffffff);
  return `${ts}-${rnd.toString(16).padStart(6, "0")}`;
}


