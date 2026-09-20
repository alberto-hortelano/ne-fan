/** UN FRAME POR EL CABLE DEL JUEGO SIN CERRAR LA BOCA POR LA QUE VUELVE EL
 *  RECHAZO (#678).
 *
 *  El bridge contesta un frame que no pasa el contrato por UNICAST, al socket
 *  que lo mandó (`bridge/ws-server.ts`, `narrative_status` con `phase:"error"`
 *  y `kind:"protocolo"`); y `escribir` calla si ese socket ya no está abierto.
 *  Así que el cliente del banco que abre un socket, manda y cierra en el mismo
 *  tick —lo que hacían el 60 y el 63 con su `setTimeout(() => ws.close(), 0)`—
 *  no pierde el color: pierde la CAUSA. El 63 declaraba ⊘ «el tile no llegó al
 *  save» y el 60 ✘ «timeout esperando tile listo», y el único rastro del rechazo
 *  era el `console.error` del bridge, que el runner solo enseña con
 *  `QA_VERBOSE`. Es #656 en su forma general: aquel arreglo (`pedirYEsperarTile`,
 *  `qa/lib/sesion.mjs`) es para quien espera el tile en el ledger del CLIENTE;
 *  esto es para quien manda un frame y espera su consecuencia por OTRO canal
 *  (el save en disco, el HUD) y aun así quiere saber si el bridge lo rechazó.
 *
 *  La forma: `mandarPorElCable` abre un segundo socket DESDE LA PÁGINA (la URL
 *  la da el propio juego, como en `saves.mjs`, así hereda su `?bridge=`), manda
 *  el frame y DEJA EL SOCKET ABIERTO apuntando todo lo que el bridge le conteste
 *  a él. Ese socket no manda `subscribe`, así que no está en la lista de
 *  difusión del bridge y lo único que puede recibir es el unicast. Quien lo
 *  abrió lo cierra con `cerrarElCable` cuando su espera acabe —en un `finally`,
 *  que un socket abierto por guion acumula clientes en el bridge durante toda la
 *  corrida— y recibe los rechazos, que `fraseDeRechazos` convierte en el texto
 *  que va dentro del ⊘ o del ✘.
 *
 *  Los slots son propios (`window.__qaCables`): no toca `__qaTileSocket` ni
 *  `__qaTileRechazos`, que son de `pedirYEsperarTile`.
 *
 *  Lo que se puede probar sin navegador —el socket falso que contesta, el
 *  ilegible, la frase— lo prueba `nefan-core/test/cable-de-qa.test.ts`; que el
 *  unicast real llegue por aquí lo ejercen el 60 y el 63 con su negativo
 *  (`reason:"nope"`), medido en su cabecera. Todo cliente WS del banco está en
 *  `data/contract/clientes-ws-del-banco.json` con cómo escucha, y éste entra
 *  como `todo`. */

/** Manda `mensaje` por un socket nuevo de la página y devuelve el `id` del
 *  cable, que queda ABIERTO recogiendo lo que el bridge conteste a ese socket.
 *
 *  `window.__qaCables[id].rechazos` es la lista viva: un predicado de
 *  `ctx.waitFor` que quiera parar en cuanto haya rechazo, en vez de quemar su
 *  presupuesto esperando una consecuencia que ya no va a llegar, la mira ahí. */
export async function mandarPorElCable(ctx, mensaje) {
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

/** Cierra el cable `id` y devuelve sus rechazos (una lista, vacía si el bridge
 *  no contestó nada a ese socket). LANZA si el cable no existe en la página:
 *  un cable que se pierde por una recarga entre el `mandar` y el `cerrar` es un
 *  guion que mide sobre otra página, y eso no se colapsa con «sin rechazos». */
export async function cerrarElCable(ctx, id) {
  return ctx.page.evaluate((cableId) => {
    const cable = window.__qaCables?.abiertos?.[cableId];
    if (!cable) throw new Error(`no hay ningún cable «${cableId}» abierto en esta página`);
    delete window.__qaCables.abiertos[cableId];
    cable.ws.close();
    return cable.rechazos;
  }, id);
}

/** El texto que va dentro del ⊘ o del ✘: qué dijo el bridge del frame. PURA.
 *
 *  Con la lista vacía NO afirma que el bridge aceptara el frame —desde aquí
 *  solo se sabe que no lo rechazó por este socket—, y con rechazos los nombra
 *  todos con su `kind`, que es lo que distingue «el servidor no reconoce el
 *  mensaje» (`protocolo`) de cualquier otro error que llegara por el mismo
 *  canal. */
export function fraseDeRechazos(rechazos) {
  if (!Array.isArray(rechazos)) {
    throw new Error(`fraseDeRechazos: se esperaba la lista de rechazos del cable y llegó ${JSON.stringify(rechazos)}`);
  }
  if (rechazos.length === 0) return "el bridge no rechazó el frame por este socket";
  const cada = rechazos.map((r) => `(${r.kind ?? "sin kind"}): ${r.message}`);
  return rechazos.length === 1
    ? `el bridge RECHAZÓ el frame ${cada[0]}`
    : `el bridge RECHAZÓ el frame ${rechazos.length} veces — ${cada.join(" · ")}`;
}
