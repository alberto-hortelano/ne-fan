/** LOS MODOS DE GRÁFICOS: el chip del HUD que enseña y cambia en vivo qué
 *  imagen IA NUEVA se genera en esta partida —escenarios (el atlas de
 *  superficies de la fps) y personajes (los skins)—, y el rearme de los skins
 *  cuando la faceta de personajes pasa de OFF a ON.
 *
 *  Es presentación, nada más: el modo de cada faceta lo elige el jugador (en
 *  el título o en el chip); con sesión lo persiste y lo difunde el bridge
 *  (`world.render_mode` / `character_mode` del save, `render_mode_changed`), y
 *  sin sesión —fixtures— se recuerda en `localStorage`. La DECISIÓN de gasto
 *  («¿se genera escenario?», «¿se generan skins?», «un personajes vacío sigue
 *  a escenarios») no está aquí: es `gatesDeImagen` en core
 *  (`session/gates-de-imagen.ts`, #508), a la que este módulo le pasa los
 *  toggles leídos de `localStorage` como booleanos. `CONFIG.graphics.ai_skin`
 *  NO va ahí y se aplica aquí abajo (rótulo y chip): apaga el BACKEND, no el
 *  modo, y el permiso del manager tiene que seguir siendo el modo para que el
 *  fail-loud de `renderer/aspecto-del-jugador.ts` pueda dispararse. El resultado
 *  se le comunica a quien gasta: el controller del atlas PREGUNTA
 *  (`escenariosGeneran()`) y el manager de skins RECIBE su permiso
 *  (`setSkinsAllowed`). */

import type { ClientSession } from "@nefan-core/src/session/session-facets.js";
import {
  gatesDeImagen,
  modoEfectivoDePersonajes,
  normalizarModo,
  type GatesDeImagen,
  type Modo,
} from "@nefan-core/src/session/gates-de-imagen.js";
import { CONFIG } from "@nefan-core/src/config.js";
import type { CharacterSpriteManager } from "../renderer/character-sprites.js";
import type { MundoDelCliente } from "../world/mundo-del-cliente.js";
import type { NarrativeClient } from "../net/narrative-client.js";
import { errors } from "./error-log.js";
import { GraphicsModeChip, type GraphicsFacet } from "./graphics-mode.js";

// --- Generación de imagen SIN sesión (fixtures) ---
/** Toggle local de skins IA SIN sesión (fixtures): persistido en localStorage,
 *  con sesión manda `world.character_mode`. El mando visible es el chip de
 *  gráficos (GraphicsModeChip).
 *
 *  De ESCENARIOS no hay toggle, y no es un olvido (#519): sin partida no hay
 *  motor al que pedirle un tile, así que el único consumidor del gate lo
 *  tapaba (`generationOn: () => session.active && …`) y el interruptor no
 *  decidía nada observable. Uno de gasto que nadie puede tocar y que nada lee
 *  no se conserva —pre-producción—, y su clave tiene candado de reaparición en
 *  `arch-rules.json`. Los skins sí se generan sin partida —una fixture con
 *  NPCs descritos los pide nada más cargar—, y por eso este sigue vivo. */
const AICHAR_KEY = "nefan.aichar";

export interface DepsDeModosDeGraficos {
  /** El manager de skins: recibe el permiso de generar y, cuando personajes
   *  pasa de OFF a ON, se rearma y se le re-piden los skins de todo lo vivo. */
  characterSprites: Pick<
    CharacterSpriteManager,
    "skinsAllowed" | "setSkinsAllowed" | "rearmarCortacircuitos" | "requestSkin"
  >;
  /** Con partida, el bridge es la autoridad del cambio; sin ella, localStorage. */
  session: Pick<ClientSession, "active" | "id">;
  /** El camino al bridge para pedir el cambio de modo con sesión. */
  narrativeClient: Pick<NarrativeClient, "setRenderMode">;
  /** Los personajes en escena, cuyos skins se re-piden al pasar a ON. */
  mundo: Pick<MundoDelCliente, "personajes">;
  /** El prompt del skin del jugador (`""` si va en base). */
  skinPromptDelJugador(): string;
  /** Aviso a la raíz de que los modos han cambiado, con el de escenarios ya
   *  normalizado. Repartirlo a sus observadores (panel de dev, menú dev) es
   *  trabajo de la raíz, que es quien los tiene. */
  alCambiarLosModos(renderMode: Modo): void;
  log(msg: string): void;
}

export interface ModosDeGraficos {
  /** Aplica los DOS modos de render de la sesión (escenarios y personajes).
   *
   *  RECIBE UN OBJETO Y NO DOS `string` POSICIONALES, y no es cosmética (#316).
   *  Los dos parámetros eran del mismo tipo, así que cruzarlos compilaba con cero
   *  errores y —a diferencia del resto de cruces que #316 cerró— este SÍ se parece
   *  a código correcto: es la forma canónica del bug de orden de argumentos, y sus
   *  llamantes lo escriben con dos ternarias seguidas, que es justo donde se
   *  cruzan. Lo que alimenta son los gates de generación de IMAGEN, o sea el
   *  vecindario del bug #249 que `session-facets.ts` existe para evitar; y vive en
   *  el cliente, que no tiene harness (#241), no entra en mutación y no lo mira
   *  ningún test — el peor sitio del repo para dejar un cruce silencioso.
   *
   *  Con un objeto, cruzarlos deja de ser un desliz de posición y pasa a ser
   *  escribir mal el nombre del campo, que no compila. */
  aplicar(f: { renderMode: string; characterMode: string }): void;
  /** Aplica UNA faceta en local, con la otra como está. Es lo que hace el eco
   *  del bridge (`render_mode_changed`): ya viene decidido y persistido, así
   *  que NO se le vuelve a pedir — pedirlo sería «ya en ese modo» y un aviso
   *  en el registro. */
  aplicarFaceta(facet: GraphicsFacet, mode: "image" | "vector"): void;
  /** ¿Debe generarse imagen NUEVA de escenario? (atlas de superficies de la
   *  fps; la generación MANUAL —tecla G, item del menú dev— no pasa por aquí:
   *  es siempre permitida). */
  escenariosGeneran(): boolean;
  /** Oculta el chip mientras el título está abierto (ahí el modo se elige en
   *  el propio título). */
  ocultarChip(oculto: boolean): void;
}

export function crearModosDeGraficos(deps: DepsDeModosDeGraficos): ModosDeGraficos {
  /** Modo de render por faceta de la sesión activa. Ya NO está congelado: el
   *  chip de gráficos del HUD lo cambia en runtime (el bridge lo persiste en
   *  el save y lo difunde con render_mode_changed). Valores:
   *  - "image": generación IA activa (atlas de superficies de la fps, skins de
   *    personaje) — créditos.
   *  - "vector": sin generación NUEVA; el arte es el clay greybox local y la
   *    base y_bot. Lo ya pintado se conserva.
   *  - "" (sin sesión o saves previos al campo): en escenarios no se genera
   *    nada (sin partida no hay tile que pedir); en personajes manda el toggle
   *    persistido en localStorage (AICHAR_KEY). */
  let scenesMode: Modo = "";
  let charactersMode: Modo = "";

  /** Los dos gates de gasto, decididos en core con lo que este cliente sabe:
   *  los modos de la sesión y el toggle de personajes de `localStorage` (que
   *  manda sin sesión, OFF por defecto: cargar una fixture con NPCs descritos
   *  no debe gastar créditos sin que nadie lo pida). */
  function gates(): GatesDeImagen {
    return gatesDeImagen({
      renderMode: scenesMode,
      characterMode: charactersMode,
      toggleLocalPersonajes: localStorage.getItem(AICHAR_KEY) === "1",
    });
  }

  function escenariosGeneran(): boolean {
    return gates().escenarios;
  }

  function aplicar({ renderMode, characterMode }: { renderMode: string; characterMode: string }): void {
    const prevCharOn = deps.characterSprites.skinsAllowed;
    scenesMode = normalizarModo(renderMode);
    charactersMode = normalizarModo(characterMode);
    const effChar = modoEfectivoDePersonajes({ renderMode: scenesMode, characterMode: charactersMode });
    const g = gates();
    deps.characterSprites.setSkinsAllowed(g.personajes);
    // Fail-loud: la partida pide skins IA pero el backend está apagado por
    // config — sin este aviso, requestSkin haría no-op silencioso y el jugador
    // que confirmó el gasto vería y_bot sin explicación.
    if (effChar === "image" && !CONFIG.graphics.ai_skin) {
      errors.push(
        "config",
        "la partida tiene skins IA activados pero graphics.ai_skin=false en config — los personajes irán en base y_bot",
      );
    }
    // `ai_skin` en el RÓTULO y no en el gate: lo que el backend apagado
    // cambia es lo que el jugador lee (arriba ya se le avisó).
    const charLabel = effChar !== "vector" && CONFIG.graphics.ai_skin
      ? "skins IA" : "personajes en base y_bot";
    if (scenesMode === "vector") {
      deps.log(`Gráficos: maqueta 3D (clay local, sin imagen IA nueva; ${charLabel})`);
    } else if (scenesMode === "image") {
      deps.log(`Gráficos: imagen IA (${charLabel})`);
    }
    // Personajes OFF→ON: los requestSkin que no-opearon con el toggle apagado
    // no dejaron rastro — re-pedir los skins de todo lo ya spawneado.
    if (!prevCharOn && deps.characterSprites.skinsAllowed) {
      deps.characterSprites.rearmarCortacircuitos();
      rePedirTodosLosSkins();
    }
    deps.alCambiarLosModos(scenesMode);
    chip.refresh();
  }

  /** Re-encola los skins IA de todas las entidades vivas (player + NPCs +
   *  enemigos). requestSkin es idempotente por prompt y respeta ai_skin. */
  function rePedirTodosLosSkins(): void {
    const propio = deps.skinPromptDelJugador();
    if (propio) deps.characterSprites.requestSkin(propio);
    for (const e of deps.mundo.personajes) {
      if (e.skinPrompt) deps.characterSprites.requestSkin(e.skinPrompt, { role: e.styleRole });
    }
  }

  function aplicarFaceta(facet: GraphicsFacet, mode: "image" | "vector"): void {
    aplicar({
      renderMode: facet === "scenes" ? mode : scenesMode,
      characterMode: facet === "characters" ? mode : charactersMode,
    });
  }

  /** Cambio de modo pedido por el usuario (chip de gráficos). Con sesión, el
   *  bridge es la autoridad (persiste el save y difunde); sin sesión, los
   *  personajes son estado local puro (AICHAR_KEY).
   *  Lanza si el bridge rechaza — el chip lo captura y se re-lee (revert). */
  async function cambiarFaceta(facet: GraphicsFacet, mode: "image" | "vector"): Promise<void> {
    if (deps.session.active) {
      await deps.narrativeClient.setRenderMode(deps.session.id, facet, mode);
    } else if (facet === "scenes") {
      // Sin partida no hay a quién pedirle un tile, así que encender los
      // escenarios no encendería nada: se DICE por el canal del cliente y no se
      // apunta en una clave que nadie lee (#519). No se lanza: el chip trata
      // una excepción como «el bridge rechazó» y le pega la traza al registro
      // del jugador, que para esto es ruido. Sin aplicar nada, su `finally`
      // re-lee el estado real y el botón revierte solo.
      errors.push(
        "graphics-mode",
        "sin partida no se generan escenarios: el atlas de superficies se pide para el tile de una sesión — empieza o reanuda una partida",
      );
      return;
    } else {
      localStorage.setItem(AICHAR_KEY, mode === "image" ? "1" : "0");
    }
    aplicarFaceta(facet, mode);
  }

  // Arranque sin sesión: los skins IA parten del toggle local (OFF por
  // defecto) — el manager nace con allowed=true y sin esto una fixture con
  // NPCs descritos encolaría skins de pago nada más cargar. Va ANTES del
  // chip: su primer `refresh()` ya lee el permiso real.
  deps.characterSprites.setSkinsAllowed(gates().personajes);

  // Chip de gráficos (UI de cliente): el MISMO modo que se elige al crear la
  // partida en el título, visible y cambiable en juego. El cambio va por
  // `cambiarFaceta` (bridge con sesión / localStorage sin ella) — nunca por
  // bridge-client directo. Nace oculto: el título está abierto al arrancar.
  const chip = new GraphicsModeChip({
    getState: () => ({
      scenesOn: gates().escenarios,
      charsOn: deps.characterSprites.skinsAllowed && CONFIG.graphics.ai_skin,
      charsAvailable: CONFIG.graphics.ai_skin,
      hasSession: deps.session.active,
    }),
    setMode: cambiarFaceta,
  });

  return {
    aplicar,
    aplicarFaceta,
    escenariosGeneran,
    ocultarChip: (oculto) => chip.setHidden(oculto),
  };
}
