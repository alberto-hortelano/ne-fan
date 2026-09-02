/** Never Ending Fantasy — cliente HTML.
 *
 *  UNA vista: primera persona (FpsRenderer → three.js). Conecta al bridge de
 *  nefan-core por WebSocket o cae a simulación local. */

import type { Vec3, EffectiveParams } from "@nefan-core/src/types.js";
import { instalarNefanHook } from "./dev/nefan-hook.js";
import { getEffectiveParams, loadConfig } from "@nefan-core/src/combat/combat-data.js";
import { combatRegistry } from "@nefan-core/src/combat/registry.js";
import type { AttackSpec } from "@nefan-core/src/combat/combat-system.js";
import { KIND_DEFAULT_HEIGHT } from "@nefan-core/src/scene/scene-normalize.js";
import { npcSkinStyleRef } from "@nefan-core/src/games/style-categories.js";
import { HOJAS_ANGLE } from "@nefan-core/src/contracts/sprite-census.js";
import { pickAimTarget, pickNearestTarget } from "@nefan-core/src/scene/aim.js";
import {
  etiquetaDeFixture,
  motivoDeFixtureParaElJugador,
  motivoDeSesionParaElJugador,
  rotuloDeStatus,
  type SalidaDelOverlay,
  type StatusRotulable,
} from "@nefan-core/src/protocol/status-labels.js";
import { marcarTitulo } from "./ui/titulo-manda.js";
import { TileStore } from "./world/tile-store.js";
import { FrontierManager } from "./world/frontier.js";
import { crearFronteraDelJugador } from "./world/frontera-del-jugador.js";
import { aplicarLoQueMandaElBridge } from "./world/lo-que-manda-el-bridge.js";
import { MundoDelCliente } from "./world/mundo-del-cliente.js";
import { crearCargaDeTile, type OpcionesDeCarga } from "./world/carga-de-tile.js";
import type { Entity } from "./renderer/types.js";
import { FPS_DEBUG_VIEW_LABELS, FpsRenderer } from "./renderer/fps-renderer.js";
import { FpsAtlasController } from "./scene/fps-atlas.js";
import { enemigoDesdeCombat } from "./scene/enemigo.js";
import { CollisionSystem } from "./world/collision.js";
import { SpriteRenderer } from "./renderer/sprite-renderer.js";
import { BASE_ANIMS, BASE_MODEL, CharacterSpriteManager } from "./renderer/character-sprites.js";
import { AnimacionDeEntidades } from "./renderer/animacion-de-entidades.js";
import { BridgeClient } from "./net/bridge-client.js";
import { NarrativeClient } from "./net/narrative-client.js";
import { serviceUrl } from "./net/service-urls.js";
import { TitleScreen, type TitleAction } from "./ui/title-screen.js";
import { HistoryBrowser } from "./ui/history-browser.js";
import { inputRegistry } from "./input/registry.js";
import type { InputProvider } from "./input/input-provider.js";
import { DevToolsInput } from "./input/dev-tools-input.js";
import { DialoguePanel } from "./ui/dialogue-panel.js";
import { TravelPanel } from "./ui/travel-panel.js";
import { TravelLedger } from "./ui/travel-ledger.js";
import { TileLedger } from "./ui/tile-ledger.js";
import { DevStatusPanel } from "./ui/dev-status-panel.js";
import { DevMenu, type FakeItem } from "./ui/dev-menu.js";
import { GraphicsModeChip } from "./ui/graphics-mode.js";
import { errors } from "./ui/error-log.js";
import { EcoDelCombate } from "./ui/eco-del-combate.js";
import { HablarConUnNpc } from "./ui/hablar-con-un-npc.js";
import { paso } from "./ui/async-ui.js";
import { ActionBar } from "./ui/action-bar.js";
import { WorldLabels, type WorldLabel } from "./ui/world-labels.js";
import { PortraitView } from "./ui/portrait.js";
import { applyUiTheme, BASE_UI_THEME } from "./ui/theme.js";
import { createClientSession } from "@nefan-core/src/session/session-facets.js";
import { createEntrada } from "@nefan-core/src/session/entrada.js";
import { spawnsDeRuntime } from "@nefan-core/src/session/mundo-persistido.js";
import { Mirada } from "@nefan-core/src/simulation/mirada.js";
import { intencionDeTeclas, pasoDelJugador } from "@nefan-core/src/simulation/paso-del-jugador.js";
import {
  createGameClient,
  createViewerClient,
  type GameClient,
  type FrameResult,
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

  // Entrar o reanudar una partida rearma el cortacircuitos de skins (#236):
  // es el único momento en que se sabe que empieza una sesión, y hasta ahora
  // el cortacircuitos solo se rearmaba desde el OFF→ON del menú dev.
  //
  // `characterSprites` es un singleton de MÓDULO, así que su mapa de skins
  // sobrevive a volver al título y reanudar: sin esta línea, una partida
  // abandonada con el backend caído se llevaba el apagón a la siguiente —ya
  // con el backend arriba— y sus vecinos de siempre seguían en maniquí toda
  // la vida de la pestaña. Rearmar OLVIDA a los que fallaron (ver
  // `rearmarCortacircuitos`), no los re-pide: los que aparezcan en ESTA
  // partida los pedirá quien los spawnee, y los que no, no se pagan.
  characterSprites.rearmarCortacircuitos();

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
  animacion.jugadorEnReposo(performance.now());

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
/** Set de sprites del mundo: los sheets van renderizados desde el ángulo de
 *  cámara único del juego (casi frontal −8°, la cámara a la altura de los
 *  ojos). Es la constante del censo (nefan-core) — la misma que usan el
 *  middleware de `/sprites/index.json` y el SKIN_ANGLE de ui/style-apply.ts,
 *  que antes eran literales atados por un «DEBE coincidir». */
const worldAngle = HOJAS_ANGLE;
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
/** Qué animación lleva cada cuerpo este frame (y el del jugador). La máquina
 *  de estados no es del mundo sino de cómo se dibuja, así que vive con el
 *  renderer y no con `MundoDelCliente`. */
const animacion = new AnimacionDeEntidades(characterSprites, worldAngle);
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
/** La ENTRADA del jugador en la partida: la conjunción «ya se ha vestido Y ha
 *  pintado el tile inicial», que es lo que hace que el save exista (#279).
 *  Las dos mitades llegan por caminos distintos y en cualquier orden; quién
 *  las declara está justo debajo (`addTile` y el final de
 *  `unIntentoDeArrancar`) y el olvido al cambiar de partida lo aplica la
 *  faceta `entrada` de la sesión, no una línea que alguien tenga que recordar. */
const entrada = createEntrada((sessionId) => {
  log(`la partida ${sessionId} ya se juega: se establece en disco`);
  narrativeClient.sessionEntered(sessionId);
});

/** De qué sesión es el mundo que hay instalado ahora mismo ("" = ninguno).
 *  Lo escribe SOLO el sink de la faceta `mundo`, que es quien lo vacía. */
let mundoPintadoDe = "";

/** De qué sesión es el gate del diálogo que hay puesto ("" = ninguno). Lo
 *  escribe SOLO el sink de la faceta `dialogo`, hermano del de arriba. */
let dialogoDeSesion = "";

const session = createClientSession({
  // El mundo pintado es una FACETA, no una llamada que haya que acordarse de
  // hacer (#282, segunda mitad): la rama `new_game` de `unIntentoDeArrancar`
  // no vaciaba el mundo —solo la de `resume`—, así que un segundo intento
  // heredaba los tiles del primero. Va primera en el record de aplicadores,
  // así que el mundo anterior se va antes de que estilo, tema y atlas armen
  // nada encima.
  //
  // POR VALOR, como los otros seis, y no «vacía siempre»: el módulo promete
  // que aplicar las mismas facetas dos veces no cambia nada, y un reset
  // incondicional rompía esa promesa justo en el sink más destructivo —el
  // primero que quisiera refrescar una faceta a mitad de partida se llevaba
  // el mundo por delante—. Aquí el argumento se LEE: si el mundo pintado ya
  // es el de esa sesión, no hay nada que vaciar.
  mundo: ({ sessionId }) => {
    if (sessionId === mundoPintadoDe) return;
    mundoPintadoDe = sessionId;
    resetWorld();
  },
  style: ({ styleId }) => applySessionStyle(styleId),
  theme: ({ uiTheme }) => applyUiTheme(uiTheme),
  renderModes: (f) => applyRenderModes(f),
  combat: ({ combatSystem }) => applySessionCombatSystem(combatSystem),
  history: ({ sessionId }) => historyBrowser.setSession(sessionId),
  entrada: ({ sessionId }) => entrada.sesion(sessionId),
  // El gate del diálogo, que hasta #311 `leave()` no deshacía: volver al
  // título dejaba puesto lo que abrió la conversación. Llama a
  // `cerrarDialogo()`, el dueño único del par panel+gate, en vez de repetir
  // aquí el emparejamiento — que es justo el error que #311 persigue.
  //
  // POR VALOR y con el argumento LEÍDO, igual que `mundo`: cerrar un panel
  // abierto es destructivo y el módulo promete que aplicar las mismas facetas
  // dos veces no cambia nada. La guarda NO es hipotética — medido el
  // 2026-08-28 instrumentando este sink y corriendo `qa/guiones/27-…`:
  // `dialogo("") · vigente="" · repetido=true`, o sea que un arranque que
  // falla llama a `leave()` con los neutros ya aplicados. Hoy lo que salta es
  // idempotente; la guarda existe para que el día que no lo sea, no dependa
  // de que alguien se acuerde.
  //
  // Lo que esto NO hace, dicho para que no se lea de más: no baja el gate a
  // `puerta-de-teclado.ts`. El porqué sigue escrito allí y no ha cambiado.
  dialogo: ({ sessionId }) => {
    if (sessionId === dialogoDeSesion) return;
    dialogoDeSesion = sessionId;
    cerrarDialogo();
  },
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

/** Aplica los DOS modos de render de la sesión (escenarios y personajes).
 *
 *  RECIBE UN OBJETO Y NO DOS `string` POSICIONALES, y no es cosmética (#316).
 *  Los dos parámetros eran del mismo tipo, así que cruzarlos compilaba con cero
 *  errores y —a diferencia del resto de cruces que #316 cerró— este SÍ se parece
 *  a código correcto: es la forma canónica del bug de orden de argumentos, y sus
 *  tres llamantes lo escriben con dos ternarias seguidas, que es justo donde se
 *  cruzan. Lo que alimenta son los gates de generación de IMAGEN, o sea el
 *  vecindario del bug #249 que `session-facets.ts` existe para evitar; y vive en
 *  `main.ts`, que no tiene harness (#241), no entra en mutación y no lo mira
 *  ningún test — el peor sitio del repo para dejar un cruce silencioso.
 *
 *  Con un objeto, cruzarlos deja de ser un desliz de posición y pasa a ser
 *  escribir mal el nombre del campo, que no compila. */
function applyRenderModes({ renderMode, characterMode }: {
  renderMode: string;
  characterMode: string;
}): void {
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
    characterSprites.rearmarCortacircuitos();
    reRequestAllSkins();
  }
  devMenu?.refresh();
  graphicsChip?.refresh();
}

/** Re-encola los skins IA de todas las entidades vivas (player + NPCs +
 *  enemigos). requestSkin es idempotente por prompt y respeta ai_skin. */
function reRequestAllSkins(): void {
  if (playerSkinPrompt) characterSprites.requestSkin(playerSkinPrompt);
  for (const e of mundo.personajes) {
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
  applyRenderModes({
    renderMode: facet === "scenes" ? mode : scenesMode,
    characterMode: facet === "characters" ? mode : charactersMode,
  });
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

// --- State ---
const playerPos: Vec3 = { x: 0, y: 0, z: 2 };
const playerMaxHp = 100;
const playerWeaponId = "short_sword";
/** LA MIRADA: yaw continuo, pitch acotado y el `forward` horizontal que sale
 *  del yaw. Eran tres `let` de módulo aquí (`playerYaw`, `playerPitch`,
 *  `mirada.forward`), cuatro más de flanco de tecla y cuatro constantes; ahora
 *  vive en `nefan-core` (`simulation/mirada.ts`), que es regla de juego y tiene
 *  tests. */
const mirada = new Mirada();
/** LOS CUERPOS DEL MUNDO Y QUÉ ESCENA ES LA ACTIVA, con un solo dueño.
 *
 *  Eran seis `let` de módulo repartidas por este fichero —las listas de NPCs,
 *  objetos y enemigos, la clave del tile activo, su escena y sus salidas— más
 *  el índice de color de los enemigos y el dedupe de NPCs sin cuerpo. Al
 *  trocear el fichero, el riesgo no es escribirlas desde otro módulo —eso es
 *  `TS2632` y lo caza el compilador— sino DUPLICARLAS: dos copias que compilan
 *  limpio y mienten. Con campos `#privados` no hay binding que copiar. */
const mundo = new MundoDelCliente();
/** Mundo del cliente: colección ACUMULATIVA de tiles (nunca desaparecen). */
const tileStore = new TileStore();
/** Prefetch proactivo + velo direccional de fronteras. El jugador nunca se
 *  congela: el bloqueo es solo direccional (colisión virtual del borde). */
const frontier = new FrontierManager();
/** Lo que el jugador VE del borde del mundo (velo, pregunta, peticiones). */
const frontera = crearFronteraDelJugador({
  frontier,
  tileStore,
  session,
  // Por getter, no por valor: el proveedor de input se construye unas líneas
  // más abajo (necesita saber si hay propuesta, que es lo que este módulo
  // mueve) y `narrativeClient` mucho más abajo todavía. Nada de esto se lee
  // hasta el primer frame, así que la clausura llega siempre a tiempo.
  get input() {
    return input;
  },
  velo: (edge) => fpsRenderer.setFrontierVeil(edge),
  preguntar: (q) => setConfirmPrompt(q),
  pedido: (key) => tileLedger.pedido(key),
  pedirTile: (tx, ty, reason, edge) => narrativeClient.requestTile(tx, ty, reason, edge),
  log: (msg) => log(msg),
});

// Proveedor de input (plugin): default teclado+ratón; ?input=scripted instala
// el driver programático de bench. Un id desconocido no arranca — fail-loud.
const requestedInputId = new URLSearchParams(location.search).get("input") ?? undefined;
/** «Hay una conversación abierta», y SOLO desde su dueño (#314).
 *
 *  Antes esto era un campo público del proveedor que `abrirDialogo` ponía y
 *  `cerrarDialogo` quitaba: una tercera representación del panel, escribible
 *  desde cualquier módulo del cliente. Ahora el proveedor PREGUNTA y la
 *  respuesta se deriva del panel, así que no hay nada que desincronizar ni
 *  nadie de fuera que pueda mentir. Lo comparten el proveedor de juego y las
 *  teclas dev porque es la misma pregunta. */
const dialogoAbierto = (): boolean => dialoguePanel.isVisible;
/** «Hay una propuesta de explorar el tile vecino», DERIVADA de su dueño (#329).
 *
 *  Era `input.tileProposalActive`, campo público del proveedor que este bucle
 *  escribía a mano en TRES sitios —uno por cada rama en la que la propuesta
 *  puede no existir— con la copia muda de rigor en el proveedor scripted. El
 *  hermano exacto del espejo que #314 se llevó, y el que dejó en pie.
 *
 *  La expresión es la MISMA que escribía el bucle, y por eso se lee de arriba
 *  abajo como se leía allí: la propuesta la calcula `frontier.tick`, que solo
 *  corre si no hay conversación abierta, hay partida y el mundo tiene tiles de
 *  grid; fuera de esas tres guardas la propuesta que guarda el manager está
 *  VIEJA, así que las guardas viajan con ella. Mismo patrón que
 *  `dialogoAbierto` de aquí arriba: una función que se evalúa cada vez no se
 *  puede desincronizar, porque no guarda nada. */
const propuestaDeTileAbierta = (): boolean =>
  !dialogoAbierto() && session.active && tileStore.hasGridTiles && frontier.propuesta !== null;
let input: InputProvider;
try {
  input = inputRegistry.create(requestedInputId, { dialogoAbierto, propuestaDeTileAbierta });
} catch (err) {
  errors.push("input", `proveedor de input inválido (?input=${requestedInputId})`, err);
  throw err;
}
input.onAttackTypeChanged = () => renderAttackBar();

// Teclas de desarrollo (G/B): fijas, independientes del provider.
const devInput = new DevToolsInput({ dialogoAbierto, propuestaDeTileAbierta });


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

/** Lo que el jugador VE y LEE de lo que resuelve el sim: el aro del ataque, las
 *  líneas del registro de combate y si sigue de pie. El combate se resuelve en
 *  core detrás del bridge; esto es su eco. */
const eco = new EcoDelCombate({
  log: (msg) => log(msg),
  respingo: (id) => animacion.respingo(id),
  paramsDelAtaque: () => getSelectedParams(),
  ataqueElegido: () => input.state.selectedAttack,
  jugador: () => ({ pos: playerPos, forward: mirada.forward }),
  posicionesDeEnemigosVivos: () => mundo.enemigos.filter((e) => e.alive).map((e) => e.pos),
});

/** Con quién puede hablar el jugador y qué pasa al pulsar E, incluida la espera
 *  que abre el saludo hasta que el motor contesta. */
const hablar = new HablarConUnNpc({
  hayConversacionAbierta: dialogoAbierto,
  saludar: (id, nombre) => narrativeClient.interactEntity(id, nombre),
  log: (msg) => log(msg),
});

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

// --- Game client (will be set async) ---
let gameClient: GameClient | null = null;

// --- Scene loading ---

/** La carga que lanzó el ÚLTIMO `change` del selector «Room», para que quien
 *  lo dispara pueda esperarla.
 *
 *  Existe por #308, y el defecto es el mismo que este cliente ya corrigió en
 *  `debugState`: una superficie de observación que dice «hecho» sin saberlo.
 *  `loadFixture` ponía el `value`, despachaba `change` y devolvía `undefined`;
 *  el import perezoso del JSON resolvía después, así que sus llamantes seguían
 *  midiendo la escena ANTERIOR. `dispatchEvent` es SÍNCRONO —el manejador ha
 *  corrido entero antes de que vuelva—, así que aquí ya está la promesa puesta
 *  cuando el hook la recoge.
 *
 *  Solo la escribe el manejador del `change`, y solo la lee `loadFixture`
 *  inmediatamente después de dispararlo: no es un estado que sobreviva a nada,
 *  es el valor de retorno que el evento del DOM no sabe devolver. */
let ultimaCargaDeFixture: Promise<void> | undefined;

function populateSceneSelector(): void {
  // Scene fixtures (cargados localmente, sin bridge).
  // La etiqueta sale de core (`etiquetaDeFixture`) y de NINGÚN sitio más: la
  // opción que se pinta y el mensaje de «no cargó» tienen que nombrar lo
  // mismo, y cuando eran dos derivaciones decían cosas distintas (#269).
  const scenes = Object.keys(sceneModules).map((path) => ({
    // La clave que entrega el glob de Vite, medida en el navegador:
    // "../nefan-core/data/scenes/robledo_tile.json" (relativa, no el alias).
    key: path,
    label: etiquetaDeFixture(path),
  }));
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

/** Carga una fixture del selector «Room». RECHAZA si el módulo no llega, y de
 *  eso depende el `alFallar` de `paso()` para devolver el desplegable a la
 *  fixture que sí se está viendo (#269). */
async function loadSceneFile(globKey: string): Promise<void> {
  const mod = await sceneModules[globKey]();
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
  mirada.enderezar();
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
  mundo.vaciar();
  animacion.olvidar();
}

/** LA CARGA DE UN TILE, que vive en `world/carga-de-tile.ts`.
 *
 *  Aquí quedan solo sus colaboradores: el módulo recibe lo que necesita y no
 *  alcanza nada más de este fichero. Lo que DECIDE (qué se conserva y qué se
 *  retira al re-emitir un tile) está más adentro todavía, en `nefan-core`,
 *  donde hay tests y mutación que puedan ponerse rojos. */
const cargaDeTile = crearCargaDeTile({
  mundo,
  tileStore,
  fpsRenderer,
  fpsAtlas: fpsAtlasController,
  characterSprites,
  travelPanel,
  playerPos,
  session,
  entrada,
  gameClient: () => gameClient,
  rebuildEnemyBars: () => rebuildEnemyBars(),
  log: (msg) => log(msg),
});
const addTile = cargaDeTile.addTile;
const setActiveClientTile = cargaDeTile.activarTile;

/** API legacy (dropdown de fixtures, change_scene, saves sin migrar): mundo de
 *  UNA escena. El flujo narrativo de tiles usa addTile (aditivo). */
async function loadSceneData(
  rawData: Record<string, unknown>,
  opts: OpcionesDeCarga = {},
): Promise<void> {
  resetWorld();
  await addTile(rawData, opts);
}

function rebuildEnemyBars(): void {
  enemyBarsContainer.innerHTML = "";
  for (const ee of mundo.enemigos) {
    const bar = document.createElement("div");
    bar.className = "nf-vital";
    // El NOMBRE, no el id. Un enemigo de la escena traía un slug legible por
    // casualidad ("bandido_1") y uno spawneado en runtime llevaba
    // `narr_npc_1788038791_0` flotando en el HUD del jugador (#323).
    const nombre = document.createElement("span");
    nombre.className = "nf-vital-label";
    nombre.style.color = ee.color;
    // textContent y no interpolación en innerHTML: `name` es texto libre del
    // motor narrativo, así que va por el canal que no interpreta marcado.
    nombre.textContent = ee.name ?? ee.label ?? ee.id;
    bar.appendChild(nombre);
    const carril = document.createElement("div");
    carril.className = "nf-bar";
    const relleno = document.createElement("div");
    relleno.className = "nf-bar-fill";
    relleno.id = `hp-${ee.id}`;
    relleno.style.width = "100%";
    relleno.style.background = ee.color;
    carril.appendChild(relleno);
    bar.appendChild(carril);
    const cifra = document.createElement("span");
    cifra.id = `hp-text-${ee.id}`;
    cifra.textContent = String(ee.maxHp);
    bar.appendChild(cifra);
    enemyBarsContainer.appendChild(bar);
  }
}

// --- Collision (lógica en world/collision.ts; aquí solo el cableado) ---
const collision = new CollisionSystem({
  tileStore,
  getPlayerPos: () => playerPos,
  getObstacles: () => mundo.objetos,
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

/** Carga una fixture del selector «Room» por nombre parcial, CONDUCIENDO el
 *  `<select>` real, y devuelve la carga. Fail-loud si no existe: un guion que
 *  «no encuentra» la escena y sigue en verde no vale nada.
 *
 *  La promesa es la mitad que faltaba (#308). Sin ella el hook decía «hecho» en
 *  cuanto despachaba el evento, y sus llamantes medían la escena ANTERIOR: el
 *  guion 22 llegó a publicar «suelo de robledo: 57 calcos» —que es el número
 *  del PUERTO— en una corrida VERDE. Con la promesa devuelta el estado malo
 *  deja de ser expresable: los llamantes ya hacen `await`, así que no pueden
 *  medir antes de que la escena esté puesta.
 *
 *  Y RECHAZA si la fixture no llega, que es el mismo canal fail-loud que vigila
 *  `qa/guiones/24-…`: el `catch` de `paso()` es para lo que ve quien juega
 *  (registro de errores, línea del juego, desplegable devuelto a su sitio), no
 *  para tragarse el fallo de vuelta a quien lo pidió.
 *
 *  Se queda aquí y no en `dev/nefan-hook.ts` porque `sceneSelector` y
 *  `ultimaCargaDeFixture` son de este fichero: el hook la llama, no la
 *  implementa. */
function cargarFixture(name: string): Promise<void> {
  const option = [...sceneSelector.options].find((o) => o.value.includes(name));
  if (!option) {
    throw new Error(
      `fixture "${name}" no está en el selector; hay: ${[...sceneSelector.options]
        .map((o) => o.label)
        .join(", ")}`,
    );
  }
  ultimaCargaDeFixture = undefined;
  sceneSelector.value = option.value;
  sceneSelector.dispatchEvent(new Event("change"));
  const carga = ultimaCargaDeFixture;
  // LANZA en vez de devolver `undefined`: devolver «nada» aquí sería
  // exactamente el defecto que este cambio cierra, y lo devolvería mudo. Solo
  // puede pasar si el manejador del `change` deja de lanzar la carga (hoy solo
  // con `value` vacío, que este camino no puede producir).
  if (carga === undefined) {
    throw new Error(
      `fixture "${name}": el <select> aceptó el valor pero su manejador de "change" no lanzó ` +
        `ninguna carga, así que no hay nada que esperar y la escena no va a cambiar`,
    );
  }
  return carga;
}

/** La MIRADA de este frame: el ratón acumulado bajo pointer lock y los pasos
 *  de las flechas. Las reglas (sensibilidad, tope de 85°, 45°/15° por flanco de
 *  subida, yaw→forward) viven en `nefan-core`; aquí solo se le pasa lo que el
 *  proveedor de input ha recogido. */
function aplicarMirada(): void {
  const look = input.consumeLookDelta();
  mirada.raton(look.dx, look.dy);
  mirada.pasos(input.state);
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

/** ABRIR Y CERRAR UN DIÁLOGO SON DOS COSAS QUE TIENEN QUE IR JUNTAS (#311).
 *
 *  «Hay una conversación abierta» vivía en dos sitios que nadie obligaba a
 *  coincidir: el panel (`dialoguePanel`) y el gate del input —un campo público
 *  del proveedor que suprimía moverse y atacar—. Estaban emparejados A MANO en
 *  cinco sitios, y bastaba apagar uno sin su `hide()` —o al revés— para dejar
 *  al jugador con el panel puesto y el mundo respondiendo, o con el panel fuera
 *  y los controles muertos. Eso compilaba, pasaba lint y pasaba la batería.
 *
 *  #311 le puso un dueño único, que son estas dos funciones. #314 se llevó el
 *  espejo entero: el proveedor PREGUNTA por `dialogoAbierto()` en vez de
 *  guardar una copia, así que ya no hay par que desemparejar — queda UNA
 *  representación (el panel) y su reflejo en el DOM, que #314 no funde a
 *  propósito. Estas funciones siguen existiendo porque abrir y cerrar tienen
 *  más partes que el panel (el ratón, que el panel suelta y no devuelve), y el
 *  sink de la faceta `dialogo` va ENCIMA y cubre otra cosa: que volver al
 *  título lo deshaga aunque nadie se acuerde. */
function abrirDialogo(
  speaker: string,
  text: string,
  choices: string[],
  who?: { id?: string },
): void {
  // El panel SUELTA el ratón al abrirse (dialogue-panel.ts: sin cursor no se
  // pueden clicar las opciones). Hay que apuntar si lo teníamos, porque
  // devolverlo al cerrar es cosa nuestra y hasta el 2026-08-29 no lo hacía
  // nadie — ver `cerrarDialogo`.
  ratonCapturadoAntesDelDialogo = document.pointerLockElement !== null;
  // Y con el panel en pantalla, el input de juego queda suprimido solo: el
  // proveedor PREGUNTA por `dialogoAbierto()`, que es este mismo panel (#314).
  // Aquí había un flag del proveedor que había que levantar a mano junto al
  // `show()`, y apagar a mano junto al `hide()` de `cerrarDialogo`.
  dialoguePanel.show(speaker, text, choices, who);
}

/** Cierra el diálogo: el panel fuera y el input devuelto al jugador.
 *
 *  Idempotente a propósito — el panel se cierra a sí mismo antes de invocar
 *  sus callbacks (`chooseByIndex`, `advance`), así que este `hide()` suele ser
 *  el segundo, y `hide()` solo asigna. Poder llamarlo de más es lo que permite
 *  que el sink de la faceta lo use sin saber si había algo abierto. */
function cerrarDialogo(): void {
  dialoguePanel.hide();
  devolverElRatonTrasElDialogo();
}

/** ¿Tenía el jugador el ratón capturado cuando se abrió la conversación? Lo
 *  apunta `abrirDialogo` porque el panel lo suelta por dentro. */
let ratonCapturadoAntesDelDialogo = false;

/** DEVOLVER EL RATÓN AL CERRAR ES PARTE DE CERRAR (#323).
 *
 *  El panel suelta el pointer lock al abrirse y hasta hoy no lo recuperaba
 *  nadie. Con NPCs pacíficos eso solo era un click de más; con enemigos es una
 *  ejecución: atacar con LMB exige el lock
 *  (`keyboard-input-provider.ts`: «e.button === 0 && document.pointerLockElement
 *  !== null»), así que tras hablar el jugador se quedaba pegando a un enemigo a
 *  1,5 m SIN HACER DAÑO y sin que nada se lo dijera. Medido por QA: 50 s a cero
 *  de daño y muerto; recapturando el ratón a mano, el mismo enemigo cayó en 3 s.
 *
 *  Va emparejado con `abrirDialogo` y por el mismo motivo que #311: soltar y
 *  devolver son las dos mitades de un acto, y separarlas deja al jugador con
 *  los controles a medias sin que nada falle.
 *
 *  Solo se devuelve si lo teníamos: quien estaba en modo cursor (mirando
 *  fixtures, con el título recién cerrado) no quiere que una conversación le
 *  capture el ratón por su cuenta. Y el navegador puede NEGARSE (pide gesto
 *  del usuario, y rechaza un lock pedido demasiado pronto tras soltarlo): por
 *  eso va por `paso()`, que lo deja escrito en el registro de errores en vez
 *  de tragárselo. El click sobre el mundo sigue siendo la vía de recuperación. */
function devolverElRatonTrasElDialogo(): void {
  if (!ratonCapturadoAntesDelDialogo) return;
  ratonCapturadoAntesDelDialogo = false;
  if (document.pointerLockElement !== null) return;
  paso(
    fpsRenderer.element.requestPointerLock(),
    "input",
    "no se pudo devolver el ratón al cerrar la conversación: haz click en el mundo para volver a atacar",
  );
}

dialoguePanel.onAdvanced = () => {
  cerrarDialogo();
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
  // Lo que lee quien juega nombra LA ETIQUETA que eligió (`zorder_test`), no
  // la clave del glob (`../nefan-core/data/scenes/zorder_test.json`), que es
  // lo que se leía en los dos canales hasta #269. El crudo —la URL, el stack—
  // sigue entero en el `detail` de la entrada del error-log, que es su sitio.
  const motivo = motivoDeFixtureParaElJugador(etiquetaDeFixture(value));
  // La MISMA promesa va a `paso()` (que le pone el canal de error para quien
  // juega) y a `ultimaCargaDeFixture` (que se la devuelve a quien disparó el
  // evento). No se duplica la cadena: `paso` deriva su propio `.catch`, así que
  // el rechazo sigue vivo en `carga` para el que la espere.
  const carga = loadSceneFile(value);
  ultimaCargaDeFixture = carga;
  paso(carga, "scene", motivo, () => {
    log(`⚠ ${motivo}`);
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

// --- Etiquetas de mundo y mirilla (primera persona) ---
// En 1ª persona no hay ctx 2D sobre el que escribir el nombre del NPC: las
// etiquetas viven en DOM (world-labels.ts) y se proyectan con la cámara del
// frame recién pintado. La decisión de QUÉ se mira es lógica pura del core
// (pickAimTarget): en 1ª persona "lo que tienes delante" no es lo más cercano.

/** Alcance al que se muestra el nombre de un personaje. */
const LABEL_RANGE_M = 18;
/** Alcance de la tecla E: con quién se puede hablar desde aquí. */
const INTERACT_RANGE_M = 2.5;
/** Alcance de la puntería: cerca, para que encender la mirilla signifique
 *  algo ("puedo tratar con esto"), no "hay algo por ahí". */
const AIM_RANGE_M = 12;
/** Semiángulo del cono de puntería (≈9°: el ancho de un NPC a 6 m). Cerca
 *  manda el cuerpo (radiusM), no el cono. */
const AIM_CONE_RAD = (9 * Math.PI) / 180;
/** Media anchura de un personaje en metros PARA APUNTAR: se apunta a su
 *  cuerpo, y la silueta a la que se apunta es más ancha que el cilindro con el
 *  que camina. NO es el radio de colisión (`NPC_RADIUS_M`/`BODY_RADIUS_M` de
 *  `scene/terrain-collision`, 0,5): compartían nombre y no número, que es
 *  cómo dos constantes que describen el mismo cuerpo acaban divergiendo. */
const AIM_BODY_HALF_WIDTH_M = 0.6;
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
  // NPCs Y ENEMIGOS. Los hostiles entraban aquí por primera vez el
  // 2026-08-29 (#323) y este filtro solo miraba a los NPCs, así que lo
  // único que el juego acababa de aprender a poner delante del jugador era
  // justo lo único sin rótulo y sin mirilla: un bulto anónimo que pega. Un
  // enemigo es la entidad que MÁS necesita nombre — es a lo que apuntas.
  const personajes = mundo.personajes.filter((n) => n.alive !== false);
  // Solo objetos CON nombre: sin descripción no hay nada que enseñar, y la
  // mirilla debe encenderse únicamente sobre lo que sí se puede nombrar.
  // Los EDIFICIOS quedan fuera: su centro no es un punto al que se pueda
  // apuntar (estás dentro o pegado a la fachada). El resto de lo que el
  // greybox pinta —un árbol, un barril— sí se puede mirar y nombrar: que el
  // plan lo pinte como volumen decide cómo se DIBUJA, no si tiene nombre.
  const objetos = mundo.objetos.filter(
    (o) => Boolean(o.label?.trim()) && o.volumeType !== "building",
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
        radiusM: AIM_BODY_HALF_WIDTH_M,
        halfHeightM: BODY_HALF_HEIGHT_M,
      })),
      // El bulto real del objeto, no su `radius` de dibujo (que en el 2D vale
      // 8 m para un edificio y convertiría media escena en objetivo).
      ...objetos.map((e) => {
        const alto = e.sizeY ?? 1;
        return {
          id: e.id,
          pos: { x: e.pos.x, y: fps.groundYAt(e.pos.x, e.pos.z) + alto / 2, z: e.pos.z },
          radiusM: Math.min(2, Math.max(e.sizeXZ?.x ?? 0, e.sizeXZ?.z ?? 0) / 2 || AIM_BODY_HALF_WIDTH_M),
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
    if (mundo.tileActivo) {
      const k = mundo.tileActivo;
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
    // Ya no hay que decírselo al proveedor — lo DERIVA él
    // (`propuestaDeTileAbierta`, #329) de la misma guarda que hay aquí.
    tileConfirmPromptEl.style.display = "none";
  }
  if (!dialoguePanel.isVisible) {
    aplicarMirada();

    // El PASO: las reglas (marco relativo al facing, diagonal renormalizada,
    // deslizamiento por ejes y «salir sí, entrar no») viven en `nefan-core`.
    // Aquí solo se le dan las teclas, el marco y la pregunta de qué es sólido,
    // y se aplica el delta que devuelve.
    const { dx, dz } = pasoDelJugador({
      desde: playerPos,
      forward: mirada.forward,
      intencion: intencionDeTeclas(input.state),
      velocidad: input.state.sprint ? SPRINT_SPEED : SPEED,
      delta,
      solido: collidesAt,
    });
    playerPos.x += dx;
    playerPos.z += dz;

    // La frontera del plano: el muro de niebla, la pregunta de sí/no y las
    // peticiones al motor. Es el único sitio del juego donde una tecla GASTA,
    // así que no se auto-dispara: el jugador confirma.
    frontera.tick(playerPos.x, playerPos.z);

    // Activación por posición: al pisar otro tile, refrescar la "escena
    // activa" del cliente (imagen IA, exits). El bridge hace lo propio con
    // NarrativeState en su handler de input.
    const under = tileStore.getAt(playerPos.x, playerPos.z);
    if (under && under.key !== mundo.tileActivo) {
      setActiveClientTile(under.key);
    }
  }

  // Con quién se puede hablar aquí: el NPC vivo más cercano dentro del alcance
  // de la tecla E. El criterio es de core (`pickNearestTarget`), hermano del
  // que decide qué enfila la cámara — dos criterios de «a qué me refiero» en
  // dos ficheros es como divergen.
  const vivos = mundo.npcs.filter((n) => n.alive !== false);
  const cerca = pickNearestTarget(playerPos, vivos, { maxDistanceM: INTERACT_RANGE_M });
  const npcInRange = cerca ? (mundo.npc(cerca.id) ?? null) : null;

  // Acciones contextuales: lo que el jugador puede hacer AQUÍ, como botones
  // con su tecla. El click empuja la misma intención que la tecla, así que
  // aguas abajo son indistinguibles.
  const saludo = hablar.frame(now, npcInRange, input.consumeInteract());
  promptBar.set([
    ...(saludo ? [{ ...saludo, invoke: () => input.queueInteract() }] : []),
    ...(!eco.jugadorVivo
      ? [{ id: "respawn", label: "reaparecer", key: "R", invoke: () => input.queueRespawn() }]
      : []),
  ]);

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
        playerForward: mirada.forward,
        playerMoving: input.state.up || input.state.down || input.state.left || input.state.right,
        attackRequested,
        attackType: attackRequested ? input.state.selectedAttack : undefined,
      });

  // Lo que el jugador VE y LEE de lo que resolvió el sim: el aro del ataque,
  // las líneas del registro y si sigue de pie. Devuelve la animación de una vez
  // que le toca (su ataque, o el respingo de haber encajado uno).
  const playerOneShot = eco.procesar(result.events, delta);

  // Dónde está cada cuerpo: lo dice el bridge y el cliente lo copia.
  aplicarLoQueMandaElBridge(mundo, result);

  // Update HUD
  const pHpPct = Math.max(0, result.playerHp / playerMaxHp * 100);
  playerHpBar.style.width = pHpPct + "%";
  playerHpText.textContent = Math.ceil(result.playerHp).toString();

  for (const ee of mundo.enemigos) {
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
    playerSprite = animacion.spriteDelJugador(now, playerModel, playerSkinPrompt, {
      vivo: eco.jugadorVivo,
      andando:
        !dialoguePanel.isVisible &&
        (input.state.up || input.state.down || input.state.left || input.state.right),
      esprintando: input.state.sprint,
      unaVez: playerOneShot,
    });
  }
  if (spritesOn) {
    for (const ee of mundo.enemigos) animacion.actualizar(ee, now, { npc: false });
    for (const npc of mundo.npcs) animacion.actualizar(npc, now, { npc: true });
  }
  // Blindaje: una excepción de UN frame no debe matar el rAF (juego
  // congelado en negro para siempre). Se registra (dedup por mensaje) y el
  // siguiente frame lo reintenta — los fallos transitorios (sheet a medio
  // cargar, imagen invalidada) se autocorrigen.
  // Telegraph del ataque y mirada vertical: estado de la VISTA que se fija
  // ANTES de render(). En WebGL no queda lienzo sobre el que garabatear una vez
  // emitido el frame, así que el patrón «dibuja después» de un lienzo 2D no
  // vale. El pitch no viaja en `PlayerView` porque `forward` es el marco del
  // MOVIMIENTO y es horizontal por diseño.
  fpsRenderer.setLookPitch(mirada.pitch);
  fpsRenderer.setAttackTelegraph(eco.telegraph());

  try {
    fpsRenderer.render(
      {
        pos: playerPos,
        forward: mirada.forward,
        hp: result.playerHp,
        maxHp: playerMaxHp,
        sprite: playerSprite,
      },
      mundo.enemigos,
      mundo.objetos,
      mundo.npcs,
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
const narrativeClient = new NarrativeClient(sharedBridge, {
  esMia: (sessionId) => session.esMio(sessionId),
  log: (msg) => log(msg),
});
const titleScreen = new TitleScreen(narrativeClient);
const historyBrowser = new HistoryBrowser(narrativeClient);

// Cambio de modo de render difundido por el bridge (otro cliente de la misma
// sesión, o el eco de este — re-aplicar es idempotente).
sharedBridge.on("render_mode_changed", (msg) => {
  if (!session.esMio(msg.sessionId)) return;
  applyRenderModes({
    renderMode: msg.facet === "scenes" ? msg.renderMode : scenesMode,
    characterMode: msg.facet === "characters" ? msg.renderMode : charactersMode,
  });
});

/** Imágenes actualmente FAKE: tiles del grid sin atlas de superficies y skins
 *  de personaje aún sobre la base y_bot. La identidad del item es la clave del
 *  tile o el prompt. */
function listFakeItems(): FakeItem[] {
  const items: FakeItem[] = [];
  // Sin módulo GL cargado no hay tile texturado que descontar: la unión
  // discriminada lo dice en el tipo, así que ya no hace falta el cast que
  // fingía que el campo podía estar ahí.
  const st = fpsRenderer.debugState();
  const textured = new Set(st.ready ? st.textured : []);
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
  for (const e of mundo.personajes) {
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
// nada. Desde #285 el interruptor apaga también el INPUT de juego, por la
// misma lectura: `ui/titulo-manda.ts`.
titleScreen.onVisibilityChange = (visible) => {
  graphicsChip?.setHidden(visible);
  // El único escritor del interruptor. Lo leen la regla de CSS que apaga los
  // píxeles y la puerta de teclado que descarta el input (#285): la misma
  // lectura para las dos, así que no pueden divergir.
  marcarTitulo(visible);
};
// El seam del banco de pruebas (`window.__nefan`), en UNA construcción y AQUÍ:
// después de `titleScreen` y `narrativeClient`, que son los últimos
// colaboradores que mira. Estaba en tres puntos de escritura separados por
// 1.800 líneas de este fichero, y el tercero —la corrida de «Aplicar estilo»—
// iba suelta justo por este orden. Sigue dentro de la evaluación SÍNCRONA del
// módulo, así que `window.__nefan` está puesto antes de que nadie navegue.
instalarNefanHook({
  input,
  playerPos,
  mirada,
  mundo,
  tileStore,
  frontier,
  travelLedger,
  tileLedger,
  characterSprites,
  attackBar,
  promptBar,
  confirmBar,
  dialoguePanel,
  devPanel,
  fpsRenderer,
  fpsAtlas: fpsAtlasController,
  titleScreen,
  narrativeClient,
  session,
  collidesAt,
  dialogoAbierto,
  combatSystemId: () => sessionCombatSystemId,
  attackCatalog: () => attackCatalog,
  addTile,
  loadSceneData,
  cargarFixture,
});

dialoguePanel.onChoice = (idx, text) => {
  cerrarDialogo();
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
  cerrarDialogo();
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
  // …y se BORRA el contador, no solo se para (QA 2026-09-01, H-5). Paraba el
  // intervalo y dejaba el último texto puesto, así que bajo un muro de error
  // quedaba un «0s» huérfano entre el motivo y «Cerrar»: el reloj de una
  // espera que ya no existe. Un fallo no tarda segundos en fallar, y esta
  // tanda le pone cinco avisos nuevos encima a este mismo widget.
  if (loaderElapsed) loaderElapsed.textContent = "";
}

if (loaderDismiss) loaderDismiss.onclick = () => hideLoader();
if (loaderBack) {
  loaderBack.onclick = () => paso(volverAlTitulo(), "session", "volver a la pantalla de título");
}

narrativeClient.onStatusDeLaPartida((status) => {
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
    hablar.yaContestaron();
    pintarFalloDelMotor(status);
  }
});

// Un fallo del motor que era de OTRA partida (#312). Se PINTA —callarlo es el
// silencio que esta casa prohíbe— y ahí se acaba: ni ledger de viaje, ni
// frontera, ni `spawn`. No es disciplina, es que el tipo `FalloAjeno` no
// tiene esos campos: el handler de arriba no se podría escribir con este
// argumento.
narrativeClient.onFalloAjeno((fallo) => {
  pintarFalloDelMotor(fallo);
});

/** Enseña un fallo del motor donde toque. El TÍTULO ya no se decide aquí:
 *  `main.ts` pintaba «Error al generar el mundo» y «Error al generar la
 *  escena» —jerga de motor— encima de un cuerpo que el bridge ya había
 *  escrito para quien juega (#180). Ahora el rótulo sale de `rotuloDeStatus`
 *  (nefan-core), que además decide si el fallo tapa la pantalla o se queda en
 *  la línea de mensajes; el cliente solo pinta. */
function pintarFalloDelMotor(status: StatusRotulable): void {
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
 *  la lista de NPCs (interactuables con E); building/object a la de objetos, con
 *  `sizeXZ` para que sean sólidos (collidesAt) y tengan volumen que instalar
 *  en el renderer, que es la "geometría base" sobre la que luego se
 *  superponen imágenes IA. */
function materializeSpawn(
  effect: {
    entityId: string;
    entityKind: "npc" | "object" | "building";
    description: string;
    name?: string;
    position: [number, number, number];
    data: Record<string, unknown>;
  },
  /** `true` cuando esto NO acaba de pasar: el mundo se está rehidratando desde
   *  el save. Lo único que cambia es lo que se le CUENTA al jugador — «⚔ Secuaz
   *  ataca» y «✨ Nogala aparece» son mentira al reanudar: nadie ha atacado ni
   *  aparecido, ha vuelto a su partida (QA 2026-08-31, H-8). */
  opts: { rehidratado?: boolean } = {},
): void {
  const [x, y, z] = effect.position;
  const pos: Vec3 = { x, y, z };
  const label = (effect.name ?? effect.description ?? effect.entityId).slice(0, 40);

  if (effect.entityKind === "npc") {
    // VÍA (b) al combate: un `spawn_entity` con `role:"hostile"`. El bloque
    // `combat` lo puso el core en `dispatchConsequences` (mismo
    // `combatForHostileRole` que la escena inicial), y aquí se registra por la
    // MISMA puerta. Sin esto, el enemigo aparecería como un vecino más: se
    // pintaría y no se le podría pegar.
    if (effect.data.combat !== undefined) {
      const nuevo = enemigoDesdeCombat({
        id: effect.entityId,
        pos,
        combat: effect.data.combat,
        descripcion: effect.description,
        styleRef: typeof effect.data.style_ref === "string" ? effect.data.style_ref : undefined,
        nombre: effect.name,
        indiceColor: mundo.siguienteColorDeEnemigo(),
        // DE RUNTIME, y se escribe AQUÍ DENTRO y nunca en el llamante (#350).
        // Es la trampa concreta que este tipo cierra: con el dueño puesto
        // fuera, el rehidratado del resume volvería sin él y el bug —el spawn
        // que desaparece al re-emitir su tile— reaparecería tras resume +
        // viaje. Con `dueno` obligatorio, olvidarlo no compila.
        dueno: { de: "runtime" },
      });
      if (nuevo) {
        mundo.anadirEnemigo(nuevo.entidad);
        characterSprites.requestSkin(nuevo.entidad.skinPrompt ?? effect.entityId, {
          role: nuevo.entidad.styleRole,
        });
        // El alta en el sim es lo que lo convierte en algo a lo que se puede
        // pegar; la barra de vida, en algo que el jugador ve perder vida.
        gameClient?.addEnemies([nuevo.combatiente]);
        rebuildEnemyBars();
        log(opts.rehidratado ? `↩ ${effect.name ?? "Enemigo"} sigue ahí` : `⚔ ${effect.name ?? "Enemigo"} ataca`);
      }
      return;
    }
    // El caso central del skin IA: la descripción del motor narrativo es el
    // prompt con el que se repinta la base y_bot frame a frame.
    const npcPrompt = effect.description || (effect.name ?? effect.entityId);
    const spawnStyleRole = npcSkinStyleRef({
      style_ref: typeof effect.data.style_ref === "string" ? effect.data.style_ref : undefined,
      role: typeof effect.data.role === "string" ? effect.data.role : undefined,
    });
    mundo.anadirNpc({
      id: effect.entityId,
      pos,
      forward: { x: 0, y: 0, z: -1 },
      radius: 7,
      color: "#68c",
      label,
      name: effect.name ?? effect.entityId,
      alive: true,
      category: "creature",
      skinPrompt: npcPrompt,
      styleRole: spawnStyleRole,
      dueno: { de: "runtime" },
    });
    characterSprites.requestSkin(npcPrompt, { role: spawnStyleRole });
    log(opts.rehidratado ? `↩ ${effect.name ?? "NPC"} sigue ahí` : `✨ ${effect.name ?? "NPC"} aparece`);
    return;
  }

  // building / object: caja sólida colocada en la escena actual.
  const isBuilding = effect.entityKind === "building";
  mundo.anadirObjeto({
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
    // EL ARREGLO DE #350, en una línea: este cofre y esta forja no son de
    // ningún tile, así que la purga de `addTile` ya no se los lleva por caer
    // dentro de su rect. Antes desaparecían en cuanto el jugador viajaba por
    // «Salidas» y volvía, y solo reaparecían al reanudar — el mundo se curaba
    // solo, que es peor que romperse.
    dueno: { de: "runtime" },
  });
  const que = isBuilding ? "edificio" : "objeto";
  log(opts.rehidratado ? `↩ ${que}: ${label} sigue ahí` : `✨ ${que}: ${label}`);
}

narrativeClient.onNarrativeEvent((event) => {
  hablar.yaContestaron();
  for (const effect of event.effects) {
    switch (effect.kind) {
      case "show_dialogue": {
        // Identidad del hablante para el retrato: la entidad que el bridge
        // resolvió, la que tiene ese nombre en pantalla, o —si el diálogo
        // llegó sin interacción previa— la última con la que se habló.
        const npc =
          (effect.speakerId ? mundo.npcs.find((n) => n.id === effect.speakerId) : undefined) ??
          mundo.npcs.find((n) => (n.name ?? "") === effect.speaker) ??
          (hablar.ultimoHablado ? mundo.npc(hablar.ultimoHablado) : undefined);
        const skinPrompt = npc?.skinPrompt ?? effect.speakerSkinPrompt;
        abrirDialogo(
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
  // Soltar la partida ES vaciar el mundo: el mundo es una faceta más
  // (`session-facets.ts`), así que `leave()` lo deshace todo por el mismo
  // camino que lo puso.
  session.leave();
  await runTitleFlow(motivo);
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
      log(`Reanudada: ${res.state.session_id}`);
      // El mundo anterior ya se fue —lo vació la faceta `mundo` del
      // `session.enter` de arriba— y por eso se puede vestir al jugador aquí:
      // `resetWorld` borra también su prompt de skin, así que vestir primero
      // dejaría al muñeco desnudo.
      //
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

      // …Y LO QUE EL MOTOR PUSO A MITAD DE PARTIDA. Lo de las escenas ya ha
      // vuelto (arriba); esto es la otra procedencia: las entities de
      // `spawn_reason: "narrative_request"`, que no están en el Format D de
      // ninguna escena y hasta #326 desaparecían enteras al reanudar — el
      // enemigo que el motor te echó encima, el NPC con el que hablabas, el
      // edificio que apareció. Vuelven por la MISMA puerta por la que
      // llegaron (`materializeSpawn`), así que no hay un segundo constructor
      // que se olvide de la mitad.
      //
      // DESPUÉS de los tiles, y el orden importa: `materializeSpawn` da de
      // alta combatientes en el sim del bridge, y el bridge resiembra el sim
      // al procesar el `resume_session` — que ya ha terminado cuando esta
      // respuesta llega, pero los tiles de arriba también mandan altas y
      // deben ir primero para que el orden sea el mismo que en una partida
      // viva. Materializar antes dejaría un enemigo pintado al que no se
      // puede pegar (I-3 de #323).
      //
      // El filtro de quién vuelve lo hace el CORE (`spawnsDeRuntime`): el
      // cliente solo pinta, y decidir aquí que un muerto no vuelve sería
      // lógica de juego en el cliente.
      const { spawns, errores } = spawnsDeRuntime(res.state.entities ?? []);
      for (const err of errores) errors.push("session", err);
      for (const spawn of spawns) materializeSpawn(spawn, { rehidratado: true });
      if (spawns.length > 0) log(`El mundo vuelve con ${spawns.length} cosa(s) que puso el motor`);
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
    // — los dos retornos al título dejan el cliente idéntico por construcción,
    // y eso incluye el mundo, que es una faceta más.
    session.leave();
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
  // …y solo aquí el jugador tiene cuerpo: `setPlayerAppearance` ya volvió sin
  // lanzar. Es la otra mitad de la entrada (#279). Un clon sin hojas no llega
  // hasta esta línea —cae en el catch de arriba, que abandona la partida—, así
  // que su tile, que llegó ANTES, no basta para escribir nada.
  entrada.vestido();
  return null;
}

scheduleNextFrame();
