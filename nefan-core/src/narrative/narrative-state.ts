/** Persistent narrative state for the open-world RPG.
 *
 * Mirrors the schema of godot/scripts/autoloads/narrative_state.gd. Persistence
 * is delegated to a SessionStorage implementation (filesystem in Node, could
 * be IndexedDB in the browser if a client ever runs the state itself).
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
  type SessionMetadata,
  type TileAnalysisRecord,
  type Vec3Like,
  type NarrativeWorldState,
  toTuple,
} from "./types.js";
import type { SessionStorage } from "./session-storage.js";
import { WorldMapManager } from "../world-map/world-map.js";
import type { Edge, WorldMap } from "../world-map/types.js";
import { TILE_CELLS, TILE_MPC, neighborTile, tileKey, tileWorldRect, type TileCoord } from "../scene/tile.js";
import { computeTileEdges } from "../scene/tile-edges.js";
import { expandScenePrimitives } from "../scene/scene-expand.js";
import type { PluginRecord, PluginManifest } from "../plugins/types.js";
import { buildPluginLlmViews } from "../plugins/views.js";

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
  perspective: "",
  render_mode: "",
  combat_system: "",
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

  private nextEventSeq = 0;
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

  /** Registra el análisis de imagen de un tile (mundo derivado de la imagen):
   *  lo que la visión clasificó sobre lo realmente pintado. Devuelve false si
   *  el tile no existe (el cliente analizó un tile que el bridge no registró
   *  — p. ej. fixture local); el caller decide loguear. */
  setTileAnalysis(tx: number, ty: number, analysis: TileAnalysisRecord): boolean {
    const rec = this.getTile(tx, ty);
    if (!rec) return false;
    rec.analysis = analysis;
    this.dirty = true;
    return true;
  }

  /** Persiste el plan de un tile (arte del suelo y/o volúmenes) tras el
   *  retoque de visión — o lo estampa como revisado sin cambios. Los campos
   *  llegan ya sanitizados por el handler. Devuelve false si el tile no
   *  existe. */
  setTileMapPlan(
    tx: number,
    ty: number,
    plan: { map_ground?: string; volumes?: unknown[] },
  ): boolean {
    const rec = this.getTile(tx, ty);
    if (!rec) return false;
    if (plan.map_ground !== undefined) rec.scene_data.map_ground = plan.map_ground;
    if (plan.volumes !== undefined) rec.scene_data.volumes = plan.volumes;
    // Marca de revisado: el pipeline del cliente no re-revisa en resume.
    rec.scene_data.map_plan_reviewed = true;
    this.dirty = true;
    return true;
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
    this.nextEventSeq = 0;
    this.tileIndex.clear();
    this.dirty = true;
    return this.session_id;
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
    perspective: string;
    render_mode: string;
    combat_system: string;
  }): void {
    this.world.name = info.name;
    this.world.description = info.description;
    this.world.style_id = info.style_id;
    this.world.style_token = info.style_token;
    this.world.world_doc_hash = info.world_doc_hash;
    this.world.perspective = info.perspective;
    this.world.render_mode = info.render_mode;
    this.world.combat_system = info.combat_system;
    this.dirty = true;
  }

  /** Migración v3→v4: envuelve la escena ACTIVA (Format D expandido, centrada
   *  en el origen) como tile (0,0): el grid viejo se re-muestrea como
   *  terrain_patch centrado (escala mpc/0.5), las entities se re-celdan con el
   *  mismo offset, y los EntityRecord de esa escena pasan a posición global.
   *  Las demás escenas quedan legacy (TravelPanel). */
  private migrateActiveSceneToTile(): void {
    const oldId = this.world.active_scene_id;
    const rec = oldId ? this.scenes_loaded[oldId] : undefined;
    if (!rec || rec.scene_data.tile !== undefined) return;
    const old = rec.scene_data;
    const size = old.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
    const oldGrid = old.terrain;
    if (!size || typeof size.cols !== "number" || typeof size.rows !== "number" || !Array.isArray(oldGrid)) {
      console.warn(`NarrativeState: escena activa "${oldId}" no es Format D — se deja como legacy`);
      return;
    }
    const cols = size.cols;
    const rows = size.rows;
    const mpc = size.meters_per_cell ?? 2;
    const scale = Math.round(mpc / TILE_MPC); // 0.5→1, 1→2, 2→4
    if (scale < 1 || cols * scale > TILE_CELLS || rows * scale > TILE_CELLS) {
      console.warn(`NarrativeState: escena activa "${oldId}" no cabe en un tile — se deja como legacy`);
      return;
    }
    const colOff = Math.floor((TILE_CELLS - cols * scale) / 2);
    const rowOff = Math.floor((TILE_CELLS - rows * scale) / 2);

    // Grid viejo re-muestreado (cada celda vieja → scale×scale celdas nuevas).
    const patchRows: string[] = [];
    for (let r = 0; r < rows; r++) {
      const row = typeof oldGrid[r] === "string" ? (oldGrid[r] as string) : "g".repeat(cols);
      let expanded = "";
      for (let c = 0; c < cols; c++) expanded += (row[c] ?? "g").repeat(scale);
      for (let k = 0; k < scale; k++) patchRows.push(expanded);
    }

    const entities = Array.isArray(old.entities)
      ? (old.entities as Record<string, unknown>[]).map((e) => {
          const cell = e.cell as [number, number] | undefined;
          const fp = (e.footprint as [number, number] | undefined) ?? [1, 1];
          if (!Array.isArray(cell)) return { ...e };
          return {
            ...e,
            cell: [colOff + cell[0] * scale, rowOff + cell[1] * scale],
            footprint: [Math.max(1, (fp[0] ?? 1) * scale), Math.max(1, (fp[1] ?? 1) * scale)],
          };
        })
      : [];

    const tileScene = expandScenePrimitives({
      tile: { tx: 0, ty: 0 },
      scene_id: tileKey(0, 0),
      scene_description: old.scene_description ?? old.room_description ?? "",
      biome: "grass",
      terrain_patches: [{ at: [colOff, rowOff], rows: patchRows }],
      terrain_legend: old.terrain_legend ?? {},
      entities,
      ambient_event: old.ambient_event ?? "",
      place_id: old.place_id,
    });

    delete this.scenes_loaded[oldId];
    // Los spawns dinámicos de la escena vieja (react_to_player…) migran de
    // escena y a posición global (celda vieja → mundo, que con el tile (0,0)
    // centrado es la misma posición física de siempre).
    const halfW = (cols * mpc) / 2;
    const halfD = (rows * mpc) / 2;
    for (const e of this.entities) {
      if (e.scene_id !== oldId) continue;
      e.scene_id = tileKey(0, 0);
      if (e.spawn_reason !== "scene_init") {
        const [c, , r] = e.position;
        e.position = [(c + 0.5) * mpc - halfW, 0, (r + 0.5) * mpc - halfD];
      }
    }
    // Re-registro completo bajo la clave de tile (recalcula NPCs en global).
    this.recordSceneLoaded(tileKey(0, 0), tileScene, rec.asset_refs);
    // El place que apuntaba a la escena vieja pasa a apuntar al tile.
    for (const place of Object.values(this.worldMap.map.places)) {
      if (place.realized_scene_id === oldId) place.realized_scene_id = tileKey(0, 0);
    }
    console.log(`NarrativeState: save v3 migrado — escena "${oldId}" → ${tileKey(0, 0)}`);
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
    this.player = data.player;
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
    this.nextEventSeq = data._next_event_seq ?? data.dialogue_history.length;
    // Migración v3→v4: la escena activa se envuelve como tile (0,0) del plano
    // continuo. Con el tile centrado en el origen las posiciones mundo no
    // cambian (el jugador y los NPC no se mueven).
    if (data.schema_version < 4) {
      this.migrateActiveSceneToTile();
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
    this.registerSceneNpcs(sceneId, sceneData);
    this.dirty = true;
  }

  /** Pull the NPCs declared in a scene into `entities`, so the narrative engine
   *  sees them in its context (serializeForLlm) and can react when the player
   *  talks to one. Without this the entities list is empty and every
   *  interact_entity / dialogue choice comes back with 0 consequences. */
  private registerSceneNpcs(sceneId: string, sceneData: Record<string, unknown>): void {
    // Re-entering a cached scene must not duplicate its NPCs.
    this.entities = this.entities.filter(
      (e) => !(e.scene_id === sceneId && e.spawn_reason === "scene_init"),
    );
    // En tiles la posición registrada es GLOBAL (metros del plano continuo);
    // en escenas legacy se conserva el histórico (celdas locales).
    const rawTile = sceneData.tile as { tx?: number; ty?: number } | undefined;
    const rect = rawTile && Number.isInteger(rawTile.tx) && Number.isInteger(rawTile.ty)
      ? tileWorldRect(rawTile.tx!, rawTile.ty!)
      : null;
    const npcs: Array<{ id: string; name: string; pos: [number, number, number] }> = [];

    // Format D (open-world scenes): entities[] with kind "npc", cell [col,row].
    const fdEntities = sceneData.entities;
    if (Array.isArray(fdEntities)) {
      for (let i = 0; i < fdEntities.length; i++) {
        const ent = fdEntities[i];
        if (!ent || typeof ent !== "object") continue;
        const e = ent as Record<string, unknown>;
        if (e.kind !== "npc") continue;
        if (typeof e.id !== "string" || !e.id) {
          throw new Error(`scene ${sceneId}.entities[${i}] kind=npc missing string id`);
        }
        if (typeof e.name !== "string" || !e.name) {
          throw new Error(`scene ${sceneId}.entities[${i}] (npc ${e.id}) missing string name`);
        }
        if (!Array.isArray(e.cell) || e.cell.length < 2) {
          throw new Error(`scene ${sceneId}.entities[${i}] (npc ${e.id}) missing cell [col,row]`);
        }
        const col = e.cell[0];
        const row = e.cell[1];
        if (typeof col !== "number" || !Number.isFinite(col) ||
            typeof row !== "number" || !Number.isFinite(row)) {
          throw new Error(
            `scene ${sceneId}.entities[${i}] (npc ${e.id}) cell must be finite numbers, got [${col}, ${row}]`,
          );
        }
        // Centro del footprint (los NPC suelen ser 1×1, pero los migrados de
        // saves v3 escalan su footprint con el re-muestreo).
        const fp = Array.isArray(e.footprint) ? (e.footprint as [number, number]) : [1, 1];
        const fw = typeof fp[0] === "number" && fp[0] > 0 ? fp[0] : 1;
        const fh = typeof fp[1] === "number" && fp[1] > 0 ? fp[1] : 1;
        npcs.push({
          id: e.id,
          name: e.name,
          pos: rect
            ? [rect.minX + (col + fw / 2) * TILE_MPC, 0, rect.minZ + (row + fh / 2) * TILE_MPC]
            : [col, 0, row],
        });
      }
    }

    // Legacy scenes: npcs[] with {id, name, position}.
    const legacyNpcs = sceneData.npcs;
    if (Array.isArray(legacyNpcs)) {
      for (let i = 0; i < legacyNpcs.length; i++) {
        const ent = legacyNpcs[i];
        if (!ent || typeof ent !== "object") continue;
        const e = ent as Record<string, unknown>;
        if (typeof e.id !== "string" || !e.id) {
          throw new Error(`scene ${sceneId}.npcs[${i}] missing string id`);
        }
        if (typeof e.name !== "string" || !e.name) {
          throw new Error(`scene ${sceneId}.npcs[${i}] (${e.id}) missing string name`);
        }
        if (!Array.isArray(e.position) || e.position.length < 3) {
          throw new Error(`scene ${sceneId}.npcs[${i}] (${e.id}) missing position [x,y,z]`);
        }
        const [x, y, z] = e.position;
        if (typeof x !== "number" || !Number.isFinite(x) ||
            typeof y !== "number" || !Number.isFinite(y) ||
            typeof z !== "number" || !Number.isFinite(z)) {
          throw new Error(
            `scene ${sceneId}.npcs[${i}] (${e.id}) position must be finite numbers, got [${x},${y},${z}]`,
          );
        }
        npcs.push({ id: e.id, name: e.name, pos: [x, y, z] });
      }
    }

    for (const npc of npcs) {
      this.recordEntitySpawned(
        npc.id,
        "npc",
        sceneId,
        { x: npc.pos[0], y: npc.pos[1], z: npc.pos[2] },
        { name: npc.name },
        "scene_init",
      );
    }
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
  ): void {
    this.entities.push({
      id: entityId,
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

  /** Registra un plugin activado (génesis F3 o plugin_register F5). Id
   *  duplicado es un bug del caller — fail-loud. */
  addPlugin(record: PluginRecord): void {
    if (this.getPluginRecord(record.id)) {
      throw new Error(`NarrativeState.addPlugin: id duplicado ${record.id}`);
    }
    this.plugins.push(record);
    this.dirty = true;
  }

  /** Sustituye un PluginRecord migrado (F7, §7.3 "Evolución"): nuevo
   *  id/version/slice del manifest evolucionado, preservando name/origin/
   *  activated_at. Tras esto el save refleja la versión nueva y los próximos
   *  resume casan por id sin re-migrar. */
  migratePluginRecord(
    oldId: string,
    next: { id: string; version: number; slice: unknown },
  ): void {
    const record = this.getPluginRecord(oldId);
    if (!record) {
      throw new Error(`NarrativeState.migratePluginRecord: plugin desconocido ${oldId}`);
    }
    if (next.id !== oldId && this.getPluginRecord(next.id)) {
      throw new Error(`NarrativeState.migratePluginRecord: id destino duplicado ${next.id}`);
    }
    record.id = next.id;
    record.version = next.version;
    record.slice = next.slice;
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
      _next_event_seq: this.nextEventSeq,
    };
  }

  /** @param manifests resolutor de manifests de los plugins activos (el
   *   `activePlugins` del bridge). Sin él, sólo se proyectan los plugins cuyo
   *   manifest está embebido en el record (los generados por IA). */
  serializeForLlm(manifests?: Map<string, PluginManifest>): LlmContext {
    const recent = this.dialogue_history.slice(-10).map((d) => {
      let chosen = "";
      if (d.chosen_index >= 0 && d.chosen_index < d.choices.length) {
        const c = d.choices[d.chosen_index];
        chosen = typeof c === "string" ? c : c?.text ?? "";
      }
      // Los eventos de dialogue_choice llegan del bridge con el texto elegido
      // en `text` y choices vacías — sin este fallback el motor recibía
      // chosen: "" y no sabía qué había elegido el jugador.
      if (!chosen && d.free_text === "" && d.text) chosen = d.text;
      // La réplica del NPC vive en las consequences del evento; sin exponerla
      // el motor no recuerda lo que el propio NPC dijo hace 2 turnos.
      const reply = d.narrative_consequences.find(
        (c): c is Extract<Consequence, { type: "dialogue" }> => c.type === "dialogue",
      );
      return {
        speaker: d.speaker,
        chosen,
        free_text: d.free_text,
        ...(reply
          ? {
              npc_reply:
                reply.text.length > 300 ? `${reply.text.slice(0, 300)}…` : reply.text,
            }
          : {}),
      };
    });
    return {
      session_id: this.session_id,
      game_id: this.game_id,
      world: this.world,
      player: this.player,
      story_so_far: this.story_so_far,
      current_scene_id: this.world.active_scene_id,
      entities: this.entities.map((e) => ({
        id: e.id,
        type: e.type,
        name: typeof e.data.name === "string" ? e.data.name : undefined,
        scene_id: e.scene_id,
        position: e.position,
        spawn_reason: e.spawn_reason,
      })),
      recent_dialogues: recent,
      rooms_visited: Object.keys(this.scenes_loaded).length,
      ...this.activeSceneAnalysisForLlm(),
      ...(this.plugins.length
        ? {
            plugins: buildPluginLlmViews(
              {
                plugins: this.plugins,
                world: this.world,
                player: this.player,
                entities: this.entities,
              },
              manifests,
            ),
          }
        : {}),
    };
  }

  // ── Internals ──

  /** Resumen compacto del análisis de imagen del tile ACTIVO para el LLM
   *  (máx 20 elementos como strings legibles) — el mapa REAL pintado, que
   *  puede incluir estructuras que no están en el esquema. */
  private activeSceneAnalysisForLlm(): Pick<LlmContext, "scene_analysis"> {
    const rec = this.scenes_loaded[this.world.active_scene_id];
    const analysis = rec?.analysis;
    if (!analysis || analysis.elements.length === 0) return {};
    const fmt = (n: number): string => String(Math.round(n));
    const elements = analysis.elements.slice(0, 20).map((e) => {
      const traits = [e.solid ? "sólido" : "", e.tall ? "alto" : ""].filter(Boolean).join(", ");
      return `${e.label}${traits ? ` (${traits})` : ""} ` +
        `x[${fmt(e.rect.minX)}..${fmt(e.rect.maxX)}] z[${fmt(e.rect.minZ)}..${fmt(e.rect.maxZ)}]`;
    });
    return {
      scene_analysis: {
        scene_id: this.world.active_scene_id,
        elements,
        total: analysis.elements.length,
      },
    };
  }

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

/** Build a minimal WorldMap from a pre-v2 SessionData. Each loaded scene
 * becomes an "interior" place under the root, and the active scene becomes
 * the active place. */
function migrateWorldMapFromV1(data: SessionData): WorldMap {
  const map = WorldMapManager.createEmpty(data.world?.name || "Mundo");
  const mgr = new WorldMapManager(map);
  const scenes = data.scenes_loaded ?? {};
  for (const sceneId of Object.keys(scenes)) {
    mgr.upsertPlace({
      id: sceneId,
      kind: "interior",
      parent_id: map.root_id,
      name: sceneId,
      realized_scene_id: sceneId,
      visited: true,
    });
  }
  const active = data.world?.active_scene_id;
  if (active && map.places[active]) {
    map.active_place_id = active;
  }
  return map;
}
