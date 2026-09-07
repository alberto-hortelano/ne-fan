/** EL BORRADOR DE MUNDO: cuándo es lo bastante mundo como para pagar una
 *  génesis, y qué se le dice al jugador cuando no lo es.
 *
 *  El jugador escribe (o sube) un texto y el motor narrativo lo desarrolla en
 *  un mundo entero (`develop_world`, kind MCP, 1-3 min). Esa llamada es cara,
 *  así que el borrador se comprueba ANTES en las dos puntas: el título, para no
 *  mandar una frase suelta, y el bridge, que es quien de verdad no puede
 *  llamar al motor con basura.
 *
 *  Hasta la PR 7 de #241 (2026-09-07) el umbral estaba escrito en las dos
 *  (`title-screen.ts:1382` y `bridge/handlers/session.ts:160`) y NO decían lo
 *  mismo: el título solo miraba el mínimo —un fichero de 200 kB pegado en el
 *  textarea viajaba entero y lo rechazaba el bridge— y cada uno traía su
 *  redacción, así que el mismo borrador daba dos mensajes distintos según
 *  quién lo cazara primero. Aquí hay un umbral y un texto.
 *
 *  Módulo PURO: sin DOM, sin `node:*`. Devuelve `Result` porque «vacío» y
 *  «error» se confundirían al colapsarse — un borrador que no vale no es un
 *  borrador corto, es un borrador con motivo. */

/** Mínimo en caracteres (ya recortado). Menos que esto no describe un mundo:
 *  es un título, y el motor lo rellenaría inventándoselo todo. */
export const BORRADOR_MIN = 20;

/** Máximo en caracteres. Es el tope del `draftText` del wire y el que impide
 *  que un `.md` de un libro entero entre en el prompt de `develop_world`. */
export const BORRADOR_MAX = 64_000;

/** `Result<string, string>`: el borrador YA RECORTADO, o el motivo tal y como
 *  lo lee el jugador (el bridge lo devuelve en `game_created.error` y el
 *  título lo pinta sin tocarlo, así que es el mismo texto por los dos
 *  caminos). */
export type ResultadoDeBorrador =
  | { ok: true; borrador: string }
  | { ok: false; error: string };

/** Miles con punto, sin ICU: `toLocaleString("es-ES")` depende de cómo esté
 *  compilado el Node que corra el test (un small-icu diría «64,000»), y este
 *  texto va en un aserto. */
const conMiles = (n: number): string => n.toString().replace(/\B(?=(\d{3})+$)/g, ".");

/** El texto de cada rechazo, en un sitio: los dos llamantes lo enseñan tal
 *  cual. Con el número dentro, porque «unas frases» no le dice a nadie cuánto
 *  le falta. */
export const MOTIVOS_DE_BORRADOR = {
  corto:
    `El borrador es demasiado corto — describe el mundo con al menos unas frases ` +
    `(mínimo ${BORRADOR_MIN} caracteres).`,
  largo: `El borrador es demasiado largo — máximo ${conMiles(BORRADOR_MAX)} caracteres.`,
} as const;

/** Comprueba el borrador y devuelve el texto recortado. El recorte va DENTRO
 *  a propósito: los dos llamantes lo hacían antes de medir, y dejarlo fuera
 *  era la puerta por la que «   » medía 3 caracteres en uno y 0 en el otro. */
export function validarBorrador(texto: string): ResultadoDeBorrador {
  const borrador = texto.trim();
  if (borrador.length < BORRADOR_MIN) return { ok: false, error: MOTIVOS_DE_BORRADOR.corto };
  if (borrador.length > BORRADOR_MAX) return { ok: false, error: MOTIVOS_DE_BORRADOR.largo };
  return { ok: true, borrador };
}
