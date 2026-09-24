/** A QUIÉN LE HABLA cada `narrative_status` que difunde el bridge, y a qué
 *  espera del cliente pertenece (#737, #742).
 *
 *  Vive aparte desde el 2026-08-30, y la razón no es de tamaño: son DOS
 *  DECISIONES DISTINTAS sobre el mismo mensaje. Rotular contesta «qué texto ve
 *  el jugador y si tapa la pantalla»; repartir contesta «a qué canal va esto».
 *  Comparten el tipo del mensaje y una sola pregunta: de quién es un fallo
 *  cuando hay un viaje abierto (`deQuienEs`, #737), que vive aquí y el
 *  rótulo importa. Es una pregunta sobre A QUÉ espera le habla el status — o
 *  sea de reparto — y el rótulo la necesita para no tapar un «Viajando...»
 *  con el error de otro tile. Desde #742 contesta también por la LLEGADA: qué
 *  `ready` cierra el viaje y quita su muro (`esperasQueTermina`,
 *  `elReadyQuitaElMuro`).
 *
 *  Estuvieron juntas un día, el que #313 tardó en mudar el reparto desde
 *  `session/session-facets.ts`, y el módulo lo dijo por su cuenta: el fichero
 *  del que salió este —el que hoy son `status-rotulo.ts` y `status-motivo.ts`,
 *  que el 2026-09-04 se partieron a su vez por lo mismo y otra vez (#383)—
 *  pasó de 116 a 133 mutantes y cruzó el `tope_local` de 120, o sea que salió
 *  del conjunto que un agente puede medir en su propia máquina sin pedir
 *  permiso. La respuesta a un módulo que engorda porque se le ha metido una
 *  responsabilidad nueva es separarla, no subir el umbral — subirlo para que
 *  quepa lo que uno acaba de engordar es la trampa que describe
 *  `feedback_metricas_son_sintomas`.
 *
 *  Módulo PURO: no toca el DOM ni `node:*`. Su batería es
 *  `test/status-reparto.test.ts` y su medida de mutación va aparte
 *  (`mutation-targets.json`).
 */
import type {
  NarrativeStatusDeJuego,
  NarrativeStatusDeSesion,
  NarrativeStatusMessage,
} from "./messages.js";

/** A quién le habla un `narrative_status` que difunde el bridge (#312), y
 *  CUÁL de las dos armas resultó ser.
 *
 *  `"titulo"` la barra de pre-generación de mundo · `"juego"` la partida que se
 *  está jugando · `"fallo-ajeno"` el registro de errores, y NADA más ·
 *  `"descartado"` a nadie, con su contador.
 *
 *  Devuelve el mensaje AL LADO del destino, y no solo el destino, porque las
 *  dos cosas son la misma decisión: quien reparte tiene que entregar a cada
 *  canal el arma que ese canal sabe leer, y un destino suelto no estrecha nada
 *  —medido: devolviendo solo el destino, el `switch` del embudo del
 *  cliente sale con `TS2345` en los dos canales y `TS2339` en las dos trazas,
 *  porque `tsc` no puede correlacionar un string con la forma del mensaje—. Con
 *  el par etiquetado, entregar el arma equivocada a un canal no compila, y sigue
 *  habiendo UNA sola función que decide. */
export type StatusRepartido =
  /** Se direcciona por JUEGO: a la tarjeta de ESE juego en el título. */
  | { destino: "titulo"; status: NarrativeStatusDeJuego }
  /** Lleva MI sello: a la partida que se está jugando. */
  | { destino: "juego"; status: NarrativeStatusDeSesion }
  /** Ajeno y es un fallo: se enseña igual, recortado a lo rotulable. */
  | { destino: "fallo-ajeno"; status: NarrativeStatusDeSesion }
  /** Ajeno y no es un fallo: a nadie, con su contador. */
  | { destino: "descartado"; status: NarrativeStatusDeSesion };

/** El reparto, como función pura. Vive en core y no en el cliente porque en el
 *  cliente no hay nada que pueda ponerse rojo: `nefan-html` no tiene harness
 *  (#241). Vive en ESTE fichero desde #313 —antes estaba en
 *  `session/session-facets.ts`, con el nombre `destinoDeStatus`— porque al
 *  dejar de preguntar por el sello dejó de necesitar «cuál es la mía» como algo
 *  más que un argumento; con la mudanza se fue el import de `protocol/messages`
 *  que ensuciaba aquel módulo puro.
 *
 *  EL PROBLEMA que resuelve (#312): hasta entonces el embudo del cliente
 *  filtraba los `narrative_event` por sello y dejaba pasar TODOS los
 *  `narrative_status`. Un `ready` de una partida abandonada llegaba entero a la
 *  viva, y con `spawn` le escribía la posición al jugador — teletransporte, no
 *  «interfaz desbloqueada». `sessionChangedError` (bridge) estrecha la ventana
 *  a los frames ya en vuelo, pero no la cierra.
 *
 *  EL ORDEN DE LAS REGLAS ES EL DISEÑO:
 *
 *  1. Lo que trae `gameId` va al TÍTULO. Y la diferencia con lo que había hasta
 *     #313 no es cosmética: aquí ponía `if (status.kind === "game_gen") return
 *     "titulo"` —una excepción POR KIND, que se saltaba el sello porque el sello
 *     de una pre-generación era basura—. Ahora no hay excepción que hacer: se
 *     pregunta QUÉ IDENTIFICADOR TRAE el mensaje, y un mensaje que se direcciona
 *     por juego no tiene sello que saltarse. El `kind` no reaparece más abajo ni
 *     en el transporte; si reapareciera en cualquiera de los dos sitios, la
 *     excepción solo se habría mudado de sitio.
 *  2. Lo que es mío, a la partida.
 *  3. Lo ajeno que es un FALLO no se calla: un error de una sesión recién muerta
 *     sigue llegando a quien juega. Es el motivo por el que este embudo no
 *     filtraba nada, y por el que la respuesta no es filtrarlo entero sino
 *     partirlo en canales.
 *  4. El resto —un `ready`, un `generating`, un latido de una partida que ya no
 *     está— no tiene destinatario. */
export function repartirStatus(
  status: NarrativeStatusMessage,
  esMio: (sessionId: string) => boolean,
): StatusRepartido {
  if ("gameId" in status) return { destino: "titulo", status };
  if (esMio(status.sessionId)) return { destino: "juego", status };
  if (status.phase === "error") return { destino: "fallo-ajeno", status };
  return { destino: "descartado", status };
}

/** De quién es un status de tile o de escena, visto desde el viaje que el
 *  cliente tiene abierto (#737, #742). `"sin-viaje"`: no hay viaje que
 *  atribuir · `"del-viaje"`: el status trae el `placeId` de ESE viaje ·
 *  `"ajeno-al-viaje"`: hay viaje y el status no es suyo — un tile vecino, un
 *  prefetch, o un status sin `placeId`.
 *
 *  Lo que llega SIN `placeId` con un viaje abierto es ajeno, y esa es la
 *  decisión de fondo: hasta #737 se le atribuía al viaje «por ser la causa
 *  candidata», así que el error de un tile vecino rompía un viaje que iba a
 *  llegar; y hasta #742 cualquier `ready` quitaba su «Viajando...». La regla
 *  solo aguanta si el bridge marca TODO lo que emite por el viaje — el
 *  `fail()` de `runTileGeneration` y también el `ready` (`meta.viaje` de
 *  `broadcastScene`) —; un productor que se olvide la marca devuelve el viaje
 *  a la expiración, y lo sujeta `test/bridge-map.test.ts`.
 *
 *  La consultan las decisiones que un status toma sobre el viaje: qué espera
 *  termina y si quita el muro (aquí abajo) y si un fallo tapa el
 *  «Viajando...» (`status-rotulo.ts`). Si cada una tuviera su regla, el ledger
 *  diría «abierto» y el muro «roto». */
export type DuenoDelStatus = "del-viaje" | "ajeno-al-viaje" | "sin-viaje";

export function deQuienEs(
  status: Pick<NarrativeStatusDeSesion, "placeId">,
  viajeAbierto: string | null,
): DuenoDelStatus {
  if (viajeAbierto === null) return "sin-viaje";
  return status.placeId === viajeAbierto ? "del-viaje" : "ajeno-al-viaje";
}

/** Qué esperas termina un fallo de MI partida (#593). Un aviso de enemigos,
 * guardado o plugins no es una contestación ni el desenlace de un viaje.
 * El takeover sí invalida ambas: esta página ya no conduce la partida. */
const ESPERA_POR_KIND: Record<NarrativeStatusDeSesion["kind"], "viaje" | "saludo" | "ambas" | null> = {
  tile: "viaje", scene: "viaje", consequences: "saludo", takeover: "ambas",
  restore: null, save: null, plugin: null, action: null, protocolo: null, combatientes: null,
};

/** Cómo TERMINA el viaje abierto con este status (#742): llega, se rompe, o
 *  sigue (`null`). Es UNA decisión y no dos booleanos: hasta #742 core solo
 *  decidía el fallo, y la llegada la decidía el ledger del cliente por su
 *  cuenta —con cualquier `spawn`, sin mirar de quién era—, así que un viaje
 *  `sin ancla` que llegaba no se cerraba nunca. */
export type DesenlaceDelViaje = "llegada" | "fallo" | null;

/** `viajeAbierto` es el `placeId` del viaje que el cliente espera, o `null`.
 *  Obligatorio a propósito: quien lo olvide no compila, en vez de volver a
 *  atribuir al viaje lo que no es suyo (#737). Un `tile`/`scene` cierra el
 *  viaje solo si es SUYO; el takeover lo rompe siempre, porque no habla de
 *  ningún lugar: habla de quién conduce la partida. Y el viaje LLEGA con el
 *  `ready` de tile que trae su `placeId` — con `spawn` o sin él: el viaje
 *  `sin ancla` también llega (#742). */
export function esperasQueTermina(
  status: Pick<NarrativeStatusDeSesion, "kind" | "phase" | "placeId">,
  viajeAbierto: string | null,
): {
  viaje: DesenlaceDelViaje; saludo: boolean;
} {
  if (status.phase === "ready") {
    const llega = status.kind === "tile" && deQuienEs(status, viajeAbierto) === "del-viaje";
    return { viaje: llega ? "llegada" : null, saludo: false };
  }
  const espera = status.phase === "error" ? ESPERA_POR_KIND[status.kind] : null;
  const rompe = espera === "ambas" || (espera === "viaje" && deQuienEs(status, viajeAbierto) === "del-viaje");
  return { viaje: rompe ? "fallo" : null, saludo: espera === "saludo" || espera === "ambas" };
}

/** Qué hay en el muro de carga, como HECHO que el cliente declara y no como
 *  clase del DOM: `"espera"` un muro sin botones (el «Viajando...», el
 *  arranque) · `"aviso"` un muro que pide que el jugador lo lea (un fallo, una
 *  oferta, un aviso) · `"nada"` sin muro. */
export type MuroEnPantalla = "espera" | "aviso" | "nada";

/** Si un `ready` quita el muro (#742). Hasta entonces lo quitaba CUALQUIER
 *  `ready` de tile: un prefetch que aterrizaba a mitad de viaje soltaba al
 *  jugador antes de tiempo —y el fallo del destino, detrás, iba ya a la línea
 *  de mensajes—, y uno que llegaba detrás de «No se pudo llegar» se llevaba el
 *  motivo antes de que nadie lo leyera.
 *
 *  Las tres reglas, en su orden:
 *   1. Un `ready` no quita NUNCA un aviso: el aviso lo cierra quien lo lee.
 *   2. Sin viaje abierto, la espera es la del arranque («Iniciando
 *      partida...», «Generando mundo inicial...») y el primer tile la quita.
 *   3. Con viaje, solo su LLEGADA — la misma respuesta que cierra el ledger,
 *      no una segunda regla —.
 *
 *  `viajeAbierto` se lee ANTES de cerrar el ledger con este mismo status: si
 *  no, la llegada ya lo ha puesto a `null` y la regla 2 deja pasar a todos. */
export function elReadyQuitaElMuro(
  status: Pick<NarrativeStatusDeSesion, "kind" | "phase" | "placeId">,
  ctx: { viajeAbierto: string | null; muro: MuroEnPantalla },
): boolean {
  if (ctx.muro !== "espera") return false;
  if (ctx.viajeAbierto === null) return true;
  return esperasQueTermina(status, ctx.viajeAbierto).viaje === "llegada";
}
