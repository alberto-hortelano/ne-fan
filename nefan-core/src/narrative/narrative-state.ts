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
    this.nextEventSeq = 0;
    this.dirty = true;
    return this.session_id;
  }

  async loadSession(sessionId: string): Promise<boolean> {
    const data = await this.storage.read(sessionId);
    if (!data) return false;
    if (data.schema_version !== SCHEMA_VERSION) {
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
    this.nextEventSeq = data._next_event_seq ?? data.dialogue_history.length;
    this.dirty = false;
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
    this.dirty = true;
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

function nowIso(): string {
  return new Date().toISOString();
}

function generateSessionId(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rnd = Math.floor(Math.random() * 0xffffff);
  return `${ts}-${rnd.toString(16).padStart(6, "0")}`;
}
