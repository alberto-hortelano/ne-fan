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
 *  mensaje, espera)`, que abre, manda, **espera lo que le digas** y cierra él.
 *  No se puede cerrar antes de recoger porque no hay `cerrar` que llamar, y no
 *  se puede mandar sin esperar porque la espera es un argumento obligatorio.
 *  Lo que queda fuera —una `espera` que no espera nada— está declarado como
 *  agujero en `data/contract/clientes-ws-del-banco.json` y medido en el guion
 *  152, porque eso ya se lee en la propia llamada.
 *
 *  La forma: el socket se abre DESDE LA PÁGINA (la URL la da el propio juego,
 *  como en `saves.mjs`, así hereda su `?bridge=`), manda el frame y queda
 *  ABIERTO apuntando todo lo que el bridge le conteste a él mientras corre la
 *  espera. Ese socket no manda `subscribe`, así que no está en la lista de
 *  difusión del bridge y lo único que puede recibir es el unicast. Al acabar
 *  la espera —bien o mal— se cierra y se devuelven los rechazos, que
 *  `fraseDeRechazos` convierte en el texto que va dentro del ⊘ o del ✘.
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
 *  como `todo`. */

/** Abre un socket de la página, manda `mensaje` y lo deja ABIERTO recogiendo lo
 *  que el bridge le conteste. PRIVADA: ver la cabecera. */
async function abrirYMandar(ctx, mensaje) {
  return ctx.page.evaluate(
    (msg) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const cables = (window.__qaCables ??= { n: 0, abiertos: {} });
        const id = `cable-${++cables.n}`;
        const ws = new WebSocket(url);
        const rechazos = [];
        cables.abiertos[id] = { ws, rechazos };
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        // Lo que el bridge conteste A ESTE SOCKET. Solo puede ser unicast: este
        // socket no manda `subscribe`, así que no está en `narrativeSubscribers`
        // y no recibe difusiones.
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data);
            if (m && m.type === "narrative_status" && m.phase === "error") {
              rechazos.push({ kind: m.kind ?? null, message: m.message ?? "sin mensaje" });
            }
          } catch (e) {
            // Fail-loud: lo ilegible se APUNTA como rechazo, no se descarta —
            // un frame que no se puede leer es exactamente el dato que hace
            // falta cuando la consecuencia no llega.
            rechazos.push({ kind: "ilegible", message: `${String(e)} — ${String(ev.data).slice(0, 200)}` });
          }
        };
        ws.onopen = () => {
          ws.send(JSON.stringify(msg));
          res(id);
        };
      }),
    mensaje,
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
  if (typeof espera !== "function") {
    throw new Error(
      "porElCable: la espera es OBLIGATORIA y es una función `(id) => …` — es lo que impide cerrar el " +
        `cable antes de que el rechazo del bridge tenga tiempo de llegar (#678), y llegó ${JSON.stringify(espera)}`,
    );
  }
  const id = await abrirYMandar(ctx, mensaje);
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
