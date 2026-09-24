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
 *
 *  ── LO QUE ENTRÓ CON #677 Y #687 (tanda V) ──────────────────────────────
 *  Aquí viven también, desde entonces, las OTRAS tres decisiones de la espera
 *  que hasta ese día estaban repartidas entre `sesion.mjs` y este fichero:
 *   · el CORTAFUEGOS (`MS_DEL_TILE`), uno para todas las esperas de tile del banco,
 *     con la aritmética del cuelgue escrita a su lado;
 *   · la SONDA que corre dentro de la página (`sondaDeTile`), que ya no tiene
 *     precedencia propia: devuelve la lectura cruda en cuanto hay señal, y la
 *     única precedencia es la de `veredictoDeTile` (H-3 de #687: había dos y
 *     estaban invertidas);
 *   · la DECISIÓN de qué pasa tras una expiración (`laExpiracionAborta`): el
 *     guion aborta en la primera, porque la segunda mediría el mismo cuelgue
 *     (H-4 de #687).
 *  Y el validador de la lectura (`exigeLecturaDeTile`) sale de dentro del
 *  veredicto para poder aplicarse ANTES de abrir la espera (H-5: el
 *  `hook.tiles ?? []` degradaba en silencio lo que esto fail-loudeaba 90 s
 *  después).
 */

/** EL CORTAFUEGOS DE UN TILE DEL BRIDGE: UNO para las QUINCE esperas del banco
 *  que tienen ese sujeto (#677), decidido por el coste del CUELGUE y no por lo
 *  que tarda el tile.
 *
 *  (Nacieron siendo ONCE. El censo del issue y el del plan filtraban por el
 *  LITERAL —`240_000|180_000`— sobre los guiones que el issue nombraba, y la
 *  QA de la tanda barrió `qa/**` por el árbol: faltaba un quinto camino al
 *  mismo `runTileGeneration`, el viaje por «Salidas» de los guiones 49 ×2, 60
 *  y 65. Un censo por grafía nace ciego, también cuando la grafía es un
 *  número.)
 *
 *  **Lo que tarda el tile no puede decidir el número.** Con el motor falso
 *  (retraso 0, `labs/narrative/fake-ai-server.ts`) un tile llega en torno a un
 *  segundo: el guion 157 lo mide en cada corrida —32 tiles, p50/p95/máx— y
 *  exige que este cortafuegos esté al menos a 10× de su p95. Con ese suelo,
 *  cualquier número entre 10 s y 240 s es defendible, así que la medida es el
 *  RECIBO de que el suelo está lejos, no la fuente del número. Y el motor real
 *  no vale como fuente tampoco: gasta créditos y es otro contrato.
 *
 *  **Lo que sí lo decide es cuánto cuesta cada cuelgue.** El único reloj que
 *  corta un `request_tile` al que el bridge no contesta es éste: el del
 *  bridge (`generateScene`, `llm_timeout_s·1000 + 60_000` en
 *  `src/narrative/ai-client.ts`) está a 31 minutos. Y con el falso toda boca
 *  de fallo HABLA en menos de 2 s (`mode:"error"`, rechazo por unicast,
 *  `viaje.error`), así que un silencio es un cuelgue, y lo que se paga por él
 *  es esperas × cortafuegos. Hasta #677 había CUATRO números —60, 90, 180 y
 *  240 s— por tres caminos que acaban en el mismo `runTileGeneration`, y
 *  nadie había escrito por qué. La cuenta por guion, antes → ahora:
 *   · 127 — siete `pedirYEsperarTile`: 7 × 90 s = 10,5 min → 1 × 90 s, porque
 *     la expiración ABORTA (`laExpiracionAborta`).
 *   · 120 — dos: 3 min → 1,5 min, por lo mismo.
 *   · 08, 09, 15, 74, 75, 144, 154 — sus viajes por «Salidas» a 240 s (hasta
 *     tres por guion): 12 min → 4,5 min en los de ida y vuelta.
 *   · 05, 42 — `holdUntil` a 180 s hasta entrar en el tile: 3 min → 1,5 min.
 *   · 63 — el tile en el SAVE a 60 s: SUBE a 90 y sale `sinMedir`.
 *   · 49 (×2), 60, 65 — el viaje por «Salidas» a 180 s: 3 min → 1,5 min en el
 *     49 y 1,5 min → 45 s en los otros dos.
 *  Y desde #693 las ONCE esperas de viaje son UNA, `viajarPorSalidas`
 *  (`qa/lib/viaje.mjs`), que para por ESTADO: un viaje que el bridge declara
 *  roto (`viaje.error`) corta en segundos —medido en el guion 168— y el
 *  cortafuegos solo lo paga el cuelgue de verdad. Hasta entonces siete de
 *  ellas no miraban `viaje.error`, y eso era la razón medible por la que 240
 *  costaba más que 90: 150 s más por cada viaje roto, sin que ninguno de los
 *  dos números pusiera verde nada.
 *
 *  **Por qué 90 y no 60.** Es el único de los cuatro con aritmética escrita
 *  (#656) y con salida negativa MEDIDA (`handleRequestTile` ignorando el
 *  frame → ✘ a los 90 s, cabecera del guion 120). Un 60 ahorraría 30 s por
 *  cuelgue y obligaría a reescribir tres cabeceras y una fila del README que
 *  ya dicen 90, sin comprar nada medible.
 *
 *  Fuera del sujeto, y se dejan como están: `115:175` (el PAGO del batch de
 *  estilo) y `regenerarMundo`/`curarMundo` en `sesion.mjs` (la pre-generación
 *  de NUEVE escenas, un lote, a 240 s).
 *
 *  Quién lo usa lo canda `data/contract/esperas-de-tile.json` por el ÁRBOL
 *  (`test/el-cortafuegos-del-tile-tiene-dueno.test.ts`): las cuatro esperas
 *  del padrón presupuestan con este identificador —las otras dos, en el 120 y
 *  el 127, lo heredan del default de `pedirYEsperarTile`—, ninguna copia local
 *  ni alias con otro nombre, y ningún `pedirYEsperarTile` trae su propio `ms`. */
export const MS_DEL_TILE = 90_000;

/** LA SONDA DE LA ESPERA. Corre DENTRO de la página (Playwright la serializa
 *  con `String(fn)`), así que aquí no puede haber ni una referencia a nada de
 *  este módulo: solo `window.__nefan` y `window.__qaTileRechazos`. El test la
 *  ejecuta serializada contra un `window` de mentira por eso mismo.
 *
 *  **No tiene precedencia, a propósito** (H-3 de #687). La que había —llegado
 *  > fallo > rechazado— estaba INVERTIDA respecto a la de `veredictoDeTile`
 *  (llegado > rechazado > fallo), y aunque hoy `parada` solo se compara con
 *  `null`, dos precedencias escritas son una que se acaba leyendo. Esto
 *  devuelve la LECTURA cruda en cuanto hay cualquier señal que sepamos ver
 *  —el tile en el mundo, un episodio con error, un rechazo por unicast— y
 *  quien decide cuál gana es el veredicto, en un solo sitio. Lo que garantiza
 *  el test: `sonda ≠ null ⇔ veredicto ∉ {callado, descartado}`.
 *
 *  `hook.tiles` va A PELO, sin `?? []` (H-5): si el cliente deja de publicar
 *  `tiles`, esto LANZA en cada sondeo, `waitFor` lo cuenta en `rotos` y el
 *  veredicto lanza al expirar con el nombre del registro. Y antes de llegar
 *  aquí, `exigeLecturaDeTile` ya lo habrá dicho en el preflight. */
export function sondaDeTile(k) {
  const hook = window.__nefan;
  const tiles = hook.tiles;
  const episodio = (hook.tileEpisodios ?? []).find((e) => e && e.key === k) ?? null;
  const rechazos = window.__qaTileRechazos;
  if (tiles.includes(k) || (episodio !== null && Boolean(episodio.error)) || rechazos.length > 0) {
    return { tiles, episodio, rechazos };
  }
  return null;
}

/** Fail-loud de la LECTURA del cliente: `tiles` y `rechazos` tienen que ser
 *  arrays y `key` una cadena no vacía. Un `__nefan.tiles` que desaparezca en
 *  un refactor del cliente tiene que poner ROJO al guion con su nombre, no
 *  colarse como «callado» —que es un veredicto sobre el bridge— ni como
 *  «llegado».
 *
 *  Es una función aparte, y no el arranque de `veredictoDeTile`, para poder
 *  aplicarla ANTES de abrir la espera (H-5 de #687): `pedirYEsperarTile` lee
 *  `tiles` y `rechazos` en el mismo `evaluate` de la marca de agua y los pasa
 *  por aquí, así que un hook sin `tiles` revienta en ese instante y no 90 s
 *  después. Lanza `TypeError`, que `ctx.absorbe` no traga. */
export function exigeLecturaDeTile({ key, tiles, rechazos } = {}) {
  if (typeof key !== "string" || key === "") {
    throw new TypeError(`lectura del tile: la key del tile tiene que ser una cadena, llegó ${JSON.stringify(key)}`);
  }
  if (!Array.isArray(tiles)) {
    throw new TypeError(
      `lectura del tile: \`__nefan.tiles\` tiene que ser un array y llegó ${JSON.stringify(tiles)} — ` +
        `sin él no se puede decir si el tile ${key} está en el mundo del cliente, y un veredicto ` +
        `sobre el bridge sería una invención.`,
    );
  }
  if (!Array.isArray(rechazos)) {
    throw new TypeError(
      `lectura del tile: los rechazos del socket tienen que ser un array y llegó ${JSON.stringify(rechazos)}`,
    );
  }
}

/** LA DECISIÓN DE H-4 (#687), con nombre, sitio y test: **tras una expiración,
 *  el guion ABORTA.** Trivial a propósito.
 *
 *  Las dos opciones eran «aborta en la primera» y «acaba diciendo la verdad».
 *  La segunda es lo que hacía el 127: siete `pedirYEsperarTile` bajo silencio
 *  real son 7 × 90 s = 10,5 minutos para repetir siete veces la misma frase,
 *  y sus asertos de coste (`generaciones()`) ya no significan nada después de
 *  la primera. Tras un silencio de 90 s, el siguiente tile cuesta otros 90 s
 *  midiendo el MISMO cuelgue. Así que la expiración aborta, y SOLO ella: los
 *  desenlaces hablados —fallo, rechazo— salen en menos de 2 s con el falso y
 *  el guion sigue, que es lo que permite medir «se criban LAS DOS» en el E1
 *  del 127. Quien la aplica es `pedirYEsperarTile`, justo después del
 *  `ctx.expect` que ya dejó el ✘ con la frase del veredicto. */
export function laExpiracionAborta(v) {
  return v.expiro === true;
}

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
 *  Fail-loud en la entrada: `exigeLecturaDeTile`, que es el mismo validador
 *  que `pedirYEsperarTile` aplica ANTES de abrir la espera. */
export function veredictoDeTile({
  key,
  tiles,
  episodios = [],
  rechazos = [],
  descartados = null,
  expiro = false,
  ms = null,
} = {}) {
  exigeLecturaDeTile({ key, tiles, rechazos });
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
