/** El rótulo que lee QUIEN JUEGA cuando el motor narrativo falla.
 *
 *  El CUERPO del mensaje ya viene escrito para el jugador: lo compone el
 *  bridge (`motivoParaElJugador` en `bridge/handlers/tile.ts` y `scene.ts`) y
 *  dice «No se pudo llegar a Robledo. El motor narrativo no responde…», con el
 *  volcado técnico quedándose en el `console.warn` del bridge. Lo que seguía
 *  siendo jerga de motor era el TÍTULO del overlay —«Error al generar el
 *  mundo», «Error al generar la escena»—, dos literales sueltos en el cliente
 *  encima de un cuerpo ya traducido (#180).
 *
 *  Vive en core y no en `main.ts` por dos razones, y ninguna es elegancia:
 *  el cliente solo pinta, y aquí la decisión se puede PROBAR sin navegador.
 *  Es la misma frontera que ya cruzó `motivoParaElJugador`.
 *
 *  No inventa nada: el status trae `kind`, `placeId` y `tile{tx,ty}`, y el
 *  contexto de pintado (¿hay mundo?, ¿hay overlay abierto?) lo pone el
 *  cliente, que es su dueño. */
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

/** Unión discriminada y no un objeto con `titulo` siempre: un fallo que va a
 *  la línea de mensajes NO TIENE título, y darle uno era dato muerto. Lo dijo
 *  la mutación antes que nadie — cambiarle el texto a ese título no rompía
 *  ningún test, porque no lo lee nadie. La respuesta no es un aserto más sobre
 *  algo que no se pinta: es que el estado no se pueda escribir. */
export type Rotulo =
  /** El error tapa la pantalla y el jugador tiene que descartarlo. */
  | { destino: "overlay"; titulo: string; detalle: string }
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

/** Título y destino de un `narrative_status` en fase de error.
 *
 *  Lanza si se le pasa un status que no es de error: el rótulo describe un
 *  fallo, y llamarlo con un `ready` o un `generating` es un error de quien
 *  llama, no un caso a inventar (fail-loud). */
export function rotuloDeStatus(
  status: NarrativeStatusMessage,
  ctx: ContextoDeRotulo,
): Rotulo {
  if (status.phase !== "error") {
    throw new Error(
      `rotuloDeStatus solo rotula fallos: llegó phase="${status.phase}" (kind "${status.kind}")`,
    );
  }
  const detalle = status.message ?? DETALLE_POR_DEFECTO[status.kind];

  if (status.kind === "tile") {
    // Bootstrap: el jugador acaba de pulsar «Comenzar» y no hay mundo. No es
    // «no se pudo llegar» a ningún sitio — es que la partida no arrancó.
    if (ctx.mundoVacio) {
      return { destino: "overlay", titulo: "La partida no pudo empezar", detalle };
    }
    // Con mundo pintado, el tile puede ser un viaje (overlay abierto, el
    // jugador esperando) o la frontera generándose sola en segundo plano.
    // Lo segundo NO merece tapar la pantalla: su feedback es el velo del
    // borde, y el motivo va a la línea de mensajes.
    if (ctx.overlayAbierto) {
      return { destino: "overlay", titulo: "No se pudo llegar", detalle };
    }
    return { destino: "log", detalle };
  }

  if (status.kind === "scene") {
    // Con `placeId` el jugador pulsó un destino en «Salidas»: lo que ha
    // fallado es llegar. Sin él es una escena que el motor preparaba por su
    // cuenta.
    return status.placeId
      ? { destino: "overlay", titulo: "No se pudo llegar", detalle }
      : { destino: "overlay", titulo: "No se pudo preparar el lugar", detalle };
  }

  // Consequences y pre-generación de mundo: una reacción narrativa rechazada
  // (p. ej. 422 por una consequence mal formada). El rótulo es el que ya
  // había en el cliente — se muda aquí para que NINGÚN rótulo de fallo del
  // motor quede suelto en `main.ts` y el sexto se escriba en un séptimo sitio.
  return { destino: "overlay", titulo: "El motor narrativo rechazó la respuesta", detalle };
}
