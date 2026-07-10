/** Never Ending Fantasy — 2D top-down HTML client.
 *  Dual mode: connects to nefan-core bridge (WebSocket) or falls back to local simulation. */

import type { Vec3, EffectiveParams } from "@nefan-core/src/types.js";
import { distance, sub } from "@nefan-core/src/vec3.js";
import { getEffectiveParams, loadConfig } from "@nefan-core/src/combat/combat-data.js";
import { combatRegistry } from "@nefan-core/src/combat/registry.js";
import type { AttackSpec } from "@nefan-core/src/combat/combat-system.js";
import { formatDToWorld } from "@nefan-core/src/scene/scene-normalize.js";
import {
  composeBlueprint,
  deriveVolumesFromSchema,
  parseVolumes,
  type Volume,
} from "@nefan-core/src/scene/blueprint/index.js";
import { createTerrainCollider, type TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { TileStore, tileKey, tileWorldRect, type TileClientState } from "./world/tile-store.js";
import { FrontierManager, type Edge as FrontierEdge } from "./world/frontier.js";
import { CanvasRenderer, type ComposedTilePlan, type Entity } from "./renderer/canvas-renderer.js";
import { viewProjectionFor } from "./renderer/projection.js";
import { SceneImageController } from "./scene/scene-image.js";
import { applyReviewFixes, reviewTileBlueprint, type ReviewDeps } from "./scene/review.js";
import {
  CollisionSystem,
  applyPlanCollision,
  applyTileAnalysis,
  type DerivedCollisionDeps,
} from "./world/collision.js";
import { AutoImagePipeline, type PipelineStatus } from "./scene/auto-pipeline.js";
import { SpriteRenderer } from "./renderer/sprite-renderer.js";
import {
  BASE_ANIMS,
  BASE_MODEL,
  CharacterSpriteManager,
  newAnimState,
  type CharacterAnimState,
} from "./renderer/character-sprites.js";
import { AssetCache } from "./renderer/asset-cache.js";
import { BridgeClient } from "./net/bridge-client.js";
import { NarrativeClient } from "./net/narrative-client.js";
import { TitleScreen, type TitleAction } from "./ui/title-screen.js";
import { HistoryBrowser } from "./ui/history-browser.js";
import { inputRegistry } from "./input/registry.js";
import type { InputProvider } from "./input/input-provider.js";
import { DevToolsInput } from "./input/dev-tools-input.js";
import { ScriptedInputProvider } from "./input/scripted-input-provider.js";
import { DialoguePanel } from "./ui/dialogue-panel.js";
import { TravelPanel, type SceneExit } from "./ui/travel-panel.js";
import { errors } from "./ui/error-log.js";
import {
  createGameClient,
  type GameClient,
  type FrameResult,
  type RoomEnemy,
} from "./net/game-client.js";

import combatConfigJson from "@nefan-core/data/combat_config.json";
import { CONFIG } from "@nefan-core/src/config.js";

// Glob import all open-world scene JSONs (lazy) — Vite feature.
// El concepto sala se ha retirado del cliente HTML: estos fixtures definen
// escenarios exteriores con elementos planos por categoría.
const sceneModules: Record<string, () => Promise<{ default: Record<string, unknown> }>> =
  (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<{ default: Record<string, unknown> }>> })
    .glob("@nefan-core/data/scenes/**/*.json");

const playerCfg = (combatConfigJson as Record<string, unknown>).player as Record<string, number> | undefined ?? {};
// La vista cenital 2D necesita un ritmo más arcade que el walk_speed realista
// (1.9 m/s) que comparte el Godot 3D en tercera persona. Multiplicador propio
// del cliente 2D para no alterar el config compartido (rompería el feel 3D).
const TOPDOWN_SPEED_SCALE = 2.2;
const SPEED = (playerCfg.walk_speed ?? 3.0) * TOPDOWN_SPEED_SCALE;
const SPRINT_SPEED = (playerCfg.sprint_speed ?? 5.5) * TOPDOWN_SPEED_SCALE;

/** Player visual state. When CONFIG.graphics.character_sprites is false the
 *  player is drawn as a coloured circle and playerModel stays null. When
 *  true, setPlayerAppearance resolves the base model (y_bot salvo que el
 *  elegido tenga el set completo en disco) y encola su skin IA. */
let playerModel: string | null = null;
let playerSkinPrompt = "";
let playerAlive = true;
const playerAnim: CharacterAnimState = newAnimState();

/** Resolve the player's visual base and queue its AI skin.
 *
 *  - CONFIG.graphics.character_sprites === false → does nothing. The renderer
 *    draws a circle and that's the contract.
 *  - character_sprites === true → la base es y_bot (obligatoria, fail-loud
 *    vía baseSheetsReady). Si `modelId` tiene el set COMPLETO de sheets en
 *    disco, sustituye a y_bot; si no, se usa la base (ya no es un error:
 *    el skin IA es la vía canónica de personalización).
 *  - CONFIG.graphics.ai_skin === false but skinPrompt is non-empty → throws.
 *    Caller asked for something the config does not allow. */
async function setPlayerAppearance(modelId: string, skinPrompt: string): Promise<void> {
  if (!CONFIG.graphics.character_sprites) {
    if (skinPrompt) {
      const msg = `appearance.skin_path="${skinPrompt}" requires graphics.character_sprites=true`;
      errors.push("config", msg);
      throw new Error(msg);
    }
    playerModel = null;
    playerSkinPrompt = "";
    return;
  }

  await baseSheetsReady;

  let base = BASE_MODEL;
  if (modelId && modelId !== BASE_MODEL) {
    try {
      // Secuencial y abortando al primer fallo: un modelo sin sheets solo
      // genera UNA entrada en el error-log (la del fetch), no diez.
      for (const anim of BASE_ANIMS) {
        await spriteRenderer.loadAnimation(modelId, anim, WORLD_ANGLE);
      }
      base = modelId;
    } catch {
      log(`modelo "${modelId}" sin sheets completos — base ${BASE_MODEL}`);
    }
  }

  playerModel = base;
  playerSkinPrompt = skinPrompt;
  playerAnim.anim = "idle";
  playerAnim.animStartedAt = performance.now();

  if (skinPrompt) {
    if (!CONFIG.graphics.ai_skin) {
      const msg = `appearance.skin_path="${skinPrompt}" requires graphics.ai_skin=true`;
      errors.push("config", msg);
      throw new Error(msg);
    }
    // Generación progresiva en background: cada anim sustituye a la base
    // y_bot cuando su sheet skinneado está listo (modelFor por frame).
    characterSprites.requestSkin(skinPrompt);
    log(`skin IA encolada: ${skinPrompt.slice(0, 40)}`);
  }
}

const config = loadConfig(combatConfigJson);

// --- DOM elements ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const WORLD_ANGLE = "isometric_30";
// Override de bench (simétrico a `?bridge=`): `?ai=http://127.0.0.1:18765`
// apunta imagen/assets/auto-img a un ai_server alternativo (mock).
const AI_SERVER_URL =
  new URLSearchParams(location.search).get("ai") ?? "http://127.0.0.1:8765";
const spriteRenderer = new SpriteRenderer("/sprites", AI_SERVER_URL);
const characterSprites = new CharacterSpriteManager(spriteRenderer, WORLD_ANGLE);
/** true cuando el set base y_bot está cargado: el gameLoop solo puebla
 *  `entity.sprite` a partir de ese momento (antes, círculos). */
let baseSheetsLoaded = false;
/** Precarga del set base y_bot — obligatorio con character_sprites=true.
 *  setPlayerAppearance espera esta promise; si falta un sheet, la sesión no
 *  arranca (fail-loud) y el error queda registrado. */
const baseSheetsReady: Promise<void> = CONFIG.graphics.character_sprites
  ? characterSprites.preloadBase().then(() => {
      baseSheetsLoaded = true;
    })
  : Promise.resolve();
baseSheetsReady.catch((err) =>
  errors.push("sprite", `set base ${BASE_MODEL} incompleto — personajes sin sprite`, err),
);
const assetCache = new AssetCache(AI_SERVER_URL);
const renderer = new CanvasRenderer(canvas, {
  spriteRenderer,
  assetCache,
  worldAngle: WORLD_ANGLE,
});
// Generación IA del fondo de escena (img2img desde el blueprint del tile).
// Manual con G en dev; el pipeline Auto-img la conduce por fases. Puramente
// visual: no toca colisiones ni SceneData.
const sceneImageController = new SceneImageController(renderer, AI_SERVER_URL);

/** Propaga el estilo visual de la sesión (world.style_id, congelado en el
 *  save) a los generadores de imagen: escena y skins de personaje. */
function applySessionStyle(styleId: string): void {
  sceneImageController.setStyle(styleId);
  spriteRenderer.setStyle(styleId);
  if (styleId) log(`Estilo visual: ${styleId}`);
}

/** Perspectiva 2D de la sesión activa ("topdown" | "isometric"), congelada
 *  en el save. Saves previos sin el campo ⇒ "topdown". La consumen el
 *  compositor de blueprints y (en PRs siguientes) el renderer/proyección. */
let sessionPerspective: "topdown" | "isometric" = "topdown";
/** Proyección de vista de la sesión — también snapea el giro del jugador a
 *  los 8 ejes de animación (ver refreshPlayerForward). */
let sessionProjection = viewProjectionFor(sessionPerspective);
function applySessionPerspective(perspective: string): void {
  sessionPerspective = perspective === "isometric" ? "isometric" : "topdown";
  sessionProjection = viewProjectionFor(sessionPerspective);
  sceneImageController.setPerspective(sessionPerspective);
  renderer.setProjection(sessionPerspective);
  refreshPlayerForward(); // los ejes de animación dependen de la perspectiva
  if (perspective) log(`Perspectiva: ${sessionPerspective}`);
}

/** Modo de render de la sesión activa, congelado en el save:
 *  - "image": el pipeline Auto-img repinta cada blueprint con el modelo de
 *    imagen (créditos) — se enciende solo al entrar en la sesión.
 *  - "vector": el mundo se juega con los blueprints compuestos; el pipeline
 *    queda apagado y la generación manual (G) bloqueada.
 *  - "" (saves previos al campo): comportamiento legacy — manda el toggle
 *    persistido en localStorage. */
let sessionRenderMode: "image" | "vector" | "" = "";
function applySessionRenderMode(renderMode: string): void {
  sessionRenderMode = renderMode === "vector" ? "vector" : renderMode === "image" ? "image" : "";
  if (sessionRenderMode === "vector") {
    autoPipeline.setEnabled(false);
    log("Gráficos: vectorial (planos del motor narrativo, sin imagen IA)");
  } else if (sessionRenderMode === "image") {
    autoPipeline.setEnabled(true);
    log("Gráficos: imagen IA (Auto-img activo)");
  }
}
// El set base y_bot se precarga arriba (baseSheetsReady) detrás del check de
// CONFIG.graphics.character_sprites; los modelos alternativos y los skins IA
// se cargan bajo demanda desde setPlayerAppearance / requestSkin.
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
const enemyBarsContainer = document.getElementById("enemy-bars") as HTMLElement;
const combatLog = document.getElementById("combat-log") as HTMLElement;
const attackSelectorEl = document.querySelector(".attack-selector") as HTMLElement;
const sceneSelector = document.getElementById("room-selector") as HTMLSelectElement;
const connectionStatus = document.getElementById("connection-status") as HTMLElement;

const dialoguePanel = new DialoguePanel();
const travelPanel = new TravelPanel();
const interactPromptEl = document.getElementById("interact-prompt") as HTMLElement;
const tileConfirmPromptEl = document.getElementById("tile-confirm-prompt") as HTMLElement;
errors.attach(document.getElementById("error-log") as HTMLElement);

// Proveedor de input (plugin): default teclado+ratón; ?input=scripted instala
// el driver programático de bench. Un id desconocido no arranca — fail-loud.
const requestedInputId = new URLSearchParams(location.search).get("input") ?? undefined;
let input: InputProvider;
try {
  input = inputRegistry.create(requestedInputId, { canvas });
} catch (err) {
  errors.push("input", `proveedor de input inválido (?input=${requestedInputId})`, err);
  throw err;
}
input.onAttackTypeChanged = (type) => {
  attackSelectorEl.querySelectorAll("span").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
};

// Teclas de desarrollo (G/X/B/N/R): fijas, independientes del provider.
const devInput = new DevToolsInput({
  isDialogueActive: () => input.dialogueActive,
  isTileProposalActive: () => input.tileProposalActive,
});

// Hook de bench (narrative_lab / pruebas de navegador): estado vivo legible
// desde la consola o la automatización. Solo lectura — no es API del juego.
(window as unknown as { __nefan?: unknown }).__nefan = {
  input,
  get playerPos() { return playerPos; },
  get scene() { return sceneData; },
  get dialogueVisible() { return dialoguePanel.isVisible; },
  get exits() { return currentExits; },
  get tiles() { return [...tileStore.entries.keys()]; },
  get tileImages() { return renderer.tileKeys.filter((k) => renderer.tileHasImage(k)); },
  get occluders() { return renderer.debugOccluders(); },
  get currentTile() { return activeTileKey; },
  get frontier() { return frontier.debugState(); },
  probeCollide(x: number, z: number) { return collidesAt(x, z); },
};

// --- Zoom (px por metro) ---
// El objetivo (zoomTarget) salta por pasos multiplicativos con la rueda/teclas;
// currentZoom lo persigue con suavizado frame-independent (mismo patrón que la
// cámara) y se aplica al renderer cada frame. Se persiste en localStorage.
const ZOOM_STEP = 1.12;   // factor por paso de rueda/tecla
const ZOOM_RATE = 12;     // velocidad de convergencia del suavizado
const ZOOM_KEY = "nefan.zoom";
function loadSavedZoom(): number {
  const raw = localStorage.getItem(ZOOM_KEY);
  const v = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(v) ? v : 40;
}
let zoomTarget = renderer.clampScale(loadSavedZoom());
let currentZoom = zoomTarget;
renderer.setScale(currentZoom);

// --- Sistema de combate de la sesión (catálogo → HUD + teclas) ---
// Espejo de applySessionPerspective: el id viene congelado en el save
// (world.combat_system); "" (sin sesión / saves previos) = estándar. El HUD
// y el mapeo 1..N se regeneran desde el catálogo que declara el sistema.
let attackCatalog: readonly AttackSpec[] = [];
/** Id efectivo del sistema de combate de la sesión ("" = sin sesión). */
let sessionCombatSystemId = "";

function applySessionCombatSystem(id: string): void {
  sessionCombatSystemId = id;
  attackCatalog = combatRegistry.create(id || undefined, config).attacks;
  attackSelectorEl.innerHTML = "";
  attackCatalog.forEach((spec, i) => {
    const span = document.createElement("span");
    span.dataset.type = spec.id;
    span.textContent = `${i + 1}:${spec.label}`;
    if (i === 0) span.classList.add("active");
    // El provider es el dueño de la selección; el click es un origen más de
    // intención y el toggle visual lo hace onAttackTypeChanged.
    span.addEventListener("click", () => input.selectAttack(spec.id));
    attackSelectorEl.appendChild(span);
  });
  input.setAttackBindings(attackCatalog.map((a) => a.id));
  if (id) log(`Combate: ${attackCatalog.length === 1 ? "básico" : id} (${attackCatalog.length} ataque${attackCatalog.length === 1 ? "" : "s"})`);
}
applySessionCombatSystem(""); // arranque sin sesión: catálogo estándar

// --- State ---
const playerPos: Vec3 = { x: 0, y: 0, z: 2 };
let playerForward: Vec3 = { x: 0, y: 0, z: -1 };
const playerMaxHp = 100;
const playerWeaponId = "short_sword";
let sceneData: Record<string, unknown> | null = null;
/** Salidas del world-map de la escena actual (las adjunta el bridge). Se usan
 *  para la transición continua al cruzar un borde. */
let currentExits: SceneExit[] = [];
/** Mundo del cliente: colección ACUMULATIVA de tiles (nunca desaparecen). */
const tileStore = new TileStore();
/** Prefetch proactivo + velo direccional de fronteras. El jugador nunca se
 *  congela: el bloqueo es solo direccional (colisión virtual del borde). */
const frontier = new FrontierManager();
/** Nombre en español del borde hacia el que se propone generar un tile. */
const EDGE_ES: Record<FrontierEdge, string> = {
  north: "norte",
  south: "sur",
  east: "este",
  west: "oeste",
};
/** Clave del tile bajo el jugador (para detectar cambio de tile activo). */
let activeTileKey: string | null = null;

// --- Auto-img: pipeline automático de imagen IA por tile ---
// Persistido en localStorage (patrón ZOOM_KEY). Ya SIN toggle visible: su
// hueco de la top bar lo ocupa Dev-cache. Se sigue controlando por
// localStorage["nefan.autoimg"] y su progreso se muestra en #autoimg-status.
const autoimgStatus = document.getElementById("autoimg-status") as HTMLElement;
const AUTOIMG_KEY = "nefan.autoimg";

function renderAutoImgStatus(s: PipelineStatus): void {
  if (s.paused) {
    autoimgStatus.textContent = `pausado: ai_server no responde · cola ${s.queued}`;
    autoimgStatus.className = "paused";
  } else if (s.current) {
    autoimgStatus.textContent = `${s.current.key} · ${s.current.phase}` +
      (s.queued > 0 ? ` · cola ${s.queued}` : "");
    autoimgStatus.className = "working";
  } else if (s.enabled) {
    autoimgStatus.textContent = "al día";
    autoimgStatus.className = "";
  } else {
    autoimgStatus.textContent = "";
    autoimgStatus.className = "";
  }
}

const autoPipeline = new AutoImagePipeline({
  hasImage: (k) => renderer.tileHasImage(k),
  listGridTileKeys: () =>
    [...tileStore.entries.values()].filter((t) => t.tx !== undefined).map((t) => t.key),
  isControllerBusy: () => sceneImageController.isBusy(),
  review: (k) => reviewTileBlueprint(k, reviewDeps),
  generate: (k) => sceneImageController.generateForTile(k),
  analyze: (k) => sceneImageController.analyzeSceneForTile(k),
  onAnalyzed: (k, a) => applyTileAnalysis(k, a, derivedCollisionDeps),
  onStatus: renderAutoImgStatus,
  onDisabled: () => {
    localStorage.setItem(AUTOIMG_KEY, "0");
  },
  healthUrl: `${AI_SERVER_URL}/health`,
});
autoPipeline.setEnabled(localStorage.getItem(AUTOIMG_KEY) === "1");

// --- Dev-cache: toggle del cache de modo dev del ai_server -----------------
// Con él activo, cada API de IA de pago (Meshy i2i, Meshy 3D, fal) devuelve
// su ÚLTIMA respuesta cacheada en vez de llamar de verdad — cero créditos
// mientras se itera. El estado vive y persiste en el ai_server
// (cache/dev_api_cache/state.json); el checkbox solo lo refleja.
const devcacheToggle = document.getElementById("devcache-toggle") as HTMLInputElement;

async function initDevCacheToggle(): Promise<void> {
  try {
    const res = await fetch(`${AI_SERVER_URL}/dev/api_cache`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const st = (await res.json()) as { enabled?: boolean };
    devcacheToggle.checked = !!st.enabled;
  } catch {
    // ai_server apagado: sin servidor no hay APIs que cachear — el toggle no
    // aplica. Deshabilitado explícitamente, no un fallback silencioso.
    devcacheToggle.disabled = true;
    devcacheToggle.parentElement!.title = "ai_server no responde — dev-cache no disponible";
  }
}
void initDevCacheToggle();

devcacheToggle.addEventListener("change", () => {
  const enabled = devcacheToggle.checked;
  void fetch(`${AI_SERVER_URL}/dev/api_cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log(`dev-cache ${enabled ? "ON — las APIs de IA sirven su última respuesta (0 créditos)" : "OFF — llamadas reales"}`);
    })
    .catch((err) => {
      devcacheToggle.checked = !enabled;
      errors.push("config", "no se pudo cambiar dev-cache en ai_server", err);
    });
});

// Entity arrays
let enemyEntities: Entity[] = [];
let objectEntities: Entity[] = [];
let npcEntities: Entity[] = [];
const ENEMY_COLORS = ["#c44", "#4a4", "#48c", "#ca4"];
let colorIdx = 0;

// --- Animación por entidad (NPCs/enemigos) ---
// La máquina de estados vive fuera de Entity: el track guarda la anim en
// curso, la última posición (para detectar movimiento — el bridge mueve a
// NPCs/enemigos, el cliente solo ve deltas de pos) y el one-shot pendiente
// disparado por eventos de combate (hit_react).
interface CharTrack {
  state: CharacterAnimState;
  lastX: number;
  lastZ: number;
  lastMovedAt: number;
  oneShot?: string;
}
const charTracks = new Map<string, CharTrack>();

function trackFor(e: Entity, now: number): CharTrack {
  let track = charTracks.get(e.id);
  if (!track) {
    track = { state: newAnimState(now), lastX: e.pos.x, lastZ: e.pos.z, lastMovedAt: 0 };
    charTracks.set(e.id, track);
  }
  return track;
}

/** Umbral de movimiento por frame (m) y ventana de gracia (ms): las pos de
 *  NPCs/enemigos llegan a ráfagas del bridge, no cada rAF — sin la ventana
 *  la anim oscilaría walk↔idle entre state_updates. */
const MOVE_EPS = 0.02;
const MOVE_GRACE_MS = 150;

function trackMoving(track: CharTrack, pos: Vec3, now: number): boolean {
  const dx = pos.x - track.lastX;
  const dz = pos.z - track.lastZ;
  if (dx * dx + dz * dz > MOVE_EPS * MOVE_EPS) track.lastMovedAt = now;
  track.lastX = pos.x;
  track.lastZ = pos.z;
  return now - track.lastMovedAt < MOVE_GRACE_MS;
}

/** Puebla `e.sprite` para este frame según el estado de la entidad. */
function updateEntitySprite(e: Entity, now: number, opts: { npc: boolean }): void {
  const track = trackFor(e, now);
  const moving = trackMoving(track, e.pos, now);
  characterSprites.updateAnim(
    track.state,
    {
      // Los NPCs no mueren: visible=false significa "se fue" (drawNpc lo
      // omite), no un cadáver.
      alive: opts.npc ? true : e.alive,
      moving,
      attacking: e.attacking,
      attackType: e.attackType,
      oneShot: track.oneShot,
      requestedAnim: opts.npc ? e.requestedAnim : undefined,
    },
    now,
  );
  track.oneShot = undefined;
  e.sprite = {
    model: characterSprites.modelFor(e.skinPrompt, track.state.anim),
    anim: track.state.anim,
    angle: WORLD_ANGLE,
    animStartedAt: track.state.animStartedAt,
  };
}

// Attack area visualization state
let attackVisual: {
  active: boolean;
  mode: "windup" | "impact";
  params: EffectiveParams;
  impactQuality: number;
  fadeTimer: number;
} | null = null;

// --- Game client (will be set async) ---
let gameClient: GameClient | null = null;

// --- Scene loading ---

function populateSceneSelector(): void {
  // Scene fixtures (cargados localmente, sin bridge).
  const scenes: { key: string; label: string }[] = [];
  for (const path of Object.keys(sceneModules)) {
    // path like "@nefan-core/data/scenes/tavern_clearing.json"
    const match = path.match(/scenes\/(.+)\.json$/);
    if (!match) continue;
    scenes.push({ key: path, label: match[1] });
  }
  if (scenes.length > 0) {
    const sceneGroup = document.createElement("optgroup");
    sceneGroup.label = "Scene";
    for (const entry of scenes.sort((a, b) => a.label.localeCompare(b.label))) {
      const opt = document.createElement("option");
      opt.value = entry.key;
      opt.textContent = entry.label;
      sceneGroup.appendChild(opt);
    }
    sceneSelector.appendChild(sceneGroup);
  }
}

/** Deps de la fase "revisión" (scene/review.ts): re-registro vía addTile y
 *  persistencia al bridge solo con sesión activa. */
const reviewDeps: ReviewDeps = {
  tileStore,
  controller: sceneImageController,
  addTile: (raw) => addTile(raw),
  reportMapPlan: (tx, ty, plan) => {
    if (activeSessionId) narrativeClient.reportMapPlan(tx, ty, plan);
  },
  log: (msg) => log(msg),
};

/** R: pide a Claude (vía ai_server + MCP) una revisión VISUAL del blueprint
 *  actual y aplica los fixes parciales que devuelva (terrain /
 *  terrain_features / entity_moves / map_ground / volumes) sobre el Format D,
 *  recargando la escena. El jugador conserva su posición (dev pre-generación). */
async function reviewBlueprintAndApply(): Promise<void> {
  const fd = (sceneData as Record<string, unknown> | null)?.__format_d as
    | Record<string, unknown>
    | undefined;
  if (!fd) {
    errors.push("scene", "review (R): la escena actual no es Format D — nada que revisar");
    return;
  }
  const entry = activeTileKey ? tileStore.entries.get(activeTileKey) : null;
  if (!entry) {
    errors.push("scene", "review (R): no hay tile activo");
    return;
  }
  // Tiles con plan (map_ground/volumes): mismo camino que la fase automática
  // (re-registro por addTile + persistencia al bridge), sin recargar el mundo.
  if ((typeof fd.map_ground === "string" || Array.isArray(fd.volumes)) && activeTileKey) {
    await reviewTileBlueprint(activeTileKey, reviewDeps);
    return;
  }
  log("blueprint → revisión por visión (Claude)…");
  const review = await sceneImageController.reviewBlueprint(fd, entry.rect);
  for (const issue of review.issues) log(`review: ${issue}`);
  if (review.approved && !review.fixes) {
    log("review: blueprint aprobado — listo para G");
    return;
  }
  if (!review.fixes) {
    log("review: rechazado sin fixes — corrige a mano o regenera la escena");
    return;
  }
  const fixed = applyReviewFixes(fd, review.fixes);
  const saved = { x: playerPos.x, z: playerPos.z };
  await loadSceneData(fixed);
  playerPos.x = saved.x;
  playerPos.z = saved.z;
  log(`review: fixes aplicados y re-renderizados (${review.issues.length} issue(s)) — R de nuevo o G`);
}

async function loadSceneFile(globKey: string): Promise<void> {
  const loader = sceneModules[globKey];
  if (!loader) {
    log("Scene not found: " + globKey);
    return;
  }

  const mod = await loader();
  await loadSceneData(mod.default);
}

/** Vacía el mundo del cliente (arranque de sesión, resume, fixtures). */
function resetWorld(): void {
  tileStore.clear();
  renderer.clearTiles();
  autoPipeline.resetQueue();
  enemyEntities = [];
  objectEntities = [];
  npcEntities = [];
  charTracks.clear();
  colorIdx = 0;
  activeTileKey = null;
  sceneData = null;
}

/** API legacy (dropdown de fixtures, change_scene, saves sin migrar): mundo de
 *  UNA escena. El flujo narrativo de tiles usa addTile (aditivo). */
async function loadSceneData(rawData: Record<string, unknown>): Promise<void> {
  resetWorld();
  await addTile(rawData);
}

/** Plan compuesto de un tile: campos del plan + blueprint proyectado. */
interface TilePlanInfo {
  map_ground?: string;
  volumes: Volume[];
  composed: ComposedTilePlan;
}

/** Compone el blueprint del tile con la perspectiva de la sesión. Los
 *  volúmenes declarados por el LLM se completan con los derivados del esquema
 *  (vegetation_zones → árboles, structures → edificios cutaway). Devuelve
 *  null en escenas legacy sin plan ni primitivas derivables. */
function composeTilePlan(
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
  key: string,
  isGridTile: boolean,
): TilePlanInfo | null {
  if (!isGridTile) return null;
  const mapGround = typeof data.map_ground === "string" ? data.map_ground : undefined;
  let declared: Volume[] = [];
  if (Array.isArray(data.volumes)) {
    const parsed = parseVolumes(data.volumes);
    if (parsed.ok) {
      declared = parsed.volumes;
    } else {
      errors.push("scene", `volumes de ${key} inválidos (${parsed.error}); se usan solo los derivados`);
    }
  }
  const derived = deriveVolumesFromSchema(
    {
      scene_id: key,
      structures: raw.structures as never,
      vegetation_zones: raw.vegetation_zones as never,
      entities: raw.entities as never,
      terrain_features: raw.terrain_features as never,
    },
    declared,
  );
  const volumes = [...declared, ...derived];
  if (!mapGround && volumes.length === 0) return null;
  const composed = composeBlueprint(
    { map_ground: mapGround, volumes, biome: typeof raw.biome === "string" ? raw.biome : undefined },
    sessionPerspective,
    key,
  );
  return {
    map_ground: mapGround,
    volumes,
    composed: {
      svg: composed.svg,
      view_box: composed.viewBox,
      elements: composed.elements,
      occluders: composed.occluders,
    },
  };
}

/** Añade un tile/escena al mundo del cliente. ADITIVO: no toca la posición del
 *  jugador (salvo bootstrap con __player_start o escenas legacy), no vacía las
 *  entidades de otros tiles, no resetea el sim. Re-añadir la misma clave
 *  sustituye (re-render al volver a un tile). */
async function addTile(rawData: Record<string, unknown>): Promise<void> {
  const data = formatDToWorld(rawData);
  const tile = data.tile as { tx: number; ty: number } | undefined;
  const isGridTile = Number.isInteger(tile?.tx) && Number.isInteger(tile?.ty);
  const key = isGridTile
    ? tileKey(tile!.tx, tile!.ty)
    : String(data.scene_id ?? data.room_id ?? "scene");
  const firstTile = tileStore.entries.size === 0;

  // Rect mundial del tile (los tiles de grid lo derivan de la geometría core;
  // las escenas legacy vienen centradas).
  const wr = data.world_rect as { minX: number; minZ: number; maxX: number; maxZ: number } | undefined;
  const dims = data.dimensions as { width: number; depth: number } | undefined;
  const rect = isGridTile
    ? tileWorldRect(tile!.tx, tile!.ty)
    : wr ?? { minX: -(dims?.width ?? 20) / 2, minZ: -(dims?.depth ?? 20) / 2, maxX: (dims?.width ?? 20) / 2, maxZ: (dims?.depth ?? 20) / 2 };

  // Colisión de terreno POR TILE (origin global desde terrain_grid.origin).
  let collider: TileClientState["collider"] = null;
  try {
    collider = createTerrainCollider(data.terrain_grid as TerrainGridData | undefined);
  } catch (err) {
    errors.push("scene", `terrain_grid inconsistente en ${key}; colisión de terreno desactivada`, err);
  }
  // Plan del tile → blueprint COMPUESTO con la perspectiva de la sesión.
  // Los volumes del LLM se completan con los derivados del esquema
  // (vegetación, estructuras); el compositor es determinista (mismo plan ⇒
  // mismos bytes ⇒ hit de la caché de imagen en resume).
  const planInfo = composeTilePlan(rawData, data as Record<string, unknown>, key, isGridTile);
  if (planInfo) {
    (data as Record<string, unknown>).__plan = planInfo;
    (data as Record<string, unknown>).__composed = planInfo.composed;
  }

  const prevEntry = tileStore.entries.get(key);
  tileStore.add({
    key,
    tx: isGridTile ? tile!.tx : undefined,
    ty: isGridTile ? tile!.ty : undefined,
    rect,
    scene: data as Record<string, unknown>,
    collider,
    // El análisis de imagen (colisión derivada) se instala después vía
    // applyTileAnalysis; se restaura abajo si la escena no cambió. La base
    // del map_svg se deriva async justo debajo.
    imageCollider: null,
    imageAnalyzed: false,
    svgCollider: null,
    svgApplied: false,
  });
  const { sceneChanged } = renderer.addTile(
    key,
    data as unknown as Parameters<typeof renderer.setScene>[0],
  );
  // Re-registro con la MISMA escena (resume, re-broadcast): el renderer
  // preserva la imagen y su análisis visual — conservar también la colisión
  // derivada. Con escena distinta la imagen se invalida y se re-analiza.
  if (prevEntry?.imageAnalyzed && !sceneChanged) {
    tileStore.markAnalyzed(key, prevEntry.imageCollider);
  }
  // Colisión base del plan: restaurar si la escena no cambió; derivar
  // (async, ~ms) si es nueva o cambió. Agua del map_ground + huellas de
  // volumes — espacio de mundo, idéntica en ambas perspectivas.
  const plan = (data as { __plan?: TilePlanInfo }).__plan;
  if (prevEntry?.svgApplied && !sceneChanged) {
    tileStore.setSvgCollider(key, prevEntry.svgCollider);
  } else if (plan) {
    void applyPlanCollision(key, { map_ground: plan.map_ground, volumes: plan.volumes }, rect, derivedCollisionDeps);
  }
  // Auto-img: encolar el tile si le falta imagen (o si su escena cambió con
  // una generación en vuelo — se marca dirty y se regenera con el esquema
  // nuevo). Cubre bootstrap, frontier, re-broadcast y resume.
  if (isGridTile) autoPipeline.notifyTile(key, { invalidated: sceneChanged });

  // Posición de entrada — SOLO escenas legacy o el bootstrap (primer tile con
  // spawn explícito). En el resto de tiles el jugador entra andando.
  const playerStart = data.__player_start as { x: number; z: number } | null | undefined;
  if (!isGridTile) {
    if (playerStart) {
      playerPos.x = playerStart.x;
      playerPos.z = playerStart.z;
    } else {
      playerPos.x = 0;
      playerPos.z = 2;
    }
  } else if (firstTile && playerStart) {
    playerPos.x = playerStart.x;
    playerPos.z = playerStart.z;
  }

  // Purga entidades previas de esta clave (re-render de un tile ya visto) y
  // extrae enemigos/objetos/NPCs con posiciones GLOBALES.
  const inRect = (p: Vec3) => p.x >= rect.minX && p.x < rect.maxX && p.z >= rect.minZ && p.z < rect.maxZ;
  const objects = (data.objects ?? []) as Record<string, unknown>[];
  const ids = new Set(objects.map((o) => o.id as string));
  const npcIds = new Set(((data.npcs ?? []) as Record<string, unknown>[]).map((n) => n.id as string));
  enemyEntities = enemyEntities.filter((e) => !ids.has(e.id) && !inRect(e.pos));
  objectEntities = objectEntities.filter((o) => !ids.has(o.id) && !inRect(o.pos));
  npcEntities = npcEntities.filter((n) => !npcIds.has(n.id) && !inRect(n.pos));
  const enemies: RoomEnemy[] = [];

  for (const obj of objects) {
    const pos: Vec3 = {
      x: (obj.position as number[])[0],
      y: (obj.position as number[])[1],
      z: (obj.position as number[])[2],
    };
    const scale = (obj.scale as number[] | undefined);
    const sizeXZ = scale && scale.length >= 3
      ? { x: scale[0], z: scale[2] }
      : undefined;
    const category = obj.category as string | undefined;
    const shape = obj.shape as string | undefined;
    const combat = obj.combat as Record<string, unknown> | undefined;
    if (combat) {
      // Combat block exists → every field is required. The narrative engine
      // sets these explicitly; missing values mean the LLM produced a broken
      // combat record, not a place to default-fill.
      if (typeof combat.health !== "number" || !Number.isFinite(combat.health)) {
        throw new Error(`scene object ${obj.id} combat.health must be a finite number, got ${combat.health}`);
      }
      if (typeof combat.weapon_id !== "string" || !combat.weapon_id) {
        throw new Error(`scene object ${obj.id} combat.weapon_id missing`);
      }
      const personality = combat.personality as Record<string, unknown> | undefined;
      if (!personality || typeof personality !== "object") {
        throw new Error(`scene object ${obj.id} combat.personality missing`);
      }
      const requireNum = (key: string): number => {
        const v = personality[key];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new Error(`scene object ${obj.id} combat.personality.${key} must be a finite number, got ${v}`);
        }
        return v;
      };
      const attacks = personality.preferred_attacks;
      if (!Array.isArray(attacks) || attacks.length === 0 ||
          !attacks.every((a) => typeof a === "string")) {
        throw new Error(`scene object ${obj.id} combat.personality.preferred_attacks must be a non-empty string array`);
      }
      enemies.push({
        id: obj.id as string,
        position: pos,
        health: combat.health,
        weaponId: combat.weapon_id,
        personality: {
          aggression: requireNum("aggression"),
          preferred_attacks: attacks as string[],
          reaction_time: requireNum("reaction_time"),
          combat_range: requireNum("combat_range"),
          ...personality,
        },
      });
      const color = ENEMY_COLORS[colorIdx++ % ENEMY_COLORS.length];
      const enemyPrompt = (obj.description ?? obj.id) as string;
      const enemyEntity: Entity = {
        id: obj.id as string, pos, radius: 8, color,
        label: enemyPrompt,
        hp: combat.health as number, maxHp: combat.health as number, alive: true,
        category: category ?? "creature",
        sizeXZ,
        skinPrompt: enemyPrompt,
      };
      characterSprites.requestSkin(enemyPrompt);
      enemyEntities.push(enemyEntity);
    } else {
      const objectEntity: Entity = {
        id: obj.id as string, pos, radius: 5,
        color: category === "item" ? "#aa8" : "#666",
        label: (obj.description ?? "") as string, alive: true,
        category: category ?? "prop",
        sizeXZ,
        shape,
      };
      objectEntities.push(objectEntity);
    }
  }

  // NPCs from room data (append: los de otros tiles siguen vivos)
  const npcsData = (data.npcs ?? []) as Record<string, unknown>[];
  const newNpcs = npcsData.map(npc => {
    const npcPrompt = (npc.description ?? npc.name ?? npc.id) as string;
    const entity: Entity = {
      id: npc.id as string,
      pos: {
        x: (npc.position as number[])?.[0] ?? 0,
        y: (npc.position as number[])?.[1] ?? 0,
        z: (npc.position as number[])?.[2] ?? 0,
      },
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color: "#68c",
      label: (npc.name ?? npc.id) as string,
      name: (npc.name ?? npc.id) as string,
      alive: true,
      category: "creature",
      skinPrompt: npcPrompt,
    };
    characterSprites.requestSkin(npcPrompt);
    return entity;
  });
  npcEntities.push(...newNpcs);

  // Fail-loud del contrato de posiciones globales: una entidad de un tile de
  // grid FUERA de su rect delata una conversión celda→mundo rota.
  if (isGridTile) {
    for (const e of [...newNpcs, ...enemyEntities.filter((en) => ids.has(en.id))]) {
      if (!inRect(e.pos)) {
        errors.push("scene", `entidad "${e.id}" de ${key} fuera de su rect: (${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)})`);
      }
    }
  }

  // Build enemy HP bars
  rebuildEnemyBars();

  // Activación visual del primer tile / escena legacy (el resto de tiles se
  // activa por POSICIÓN en gameLoop al pisarlos).
  if (firstTile || !isGridTile) {
    setActiveClientTile(key);
  } else if (key === activeTileKey) {
    // Re-render del tile activo (resume/re-broadcast): refrescar el puntero.
    setActiveClientTile(key);
  }

  // Sim: los tiles de grid añaden combatientes de forma ADITIVA (sin reset);
  // las escenas legacy (fixtures) siguen reseteando la sala entera.
  if (gameClient) {
    if (isGridTile) {
      gameClient.addEnemies(enemies);
    } else {
      gameClient.loadRoom(data, key, enemies);
    }
  }

  log("Scene loaded: " + key);
}

/** Apunta la "escena activa" del cliente (imagen IA, exits, TravelPanel) al
 *  tile bajo el jugador. */
function setActiveClientTile(key: string): void {
  const entry = tileStore.entries.get(key);
  if (!entry) return;
  activeTileKey = key;
  sceneData = entry.scene;
  renderer.setActiveTile(key);
  currentExits = (entry.scene.exits ?? []) as SceneExit[];
  travelPanel.setExits(currentExits);
}

function rebuildEnemyBars(): void {
  enemyBarsContainer.innerHTML = "";
  for (const ee of enemyEntities) {
    const bar = document.createElement("div");
    bar.className = "hp-bar";
    bar.innerHTML = `<span style="color:${ee.color}">${ee.id}</span>
      <div class="hp-fill"><div class="hp-fill-inner" id="hp-${ee.id}" style="width:100%;background:${ee.color}"></div></div>
      <span id="hp-text-${ee.id}">${ee.maxHp}</span>`;
    enemyBarsContainer.appendChild(bar);
  }
}

// --- Collision (lógica en world/collision.ts; aquí solo el cableado) ---
const collision = new CollisionSystem({
  tileStore,
  getPlayerPos: () => playerPos,
  getObstacles: () => objectEntities,
});
const collidesAt = (x: number, z: number): boolean => collision.collidesAt(x, z);

/** Deps de los instaladores de colisión derivada (svg/análisis): espejo
 *  visual en el renderer + reporte al bridge solo con sesión activa (los
 *  fixtures locales no tienen dónde persistir). */
const derivedCollisionDeps: DerivedCollisionDeps = {
  tileStore,
  setTileSvgGrid: (key, grid) => renderer.setTileSvgGrid(key, grid),
  setTileAnalysisGrid: (key, grid) => renderer.setTileAnalysis(key, grid),
  reportAnalysis: (tx, ty, elements) => {
    if (activeSessionId) narrativeClient.reportTileAnalysis(tx, ty, elements);
  },
};

// --- Combat log ---
function log(msg: string): void {
  const line = document.createElement("div");
  line.textContent = msg;
  combatLog.prepend(line);
  while (combatLog.children.length > 8) combatLog.lastChild?.remove();
}

/** Último error de render registrado — dedup para no inundar el ErrorLog a
 *  60 fps con la misma excepción. */
let lastRenderError = "";

// Hook de bench (solo dev): estado vivo para los drivers E2E de Chrome —
// permite verificar movimiento/colisión sin depender de leer píxeles.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as Record<string, unknown>).__nefan = {
    state: () => ({
      pos: { ...playerPos },
      forward: { ...playerForward },
      input: { ...input.state },
      dialogueActive: input.dialogueActive,
      perspective: sessionPerspective,
      combatSystem: sessionCombatSystemId,
      attackCatalog: attackCatalog.map((a) => a.id),
      blocked: {
        n: collidesAt(playerPos.x, playerPos.z - 0.5),
        s: collidesAt(playerPos.x, playerPos.z + 0.5),
        w: collidesAt(playerPos.x - 0.5, playerPos.z),
        e: collidesAt(playerPos.x + 0.5, playerPos.z),
      },
    }),
    occluders: () => renderer.debugOccluders(),
    npcs: () => npcEntities.map((n) => ({ id: n.id, label: n.label, pos: { ...n.pos } })),
    // Gira al jugador desde el bench a un yaw arbitrario, sin pasar por las
    // flechas de dirección. Mismo camino que el giro real: yaw → snap.
    setYaw: (yaw: number) => {
      playerYaw = yaw;
      refreshPlayerForward();
    },
    // Driver programático del provider "scripted" (?input=scripted) — API
    // limpia para el bench en vez de sintetizar KeyboardEvents.
    inputDriver: input instanceof ScriptedInputProvider ? input : undefined,
  };
}

// --- Orientación con flechas de dirección ---
let playerYaw = Math.PI; // facing -Z initially

/** El giro NO es libre: las flechas fijan un yaw objetivo, pero el forward
 *  efectivo (facing del sprite Y marco del WASD relativo) se snapea al eje de
 *  ANIMACIÓN más cercano de los 8 — sprite y desplazamiento coinciden
 *  siempre. En isométrica los ejes diagonales son los ejes X/Z del mundo:
 *  andar en diagonal sigue las líneas de la cuadrícula sin desvío. */
function refreshPlayerForward(): void {
  const [fx, fz] = sessionProjection.snapForwardToAxis(Math.sin(playerYaw), Math.cos(playerYaw));
  playerForward = { x: fx, y: 0, z: fz };
}

/** Flechas = direcciones de PANTALLA (↑ mira hacia arriba del canvas, se
 *  combinan en diagonales). Se pasan a dirección de MUNDO con la proyección
 *  de la sesión (viewToWorld es lineal, vale para vectores): en topdown
 *  coinciden; en isométrica ↑ apunta al noroeste del mundo, etc. */
function applyTurnKeys(): void {
  let vx = 0, vy = 0;
  if (input.state.turnUp) vy -= 1;
  if (input.state.turnDown) vy += 1;
  if (input.state.turnLeft) vx -= 1;
  if (input.state.turnRight) vx += 1;
  if (vx === 0 && vy === 0) return;
  const [wx, wz] = sessionProjection.viewToWorld(vx, vy);
  playerYaw = Math.atan2(wx, wz);
  refreshPlayerForward();
}

// El pointer lock se conserva para atacar con LMB (y ocultar el cursor);
// el ratón ya NO orienta al personaje.
canvas.addEventListener("click", () => {
  if (!dialoguePanel.isVisible) {
    canvas.requestPointerLock();
  }
});

// --- Utility ---

function getSelectedParams(): EffectiveParams {
  const type = input.state.selectedAttack;
  if (config.attack_types[type]) {
    const weaponData = config.weapons[playerWeaponId] ?? config.weapons["unarmed"];
    return getEffectiveParams(type, config.attack_types, weaponData);
  }
  // Ataques fuera de combat_config.json (p.ej. "strike" del combate básico):
  // params sintéticos desde el catálogo — solo alimentan el feedback visual
  // del aro de ataque (el daño real lo resuelve el sistema en el bridge).
  const spec = attackCatalog.find((a) => a.id === type);
  if (!spec) {
    throw new Error(`getSelectedParams: attack '${type}' is neither in combat_config nor in the session catalog`);
  }
  return {
    optimal_distance: spec.displayRange / 2,
    distance_tolerance: spec.displayRange / 2, // el aro cubre [0, displayRange]
    area_radius: spec.displayRange,
    base_damage: 0,
    damage_reduction: 0,
    wind_up_time: 0,
  };
}

// --- Dialogue callbacks ---

dialoguePanel.onAdvanced = () => {
  input.dialogueActive = false;
};

// --- Scene selector handler ---

sceneSelector.addEventListener("change", () => {
  const value = sceneSelector.value;
  if (!value) return;
  loadSceneFile(value);
});

// --- Respawn ---

/** R (one-shot del provider): revive al player si está muerto. La condición
 *  de negocio vive aquí; el provider solo transporta la intención. */
function handleRespawnRequest(): void {
  const p = gameClient?.getCombatant("player");
  if (!p || p.health > 0) return;
  // Punto libre cercano: la posición actual si no colisiona; si no, el
  // centro del tile actual; último recurso, el origen legacy.
  let rp = { x: playerPos.x, y: 0, z: playerPos.z };
  if (collidesAt(rp.x, rp.z)) {
    const under = tileStore.getAt(playerPos.x, playerPos.z);
    rp = under
      ? { x: (under.rect.minX + under.rect.maxX) / 2, y: 0, z: (under.rect.minZ + under.rect.maxZ) / 2 }
      : { x: 0, y: 0, z: 2 };
  }
  gameClient?.respawn(rp);
  playerPos.x = rp.x;
  playerPos.z = rp.z;
  log("Respawned!");
}

// --- Connection status UI ---

function updateConnectionStatus(connected: boolean, isBridge: boolean): void {
  if (isBridge && connected) {
    connectionStatus.textContent = "Bridge";
    connectionStatus.className = "connected";
  } else if (isBridge) {
    connectionStatus.textContent = "Disconnected";
    connectionStatus.className = "disconnected";
  } else {
    connectionStatus.textContent = "Local";
    connectionStatus.className = "disconnected";
  }
}

// --- Game Loop ---

let lastTime = performance.now();
// Evita reenviar interact_entity mientras el motor narrativo aún responde.
let interactCooldownUntil = 0;

// Chrome congela requestAnimationFrame en pestañas ocultas (document.hidden),
// lo que pausa la simulación entera — un problema real para testing
// automatizado y para partidas desatendidas con el bridge. Fallback: cuando la
// pestaña está oculta el loop sigue con setTimeout a ~15 fps (render barato,
// la simulación usa delta real); al volver a ser visible retoma rAF.
function scheduleNextFrame(): void {
  if (document.hidden) {
    setTimeout(() => gameLoop(performance.now()), 66);
  } else {
    requestAnimationFrame(gameLoop);
  }
}

function gameLoop(now: number): void {
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (!gameClient) {
    scheduleNextFrame();
    return;
  }



  // Zoom: aplica la intención de rueda/teclas al objetivo (pasos multiplicativos,
  // clampados por el renderer) y persigue el objetivo con suavizado exponencial
  // frame-independent. Centrado en el jugador automáticamente (el offset de la
  // cámara se recomputa desde scale alrededor del player cada frame).
  const zd = input.consumeZoomDelta();
  if (zd !== 0) {
    zoomTarget = renderer.clampScale(zoomTarget * Math.pow(ZOOM_STEP, zd));
    localStorage.setItem(ZOOM_KEY, String(Math.round(zoomTarget)));
  }
  if (Math.abs(currentZoom - zoomTarget) > 0.01) {
    currentZoom += (zoomTarget - currentZoom) * (1 - Math.exp(-ZOOM_RATE * delta));
    renderer.setScale(currentZoom);
  }

  // R: respawn (solo surte efecto con el player muerto).
  if (input.consumeRespawn()) handleRespawnRequest();

  // Generación IA del escenario (dev): G regenera la imagen del tile ACTIVO
  // desde su esquema. Async fire-and-forget — el controlador ya loguea fallos
  // a ErrorLog; el .catch evita unhandled rejection.
  if (devInput.consumeGenerateScene()) {
    if (sessionRenderMode === "vector") {
      log("G ignorada: la partida es vectorial (elegido al crearla)");
    } else if (activeTileKey) void sceneImageController.generateForTile(activeTileKey).catch(() => {});
  }
  // X analiza la imagen del tile activo (mundo derivado de la imagen):
  // auto-segmentación + clasificación por visión → occluders (tall) y
  // colisión derivada (solid). Requiere imagen previa (G/auto).
  if (devInput.consumeSegmentScene()) {
    if (activeTileKey) {
      const k = activeTileKey;
      void sceneImageController.analyzeSceneForTile(k)
        .then((a) => applyTileAnalysis(k, a, derivedCollisionDeps))
        .catch(() => {});
    }
  }
  // B alterna el overlay de colisión (esquema, derivada de imagen, recortes)
  // sobre la escena, para juzgar la precisión del análisis.
  if (devInput.consumeToggleCollisionDebug()) {
    const on = renderer.toggleDebugCollision();
    console.log(`[debug] collision overlay ${on ? "ON" : "OFF"}`);
  }
  // N (descubrimiento) quedó integrada en el análisis completo de X.
  if (devInput.consumeDiscoverObjects()) {
    errors.push("scene", "N está integrada en X (análisis completo del tile) — usa X");
  }
  // R = Revisión por visión del blueprint (Claude vía MCP) ANTES de gastar
  // créditos con G. Aplica los fixes que devuelva y re-renderiza. Opt-in:
  // requiere terminal de Claude Code escuchando; si no, el error va al log.
  if (devInput.consumeReviewBlueprint()) {
    void reviewBlueprintAndApply().catch(() => {});
  }

  // Movement (suppressed during dialogue). El jugador NUNCA se congela por la
  // generación de mundo: la frontera bloquea solo direccionalmente.
  if (dialoguePanel.isVisible) {
    // El diálogo suspende la propuesta de tile (sus teclas Y/N quedan mudas).
    input.tileProposalActive = false;
    tileConfirmPromptEl.style.display = "none";
  }
  if (!dialoguePanel.isVisible) {
    applyTurnKeys();

    let inputFwd = 0, inputRight = 0;
    if (input.state.up) inputFwd += 1;
    if (input.state.down) inputFwd -= 1;
    if (input.state.right) inputRight += 1;
    if (input.state.left) inputRight -= 1;

    const speed = input.state.sprint ? SPRINT_SPEED : SPEED;
    if (inputFwd !== 0 || inputRight !== 0) {
      // WASD RELATIVO al personaje (Souls-like, como el cliente 3D): las
      // flechas orientan (playerYaw) y las teclas se expresan en su marco —
      // W avanza hacia donde mira, S camina DE ESPALDAS, A/D son strafe
      // lateral. El movimiento nunca toca la orientación: por eso se puede
      // retroceder o desplazarse de lado sin dejar de encarar al enemigo.
      // Se renormaliza para que la diagonal no sea más rápida.
      // playerForward está SNAPEADO a los 8 ejes de animación
      // (refreshPlayerForward) y las combinaciones de teclas bisecan ejes
      // adyacentes (45°), así que TODA dirección de desplazamiento cae en uno
      // de los 8 ejes — en isométrica, o sobre las líneas de la cuadrícula
      // (diagonales de pantalla) o de vértice a vértice (horizontal/vertical).
      const rx = -playerForward.z; // right = forward rotado 90° horario
      const rz = playerForward.x;
      const mx = playerForward.x * inputFwd + rx * inputRight;
      const mz = playerForward.z * inputFwd + rz * inputRight;
      const mlen = Math.hypot(mx, mz) || 1;
      const dx = (mx / mlen) * speed * delta;
      const dz = (mz / mlen) * speed * delta;
      // Resolución por ejes contra objetos sólidos → desliza por las paredes.
      // Si el ORIGEN ya es sólido (save antiguo dentro de una huella que hoy
      // bloquea), el movimiento se permite: puede salir, nunca queda atrapado.
      const stuck = collidesAt(playerPos.x, playerPos.z);
      if (stuck || !collidesAt(playerPos.x + dx, playerPos.z)) playerPos.x += dx;
      if (stuck || !collidesAt(playerPos.x, playerPos.z + dz)) playerPos.z += dz;
    }

    // Frontera del plano: al acercarse a un borde sin tile se PROPONE generar
    // el vecino (gasta LLM/créditos — el jugador confirma con Y o rechaza con
    // N), velo direccional pegado al borde, promoción a blocking si espera.
    if (activeSessionId && tileStore.hasGridTiles) {
      const requestTile = (tx: number, ty: number, edge: FrontierEdge, reason: "prefetch" | "blocking"): void =>
        narrativeClient.requestTile(tx, ty, reason, edge);
      const { veil, timedOut, proposal } = frontier.tick(
        performance.now(),
        playerPos.x,
        playerPos.z,
        tileStore,
        requestTile,
      );
      renderer.setEdgeLoading(veil?.edge ?? null, veil?.text ?? "");
      for (const key of timedOut) {
        errors.push("narrative", `El tile ${key} no llegó a tiempo (timeout); se reintentará al acercarse.`);
      }
      input.tileProposalActive = proposal !== null;
      if (proposal) {
        tileConfirmPromptEl.innerHTML =
          `¿Explorar hacia el ${EDGE_ES[proposal.edge]}? Se generará una zona nueva — <b>[Y]</b> sí · <b>[N]</b> no`;
        tileConfirmPromptEl.style.display = "block";
        if (input.consumeTileConfirm()) {
          frontier.confirmProposal(performance.now(), requestTile);
          log(`Generando la zona al ${EDGE_ES[proposal.edge]} (${proposal.key})...`);
        } else if (input.consumeTileDecline()) {
          frontier.declineProposal();
        }
      } else {
        tileConfirmPromptEl.style.display = "none";
      }
    } else {
      input.tileProposalActive = false;
      tileConfirmPromptEl.style.display = "none";
    }

    // Activación por posición: al pisar otro tile, refrescar la "escena
    // activa" del cliente (imagen IA, exits). El bridge hace lo propio con
    // NarrativeState en su handler de input.
    const under = tileStore.getAt(playerPos.x, playerPos.z);
    if (under && under.key !== activeTileKey) {
      setActiveClientTile(under.key);
    }
  }

  // NPC interaction — NPC vivo más cercano dentro de rango + tecla E.
  const INTERACT_RANGE = 2.5;
  let npcInRange: Entity | null = null;
  let nearestDist = Infinity;
  for (const npc of npcEntities) {
    if (npc.alive === false) continue;
    const d = Math.hypot(npc.pos.x - playerPos.x, npc.pos.z - playerPos.z);
    if (d < nearestDist) { nearestDist = d; npcInRange = npc; }
  }
  if (npcInRange && nearestDist > INTERACT_RANGE) npcInRange = null;

  if (npcInRange && !dialoguePanel.isVisible) {
    interactPromptEl.textContent = `[E] hablar con ${npcInRange.name ?? npcInRange.id}`;
    interactPromptEl.style.display = "block";
  } else {
    interactPromptEl.style.display = "none";
  }

  const interactPressed = input.consumeInteract();
  if (interactPressed && npcInRange && !dialoguePanel.isVisible && now >= interactCooldownUntil) {
    interactCooldownUntil = now + 3000;
    const name = (npcInRange.name ?? npcInRange.id) as string;
    narrativeClient.interactEntity(npcInRange.id, name);
    log(`Hablando con ${name}...`);
  }

  // Attack
  const attackRequested = dialoguePanel.isVisible ? false : input.consumeAttack();

  // Tick
  const result: FrameResult = gameClient.tick(delta, {
    playerPosition: playerPos,
    playerForward: playerForward,
    playerMoving: input.state.up || input.state.down || input.state.left || input.state.right,
    attackRequested,
    attackType: attackRequested ? input.state.selectedAttack : undefined,
  });

  // Process combat events for attack visualization + triggers de animación
  let playerOneShot: string | undefined;
  for (const e of result.events) {
    if (e.type === "attack_started" && e.combatantId === "player") {
      // La anim del ataque arranca con el evento del sim (mismo camino que
      // el 3D: estado → animación), no con el click.
      playerOneShot = input.state.selectedAttack;
      attackVisual = {
        active: true,
        mode: "windup",
        params: getSelectedParams(),
        impactQuality: 0,
        fadeTimer: 0,
      };
    } else if (e.type === "attack_impacted" && e.combatantId === "player") {
      let quality = 0;
      for (const ee of enemyEntities) {
        if (!ee.alive) continue;
        const dist = distance(playerPos, ee.pos);
        const params = attackVisual?.params ?? getSelectedParams();
        const distFactor = Math.max(0, 1 - Math.abs(dist - params.optimal_distance) / params.distance_tolerance);
        const dir = sub(ee.pos, playerPos);
        const fwdXz = { x: playerForward.x, z: playerForward.z };
        const perpDist = Math.abs(fwdXz.x * dir.z - fwdXz.z * dir.x);
        const precFactor = Math.max(0, 1 - perpDist / params.area_radius);
        quality = Math.max(quality, distFactor * precFactor);
      }
      attackVisual = {
        active: true,
        mode: "impact",
        params: attackVisual?.params ?? getSelectedParams(),
        impactQuality: quality,
        fadeTimer: 0.3,
      };
    } else if (e.type === "attack_landed") {
      const targetId = e.targetId as string;
      const dmg = e.damage as number;
      if (targetId === "player") {
        // El ataque en curso (one-shot) tiene prioridad sobre el respingo.
        if (playerOneShot === undefined) playerOneShot = "hit_react";
        log(`Player hit: -${dmg.toFixed(1)} HP`);
      } else {
        const track = charTracks.get(targetId);
        if (track) track.oneShot = "hit_react";
        log(`${targetId} hit: -${dmg.toFixed(1)} HP`);
      }
    } else if (e.type === "died") {
      const who = e.combatantId as string;
      if (who === "player") {
        playerAlive = false;
        log("YOU DIED — press R to respawn");
      } else {
        log(`${who} killed!`);
      }
    } else if (e.type === "player_respawned") {
      playerAlive = true;
      log("Respawned!");
    }
  }

  // Fade impact flash
  if (attackVisual?.mode === "impact") {
    attackVisual.fadeTimer -= delta;
    if (attackVisual.fadeTimer <= 0) {
      attackVisual = null;
    }
  }

  // Sync enemy entities from result
  for (const enemyState of result.enemies) {
    const ee = enemyEntities.find(e => e.id === enemyState.id);
    if (ee) {
      if (enemyState.pos) {
        ee.pos = { x: enemyState.pos.x, y: enemyState.pos.y, z: enemyState.pos.z };
      }
      if (enemyState.forward) {
        ee.forward = { x: enemyState.forward.x, y: enemyState.forward.y, z: enemyState.forward.z };
      }
      ee.hp = enemyState.hp;
      ee.alive = enemyState.alive;
      ee.attacking = enemyState.state === "winding_up" || enemyState.state === "attacking";
      ee.attackType = enemyState.attackType;
    }
  }

  // Update HUD
  const pHpPct = Math.max(0, result.playerHp / playerMaxHp * 100);
  playerHpBar.style.width = pHpPct + "%";
  playerHpText.textContent = Math.ceil(result.playerHp).toString();

  for (const ee of enemyEntities) {
    const bar = document.getElementById(`hp-${ee.id}`);
    const text = document.getElementById(`hp-text-${ee.id}`);
    if (bar) bar.style.width = Math.max(0, (ee.hp ?? 0) / (ee.maxHp ?? 1) * 100) + "%";
    if (text) text.textContent = Math.ceil(ee.hp ?? 0).toString();
  }

  // Render. Los sprites se poblan solo cuando character_sprites está activo
  // Y el set base y_bot terminó de cargar (antes, círculos — explícitamente,
  // no como fallback). Cada entidad avanza su máquina de estados de anim y
  // resuelve por frame si dibuja la base o su variante skinneada por IA.
  const spritesOn = CONFIG.graphics.character_sprites && baseSheetsLoaded;
  let playerSprite: Entity["sprite"];
  if (spritesOn && playerModel !== null) {
    const playerMoving =
      !dialoguePanel.isVisible &&
      (input.state.up || input.state.down || input.state.left || input.state.right);
    characterSprites.updateAnim(
      playerAnim,
      {
        alive: playerAlive,
        moving: playerMoving,
        sprinting: input.state.sprint,
        oneShot: playerOneShot,
      },
      now,
    );
    playerSprite = {
      model: characterSprites.modelFor(playerSkinPrompt, playerAnim.anim, playerModel),
      anim: playerAnim.anim,
      angle: WORLD_ANGLE,
      animStartedAt: playerAnim.animStartedAt,
    };
  }
  if (spritesOn) {
    for (const ee of enemyEntities) updateEntitySprite(ee, now, { npc: false });
    for (const npc of npcEntities) updateEntitySprite(npc, now, { npc: true });
  }
  // Blindaje: una excepción de UN frame no debe matar el rAF (juego
  // congelado en negro para siempre). Se registra (dedup por mensaje) y el
  // siguiente frame lo reintenta — los fallos transitorios (sheet a medio
  // cargar, imagen invalidada) se autocorrigen.
  try {
    renderer.render(
      {
        pos: playerPos,
        forward: playerForward,
        hp: result.playerHp,
        maxHp: playerMaxHp,
        sprite: playerSprite,
      },
      enemyEntities,
      objectEntities,
      npcEntities,
    );
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (msg !== lastRenderError) {
      lastRenderError = msg;
      errors.push("render", `excepción en render (el loop sigue): ${msg}`, err);
    }
  }

  // Draw attack area overlay
  if (attackVisual?.active) {
    const opacity = attackVisual.mode === "impact"
      ? attackVisual.fadeTimer / 0.3 * 0.5
      : 0.3;
    renderer.drawAttackArea(
      { pos: playerPos, forward: playerForward },
      attackVisual.params,
      attackVisual.mode,
      opacity,
      attackVisual.impactQuality,
    );
  }

  scheduleNextFrame();
}

// --- Init ---

populateSceneSelector();

// Override de bench: `?perspective=isometric` fuerza la proyección al cargar
// (los fixtures locales del dropdown no tienen sesión y sin esto siempre se
// verían en topdown). La perspectiva de una sesión real la pisa al iniciar.
const perspectiveOverride = new URLSearchParams(location.search).get("perspective");
if (perspectiveOverride === "isometric" || perspectiveOverride === "topdown") {
  applySessionPerspective(perspectiveOverride);
}

// Override de bench: `?bridge=ws://127.0.0.1:19877` conecta este cliente a un
// bridge alternativo (stack E2E de narrative_lab) sin tocar la sesión normal.
const bridgeOverride = new URLSearchParams(location.search).get("bridge");
const sharedBridge = bridgeOverride ? new BridgeClient(bridgeOverride) : new BridgeClient();
const narrativeClient = new NarrativeClient(sharedBridge);
const titleScreen = new TitleScreen(narrativeClient);
const historyBrowser = new HistoryBrowser(narrativeClient);
let activeSessionId: string | null = null;

dialoguePanel.onChoice = (idx, text) => {
  input.dialogueActive = false;
  if (!activeSessionId) return;
  const cur = dialoguePanel.current();
  narrativeClient.sendDialogueChoice({
    eventId: `client_${Date.now()}`,  // bridge generates the canonical id
    choiceIndex: idx,
    speaker: cur.speaker,
    chosenText: text,
  });
};

dialoguePanel.onFreeText = (freeText) => {
  input.dialogueActive = false;
  if (!activeSessionId) return;
  const cur = dialoguePanel.current();
  narrativeClient.sendDialogueChoice({
    eventId: `client_${Date.now()}`,
    choiceIndex: -1,
    speaker: cur.speaker,
    chosenText: freeText,
    freeText,
  });
};

travelPanel.onTravel = (placeId) => {
  if (!activeSessionId) return;
  showLoader("Viajando...", "El motor narrativo está preparando el lugar.");
  narrativeClient.enterPlace(placeId);
};

// --- Narrative loader (status-driven overlay) ---
const loaderEl = document.getElementById("narrative-loader") as HTMLDivElement | null;
const loaderTitle = document.getElementById("narrative-loader-title");
const loaderDetail = document.getElementById("narrative-loader-detail");
const loaderElapsed = document.getElementById("narrative-loader-elapsed");
const loaderDismiss = document.getElementById("narrative-loader-dismiss");

let loaderStartedAt = 0;
let loaderTicker: ReturnType<typeof setInterval> | null = null;

function showLoader(title: string, detail: string): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("error");
  loaderEl.classList.add("visible");
  if (loaderTitle) loaderTitle.textContent = title;
  if (loaderDetail) loaderDetail.textContent = detail;
  loaderStartedAt = Date.now();
  if (loaderElapsed) loaderElapsed.textContent = "0s";
  if (loaderTicker) clearInterval(loaderTicker);
  loaderTicker = setInterval(() => {
    if (!loaderElapsed) return;
    const s = Math.floor((Date.now() - loaderStartedAt) / 1000);
    loaderElapsed.textContent = `${s}s`;
  }, 500);
}

/** Actualiza SOLO el detalle del loader con un latido de progreso del motor
 *  (sin resetear el cronómetro ni pisar un estado de error). No-op si el
 *  loader no está visible — el progreso también llega en momentos sin
 *  overlay (p. ej. tiles de frontera en segundo plano). */
function updateLoaderProgress(message: string): void {
  if (!loaderEl || !loaderEl.classList.contains("visible")) return;
  if (loaderEl.classList.contains("error")) return;
  if (loaderDetail) loaderDetail.textContent = message;
}

function hideLoader(): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("visible", "error");
  if (loaderTicker) {
    clearInterval(loaderTicker);
    loaderTicker = null;
  }
}

function setLoaderState(state: "error", title: string, detail: string): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("error");
  loaderEl.classList.add("visible", state);
  if (loaderTitle) loaderTitle.textContent = title;
  if (loaderDetail) loaderDetail.textContent = detail;
  if (loaderTicker) {
    clearInterval(loaderTicker);
    loaderTicker = null;
  }
}

if (loaderDismiss) loaderDismiss.onclick = () => hideLoader();

narrativeClient.onNarrativeStatus((status) => {
  // ── Latido de progreso del motor narrativo ────────────────────────────
  // Un paso observable (petición recogida, tool de estado llamada): el
  // loader deja de ser una espera muda de minutos y narra qué está pasando.
  if (status.phase === "progress") {
    if (status.message) updateLoaderProgress(status.message);
    return;
  }

  // ── Tiles del plano continuo ──────────────────────────────────────────
  // El feedback de un tile es DIRECCIONAL (velo/flash del FrontierManager),
  // no el overlay central — salvo el bootstrap (mundo aún vacío).
  if (status.kind === "tile") {
    const t = status.tile;
    switch (status.phase) {
      case "generating":
        if (t) frontier.onStatusText(t.tx, t.ty, status.message ?? "Generando el mundo");
        if (!tileStore.hasGridTiles) {
          showLoader("Generando mundo inicial...", status.message ?? "El motor narrativo está construyendo el mundo.");
        }
        break;
      case "ready":
        // La escena llega por scene_init (addTile dispara el flash allí).
        hideLoader();
        break;
      case "error": {
        const detail = status.message ?? "Algo falló generando el tile.";
        errors.push("narrative", detail);
        if (t) frontier.onTileError(t.tx, t.ty);
        if (!tileStore.hasGridTiles) {
          setLoaderState("error", "Error al generar el mundo", detail);
        } else {
          log(`⚠ ${detail.slice(0, 100)}`);
        }
        break;
      }
    }
    return;
  }

  if (status.kind === "scene") {
    switch (status.phase) {
      case "generating":
        showLoader(
          "Generando escena...",
          status.message ?? "El motor narrativo está construyendo el mundo. Puede tardar un momento.",
        );
        break;
      case "ready":
        hideLoader();
        break;
      case "error": {
        const detail = status.message ?? "Algo falló en el motor narrativo.";
        errors.push("narrative", detail);
        setLoaderState("error", "Error al generar la escena", detail);
        break;
      }
    }
    return;
  }

  // Estados que no son de escena (consequences / plugins). El bridge sólo los
  // emite en error: una reacción narrativa rechazada (p.ej. 422 de
  // /report_player_choice por una consequence mal formada). Sin esto el error
  // se traga en silencio — el jugador no ve diálogo ni motivo. Lo surgimos al
  // error-log y a un overlay descartable.
  if (status.phase === "error") {
    const detail = status.message ?? "El motor narrativo rechazó la reacción.";
    errors.push("narrative", detail);
    setLoaderState("error", "El motor narrativo rechazó la respuesta", detail);
  }
});

/** Materializa un `spawn_entity` del motor narrativo EN LA ESCENA VIVA, sin
 *  recargar (Task 13 — paridad con godot/scripts/main.gd:_apply_spawn_entity_
 *  consequence). El `position` ya viene resuelto en metros mundo por el bridge
 *  (consequence-handler.ts:resolvePositionHint, relativo al jugador). NPCs van a
 *  npcEntities (interactuables con E); building/object a objectEntities con
 *  `sizeXZ` para que sean sólidos (collidesAt) y dibujables (drawSceneBox), que
 *  es la "geometría base" sobre la que luego se superponen imágenes IA. */
function materializeSpawn(effect: {
  entityId: string;
  entityKind: "npc" | "object" | "building";
  description: string;
  name?: string;
  position: [number, number, number];
  data: Record<string, unknown>;
}): void {
  const [x, y, z] = effect.position;
  const pos: Vec3 = { x, y, z };
  const label = (effect.name ?? effect.description ?? effect.entityId).slice(0, 40);
  const spriteHash = typeof effect.data.sprite_hash === "string" ? effect.data.sprite_hash : undefined;

  if (effect.entityKind === "npc") {
    // El caso central del skin IA: la descripción del motor narrativo es el
    // prompt con el que se repinta la base y_bot frame a frame.
    const npcPrompt = effect.description || (effect.name ?? effect.entityId);
    npcEntities.push({
      id: effect.entityId,
      pos,
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color: "#68c",
      label,
      name: effect.name ?? effect.entityId,
      alive: true,
      category: "creature",
      spriteHash,
      skinPrompt: npcPrompt,
    });
    characterSprites.requestSkin(npcPrompt);
    log(`✨ ${effect.name ?? "NPC"} aparece`);
    return;
  }

  // building / object: caja sólida colocada en la escena actual.
  const isBuilding = effect.entityKind === "building";
  objectEntities.push({
    id: effect.entityId,
    pos,
    radius: isBuilding ? 8 : 5,
    color: isBuilding ? "#5a4a38" : "#666",
    label,
    alive: true,
    category: isBuilding ? "building" : "prop",
    sizeXZ: isBuilding ? { x: 4, z: 4 } : { x: 1.4, z: 1.4 },
    spriteHash,
  });
  log(`✨ ${isBuilding ? "edificio" : "objeto"}: ${label}`);
}

narrativeClient.onNarrativeEvent((event) => {
  for (const effect of event.effects) {
    switch (effect.kind) {
      case "show_dialogue":
        dialoguePanel.show(effect.speaker, effect.text, effect.choices.map((c) =>
          typeof c === "string" ? c : c.text,
        ));
        // Suprime movimiento/ataque del InputProvider mientras el panel está
        // abierto (las teclas 1-3/T las gestiona el propio panel).
        input.dialogueActive = true;
        break;
      case "story_delta":
        log(`📖 ${effect.delta.slice(0, 80)}`);
        break;
      case "spawn_entity": {
        // El bridge envuelve una escena recién generada en un spawn_entity con
        // `data.scene` (ws-server.ts start_session): eso es "cargar escena".
        // Un spawn_entity SIN `data.scene` es una entidad suelta que se
        // materializa in-place en la escena viva (Task 13).
        const scene = (effect.data as Record<string, unknown> | undefined)?.scene as
          | Record<string, unknown>
          | undefined;
        if (scene) {
          const t = scene.tile as { tx: number; ty: number } | undefined;
          if (t && Number.isInteger(t.tx) && Number.isInteger(t.ty)) {
            // Tile del plano: ADITIVO (los anteriores no desaparecen).
            void addTile(scene).then(() => {
              const edge = frontier.onTileReady(t.tx, t.ty, playerPos.x, playerPos.z);
              if (edge) {
                renderer.setEdgeFlash(edge);
                const ES: Record<string, string> = { north: "norte", south: "sur", east: "este", west: "oeste" };
                log(`🌍 el mundo continúa hacia el ${ES[edge]}`);
              } else {
                log(`🌍 tile listo: ${effect.entityId}`);
              }
            });
          } else {
            // Escena legacy (save v3 sin migrar).
            void loadSceneData(scene);
            log(`🌍 escena cargada: ${effect.entityId}`);
          }
        } else {
          materializeSpawn(effect);
        }
        break;
      }
      case "schedule_event":
        log(`⏳ scheduled: ${effect.description.slice(0, 60)}`);
        break;
      case "ambient_message":
        log(effect.message);
        break;
      case "plugin_applied":
        log(`⚙️ plugin ${effect.pluginId.slice(0, 8)}…: ${effect.eventType} → ${effect.changedPaths.join(", ") || "(solo slice)"}`);
        break;
    }
  }
});

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    const client = await createGameClient(sharedBridge);
    gameClient = client;
    updateConnectionStatus(client.isConnected, true);
    client.on("connected", () => updateConnectionStatus(true, true));
    client.on("disconnected", () => updateConnectionStatus(false, true));
    await runTitleFlow();
  } catch (err) {
    setLoaderState(
      "error",
      "No se pudo arrancar la partida",
      (err as Error).message,
    );
    errors.push("session", "bootstrap failed", err);
  }
}

async function runTitleFlow(): Promise<void> {
  let action: TitleAction;
  try {
    action = await titleScreen.show();
  } catch (err) {
    titleScreen.hide();
    setLoaderState(
      "error",
      "No se pudo mostrar la pantalla de título",
      (err as Error).message,
    );
    errors.push("session", "title-screen failed", err);
    throw err;
  }

  try {
    if (action.kind === "new_game") {
      // Show loader immediately so the canvas isn't blank while we wait on
      // start_session + the bridge's "generating" broadcast.
      showLoader(
        "Iniciando partida...",
        "Pidiendo al motor narrativo que construya la escena inicial.",
      );
      const res = await narrativeClient.startSession(
        action.gameId,
        action.appearance,
        action.styleId || undefined,
        action.perspective,
        action.renderMode,
      );
      activeSessionId = res.sessionId;
      applySessionStyle(res.state.world?.style_id ?? "");
      applySessionPerspective(res.state.world?.perspective ?? "");
      applySessionRenderMode(res.state.world?.render_mode ?? "");
      applySessionCombatSystem(res.state.world?.combat_system ?? "");
      historyBrowser.setSession(res.sessionId);
      log(`Nueva partida: ${res.sessionId} (${action.gameId})`);
      await setPlayerAppearance(action.appearance.model_id, action.appearance.skin_path);
    } else {
      const res = await narrativeClient.resumeSession(action.sessionId);
      activeSessionId = res.state.session_id;
      applySessionStyle(res.state.world?.style_id ?? "");
      applySessionPerspective(res.state.world?.perspective ?? "");
      applySessionRenderMode(res.state.world?.render_mode ?? "");
      applySessionCombatSystem(res.state.world?.combat_system ?? "");
      historyBrowser.setSession(res.state.session_id);
      log(`Reanudada: ${res.state.session_id}`);
      // resume: trust the save's appearance verbatim. Un model_id sin sheets
      // completos (o vacío) cae a la base y_bot dentro de setPlayerAppearance.
      const desiredModel = res.state.player.appearance.model_id;
      const skinPath = res.state.player.appearance.skin_path || "";
      await setPlayerAppearance(desiredModel, skinPath);

      // Materialise the world the player was in. Multi-tile: TODOS los tiles
      // del save se re-añaden (el plano continuo sobrevive al resume); la
      // escena activa se añade la última para quedar como activa si es legacy.
      const activeId = res.state.world?.active_scene_id;
      const scenes = res.state.scenes_loaded as Record<string, { scene_data?: Record<string, unknown>; tile?: unknown }> | undefined;
      resetWorld();
      let added = 0;
      for (const [id, rec] of Object.entries(scenes ?? {})) {
        if (!rec?.scene_data || !rec.tile || id === activeId) continue;
        await addTile(rec.scene_data);
        added++;
      }
      const activeScene = activeId ? scenes?.[activeId]?.scene_data : undefined;
      if (activeScene) {
        await addTile(activeScene);
        added++;
      }
      if (added === 0) log(`(sin escena en el save — esperando narrativa)`);
      // La posición viene del save (el bridge la snapshotea en save_session).
      const savedPos = res.state.player?.position;
      if (Array.isArray(savedPos) && savedPos.length === 3) {
        playerPos.x = savedPos[0];
        playerPos.z = savedPos[2];
      }
      const underResume = tileStore.getAt(playerPos.x, playerPos.z);
      if (underResume) setActiveClientTile(underResume.key);
    }
  } catch (err) {
    setLoaderState(
      "error",
      "No se pudo iniciar la sesión",
      (err as Error).message,
    );
    errors.push("session", "session start/resume failed", err);
    throw err;
  } finally {
    titleScreen.hide();
  }
}

scheduleNextFrame();
