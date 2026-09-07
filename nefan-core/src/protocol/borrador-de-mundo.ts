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
 *  Y hay un TERCER proceso que también mide el borrador: ai_server, que es
 *  quien llama al motor (`POST /develop_world`). Su umbral estaba escrito en
 *  bruto —`Field(min_length=20, max_length=64_000)` en
 *  `ai_server/routers/narrative.py`, hallazgo H1 de la QA de esta PR— y no
 *  puede importar TypeScript, así que lee los dos números del snapshot
 *  `data/contract/borrador-de-mundo.json` que vuelca
 *  `scripts/dump-borrador-de-mundo.ts`, igual que lee `physics.json` y
 *  `style-upload.json` y por el mismo motivo medido (#300): dos declaraciones
 *  del mismo número divergen en silencio y ninguna suite se entera. La
 *  frescura del snapshot la canda `test/contract-borrador-de-mundo.test.ts`;
 *  que nadie los vuelva a escribir a mano, la regla
 *  `el-umbral-del-borrador-no-se-copia-a-mano` de `arch-rules.json`.
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

/** Lo que se serializa a `data/contract/borrador-de-mundo.json` para que
 *  ai_server tope el `draft_text` de `POST /develop_world` con estos números
 *  en vez de copiarlos.
 *
 *  Viajan los DOS números y nada más. Los MOTIVOS no viajan a propósito: el
 *  texto que lee el jugador se lo da quien lo caza primero —el título o el
 *  bridge, los dos con `validarBorrador`— y la comprobación de ai_server es la
 *  red de debajo, un 422 estructurado de Pydantic que solo se alcanza si algo
 *  llama a `/develop_world` sin pasar por el bridge. Mandarle una redacción
 *  que no emite sería snapshot que nadie lee. */
export interface BorradorSnapshot {
  $comment: string;
  min: number;
  max: number;
}

export function borradorSnapshot(): BorradorSnapshot {
  return {
    $comment:
      "GENERADO por nefan-core/scripts/dump-borrador-de-mundo.ts desde src/protocol/borrador-de-mundo.ts. " +
      "NO editar a mano: lo canda test/contract-borrador-de-mundo.test.ts, que compara este fichero con " +
      "la fuente TS y falla si divergen. Lo lee ai_server/narrative_schemas.py para que el `draft_text` de " +
      "POST /develop_world se tope con el MISMO umbral que aplican el título y el bridge, en vez de con " +
      "una tercera copia escrita a mano.",
    min: BORRADOR_MIN,
    max: BORRADOR_MAX,
  };
}
