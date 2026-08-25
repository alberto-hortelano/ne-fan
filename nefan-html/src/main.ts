/** Never Ending Fantasy — cliente HTML.
 *
 *  UNA vista: primera persona (FpsRenderer → three.js). Conecta al bridge de
 *  nefan-core por WebSocket o cae a simulación local. */

import type { Vec3, EffectiveParams } from "@nefan-core/src/types.js";
import { setDebugLog } from "./dev/debug-log.js";
import { getEffectiveParams, loadConfig } from "@nefan-core/src/combat/combat-data.js";
import { attackFlashQuality } from "@nefan-core/src/combat/attack-area.js";
import { combatRegistry } from "@nefan-core/src/combat/registry.js";
import type { AttackSpec } from "@nefan-core/src/combat/combat-system.js";
import { DEFAULT_SOLID_CHARS, formatDToWorld, KIND_DEFAULT_HEIGHT } from "@nefan-core/src/scene/scene-normalize.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import {
  deriveVolumesFromSchema,
  parseGround,
  parseVolumes,
  type GroundFeature,
  type Volume,
} from "@nefan-core/src/scene/blueprint/index.js";
import { createTerrainCollider, type TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { pickAimTarget } from "@nefan-core/src/scene/aim.js";
import {
  motivoDeSesionParaElJugador,
  rotuloDeStatus,
  type SalidaDelOverlay,
} from "@nefan-core/src/protocol/status-labels.js";
import type { NarrativeStatusMessage } from "@nefan-core/src/protocol/messages.js";
import { TileStore, tileKey, tileWorldRect, type TileClientState } from "./world/tile-store.js";
import { FrontierManager, type Edge as FrontierEdge } from "./world/frontier.js";
import type { Entity } from "./renderer/types.js";
import { FPS_DEBUG_VIEW_LABELS, FpsRenderer, type FpsTilePlan } from "./renderer/fps-renderer.js";
import { FpsAtlasController } from "./scene/fps-atlas.js";
import { CollisionSystem, applyPlanCollision } from "./world/collision.js";
import { SpriteRenderer } from "./renderer/sprite-renderer.js";
import {
  BASE_ANIMS,
  BASE_MODEL,
  CharacterSpriteManager,
  newAnimState,
  type CharacterAnimState,
} from "./renderer/character-sprites.js";
import { BridgeClient } from "./net/bridge-client.js";
import { NarrativeClient } from "./net/narrative-client.js";
import { serviceUrl } from "./net/service-urls.js";
import { TitleScreen, type TitleAction } from "./ui/title-screen.js";
import { HistoryBrowser } from "./ui/history-browser.js";
import { inputRegistry } from "./input/registry.js";
import type { InputProvider } from "./input/input-provider.js";
import { DevToolsInput } from "./input/dev-tools-input.js";
import { ScriptedInputProvider } from "./input/scripted-input-provider.js";
import { DialoguePanel } from "./ui/dialogue-panel.js";
import { TravelPanel, type SceneExit } from "./ui/travel-panel.js";
import { TravelLedger } from "./ui/travel-ledger.js";
import { TileLedger } from "./ui/tile-ledger.js";
import { DevStatusPanel } from "./ui/dev-status-panel.js";
import { DevMenu, type FakeItem } from "./ui/dev-menu.js";
import { GraphicsModeChip } from "./ui/graphics-mode.js";
import { errors } from "./ui/error-log.js";
import { paso } from "./ui/async-ui.js";
import { ActionBar } from "./ui/action-bar.js";
import { WorldLabels, type WorldLabel } from "./ui/world-labels.js";
import { PortraitView } from "./ui/portrait.js";
import { applyUiTheme, currentUiTheme, BASE_UI_THEME, type UiTheme } from "./ui/theme.js";
import { createClientSession } from "@nefan-core/src/session/session-facets.js";
import {
  createGameClient,
  createViewerClient,
  type GameClient,
  type FrameResult,
  type RoomEnemy,
} from "./net/game-client.js";

import combatConfigJson from "@nefan-core/data/combat_config.json";
import { CONFIG } from "@nefan-core/src/config.js";

// Glob import all open-world scene JSONs (lazy) — Vite feature.
// El concepto sala se ha retirado del cliente HTML: estas fixtures son tiles
// del plano continuo, la única variante de Format D que queda.
const sceneModules: Record<string, () => Promise<{ default: Record<string, unknown> }>> =
  (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<{ default: Record<string, unknown> }>> })
    .glob("@nefan-core/data/scenes/*.json");

const playerCfg = (combatConfigJson as Record<string, unknown>).player as Record<string, number> | undefined ?? {};
// El cliente web camina más rápido que el walk_speed realista (1.9 m/s) del
// config compartido, y lo hace con un multiplicador propio para no alterar
// ese config. OJO al heredarlo: el 2,2 se calibró para la vista CENITAL,
// donde el jugador se veía entero y el mundo pasaba por debajo. En primera
// persona nadie lo ha vuelto a mirar — 4,2 m/s de paseo es un trote largo a
// la altura de los ojos. Es una decisión de feel, no un bug, así que se queda
// donde estaba hasta que se juegue y se decida.
const ARCADE_SPEED_SCALE = 2.2;
const SPEED = (playerCfg.walk_speed ?? 3.0) * ARCADE_SPEED_SCALE;
const SPRINT_SPEED = (playerCfg.sprint_speed ?? 5.5) * ARCADE_SPEED_SCALE;

/** Player visual state. When CONFIG.graphics.character_sprites is false the
 *  player is drawn as a coloured circle and playerModel stays null. When
 *  true, setPlayerAppearance resolves the base model (y_bot salvo que el
 *  elegido tenga el set completo en disco) y encola su skin IA. */
let playerModel: string | null = null;
let playerSkinPrompt = "";
let playerAlive = true;
/** Última entidad con la que el jugador pulsó E: identifica al hablante
 *  cuando la línea llega sin nombre reconocible. */
let lastInteractedId: string | null = null;
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
        await spriteRenderer.loadAnimation(modelId, anim, worldAngle);
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

  if (skinPrompt && characterSprites.skinsAllowed) {
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
/** Caja del MUNDO: el renderer mete aquí dentro su lienzo WebGL (y la UI de
 *  juego se posiciona contra ella, no contra el viewport). */
const appShell = document.getElementById("app-shell") as HTMLElement;
/** Set de sprites del mundo: los sheets del y_bot van renderizados desde un
 *  ángulo de cámara fijo. La cámara está a la altura de los ojos, así que el
 *  set es el casi frontal −8°. DEBE coincidir con el SKIN_ANGLE de
 *  ui/style-apply.ts: el ángulo entra en la clave de caché del skin. */
const worldAngle = "frontal_8";
// Bases por servicio (F1–F3). Overrides de bench (`?ai=`, `?bridge=`) viven
// en net/service-urls.ts; el fake-ai-server emula S3–S6 en un solo puerto,
// así que `?ai=` cubre las cuatro.
// Blobs cacheados (F2): proceso propio del asset-store.
const ASSET_STORE_URL = serviceUrl("asset-store");
// Meshy/fal (F4): proceso propio de remote-gen (repintados, sheets
// skinneados, toggle dev de las APIs de pago).
const REMOTE_GEN_URL = serviceUrl("remote-gen");
const spriteRenderer = new SpriteRenderer("/sprites", REMOTE_GEN_URL, ASSET_STORE_URL);
const characterSprites = new CharacterSpriteManager(spriteRenderer, worldAngle);
/** Retrato del hablante del diálogo: hero-shot ya pagado o busto animado. */
const portrait = new PortraitView(spriteRenderer, "/sprites");
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
// El mensaje NOMBRA EL REMEDIO (#255): las hojas son 28 MB fuera de git, así
// que un clon limpio llega aquí siempre y «incompleto» a secas no le dice a
// nadie qué hacer. Ni el fallback existe — sin `y_bot` no hay a qué degradar.
baseSheetsReady.catch((err) =>
  errors.push(
    "sprite",
    `set base ${BASE_MODEL} incompleto — personajes sin sprite. Las hojas no están en el repo: ` +
      `genéralas con sprite-forge, receta en docs/assets-de-personaje.md`,
    err,
  ),
);
/** El renderer del mundo, construido EAGER: es el único que hay, así que no
 *  espera a que la sesión decida nada. three.js entra por import dinámico
 *  dentro de la fachada (y con él el único contexto WebGL de la pestaña);
 *  hasta que llega, las instalaciones se encolan. */
const fpsRenderer = new FpsRenderer(appShell, { spriteRenderer });
// Panel de dev (segunda fila del HUD, #dev-status): estado de la generación
// de imágenes IA, contadores de caché, gasto estimado en € (poll a
// GET /dev/status de remote-gen) y config activa. Siempre visible.
const devPanel = new DevStatusPanel(REMOTE_GEN_URL, (msg) => log(msg));
/** Menú dev de imágenes (lista de fakes con generación por item). Se
 *  construye tras el bridge (sus deps tocan narrativeClient); hasta entonces
 *  los refresh son no-op. */
let devMenu: DevMenu | null = null;
/** Chip de gráficos del HUD (UI de cliente): modo de generación de imágenes
 *  IA de la partida, siempre visible en juego. Misma ventana de construcción
 *  que devMenu. */
let graphicsChip: GraphicsModeChip | null = null;

/** La sesión del cliente: UN valor con todo lo que una partida imprime aquí
 *  (id, estilo, modos de render, sistema de combate, tema de UI), y los dos
 *  verbos que la mueven. `enter` y `leave` recorren el MISMO código —«sin
 *  partida» es un valor del mismo tipo—, así que los dos caminos de vuelta al
 *  título no pueden dejar el cliente distinto: no hay reset que olvidar.
 *
 *  Los sinks son los aplicadores de siempre; se cablean aquí y se invocan
 *  todos en cada transición. Ninguno corre en el arranque del módulo (el
 *  primer `apply` es el del título), así que pueden referirse a cosas que se
 *  declaran más abajo. */
const session = createClientSession({
  style: (styleId) => applySessionStyle(styleId),
  theme: (uiTheme) => applyUiTheme(uiTheme),
  renderModes: (renderMode, characterMode) => applyRenderModes(renderMode, characterMode),
  combat: (combatSystem) => applySessionCombatSystem(combatSystem),
  history: (sessionId) => historyBrowser.setSession(sessionId),
});
// Pipeline de imagen de la vista fps: atlas de superficies por tile. Las
// celdas son assets de la LIBRERÍA (kind "surface") — el server pinta solo
// lo que falta y las escenas siguientes reutilizan por descripción+estilo.
const fpsAtlasController = new FpsAtlasController(
  { remote: REMOTE_GEN_URL, assets: ASSET_STORE_URL, state: serviceUrl("world-state") },
  {
    getTile: (key) => {
      const surfaces = fpsRenderer.getTileSurfaces(key);
      const entry = tileStore.entries.get(key);
      if (!surfaces || !entry) return null;
      const scene = entry.scene as { scene_description?: string };
      return {
        layout: surfaces.layout,
        sceneDescription: String(scene.scene_description ?? ""),
      };
    },
    apply: (key, images) => fpsRenderer.applyAtlas(key, images),
    clear: (key) => fpsRenderer.clearAtlas(key),
    // Gate por sesión: entre el broadcast de la escena y la respuesta de
    // start/resume, scenesMode aún es el default del cliente ("image") — sin
    // el gate, reanudar una partida VECTOR pintaba atlas de pago en esa
    // ventana (visto en vivo 2026-08-14). Hasta aplicar los modos del save,
    // el controller solo RESUELVE contra la librería ($0).
    generationOn: () => session.active && scenesGenerationOn(),
    log: (msg) => log(msg),
    onGeneration: (e) => devPanel.recordGeneration(e),
  },
);

/** Propaga el estilo visual de la sesión (world.style_id, congelado en el
 *  save) a los generadores de imagen: escena y skins de personaje. */
function applySessionStyle(styleId: string): void {
  fpsAtlasController.setStyle(styleId);
  spriteRenderer.setStyle(styleId);
  devPanel.setSession({ styleId });
  if (styleId) log(`Estilo visual: ${styleId}`);
}

/** Modo de render por faceta de la sesión activa. Ya NO está congelado: el
 *  chip de gráficos del HUD lo cambia en runtime (el bridge lo persiste en
 *  el save y lo difunde con render_mode_changed). Valores:
 *  - "image": generación IA activa (atlas de superficies de la fps, skins de
 *    personaje) — créditos.
 *  - "vector": sin generación NUEVA; el arte es el clay greybox local y la
 *    base y_bot. Lo ya pintado se conserva.
 *  - "" (sin sesión o saves previos al campo): legacy — en escenarios manda
 *    el toggle persistido en localStorage (AUTOIMG_KEY). */
let scenesMode: "image" | "vector" | "" = "";
let charactersMode: "image" | "vector" | "" = "";

/** ¿Debe generarse imagen NUEVA de escenario? (atlas de superficies de la
 *  fps; la generación MANUAL —tecla G, item del menú dev— no pasa por aquí:
 *  es siempre permitida). */
function scenesGenerationOn(): boolean {
  if (scenesMode) return scenesMode === "image";
  return localStorage.getItem(AUTOIMG_KEY) === "1";
}

/** Modo efectivo de personajes ("" legacy sigue a escenarios). */
function effectiveCharactersMode(): "image" | "vector" | "" {
  return charactersMode || scenesMode;
}

/** ¿Skins IA activos? Sin sesión ("" en ambas facetas) manda el toggle local
 *  persistido — OFF por defecto: cargar una fixture con NPCs descritos no
 *  debe gastar créditos sin que nadie lo pida. */
function charactersGenerationOn(): boolean {
  const eff = effectiveCharactersMode();
  if (eff) return eff === "image";
  return localStorage.getItem(AICHAR_KEY) === "1";
}

function applyRenderModes(renderMode: string, characterMode = ""): void {
  const prevCharOn = characterSprites.skinsAllowed;
  scenesMode = renderMode === "vector" ? "vector" : renderMode === "image" ? "image" : "";
  charactersMode =
    characterMode === "vector" ? "vector" : characterMode === "image" ? "image" : "";
  devPanel.setSession({ renderMode: scenesMode });
  const effChar = effectiveCharactersMode();
  characterSprites.setSkinsAllowed(charactersGenerationOn());
  // Fail-loud: la partida pide skins IA pero el backend está apagado por
  // config — sin este aviso, requestSkin haría no-op silencioso y el jugador
  // que confirmó el gasto vería y_bot sin explicación.
  if (effChar === "image" && !CONFIG.graphics.ai_skin) {
    errors.push(
      "config",
      "la partida tiene skins IA activados pero graphics.ai_skin=false en config — los personajes irán en base y_bot",
    );
  }
  const charLabel = effChar !== "vector" && CONFIG.graphics.ai_skin
    ? "skins IA" : "personajes en base y_bot";
  if (scenesMode === "vector") {
    log(`Gráficos: maqueta 3D (clay local, sin imagen IA nueva; ${charLabel})`);
  } else if (scenesMode === "image") {
    log(`Gráficos: imagen IA (${charLabel})`);
  }
  // Personajes OFF→ON: los requestSkin que no-opearon con el toggle apagado
  // no dejaron rastro — re-pedir los skins de todo lo ya spawneado.
  if (!prevCharOn && characterSprites.skinsAllowed) {
    characterSprites.resetFailureBreaker();
    reRequestAllSkins();
  }
  devMenu?.refresh();
  graphicsChip?.refresh();
}

/** Re-encola los skins IA de todas las entidades vivas (player + NPCs +
 *  enemigos). requestSkin es idempotente por prompt y respeta ai_skin. */
function reRequestAllSkins(): void {
  if (playerSkinPrompt) characterSprites.requestSkin(playerSkinPrompt);
  for (const e of [...npcEntities, ...enemyEntities]) {
    if (e.skinPrompt) characterSprites.requestSkin(e.skinPrompt, { role: e.styleRole });
  }
}

/** Cambio de modo pedido por el usuario (chip de gráficos). Con sesión, el
 *  bridge es la autoridad (persiste el save y difunde); sin sesión, estado
 *  local puro (facet scenes se persiste en AUTOIMG_KEY, patrón legacy).
 *  Lanza si el bridge rechaza — el chip lo captura y se re-lee (revert). */
async function requestModeChange(
  facet: "scenes" | "characters",
  mode: "image" | "vector",
): Promise<void> {
  if (session.active) {
    await narrativeClient.setRenderMode(session.id, facet, mode);
  } else if (facet === "scenes") {
    localStorage.setItem(AUTOIMG_KEY, mode === "image" ? "1" : "0");
  } else {
    localStorage.setItem(AICHAR_KEY, mode === "image" ? "1" : "0");
  }
  applyRenderModes(
    facet === "scenes" ? mode : scenesMode,
    facet === "characters" ? mode : charactersMode,
  );
}

/** Lo único que es de ENTRAR y no tiene simétrico al salir.
 *
 *  La precondición del gasto del atlas de superficies es `session.active`:
 *  entre el broadcast de la escena y la respuesta de start/resume, `style_id`
 *  es "" y `scenesMode` el default del cliente, así que hasta que la sesión
 *  está aplicada el controller solo RESUELVE contra la librería ($0). El
 *  controller se planta solo sin estilo — esto es la re-emisión que lo
 *  despierta cuando ya lo hay. Al salir no hay nada que re-emitir: el mundo
 *  se ha ido. */
function despiertaElAtlasDeLaSesion(): void {
  const key = activeTileKey;
  if (!key) return;
  void fpsAtlasController.onActiveTile(key).catch((err: unknown) =>
    errors.push("scene", `el atlas fps de ${key} no arrancó al abrir la sesión`, err),
  );
}

const gameUiEl = document.getElementById("game-ui") as HTMLElement;

// Con el ratón capturado ningún botón HTML puede recibir un click: la UI se
// degrada a recordatorio de teclas (una regla de CSS) en vez de ofrecer una
// afordancia imposible.
document.addEventListener("pointerlockchange", () => {
  gameUiEl.dataset.locked = document.pointerLockElement !== null ? "true" : "false";
});

// El set base y_bot se precarga arriba (baseSheetsReady) detrás del check de
// CONFIG.graphics.character_sprites; los modelos alternativos y los skins IA
// se cargan bajo demanda desde setPlayerAppearance / requestSkin.
const playerStatusEl = document.getElementById("player-status") as HTMLElement;
playerStatusEl.innerHTML =
  `<div class="nf-vital"><span class="nf-vital-label">Vida</span>` +
  `<div class="nf-bar"><div class="nf-bar-fill" id="player-hp" style="width:100%"></div></div>` +
  `<span id="player-hp-text">100</span></div>`;
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
const enemyBarsContainer = document.getElementById("enemy-bars") as HTMLElement;
const combatLog = document.getElementById("combat-log") as HTMLElement;
/** Ataques del sistema de combate de la sesión, clicables y con su tecla. */
const attackBar = new ActionBar(document.getElementById("action-bar") as HTMLElement);
/** Acción contextual (hablar, reaparecer) y confirmación Y/N: mismos botones,
 *  distinta región. */
const promptBar = new ActionBar(document.getElementById("interact-prompt") as HTMLElement);
/** Nombres sobre la cabeza (primera persona): DOM temado, no texto en WebGL. */
const worldLabels = new WorldLabels(document.getElementById("world-labels") as HTMLElement);
/** Mirilla: se enciende cuando la cámara enfila algo con nombre. */
const reticleEl = document.getElementById("reticle") as HTMLElement;
const confirmPromptEl = document.getElementById("tile-confirm-prompt") as HTMLElement;
const confirmTextEl = document.getElementById("tile-confirm-text") as HTMLElement;
const confirmBar = new ActionBar(document.getElementById("tile-confirm-actions") as HTMLElement);

/** Pregunta de sí/no del juego (explorar una zona nueva): panel propio con
 *  las teclas Y/N, ahora también clicables. `null` la retira. */
function setConfirmPrompt(
  q: { text: string; yes: string; no: string; onYes: () => void; onNo: () => void } | null,
): void {
  confirmPromptEl.hidden = q === null;
  if (!q) {
    confirmBar.set([]);
    return;
  }
  confirmTextEl.textContent = q.text;
  confirmBar.set([
    { id: "confirm-yes", label: q.yes, key: "Y", invoke: q.onYes },
    { id: "confirm-no", label: q.no, key: "N", invoke: q.onNo },
  ]);
}
const sceneSelector = document.getElementById("room-selector") as HTMLSelectElement;
const connectionStatus = document.getElementById("connection-status") as HTMLElement;

const dialoguePanel = new DialoguePanel();
const travelPanel = new TravelPanel();
/** Lo que el juego recuerda del último viaje pedido por «Salidas», paso a
 *  paso: sin esto, un viaje que no llega y uno lento son el mismo silencio. */
const travelLedger = new TravelLedger();
/** Qué tile se pidió, cuál llegó y DE DÓNDE salió (motor / caché / snapshot). */
const tileLedger = new TileLedger();
const tileConfirmPromptEl = document.getElementById("tile-confirm-prompt") as HTMLElement;
errors.attach(document.getElementById("error-log") as HTMLElement);
// Tema base: la partida lo sustituye por el del estilo al abrir sesión. Ya
// no se empuja a ningún renderer: el único que queda no pinta texto dentro
// del lienzo (los nombres son DOM temado, world-labels.ts) — el CSS llega.
applyUiTheme(BASE_UI_THEME);

// Proveedor de input (plugin): default teclado+ratón; ?input=scripted instala
// el driver programático de bench. Un id desconocido no arranca — fail-loud.
const requestedInputId = new URLSearchParams(location.search).get("input") ?? undefined;
let input: InputProvider;
try {
  input = inputRegistry.create(requestedInputId, {});
} catch (err) {
  errors.push("input", `proveedor de input inválido (?input=${requestedInputId})`, err);
  throw err;
}
input.onAttackTypeChanged = () => renderAttackBar();

// Teclas de desarrollo (G/B): fijas, independientes del provider.
const devInput = new DevToolsInput({
  isDialogueActive: () => input.dialogueActive,
});

// Hook de bench (labs/narrative / pruebas de navegador): estado vivo legible
// desde la consola o la automatización. Solo lectura — no es API del juego.
// El bloque DEV de más abajo AÑADE claves sobre este mismo objeto (merge,
// nunca reemplazo: pisar el hook dejaba a los benches sin tiles/frontier).
const nefanHook: Record<string, unknown> = {
  input,
  get playerPos() { return playerPos; },
  get scene() { return sceneData; },
  get dialogueVisible() { return dialoguePanel.isVisible; },
  get exits() { return currentExits; },
  get tiles() { return [...tileStore.entries.keys()]; },
  get currentTile() { return activeTileKey; },
  get frontier() { return frontier.debugState(); },
  /** Ledger del último viaje por «Salidas»: qué paso se dio y cuál no. */
  get viaje() { return travelLedger.debugState(); },
  /** Episodios de tile: pedido/llegada y el ORIGEN que declara el bridge. */
  get tileEpisodios() { return tileLedger.debugState(); },
  /** Libro de skins: qué personajes ha pedido la PARTIDA (y con qué rol). */
  get skins() { return characterSprites.debugState(); },
  probeCollide(x: number, z: number) { return collidesAt(x, z); },
  /** UI de juego: acciones ofrecidas y tema activo (bench/E2E). */
  ui: {
    actions: () => ({
      attack: attackBar.snapshot(),
      prompt: promptBar.snapshot(),
      confirm: confirmBar.snapshot(),
      choices: [...document.querySelectorAll<HTMLButtonElement>("#dialogue-choices .nf-action")]
        .map((b) => b.querySelector(".nf-label")?.textContent ?? ""),
    }),
    theme: () => currentUiTheme(),
    setTheme: (t: UiTheme) => applyUiTheme(t),
  },
  /** Facetas de la sesión aplicadas AHORA MISMO (id, estilo, modos, combate,
   *  tema). Es lo que hace medible «los dos caminos de vuelta al título dejan
   *  el cliente idéntico»: se lee de vuelta en el título y tiene que salir el
   *  mismo objeto por los dos. */
  sesion: () => session.facets,
  /** Trazas de los pipelines de imagen/colisión (dev/debug-log.ts): apagadas
   *  por defecto; también `?debug=1` en la URL. */
  debug(on: boolean) { setDebugLog(on); },
};
(window as unknown as { __nefan?: unknown }).__nefan = nefanHook;

// --- Sistema de combate de la sesión (catálogo → HUD + teclas) ---
// Espejo de applyRenderModes: el id viene congelado en el save
// (world.combat_system); "" (sin sesión / saves previos) = estándar. El HUD
// y el mapeo 1..N se regeneran desde el catálogo que declara el sistema.
let attackCatalog: readonly AttackSpec[] = [];
/** Id efectivo del sistema de combate de la sesión ("" = sin sesión). */
let sessionCombatSystemId = "";

/** Selector de ataque: un botón por ataque del catálogo de la sesión, con su
 *  tecla. El provider sigue siendo el dueño de la selección — el click es un
 *  origen más de intención, igual que la tecla. */
function renderAttackBar(): void {
  attackBar.set(
    attackCatalog.map((spec, i) => ({
      id: `attack:${spec.id}`,
      label: spec.label,
      key: String(i + 1),
      active: input.state.selectedAttack === spec.id,
      invoke: () => input.selectAttack(spec.id),
    })),
  );
}

function applySessionCombatSystem(id: string): void {
  sessionCombatSystemId = id;
  attackCatalog = combatRegistry.create(id || undefined, config).attacks;
  input.setAttackBindings(attackCatalog.map((a) => a.id));
  renderAttackBar();
  if (id) log(`Combate: ${id} (${attackCatalog.length} ataque${attackCatalog.length === 1 ? "" : "s"})`);
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

// --- Generación de imagen SIN sesión (fixtures) ---
// Persistido en localStorage: es el estado del toggle de escenarios cuando no
// hay partida; con sesión manda world.render_mode. El toggle visible es el
// chip de gráficos (GraphicsModeChip).
const AUTOIMG_KEY = "nefan.autoimg";
/** Toggle local de skins IA SIN sesión (fixtures) — mismo patrón. */
const AICHAR_KEY = "nefan.aichar";

// Arranque sin sesión: los skins IA parten del toggle local (OFF por
// defecto) — el manager nace con allowed=true y sin esto una fixture con
// NPCs descritos encolaría skins de pago nada más cargar.
characterSprites.setSkinsAllowed(charactersGenerationOn());

// El toggle Dev-cache vive ahora en el panel de dev (DevStatusPanel es su
// único dueño: estado inicial, cambios y deshabilitado con ai_server caído).

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
      // NPCs huyendo (flee) corren; el resto de su locomoción es walk.
      sprinting: opts.npc ? e.npcRun : undefined,
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
    angle: worldAngle,
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
    // path like "@nefan-core/data/scenes/robledo_tile.json"
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

async function loadSceneFile(globKey: string): Promise<void> {
  const loader = sceneModules[globKey];
  if (!loader) {
    log("Scene not found: " + globKey);
    return;
  }

  const mod = await loader();
  // El selector «Room» TOMA EL MUNDO: lo que se carga es una escena de prueba,
  // no la partida de nadie. El bridge necesita oírlo para dejar de escuchar al
  // sim con el save de la partida que hubiera detrás (QA 2026-08-25: sin esto,
  // asomarse a una fixture escribía las coordenadas del muñeco en el
  // `state.json` y «Reanudar» te dejaba ahí).
  await loadSceneData(mod.default, { tomaElMundo: true });
}

/** Vacía el mundo del cliente (arranque de sesión, resume, fixtures). */
function resetWorld(): void {
  tileStore.clear();
  // La escena three tiene sus propios grupos por tile: sin esto, los tiles de
  // la partida anterior seguían instalados y reaparecían de fantasmas al
  // reanudar (nadie llamaba nunca a removeTile).
  fpsRenderer.clearTiles();
  // Mundo nuevo, mirada al frente: reanudar con los ojos clavados en el suelo
  // porque así acabó la partida anterior es desconcertante.
  playerPitch = 0;
  // Y a la posición de arranque. La de la partida ANTERIOR sobrevivía a este
  // reset, y ahora que el save lleva la posición viva del sim, el primer
  // guardado de la partida siguiente se la llevaba dentro: empezabas una
  // partida nueva y su save decía que estabas donde acabaste la vieja.
  playerPos.x = 0;
  playerPos.y = 0;
  playerPos.z = 2;
  // El aspecto del jugador es del mundo que se va: dejarlo puesto hace que
  // volver al título re-pida su skin IA (imagen de pago) por un mundo que ya
  // no existe.
  playerSkinPrompt = "";
  enemyEntities = [];
  objectEntities = [];
  npcEntities = [];
  charTracks.clear();
  colorIdx = 0;
  activeTileKey = null;
  sceneData = null;
}

/** Opciones de carga de escena. `tomaElMundo` es la diferencia entre «esta es
 *  una escena de PRUEBA y a partir de ahora el mundo es mío» (el selector
 *  «Room») y «este tile se AÑADE al mundo que ya tienes» (la partida). Viaja
 *  hasta el bridge como `load_room` — ver `bridge/world-claim.ts`. */
interface OpcionesDeCarga {
  tomaElMundo?: boolean;
}

/** API legacy (dropdown de fixtures, change_scene, saves sin migrar): mundo de
 *  UNA escena. El flujo narrativo de tiles usa addTile (aditivo). */
async function loadSceneData(
  rawData: Record<string, unknown>,
  opts: OpcionesDeCarga = {},
): Promise<void> {
  resetWorld();
  await addTile(rawData, opts);
}

/** Compone el PLAN del tile: `ground` + `volumes` declarados por el motor,
 *  completados con los derivados del esquema (vegetation_zones → árboles,
 *  structures → edificios). De aquí salen las dos cosas que el juego usa: la
 *  geometría 3D (FpsRenderer.installTile) y la colisión (applyPlanCollision).
 *  Devuelve null en escenas legacy sin plan ni primitivas derivables. */
function composeTilePlan(
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
  key: string,
  isGridTile: boolean,
): FpsTilePlan | null {
  if (!isGridTile) return null;
  let ground: GroundFeature[] = [];
  if (Array.isArray(data.ground)) {
    const parsed = parseGround(data.ground);
    if (parsed.ok) {
      ground = parsed.features;
    } else {
      errors.push("scene", `ground de ${key} inválido (${parsed.error}); se ignora`);
    }
  }
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
      ground,
    },
    declared,
  );
  const volumes = [...declared, ...derived];
  if (ground.length === 0 && volumes.length === 0) return null;
  return {
    ground,
    volumes,
    biome: typeof raw.biome === "string" ? raw.biome : undefined,
    scatter_generators: data.scatter_generators ?? raw.scatter_generators,
    scatter_zones: data.scatter_zones ?? raw.scatter_zones,
    scene_description:
      typeof raw.scene_description === "string" ? raw.scene_description
      : typeof data.scene_description === "string" ? data.scene_description
      : undefined,
  };
}

/** Añade un tile/escena al mundo del cliente. ADITIVO: no toca la posición del
 *  jugador (salvo bootstrap con __player_start o escenas legacy), no vacía las
 *  entidades de otros tiles, no resetea el sim. Re-añadir la misma clave
 *  sustituye (re-render al volver a un tile). */
async function addTile(
  rawData: Record<string, unknown>,
  opts: OpcionesDeCarga = {},
): Promise<void> {
  const data = formatDToWorld(rawData);
  const tile = data.tile as { tx: number; ty: number } | undefined;
  const isGridTile = Number.isInteger(tile?.tx) && Number.isInteger(tile?.ty);
  const key = isGridTile
    ? tileKey(tile!.tx, tile!.ty)
    : String(data.scene_id ?? "scene");
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
  // Plan del tile: los volumes del LLM completados con los derivados del
  // esquema (vegetación, estructuras). El plan lee campos del Format D crudo
  // (structures/vegetation_zones/biome) que la world scene no emite. Con el
  // bridge normalizando en el wire, rawData ya ES la world scene — el crudo
  // viaja en __format_d.
  const planInfo = composeTilePlan(
    (data.__format_d as Record<string, unknown> | undefined) ?? rawData,
    data as Record<string, unknown>,
    key,
    isGridTile,
  );
  if (planInfo) {
    (data as Record<string, unknown>).__plan = planInfo;
  }

  const prevEntry = tileStore.entries.get(key);
  const { sceneChanged } = tileStore.add({
    key,
    tx: isGridTile ? tile!.tx : undefined,
    ty: isGridTile ? tile!.ty : undefined,
    rect,
    scene: data as Record<string, unknown>,
    collider,
    // La colisión base del plan se deriva justo debajo (o se restaura si la
    // escena no cambió).
    svgCollider: null,
    svgApplied: false,
  });
  // Mundo 3D: spec fps del tile + layout de superficies (la clave del atlas).
  // ANTES de activarlo abajo: el atlas de superficies pide el layout al
  // renderer, y un tile sin instalar se quedaría en clay sin pedir nada.
  if (isGridTile && planInfo) {
    fpsRenderer.installTile(key, planInfo, rect);
    // Si ESTE ya es el tile activo, setActiveClientTile no volverá a correr
    // (solo se dispara al cambiar de tile): lanzar el atlas aquí.
    if (key === activeTileKey) {
      void fpsAtlasController.onActiveTile(key).catch((err: unknown) =>
        errors.push("scene", `el atlas fps de ${key} no arrancó al instalar el tile`, err),
      );
    }
  }
  // Colisión base del plan: restaurar si la escena no cambió; derivar
  // (analítica, síncrona) si es nueva o cambió. Agua∖decks del ground +
  // huellas de volumes — espacio de mundo.
  const plan = (data as { __plan?: FpsTilePlan }).__plan;
  if (prevEntry?.svgApplied && !sceneChanged) {
    tileStore.setSvgCollider(key, prevEntry.svgCollider);
  } else if (plan) {
    // La leyenda de ESTA escena decide si el agua declarada bloquea: un vado
    // (`{name, solid:false}`) tiene que abrirse en las DOS fuentes o el
    // jugador rebota contra un río que el autor abrió.
    applyPlanCollision(
      key,
      { ground: plan.ground, volumes: plan.volumes },
      rect,
      tileStore,
      (data.terrain_grid as TerrainGridData | undefined)?.solid_chars ?? DEFAULT_SOLID_CHARS,
    );
  }
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
  // NPCs: purga por IDENTIDAD de tile, nunca por rect — un NPC de otro tile
  // que paseó hasta aquí (vida ambiental del bridge) no debe borrarse. Solo
  // caen los que pertenecían a ESTE tile y ya no figuran en su scene data.
  npcEntities = npcEntities.filter((n) => !(n.tileKey === key && !npcIds.has(n.id)));
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
    const sizeY = scale && scale.length >= 3 ? scale[1] : undefined;
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
        sizeY,
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
        sizeY,
        shape,
        sceneDeclared: true,
      };
      objectEntities.push(objectEntity);
    }
  }

  // NPCs from room data (append: los de otros tiles siguen vivos). Un id ya
  // presente CONSERVA su Entity: la posición autoritativa es la del bridge
  // (vida ambiental) — recrearlo lo teletransportaría a su spawn del scene
  // data (stale) y perdería el skin en vuelo.
  const npcsData = (data.npcs ?? []) as Record<string, unknown>[];
  const newNpcs: Entity[] = [];
  for (const npc of npcsData) {
    const npcId = npc.id as string;
    const existing = npcEntities.find((n) => n.id === npcId);
    if (existing) {
      existing.tileKey = key;
      continue;
    }
    const npcPrompt = (npc.description ?? npc.name ?? npc.id) as string;
    // Ref de personaje: la elegida por el motor (style_ref) o el default
    // por rol (conserva las claves de caché de skins previas).
    const npcStyleRole = npcSkinStyleRef(npc as { style_ref?: string; role?: string });
    const entity: Entity = {
      id: npcId,
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
      styleRole: npcStyleRole,
      tileKey: key,
    };
    characterSprites.requestSkin(npcPrompt, { role: npcStyleRole });
    newNpcs.push(entity);
  }
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

  // Sim: los tiles de la PARTIDA añaden combatientes de forma ADITIVA (sin
  // reset), porque el mundo es un plano continuo. Tomar el mundo —el selector
  // «Room», o una escena legacy suelta— manda `load_room`, que además le dice
  // al bridge que lo que va a andar por aquí no es el jugador de la partida.
  if (gameClient) {
    if (opts.tomaElMundo || !isGridTile) {
      gameClient.loadRoom(data, key, enemies);
    } else {
      gameClient.addEnemies(enemies);
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
  fpsRenderer.setActiveTile(key);
  // Reinstala el atlas de caché o, con generación auto, lo pinta (el
  // controller degrada a clay con error visible si algo falla).
  void fpsAtlasController.onActiveTile(key).catch((err: unknown) =>
    errors.push("scene", `el atlas fps de ${key} no arrancó al activar el tile`, err),
  );
  currentExits = (entry.scene.exits ?? []) as SceneExit[];
  travelPanel.setExits(currentExits);
}

function rebuildEnemyBars(): void {
  enemyBarsContainer.innerHTML = "";
  for (const ee of enemyEntities) {
    const bar = document.createElement("div");
    bar.className = "nf-vital";
    bar.innerHTML = `<span class="nf-vital-label" style="color:${ee.color}">${ee.id}</span>
      <div class="nf-bar"><div class="nf-bar-fill" id="hp-${ee.id}" style="width:100%;background:${ee.color}"></div></div>
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
// Merge sobre nefanHook (defineProperties preserva los getters de ambos):
// las claves base (tiles/frontier/…) siguen disponibles también en DEV.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  Object.defineProperties(nefanHook, Object.getOwnPropertyDescriptors({
    state: () => ({
      pos: { ...playerPos },
      forward: { ...playerForward },
      /** Mirada vertical en grados (positivo = arriba). No entra en forward:
       *  el WASD es horizontal por diseño. */
      pitchDeg: (playerPitch * 180) / Math.PI,
      input: { ...input.state },
      dialogueActive: input.dialogueActive,
      combatSystem: sessionCombatSystemId,
      attackCatalog: attackCatalog.map((a) => a.id),
      blocked: {
        n: collidesAt(playerPos.x, playerPos.z - 0.5),
        s: collidesAt(playerPos.x, playerPos.z + 0.5),
        w: collidesAt(playerPos.x - 0.5, playerPos.z),
        e: collidesAt(playerPos.x + 0.5, playerPos.z),
      },
    }),
    npcs: () => npcEntities.map((n) => ({ id: n.id, label: n.label, pos: { ...n.pos } })),
    // Panel de dev (#dev-status): los benches E2E pueden leer/conducir su
    // estado (setPainting/recordGeneration) sin tocar píxeles.
    devPanel,
    probeCollide: (x: number, z: number) => collidesAt(x, z),
    fps: () => fpsRenderer.debugState(),
    get scene() { return sceneData; },
    // Gira al jugador desde el bench a un yaw arbitrario, sin pasar por las
    // flechas de dirección. Mismo camino que el giro real: yaw → snap.
    setYaw: (yaw: number) => {
      playerYaw = yaw;
      refreshPlayerForward();
    },
    // Teletransporte del bench: posiciona al jugador para las capturas
    // deterministas (respeta la simulación en el siguiente tick — la colisión
    // "salir sí, entrar no" permite des-penetrar si el destino es sólido).
    setPlayerPos: (x: number, z: number) => {
      playerPos.x = x;
      playerPos.z = z;
    },
    // --- API del runner de QA (qa/run.mjs) ---
    // El guion espera por ESTADO, nunca por sleep: el movimiento va por delta
    // de rAF y el typewriter por setInterval, así que ningún tiempo de pared
    // es determinista.
    /** ¿Juego jugable y quieto? Título cerrado, escena cargada y sin pintura
     *  en curso — hoy la del atlas de superficies de la fps, que es el único
     *  pipeline de imagen que puede estar en vuelo mientras se juega (el del
     *  plató, que ocupaba este sitio, ya no existe). El detalle de por qué NO,
     *  en status(). */
    ready: () =>
      !titleScreen.isVisible && sceneData !== null && !fpsAtlasController.running,
    status: () => ({
      title: titleScreen.isVisible,
      scene: sceneData !== null,
      painting: fpsAtlasController.running,
      npcs: npcEntities.length,
    }),
    /** Estado del diálogo, o `{visible:false}`. */
    dialogue: () =>
      dialoguePanel.isVisible
        ? { visible: true, ...dialoguePanel.current() }
        : { visible: false },
    /** Elige una opción por índice (0-based). Salta el typewriter primero,
     *  igual que hace cualquier tecla de acción del jugador. */
    chooseDialogue: (index: number) => {
      dialoguePanel.finishTypewriter();
      dialoguePanel.chooseByIndex(index);
    },
    advanceDialogue: () => {
      dialoguePanel.finishTypewriter();
      dialoguePanel.advance();
    },
    /** Cierra el título por el MISMO camino que el jugador (botón #ts-close),
     *  no ocultando el overlay a mano. */
    closeTitle: () => {
      const btn = document.getElementById("ts-close");
      if (!btn) throw new Error("no hay #ts-close: el título no está montado");
      (btn as HTMLButtonElement).click();
    },
    /** Carga una fixture del selector Room por nombre parcial, conduciendo el
     *  <select> real. Fail-loud si no existe: un guion que "no encuentra" la
     *  escena y sigue en verde no vale nada. */
    loadFixture: (name: string) => {
      const option = [...sceneSelector.options].find((o) => o.value.includes(name));
      if (!option) {
        throw new Error(
          `fixture "${name}" no está en el selector; hay: ${[...sceneSelector.options]
            .map((o) => o.label)
            .join(", ")}`,
        );
      }
      sceneSelector.value = option.value;
      sceneSelector.dispatchEvent(new Event("change"));
    },
    // Driver programático del provider "scripted" (?input=scripted) — API
    // limpia para el bench en vez de sintetizar KeyboardEvents.
    inputDriver: input instanceof ScriptedInputProvider ? input : undefined,
  }));
}

// --- Orientación con flechas de dirección (y ratón en fps) ---
let playerYaw = Math.PI; // facing -Z initially

/** Inclinación de la MIRADA en fps, en radianes (positivo = hacia arriba).
 *  No entra en `playerForward`: el jugador camina por el suelo, mirar abajo
 *  no puede empujarle contra el suelo. Solo la consumen la cámara y la
 *  puntería. */
let playerPitch = 0;

/** Sensibilidad del mouse look en fps: radianes por píxel de movimiento del
 *  ratón bajo pointer lock (~0.14°/px, en el rango típico de un FPS). Misma
 *  para yaw y pitch: una sensibilidad distinta por eje se siente como un
 *  ratón roto. */
const MOUSE_SENS_RAD_PER_PX = 0.0025;

/** Tope de la mirada vertical: 85°, no 90°. Pasar de la vertical invierte el
 *  marco de la cámara (el mundo se da la vuelta) y en la vertical exacta el
 *  yaw deja de estar definido — es el gimbal lock del orden YXZ. Los 5° de
 *  margen son gratis: a 85° ya te estás mirando las botas. */
const PITCH_LIMIT_RAD = (85 * Math.PI) / 180;

/** Paso de ↑/↓ en fps: hermanas de los 45° de ←/→, pero 15° — el eje
 *  vertical recorre 170° en total y a 45° por pulsación solo tendría cuatro
 *  posiciones. */
const PITCH_STEP_RAD = (15 * Math.PI) / 180;

function setPlayerPitch(rad: number): void {
  playerPitch = Math.min(PITCH_LIMIT_RAD, Math.max(-PITCH_LIMIT_RAD, rad));
}

/** El yaw es CONTINUO (mouse look): el forward sale de él sin snap — el
 *  jugador no se dibuja como sprite, y los sprites 8-dir de los NPCs ya
 *  cuantizan solos desde un yaw continuo. (La oblicua snapeaba a los 8 ejes
 *  de animación para que el sprite del jugador y su desplazamiento
 *  coincidieran; sin sprite de jugador esa restricción se fue con ella.)
 *
 *  El forward es SIEMPRE horizontal (`y: 0`): es el marco del WASD, y mirar
 *  al suelo no puede hacerte caminar hacia el suelo. La mirada vertical vive
 *  aparte, en `playerPitch`. */
function refreshPlayerForward(): void {
  playerForward = { x: Math.sin(playerYaw), y: 0, z: Math.cos(playerYaw) };
}

let prevTurnLeft = false;
let prevTurnRight = false;
let prevTurnUp = false;
let prevTurnDown = false;

/** Mouse look con yaw CONTINUO (ratón a la derecha = girar a la derecha,
 *  mismo signo que turnRight) y pitch CONTINUO (ratón abajo = mirar abajo,
 *  sin invertir), más los pasos de ←/→ (45° de yaw) y ↑/↓ (15° de pitch) por
 *  pulsación — flanco de subida, mantener no repite. */
function applyTurnKeys(): void {
  const look = input.consumeLookDelta();
  if (look.dx !== 0) {
    playerYaw -= look.dx * MOUSE_SENS_RAD_PER_PX;
    refreshPlayerForward();
  }
  // El pitch NO pasa por refreshPlayerForward: el forward es el marco del
  // WASD y sigue siendo horizontal por diseño.
  if (look.dy !== 0) setPlayerPitch(playerPitch - look.dy * MOUSE_SENS_RAD_PER_PX);
  if (input.state.turnLeft && !prevTurnLeft) {
    playerYaw += Math.PI / 4;
    refreshPlayerForward();
  }
  if (input.state.turnRight && !prevTurnRight) {
    playerYaw -= Math.PI / 4;
    refreshPlayerForward();
  }
  if (input.state.turnUp && !prevTurnUp) setPlayerPitch(playerPitch + PITCH_STEP_RAD);
  if (input.state.turnDown && !prevTurnDown) setPlayerPitch(playerPitch - PITCH_STEP_RAD);
  prevTurnLeft = input.state.turnLeft;
  prevTurnRight = input.state.turnRight;
  prevTurnUp = input.state.turnUp;
  prevTurnDown = input.state.turnDown;
}

// Pointer lock sobre el lienzo del mundo: oculta el cursor, habilita el mouse
// look y atacar con LMB.
fpsRenderer.element.addEventListener("click", () => {
  if (!dialoguePanel.isVisible) {
    // El navegador RECHAZA la captura si el documento no tiene el foco o si
    // se sale del lock y se vuelve a pedir demasiado pronto. El cliente no
    // tiene handler de `unhandledrejection`, así que sin este canal el ratón
    // simplemente no se capturaba y no lo decía nadie.
    paso(fpsRenderer.element.requestPointerLock(), "input", "no se pudo capturar el ratón (pointer lock)");
  }
});

// Overlay B "colisión": muestreo del CollisionSystem (fuente única de verdad)
// por celda de 0,5 m del tile — el renderer NO tiene colisión propia.
fpsRenderer.setCollisionCellsProvider((tileKey) => {
  const entry = tileStore.entries.get(tileKey);
  if (!entry) return null;
  const size = 0.5; // TILE_MPC
  const cells: [number, number][] = [];
  for (let z = entry.rect.minZ; z < entry.rect.maxZ - 1e-9; z += size) {
    for (let x = entry.rect.minX; x < entry.rect.maxX - 1e-9; x += size) {
      if (collidesAt(x + size / 2, z + size / 2)) cells.push([x, z]);
    }
  }
  return { cells, size };
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

/** La fixture que el desplegable está enseñando DE VERDAD (vacío = ninguna: el
 *  mundo viene del bridge, o aún no se ha elegido). El `<select>` se actualiza
 *  solo al elegir, así que sin esto no hay a dónde volver cuando la carga
 *  falla. */
let fixtureCargada = "";

sceneSelector.addEventListener("change", () => {
  const value = sceneSelector.value;
  if (!value) return;
  // Sin canal, un módulo de fixture que no carga dejaba el selector en un
  // no-op MUDO (el modo de fallo de #181): la escena no cambiaba, el rechazo
  // se perdía y quien conduce el preset `html-fixtures` no se enteraba de
  // nada. Ahora el fallo llega al registro de errores y a la línea del juego.
  //
  // Y el desplegable VUELVE. Decir «no cargó» y dejar la etiqueta apuntando a
  // la fixture que no cargó es cambiar el fallo mudo por uno que miente: la
  // pantalla diría dos cosas distintas sobre qué escena se está viendo, y el
  // mensaje se va del log en ocho líneas mientras la etiqueta se queda.
  const anterior = fixtureCargada;
  fixtureCargada = value;
  paso(loadSceneFile(value), "scene", `no se pudo cargar la fixture ${value}`, () => {
    log(`⚠ no se pudo cargar la escena ${value}`);
    // Salvo que mientras tanto se haya elegido otra: revertir por encima de una
    // elección posterior sería mentir en la otra dirección.
    if (sceneSelector.value !== value) return;
    fixtureCargada = anterior;
    sceneSelector.value = anterior;
  });
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
// Evita reenviar interact_entity mientras el motor narrativo aún responde:
// con un cooldown fijo corto, una segunda pulsación de E antes de que llegue
// la respuesta duplicaba el saludo en recent_dialogues del LLM. El guard se
// limpia cuando llega la respuesta (narrative_event o error del motor), con
// tope de 30 s por si no llega nada.
let interactPendingUntil = 0;

// --- Etiquetas de mundo y mirilla (primera persona) ---
// En 1ª persona no hay ctx 2D sobre el que escribir el nombre del NPC: las
// etiquetas viven en DOM (world-labels.ts) y se proyectan con la cámara del
// frame recién pintado. La decisión de QUÉ se mira es lógica pura del core
// (pickAimTarget): en 1ª persona "lo que tienes delante" no es lo más cercano.

/** Alcance al que se muestra el nombre de un personaje. */
const LABEL_RANGE_M = 18;
/** Alcance de la puntería: cerca, para que encender la mirilla signifique
 *  algo ("puedo tratar con esto"), no "hay algo por ahí". */
const AIM_RANGE_M = 12;
/** Semiángulo del cono de puntería (≈9°: el ancho de un NPC a 6 m). Cerca
 *  manda el cuerpo (radiusM), no el cono. */
const AIM_CONE_RAD = (9 * Math.PI) / 180;
/** Media anchura de un personaje en metros: se apunta a su cuerpo. */
const BODY_RADIUS_M = 0.6;
/** Media ALTURA de un personaje: el cuerpo al que se apunta es un elipsoide
 *  de pie, no una bola. Con pitch la mirada le entra por las rodillas o por
 *  la cabeza tanto como por el pecho. */
const BODY_HALF_HEIGHT_M = 0.9;
/** Centro del cuerpo sobre sus pies — el punto al que se mira. */
const BODY_CENTER_Y_M = 0.95;
/** La descripción de un objeto es prosa del motor, no un nombre: se recorta. */
const LABEL_MAX_CHARS = 42;
/** Altura del nombre sobre los pies de un personaje (el frame y_bot mide
 *  2.4 m y los pies caen al 15 % desde abajo). */
const NPC_LABEL_Y_M = 2.15;

function recorta(text: string): string {
  const t = text.trim();
  return t.length > LABEL_MAX_CHARS ? `${t.slice(0, LABEL_MAX_CHARS - 1)}…` : t;
}

/** Sincroniza etiquetas y mirilla con el frame recién pintado. Con el diálogo
 *  abierto (dueño de la pantalla) se retiran: una etiqueta huérfana pegada al
 *  lienzo es peor que ninguna. */
function updateWorldLabels(): void {
  const fps = fpsRenderer;
  if (dialoguePanel.isVisible) {
    worldLabels.clear();
    reticleEl.dataset.target = "false";
    return;
  }
  const personajes = npcEntities.filter((n) => n.alive !== false);
  // Solo objetos CON nombre: sin descripción no hay nada que enseñar, y la
  // mirilla debe encenderse únicamente sobre lo que sí se puede nombrar.
  // Los edificios declarados en la escena quedan fuera: los pinta el greybox
  // por volúmenes y su centro no es un punto al que se pueda apuntar.
  const objetos = objectEntities.filter(
    (o) => Boolean(o.label?.trim()) && !(o.sceneDeclared && o.category === "building"),
  );

  // El rayo de la CÁMARA, no la proyección horizontal del forward: desde que
  // se puede mirar arriba y abajo, apuntar es apuntar de verdad — con la
  // mirada en el suelo no se enciende la mirilla de quien tienes delante.
  const ojo = fps.cameraRay();
  if (!ojo) {
    // three aún cargando: sin cámara no hay puntería ni proyección.
    worldLabels.clear();
    reticleEl.dataset.target = "false";
    return;
  }
  const aim = pickAimTarget(
    ojo.origin,
    ojo.dir,
    [
      ...personajes.map((e) => ({
        id: e.id,
        pos: { x: e.pos.x, y: fps.groundYAt(e.pos.x, e.pos.z) + BODY_CENTER_Y_M, z: e.pos.z },
        radiusM: BODY_RADIUS_M,
        halfHeightM: BODY_HALF_HEIGHT_M,
      })),
      // El bulto real del objeto, no su `radius` de dibujo (que en el 2D vale
      // 8 m para un edificio y convertiría media escena en objetivo).
      ...objetos.map((e) => {
        const alto = e.sizeY ?? 1;
        return {
          id: e.id,
          pos: { x: e.pos.x, y: fps.groundYAt(e.pos.x, e.pos.z) + alto / 2, z: e.pos.z },
          radiusM: Math.min(2, Math.max(e.sizeXZ?.x ?? 0, e.sizeXZ?.z ?? 0) / 2 || BODY_RADIUS_M),
          halfHeightM: alto / 2,
        };
      }),
    ],
    { maxDistanceM: AIM_RANGE_M, coneRad: AIM_CONE_RAD },
  );
  reticleEl.dataset.target = aim ? "true" : "false";

  const labels: WorldLabel[] = [];
  for (const n of personajes) {
    if (Math.hypot(n.pos.x - playerPos.x, n.pos.z - playerPos.z) > LABEL_RANGE_M) continue;
    const text = recorta(n.name ?? n.label ?? n.id);
    if (!text) continue;
    labels.push({
      id: n.id,
      text,
      pos: { x: n.pos.x, y: fps.groundYAt(n.pos.x, n.pos.z) + NPC_LABEL_Y_M, z: n.pos.z },
      focus: aim?.id === n.id,
    });
  }
  // Los objetos se nombran solo cuando los MIRAS: una aldea entera etiquetada
  // es ruido, no información.
  const mirado = aim ? objetos.find((o) => o.id === aim.id) : undefined;
  if (mirado) {
    labels.push({
      id: mirado.id,
      text: recorta(mirado.label),
      pos: {
        x: mirado.pos.x,
        y: fps.groundYAt(mirado.pos.x, mirado.pos.z) + (mirado.sizeY ?? 1) + 0.3,
        z: mirado.pos.z,
      },
      focus: true,
    });
  }
  worldLabels.sync(labels, (x, y, z) => fps.projectToScreen(x, y, z));
}

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

  // Aviso de pintura en vuelo del panel dev: el único pipeline que puede
  // gastar mientras se juega es el atlas de superficies. El panel solo
  // repinta en el cambio de estado.
  devPanel.setPainting(fpsAtlasController.running);

  // R: respawn (solo surte efecto con el player muerto).
  if (input.consumeRespawn()) handleRespawnRequest();

  // Generación IA del escenario (dev): G pide el atlas de superficies del
  // tile ACTIVO. Async fire-and-forget — el controlador ya loguea fallos a
  // ErrorLog; el .catch evita unhandled rejection.
  if (devInput.consumeGenerateScene()) {
    // Manual = siempre permitida, también con la generación auto en OFF
    // (misma semántica que el botón por-item del menú dev).
    if (activeTileKey) {
      const k = activeTileKey;
      void fpsAtlasController.runFor(k).catch((err: unknown) =>
        errors.push("scene", `el atlas fps de ${k} no arrancó (tecla G)`, err),
      );
    }
  }
  // B cicla la vista de debug: off → colisión (celdas sólidas + forward de
  // NPCs) → celdas de atlas (tinte por celda).
  if (devInput.consumeToggleCollisionDebug()) {
    const mode = fpsRenderer.cycleDebugView();
    log(`B · fps: ${FPS_DEBUG_VIEW_LABELS[mode]}`);
  }

  // Movement (suppressed during dialogue). El jugador NUNCA se congela por la
  // generación de mundo: la frontera bloquea solo direccionalmente.
  if (dialoguePanel.isVisible) {
    // El diálogo suspende la propuesta de tile: sus teclas Y/N quedan mudas.
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
      // Fuera de fps, playerForward está SNAPEADO a los 8 ejes de animación
      // (refreshPlayerForward) y las combinaciones de teclas bisecan ejes
      // adyacentes (45°), así que TODA dirección de desplazamiento cae en uno
      // de los 8 ejes — en isométrica, o sobre las líneas de la cuadrícula
      // (diagonales de pantalla) o de vértice a vértice (horizontal/vertical).
      // En fps el forward es continuo (mouse look) y el marco vale igual.
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
    if (session.active && tileStore.hasGridTiles) {
      const requestTile = (tx: number, ty: number, edge: FrontierEdge, reason: "prefetch" | "blocking"): void => {
        tileLedger.pedido(`tile_${tx}_${ty}`);
        narrativeClient.requestTile(tx, ty, reason, edge);
      };
      const { veil, timedOut, proposal } = frontier.tick(
        performance.now(),
        playerPos.x,
        playerPos.z,
        tileStore,
        requestTile,
      );
      // El velo es un MURO DE NIEBLA sobre la frontera, no una banda de HUD.
      // Ahí el mundo se acaba de verdad, y verlo disiparse al llegar el
      // vecino cuenta "el mundo continúa" sin escribirlo.
      fpsRenderer.setFrontierVeil(veil?.edge ?? null);
      for (const key of timedOut) {
        errors.push("narrative", `El tile ${key} no llegó a tiempo (timeout); se reintentará al acercarse.`);
      }
      input.tileProposalActive = proposal !== null;
      if (proposal) {
        setConfirmPrompt({
          text: `¿Explorar hacia el ${EDGE_ES[proposal.edge]}? Se generará una zona nueva.`,
          yes: "sí, explorar",
          no: "no",
          onYes: () => input.queueTileConfirm(),
          onNo: () => input.queueTileDecline(),
        });
        if (input.consumeTileConfirm()) {
          frontier.confirmProposal(performance.now(), requestTile);
          log(`Generando la zona al ${EDGE_ES[proposal.edge]} (${proposal.key})...`);
        } else if (input.consumeTileDecline()) {
          frontier.declineProposal();
        }
      } else {
        setConfirmPrompt(null);
      }
    } else {
      // Sin frontera activa no hay nada que proponer: prompt fuera.
      fpsRenderer.setFrontierVeil(null);
      input.tileProposalActive = false;
      setConfirmPrompt(null);
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

  // Acciones contextuales: lo que el jugador puede hacer AQUÍ, como botones
  // con su tecla. El click empuja la misma intención que la tecla, así que
  // aguas abajo son indistinguibles.
  promptBar.set([
    ...(npcInRange && !dialoguePanel.isVisible
      ? [{
          id: "interact",
          label: `hablar con ${npcInRange.name ?? npcInRange.id}`,
          key: "E",
          invoke: () => input.queueInteract(),
        }]
      : []),
    ...(!playerAlive
      ? [{ id: "respawn", label: "reaparecer", key: "R", invoke: () => input.queueRespawn() }]
      : []),
  ]);

  const interactPressed = input.consumeInteract();
  if (interactPressed && npcInRange && !dialoguePanel.isVisible && now >= interactPendingUntil) {
    interactPendingUntil = now + 30000;
    const name = (npcInRange.name ?? npcInRange.id) as string;
    lastInteractedId = npcInRange.id;
    narrativeClient.interactEntity(npcInRange.id, name);
    log(`Hablando con ${name}...`);
  }

  if (dialoguePanel.isVisible) portrait.tick(now);

  // Attack
  const attackRequested = dialoguePanel.isVisible ? false : input.consumeAttack();

  // Tick — pero NO mientras el título cubre la pantalla: ahí no hay jugador
  // que simular. El frame que se mandaba llevaba la posición por defecto del
  // cliente y, ahora que el save arrastra la posición viva del sim (#245),
  // conducía la partida que el jugador acababa de dejar hasta el origen.
  const result: FrameResult = titleScreen.isVisible
    ? gameClient.idle()
    : gameClient.tick(delta, {
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
      // Calidad del destello = la del ÁREA de core, la misma que resuelve el
      // daño. Aquí vivía una tercera copia de la fórmula (distancia ×
      // precisión escritas a mano) que además se saltaba el cono frontal: un
      // enemigo a la espalda teñía el destello de verde mientras el resolver
      // no le hacía ni un punto de daño. El color no adorna, informa.
      //
      // La PROYECCIÓN al plano del ataque también es de core: escrita aquí no
      // había forma de afirmarla —el cliente no tiene harness— y era la mitad
      // de la fórmula que se saltaba el cono.
      const params = attackVisual?.params ?? getSelectedParams();
      attackVisual = {
        active: true,
        mode: "impact",
        params,
        impactQuality: attackFlashQuality(
          params,
          playerPos,
          playerForward,
          enemyEntities.filter((ee) => ee.alive).map((ee) => ee.pos),
        ),
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

  // Sync ambient NPCs from result: el bridge es autoritativo sobre pos y
  // forward; trackMoving detecta el delta y dispara walk/run solo. Un id sin
  // Entity local es de un tile aún no cargado en el cliente — se ignora.
  for (const npcState of result.npcs ?? []) {
    const ne = npcEntities.find((n) => n.id === npcState.id);
    if (!ne) continue;
    ne.pos = { x: npcState.pos.x, y: npcState.pos.y, z: npcState.pos.z };
    ne.forward = { x: npcState.forward.x, y: npcState.forward.y, z: npcState.forward.z };
    ne.requestedAnim = npcState.anim;
    ne.npcRun = npcState.run;
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
      angle: worldAngle,
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
  const attackOpacity = attackVisual?.active
    ? (attackVisual.mode === "impact" ? (attackVisual.fadeTimer / 0.3) * 0.5 : 0.3)
    : 0;
  // Telegraph del ataque en PRIMERA PERSONA: es geometría de mundo (la
  // distancia y la precisión deciden el daño), así que se fija ANTES de
  // render(). En WebGL no queda lienzo sobre el que garabatear una vez
  // emitido el frame — el patrón "dibuja después" de un lienzo 2D no vale.
  // Mirada vertical: como el telegraph y el velo, estado de la vista que se
  // fija ANTES de render(). No viaja en PlayerView porque `forward` es el
  // marco del MOVIMIENTO y es horizontal por diseño.
  fpsRenderer.setLookPitch(playerPitch);
  fpsRenderer.setAttackTelegraph(
    attackVisual?.active
      ? {
          player: { pos: playerPos, forward: playerForward },
          params: attackVisual.params,
          mode: attackVisual.mode,
          opacity: attackOpacity,
          impactQuality: attackVisual.impactQuality,
        }
      : null,
  );

  try {
    fpsRenderer.render(
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

  // Etiquetas de mundo y mirilla: DESPUÉS de render(), con las matrices de
  // cámara de este mismo frame.
  updateWorldLabels();

  scheduleNextFrame();
}

// --- Init ---

populateSceneSelector();

// El override de bench `?bridge=` (stack E2E de labs/narrative) se resuelve en
// net/service-urls.ts.
const sharedBridge = new BridgeClient(serviceUrl("game-gateway"));
const narrativeClient = new NarrativeClient(sharedBridge);
const titleScreen = new TitleScreen(narrativeClient);
const historyBrowser = new HistoryBrowser(narrativeClient);

// Cambio de modo de render difundido por el bridge (otro cliente de la misma
// sesión, o el eco de este — re-aplicar es idempotente).
sharedBridge.on("render_mode_changed", (msg) => {
  if (msg.sessionId !== session.id) return;
  applyRenderModes(
    msg.facet === "scenes" ? msg.renderMode : scenesMode,
    msg.facet === "characters" ? msg.renderMode : charactersMode,
  );
});

/** Imágenes actualmente FAKE: tiles del grid sin atlas de superficies y skins
 *  de personaje aún sobre la base y_bot. La identidad del item es la clave del
 *  tile o el prompt. */
function listFakeItems(): FakeItem[] {
  const items: FakeItem[] = [];
  const textured = new Set(
    (fpsRenderer.debugState() as { textured?: string[] }).textured ?? [],
  );
  for (const t of tileStore.entries.values()) {
    if (t.tx === undefined || textured.has(t.key) || !fpsRenderer.getTileSurfaces(t.key)) continue;
    items.push({
      kind: "fps_atlas",
      id: t.key,
      label: `Atlas fps ${t.key} (clay — celdas ya en la librería salen gratis)`,
      // Sin miniatura: una del canvas WebGL es otro trabajo.
      thumb: null,
      inFlight: fpsAtlasController.running,
    });
  }
  const prompts = new Set<string>();
  if (playerSkinPrompt) prompts.add(playerSkinPrompt);
  for (const e of [...npcEntities, ...enemyEntities]) {
    if (e.skinPrompt) prompts.add(e.skinPrompt);
  }
  const yBotSheet = spriteRenderer.getCached(BASE_MODEL, "idle", characterSprites.activeAngle);
  const yBotThumb = yBotSheet?.frames[0]?.[0] ?? null;
  for (const prompt of prompts) {
    const status = characterSprites.skinStatus(prompt);
    if (status === "ready") continue;
    const statusEs =
      status === "pending" ? "generándose" : status === "failed" ? "falló" : "base y_bot";
    items.push({
      kind: "skin",
      id: prompt,
      label: `Skin: ${prompt.length > 70 ? `${prompt.slice(0, 70)}…` : prompt} (${statusEs})`,
      thumb: yBotThumb,
      inFlight: status === "pending",
      disabledReason: CONFIG.graphics.ai_skin
        ? undefined
        : "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts",
    });
  }
  return items;
}

/** Generación selectiva de UN item fake (siempre permitida, con el toggle
 *  global en OFF incluido — es la vía de gasto controlado del menú dev). */
async function generateFakeItem(item: FakeItem): Promise<void> {
  if (item.kind === "fps_atlas") {
    await fpsAtlasController.runFor(item.id);
    return;
  }
  characterSprites.requestSkin(item.id, { force: true });
}

devMenu = new DevMenu({
  listFakeItems,
  generate: generateFakeItem,
  log: (msg) => log(msg),
});

// Chip de gráficos (UI de cliente): el MISMO modo que se elige al crear la
// partida en el título, visible y cambiable en juego. El cambio va por
// requestModeChange (bridge con sesión / localStorage sin ella) — nunca por
// bridge-client directo.
graphicsChip = new GraphicsModeChip({
  getState: () => ({
    scenesOn: scenesGenerationOn(),
    charsOn: characterSprites.skinsAllowed && CONFIG.graphics.ai_skin,
    charsAvailable: CONFIG.graphics.ai_skin,
    hasSession: session.active,
  }),
  setMode: (facet, mode) => requestModeChange(facet, mode),
});
// Oculto mientras el título está abierto (ahí el modo se elige en el propio
// título); reaparece al cerrarlo — incluido el cierre fixtures (#ts-close).
//
// Y con él, TODO lo que se leía por debajo del título: el HUD de juego y el
// error-log asomaban entre el texto porque la partida seguía pintando detrás
// (#246). Un interruptor y no una lista de widgets: el motivo lo lleva el
// propio título, así que quien añada un panel nuevo no tiene que acordarse de
// nada. `dataset.titulo` es lo que lee la regla de CSS.
titleScreen.onVisibilityChange = (visible) => {
  graphicsChip?.setHidden(visible);
  document.documentElement.dataset.titulo = visible ? "1" : "0";
};
// Corrida de «Aplicar estilo» para el bench/QA: lo prometido, lo emitido y si
// ya terminó. Lo escribe el propio StyleApplyController.
(nefanHook as { estilo?: unknown }).estilo = () => titleScreen.styleRunState();

dialoguePanel.onChoice = (idx, text) => {
  input.dialogueActive = false;
  if (!session.active) return;
  const cur = dialoguePanel.current();
  narrativeClient.sendDialogueChoice({
    eventId: `client_${Date.now()}`,  // bridge generates the canonical id
    choiceIndex: idx,
    speaker: cur.speaker,
    speakerId: cur.speakerId,
    chosenText: text,
  });
};

dialoguePanel.onFreeText = (freeText) => {
  input.dialogueActive = false;
  if (!session.active) return;
  const cur = dialoguePanel.current();
  narrativeClient.sendDialogueChoice({
    eventId: `client_${Date.now()}`,
    choiceIndex: -1,
    speaker: cur.speaker,
    speakerId: cur.speakerId,
    chosenText: freeText,
    freeText,
  });
};

travelPanel.onTravel = (placeId) => {
  if (!session.active) return;
  showLoader("Viajando...", "El motor narrativo está preparando el lugar.");
  travelLedger.pedido(placeId);
  narrativeClient.enterPlace(placeId);
};

// --- Narrative loader (status-driven overlay) ---
const loaderEl = document.getElementById("narrative-loader") as HTMLDivElement | null;
const loaderTitle = document.getElementById("narrative-loader-title");
const loaderDetail = document.getElementById("narrative-loader-detail");
const loaderElapsed = document.getElementById("narrative-loader-elapsed");
const loaderDismiss = document.getElementById("narrative-loader-dismiss");
const loaderBack = document.getElementById("narrative-loader-back");

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

/** El motivo del último muro que ofrecía volver al título. Se lo lleva el
 *  título en la vuelta: quien pulsa «Volver al título» acaba de leerlo, pero
 *  llegar a una pantalla que no dice nada de lo que acaba de pasar es la
 *  mitad muda de #189 («vuelve al título VIVO, con el motivo en pantalla»). */
let motivoDelUltimoMuro: string | null = null;

function hideLoader(): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("visible", "error");
  if (loaderBack) loaderBack.hidden = true;
  if (loaderDismiss) loaderDismiss.hidden = false;
  // El muro se va y su motivo con él: quien lo lea después
  // (`volverAlTitulo`) tiene que leerlo ANTES de cerrarlo, no heredarlo de un
  // fallo viejo.
  motivoDelUltimoMuro = null;
  if (loaderTicker) {
    clearInterval(loaderTicker);
    loaderTicker = null;
  }
}

/** `salida` dice qué puede HACER el jugador con este muro. Por defecto,
 *  cerrarlo y seguir con su partida; `volver-al-titulo` cuando detrás no hay
 *  partida ninguna y cerrar le dejaría sin nada que pulsar (#189). */
function setLoaderState(
  state: "error",
  title: string,
  detail: string,
  salida: SalidaDelOverlay = "cerrar",
): void {
  if (!loaderEl) return;
  loaderEl.classList.remove("error");
  loaderEl.classList.add("visible", state);
  if (loaderTitle) loaderTitle.textContent = title;
  if (loaderDetail) loaderDetail.textContent = detail;
  const sinMundo = salida === "volver-al-titulo";
  if (loaderBack) loaderBack.hidden = !sinMundo;
  // Y sin mundo NO HAY ADÓNDE CERRAR: «Cerrar» dejaba al jugador en el mismo
  // callejón de #189 que la salida de al lado venía a abrir —cielo vacío,
  // cinco botones de ataque y recargar— y con el mismo peso visual, así que
  // media pantalla pulsaba la que no era. Donde sí sigue estando es en los
  // muros que tienen partida detrás (`salida: "cerrar"`), que son todos los
  // demás — incluido el del arranque sin bridge, que es el que cierra
  // `qa/fixtures-sin-bridge.mjs` para entrar al modo fixtures.
  if (loaderDismiss) loaderDismiss.hidden = sinMundo;
  motivoDelUltimoMuro = sinMundo ? `${title}. ${detail}` : null;
  if (loaderTicker) {
    clearInterval(loaderTicker);
    loaderTicker = null;
  }
}

if (loaderDismiss) loaderDismiss.onclick = () => hideLoader();
if (loaderBack) {
  loaderBack.onclick = () => paso(volverAlTitulo(), "session", "volver a la pantalla de título");
}

narrativeClient.onNarrativeStatus((status) => {
  // ── Latido de progreso del motor narrativo ────────────────────────────
  // Un paso observable (petición recogida, tool de estado llamada): el
  // loader deja de ser una espera muda de minutos y narra qué está pasando.
  if (status.phase === "progress") {
    if (status.message) updateLoaderProgress(status.message);
    return;
  }

  // ── Ledger de viaje ───────────────────────────────────────────────────
  // Se apunta ANTES de decidir qué pintar: lo que el juego recuerda del viaje
  // no puede depender de por qué rama del switch de abajo salga el status.
  if (status.placeId && status.enqueued) travelLedger.encolado(status.placeId, status.enqueued);
  if (status.phase === "error") travelLedger.fallo(status.placeId, status.message ?? "sin mensaje");

  // ── Spawn PEDIDO por el bridge ────────────────────────────────────────
  // Viajar por el panel «Salidas» a un lugar que no existía lo ancla a un
  // tile del plano: el bridge no escribe la posición (es del cliente), la
  // PIDE en el ready. El scene_init del tile ya llegó justo antes.
  if (status.phase === "ready" && status.spawn) {
    playerPos.x = status.spawn.x;
    playerPos.z = status.spawn.z;
    travelLedger.spawn(status.spawn);
  }

  // ── Tiles del plano continuo ──────────────────────────────────────────
  // El feedback de un tile es DIRECCIONAL (velo/flash del FrontierManager),
  // no el overlay central — salvo el bootstrap (mundo aún vacío).
  if (status.kind === "tile") {
    const t = status.tile;
    if (t) {
      const key = `tile_${t.tx}_${t.ty}`;
      if (status.phase === "ready") tileLedger.llegado(key, status.source ?? null);
      if (status.phase === "error") tileLedger.fallo(key, status.message ?? "sin mensaje");
    }
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
        if (t) frontier.onTileError(t.tx, t.ty);
        // Qué se lee y DÓNDE lo decide una función pura de core: con overlay
        // abierto (bootstrap del mundo o viaje desde «Salidas») el error va
        // AL overlay, porque si no el jugador se queda mirando un
        // "Viajando..." que ya no va a terminar nunca; una frontera que se
        // genera sola en segundo plano, a la línea de mensajes.
        pintarFalloDelMotor(status);
        break;
      }
    }
    return;
  }

  if (status.kind === "scene") {
    switch (status.phase) {
      case "generating":
        // Con `placeId` esto es un VIAJE, y el rótulo se queda en «Viajando…»:
        // es lo que el jugador acaba de pulsar y lo que va a leer durante toda
        // la espera (30-60 s con el motor real). «Generando escena…» es jerga
        // de motor y además no casa con su propio detalle («Viajando a X…»).
        showLoader(
          status.placeId ? "Viajando..." : "Generando escena...",
          status.message ?? "El motor narrativo está construyendo el mundo. Puede tardar un momento.",
        );
        break;
      case "ready":
        hideLoader();
        break;
      case "error":
        pintarFalloDelMotor(status);
        break;
    }
    return;
  }

  // Estados que no son de escena (consequences / plugins). El bridge sólo los
  // emite en error: una reacción narrativa rechazada (p.ej. 422 de
  // /report_player_choice por una consequence mal formada). Sin esto el error
  // se traga en silencio — el jugador no ve diálogo ni motivo. Lo surgimos al
  // error-log y a un overlay descartable.
  if (status.phase === "error") {
    interactPendingUntil = 0;
    pintarFalloDelMotor(status);
  }
});

/** Enseña un fallo del motor donde toque. El TÍTULO ya no se decide aquí:
 *  `main.ts` pintaba «Error al generar el mundo» y «Error al generar la
 *  escena» —jerga de motor— encima de un cuerpo que el bridge ya había
 *  escrito para quien juega (#180). Ahora el rótulo sale de `rotuloDeStatus`
 *  (nefan-core), que además decide si el fallo tapa la pantalla o se queda en
 *  la línea de mensajes; el cliente solo pinta. */
function pintarFalloDelMotor(status: NarrativeStatusMessage): void {
  const rotulo = rotuloDeStatus(status, {
    mundoVacio: !tileStore.hasGridTiles,
    overlayAbierto: loaderEl?.classList.contains("visible") ?? false,
  });
  errors.push("narrative", rotulo.detalle);
  if (rotulo.destino === "overlay") {
    setLoaderState("error", rotulo.titulo, rotulo.detalle, rotulo.salida);
  }
  else log(`⚠ ${rotulo.detalle.slice(0, 100)}`);
}

/** Materializa un `spawn_entity` del motor narrativo EN LA ESCENA VIVA, sin
 *  recargar. El `position` ya viene resuelto en metros mundo por el bridge
 *  (consequence-handler.ts:resolvePositionHint, relativo al jugador). NPCs van a
 *  npcEntities (interactuables con E); building/object a objectEntities con
 *  `sizeXZ` para que sean sólidos (collidesAt) y tengan volumen que instalar
 *  en el renderer, que es la "geometría base" sobre la que luego se
 *  superponen imágenes IA. */
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
    const spawnStyleRole = npcSkinStyleRef({
      style_ref: typeof effect.data.style_ref === "string" ? effect.data.style_ref : undefined,
      role: typeof effect.data.role === "string" ? effect.data.role : undefined,
    });
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
      styleRole: spawnStyleRole,
    });
    characterSprites.requestSkin(npcPrompt, { role: spawnStyleRole });
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
    // Altura coherente con la de las escenas del motor (defaults por kind).
    sizeY: KIND_DEFAULT_HEIGHT[isBuilding ? "building" : "prop"],
    spriteHash,
  });
  log(`✨ ${isBuilding ? "edificio" : "objeto"}: ${label}`);
}

narrativeClient.onNarrativeEvent((event) => {
  interactPendingUntil = 0;
  for (const effect of event.effects) {
    switch (effect.kind) {
      case "show_dialogue": {
        // Identidad del hablante para el retrato: la entidad que el bridge
        // resolvió, la que tiene ese nombre en pantalla, o —si el diálogo
        // llegó sin interacción previa— la última con la que se habló.
        const npc =
          (effect.speakerId ? npcEntities.find((n) => n.id === effect.speakerId) : undefined) ??
          npcEntities.find((n) => (n.name ?? "") === effect.speaker) ??
          (lastInteractedId ? npcEntities.find((n) => n.id === lastInteractedId) : undefined);
        const skinPrompt = npc?.skinPrompt ?? effect.speakerSkinPrompt;
        dialoguePanel.show(
          effect.speaker,
          effect.text,
          effect.choices.map((c) => (typeof c === "string" ? c : c.text)),
          { id: effect.speakerId ?? npc?.id },
        );
        portrait.request({
          heroUrl: skinPrompt ? spriteRenderer.heroUrl(skinPrompt) : null,
          skinModel: skinPrompt ? spriteRenderer.skinKey(BASE_MODEL, skinPrompt) : undefined,
          baseModel: BASE_MODEL,
        });
        dialoguePanel.setPortrait(portrait.element);
        // Suprime movimiento/ataque del InputProvider mientras el panel está
        // abierto (las teclas 1-3/T las gestiona el propio panel).
        input.dialogueActive = true;
        break;
      }
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
          // El tile realizado de un lugar lleva su `place_id` (lo fija el
          // bridge en el Format D crudo): es lo que ata esta escena al viaje
          // que el jugador pidió, y no al prefetch que aterrice a la vez.
          const crudo = scene.__format_d as { place_id?: string } | undefined;
          travelLedger.escena(String(scene.scene_id ?? effect.entityId), crudo?.place_id);
          const t = scene.tile as { tx: number; ty: number } | undefined;
          if (t && Number.isInteger(t.tx) && Number.isInteger(t.ty)) {
            // Tile del plano: ADITIVO (los anteriores no desaparecen).
            paso(
              addTile(scene).then(() => {
                const edge = frontier.onTileReady(t.tx, t.ty, playerPos.x, playerPos.z);
                if (edge) {
                  // Sin destello de llegada: el feedback ES que el muro de
                  // niebla de esa frontera se disipa y descubre el terreno
                  // nuevo. Un flash encima solo tapaba lo que hay que mirar.
                  const ES: Record<string, string> = { north: "norte", south: "sur", east: "este", west: "oeste" };
                  log(`🌍 el mundo continúa hacia el ${ES[edge]}`);
                } else {
                  log(`🌍 tile listo: ${effect.entityId}`);
                }
              }),
              "scene",
              `el tile ${effect.entityId} llegó pero no se pudo instalar`,
            );
          } else {
            // Escena legacy (save v3 sin migrar).
            paso(loadSceneData(scene), "scene", `no se pudo cargar la escena ${effect.entityId}`);
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

// `bootstrap` se traga sus propios fallos de sesión, pero no los de la vía de
// escape (crear el cliente visor, pintar el estado de conexión): sin canal,
// un fallo ahí dejaba el cliente en negro sin una sola línea que lo dijera.
paso(bootstrap(), "session", "arrancar el cliente");

async function bootstrap(): Promise<void> {
  let client: GameClient;
  try {
    client = await createGameClient(sharedBridge);
  } catch (err) {
    // Sin bridge NO hay partida (CONFIG.session.require_bridge): el error se
    // dice y se registra, igual que antes. Lo que cambia es lo que queda
    // después: un cliente inerte para que el game loop pinte. Sin él,
    // `gameClient` se quedaba a null y el loop salía por su guarda antes de
    // render(), así que el selector de fixtures cargaba la escena sobre un
    // lienzo NEGRO — que es justo lo que el preset `html-fixtures` promete
    // poder hacer sin backend (issue #215).
    setLoaderState(
      "error",
      "No se pudo arrancar la partida",
      (err as Error).message,
    );
    errors.push("session", "bootstrap failed", err);
    gameClient = createViewerClient();
    updateConnectionStatus(false, true);
    return;
  }
  gameClient = client;
  updateConnectionStatus(client.isConnected, true);
  client.on("connected", () => updateConnectionStatus(true, true));
  client.on("disconnected", () => updateConnectionStatus(false, true));
  try {
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

/** ¿Hay un bucle de título en marcha? Lo lee `runTitleFlow` para no
 *  re-entrar sobre sí mismo desde `volverAlTitulo()`. */
let tituloEnMarcha = false;

/** El título es un BUCLE hasta que arranca una partida (#189).
 *
 *  Antes se llamaba una sola vez y su `finally` hacía `titleScreen.hide()`
 *  pasara lo que pasara: cualquier fallo de sesión —un save borrado, un
 *  plugin que no casa, un sistema de combate desconocido— dejaba al jugador
 *  en una pantalla sin nada que pulsar, y la única salida era recargar. Ahora
 *  el fallo vuelve al título CON su motivo, y el título sigue vivo porque
 *  `show()` rearma su promesa en cada vuelta.
 *
 *  El `hide()` solo ocurre en el camino de ÉXITO. */
async function runTitleFlow(avisoInicial?: string): Promise<void> {
  // Re-entrante desde `volverAlTitulo()`, pero no DOS veces a la vez: dos
  // bucles compartiendo el mismo `titleScreen` se pisarían el `resolve` y el
  // segundo «Comenzar» arrancaría dos sesiones.
  if (tituloEnMarcha) return;
  tituloEnMarcha = true;
  try {
    let aviso: string | undefined = avisoInicial;
    for (;;) {
      const seguir = await unIntentoDeArrancar(aviso);
      if (seguir === null) return; // partida en marcha
      aviso = seguir;
    }
  } finally {
    tituloEnMarcha = false;
  }
}

/** La salida del mundo vacío (#189, hallazgo 3.2 de QA).
 *
 *  `start_session` contesta `ok:true` ANTES de generar el tile, así que un
 *  motor que no responde durante la generación del mundo inicial NO hace
 *  rechazar a `startSession` y NO pasa por el catch de `unIntentoDeArrancar`:
 *  para cuando llega el `narrative_status` de error, el título ya se ocultó y
 *  el bucle ya devolvió. El jugador se quedaba con cielo vacío, barra de vida
 *  al 100 % y cinco botones de ataque, sin mundo y sin nada que le devolviera
 *  al título — recargar, literalmente la frase del issue.
 *
 *  Esto lo devuelve al título por el mismo camino que un fallo de sesión: el
 *  mundo a cero, la sesión soltada y el bucle otra vez en marcha. */
async function volverAlTitulo(): Promise<void> {
  const motivo = motivoDelUltimoMuro ?? undefined;
  hideLoader();
  abandonarLaPartida();
  await runTitleFlow(motivo);
}

/** Dejar la partida: el mundo a cero y la sesión soltada. Los DOS caminos de
 *  vuelta al título pasan por aquí — que sean dos llamadas y no una es lo que
 *  producía #249 (uno deshacía cinco cosas y el otro una).
 *
 *  Ojo con lo que esto NO garantiza, para que nadie lo lea de más: que un
 *  TERCER camino de vuelta al título se acuerde de llamarla sigue siendo
 *  responsabilidad de quien lo escriba. Lo inexpresable es la asimetría entre
 *  FACETAS (`session-facets.ts`), no entre caminos; hoy los caminos son dos y
 *  los dos tienen guion en vivo (18 y 20). */
function abandonarLaPartida(): void {
  resetWorld();
  session.leave();
}

/** Un intento: enseña el título, espera la elección y la ejecuta. Devuelve
 *  `null` si la partida arrancó, o el motivo que hay que enseñar en el título
 *  si no. Solo relanza si es el propio título el que no se puede pintar. */
async function unIntentoDeArrancar(aviso?: string): Promise<string | null> {
  let action: TitleAction;
  try {
    action = await titleScreen.show({ aviso });
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
        action.renderMode,
        action.characterMode,
      );
      session.enter({
        sessionId: res.sessionId,
        styleId: res.state.world?.style_id ?? "",
        renderMode: res.state.world?.render_mode ?? "",
        characterMode: res.state.world?.character_mode ?? "",
        combatSystem: res.state.world?.combat_system ?? "",
        // Sin tema en la respuesta, el neutro: el mismo que aplica `leave()`.
        uiTheme: res.uiTheme ?? BASE_UI_THEME,
      });
      despiertaElAtlasDeLaSesion();
      log(`Nueva partida: ${res.sessionId} (${action.gameId})`);
      await setPlayerAppearance(action.appearance.model_id, action.appearance.skin_path);
    } else {
      const res = await narrativeClient.resumeSession(action.sessionId);
      session.enter({
        sessionId: res.state.session_id,
        styleId: res.state.world?.style_id ?? "",
        renderMode: res.state.world?.render_mode ?? "",
        characterMode: res.state.world?.character_mode ?? "",
        combatSystem: res.state.world?.combat_system ?? "",
        // Sin tema en la respuesta, el neutro: el mismo que aplica `leave()`.
        uiTheme: res.uiTheme ?? BASE_UI_THEME,
      });
      despiertaElAtlasDeLaSesion();
      log(`Reanudada: ${res.state.session_id}`);
      // El mundo anterior se va ANTES de vestir al jugador: `resetWorld`
      // borra también su prompt de skin (es del mundo que se va), y vestirlo
      // primero lo dejaría desnudo.
      resetWorld();
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
      // La posición viene del save, y ahora está VIVA: el bridge ata el
      // combatiente del sim al NarrativeState al sembrarlo, así que cualquiera
      // de sus guardados la lleva fresca (issue #245).
      const savedPos = res.state.player?.position;
      if (Array.isArray(savedPos) && savedPos.length === 3) {
        playerPos.x = savedPos[0];
        playerPos.z = savedPos[2];
      }
      const underResume = tileStore.getAt(playerPos.x, playerPos.z);
      if (underResume) setActiveClientTile(underResume.key);
    }
  } catch (err) {
    errors.push("session", "session start/resume failed", err);
    // El error va AL TÍTULO, no al loader: el título tiene z-index 9999 y el
    // loader 70, así que un título de vuelta escondería el error debajo y el
    // jugador volvería a la pantalla inicial sin saber por qué.
    hideLoader();
    // La sesión pudo quedar a medio aplicar (el fallo puede llegar DESPUÉS de
    // `session.enter`): sin esto, el segundo intento arrancaría sobre los
    // tiles del primero. `leave()` es el mismo camino que usa `volverAlTitulo`
    // — los dos retornos al título dejan el cliente idéntico por construcción.
    abandonarLaPartida();
    const que =
      action.kind === "new_game"
        ? "No se pudo empezar la partida"
        : "No se pudo reanudar la partida";
    // TRADUCIDO, no volcado: aquí se leía «…: game_load_failed: game.json
    // malformed (/home/…/games/alta_fantasia/game.json): Expected property
    // name…», con la ruta absoluta del disco de quien juega dentro. El crudo
    // sigue entero en el `errors.push` de arriba (va al `detail` de la entrada
    // del error-log), que es donde sirve.
    return `${que}. ${motivoDeSesionParaElJugador(err)}`;
  }
  // Solo aquí: la partida está en marcha y el título deja de hacer falta.
  titleScreen.hide();
  return null;
}

scheduleNextFrame();
