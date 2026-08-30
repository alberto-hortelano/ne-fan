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
import type { NarrativeStatusMessage } from "../protocol/messages.js";

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
 *  salir: el sink no sabe en qué sentido va, y por eso no puede divergir.
 *
 *  CADA SINK RECIBE UN `Pick` DE LAS FACETAS, NO SUS ESCALARES SUELTOS, y eso
 *  es el candado de #316. Con escalares, `SessionFacets` tenía CINCO campos
 *  `string` (`sessionId`, `styleId`, `renderMode`, `characterMode`,
 *  `combatSystem`) y cualquiera era intercambiable por cualquiera a ojos del
 *  compilador: `style: (s, f) => s.style(f.combatSystem)` compilaba con cero
 *  errores en core y en el cliente (medido el 2026-08-30). Un `styleId`
 *  equivocado es la clave de caché de imagen — arte PAGADO del estilo que no
 *  era, que es literalmente el bug #249, el que creó este módulo. La garantía
 *  que se vendía aquí («una faceta sin neutro no compila, sin aplicador no
 *  compila») no cubría «el aplicador pasa lo que le toca», y no se cierra con
 *  un test que lo persiga: se cierra haciendo el cableado equivocado
 *  INEXPRESABLE.
 *
 *  Efecto lateral, y es el que pedía #316 al abrirse: el TIPO dice ahora
 *  cuáles de estas entradas son cambios de sesión —las cuatro que reciben
 *  `Pick<SessionFacets,"sessionId">`— y cuáles son facetas de verdad, sin
 *  partir el record. Partirlo costaba el ORDEN, que es el diseño: `mundo` va
 *  el primero y `dialogo` el último, y los dos mecanismos van INTERCALADOS. */
export interface FacetSinks {
  /** El MUNDO pintado: a qué partida pertenecen los tiles que hay instalados.
   *  Se aplica el primero de todos (ver `APLICADORES`) porque las demás
   *  facetas arman cosas sobre el mundo —el atlas de superficies pide el
   *  layout del tile activo— y hacerlo sobre el mundo anterior es pagar arte
   *  de una partida que ya no está.
   *
   *  Es una faceta y no una llamada suelta a `resetWorld()` por lo mismo que
   *  las otras seis: la rama `new_game` del cliente NO la llamaba (solo la de
   *  `resume`), así que un segundo intento heredaba los tiles del primero
   *  (#282, segunda mitad). Un tercer camino de vuelta al título tendría el
   *  mismo agujero mientras el reset fuera algo que hay que acordarse de
   *  hacer; aquí no hay nada que recordar.
   *
   *  Recibe el id POR VALOR como las demás, y el sink lo LEE: vaciar el mundo
   *  es destructivo, y el módulo promete que aplicar las mismas facetas dos
   *  veces no cambia nada. Un sink que vaciara sin mirar rompería esa promesa
   *  justo aquí — el primero que quisiera refrescar una faceta a mitad de
   *  partida se llevaría el mundo por delante. */
  mundo(f: Pick<SessionFacets, "sessionId">): void;
  /** Estilo visual → generadores de imagen (atlas de superficies, skins). */
  style(f: Pick<SessionFacets, "styleId">): void;
  /** Tema de UI → custom properties de #game-ui. */
  theme(f: Pick<SessionFacets, "uiTheme">): void;
  /** Modos de render por faceta → gates de generación del cliente. */
  renderModes(f: Pick<SessionFacets, "renderMode" | "characterMode">): void;
  /** Sistema de combate → catálogo de ataques del HUD y teclas 1..N. */
  combat(f: Pick<SessionFacets, "combatSystem">): void;
  /** Sesión del libro de historia. Con un id rancio, abrir el libro pide
   *  `resume_session` y hace TAKEOVER de otra partida en el bridge: no es
   *  cosmético. */
  history(f: Pick<SessionFacets, "sessionId">): void;
  /** Sesión de la ENTRADA en la partida (`session/entrada.ts`): a qué partida
   *  pertenecen el «ya está vestido» y el «ya pintó el mundo» que están por
   *  llegar. Cuelga de aquí y no de dos flags en el cliente porque el olvido
   *  al volver al título es justo el bug de #249: media entrada de la partida
   *  que no arrancó, esperando a la mitad que falta para anunciar una sesión
   *  que ya no existe. */
  entrada(f: Pick<SessionFacets, "sessionId">): void;
  /** El GATE del diálogo: mientras hay una conversación abierta, el input de
   *  juego (moverse, atacar) está suprimido y el panel está en pantalla.
   *
   *  Cuelga de aquí desde #311 por la razón de siempre: era un espejo a mano
   *  —un campo público del proveedor de input, escrito suelto en el cliente,
   *  más `dialoguePanel.isVisible`— y `leave()` no lo deshacía. La forma
   *  exacta del bug de #249, que es para lo que existe este módulo. #314 se
   *  llevó el espejo (hoy el proveedor PREGUNTA por el panel), pero esta
   *  faceta no sobra: lo que garantiza es que volver al título CIERRE la
   *  conversación, y de eso el panel no se entera solo. Va el ÚLTIMO del
   *  record: no es destructivo del mundo, así que no tiene por qué correr
   *  antes que nada.
   *
   *  HONESTIDAD sobre lo que esto es y lo que no: hoy no diverge, y nadie
   *  halló un camino alcanzable a la divergencia (`volverAlTitulo` solo sale
   *  del botón del overlay de carga, y ese overlay no se abre con un diálogo
   *  delante). Se pone porque el mecanismo que lo impide no puede ser que
   *  nadie encuentre el camino. */
  dialogo(f: Pick<SessionFacets, "sessionId">): void;
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
  /** ¿El sello de un mensaje del bridge es el de LA partida aplicada aquí?
   *
   *  «De quién es esto» vive donde ya vive «cuál es la mía», que es este
   *  módulo: el cliente no tiene que comparar ids a mano en el embudo de
   *  eventos, y la decisión se prueba sin navegador (#282).
   *
   *  `""` compara igual que cualquier otro id, y eso es lo correcto en las dos
   *  direcciones: sin partida aplicada, lo que el bridge difunda de UNA
   *  partida no es mío (el caso del issue: se abandona y el tile llega
   *  después); y lo que difunda sin partida —el título, una pre-generación de
   *  mundo— sí lo es. */
  esMio(sessionId: string): boolean;
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
 *  `src/`, que sí se comprueba.
 *
 *  El primer parámetro es `Pick<FacetSinks,K>` y no `FacetSinks` entero: cada
 *  entrada solo VE su sink, así que llamar al de al lado —`mundo: (s, f) =>
 *  s.style(…)`— no compila (`TS2339`). Con las facetas por `Pick` (arriba),
 *  las ocho entradas quedan además con la MISMA forma, `(s, f) => s.X(f)`: no
 *  hay campo que elegir, y por tanto no hay campo que equivocar (#316). */
const APLICADORES: {
  [K in keyof FacetSinks]: (sinks: Pick<FacetSinks, K>, f: SessionFacets) => void;
} = {
  // PRIMERO, y el orden aquí es el orden de aplicación (`apply` recorre este
  // record): el mundo de la partida anterior se va antes de que nadie arme
  // nada encima. Con el orden al revés, el despertador del atlas veía el tile
  // activo del mundo que se está yendo y pedía su imagen con el estilo de la
  // partida nueva.
  mundo: (s, f) => s.mundo(f),
  style: (s, f) => s.style(f),
  theme: (s, f) => s.theme(f),
  renderModes: (s, f) => s.renderModes(f),
  combat: (s, f) => s.combat(f),
  history: (s, f) => s.history(f),
  entrada: (s, f) => s.entrada(f),
  dialogo: (s, f) => s.dialogo(f),
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
    esMio(sessionId: string) {
      return sessionId === vigentes.sessionId;
    },
    enter(facets: SessionFacets) {
      apply(facets);
    },
    leave() {
      apply(NO_SESSION);
    },
  };
}

/** A quién le habla un `narrative_status` que difunde el bridge (#312).
 *
 *  `"titulo"` la barra de pre-generación de mundo · `"juego"` la partida que
 *  se está jugando · `"fallo-ajeno"` el registro de errores, y NADA más ·
 *  `"descartado"` a nadie, con su contador. */
export type DestinoDeStatus = "titulo" | "juego" | "fallo-ajeno" | "descartado";

/** Lo único que hace falta saber de un status para repartirlo. Es un `Pick`
 *  del mensaje del wire y no una forma copiada a mano: un `kind` nuevo en
 *  `messages.ts` entra aquí solo, y las ramas de abajo dejan de ser
 *  exhaustivas donde toca. */
export type StatusRepartible = Pick<NarrativeStatusMessage, "sessionId" | "phase" | "kind">;

/** El reparto, como función pura. Vive aquí porque aquí ya vive «cuál es la
 *  mía» (`esMio`) y porque en el cliente no hay nada que pueda ponerse rojo:
 *  `nefan-html` no tiene harness (#241).
 *
 *  EL PROBLEMA que resuelve (#312): hasta hoy el embudo del cliente filtraba
 *  los `narrative_event` por sello y dejaba pasar TODOS los `narrative_status`.
 *  Un `ready` de una partida abandonada llegaba entero a la viva, y con
 *  `spawn` le escribía la posición al jugador — teletransporte, no «interfaz
 *  desbloqueada». `sessionChangedError` (bridge) estrecha la ventana a los
 *  frames ya en vuelo, pero no la cierra.
 *
 *  EL ORDEN DE LAS REGLAS ES EL DISEÑO, y la primera es la que no se puede
 *  quitar:
 *
 *  1. `game_gen` va al TÍTULO SIN MIRAR EL SELLO. No es una excepción
 *     cosmética: el sello lo estampa el transporte con «la sesión que este
 *     bridge tiene activa en el instante de emitir» (`bridge/ws-server.ts`, y
 *     está escrito allí), no con la de quien pidió el trabajo. Tras jugar y
 *     volver al título el cliente está en `""` y el bridge sigue con la
 *     partida cargada, así que la pre-generación llega SIEMPRE con sello
 *     ajeno: filtrar por sello sin esta rama deja la barra girando para
 *     siempre. Que el sello diga quién PIDIÓ el trabajo es otro arreglo, y
 *     tiene issue propio.
 *  2. Lo que es mío, a la partida.
 *  3. Lo ajeno que es un FALLO no se calla: un error de una sesión recién
 *     muerta sigue llegando a quien juega. Es el motivo por el que este
 *     embudo no filtraba nada, y por el que la respuesta no es filtrarlo
 *     entero sino partirlo en canales.
 *  4. El resto —un `ready`, un `generating`, un latido de una partida que ya
 *     no está— no tiene destinatario. */
export function destinoDeStatus(
  status: StatusRepartible,
  esMio: (sessionId: string) => boolean,
): DestinoDeStatus {
  if (status.kind === "game_gen") return "titulo";
  if (esMio(status.sessionId)) return "juego";
  if (status.phase === "error") return "fallo-ajeno";
  return "descartado";
}
