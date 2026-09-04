/** A QUIÉN LE HABLA cada `narrative_status` que difunde el bridge. Solo eso.
 *
 *  Vive aparte desde el 2026-08-30, y la razón no es de tamaño: son DOS
 *  DECISIONES DISTINTAS sobre el mismo mensaje. Rotular contesta «qué texto ve
 *  el jugador y si tapa la pantalla»; repartir contesta «a qué canal va esto».
 *  Comparten el tipo del mensaje y nada más — ni una llamada, ni un dato.
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
