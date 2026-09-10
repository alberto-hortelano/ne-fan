/** Never Ending Fantasy — cliente HTML.
 *
 *  UNA vista: primera persona (FpsRenderer → three.js). Conecta al bridge de
 *  nefan-core por WebSocket o cae a simulación local. */

import type { Vec3 } from "@nefan-core/src/types.js";
import { instalarNefanHook } from "./dev/nefan-hook.js";
import { HOJAS_ANGLE } from "@nefan-core/src/contracts/sprite-census.js";
import { pickNearestTarget } from "@nefan-core/src/scene/aim.js";
import { motivoDeSesionParaElJugador } from "@nefan-core/src/protocol/status-motivo.js";
import { rotuloDeStatus, type StatusRotulable } from "@nefan-core/src/protocol/status-rotulo.js";
import { marcarTitulo } from "./ui/titulo-manda.js";
import { TileStore } from "./world/tile-store.js";
import { Frontera } from "@nefan-core/src/scene/frontera.js";
import { crearFronteraEnPantalla } from "./ui/frontera-en-pantalla.js";
import { crearFronteraDelJugador } from "./world/frontera-del-jugador.js";
import { aplicarLoQueMandaElBridge } from "./world/lo-que-manda-el-bridge.js";
import { MundoDelCliente } from "./world/mundo-del-cliente.js";
import { crearCargaDeTile } from "./world/carga-de-tile.js";
import { crearFixturesDelSelector } from "./world/fixtures-del-selector.js";
import { crearMaterializadorDeSpawn } from "./world/materializar-spawn.js";
import type { Entity } from "./renderer/types.js";
import { FPS_DEBUG_VIEW_LABELS, FpsRenderer } from "./renderer/fps-renderer.js";
import { FpsAtlasController } from "./scene/fps-atlas.js";
import { CollisionSystem } from "./world/collision.js";
import { SpriteRenderer } from "./renderer/sprite-renderer.js";
import { BASE_MODEL, CharacterSpriteManager } from "./renderer/character-sprites.js";
import { crearAspectoDelJugador } from "./renderer/aspecto-del-jugador.js";
import { AnimacionDeEntidades } from "./renderer/animacion-de-entidades.js";
import { BridgeClient } from "./net/bridge-client.js";
import { NarrativeClient } from "./net/narrative-client.js";
import { serviceUrl } from "./net/service-urls.js";
import { TitleScreen, type TitleAction } from "./ui/title-screen.js";
import { HistoryBrowser } from "./ui/history-browser.js";
import { inputRegistry } from "./input/registry.js";
import type { InputProvider } from "./input/input-provider.js";
import { DevToolsInput } from "./input/dev-tools-input.js";
import { TravelPanel } from "./ui/travel-panel.js";
import { TravelLedger } from "./ui/travel-ledger.js";
import { TileLedger } from "./ui/tile-ledger.js";
import { DevStatusPanel } from "./ui/dev-status-panel.js";
import { DevMenu, type FakeItem } from "./ui/dev-menu.js";
import { crearModosDeGraficos } from "./ui/modos-de-graficos.js";
import { errors } from "./ui/error-log.js";
import { crearMuroDeCarga } from "./ui/muro-de-carga.js";
import { crearRegistroDeLaPartida } from "./ui/registro-de-la-partida.js";
import { crearConversacion } from "./ui/conversacion.js";
import { EcoDelCombate } from "./ui/eco-del-combate.js";
import { paso } from "./ui/async-ui.js";
import { ActionBar } from "./ui/action-bar.js";
import { crearHudDeCombate } from "./ui/hud-de-combate.js";
import { crearEtiquetasDelMundo } from "./ui/etiquetas-del-mundo.js";
import { PortraitView } from "./ui/portrait.js";
import { applyUiTheme, BASE_UI_THEME } from "./ui/theme.js";
import { createClientSession, porValor } from "@nefan-core/src/session/session-facets.js";
import { createEntrada } from "@nefan-core/src/session/entrada.js";
import { spawnsDeRuntime } from "@nefan-core/src/session/mundo-persistido.js";
import { Mirada } from "@nefan-core/src/simulation/mirada.js";
import {
  intencionDeTeclas,
  pasoDelJugador,
  velocidadDelJugador,
} from "@nefan-core/src/simulation/paso-del-jugador.js";
import { puntoDeReaparicion } from "@nefan-core/src/simulation/reaparicion.js";
import { HablarConUnNpc } from "@nefan-core/src/simulation/hablar-con-un-npc.js";
import {
  createGameClient,
  createViewerClient,
  type GameClient,
  type FrameResult,
} from "./net/game-client.js";

import combatConfigJson from "@nefan-core/data/combat_config.json";
import { loadConfig } from "@nefan-core/src/combat/combat-data.js";
import { CONFIG } from "@nefan-core/src/config.js";

/** Los números del jugador: velocidades, escala de arcade y alcance de la `E`.
 *  Los declara `combat_config.json` y los EXIGE `loadConfig` (#241): aquí no
 *  hay ni multiplicador ni caída a un literal — si el config no los trae, no
 *  hay partida, y se sabe en el arranque. */
const playerCfg = loadConfig(combatConfigJson).player;

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
// --- Registro de la partida (tope de líneas y alto de la caja: un número, #506) ---
const combatLog = document.getElementById("combat-log") as HTMLElement;
const log = crearRegistroDeLaPartida(combatLog);
/** El aspecto del jugador (`renderer/aspecto-del-jugador.ts`): su modelo
 *  base, su skin IA y la precarga del set base y_bot, que arranca AQUÍ, detrás
 *  del check de `CONFIG.graphics.character_sprites`. Los modelos alternativos
 *  y los skins IA se cargan bajo demanda (`aspecto.vestir` / `requestSkin`).
 *  El bucle le pregunta cada frame; `resetWorld` lo desviste. */
const aspecto = crearAspectoDelJugador({
  characterSprites,
  spriteRenderer,
  animacion,
  worldAngle,
  log,
});
/** El renderer del mundo, construido EAGER: es el único que hay, así que no
 *  espera a que la sesión decida nada. three.js entra por import dinámico
 *  dentro de la fachada (y con él el único contexto WebGL de la pestaña);
 *  hasta que llega, las instalaciones se encolan. */
const fpsRenderer = new FpsRenderer(appShell, { spriteRenderer });
// Panel de dev (segunda fila del HUD, #dev-status): estado de la generación
// de imágenes IA, contadores de caché, gasto estimado en € (poll a
// GET /dev/status de remote-gen) y config activa. Siempre visible.
const devPanel = new DevStatusPanel(REMOTE_GEN_URL, (msg) => log(msg));

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

const session = createClientSession({
  // El mundo pintado es una FACETA, no una llamada que haya que acordarse de
  // hacer (#282, segunda mitad): la rama `new_game` de `unIntentoDeArrancar`
  // no vaciaba el mundo —solo la de `resume`—, así que un segundo intento
  // heredaba los tiles del primero. Va primera en el record de aplicadores,
  // así que el mundo anterior se va antes de que estilo, tema y atlas armen
  // nada encima. `porValor` (core) lo hace idempotente: vaciar es destructivo
  // y solo ocurre cuando el id de sesión CAMBIA.
  mundo: porValor(() => resetWorld()),
  // Y con el mundo, lo que la frontera creía saber de sus vecinos: es una
  // instancia de MÓDULO y sin esto lo pedido en una partida seguía pedido en
  // la siguiente (#517; el motivo entero, en `session-facets.ts`).
  frontera: porValor(() => frontier.olvidarLaPartida()),
  style: ({ styleId }) => applySessionStyle(styleId),
  theme: ({ uiTheme }) => applyUiTheme(uiTheme),
  renderModes: (f) => graficos.aplicar(f),
  combat: ({ combatSystem }) => hud.aplicarSistema(combatSystem),
  history: ({ sessionId }) => historyBrowser.setSession(sessionId),
  entrada: ({ sessionId }) => entrada.sesion(sessionId),
  // El gate del diálogo, que hasta #311 `leave()` no deshacía: volver al
  // título dejaba puesto lo que abrió la conversación. Llama a
  // `conversacion.cerrar()`, el dueño único del par panel+gate, en vez de repetir
  // aquí el emparejamiento — que es justo el error que #311 persigue. Por
  // `porValor`, igual que `mundo`: cerrar es destructivo y solo ocurre cuando
  // el id de sesión CAMBIA (la medida del 2026-08-28 que lo justifica vive
  // en la doc del ayudante, en core).
  //
  // Lo que esto NO hace, dicho para que no se lea de más: no baja el gate a
  // `puerta-de-teclado.ts`. El porqué sigue escrito allí y no ha cambiado.
  dialogo: porValor(() => conversacion.cerrar()),
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
      return {
        layout: surfaces.layout,
        sceneDescription: entry.escena.scene_description,
      };
    },
    apply: (key, images) => fpsRenderer.applyAtlas(key, images),
    clear: (key) => fpsRenderer.clearAtlas(key),
    // Gate por sesión: entre el broadcast de la escena y la respuesta de
    // start/resume, el modo de escenarios aún es el default del cliente
    // ("image") — sin el gate, reanudar una partida VECTOR pintaba atlas de
    // pago en esa ventana (visto en vivo 2026-08-14). Hasta aplicar los modos
    // del save, el controller solo RESUELVE contra la librería ($0).
    generationOn: () => session.active && graficos.escenariosGeneran(),
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

const gameUiEl = document.getElementById("game-ui") as HTMLElement;

// Con el ratón capturado ningún botón HTML puede recibir un click: la UI se
// degrada a recordatorio de teclas (una regla de CSS) en vez de ofrecer una
// afordancia imposible.
document.addEventListener("pointerlockchange", () => {
  gameUiEl.dataset.locked = document.pointerLockElement !== null ? "true" : "false";
});

const playerStatusEl = document.getElementById("player-status") as HTMLElement;
playerStatusEl.innerHTML =
  `<div class="nf-vital"><span class="nf-vital-label">Vida</span>` +
  `<div class="nf-bar"><div class="nf-bar-fill" id="player-hp" style="width:100%"></div></div>` +
  `<span id="player-hp-text">100</span><span id="player-hp-max"></span></div>`;
const playerHpBar = document.getElementById("player-hp") as HTMLElement;
const playerHpText = document.getElementById("player-hp-text") as HTMLElement;
/** El denominador de la vida (#527), en su propio span para que
 *  `#player-hp-text` siga siendo UN número. El porqué, en `game-ui.css`. */
const playerHpMax = document.getElementById("player-hp-max") as HTMLElement;
const enemyBarsContainer = document.getElementById("enemy-bars") as HTMLElement;
/** Acción contextual (hablar, reaparecer) y confirmación Y/N: mismos botones,
 *  distinta región. */
const promptBar = new ActionBar(document.getElementById("interact-prompt") as HTMLElement);
/** Todo lo que el jugador ve del borde del mundo: el muro de niebla con su
 *  rótulo, la pregunta de sí/no y su silencio durante el diálogo (#515). */
const fronteraEnPantalla = crearFronteraEnPantalla((edge) => fpsRenderer.setFrontierVeil(edge));
const connectionStatus = document.getElementById("connection-status") as HTMLElement;

/** La conversación con un personaje (`ui/conversacion.ts`): el panel, el ratón
 *  que suelta y devuelve, y la elección camino del motor. `narrativeClient`
 *  nace más abajo, en el Init: cruza como función y se lee al elegir. */
const conversacion = crearConversacion({
  lienzo: () => fpsRenderer.element,
  session,
  enviarEleccion: (eleccion) => narrativeClient.sendDialogueChoice(eleccion),
});
const travelPanel = new TravelPanel();
/** Lo que el juego recuerda del último viaje pedido por «Salidas», paso a
 *  paso: sin esto, un viaje que no llega y uno lento son el mismo silencio. */
const travelLedger = new TravelLedger();
/** Qué tile se pidió, cuál llegó y DE DÓNDE salió (motor / caché / snapshot). */
const tileLedger = new TileLedger();
errors.attach(document.getElementById("error-log") as HTMLElement);
// Tema base: la partida lo sustituye por el del estilo al abrir sesión. Ya
// no se empuja a ningún renderer: el único que queda no pinta texto dentro
// del lienzo (los nombres son DOM temado, world-labels.ts) — el CSS llega.
applyUiTheme(BASE_UI_THEME);

// --- State ---
const playerPos: Vec3 = { x: 0, y: 0, z: 2 };
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
/** La regla de la frontera (proponer el vecino, pedirlo una vez, enfriar el
 *  error) es de core, con el reloj inyectado; aquí se construye y se pinta. */
const frontier = new Frontera();
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
  velo: (v) => fronteraEnPantalla.velo(v),
  preguntar: (q) => fronteraEnPantalla.preguntar(q),
  pedido: (key) => tileLedger.pedido(key),
  pedirTile: (tx, ty, reason, edge) => narrativeClient.requestTile(tx, ty, reason, edge),
  log: (msg) => log(msg),
});

// Proveedor de input (plugin): default teclado+ratón; ?input=scripted instala
// el driver programático de bench. Un id desconocido no arranca — fail-loud.
const requestedInputId = new URLSearchParams(location.search).get("input") ?? undefined;
/** «Hay una conversación abierta», y SOLO desde su dueño (#314).
 *
 *  Antes esto era un campo público del proveedor que abrir la conversación
 *  ponía y cerrarla quitaba: una tercera representación del panel, escribible
 *  desde cualquier módulo del cliente. Ahora el proveedor PREGUNTA y la
 *  respuesta la deriva del panel su dueño (`ui/conversacion.ts`), así que no
 *  hay nada que desincronizar ni
 *  nadie de fuera que pueda mentir. Lo comparten el proveedor de juego y las
 *  teclas dev porque es la misma pregunta. */
const dialogoAbierto = (): boolean => conversacion.abierta();
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

// Teclas de desarrollo (G/B): fijas, independientes del provider.
const devInput = new DevToolsInput({ dialogoAbierto, propuestaDeTileAbierta });


/** El HUD de combate: el catálogo del sistema de la sesión, su barra con las
 *  teclas 1..N y los parámetros del ataque elegido. Nace con el catálogo
 *  estándar (sin sesión) y el sink `combat` le instala el de cada partida.
 *  El arma del aro la dice el bridge en cada frame (#504): pregunta, no valor. */
const armaDelJugador = () => gameClient?.getCombatant("player")?.weaponId ?? "";
const hud = crearHudDeCombate({ input: () => input, arma: armaDelJugador, log });

/** Lo que el jugador VE y LEE de lo que resuelve el sim: el aro del ataque, las
 *  líneas del registro de combate y si sigue de pie. El combate se resuelve en
 *  core detrás del bridge; esto es su eco. */
const eco = new EcoDelCombate({
  log: (msg) => log(msg),
  respingo: (id) => animacion.respingo(id),
  paramsDelAtaque: () => hud.parametrosSeleccionados(),
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

// El toggle Dev-cache vive ahora en el panel de dev (DevStatusPanel es su
// único dueño: estado inicial, cambios y deshabilitado con ai_server caído).

// --- Game client (will be set async) ---
let gameClient: GameClient | null = null;

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
  aspecto.desvestir();
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

/** Las fixtures del selector «Room» viven en `world/fixtures-del-selector.ts`:
 *  el desplegable, el glob y la única normalización local del cliente. De aquí
 *  reciben la carga de tile, el vaciado del mundo y la línea del juego. */
const fixtures = crearFixturesDelSelector({
  addTile,
  resetWorld,
  log,
});

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


/** Último error de render registrado — dedup para no inundar el ErrorLog a
 *  60 fps con la misma excepción. */
let lastRenderError = "";

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
  if (!dialogoAbierto()) {
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

// --- Respawn ---

/** R (one-shot del provider): revive al player si está muerto. La condición
 *  de negocio vive aquí; el provider solo transporta la intención. */
function handleRespawnRequest(): void {
  const p = gameClient?.getCombatant("player");
  if (!p || p.health > 0) return;
  // DÓNDE se vuelve lo decide core (`puntoDeReaparicion`): aquí solo se le da
  // la posición del cadáver, la pregunta de qué es sólido y el rect del tile
  // de debajo.
  const rp = puntoDeReaparicion(playerPos, collidesAt, tileStore.getAt(playerPos.x, playerPos.z)?.rect ?? null);
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

/** Nombres sobre la cabeza y mirilla: DOM temado sincronizado con la cámara
 *  del frame recién pintado (`ui/etiquetas-del-mundo.ts`). */
const etiquetas = crearEtiquetasDelMundo({ fpsRenderer, mundo, playerPos, dialogoAbierto });

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
  if (dialogoAbierto()) {
    // El diálogo suspende la propuesta de tile: sus teclas Y/N quedan mudas.
    // Ya no hay que decírselo al proveedor — lo DERIVA él
    // (`propuestaDeTileAbierta`, #329) de la misma guarda que hay aquí.
    fronteraEnPantalla.callarDuranteElDialogo();
  }
  if (!dialogoAbierto()) {
    aplicarMirada();

    // El PASO: las reglas (marco relativo al facing, diagonal renormalizada,
    // deslizamiento por ejes y «salir sí, entrar no») viven en `nefan-core`.
    // Aquí solo se le dan las teclas, el marco y la pregunta de qué es sólido,
    // y se aplica el delta que devuelve.
    const { dx, dz } = pasoDelJugador({
      desde: playerPos,
      forward: mirada.forward,
      intencion: intencionDeTeclas(input.state),
      velocidad: velocidadDelJugador(playerCfg, input.state.sprint),
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
  // de la tecla E, que lo declara `combat_config.json` (`interact_range_m`). El
  // criterio es de core (`pickNearestTarget`), hermano del que decide qué
  // enfila la cámara — dos criterios de «a qué me refiero» en dos ficheros es
  // como divergen.
  const vivos = mundo.npcs.filter((n) => n.alive !== false);
  const cerca = pickNearestTarget(playerPos, vivos, { maxDistanceM: playerCfg.interact_range_m });
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

  if (dialogoAbierto()) portrait.tick(now);

  // Attack
  const attackRequested = dialogoAbierto() ? false : input.consumeAttack();

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
  const pHpPct = Math.max(0, result.playerHp / result.playerMaxHp * 100);
  playerHpBar.style.width = pHpPct + "%";
  playerHpText.textContent = Math.ceil(result.playerHp).toString();
  playerHpMax.textContent = ` / ${Math.ceil(result.playerMaxHp)}`;

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
  const spritesOn = CONFIG.graphics.character_sprites && aspecto.hojasBaseListas();
  const modelo = aspecto.modelo();
  let playerSprite: Entity["sprite"];
  if (spritesOn && modelo !== null) {
    playerSprite = animacion.spriteDelJugador(now, modelo, aspecto.skinPrompt(), {
      vivo: eco.jugadorVivo,
      andando:
        !dialogoAbierto() &&
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
        maxHp: result.playerMaxHp,
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
  etiquetas.actualizar();

  scheduleNextFrame();
}

// --- Init ---

fixtures.poblar();

// El override de bench `?bridge=` (stack E2E de labs/narrative): net/service-urls.ts.
const sharedBridge = new BridgeClient(serviceUrl("game-gateway"));
const narrativeClient = new NarrativeClient(sharedBridge, {
  esMia: (sessionId) => session.esMio(sessionId),
  log: (msg) => log(msg),
});
const titleScreen = new TitleScreen(narrativeClient);
const historyBrowser = new HistoryBrowser(narrativeClient);
/** Los modos de gráficos de la partida (escenarios y personajes), el chip del
 *  HUD que los enseña y cambia, y el rearme de skins al pasar personajes a ON.
 *  Se construye aquí porque pide al bridge por `narrativeClient`, que acaba de
 *  nacer; el sink `renderModes` y el gate del atlas, más arriba, lo leen en
 *  cierres que no corren hasta que hay sesión. Repartir «los modos han
 *  cambiado» a sus observadores es trabajo de esta raíz, que es quien los
 *  tiene: el panel de dev y el menú dev (`const` de más abajo; el primer
 *  `aplicar` es el del título, después del Init). */
const graficos = crearModosDeGraficos({
  characterSprites,
  session,
  narrativeClient,
  mundo,
  skinPromptDelJugador: () => aspecto.skinPrompt(),
  alCambiarLosModos: (renderMode) => {
    devPanel.setSession({ renderMode });
    devMenu.refresh();
  },
  log,
});

// Las salidas del tile activo cambiaron sin que cambie la escena (#179): solo el panel.
sharedBridge.on("exits_changed", (msg) => { if (session.esMio(msg.sessionId)) cargaDeTile.actualizarSalidas(msg.sceneId, msg.exits); });
// Cambio de modo de render difundido por el bridge (otro cliente de la misma sesión, o el eco de este — re-aplicar es idempotente).
sharedBridge.on("render_mode_changed", (msg) => {
  if (session.esMio(msg.sessionId)) graficos.aplicarFaceta(msg.facet, msg.renderMode);
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
    if (textured.has(t.key) || !fpsRenderer.getTileSurfaces(t.key)) continue;
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
  const propio = aspecto.skinPrompt();
  if (propio) prompts.add(propio);
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

/** Menú dev de imágenes (lista de fakes con generación por item). Es un
 *  inventario sobre todo el cliente —renderer, tiles, atlas, mundo, skins—,
 *  así que vive en la raíz, que es la única que lo ve todo. */
const devMenu = new DevMenu({
  listFakeItems,
  generate: generateFakeItem,
  log: (msg) => log(msg),
});

// El chip de gráficos va oculto mientras el título está abierto (ahí el modo
// se elige en el propio título); reaparece al cerrarlo — incluido el cierre
// fixtures (#ts-close).
//
// Y con él, TODO lo que se leía por debajo del título: el HUD de juego y el
// error-log asomaban entre el texto porque la partida seguía pintando detrás
// (#246). Un interruptor y no una lista de widgets: el motivo lo lleva el
// propio título, así que quien añada un panel nuevo no tiene que acordarse de
// nada. Desde #285 el interruptor apaga también el INPUT de juego, por la
// misma lectura: `ui/titulo-manda.ts`.
//
// El muro de carga es también el único pintor de avisos (#306), y por eso se
// construye aquí: necesita el título, que acaba de nacer. `volverAlTitulo` es
// una declaración de función, así que existe aunque esté más abajo.
const muro = crearMuroDeCarga({ titleScreen, volverAlTitulo, lienzo: () => fpsRenderer.element });
titleScreen.onVisibilityChange = (visible) => {
  graficos.ocultarChip(visible);
  muro.alCambiarElTitulo(visible);
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
  attackBar: hud.barra,
  promptBar,
  confirmBar: fronteraEnPantalla.barraDeConfirmacion,
  dialoguePanel: conversacion.panel,
  devPanel,
  fpsRenderer,
  fpsAtlas: fpsAtlasController,
  titleScreen,
  narrativeClient,
  session,
  collidesAt,
  dialogoAbierto,
  combatSystemId: () => hud.sistemaId(),
  attackCatalog: () => hud.catalogo(),
  addTileRaw: fixtures.addTileRaw,
  loadSceneData: fixtures.loadSceneData,
  cargarFixture: fixtures.cargarFixture,
});

travelPanel.onTravel = (placeId) => {
  if (!session.active) return;
  muro.mostrar("Viajando...", "El motor narrativo está preparando el lugar.");
  travelLedger.pedido(placeId);
  narrativeClient.enterPlace(placeId);
};

narrativeClient.onStatusDeLaPartida((status) => {
  // ── Latido de progreso del motor narrativo ────────────────────────────
  // Un paso observable (petición recogida, tool de estado llamada): el
  // loader deja de ser una espera muda de minutos y narra qué está pasando.
  if (status.phase === "progress") {
    if (status.message) muro.progreso(status.message);
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
  // El feedback de un tile es DIRECCIONAL (el velo que decide la `Frontera`
  // de core), no el overlay central — salvo el bootstrap (mundo aún vacío).
  if (status.kind === "tile") {
    const t = status.tile;
    if (t) {
      const key = `tile_${t.tx}_${t.ty}`;
      if (status.phase === "ready") tileLedger.llegado(key, status.source ?? null);
      if (status.phase === "error") tileLedger.fallo(key, status.message ?? "sin mensaje");
    }
    switch (status.phase) {
      case "generating":
        if (t) frontier.alTexto(t.tx, t.ty, status.message ?? "Generando el mundo");
        if (!tileStore.hasGridTiles) {
          muro.mostrar("Generando mundo inicial...", status.message ?? "El motor narrativo está construyendo el mundo.");
        }
        break;
      case "ready":
        // La escena llega por scene_init (addTile dispara el flash allí).
        muro.ocultar();
        break;
      case "error": {
        if (t) frontier.alError(t.tx, t.ty, performance.now()); // el reloj de `tick`
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
        muro.mostrar(
          status.placeId ? "Viajando..." : "Generando escena...",
          status.message ?? "El motor narrativo está construyendo el mundo. Puede tardar un momento.",
        );
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
    overlayAbierto: muro.visible(),
  });
  errors.push("narrative", rotulo.detalle);
  if (rotulo.destino === "overlay") {
    muro.fallo(rotulo.titulo, rotulo.detalle, rotulo.salida);
  }
  else log(`⚠ ${rotulo.detalle.slice(0, 100)}`);
}

/** Los spawns del motor (`spawn_entity`) se materializan en
 *  `world/materializar-spawn.ts`, por la misma puerta en vivo y al reanudar.
 *  De aquí reciben el mundo, el gestor de skins, el cliente de juego (que se
 *  construye después), las barras del HUD y la línea del juego. */
const spawnDelMotor = crearMaterializadorDeSpawn({
  mundo,
  characterSprites,
  gameClient: () => gameClient,
  rebuildEnemyBars,
  log,
});

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
        conversacion.abrir(
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
        conversacion.panel.setPortrait(portrait.element);
        break;
      }
      case "story_delta":
        log(`📖 ${effect.delta.slice(0, 80)}`);
        break;
      case "scene_loaded": {
        // El bridge difunde una escena recién generada, realizada o re-difundida
        // como SU propio effect (`SceneLoadedEffect`, eventId `scene_init`):
        // eso es "cargar escena", y no es materializar una entity.
        const scene = effect.scene;
        // El tile realizado de un lugar lleva su `place_id` (lo estampa el
        // bridge): es lo que ata esta escena al viaje que el jugador pidió, y
        // no al prefetch que aterrice a la vez.
        travelLedger.escena(scene.scene_id || effect.sceneId, scene.place_id);
        // Tile del plano: ADITIVO (los anteriores no desaparecen). Toda escena
        // servida es un tile (#405): no hay «escena suelta» que resetee el mundo.
        const t = scene.tile;
        paso(
          addTile(scene).then(() => {
            const edge = frontier.alTileListo(t.tx, t.ty, playerPos.x, playerPos.z);
            if (edge) {
              // Sin destello de llegada: el feedback ES que el muro de
              // niebla de esa frontera se disipa y descubre el terreno
              // nuevo. Un flash encima solo tapaba lo que hay que mirar.
              const ES: Record<string, string> = { north: "norte", south: "sur", east: "este", west: "oeste" };
              log(`🌍 el mundo continúa hacia el ${ES[edge]}`);
            } else {
              log(`🌍 tile listo: ${effect.sceneId}`);
            }
          }),
          "scene",
          `el tile ${effect.sceneId} llegó pero no se pudo instalar`,
        );
        break;
      }
      case "spawn_entity":
        // Una entidad suelta que se materializa in-place en la escena viva.
        spawnDelMotor.materializar(effect);
        break;
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
    // Sin bridge NO hay partida (CONFIG.session.require_bridge). Aquí NO se
    // pinta nada: la causa entra al canal de avisos desde quien la conoce
    // (`createGameClient`, con el mismo trío que el `onerror` del socket), y el
    // muro es del único pintor (`ui/muro-de-carga.ts`); así el jugador ve UN
    // muro por esa causa, en su idioma (#469). Se registra, y queda un cliente
    // inerte para que el game loop pinte: sin él, `gameClient` se quedaba a
    // null y el loop salía por su guarda antes de render(), así que el
    // selector de fixtures cargaba la escena sobre un lienzo NEGRO — que es
    // justo lo que el preset `html-fixtures` promete poder hacer sin backend
    // (issue #215).
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
    // Solo relanza `unIntentoDeArrancar` cuando el propio título no se puede
    // pintar, y ese camino ya dejó su muro puesto («No se pudo mostrar la
    // pantalla de título»): aquí solo se registra, un muro por causa (#469).
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
  const motivo = muro.motivoDelUltimoMuro() ?? undefined;
  muro.ocultar();
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
    muro.fallo(
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
      muro.mostrar(
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
      await aspecto.vestir(action.appearance.model_id, action.appearance.skin_path);
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
      // `resetWorld` lo desviste (`aspecto.desvestir`), así que vestir primero
      // dejaría al muñeco desnudo.
      //
      // resume: trust the save's appearance verbatim. Un model_id sin sheets
      // completos (o vacío) cae a la base y_bot dentro de `aspecto.vestir`.
      const desiredModel = res.state.player.appearance.model_id;
      const skinPath = res.state.player.appearance.skin_path || "";
      await aspecto.vestir(desiredModel, skinPath);

      // Materialise the world the player was in: TODOS los tiles del save se
      // re-añaden (el plano continuo sobrevive al resume), y la escena activa
      // PRIMERO: `addTile` activa el primer tile del plano (`carga-de-tile.ts`)
      // y ese debe ser el del save, no el primero de `scenes_loaded` (#390).
      const activeId = res.state.world?.active_scene_id;
      const scenes = res.state.scenes_loaded;
      const activa = activeId ? scenes[activeId]?.scene_data : undefined;
      const resto = Object.entries(scenes).flatMap(([id, rec]) =>
        id !== activeId ? [rec.scene_data] : [],
      );
      const porAnadir = activa ? [activa, ...resto] : resto;
      for (const scene of porAnadir) await addTile(scene);
      if (porAnadir.length === 0) log(`(sin escena en el save — esperando narrativa)`);

      // …Y LO QUE EL MOTOR PUSO A MITAD DE PARTIDA. Lo de las escenas ya ha
      // vuelto (arriba); esto es la otra procedencia: las entities de
      // `spawn_reason: "narrative_request"`, que no están en el Format D de
      // ninguna escena y hasta #326 desaparecían enteras al reanudar — el
      // enemigo que el motor te echó encima, el NPC con el que hablabas, el
      // edificio que apareció. Vuelven por la MISMA puerta por la que
      // llegaron (`world/materializar-spawn.ts`), así que no hay un segundo
      // constructor que se olvide de la mitad.
      //
      // DESPUÉS de los tiles, y el orden importa: materializar un hostil da de
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
      for (const spawn of spawns) spawnDelMotor.materializar(spawn, { rehidratado: true });
      if (spawns.length > 0) log(`El mundo vuelve con ${spawns.length} cosa(s) que puso el motor`);
      // La posición viene del save, y ahora está VIVA: el bridge ata el
      // combatiente del sim al NarrativeState al sembrarlo, así que cualquiera
      // de sus guardados la lleva fresca (issue #245).
      const savedPos = res.state.player?.position;
      if (Array.isArray(savedPos) && savedPos.length === 3) {
        playerPos.x = savedPos[0];
        playerPos.z = savedPos[2];
      }
      // Solo si la posición no cae en el tile ya activo: la misma clave se
      // re-encolaría en el controller y correría un segundo resolve.
      const underResume = tileStore.getAt(playerPos.x, playerPos.z);
      if (underResume && underResume.key !== mundo.tileActivo) setActiveClientTile(underResume.key);
    }
  } catch (err) {
    errors.push("session", "session start/resume failed", err);
    // El error va AL TÍTULO, no al loader: el título tiene z-index 9999 y el
    // loader 70, así que un título de vuelta escondería el error debajo y el
    // jugador volvería a la pantalla inicial sin saber por qué.
    muro.ocultar();
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
  // …y solo aquí el jugador tiene cuerpo: `aspecto.vestir` ya volvió sin
  // lanzar. Es la otra mitad de la entrada (#279). Un clon sin hojas no llega
  // hasta esta línea —cae en el catch de arriba, que abandona la partida—, así
  // que su tile, que llegó ANTES, no basta para escribir nada.
  entrada.vestido();
  return null;
}

scheduleNextFrame();
