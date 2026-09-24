/** UN FRAME POR EL CABLE DEL JUEGO SIN CERRAR LA BOCA POR LA QUE VUELVE EL
 *  RECHAZO (#678).
 *
 *  El bridge contesta un frame que no pasa el contrato por UNICAST, al socket
 *  que lo mandó (`bridge/ws-server.ts`, `narrative_status` con `phase:"error"`
 *  y `kind:"protocolo"`); y `escribir` calla si ese socket ya no está abierto.
 *  Así que el cliente del banco que abre, manda y cierra en el mismo tick —lo
 *  que hacían el 60 y el 63 con su `setTimeout(() => ws.close(), 0)`— no pierde
 *  el color: pierde la CAUSA. El 63 declaraba ⊘ «el tile no llegó al save» y el
 *  60 ✘ «timeout esperando tile listo», y el único rastro del rechazo era el
 *  `console.error` del bridge, que el runner solo enseña con `QA_VERBOSE`. Es
 *  #656 en su forma general: aquel arreglo (`pedirYEsperarTile`,
 *  `qa/lib/sesion.mjs`) es para quien espera el tile en el ledger del CLIENTE;
 *  esto es para quien manda un frame y espera su consecuencia por OTRO canal
 *  (el save en disco, el HUD) y aun así quiere saber si el bridge lo rechazó.
 *
 *  ── POR QUÉ HAY UNA SOLA PUERTA Y NO TRES ──────────────────────────────────
 *
 *  La primera versión exportaba `mandarPorElCable` y `cerrarElCable` por
 *  separado, y la QA de la tanda midió lo que eso permite: llamarlas seguidas
 *  reproduce #678 A TRAVÉS del helper —`reason:"nope"` ×5 → tres rechazos
 *  perdidos de cinco, intermitente— con el padrón en verde, porque el
 *  `new WebSocket` que se declara es el de aquí y el mal uso vive en quien
 *  llama. Un helper cuya garantía depende de que el llamante haga los pasos en
 *  el orden bueno no es una garantía: es una convención.
 *
 *  Por eso abrir y cerrar son PRIVADOS y solo se sale por `porElCable(ctx,
 *  mensaje, espera)`, que abre, manda, **espera lo que le digas** y cierra él,
 *  o por `preguntarPorElCable`, que es lo mismo con la espera escrita dentro.
 *  No se puede cerrar antes de recoger porque no hay `cerrar` que llamar, y no
 *  se puede mandar sin esperar porque la espera es un argumento obligatorio.
 *  Lo que queda fuera —una `espera` que no espera nada— está declarado como
 *  agujero en `data/contract/clientes-ws-del-banco.json` y medido en el guion
 *  152, porque eso ya se lee en la propia llamada.
 *
 *  La forma: el socket se abre DESDE LA PÁGINA (la URL la da el propio juego,
 *  como en `saves.mjs`, así hereda su `?bridge=`), manda el frame y queda
 *  ABIERTO apuntando lo que el bridge le conteste mientras corre la espera. Al
 *  acabar la espera —bien o mal— se cierra y se devuelven los rechazos, que
 *  `fraseDeRechazos` convierte en el texto que va dentro del ⊘ o del ✘.
 *
 *  QUÉ PUEDE LLEGARLE, y la primera versión de esta cabecera lo decía mal
 *  («solo puede recibir unicast»). El socket no manda `subscribe`, pero el
 *  bridge SUSCRIBE a quien le manda `start_session` o `resume_session`
 *  (`bridge/handlers/session.ts`), así que un cable que lleve uno de esos dos
 *  recibe también las difusiones de la partida, y entre ellas
 *  `narrative_status/error` de otros `kind` (`tile`, `scene`…) que no son
 *  suyos. Todos se APUNTAN con su `kind`; lo que distingue «el bridge rechazó
 *  ESTE frame» es `kind:"protocolo"`, que solo sale del intake y solo por
 *  unicast (`bridge/ws-server.ts`).
 *
 *  ── «MANDO UN FRAME Y ESPERO SU RESPUESTA» (#694) ──────────────────────────
 *
 *  Quince clientes del banco abrían su propio socket, mandaban un frame y
 *  esperaban UN tipo de respuesta tirando lo demás por tipo. El rechazo del
 *  intake les llegaba, no era el tipo que esperaban, el bridge no cerraba el
 *  socket y el `evaluate` se colgaba hasta el presupuesto del guion: rojo sin
 *  causa. `preguntarPorElCable(ctx, mensaje, { respuesta })` es esa espera
 *  escrita UNA vez, sobre la misma puerta: DEVUELVE el frame `respuesta` con el
 *  `requestId` del mensaje, y LANZA en cuanto el bridge rechaza el frame
 *  (`protocolo`, o un frame ilegible), si el socket se cierra sin contestar, o
 *  al agotar el techo — diciendo en cada caso cuál de las tres. La espera la
 *  escribe el helper, así que el agujero de «una espera que no espera» no le
 *  alcanza.
 *
 *  Los sockets de este módulo llevan `__qaCable` con su id: un guion que espía
 *  `window.WebSocket` para contar lo que manda EL JUEGO (el 85) los reconoce
 *  por ahí y no los mezcla con los del cliente.
 *
 *  Los slots son propios (`window.__qaCables`): no toca `__qaTileSocket` ni
 *  `__qaTileRechazos`, que son de `pedirYEsperarTile`.
 *
 *  Lo que se puede probar sin navegador —el socket falso que contesta, el
 *  ilegible, la frase, que no se cierra antes de tiempo, que un fallo de la
 *  espera no se pierde— lo prueba `nefan-core/test/cable-de-qa.test.ts`; que el
 *  unicast real llegue por aquí lo ejercen el 60 y el 63 con su negativo
 *  (`reason:"nope"`), medido en su cabecera. Todo cliente WS del banco está en
 *  `data/contract/clientes-ws-del-banco.json` con cómo escucha, y éste entra
 *  como `todo`.
 *
 *  QUÉ CUENTA COMO RECHAZO no se decide aquí (#739): lo decide `leerFrame` de
 *  `rechazo-del-bridge.mjs`, la misma función que leen `pedirYEsperarTile` y
 *  el cliente de Node (`bridge-desde-node.mjs`). Llega a la página como texto,
 *  porque el oyente vive dentro de `evaluate`. Lo que sí es de aquí es la
 *  POLÍTICA: qué rechazos paran la espera (`RECHAZOS_QUE_PARAN`). */
import { FUENTE_DE_LEER_FRAME } from "./rechazo-del-bridge.mjs";

/** Abre un socket de la página, manda `mensaje` y lo deja ABIERTO recogiendo lo
 *  que el bridge le conteste. PRIVADA: ver la cabecera.
 *
 *  Con `respuesta` (`{ type, requestId }`) guarda además el PRIMER frame de ese
 *  tipo con ese `requestId`, y avisa a quien espere (`avisa`) cada vez que pasa
 *  algo que puede acabar la espera: un error, la respuesta o el cierre. Sin
 *  ella es la puerta de siempre de `porElCable`. `url` sustituye a la del
 *  juego (un guion que levanta su propio bridge). */
async function abrirYMandar(ctx, mensaje, respuesta = null, url = null) {
  return ctx.page.evaluate(
    ([msg, esperada, urlPedida, fuenteDeLeer]) =>
      new Promise((res, rej) => {
        // «El bridge rechazó» se define UNA vez (`rechazo-del-bridge.mjs`) y
        // llega aquí como TEXTO: la página no ve un `import`.
        const leer = new Function(`return (${fuenteDeLeer})`)();
        const url = urlPedida ?? window.__nefan.servicios()["game-gateway"];
        const cables = (window.__qaCables ??= { n: 0, abiertos: {} });
        const id = `cable-${++cables.n}`;
        const ws = new WebSocket(url);
        // La marca con la que un espía de `window.WebSocket` sabe que este
        // socket es del banco y no del juego (ver la cabecera).
        ws.__qaCable = id;
        const rechazos = [];
        const cable = { ws, rechazos, respuesta: null, cerrado: false, avisa: null };
        cables.abiertos[id] = cable;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onclose = () => {
          cable.cerrado = true;
          cable.avisa?.();
        };
        // Lo que el bridge conteste A ESTE SOCKET: el unicast del intake y, si
        // el frame suscribe (start/resume_session), también las difusiones.
        // Lo ilegible sale de `leer` como rechazo `ilegible`: se APUNTA, no se
        // descarta.
        ws.onmessage = (ev) => {
          const { frame: m, rechazo } = leer(ev.data);
          if (rechazo) {
            rechazos.push(rechazo);
          } else if (
            esperada &&
            cable.respuesta === null &&
            m &&
            m.type === esperada.type &&
            m.requestId === esperada.requestId
          ) {
            cable.respuesta = m;
          } else {
            return;
          }
          cable.avisa?.();
        };
        ws.onopen = () => {
          ws.send(JSON.stringify(msg));
          res(id);
        };
      }),
    [mensaje, respuesta, url, FUENTE_DE_LEER_FRAME],
  );
}

/** Los `kind` de rechazo que ACABAN la espera de `preguntarPorElCable`: el del
 *  intake, que solo va por unicast al que mandó el frame, y lo ilegible, que
 *  podría ser la propia respuesta. Los demás (`tile`, `scene`…) llegan por
 *  difusión a un cable suscrito y no son de este frame: se apuntan y se dicen
 *  si la espera expira, pero no la paran. */
const RECHAZOS_QUE_PARAN = ["protocolo", "ilegible"];

/** Espera, DENTRO de la página y sin sondear, a que el cable `id` tenga su
 *  respuesta, un rechazo que para, se cierre, o pasen `techoMs`. Devuelve la
 *  foto `{ motivo, respuesta, rechazos }`; decidir qué hacer con ella es de
 *  `preguntarPorElCable`. PRIVADA. */
async function esperarRespuesta(ctx, id, techoMs) {
  return ctx.page.evaluate(
    ([cableId, techo, paran]) =>
      new Promise((res, rej) => {
        const cable = window.__qaCables?.abiertos?.[cableId];
        if (!cable) {
          rej(new Error(`no hay ningún cable «${cableId}» abierto en esta página`));
          return;
        }
        const foto = (motivo) => ({ motivo, respuesta: cable.respuesta, rechazos: cable.rechazos.slice() });
        const mira = () => {
          if (cable.rechazos.some((r) => paran.includes(r.kind))) return "rechazo";
          if (cable.respuesta !== null) return "respuesta";
          if (cable.cerrado) return "cerrado";
          return null;
        };
        const ya = mira();
        if (ya) {
          res(foto(ya));
          return;
        }
        const reloj = setTimeout(() => {
          cable.avisa = null;
          res(foto("techo"));
        }, techo);
        cable.avisa = () => {
          const motivo = mira();
          if (!motivo) return;
          clearTimeout(reloj);
          cable.avisa = null;
          res(foto(motivo));
        };
      }),
    [id, techoMs, RECHAZOS_QUE_PARAN],
  );
}

/** Cierra el cable `id` y devuelve sus rechazos. PRIVADA: ver la cabecera.
 *
 *  LANZA si el cable no existe en la página: un cable que se pierde por una
 *  recarga entre el `mandar` y el `cerrar` es un guion que mide sobre otra
 *  página, y eso no se colapsa con «sin rechazos». */
async function cerrar(ctx, id) {
  return ctx.page.evaluate((cableId) => {
    const cable = window.__qaCables?.abiertos?.[cableId];
    if (!cable) throw new Error(`no hay ningún cable «${cableId}» abierto en esta página`);
    delete window.__qaCables.abiertos[cableId];
    cable.ws.close();
    return cable.rechazos;
  }, id);
}

/** Manda `mensaje` por un socket nuevo de la página, corre `espera(id)` con el
 *  socket ABIERTO, lo cierra y devuelve `{ resultado, rechazos }`.
 *
 *  `espera` es OBLIGATORIA y recibe el `id` del cable: un predicado de
 *  `ctx.waitFor` que quiera parar en cuanto haya rechazo —en vez de quemar su
 *  presupuesto esperando una consecuencia que ya no va a llegar— mira
 *  `window.__qaCables.abiertos[id].rechazos` desde la página; desde Node se
 *  pregunta con `rechazosDelCable`, y `porRondasHastaRechazo` ya lo hace.
 *
 *  Si `espera` LANZA, el fallo se propaga tal cual —no se lo traga nadie—, pero
 *  con la frase de los rechazos AÑADIDA a su mensaje: un `waitFor` que expira
 *  mientras el bridge había rechazado el frame tiene que decir las dos cosas.
 *  Y si además falla el cierre, el fallo original manda y el del cierre se
 *  añade: un `finally` que lanza encima de otra excepción la ENMASCARA, que es
 *  cómo se pierde el error que importaba. */
export async function porElCable(ctx, mensaje, espera) {
  return conElCable(ctx, mensaje, espera, null, null);
}

/** El cuerpo de `porElCable`, con la respuesta que guardar y la URL. PRIVADA:
 *  lo que se exporta son las dos formas de usarlo. */
async function conElCable(ctx, mensaje, espera, respuesta, url) {
  if (typeof espera !== "function") {
    throw new Error(
      "porElCable: la espera es OBLIGATORIA y es una función `(id) => …` — es lo que impide cerrar el " +
        `cable antes de que el rechazo del bridge tenga tiempo de llegar (#678), y llegó ${JSON.stringify(espera)}`,
    );
  }
  const id = await abrirYMandar(ctx, mensaje, respuesta, url);
  let resultado;
  let fallo = null;
  try {
    resultado = await espera(id);
  } catch (e) {
    fallo = e instanceof Error ? e : new Error(String(e));
  }
  let rechazos = null;
  let fallaElCierre = null;
  try {
    rechazos = await cerrar(ctx, id);
  } catch (e) {
    fallaElCierre = e instanceof Error ? e : new Error(String(e));
  }
  if (fallo) {
    fallo.message = fallaElCierre
      ? `${fallo.message} · y al cerrar el cable: ${fallaElCierre.message}`
      : `${fallo.message} · ${fraseDeRechazos(rechazos)}`;
    throw fallo;
  }
  if (fallaElCierre) throw fallaElCierre;
  return { resultado, rechazos };
}

/** Manda `mensaje` y espera SU respuesta: el primer frame de tipo `respuesta`
 *  con el mismo `requestId` que el mensaje. Lo DEVUELVE entero.
 *
 *  LANZA, y el mensaje dice cuál de las cuatro:
 *   · el bridge RECHAZÓ el frame (`protocolo`, o un frame ilegible): en cuanto
 *     llega, no al acabar el techo — es el ✘ inmediato de #694;
 *   · el socket se cerró sin contestar (lo que antes hacía el `onclose → rej`
 *     de cada copia);
 *   · se agotó `techoMs` sin respuesta ni rechazo, con los errores de otros
 *     `kind` que sí llegaron, que no paran la espera pero son pista;
 *   · o la llamada está mal hecha: sin `respuesta`, o un mensaje sin
 *     `requestId`. La correlación NO es opcional: un cable que manda
 *     `start_session` recibe difusiones, y casar solo por tipo leería el
 *     `session_started` de otro.
 *
 *  `url` sustituye a la del juego, para quien habla con un bridge propio. */
export async function preguntarPorElCable(ctx, mensaje, { respuesta, techoMs = 30_000, url = null } = {}) {
  if (typeof respuesta !== "string" || respuesta === "") {
    throw new Error(
      `preguntarPorElCable: \`respuesta\` es el TIPO del frame que se espera (\`"session_started"\`…) y llegó ${JSON.stringify(respuesta)}`,
    );
  }
  const requestId = mensaje?.requestId;
  if (typeof requestId !== "string" || requestId === "") {
    throw new Error(
      `preguntarPorElCable: el mensaje necesita \`requestId\` para casar su \`${respuesta}\` — sin él, un cable suscrito ` +
        `leería la respuesta de otro. Llegó ${JSON.stringify(mensaje)?.slice(0, 200)}`,
    );
  }
  const quien = `\`${mensaje.type}\` (${requestId}) esperando \`${respuesta}\``;
  const { resultado: foto } = await conElCable(
    ctx,
    mensaje,
    (id) => esperarRespuesta(ctx, id, techoMs),
    { type: respuesta, requestId },
    url,
  );
  if (foto.motivo === "respuesta") return foto.respuesta;
  if (foto.motivo === "rechazo") {
    const paran = foto.rechazos.filter((r) => RECHAZOS_QUE_PARAN.includes(r.kind));
    throw new Error(`${quien}: ${fraseDeRechazos(paran)}`);
  }
  const vistos = foto.rechazos.length ? ` · de paso llegaron otros errores: ${fraseDeRechazos(foto.rechazos)}` : "";
  if (foto.motivo === "cerrado") throw new Error(`${quien}: el bridge cerró el cable sin contestar${vistos}`);
  throw new Error(`${quien}: sin respuesta ni rechazo en ${techoMs / 1000} s${vistos}`);
}

/** Un `resume_session` crudo por el cable del bridge, DESDE la página (la URL
 *  la da el propio juego con sus overrides de query), y lo que contestó:
 *  `{ ok, error }` del `session_started` de ese `requestId`, con `error` a ""
 *  si no trae. Es la receta que tenían copiada ocho guiones (46, 62, 67, 73,
 *  76, 111, 113 y 126), cada uno con su `requestId`; lanza en los mismos casos
 *  que `preguntarPorElCable`, del que es una forma.
 *
 *  `requestId` es OBLIGATORIO y lo pone el guion: es por donde se casa la
 *  respuesta y por donde se lee en el log del bridge quién la pidió. */
export async function reanudarPorElCable(ctx, sessionId, requestId) {
  if (typeof requestId !== "string" || requestId === "") {
    throw new Error(
      `reanudarPorElCable: el \`requestId\` lo pone el guion (\`"qa-46"\`…) y llegó ${JSON.stringify(requestId)}`,
    );
  }
  const m = await preguntarPorElCable(
    ctx,
    { type: "resume_session", sessionId, requestId },
    { respuesta: "session_started" },
  );
  return { ok: m.ok, error: m.error ?? "" };
}

/** Los rechazos que lleva recogidos el cable `id`, SIN cerrarlo. Es la segunda
 *  salida para quien espera fuera de la página (en disco, por ejemplo) y no
 *  puede mirarlos desde un predicado. */
export async function rechazosDelCable(ctx, id) {
  return ctx.page.evaluate((cableId) => {
    const cable = window.__qaCables?.abiertos?.[cableId];
    if (!cable) throw new Error(`no hay ningún cable «${cableId}» abierto en esta página`);
    return cable.rechazos.slice();
  }, id);
}

/** Corre `ronda()` una y otra vez hasta que devuelva algo truthy, hasta que el
 *  bridge rechace el frame, o hasta agotar `techoMs`. Es la segunda salida del
 *  60 para quien espera FUERA de la página: sin ella, un frame rechazado en los
 *  primeros milisegundos se paga igual con el presupuesto entero.
 *
 *  Devuelve `{valor}`, `{rechazos}` o `{}` (se agotó el techo). Cada `ronda`
 *  pone su propio límite: aquí no hay reloj de espera, solo el techo que corta.
 */
export async function porRondasHastaRechazo(ctx, id, ronda, techoMs) {
  const t0 = Date.now();
  do {
    const valor = await ronda();
    if (valor) return { valor };
    const rechazos = await rechazosDelCable(ctx, id);
    if (rechazos.length) return { rechazos };
  } while (Date.now() - t0 < techoMs);
  return {};
}

/** El texto que va dentro del ⊘ o del ✘: qué dijo el bridge del frame. PURA.
 *
 *  Con la lista vacía NO afirma que el bridge aceptara el frame —desde aquí
 *  solo se sabe que no lo rechazó por este socket—, y con rechazos los nombra
 *  todos con su `kind`, que es lo que distingue «el servidor no reconoce el
 *  mensaje» (`protocolo`) de cualquier otro error que llegara por el mismo
 *  canal. Con `null` dice que no se pudieron leer, que no es lo mismo que
 *  ninguno. */
export function fraseDeRechazos(rechazos) {
  if (rechazos === null) return "no se pudo leer si el bridge rechazó el frame: el cable no se pudo cerrar";
  if (!Array.isArray(rechazos)) {
    throw new Error(`fraseDeRechazos: se esperaba la lista de rechazos del cable y llegó ${JSON.stringify(rechazos)}`);
  }
  if (rechazos.length === 0) return "el bridge no rechazó el frame por este socket";
  const cada = rechazos.map((r) => `(${r.kind ?? "sin kind"}): ${r.message}`);
  return rechazos.length === 1
    ? `el bridge RECHAZÓ el frame ${cada[0]}`
    : `el bridge RECHAZÓ el frame ${rechazos.length} veces — ${cada.join(" · ")}`;
}
