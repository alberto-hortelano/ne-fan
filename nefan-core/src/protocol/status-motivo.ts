/** El MOTIVO en cristiano: lo que quien juega lee DEBAJO del titular cuando
 *  algo falla, y el código del único fallo que no viene del bridge.
 *
 *  Cuatro traductores de excepción → frase, uno por canal, más la etiqueta de
 *  una fixture del selector «Room». Ninguno es cosmético: los cuatro sustituyen
 *  a un volcado técnico que el jugador no puede usar.
 *
 *   · `motivoParaElJugador` — un fallo de GENERACIÓN. Estaba DUPLICADO en
 *     `bridge/handlers/tile.ts` y `scene.ts`, con una rama distinta en cada
 *     copia, y en tile.ts solo se aplicaba si el viaje traía nombre de destino:
 *     en el arranque —el momento que más falla— el jugador leía «Error: No se
 *     pudo generar la escena. fetch failed».
 *   · `motivoDeReaccionParaElJugador` — un fallo de REACCIÓN, el cuarto canal y
 *     el último que quedaba en inglés (QA 2026-09-01, H-3).
 *   · `motivoDeSesionParaElJugador` — un fallo de SESIÓN (`#ts-error` del
 *     título), que imprimía `game_load_failed: … (/home/…/games/alta_fantasia/
 *     game.json)`, con la ruta absoluta del disco de quien juega.
 *   · `motivoDeFixtureParaElJugador` + `etiquetaDeFixture` — el selector «Room»
 *     (#269), que decía la clave del glob donde el desplegable decía un nombre.
 *
 *  Vive en core y no en el cliente ni en el bridge por dos razones, y ninguna
 *  es elegancia: el cliente solo pinta, y aquí la decisión se puede PROBAR sin
 *  navegador y la mide la mutación. El detalle TÉCNICO no se pierde: se queda
 *  en el `console.warn` del bridge y en el `detail` del error-log del cliente.
 *
 *  LO QUE NO ESTÁ AQUÍ: el TITULAR y el destino del aviso (`status-rotulo.ts`)
 *  y a quién pertenece el status (`status-reparto.ts`). El motivo mira el TEXTO
 *  de una excepción; el rótulo mira `kind` y el estado de la pantalla. Se
 *  partieron el 2026-09-04 (#383) porque juntos eran 162 mutantes contra un
 *  `tope_local` de 120: fuera del conjunto medible en local. Cero llamadas
 *  cruzadas entre las dos mitades el día del corte, y el candado de baterías de
 *  `test/mutation-config.test.ts` se pone rojo si alguien las vuelve a atar. */
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

/** Traduce un fallo de REACCIÓN a algo que quien juega pueda leer.
 *
 *  El cuarto canal, y el último que quedaba en inglés: `reportPlayerChoice`
 *  devuelve `ok:false` y el bridge pintaba `Narrative engine error: <crudo>` a
 *  pantalla completa (QA 2026-09-01, H-3). El titular de ese aviso —«El motor
 *  narrativo rechazó la respuesta»— es el único de los ocho que SÍ nombra a su
 *  culpable de verdad; el cuerpo era lo que no estaba escrito para nadie.
 *
 *  Distingue las dos causas porque el consejo cambia: si el motor no contesta,
 *  reintentar puede funcionar; si contestó algo que no vale, reintentar lo
 *  mismo vuelve a fallar y lo que hay que hacer es decir otra cosa. */
export function motivoDeReaccionParaElJugador(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err);
  if (/fetch failed|ECONNREFUSED|socket hang up|timeout|timed out/i.test(raw)) {
    return "El motor narrativo no responde; inténtalo de nuevo en un momento.";
  }
  return "El motor narrativo no pudo reaccionar a eso; prueba a decir otra cosa.";
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
  // El save EXISTE pero no vale (#334/#336): versión de una era anterior o
  // escena que viola el contrato. Reintentar fallará SIEMPRE (el defecto está
  // en el disco), así que la frase da la única salida real — borrar o empezar
  // de nuevo, que es la decisión «fallo ruidoso» dicha al jugador y no solo
  // al log. Sin esta rama caía en el genérico «inténtalo de nuevo»: el mismo
  // consejo imposible que el guion 27 nació rojo por denunciar.
  if (/save_invalido/.test(raw)) {
    // Si el motivo trae a QUIÉN le falta el nombre (#397: `loadSession` lo
    // escribe entre guiones, con su descripción o su clase), se le dice: es
    // la única pista que quien juega puede reconocer — un id de máquina no le
    // dice nada (QA de PR-C, H3). El resto del molde no cambia.
    const quien = /— (.+?) no tiene nombre —/.exec(raw);
    return quien
      ? `Esa partida guardada ya no vale para esta versión del juego (${quien[1]} no tiene nombre): bórrala o empieza una nueva.`
      : "Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva.";
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