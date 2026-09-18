/** QUÉ LE PASÓ A UN TILE QUE SE PIDIÓ POR EL CABLE — el juicio puro que hace
 *  que la espera del 120 y el 127 deje de ser MUDA (#656).
 *
 *  ── EL DEFECTO QUE CIERRA, Y NO ES EL DEL TÍTULO DEL ISSUE ───────────────
 *  Los dos guiones esperaban un tile con un predicado de UN desenlace
 *  (`window.__nefan.tiles.includes(key)`) y un tope de 90 s. Cuando el tile no
 *  llegaba, lo único que se sabía era que no había llegado: ni si el bridge
 *  dijo que había fallado, ni si rechazó el frame, ni si nunca supo de la
 *  petición. Noventa segundos de espera para producir cero información.
 *
 *  El issue lo diagnosticó como «mide contra el reloj de PARED», y eso es
 *  falso como defecto: el sujeto de esta espera es el BRIDGE generando y
 *  difundiendo un tile, y `data/contract/esperas-que-conducen.json` bendice la
 *  pared para ese sujeto por escrito. El defecto es el MUDO.
 *
 *  ── LAS TRES BOCAS POR LAS QUE MUERE UN `request_tile` ───────────────────
 *  Están las tres en el árbol y las tres tienen señal publicada:
 *
 *   1 · **el bridge dice que falló** — `bridge/handlers/tile.ts` difunde
 *       `narrative_status {kind:"tile", phase:"error"}` cuando la generación
 *       revienta (`fail()`) y cuando la ENTREGA se abandona (`abandonAll`).
 *       El cliente lo apunta en su `TileLedger` (`ui/tile-ledger.ts`), que
 *       publica `__nefan.tileEpisodios`.
 *   2 · **el bridge rechaza el frame** — un `request_tile` que no pasa el
 *       contrato se contesta por UNICAST al socket que lo mandó
 *       (`bridge/ws-server.ts`, `kind:"protocolo"`). Nadie lo veía: el helper
 *       viejo cerraba el socket en el mismo tick del `send`.
 *   3 · **el bridge calla** — ni escena, ni error, ni rechazo.
 *
 *  Aquí se decide cuál de las tres (o la cuarta: llegó) ocurrió, a partir de
 *  lo que se leyó del cliente. **Es puro**: ni `playwright`, ni `page`, ni
 *  `node:*`, ni red. Quien lee es `pedirYEsperarTile` (`qa/lib/sesion.mjs`),
 *  que sí conduce el navegador; quien juzga es esto, y por eso se puede probar
 *  en `nefan-core/test/tile-episodio.test.ts`, que sí corre en el CI — la
 *  batería de navegador de `qa/` no.
 *
 *  Es exactamente lo que `data/contract/banco-medido.json` exige a cambio de
 *  la exención de `sesion.mjs`: «la parte pura que tenga se extrae a un módulo
 *  propio y se mide».
 */

/** Los cuatro desenlaces. No hay un quinto para «no se sabe»: si la lectura
 *  del cliente no tiene la forma que este juicio necesita, se LANZA (abajo),
 *  porque un veredicto inventado sobre un libro ilegible es justo la clase de
 *  verde que este módulo viene a impedir. */
export const LLEGADO = "llegado";
export const FALLO = "fallo";
export const RECHAZADO = "rechazado";
export const CALLADO = "callado";

/** El texto de un rechazo por unicast, sea cual sea la forma en que se recogió.
 *  El banco guarda el mensaje del bridge tal cual viene del socket; si lo que
 *  llega no es un objeto con `message`, se serializa entero antes que perderlo. */
function textoDelRechazo(r) {
  if (r && typeof r === "object" && typeof r.message === "string") {
    return r.kind ? `[${r.kind}] ${r.message}` : r.message;
  }
  return JSON.stringify(r ?? null);
}

/** ¿Qué le pasó al tile `key`?
 *
 *  `tiles` es `__nefan.tiles` (las keys que el cliente TIENE en su mundo),
 *  `episodios` es `__nefan.tileEpisodios` —un ARRAY de `TileEpisodio`, que es
 *  lo que devuelve `TileLedger.debugState()`— y `rechazos` son los
 *  `narrative_status {phase:"error"}` que el bridge contestó por unicast al
 *  socket del guion.
 *
 *  **El orden importa y no es arbitrario.** `rechazado` gana a `fallo` porque
 *  un frame rechazado significa que ESTA petición no llegó a existir: un error
 *  en el libro para esa key sería de un intento anterior, y nombrarlo mandaría
 *  a quien investiga al sitio equivocado. Y `llegado` gana a todo: si el tile
 *  acabó en el mundo, llegó, por muchos errores que hubiera por el camino.
 *
 *  Fail-loud en la entrada: `tiles` y `rechazos` tienen que ser arrays y `key`
 *  una cadena no vacía. Un `__nefan.tiles` que desaparezca en un refactor del
 *  cliente tiene que poner ROJO al guion con su nombre, no colarse como
 *  «callado» —que es un veredicto sobre el bridge— ni como «llegado». */
export function veredictoDeTile({ key, tiles, episodios = [], rechazos = [] } = {}) {
  if (typeof key !== "string" || key === "") {
    throw new TypeError(`veredictoDeTile: la key del tile tiene que ser una cadena, llegó ${JSON.stringify(key)}`);
  }
  if (!Array.isArray(tiles)) {
    throw new TypeError(
      `veredictoDeTile: \`__nefan.tiles\` tiene que ser un array y llegó ${JSON.stringify(tiles)} — ` +
        `sin él no se puede decir si el tile ${key} está en el mundo del cliente, y un veredicto ` +
        `sobre el bridge sería una invención.`,
    );
  }
  if (!Array.isArray(rechazos)) {
    throw new TypeError(
      `veredictoDeTile: los rechazos del socket tienen que ser un array y llegó ${JSON.stringify(rechazos)}`,
    );
  }
  const libro = Array.isArray(episodios) ? episodios : [];
  const episodio = libro.find((e) => e && e.key === key) ?? null;
  const base = { key, episodio, libro, rechazos, tiles };

  if (tiles.includes(key)) return { ...base, estado: LLEGADO, motivo: null };
  if (rechazos.length > 0) return { ...base, estado: RECHAZADO, motivo: textoDelRechazo(rechazos[0]) };
  if (episodio && episodio.error) return { ...base, estado: FALLO, motivo: String(episodio.error) };
  return { ...base, estado: CALLADO, motivo: null };
}

/** El libro ENTERO, para pegarlo en el ✘: cuando el veredicto es `callado` no
 *  hay nada que nombrar, y lo único que puede ayudar a quien investiga es ver
 *  qué tiles SÍ tienen episodio y en qué estado se quedaron. */
function libroEnTexto(v) {
  const eps = v.libro.length
    ? v.libro
        .map((e) => `${e.key}{pedido:${e.requested ?? "—"} llegó:${e.arrived ?? "—"} de:${e.source ?? "—"}` +
          `${e.error ? ` error:«${e.error}»` : ""}}`)
        .join(", ")
    : "(vacío)";
  return `tiles en el mundo=[${v.tiles.join(", ")}] · episodios=${eps} · rechazos=${JSON.stringify(v.rechazos)}`;
}

/** La frase del ✔/✘. Dice QUÉ HIZO EL BRIDGE, que es lo que la expiración muda
 *  no podía decir, y arrastra el libro entero detrás. */
export function fraseDeTile(v) {
  const cola = libroEnTexto(v);
  switch (v.estado) {
    case LLEGADO:
      return `llegó (fuente: ${v.episodio?.source ?? "sin episodio"}) · ${cola}`;
    case FALLO:
      return `el BRIDGE dijo que este tile FALLÓ: «${v.motivo}» · ${cola}`;
    case RECHAZADO:
      return (
        `el BRIDGE RECHAZÓ el frame por unicast, así que la petición no llegó a existir: ` +
        `«${v.motivo}» · ${cola}`
      );
    case CALLADO:
      return v.episodio
        ? `el bridge NO DIJO NADA de este tile: el cliente lo tiene apuntado como pedido y sigue sin ` +
            `llegada, sin error y sin rechazo · ${cola}`
        : `el cliente nunca supo de este tile — no lo pidió él (la petición va por un socket del ` +
            `guion) y el bridge no dijo nada de él · ${cola}`;
    default:
      throw new Error(`fraseDeTile: estado desconocido ${JSON.stringify(v.estado)}`);
  }
}
