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
import type { SessionWriter } from "./session-storage.js";
import { WorldMapManager } from "../world-map/world-map.js";
import type { Edge } from "../world-map/types.js";
import { neighborTile, tileKey, type TileCoord } from "../scene/tile.js";
import { computeTileEdges } from "../scene/tile-edges.js";
import type { PluginRecord, PluginManifest, PluginOrigin } from "../plugins/types.js";
import { computePluginId } from "../plugins/hash.js";
import { ExpandedSceneSchema } from "../contract/model-io/scene-schema.js";
import type { ZodError } from "zod";
import { buildLlmContext } from "./serialize-llm.js";
import { registerSceneNpcs } from "./npc-records.js";

export type AssetValidator = (hash: string) => Promise<boolean>;
export type LoadWarningSink = (source: string, message: string) => void;

/** Dónde vive la partida AHORA MISMO.
 *
 *  - `sin_sesion`: no hay ninguna. `save()` con esto es un bug del caller.
 *  - `provisional`: existe en memoria y en NINGÚN otro sitio. Es el estado del
 *    arranque entero —el motor generando, el mundo llegando, el jugador
 *    vistiéndose— y de la sesión efímera de la pre-generación de mundos.
 *    `save()` no escribe: la puerta del disco está cerrada.
 *  - `en_disco`: el jugador ENTRÓ (`establecer()`), o la partida se cargó de
 *    un save que ya existía (`loadSession()`). A partir de ahí `save()`
 *    escribe como siempre.
 *
 *  Que la puerta esté cerrada hasta `establecer()` es lo que convierte «el ack
 *  llega antes de la primera escritura» en un HECHO en vez de en una carrera:
 *  no hay nada que sincronizar, y lo acumulado durante la ventana provisional
 *  (el world map del bootstrap, las escenas del snapshot) viaja entero dentro
 *  de esa primera escritura, porque `save()` serializa el estado COMPLETO. */
type Existencia = "sin_sesion" | "provisional" | "en_disco";

/** Lo que el RUNTIME sabe del jugador y el save no puede saber solo: dónde
 *  está y cuánta vida le queda AHORA MISMO. Durante la partida eso vive en el
 *  combatiente del sim, no aquí. */
export interface PlayerRuntime {
  position: Vec3Like;
  health: number;
}

/** Fuente del runtime del jugador, ATADA al save (`bindPlayerRuntime`).
 *  Devolver `null` no es un error: es «no hay jugador vivo» (el título, el
 *  bootstrap antes de sembrar el sim), y entonces se conserva lo persistido —
 *  un save no puede empeorar por guardarse. */
export type PlayerRuntimeSource = () => PlayerRuntime | null;

/** Lo que el RUNTIME sabe de un combatiente que NO es el jugador: dónde está
 *  y cuánta vida le queda, sobre cuánta. Es el mismo hecho que `PlayerRuntime`
 *  con dos diferencias que importan: hay N y traen su denominador (el del
 *  jugador vive en el store del cliente). */
export interface CombatantRuntime {
  id: string;
  position: Vec3Like;
  health: number;
  maxHealth: number;
}

/** Fuente del runtime de los combatientes, ATADA al save
 *  (`bindCombatantRuntime`). Hermana de `PlayerRuntimeSource` y por el mismo
 *  motivo: sin ella el save solo sabía con cuánta vida NACE un enemigo. */
export type CombatantRuntimeSource = () => CombatantRuntime[] | null;

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
  // `model_id: ""` = NINGUNA elección: el cliente cae a su base (y_bot) sin
  // sondear ni loguear. Un id concreto aquí afirmaría una elección que nadie
  // hizo — el que hubo (un octavo modelo fantasma) no estaba ni en el
  // desplegable ni en disco (#216), y duplicar el BASE_MODEL del cliente
  // dentro de core sería una segunda copia de esa verdad.
  appearance: { model_id: "", skin_path: "" },
  position: [0.0, 1.0, 0.0],
  current_scene_id: "",
};

/** El primer issue del zod, en el idioma de quien mira una escena rota:
 *  nombra la escena, la entity (si el defecto vive en una, con su id) y el
 *  campo. Lo usan las DOS puertas del save (#334): la escritura
 *  (`recordSceneLoaded`) y la carga (`loadSession`). */
function describeSceneContractViolation(
  sceneId: string,
  sceneData: Record<string, unknown>,
  error: ZodError,
): string {
  const issue = error.issues[0];
  const path = issue.path;
  let donde = "";
  if (path[0] === "entities" && typeof path[1] === "number") {
    const ents = Array.isArray(sceneData.entities)
      ? (sceneData.entities as Array<{ id?: unknown } | null>)
      : [];
    const rawId = ents[path[1]]?.id;
    const id = typeof rawId === "string" && rawId ? `"${rawId}"` : `#${path[1]}`;
    const campo = path.slice(2).join(".");
    donde = `, entity ${id}${campo ? `, campo \`${campo}\`` : ""}`;
  } else if (path.length > 0) {
    donde = `, campo \`${path.join(".")}\``;
  }
  return `la escena "${sceneId}"${donde} viola el contrato de escena cargable: ${issue.message}`;
}

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
  /** La puerta del disco. Privada y SIN setter público: las únicas
   *  transiciones son las cuatro de abajo (startNewSession, loadSession,
   *  establecer, deleteSession/descartarProvisional). */
  private existencia: Existencia = "sin_sesion";
  /** Fuente del runtime del jugador de ESTA sesión (ver bindPlayerRuntime).
   *  No se persiste: es la atadura con el sim, no un campo del save. */
  private playerRuntime: PlayerRuntimeSource | null = null;
  /** Fuente del runtime de los COMBATIENTES de esta sesión (ver
   *  bindCombatantRuntime). No se persiste, como la del jugador: es la
   *  atadura con el sim, no un campo del save. */
  private combatantRuntime: CombatantRuntimeSource | null = null;
  /** Índice en memoria tileKey → sceneId (reconstruido en load, actualizado en
   *  recordSceneLoaded). No se persiste: se deriva de scenes_loaded[].tile. */
  private tileIndex = new Map<string, string>();

  constructor(private storage: SessionWriter) {}

  /** ¿La partida existe ya como fichero? Lo lee el handler del ack para no
   *  volver a establecer lo que un resume ya trajo del disco. */
  get enDisco(): boolean {
    return this.existencia === "en_disco";
  }

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

  /** Ata (o suelta, con `null`) la fuente del runtime del jugador.
   *
   *  `save()` tira de ella ANTES de serializar, así que la frescura viaja con
   *  el OBJETO y no con la llamada: quien guarda no tiene que acordarse de
   *  refrescar nada, y el save número catorce —el que alguien escriba mañana
   *  en un handler nuevo— nace fresco igual que los trece de hoy. Antes esto
   *  era un snapshot manual en UN handler de guardado explícito, el único que
   *  lo hacía, y el mensaje que lo disparaba no lo mandaba nadie: la posición
   *  y la vida del jugador no se persistían JAMÁS (issue #245).
   *
   *  La atadura pertenece a una sesión concreta: `startNewSession` y
   *  `loadSession` la sueltan, porque cambiar de identidad deja al runtime
   *  atado hablando de una partida que ya no es esta. Quien siembra el sim la
   *  vuelve a atar (`reseedSimForSession` en el bridge): sembrar y atar son el
   *  mismo acto. */
  bindPlayerRuntime(src: PlayerRuntimeSource | null): void {
    this.playerRuntime = src;
  }

  /** Lo mismo para los COMBATIENTES, y por eso vive pegada a la de arriba: es
   *  la misma atadura con un sujeto más.
   *
   *  Hasta #326 el único runtime que el save conocía era el del jugador, y el
   *  de un enemigo no lo persistía nadie: `SessionData` no tiene campo de
   *  enemigos y `data.combat` del ledger llevaba el valor DERIVADO (60
   *  constante). Reanudar te devolvía enteros a los que habías herido y VIVOS
   *  a los que habías matado — el ledger no tiene muerte, así que toda
   *  rehidratación resucita mientras la vida no viaje.
   *
   *  La pone y la quita SOLO `bridge/world-claim.ts`, en el mismo acto que la
   *  del jugador y por la misma razón medida: el día que la atadura sobrevivió
   *  a su dueño, el `state.json` de una partida acabó con las coordenadas del
   *  muñeco de una fixture dentro (`arch-rules.json` →
   *  `la-atadura-del-save-vive-con-el-dueno-del-mundo`). */
  bindCombatantRuntime(src: CombatantRuntimeSource | null): void {
    this.combatantRuntime = src;
  }

  /** Vuelca el runtime vivo sobre `player` justo antes de serializar. Sin
   *  fuente atada (o sin jugador vivo) se conserva lo persistido. */
  private refreshPlayerFromRuntime(): void {
    const live = this.playerRuntime?.();
    if (!live) return;
    this.player.position = toTuple(live.position);
    this.player.health = live.health;
    if (this.world.active_scene_id) this.player.current_scene_id = this.world.active_scene_id;
  }

  /** Vuelca el runtime vivo de los combatientes sobre sus `EntityRecord`,
   *  también justo antes de serializar.
   *
   *  LA MUERTE ES ABSORBENTE: un record que ya está a 0 no vuelve a subir,
   *  diga lo que diga la fuente. Eso es lo que hace PERMANENTE la decisión del
   *  usuario (2026-08-31) y lo que impide que el `respawn()` del sim —que cura
   *  a TODOS los enemigos, `game-loop.ts`— deshaga una muerte ya guardada:
   *  tras morir y pulsar R, el sim vuelve a decir 60 y el save sigue diciendo
   *  0, que es lo que el jugador se encontrará al reanudar.
   *
   *  Un combatiente sin registro en el ledger se DICE y no se traga: significa
   *  que alguien dio de alta en el sim a alguien que el motor no conoce, y su
   *  vida no se va a guardar. */
  private refreshCombatantsFromRuntime(): void {
    const vivos = this.combatantRuntime?.();
    if (!vivos) return;
    for (const c of vivos) {
      const rec = this.entities.find((e) => e.id === c.id);
      if (!rec) {
        console.warn(
          `[narrative-state] combatiente "${c.id}" sin registro en el ledger — ` +
            `su vida no se guarda (¿alta en el sim de alguien que el motor no puso?)`,
        );
        continue;
      }
      const previo = rec.data.combat;
      const bloque =
        typeof previo === "object" && previo !== null && !Array.isArray(previo)
          ? (previo as Record<string, unknown>)
          : {};
      if (typeof bloque.health === "number" && bloque.health <= 0) continue;
      rec.data.combat = { ...bloque, health: c.health, max_health: c.maxHealth };
      rec.position = toTuple(c.position);
    }
  }

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
    // La sesión anterior se llevó su runtime: quien siembre el sim de ESTA
    // volverá a atarlo. Sin esto, el primer save de la partida nueva
    // escribiría la posición del jugador de la vieja.
    this.playerRuntime = null;
    this.combatantRuntime = null;
    // Nace SOLO en memoria (#279). Un arranque que falla después del `ok` no
    // deja nada en `saves/`: no hay partida que borrar porque no llegó a
    // haberla.
    this.existencia = "provisional";
    this.dirty = true;
    return this.session_id;
  }

  /** El jugador ha ENTRADO en la partida: se ha vestido Y el mundo está
   *  pintado. Es la ÚNICA transición de `provisional` a `en_disco`, y guarda
   *  como último acto —sin ningún `await` entremedias— para que «existe» y
   *  «está escrita» no puedan separarse ni un tick.
   *
   *  Quién puede llamarla lo canda `arch-rules.json`
   *  (`la-partida-se-establece-donde-el-jugador-entra`): TypeScript no sabe
   *  decir «este método solo se llama desde el handler del ack».
   *
   *  Idempotente sobre una partida que ya existe (un resume vuelve a
   *  anunciarse): entonces es un guardado normal. */
  async establecer(): Promise<void> {
    if (!this.session_id) {
      throw new Error("NarrativeState.establecer: no hay sesión que establecer");
    }
    this.existencia = "en_disco";
    await this.save();
  }

  /** Tira una sesión que nunca llegó a existir (la efímera de la
   *  pre-generación de mundos: su artefacto es el snapshot del mundo, no el
   *  save). No toca el disco porque no hay nada que tocar; lo que hace es
   *  soltar la IDENTIDAD, que es lo que leen `handleLoadRoom` (¿hay partida?),
   *  el 409 del State API y las rutas de documento. Lanza sobre una partida
   *  que sí existe: esa se borra con `deleteSession`, y confundirlas dejaría
   *  al bridge apuntando a la nada con el save vivo. */
  descartarProvisional(): void {
    if (this.existencia === "en_disco") {
      throw new Error(
        `NarrativeState.descartarProvisional: la sesión ${this.session_id} existe en disco ` +
          `— se borra con deleteSession, no se descarta`,
      );
    }
    this.session_id = "";
    this.existencia = "sin_sesion";
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

  /** Carga un save. Canal de error DISTINGUIBLE por construcción:
   *  `false` = el save NO EXISTE, y punto; un save que existe pero no vale
   *  (versión vieja, escena que viola el contrato) LANZA nombrando save y
   *  motivo. Colapsar los dos en `false` era el descarte silencioso que #334
   *  vino a cerrar. Las migraciones murieron con #336 (pre-producción: un
   *  save viejo se borra, no se arrastra). */
  async loadSession(sessionId: string, opts?: LoadSessionOptions): Promise<boolean> {
    const data = await this.storage.read(sessionId);
    if (!data) return false;
    if (data.schema_version !== SCHEMA_VERSION) {
      throw new Error(
        `save "${sessionId}" incompatible: schema_version ${data.schema_version} ≠ ${SCHEMA_VERSION} — ` +
          "pre-producción, sin migraciones (#336): bórralo o empieza partida nueva",
      );
    }
    // El contrato se comprueba ANTES de mutar `this`: un throw a medias
    // dejaría la sesión que estaba cargada hecha una quimera de las dos.
    // Es la puerta de #334-A: el save con `footprint:[8,8]` en un kind móvil
    // (el caso #300) cargaba, se conservaba y el NPC se pintaba a 1,75 m de
    // donde el sim lo tenía.
    for (const [sceneId, rec] of Object.entries(data.scenes_loaded)) {
      const parsed = ExpandedSceneSchema.safeParse(rec.scene_data);
      if (!parsed.success) {
        throw new Error(
          `save "${sessionId}": ${describeSceneContractViolation(sceneId, rec.scene_data, parsed.error)}`,
        );
      }
    }
    // Mismo motivo que en startNewSession: el runtime atado era de la sesión
    // que estaba cargada, no de la que se está cargando.
    this.playerRuntime = null;
    this.combatantRuntime = null;
    // Viene de un fichero: existe. Reanudar no necesita ack de nadie.
    this.existencia = "en_disco";
    this.session_id = data.session_id;
    this.game_id = data.game_id;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
    // Spread sobre defaults: convención ADITIVA declarada (no migración) —
    // un campo nuevo sin bump de schema cae a su default en saves v5 previos.
    this.world = { ...DEFAULT_WORLD, ...data.world };
    // Ídem para player: un save sin un campo aditivo dejaría undefined en la
    // aritmética de los plugins (inc/dec sobre player.gold → NaN, push a
    // inventory → crash). Mismo criterio aditivo que world.
    this.player = { ...structuredClone(DEFAULT_PLAYER), ...data.player };
    this.story_so_far = data.story_so_far;
    this.scenes_loaded = data.scenes_loaded;
    this.entities = data.entities;
    this.dialogue_history = data.dialogue_history;
    this.asset_index_snapshot = data.asset_index_snapshot;
    this.worldMap = new WorldMapManager(data.world_map);
    this.plugins = data.plugins;
    // Campos aditivos (sin bump de schema): saves previos no los traen.
    this.ambient_log = data.ambient_log ?? [];
    this.scheduled_events = data.scheduled_events ?? [];
    this.nextEventSeq = data._next_event_seq ?? data.dialogue_history.length;
    this.nextSchedSeq = data._next_sched_seq ?? this.scheduled_events.length;
    this.rebuildTileIndex();
    this.dirty = false;
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

  /** Persiste la partida — si existe.
   *
   *  `escrito: false` NO es un error: es «la partida aún no ha empezado», un
   *  estado del diseño (#279). Los doce sitios que guardan no tienen por qué
   *  saber en qué fase está el arranque; el único que mira el resultado es
   *  quien le prometió algo al jugador (el cambio de modo de render), para no
   *  contestarle `ok` sobre algo que no se escribió.
   *
   *  Sin sesión LANZA, como `appendSceneAssetRefs`: guardar sin partida es un
   *  caller roto, no un estado. Hoy eso salía mudo con un `false` que nadie
   *  miraba. */
  async save(): Promise<{ escrito: boolean }> {
    if (!this.session_id) {
      throw new Error("NarrativeState.save: no hay sesión que guardar");
    }
    if (this.existencia !== "en_disco") return { escrito: false };
    this.refreshPlayerFromRuntime();
    this.refreshCombatantsFromRuntime();
    this.updated_at = nowIso();
    const payload = this.toSessionData();
    await this.storage.write(this.session_id, payload);
    this.dirty = false;
    return { escrito: true };
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return this.storage.list();
  }

  /** Borra un save Y suelta la sesión activa si era esa.
   *
   *  Es lo que hace que este método exista y no se llame directamente a
   *  `storage.delete`: hasta #365, `handleDeleteSession` se lo saltaba, así
   *  que borrar el save de la partida en curso dejaba `session_id` colgando de
   *  un directorio que ya no existe. Devuelve el desenlace tal cual —quien
   *  decide qué se le cuenta al jugador es el borde— y sigue LANZANDO en
   *  EACCES/EBUSY. */
  async deleteSession(sessionId: string): Promise<"deleted" | "not_found"> {
    const resultado = await this.storage.delete(sessionId);
    if (resultado === "deleted" && sessionId === this.session_id) {
      this.session_id = "";
      this.existencia = "sin_sesion";
    }
    return resultado;
  }

  // ── Recording mutations ──

  recordSceneLoaded(
    sceneId: string,
    sceneData: Record<string, unknown>,
    assetRefs: string[] = [],
    opts: { activate?: boolean } = {},
  ): void {
    // La puerta de ESCRITURA (#334): todo lo que entra en `scenes_loaded` es
    // población EXPANDIDA (los 5 callers de producción expanden antes), así
    // que su gate es `ExpandedSceneSchema`. Sin él, lo inválido se persistía
    // en el save y volvía en cada resume — el estado corrupto de #300.
    const gate = ExpandedSceneSchema.safeParse(sceneData);
    if (!gate.success) {
      throw new Error(
        `recordSceneLoaded: ${describeSceneContractViolation(sceneId, sceneData, gate.error)}`,
      );
    }
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

  // Aquí vivía `recordEntityDespawned`, que borraba una entity del ledger por
  // id. Se va con #326 y no vuelve: nunca tuvo un llamante de producción, y
  // esta tanda decide lo CONTRARIO — un muerto SE QUEDA en el ledger con vida
  // 0, que es lo que hace que el resume sepa que no vuelve y que el motor
  // pueda narrar que lo mataste. Borrarlo sería volver a un ledger sin muerte,
  // donde toda rehidratación resucita.

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

  /** Como `getPluginRecord`, pero siguiendo la dirección que dejó una
   *  migración: un id que fue de este sistema resuelve al record de ahora
   *  (`PluginRecord.superseded_ids`).
   *
   *  Es DELIBERADO que sea otra función y no una caída dentro de
   *  `getPluginRecord`: quien pregunta «¿existe este manifest exacto?»
   *  —`registerRuntimePlugin` para decidir si un registro es un no-op— tiene
   *  que seguir viendo que NO, o volver a mandar el manifest v1 después de
   *  migrar pasaría por idempotente en vez de por la degradación que es.
   *  Aquí se resuelve la IDENTIDAD DEL SISTEMA; allí, la del manifest. */
  resolvePluginRecord(id: string): PluginRecord | undefined {
    return (
      this.getPluginRecord(id) ?? this.plugins.find((p) => p.superseded_ids?.includes(id))
    );
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
    assertManifestMatchesId("addPlugin", record.id, record.manifest);
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
    assertManifestMatchesId("migratePluginRecord", next.id, next.manifest);
    if (next.id !== oldId) {
      // La dirección anterior, para que lo que ya tuviera escrito el id viejo
      // (map triggers del save, memoria del motor) siga encontrando el sistema.
      record.superseded_ids = [...(record.superseded_ids ?? []), oldId];
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

/** El manifest embebido de un record TIENE que ser el de su id (el id es su
 *  hash). Si no, el record dice una versión y sirve las reglas de otra, y eso
 *  no se nota hasta el resume siguiente: todos los asserts de id/version/slice
 *  pasan en verde. Se comprueba en las DOS puertas de escritura —`addPlugin` y
 *  `migratePluginRecord`—; la de lectura la guarda `bindPluginsForResume`. */
function assertManifestMatchesId(
  metodo: string,
  id: string,
  manifest: PluginManifest | null | undefined,
): void {
  if (!manifest) return;
  const hash = computePluginId(manifest);
  if (hash === id) return;
  throw new Error(
    `NarrativeState.${metodo}: el manifest embebido (v${manifest.version}, ` +
      `hash ${hash.slice(0, 12)}…) no es el del id ${id.slice(0, 12)}… — ` +
      `el record serviría reglas de otra versión en el próximo resume`,
  );
}
