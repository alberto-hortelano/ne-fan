/** El estado de sesión del cliente, como UN valor.
 *
 *  Antes eran dos variables sueltas de módulo (`activeSessionId` y
 *  `sessionModesApplied`) que tenían que moverse juntas, más cinco aplicadores
 *  sueltos (estilo, tema de UI, modos de render, sistema de combate, libro de
 *  historia). Entrar los ponía los cinco; salir deshacía DOS por un camino
 *  (`volverAlTitulo`) y UNO por el otro (el catch del bucle del título). Esa
 *  asimetría no era cosmética: el gate del gasto de imagen es
 *  «sesión aplicada && modo imagen», así que un retorno al título que se
 *  dejaba el flag puesto pagaba un atlas con el estilo de la partida que no
 *  llegó a arrancar (issue #249).
 *
 *  Aquí no hay reset que olvidar porque NO HAY RESET: «sin partida» es un
 *  valor del mismo tipo (`NO_SESSION`), y entrar y salir son la misma función
 *  con distinto argumento. Añadir una faceta obliga a darle su neutro (o no
 *  compila), a darle un aplicador (o no compila) y a cablear su sink en el
 *  cliente (o no compila): las tres las comprueba `tsc` sobre `src/`.
 *
 *  Módulo PURO: no toca el DOM ni node:*. Los efectos los pone el cliente en
 *  los sinks — este fichero solo garantiza que se aplican todos, siempre, en
 *  los dos sentidos. */

import { BASE_UI_THEME, type UiTheme } from "../games/ui-theme.js";

/** Todo lo que una partida imprime en el cliente. Un campo aquí es una cosa
 *  que hay que deshacer al volver al título — por eso viven juntos. */
export interface SessionFacets {
  /** Id del save. "" = no hay partida. */
  sessionId: string;
  /** Estilo visual congelado en el save (clave de caché de imagen). */
  styleId: string;
  /** Modo de render de escenarios ("image" | "vector" | ""). */
  renderMode: string;
  /** Modo de render de personajes ("image" | "vector" | ""). */
  characterMode: string;
  /** Sistema de combate de la sesión ("" = catálogo estándar). */
  combatSystem: string;
  /** Tema de UI del style pack. */
  uiTheme: UiTheme;
}

/** «Sin partida», como valor. Es el ÚNICO sitio donde se escribe el neutro de
 *  cada faceta: una faceta nueva sin neutro no compila. */
export const NO_SESSION: SessionFacets = {
  sessionId: "",
  styleId: "",
  renderMode: "",
  characterMode: "",
  combatSystem: "",
  uiTheme: BASE_UI_THEME,
};

/** Los efectos de cada faceta, que pone el cliente. Se invocan TODOS en cada
 *  transición, con los valores de la sesión al entrar y con los neutros al
 *  salir: el sink no sabe en qué sentido va, y por eso no puede divergir. */
export interface FacetSinks {
  /** Estilo visual → generadores de imagen (atlas de superficies, skins). */
  style(styleId: string): void;
  /** Tema de UI → custom properties de #game-ui. */
  theme(uiTheme: UiTheme): void;
  /** Modos de render por faceta → gates de generación del cliente. */
  renderModes(renderMode: string, characterMode: string): void;
  /** Sistema de combate → catálogo de ataques del HUD y teclas 1..N. */
  combat(combatSystem: string): void;
  /** Sesión del libro de historia. Con un id rancio, abrir el libro pide
   *  `resume_session` y hace TAKEOVER de otra partida en el bridge: no es
   *  cosmético. */
  history(sessionId: string): void;
  /** Sesión de la ENTRADA en la partida (`session/entrada.ts`): a qué partida
   *  pertenecen el «ya está vestido» y el «ya pintó el mundo» que están por
   *  llegar. Cuelga de aquí y no de dos flags en el cliente porque el olvido
   *  al volver al título es justo el bug de #249: media entrada de la partida
   *  que no arrancó, esperando a la mitad que falta para anunciar una sesión
   *  que ya no existe. */
  entrada(sessionId: string): void;
}

/** La sesión del cliente: un valor y dos verbos que son el mismo acto. */
export interface ClientSession {
  /** Id del save, "" si no hay partida. */
  readonly id: string;
  /** ¿Hay partida aplicada? Es la precondición del gasto de imagen. */
  readonly active: boolean;
  /** Copia de las facetas vigentes (para el hook de bench/QA: es lo que hace
   *  MEDIBLE «los dos caminos de vuelta al título dejan el cliente igual»). */
  readonly facets: SessionFacets;
  /** Entra en una partida: aplica sus facetas. */
  enter(facets: SessionFacets): void;
  /** Sale al título: aplica los neutros. Mismo camino, mismos sinks. */
  leave(): void;
}

/** Qué le toca a cada sink de las facetas. Es un tipo MAPEADO sobre
 *  `FacetSinks`, así que un sink nuevo sin entrada aquí **no compila** — y
 *  `apply` recorre este record en vez de nombrar los sinks uno a uno, así que
 *  tampoco puede olvidarse de llamarlo.
 *
 *  Antes esto eran cinco llamadas escritas a mano dentro de `apply` y la
 *  garantía la daba un test que enumeraba… su propio doble; como `tsc` no mira
 *  `test/**`, un sink sin llamar dejaba `npm run verify` entero verde (QA
 *  2026-08-25, hallazgo M1). Ahora la garantía la da el compilador sobre
 *  `src/`, que sí se comprueba. */
const APLICADORES: {
  [K in keyof FacetSinks]: (sinks: FacetSinks, f: SessionFacets) => void;
} = {
  style: (s, f) => s.style(f.styleId),
  theme: (s, f) => s.theme(f.uiTheme),
  renderModes: (s, f) => s.renderModes(f.renderMode, f.characterMode),
  combat: (s, f) => s.combat(f.combatSystem),
  history: (s, f) => s.history(f.sessionId),
  entrada: (s, f) => s.entrada(f.sessionId),
};

/** Los nombres de los sinks, derivados del record de arriba: no hay una
 *  segunda lista que mantener. Lo usa el test para enumerar sin inventarse
 *  nada. */
export const NOMBRES_DE_SINK = Object.keys(APLICADORES) as (keyof FacetSinks)[];

export function createClientSession(sinks: FacetSinks): ClientSession {
  let vigentes: SessionFacets = NO_SESSION;

  /** El único camino. `enter` y `leave` se distinguen por el ARGUMENTO, no
   *  por el código que recorren; y ninguno de los dos puede saltarse un sink,
   *  porque no los nombra: recorre el record de aplicadores. */
  function apply(facets: SessionFacets): void {
    vigentes = facets;
    for (const nombre of NOMBRES_DE_SINK) APLICADORES[nombre](sinks, facets);
  }

  return {
    get id() {
      return vigentes.sessionId;
    },
    get active() {
      return vigentes.sessionId !== "";
    },
    get facets() {
      return { ...vigentes };
    },
    enter(facets: SessionFacets) {
      apply(facets);
    },
    leave() {
      apply(NO_SESSION);
    },
  };
}
