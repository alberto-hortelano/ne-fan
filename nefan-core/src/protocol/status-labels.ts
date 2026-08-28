/** Lo que lee QUIEN JUEGA cuando algo falla: el RÓTULO del overlay y el
 *  MOTIVO en cristiano.
 *
 *  Aquí viven las tres decisiones de texto que antes estaban repartidas por
 *  tres capas, y ninguna es cosmética — las tres deciden si el jugador
 *  entiende qué le ha pasado o lee un volcado:
 *
 *   · `rotuloDeStatus` — el título del overlay de un fallo del motor, y si ese
 *     fallo tapa la pantalla o va a la línea de mensajes (#180). Eran dos
 *     literales sueltos en `main.ts` («Error al generar el mundo», «Error al
 *     generar la escena») encima de un cuerpo ya traducido.
 *   · `motivoParaElJugador` — el CUERPO de un fallo de generación. Estaba
 *     DUPLICADO en `bridge/handlers/tile.ts` y `scene.ts`, con una rama
 *     distinta en cada copia, y en tile.ts solo se aplicaba si el viaje traía
 *     nombre de destino: en el arranque —el momento que más falla— el jugador
 *     leía «Error: No se pudo generar la escena. fetch failed».
 *   · `motivoDeSesionParaElJugador` — el cuerpo de un fallo de SESIÓN, que es
 *     el canal que abrió esta misma tanda (`#ts-error` del título) y que
 *     imprimía `game_load_failed: … (/home/…/games/alta_fantasia/game.json)`,
 *     con la ruta absoluta del disco de quien juega.
 *
 *  Vive en core y no en el cliente ni en el bridge por dos razones, y ninguna
 *  es elegancia: el cliente solo pinta, y aquí la decisión se puede PROBAR sin
 *  navegador y la mide la mutación.
 *
 *  No inventa nada: el status trae `kind`, `placeId` y `tile{tx,ty}`, y el
 *  contexto de pintado (¿hay mundo?, ¿hay overlay abierto?) lo pone el
 *  cliente, que es su dueño. El detalle TÉCNICO no se pierde: se queda en el
 *  `console.warn` del bridge y en el `detail` del error-log del cliente. */
import type { NarrativeStatusMessage } from "./messages.js";

/** Lo que el cliente sabe de su propia pantalla en el momento del fallo. */
export interface ContextoDeRotulo {
  /** El jugador todavía no tiene mundo pintado (arranque de la partida). */
  mundoVacio: boolean;
  /** Hay un overlay de carga en pantalla — el jugador está ESPERANDO algo
   *  que pidió (un viaje, el mundo inicial) y se le quedaría el «Viajando…»
   *  puesto para siempre si el error no fuera ahí. */
  overlayAbierto: boolean;
}

/** Qué puede HACER el jugador con el overlay de error.
 *
 *  `cerrar` es la salida normal: detrás hay una partida en marcha a la que
 *  volver. `volver-al-titulo` es la del mundo vacío — cerrar ahí deja al
 *  jugador mirando un cielo negro con la barra de vida al 100 %, sin mundo y
 *  sin ninguna forma de reintentar que no sea recargar la página. Es
 *  literalmente la frase de #189, y pasa con el fallo MÁS probable de los
 *  primeros segundos: `start_session` contesta `ok:true` antes de generar el
 *  tile, así que un motor mudo no rechaza y no pasa por el catch del bucle del
 *  título. */
export type SalidaDelOverlay = "cerrar" | "volver-al-titulo";

/** Unión discriminada y no un objeto con `titulo` siempre: un fallo que va a
 *  la línea de mensajes NO TIENE título, y darle uno era dato muerto. Lo dijo
 *  la mutación antes que nadie — cambiarle el texto a ese título no rompía
 *  ningún test, porque no lo lee nadie. La respuesta no es un aserto más sobre
 *  algo que no se pinta: es que el estado no se pueda escribir. */
export type Rotulo =
  /** El error tapa la pantalla y el jugador tiene que descartarlo. */
  | { destino: "overlay"; titulo: string; detalle: string; salida: SalidaDelOverlay }
  /** Fallo de segundo plano: a la línea de mensajes del juego, sin título. */
  | { destino: "log"; detalle: string };

/** Cuerpo por defecto cuando el bridge no manda `message`. Por `kind`, porque
 *  «algo falló» sin decir el qué es lo mismo que no decir nada. */
const DETALLE_POR_DEFECTO: Record<NarrativeStatusMessage["kind"], string> = {
  tile: "Algo falló generando el tile.",
  scene: "Algo falló en el motor narrativo.",
  consequences: "El motor narrativo rechazó la reacción.",
  game_gen: "El motor narrativo rechazó la reacción.",
};

/** Lo que `rotuloDeStatus` LEE de un status, y nada más.
 *
 *  Es un `Pick` y no el mensaje entero para que el canal de fallos AJENOS de
 *  #312 —que entrega un objeto sin `spawn` ni `tile`— pueda pintarse por aquí
 *  sin ensancharse: rotular un fallo de otra partida es legítimo, moverle el
 *  jugador con él no. Los llamantes que sí tienen el mensaje completo siguen
 *  compilando, que es lo que hace un `Pick`. */
export type StatusRotulable = Pick<
  NarrativeStatusMessage,
  "phase" | "kind" | "message" | "placeId"
>;

/** Título y destino de un `narrative_status` en fase de error.
 *
 *  Lanza si se le pasa un status que no es de error: el rótulo describe un
 *  fallo, y llamarlo con un `ready` o un `generating` es un error de quien
 *  llama, no un caso a inventar (fail-loud). */
export function rotuloDeStatus(
  status: StatusRotulable,
  ctx: ContextoDeRotulo,
): Rotulo {
  if (status.phase !== "error") {
    throw new Error(
      `rotuloDeStatus solo rotula fallos: llegó phase="${status.phase}" (kind "${status.kind}")`,
    );
  }
  const detalle = status.message ?? DETALLE_POR_DEFECTO[status.kind];
  // Sin mundo pintado no hay partida a la que volver al cerrar: el overlay
  // tiene que ofrecer la única salida que queda, el título. Se decide aquí y
  // no en el cliente porque es la misma decisión que el rótulo, y aquí se
  // puede probar.
  const salida: SalidaDelOverlay = ctx.mundoVacio ? "volver-al-titulo" : "cerrar";

  if (status.kind === "tile") {
    // Bootstrap: el jugador acaba de pulsar «Comenzar» y no hay mundo. No es
    // «no se pudo llegar» a ningún sitio — es que la partida no arrancó.
    if (ctx.mundoVacio) {
      return { destino: "overlay", titulo: "La partida no pudo empezar", detalle, salida };
    }
    // Con mundo pintado, el tile puede ser un viaje (overlay abierto, el
    // jugador esperando) o la frontera generándose sola en segundo plano.
    // Lo segundo NO merece tapar la pantalla: su feedback es el velo del
    // borde, y el motivo va a la línea de mensajes.
    if (ctx.overlayAbierto) {
      return { destino: "overlay", titulo: "No se pudo llegar", detalle, salida };
    }
    return { destino: "log", detalle };
  }

  if (status.kind === "scene") {
    // Con `placeId` el jugador pulsó un destino en «Salidas»: lo que ha
    // fallado es llegar. Sin él es una escena que el motor preparaba por su
    // cuenta.
    return status.placeId
      ? { destino: "overlay", titulo: "No se pudo llegar", detalle, salida }
      : { destino: "overlay", titulo: "No se pudo preparar el lugar", detalle, salida };
  }

  // Consequences y pre-generación de mundo: una reacción narrativa rechazada
  // (p. ej. 422 por una consequence mal formada). El rótulo es el que ya
  // había en el cliente — se muda aquí para que NINGÚN rótulo de fallo del
  // motor quede suelto en `main.ts` y el sexto se escriba en un séptimo sitio.
  return {
    destino: "overlay",
    titulo: "El motor narrativo rechazó la respuesta",
    detalle,
    salida,
  };
}

/** Traduce un fallo de GENERACIÓN a algo que quien juega pueda leer.
 *
 *  Lo llama el bridge al difundir el `narrative_status` de error (tile y
 *  scene), SIEMPRE — el nombre del destino es un prefijo cuando lo hay, no la
 *  condición para traducir. Antes vivía duplicado en los dos handlers, con una
 *  rama distinta en cada copia y aplicándose solo a los viajes: en el arranque
 *  del mundo, que es donde más falla, el jugador leía «Error: No se pudo
 *  generar la escena. fetch failed».
 *
 *  El detalle técnico NO se pierde: lo escribe el `console.warn` del bridge,
 *  que es donde sirve. */
export function motivoParaElJugador(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err);
  if (/fetch failed|ECONNREFUSED|socket hang up|timeout/i.test(raw)) {
    return "El motor narrativo no responde; inténtalo de nuevo en un momento.";
  }
  if (/no es jugable/i.test(raw)) {
    return "El motor narrativo devolvió un terreno inservible; inténtalo de nuevo.";
  }
  if (/no da punto de aparición|no hay sitio|anclaje/i.test(raw)) {
    return "No hay sitio libre en el mapa para colocarlo.";
  }
  return "El motor narrativo no pudo construirlo; inténtalo de nuevo.";
}

/** La extensión de los módulos de fixture del glob. En una constante para que
 *  el corte y la comprobación no puedan discrepar. */
const EXTENSION_DE_FIXTURE = ".json";

/** La ETIQUETA de una fixture del selector «Room»: lo que la persona eligió
 *  en el desplegable (`zorder_test`), no la clave del glob con la que se
 *  importa (`@nefan-core/data/scenes/zorder_test.json`).
 *
 *  Vive aquí y no en el cliente por el mismo motivo escrito arriba, y además
 *  por uno propio: la opción del `<select>` y el mensaje de «no cargó» tienen
 *  que salir de LA MISMA derivación o divergen. Divergieron —el desplegable
 *  decía `zorder_test` y el fallo decía la ruta del glob (#269)— porque eran
 *  dos: un `match(/scenes\/(.+)\.json$/)` al pintar y una interpolación del
 *  `value` al fallar.
 *
 *  Sin `.json` devuelve la clave TAL CUAL, que es lo honesto: si algún día el
 *  glob cambia de forma, el jugador lee algo raro pero cierto, en vez de una
 *  cadena vacía. Sin regex por lo mismo: dos cortes de cadena tienen mutantes
 *  que un test puede matar uno a uno, y un patrón no. */
export function etiquetaDeFixture(clave: string): string {
  const nombre = clave.slice(clave.lastIndexOf("/") + 1);
  return nombre.endsWith(EXTENSION_DE_FIXTURE)
    ? nombre.slice(0, -EXTENSION_DE_FIXTURE.length)
    : nombre;
}


/** Lo que lee quien conduce el selector «Room» cuando una fixture no carga.
 *
 *  Hermana de `motivoDeSesionParaElJugador`, para el canal de #248: el
 *  registro de errores y la línea del juego. Nombra la ETIQUETA, nunca la
 *  ruta; el detalle técnico (la URL, el stack) sigue entero en el `detail` de
 *  la entrada del error-log, que es donde sirve. */
export function motivoDeFixtureParaElJugador(etiqueta: string): string {
  return `No se pudo cargar la escena «${etiqueta}»`;
}

/** Código del ÚNICO fallo de arranque que no viene del bridge: el set base de
 *  hojas de personaje no está servido (un clon limpio — `public/sprites/` está
 *  en `.gitignore`, #255).
 *
 *  Es una constante y no un literal suelto porque los dos extremos están en
 *  repositorios distintos del árbol: lo LANZA el cliente
 *  (`nefan-html/src/renderer/character-sprites.ts`, que lo importa de aquí) y
 *  lo lee la función de abajo. Con dos literales sueltos, renombrar uno dejaba
 *  al jugador con el motivo genérico y nada lo habría dicho: es exactamente el
 *  fallo que se está arreglando, servido otra vez. */
export const FALLO_HOJAS_BASE = "character_sheets_missing";

/** Traduce un fallo de SESIÓN a algo que quien juega pueda leer.
 *
 *  Hermana de `motivoParaElJugador`, para el canal que abrió la tanda del
 *  arranque: `#ts-error` en el título. La primera mitad de cada frase («No se
 *  pudo reanudar la partida») ya estaba escrita para el jugador; la segunda
 *  era el código de error del bridge tal cual, y en un caso —`game_load_failed`—
 *  con la RUTA ABSOLUTA del disco de quien juega dentro.
 *
 *  El detalle técnico va al `errors.push` del cliente, que lo guarda en el
 *  `detail` de la entrada del error-log. */
export function motivoDeSesionParaElJugador(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err);
  // No todo fallo de arranque es del servidor, y este es el que le pasa a
  // TODO el que clona el repo: sin las hojas de `y_bot` el jugador no puede
  // tener cuerpo, así que `setPlayerAppearance` rechaza y el intento entero
  // vuelve al título. Hasta 2026-08-25 caía en el motivo genérico y se leía
  // «El servidor del juego no pudo completarlo; inténtalo de nuevo»: un
  // fichero que falta disfrazado de servidor con hipo, y con un consejo
  // —reintentar— que no puede funcionar NUNCA. Va primero porque es el único
  // que no habla de la partida sino de la instalación.
  if (raw.includes(FALLO_HOJAS_BASE)) {
    return (
      "Faltan las hojas de sprites del personaje, que no viajan en el repositorio: " +
      "genéralas con sprite-forge siguiendo docs/assets-de-personaje.md."
    );
  }
  if (/session_not_found/.test(raw)) {
    return "Esa partida guardada ya no está en el disco.";
  }
  if (/game_load_failed/.test(raw)) {
    return "Los datos de ese mundo están dañados y no se pueden leer.";
  }
  if (/plugin_integrity|plugin_load_failed/.test(raw)) {
    return "Los añadidos de ese mundo no casan con la partida guardada.";
  }
  if (/combat_system_unknown|npc_behavior_unknown/.test(raw)) {
    return "Ese mundo usa un sistema que esta versión del juego no conoce.";
  }
  // Instalación rota ≠ instalación vacía, y decirle al jugador que «no hay
  // mundos» cuando la carpeta no existe le manda a buscar contenido en vez de
  // a arreglar el juego. Va primero: el motivo trae la ruta y la ruta puede
  // contener cualquier palabra.
  if (/games_dir_unreadable/.test(raw)) {
    return "Falta la carpeta de mundos del juego: la instalación está incompleta.";
  }
  if (/no games available/i.test(raw)) {
    return "No hay ningún mundo instalado.";
  }
  if (/not connected|closed|disconnect/i.test(raw)) {
    return "Se ha perdido la conexión con el servidor del juego.";
  }
  if (/timeout|timed out/i.test(raw)) {
    return "El servidor del juego no contesta; inténtalo de nuevo.";
  }
  return "El servidor del juego no pudo completarlo; inténtalo de nuevo.";
}
