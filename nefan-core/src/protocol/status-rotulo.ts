/** El RÓTULO de un fallo de la partida: qué titular lee quien juega y si el
 *  aviso tapa la pantalla o va a la línea de mensajes (#180, #352).
 *
 *  Una sola decisión, y no es cosmética. Eran dos literales sueltos en
 *  `main.ts` («Error al generar el mundo», «Error al generar la escena») encima
 *  de un cuerpo ya traducido, y hasta #352 un catch-all rotulaba todo lo que no
 *  era tile ni escena: un takeover, un disco lleno o un plugin roto salían a
 *  pantalla completa culpando al motor narrativo de algo que no había hecho.
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
 *  LO QUE NO ESTÁ AQUÍ, y estuvo:
 *
 *   · A QUIÉN va el mensaje — `status-reparto.ts`, desde el 2026-08-30.
 *   · El CUERPO en cristiano de cada fallo (los cuatro `motivo*`, la etiqueta
 *     de una fixture y `FALLO_HOJAS_BASE`) — `status-motivo.ts`, desde el
 *     2026-09-04 (#383).
 *
 *  Las tres son decisiones distintas sobre el mismo status y no comparten ni
 *  una llamada: el rótulo mira `kind` y el contexto de pantalla, el motivo mira
 *  el TEXTO de una excepción, y el reparto mira a quién pertenece la sesión. Lo
 *  que las separó no fue el gusto, fue la medida: juntas eran 162 mutantes
 *  contra un `tope_local` de 120, o sea fuera del conjunto que se puede medir
 *  sin pedir permiso a una persona. Partirlas devuelve a las dos mitades a su
 *  bucle barato sin tocar ningún umbral, que es lo contrario de subir el tope
 *  para que quepa lo que uno acaba de engordar. */
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

/** Qué puede HACER el jugador con el overlay, y por tanto QUÉ BOTONES lleva.
 *
 *  `cerrar` es la salida normal: detrás hay una partida en marcha a la que
 *  volver. `volver-al-titulo` es la del mundo vacío — cerrar ahí deja al
 *  jugador mirando un cielo negro con la barra de vida al 100 %, sin mundo y
 *  sin ninguna forma de reintentar que no sea recargar la página. Es
 *  literalmente la frase de #189, y pasa con el fallo MÁS probable de los
 *  primeros segundos: `start_session` contesta `ok:true` antes de generar el
 *  tile, así que un motor mudo no rechaza y no pasa por el catch del bucle del
 *  título.
 *
 *  `reintentar` (#478) es la tercera, y no la produce ningún fallo: es la
 *  OFERTA del bridge que llega tarde. Quien arrancó sin servidor de partida se
 *  quedaba en el visor de fixtures con el socket ya abierto y sin un solo
 *  botón que le devolviera al juego —«Volver al título» está oculto en ese
 *  muro, porque el aviso lo pinta con `cerrar`—, así que la única salida era
 *  recargar la página. Con ella el muro deja de lamentar y ofrece. */
export type SalidaDelOverlay = "cerrar" | "volver-al-titulo" | "reintentar";

/** Las salidas que puede pedir un FALLO, que no son todas.
 *
 *  `reintentar` queda fuera A PROPÓSITO y es una garantía de tipo, no una
 *  convención: el botón que ofrece entrar necesita SABER adónde lleva, y la
 *  acción viaja con la oferta (`MuroDeCarga.ofrecer`) en vez de cablearse
 *  aparte. Un `fallo(...)` que pintara «Reintentar» sin destino no compila, y
 *  `rotuloDeStatus` —que rotula fallos— no puede devolverla ni por accidente. */
export type SalidaDeFallo = Exclude<SalidaDelOverlay, "reintentar">;

/** Qué botones lleva puestos el overlay. */
export interface BotonesDelMuro {
  /** «Volver al título». */
  volver: boolean;
  /** «Cerrar». */
  cerrar: boolean;
  /** «Reintentar». */
  reintentar: boolean;
}

/** LA TABLA DE BOTONES DEL MURO, y vive aquí por lo mismo que el rótulo: es
 *  una decisión sobre lo que el jugador puede hacer, no pintura, y aquí se
 *  puede probar sin navegador y la mide la mutación. El cliente solo aplica
 *  tres `hidden`.
 *
 *  Era una pareja de booleanos derivados a mano en `ui/muro-de-carga.ts`
 *  (`const sinMundo = salida === "volver-al-titulo"`, y el otro botón por su
 *  negación), que con dos salidas colaba y con tres deja de colar: «Reintentar»
 *  va CON «Cerrar», así que ya no hay ninguna negación que valga. Con el
 *  `switch` exhaustivo, una salida nueva sin su fila no compila. */
export function botonesDelMuro(salida: SalidaDelOverlay): BotonesDelMuro {
  switch (salida) {
    case "cerrar":
      // Detrás hay partida: cerrar es seguir jugando.
      return { volver: false, cerrar: true, reintentar: false };

    case "volver-al-titulo":
      // Y sin mundo NO HAY ADÓNDE CERRAR: «Cerrar» dejaba al jugador en el
      // mismo callejón de #189 que la salida de al lado venía a abrir —cielo
      // vacío, cinco botones de ataque y recargar— y con el mismo peso visual,
      // así que media pantalla pulsaba la que no era.
      return { volver: true, cerrar: false, reintentar: false };

    case "reintentar":
      // Aquí sí hay adónde cerrar —el visor de fixtures que el jugador estaba
      // mirando—, así que «Cerrar» se queda: la oferta se puede declinar. Lo
      // que NO se ofrece es «Volver al título», porque a ese título se va
      // justamente pulsando «Reintentar»: dos botones al mismo sitio, uno de
      // ellos sin partida detrás, son el reparto de pulsaciones de #189 otra
      // vez.
      return { volver: false, cerrar: true, reintentar: true };
  }

  // Exhaustividad: una salida nueva sin política de botones no compila.
  const nunca: never = salida;
  throw new Error(`botonesDelMuro no sabe qué botones lleva la salida "${String(nunca)}"`);
}

/** Unión discriminada y no un objeto con `titulo` siempre: un fallo que va a
 *  la línea de mensajes NO TIENE título, y darle uno era dato muerto. Lo dijo
 *  la mutación antes que nadie — cambiarle el texto a ese título no rompía
 *  ningún test, porque no lo lee nadie. La respuesta no es un aserto más sobre
 *  algo que no se pinta: es que el estado no se pueda escribir. */
export type Rotulo =
  /** El error tapa la pantalla y el jugador tiene que descartarlo. */
  | { destino: "overlay"; titulo: string; detalle: string; salida: SalidaDeFallo }
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
  combatientes: "Alguno de los enemigos de ese lote no pudo entrar al mundo.",
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
  "phase" | "kind" | "message" | "placeId" | "causaReaccion"
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
  const salida: SalidaDeFallo = ctx.mundoVacio ? "volver-al-titulo" : "cerrar";

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
      // La causa viene de la misma clasificación que escribió el detalle.
      return {
        destino: "overlay",
        titulo: status.causaReaccion === "conexion"
          ? "El motor narrativo no responde"
          : "El motor narrativo rechazó la respuesta",
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

    case "combatientes":
      // EL ÚNICO FALLO QUE NO TAPA LA PANTALLA APARTE DE LA FRONTERA, y por la
      // misma razón que aquélla: lo que ha fallado NO es lo que el jugador
      // está esperando. El mundo está pintado, los enemigos buenos del lote
      // acaban de entrar y la partida sigue; lo que falta es uno de ellos.
      //
      // Hasta el 2026-09-14 este hecho salía por `protocolo` —o sea «Fallo
      // interno del juego» a pantalla completa— y además con el frame ENTERO
      // descartado, porque el criterio del enemigo vivía dentro del intake
      // (`EnemySpawnSchema`). El cliente, con el MISMO criterio, descartaba un
      // enemigo y seguía: un solo veredicto con dos desenlaces, y mandaba el
      // destructivo (#529, hallazgo A3-bis del guion 90). No lleva `salida`
      // porque no hay nada que cerrar: el motivo va a la línea de mensajes y
      // al registro de errores, que es donde el jugador lo puede leer sin
      // dejar de jugar.
      return { destino: "log", detalle };
  }

  // Exhaustividad: un kind nuevo sin titular propio no compila. Es el candado
  // del criterio 3 de #352 — el catch-all que había aquí es el mecanismo que
  // fabricaba el bug, no su víctima.
  const nunca: never = status.kind;
  throw new Error(`rotuloDeStatus no sabe rotular el kind "${String(nunca)}"`);
}