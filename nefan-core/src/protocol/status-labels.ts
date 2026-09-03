/** Lo que lee QUIEN JUEGA cuando algo falla: el RÓTULO del overlay y el
 *  MOTIVO en cristiano.
 *
 *  Aquí viven las tres decisiones de texto que antes estaban repartidas por
 *  tres capas, y ninguna es cosmética — las tres deciden si el jugador
 *  entiende qué le ha pasado o lee un volcado:
 *
 *   · `rotuloDeStatus` — el título del overlay de un fallo de la PARTIDA, y si
 *     ese fallo tapa la pantalla o va a la línea de mensajes (#180). Eran dos
 *     literales sueltos en `main.ts` («Error al generar el mundo», «Error al
 *     generar la escena») encima de un cuerpo ya traducido. Y desde #352 hay
 *     un titular POR HECHO: el catch-all que rotulaba todo lo que no era tile
 *     ni escena hacía que un takeover, un disco lleno o un plugin roto
 *     salieran a pantalla completa culpando al motor narrativo.
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
 *  `console.warn` del bridge y en el `detail` del error-log del cliente.
 *
 *  LO QUE NO ESTÁ AQUÍ, y estuvo un día: A QUIÉN va el mensaje. Eso es
 *  `status-reparto.ts`, y son dos decisiones distintas sobre el mismo status
 *  —qué texto ve el jugador, y a qué canal va— que no comparten ni una llamada.
 *  Tenerlas juntas sacó a este módulo del conjunto medible en local (133
 *  mutantes contra un tope de 120); separarlas devuelve a los dos a su bucle
 *  barato sin tocar ningún umbral. */
import type { NarrativeStatusDeSesion } from "./messages.js";

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
 *  «algo falló» sin decir el qué es lo mismo que no decir nada.
 *
 *  Cuelga de `NarrativeStatusDeSesion` y no del mensaje entero: el rótulo es
 *  para un fallo de LA PARTIDA, y la pre-generación de mundo ya no comparte
 *  tipo con ella (#313). Tenía aquí una entrada `game_gen` con el motivo de
 *  `consequences` —«El motor narrativo rechazó la reacción», que es de otro
 *  kind—; no la borró nadie a mano: con este `Record` dejarla es `TS2353`. */
const DETALLE_POR_DEFECTO: Record<NarrativeStatusDeSesion["kind"], string> = {
  tile: "Algo falló generando el tile.",
  scene: "Algo falló en el motor narrativo.",
  consequences: "El motor narrativo rechazó la reacción.",
  restore: "Algo de tu partida guardada no se pudo devolver al mundo.",
  takeover: "Esta partida se está jugando desde otro sitio.",
  save: "No se pudo escribir la partida guardada.",
  plugin: "Un sistema del juego no pudo completar el turno.",
  action: "El juego no pudo completar esa acción.",
  protocolo: "El juego mandó un mensaje que el servidor no pudo leer.",
};

/** Lo que `rotuloDeStatus` LEE de un status, y nada más.
 *
 *  Es un `Pick` y no el mensaje entero para que el canal de fallos AJENOS de
 *  #312 —que entrega un objeto sin `spawn` ni `tile`— pueda pintarse por aquí
 *  sin ensancharse: rotular un fallo de otra partida es legítimo, moverle el
 *  jugador con él no. Los llamantes que sí tienen el mensaje completo siguen
 *  compilando, que es lo que hace un `Pick`. */
export type StatusRotulable = Pick<
  NarrativeStatusDeSesion,
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

  // UN `switch` EXHAUSTIVO Y NO UN `return` AL FINAL, y esa es toda la
  // diferencia de #352. Hasta el 2026-09-01 aquí abajo había un catch-all que
  // devolvía «El motor narrativo rechazó la respuesta» a TODO lo que no era
  // `tile` ni `scene`, y como el bridge no tenía más kinds que ofrecer, seis
  // avisos distintos —un takeover, dos «no se pudo guardar», un plugin roto,
  // un handler reventado y el «tu partida vuelve incompleta» del issue— salían
  // a pantalla completa culpando al motor narrativo de algo que no había
  // hecho. El `Record` de arriba candaba el CUERPO; el título no lo candaba
  // nadie. Con el `never` de abajo, un kind sin titular propio no compila.
  switch (status.kind) {
    case "tile":
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

    case "scene":
      // Con `placeId` el jugador pulsó un destino en «Salidas»: lo que ha
      // fallado es llegar. Sin él es una escena que el motor preparaba por su
      // cuenta.
      return status.placeId
        ? { destino: "overlay", titulo: "No se pudo llegar", detalle, salida }
        : { destino: "overlay", titulo: "No se pudo preparar el lugar", detalle, salida };

    case "consequences":
      // El ÚNICO rechazo real del motor: una reacción narrativa que no vale
      // (p. ej. 422 por una consequence mal formada). El rótulo es el que ya
      // había en el cliente — se mudó aquí para que ningún rótulo de fallo del
      // motor quedara suelto en `main.ts`; lo que cambia hoy es que por fin es
      // CIERTO, porque ya no lo hereda nadie más.
      return {
        destino: "overlay",
        titulo: "El motor narrativo rechazó la respuesta",
        detalle,
        salida,
      };

    case "restore":
      // El save se leyó, la partida arrancó, y algo que el jugador había
      // dejado en el mundo no ha vuelto. No es un fallo del motor ni del
      // arranque: es una partida que vuelve con menos de lo que tenía, y el
      // titular tiene que decir eso para que el cuerpo (que nombra a quién
      // falta) se entienda.
      return { destino: "overlay", titulo: "Tu partida vuelve incompleta", detalle, salida };

    case "takeover":
      // Otro cliente tomó esta partida a mitad de una generación en vuelo: lo
      // que se descarta no es una respuesta mala, es el resultado de una
      // sesión que ya no manda.
      return { destino: "overlay", titulo: "Esta partida ya no está al mando", detalle, salida };

    case "save":
      // Disco lleno, permisos, un `state.json` que no se pudo escribir. Lo que
      // ha pasado ya está en memoria y el turno sigue: lo que peligra es que
      // sobreviva a reanudar.
      return { destino: "overlay", titulo: "No se pudo guardar la partida", detalle, salida };

    case "plugin":
      // Un sistema del juego (el comercio, el clima…) reventó su turno. Es
      // contenido del mundo, no el narrador: decir «el motor narrativo» aquí
      // manda a mirar el sitio equivocado.
      return { destino: "overlay", titulo: "Un sistema del juego falló", detalle, salida };

    case "action":
      // Reventó el handler de algo que el jugador PIDIÓ (hablar, pegar,
      // interactuar). El sujeto es su acción, no la respuesta de nadie.
      return { destino: "overlay", titulo: "No se pudo completar esa acción", detalle, salida };

    case "protocolo":
      // El cliente le mandó al bridge un frame que no pasa el intake. No es el
      // mundo, ni el motor, ni el disco: es el juego hablando consigo mismo y
      // no entendiéndose. Salía como `scene` —o sea, bajo «No se pudo preparar
      // el lugar»— hasta el 2026-09-01 (QA H-7): un titular que manda a mirar
      // la generación del sitio para decir que el propio juego mandó basura.
      return { destino: "overlay", titulo: "Fallo interno del juego", detalle, salida };
  }

  // Exhaustividad: un kind nuevo sin titular propio no compila. Es el candado
  // del criterio 3 de #352 — el catch-all que había aquí es el mecanismo que
  // fabricaba el bug, no su víctima.
  const nunca: never = status.kind;
  throw new Error(`rotuloDeStatus no sabe rotular el kind "${String(nunca)}"`);
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
