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
  type Vec3Like,
  type NarrativeWorldState,
  toTuple,
} from "./types.js";
import type { SessionStorage } from "./session-storage.js";
import { WorldMapManager } from "../world-map/world-map.js";
import type { WorldMap } from "../world-map/types.js";

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

  private nextEventSeq = 0;
  private dirty = false;

  constructor(private storage: SessionStorage) {}

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
    this.nextEventSeq = 0;
    this.dirty = true;
    return this.session_id;
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
    this.world = data.world;
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
    this.nextEventSeq = data._next_event_seq ?? data.dialogue_history.length;
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
  ): void {
    this.scenes_loaded[sceneId] = {
      scene_data: sceneData,
      loaded_at: nowIso(),
      asset_refs: assetRefs,
    };
    this.world.active_scene_id = sceneId;
    this.player.current_scene_id = sceneId;
    const placeId = typeof sceneData.place_id === "string" ? sceneData.place_id : sceneId;
    if (this.worldMap.get(placeId)) {
      this.worldMap.attachRealizedScene(placeId, sceneId);
      this.worldMap.markVisited(placeId);
      this.worldMap.setActivePlace(placeId);
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
        npcs.push({ id: e.id, name: e.name, pos: [col, 0, row] });
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
      _next_event_seq: this.nextEventSeq,
    };
  }

  serializeForLlm(): LlmContext {
    const recent = this.dialogue_history.slice(-5).map((d) => {
      let chosen = "";
      if (d.chosen_index >= 0 && d.chosen_index < d.choices.length) {
        const c = d.choices[d.chosen_index];
        chosen = typeof c === "string" ? c : c?.text ?? "";
      }
      return { speaker: d.speaker, chosen, free_text: d.free_text };
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
    };
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
