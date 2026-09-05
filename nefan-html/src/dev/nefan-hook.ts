/** `window.__nefan` — EL SEAM POR EL QUE ENTRA EL BANCO DE PRUEBAS.
 *
 *  Estado vivo y verbos de conducción para los guiones de `qa/` y los benches
 *  de `labs/`: 67 ficheros leen por aquí. Solo lectura salvo los pocos verbos
 *  que están declarados como tales (`setYaw`, `setPlayerPos`, `closeTitle`,
 *  `loadFixture`…). NO es API del juego: nada de `nefan-html/src` lo consume.
 *
 *  POR QUÉ ESTÁ EN SU PROPIO FICHERO (#358). Estaba repartido en TRES puntos de
 *  escritura de `main.ts` separados por 1.800 líneas: el objeto base, un merge
 *  con `Object.defineProperties` bajo `import.meta.env.DEV` a mitad del
 *  fichero, y un `nefanHook.estilo = …` suelto al final —que estaba suelto
 *  porque `titleScreen` se construye después—. Cada vez que se tocaba el código
 *  de alrededor, el seam se movía; y el merge existía por una razón real que su
 *  propio comentario declaraba: reemplazar el objeto dejaba a los benches sin
 *  `tiles` ni `frontier`. Aquí hay UNA construcción, y el orden deja de
 *  importar porque todo llega por `deps`.
 *
 *  LO QUE NO CAMBIA, y es el criterio de aceptación de la tanda: las claves
 *  VIVAS responden exactamente lo mismo. Ni un guion de `qa/` se ha tocado por
 *  esto. La única que se va es `dialogueActive`, y por su cuenta (#329): desde
 *  #314 era un segundo nombre de `dialogue().visible` y desde el 2026-08-30 no
 *  la leía nadie.
 *
 *  EL GATE DE DEV SE CONSERVA, y no es cosmético: las claves que conducen el
 *  juego (teletransportar, cerrar el título, cargar fixtures) no viajan en el
 *  bundle de producción. `qa/run.mjs` levanta vite en dev, así que las ve.
 */

import { setDebugLog } from "./debug-log.js";
import { serviceUrl } from "../net/service-urls.js";
import { applyUiTheme, currentUiTheme, type UiTheme } from "../ui/theme.js";
import { ScriptedInputProvider } from "../input/scripted-input-provider.js";
import type { AttackSpec } from "@nefan-core/src/combat/combat-system.js";
import type { Mirada } from "@nefan-core/src/simulation/mirada.js";
import type { Vec3 } from "@nefan-core/src/types.js";
import type { InputProvider } from "../input/input-provider.js";
import type { EscenaServida } from "@nefan-core/src/protocol/messages.js";
import type { MundoDelCliente } from "../world/mundo-del-cliente.js";
import type { TileStore } from "../world/tile-store.js";
import type { FrontierManager } from "../world/frontier.js";
import type { TravelLedger } from "../ui/travel-ledger.js";
import type { TileLedger } from "../ui/tile-ledger.js";
import type { CharacterSpriteManager } from "../renderer/character-sprites.js";
import type { ActionBar } from "../ui/action-bar.js";
import type { DialoguePanel } from "../ui/dialogue-panel.js";
import type { DevStatusPanel } from "../ui/dev-status-panel.js";
import type { FpsRenderer } from "../renderer/fps-renderer.js";
import type { TitleScreen } from "../ui/title-screen.js";
import type { FpsAtlasController } from "../scene/fps-atlas.js";
import type { NarrativeClient } from "../net/narrative-client.js";
import type { OpcionesDeCarga } from "../world/carga-de-tile.js";

/** Todo lo que el hook mira. Son colaboradores del cliente, y llegan por aquí
 *  en vez de por clausura para que este fichero no pueda alcanzar nada más. */
export interface DepsDelHook {
  input: InputProvider;
  playerPos: Vec3;
  mirada: Mirada;
  mundo: MundoDelCliente;
  tileStore: TileStore;
  frontier: FrontierManager;
  travelLedger: TravelLedger;
  tileLedger: TileLedger;
  characterSprites: CharacterSpriteManager;
  attackBar: ActionBar;
  promptBar: ActionBar;
  confirmBar: ActionBar;
  dialoguePanel: DialoguePanel;
  devPanel: DevStatusPanel;
  fpsRenderer: FpsRenderer;
  fpsAtlas: FpsAtlasController;
  titleScreen: TitleScreen;
  narrativeClient: NarrativeClient;
  session: { readonly facets: unknown };
  collidesAt(x: number, z: number): boolean;
  dialogoAbierto(): boolean;
  /** Id del sistema de combate de la sesión y su catálogo: son `let` de
   *  módulo en `main.ts` (los reescribe cada partida), así que llegan como
   *  preguntas y no como valores congelados en el arranque. */
  combatSystemId(): string;
  attackCatalog(): readonly AttackSpec[];
  /** Format D crudo → escena servida sin salidas → `addTile`. La normalización
   *  vive en `main.ts`, que es el único sitio del cliente que la hace. */
  addTileRaw(raw: Record<string, unknown>, opts?: OpcionesDeCarga): Promise<void>;
  loadSceneData(raw: Record<string, unknown>, opts?: OpcionesDeCarga): Promise<void>;
  /** Conduce el `<select>` de fixtures y DEVUELVE la carga. Se queda en
   *  `main.ts` porque es quien tiene el desplegable y la promesa que su
   *  manejador de `change` no sabe devolver. */
  cargarFixture(name: string): Promise<void>;
}

/** Lo que publica `__nefan.scene`: la escena en la forma del WIRE —la world
 *  scene con las salidas encima—, que es lo que leen los guiones del banco
 *  (`s.exits`, guiones 08 y 68). El cliente las guarda SEPARADAS (#410); aquí
 *  se vuelven a juntar en un objeto nuevo, sin tocar lo guardado. */
function escenaServida(mundo: MundoDelCliente): EscenaServida | null {
  const escena = mundo.escenaActiva;
  return escena === null ? null : { ...escena, exits: [...mundo.salidas] };
}

/** Construye el hook y lo instala en `window`. UNA sola construcción: el orden
 *  de las claves deja de depender de dónde esté declarado cada colaborador. */
export function instalarNefanHook(deps: DepsDelHook): void {
  const hook: Record<string, unknown> = {
    input: deps.input,
    get playerPos() { return deps.playerPos; },
    get scene() { return escenaServida(deps.mundo); },
    get dialogueVisible() { return deps.dialoguePanel.isVisible; },
    get exits() { return deps.mundo.salidas; },
    get tiles() { return [...deps.tileStore.entries.keys()]; },
    // Por tile: huella y cuántas veces la colisión del plan se DERIVÓ o se
    // RESTAURÓ (#410). Es lo que hace observable «el tile volvió igual» sin
    // leer una traza de consola (guion 75).
    colision: () => deps.tileStore.colision(),
    get currentTile() { return deps.mundo.tileActivo; },
    get frontier() { return deps.frontier.debugState(); },
    /** Ledger del último viaje por «Salidas»: qué paso se dio y cuál no. */
    get viaje() { return deps.travelLedger.debugState(); },
    /** Episodios de tile: pedido/llegada y el ORIGEN que declara el bridge. */
    get tileEpisodios() { return deps.tileLedger.debugState(); },
    /** Libro de skins: qué personajes ha pedido la PARTIDA (y con qué rol). */
    get skins() { return deps.characterSprites.debugState(); },
    probeCollide(x: number, z: number) { return deps.collidesAt(x, z); },
    /** UI de juego: acciones ofrecidas y tema activo (bench/E2E). */
    ui: {
      actions: () => ({
        attack: deps.attackBar.snapshot(),
        prompt: deps.promptBar.snapshot(),
        confirm: deps.confirmBar.snapshot(),
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
    sesion: () => deps.session.facets,
    /** Lo de OTRA partida que los embudos han tirado: `n` son EVENTOS (#282) y
     *  `status` los `narrative_status` que no eran fallo (#312). Sin esto, «el
     *  tile ajeno no se instaló» y «el tile ajeno no ha llegado todavía» son el
     *  mismo verde, y el segundo no mide nada. Van por separado y no sumados
     *  porque los guiones 29 y 35 afirman cosas distintas con cada uno. */
    descartados: () => deps.narrativeClient.descartados(),
    /** A qué URL resuelve AHORA MISMO cada servicio, ya aplicados los overrides
     *  de la query (`?ai=`, `?bridge=`). No es un adorno de diagnóstico: es lo
     *  que permite al banco de pruebas preguntarle al BACKEND si cobra, en vez
     *  de deducirlo de la URL que el propio runner escribió. Solo lectura. */
    servicios: () => ({
      "game-gateway": serviceUrl("game-gateway"),
      "world-state": serviceUrl("world-state"),
      "narrative-llm": serviceUrl("narrative-llm"),
      "remote-gen": serviceUrl("remote-gen"),
      "asset-store": serviceUrl("asset-store"),
    }),
    /** Trazas de los pipelines de imagen/colisión (dev/debug-log.ts): apagadas
     *  por defecto; también `?debug=1` en la URL. */
    debug(on: boolean) { setDebugLog(on); },
    /** Corrida de «Aplicar estilo» para el bench/QA: lo prometido, lo emitido y
     *  si ya terminó. Lo escribe el propio StyleApplyController. Iba SUELTA al
     *  final de `main.ts` porque `titleScreen` se construye tarde; aquí ya no
     *  hay orden que respetar. */
    estilo: () => deps.titleScreen.styleRunState(),
  };

  // Claves de DEV: estado vivo y verbos de conducción para los drivers E2E de
  // Chrome — permiten verificar movimiento y colisión sin leer píxeles, y
  // conducir el juego sin sintetizar eventos. No viajan al bundle de
  // producción; las de arriba sí.
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    Object.defineProperties(hook, Object.getOwnPropertyDescriptors({
      state: () => ({
        pos: { ...deps.playerPos },
        forward: { ...deps.mirada.forward },
        /** Mirada vertical en grados (positivo = arriba). No entra en forward:
         *  el WASD es horizontal por diseño. */
        pitchDeg: deps.mirada.pitchEnGrados,
        input: { ...deps.input.state },
        // AQUÍ VIVÍA `dialogueActive`, y se fue con esta tanda (#329). Su
        // propio comentario ya decía la condena: desde #314 era un segundo
        // nombre de `dialogue().visible` —las dos son
        // `dialoguePanel.isVisible`— y desde el 2026-08-30 no la leía NINGÚN
        // guion; los que preguntan por el diálogo (41 y 43) usan
        // `puedeAtacar()`, y el 37 perdió su vigilante al descubrirse que
        // comparaba esa clave consigo misma. Una clave del hook que nadie lee
        // y que duplica a otra no es depuración: es la que alguien confundirá
        // algún día con una señal independiente, que es exactamente cómo nació
        // aquel vigilante que no podía ponerse rojo.
        combatSystem: deps.combatSystemId(),
        attackCatalog: deps.attackCatalog().map((a) => a.id),
        blocked: {
          n: deps.collidesAt(deps.playerPos.x, deps.playerPos.z - 0.5),
          s: deps.collidesAt(deps.playerPos.x, deps.playerPos.z + 0.5),
          w: deps.collidesAt(deps.playerPos.x - 0.5, deps.playerPos.z),
          e: deps.collidesAt(deps.playerPos.x + 0.5, deps.playerPos.z),
        },
      }),
      /** `skinPrompt` es con QUÉ se pinta al NPC: su `description` (la
       *  procedencia) o, sin ella, su `name`. Un guion tiene que poder afirmar
       *  que el cliente no inventa una descripción («an entity», el id) para lo
       *  que llegó sin ella (#397). Solo lectura. */
      npcs: () =>
        deps.mundo.npcs.map((n) => ({ id: n.id, label: n.label, pos: { ...n.pos }, skinPrompt: n.skinPrompt })),
      /** Los OBJETOS y EDIFICIOS que el cliente tiene en escena. Hermano de
       *  `npcs()` y `enemies()`: un guion tiene que poder afirmar que el cofre
       *  que el motor puso delante SIGUE ahí tras reanudar, y sin esto solo
       *  podía sondear la colisión — que dice «aquí hay algo», no «aquí está
       *  ESE algo». Solo lectura. */
      objects: () =>
        deps.mundo.objetos.map((o) => ({
          id: o.id,
          label: o.label,
          pos: { ...o.pos },
          category: o.category,
        })),
      /** ¿Puede el jugador ATACAR ahora mismo? Es la MISMA condición que lee la
       *  puerta real (`keyboard-input-provider.ts`: LMB solo cuenta con pointer
       *  lock y sin diálogo abierto), leída de la misma fuente. Existe porque el
       *  driver de bench (`?input=scripted`) NO pasa por esa puerta: sin esto,
       *  un guion puede pegar y ver daño mientras el jugador de verdad aporrea
       *  el ratón sin hacer nada, que es exactamente lo que pasaba tras hablar
       *  con alguien (#323). Solo lectura. */
      puedeAtacar: () => ({
        raton: document.pointerLockElement !== null,
        dialogo: deps.dialogoAbierto(),
        ok: document.pointerLockElement !== null && !deps.dialogoAbierto(),
      }),
      /** Los ENEMIGOS que el cliente tiene en escena, con la vida que el sim le
       *  está diciendo. Hermano de `npcs()` y por la misma razón: un guion tiene
       *  que poder acercarse a un combatiente sin leer píxeles, y el enemigo se
       *  MUEVE (persigue), así que su posición del scene data está vieja en
       *  cuanto empieza la pelea. La AFIRMACIÓN de que pierde vida sigue yendo
       *  contra el HUD (`#hp-text-<id>`), que es lo que ve quien juega; esto es
       *  para saber hacia dónde andar. Solo lectura. */
      enemies: () =>
        deps.mundo.enemigos.map((e) => ({
          id: e.id,
          label: e.label,
          pos: { ...e.pos },
          hp: e.hp,
          maxHp: e.maxHp,
          alive: e.alive,
        })),
      // Panel de dev (#dev-status): los benches E2E pueden leer/conducir su
      // estado (setPainting/recordGeneration) sin tocar píxeles.
      devPanel: deps.devPanel,
      probeCollide: (x: number, z: number) => deps.collidesAt(x, z),
      fps: () => deps.fpsRenderer.debugState(),
      get scene() { return escenaServida(deps.mundo); },
      // Gira al jugador desde el bench a un yaw arbitrario, sin pasar por las
      // flechas de dirección. Mismo camino que el giro real: yaw → forward.
      setYaw: (yaw: number) => {
        deps.mirada.ponYaw(yaw);
      },
      // Teletransporte del bench: posiciona al jugador para las capturas
      // deterministas (respeta la simulación en el siguiente tick — la colisión
      // "salir sí, entrar no" permite des-penetrar si el destino es sólido).
      setPlayerPos: (x: number, z: number) => {
        deps.playerPos.x = x;
        deps.playerPos.z = z;
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
        !deps.titleScreen.isVisible && deps.mundo.escenaActiva !== null && !deps.fpsAtlas.running,
      status: () => ({
        title: deps.titleScreen.isVisible,
        scene: deps.mundo.escenaActiva !== null,
        painting: deps.fpsAtlas.running,
        npcs: deps.mundo.npcs.length,
      }),
      /** Estado del diálogo, o `{visible:false}`. */
      dialogue: () =>
        deps.dialoguePanel.isVisible
          ? { visible: true, ...deps.dialoguePanel.current() }
          : { visible: false },
      /** Elige una opción por índice (0-based). Salta el typewriter primero,
       *  igual que hace cualquier tecla de acción del jugador. */
      chooseDialogue: (index: number) => {
        deps.dialoguePanel.finishTypewriter();
        deps.dialoguePanel.chooseByIndex(index);
      },
      advanceDialogue: () => {
        deps.dialoguePanel.finishTypewriter();
        deps.dialoguePanel.advance();
      },
      /** Cierra el título por el MISMO camino que el jugador (botón #ts-close),
       *  no ocultando el overlay a mano. */
      closeTitle: () => {
        const btn = document.getElementById("ts-close");
        if (!btn) throw new Error("no hay #ts-close: el título no está montado");
        (btn as HTMLButtonElement).click();
      },
      /** Añade un tile MÁS al mundo sin resetearlo, con su Format D crudo.
       *  Es lo que `loadFixture` no puede hacer (toma el mundo y lo vacía), y
       *  sin ello no hay forma de medir desde el árbol el coste de varios tiles
       *  residentes — que es de donde sale `MAX_TILE_VOLUMES`
       *  (`qa/presupuesto-de-volumenes.mjs`). Solo DEV, como el resto del hook. */
      addTileRaw: (raw: Record<string, unknown>) => deps.addTileRaw(raw),
      /** TOMA el mundo con una escena Format D cruda, sin pasar por el selector
       *  «Room»: el hermano de `addTileRaw` para el PRIMER tile de un bench.
       *  Existe porque el selector se puebla con `import.meta.glob`, que vite
       *  expande al transformar `main.ts`: una fixture escrita en disco con el
       *  cliente ya arrancado NO está en el glob, y el bench de presupuesto
       *  fallaba siempre su primera corrida por ese camino (#332) — la
       *  asimetría (sus otros 3 tiles ya entraban crudos) era el bug. Solo DEV,
       *  como el resto del hook. */
      loadSceneRaw: (raw: Record<string, unknown>) => deps.loadSceneData(raw, { tomaElMundo: true }),
      /** Carga una fixture del selector Room por nombre parcial, conduciendo el
       *  <select> real, y DEVUELVE la carga. Fail-loud si no existe: un guion
       *  que "no encuentra" la escena y sigue en verde no vale nada. La
       *  implementación vive en `main.ts` con el desplegable — ver
       *  `cargarFixture`. */
      loadFixture: (name: string): Promise<void> => deps.cargarFixture(name),
      // Driver programático del provider "scripted" (?input=scripted) — API
      // limpia para el bench en vez de sintetizar KeyboardEvents.
      inputDriver: deps.input instanceof ScriptedInputProvider ? deps.input : undefined,
    }));
  }

  (window as unknown as { __nefan?: unknown }).__nefan = hook;
}
