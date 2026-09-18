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
 *  ── LAS CUATRO BOCAS POR LAS QUE MUERE UN `request_tile` ────────────────
 *  Las tres primeras están en el árbol y tienen señal publicada; la cuarta es
 *  la ausencia de las otras tres, y es la que hay que decir con cuidado:
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
 *   3 · **el bridge habla y el CLIENTE lo tira** — un `narrative_status` cuyo
 *       sello no es el de la partida aplicada se descarta en el embudo de #312
 *       (`net/narrative-client.ts`) y se cuenta en `__nefan.descartados()`. Es
 *       la familia de #673/#659, y sin mirar ese contador el veredicto acusaba
 *       al bridge de callar cuando quien no escuchaba era el cliente.
 *   4 · **no hay constancia de nada** — que NO es lo mismo que «el bridge
 *       calló», y por eso su frase no lo afirma: ver `fraseDeTile`.
 *
 *  Aquí se decide cuál de las cuatro (o la quinta: llegó) ocurrió, a partir de
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

/** Los CINCO desenlaces. Si la lectura del cliente no tiene la forma que este
 *  juicio necesita, se LANZA (abajo), porque un veredicto inventado sobre un
 *  libro ilegible es justo la clase de verde que este módulo viene a impedir.
 *
 *  `CALLADO` se llama así por costumbre y el nombre MIENTE un poco, por eso su
 *  frase no lo repite: significa «no tengo constancia», no «el bridge no dijo
 *  nada». La diferencia la cazó QA y no es una precisión de estilo — ver la
 *  frase, que enumera lo que desde aquí no se puede ver. */
export const LLEGADO = "llegado";
export const FALLO = "fallo";
export const RECHAZADO = "rechazado";
export const DESCARTADO = "descartado";
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
 *  `descartados` es el DELTA de `__nefan.descartados()` (#312) entre justo
 *  antes de mandar el frame y justo después de la espera — una marca de agua,
 *  como la del log del bridge en los guiones 120 y 127. Se lee como delta y no
 *  como total porque el contador es de la SESIÓN entera y lo mueven los demás
 *  guiones.
 *
 *  `expiro` y `ms` dicen si la espera agotó su presupuesto, y **no son
 *  decorativos**: son lo que hace que `firmaDePresupuesto` (`qa/lib/carga.mjs`)
 *  reconozca este ✘ como una expiración cuando lo es. Sin ellos, el reproductor
 *  bajo carga declaraba «no atribuible a #545» un ✘ que se había comido 90 s de
 *  presupuesto — el MISMO defecto de cable que esta PR arregló en
 *  `esperarRegistro`, reintroducido por la otra punta. Lo caza un test que
 *  importa las dos mitades.
 *
 *  **El orden importa y no es arbitrario.** `rechazado` gana a `fallo` porque
 *  un frame rechazado significa que ESTA petición no llegó a existir: un error
 *  en el libro para esa key sería de un intento anterior, y nombrarlo mandaría
 *  a quien investiga al sitio equivocado. `fallo` gana a `descartado` porque el
 *  episodio es de ESTA key y el contador de descartes solo es de esta VENTANA.
 *  Y `llegado` gana a todo: si el tile acabó en el mundo, llegó, por muchos
 *  errores que hubiera por el camino.
 *
 *  Fail-loud en la entrada: `tiles` y `rechazos` tienen que ser arrays y `key`
 *  una cadena no vacía. Un `__nefan.tiles` que desaparezca en un refactor del
 *  cliente tiene que poner ROJO al guion con su nombre, no colarse como
 *  «callado» —que es un veredicto sobre el bridge— ni como «llegado». */
export function veredictoDeTile({
  key,
  tiles,
  episodios = [],
  rechazos = [],
  descartados = null,
  expiro = false,
  ms = null,
} = {}) {
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
  const tirados = cuentaDeDescartes(descartados);
  const base = { key, episodio, libro, rechazos, tiles, descartados: tirados, expiro: expiro === true, ms };

  if (tiles.includes(key)) return { ...base, estado: LLEGADO, motivo: null };
  if (rechazos.length > 0) return { ...base, estado: RECHAZADO, motivo: textoDelRechazo(rechazos[0]) };
  if (episodio && episodio.error) return { ...base, estado: FALLO, motivo: String(episodio.error) };
  if (tirados.total > 0) {
    return {
      ...base,
      estado: DESCARTADO,
      motivo: `${tirados.total} mensaje(s) de otra partida tirados mientras se esperaba ` +
        `(${tirados.n} evento(s), ${tirados.status} status)`,
    };
  }
  return { ...base, estado: CALLADO, motivo: null };
}

/** El delta de `__nefan.descartados()` → `{n, status, total}`. Tolerante con la
 *  ausencia (`null` = no se midió) y con los negativos, que no deberían salir
 *  pero saldrían si alguien reseteara el cliente a mitad: un negativo se lee
 *  como cero, nunca como evidencia. */
function cuentaDeDescartes(d) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const n = num(d?.n);
  const status = num(d?.status);
  return { n, status, total: n + status, medido: d !== null && d !== undefined };
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
  return `tiles en el mundo=[${v.tiles.join(", ")}] · episodios=${eps} · rechazos=${JSON.stringify(v.rechazos)}` +
    ` · descartes en la ventana=${v.descartados.medido ? `${v.descartados.n}+${v.descartados.status}` : "sin medir"}`;
}

/** CON QUÉ RELOJ murió esto, y **con las palabras que `firmaDePresupuesto`
 *  reconoce** (`qa/lib/carga.mjs`: `/expiró a los \d+\s*ms/i`).
 *
 *  Solo cuando la espera EXPIRÓ de verdad. Un ✘ que salió en 179 ms porque el
 *  bridge contestó «falló» no se ha comido ningún presupuesto, y estamparle la
 *  firma convertiría un defecto real del juego en un supuesto rojo de #545 —
 *  que es la mentira simétrica a la que este cable vino a arreglar. Por eso
 *  `expiro` es un dato que viaja desde el helper y no una suposición de aquí. */
function relojEnTexto(v) {
  if (!v.expiro) return "la espera paró sola (no expiró: el presupuesto no se agotó)";
  return v.ms === null
    ? "la espera EXPIRÓ (sin presupuesto declarado)"
    : `la espera expiró a los ${v.ms} ms`;
}

/** La frase del ✔/✘. Dice QUÉ HIZO EL BRIDGE, que es lo que la expiración muda
 *  no podía decir, y arrastra el libro entero detrás.
 *
 *  **Lo que NO dice, y es el arreglo del hallazgo H-1 de QA**: «el bridge no
 *  dijo nada de él». Eso era falso en tres estados vivos —el tile que va LENTO
 *  (el bridge difunde `generating` y el `TileLedger` solo apunta `ready` y
 *  `error`), el status con sello de otra partida y el error difundido sin campo
 *  `tile`—, y el primero es el caso más probable de #656. La cabecera del
 *  propio `TileLedger` dice que nació porque «un tope de reloj no sabe
 *  distinguir "va lento" de "murió"»: heredar esa ceguera es inevitable desde
 *  aquí, convertirla en afirmación no lo era. */
export function fraseDeTile(v) {
  const cola = `${relojEnTexto(v)} · ${libroEnTexto(v)}`;
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
    case DESCARTADO:
      return (
        `el bridge SÍ habló y el CLIENTE lo TIRÓ: ${v.motivo} — el sello no era el de la partida ` +
        `aplicada (embudo de #312, familia #673/#659). Ojo con el alcance: \`descartados()\` son ` +
        `CONTADORES de sesión, no un libro por key, así que lo que está medido es que hubo ` +
        `mensajes ajenos en ESTA ventana, no que fueran de este tile · ${cola}`
      );
    case CALLADO:
      return (
        `NO HAY CONSTANCIA de este tile, que no es lo mismo que «el bridge calló»: ` +
        `${v.episodio
          ? "el cliente lo tiene apuntado como pedido y sigue sin llegada y sin error"
          : "el cliente nunca supo de él — no lo pidió él (la petición va por un socket del guion)"}` +
        `, no contestó nada por este socket y no se tiró ningún mensaje ajeno en la ventana. ` +
        `LO QUE DESDE AQUÍ NO SE VE, y por eso esto no afirma silencio: el \`TileLedger\` solo ` +
        `apunta \`ready\` y \`error\`, así que un tile que va LENTO —el bridge difundió ` +
        `\`generating\` y el cliente pintó el velo— es indistinguible de uno muerto; y un error ` +
        `difundido SIN campo \`tile\` (coords no enteras: \`tx\` es \`z.number()\` sin \`.int()\`) ` +
        `tampoco deja episodio · ${cola}`
      );
    default:
      throw new Error(`fraseDeTile: estado desconocido ${JSON.stringify(v.estado)}`);
  }
}
