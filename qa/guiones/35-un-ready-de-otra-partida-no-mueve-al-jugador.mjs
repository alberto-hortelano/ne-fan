/** #312. Un `narrative_status` de una partida MUERTA llega a la viva, y hasta
 *  esta tanda se aplicaba entero.
 *
 *  LO QUE SE MIDE, y por qué hace falta un guion y no un test. El sello viaja
 *  en el status desde #282 pero el cliente no lo miraba: un `phase:"ready"`
 *  con `spawn` escribía `playerPos.x/z` (`main.ts`, «Spawn PEDIDO por el
 *  bridge»). No es «desbloquear la interfaz»: es **teletransportar al jugador
 *  de la partida que se está jugando**. El cuerpo del issue pedía EJERCERLO
 *  antes de decidir nada, y `nefan-html` no tiene harness (#241), así que la
 *  única forma de ejercerlo es el navegador de verdad.
 *
 *  CÓMO ENTRA EL MENSAJE. Por donde entra el del bridge y no por una puerta
 *  inventada: `bridge-client.ts` asigna `this.ws.onmessage`, así que el guion
 *  envuelve `window.WebSocket` en `addInitScript` —el patrón del espía del
 *  guion 29, que envuelve `send`— para quedarse con la instancia, y luego la
 *  llama con `sock.onmessage({data})`. No se toca ni una línea de producción
 *  para poder medir: el seam es el que ya existe.
 *
 *  TODO ES SÍNCRONO, así que aquí no se espera por nada. `emit` recorre sus
 *  handlers en el mismo turno, el switch del embudo también y la escritura de
 *  `playerPos` también: la posición de después se lee en el mismo `evaluate`
 *  que hace la entrega. Un `waitFor` aquí sería un reloj disfrazado.
 *
 *  EL CONTROL NO ES OPCIONAL (bloque 3). «El jugador no se movió» y «el frame
 *  no llegó» son el mismo verde: sin un `ready` PROPIO que sí lo mueva, este
 *  guion pasaría igual con el socket desconectado. El bloque 3 va el último
 *  porque es el único que deja al jugador en otro sitio.
 *
 *  MEDIDO EN ROJO ANTES DE ARREGLAR NADA: sobre el árbol sin el reparto de
 *  `repartirStatus`, el bloque 1 falla (el jugador se teletransporta) y el
 *  bloque 2 pasa (el fallo ajeno ya llegaba, que es la mitad que había que
 *  conservar). La salida está pegada en el informe de implementación.
 *
 *  TODO ASERTO DE AQUÍ TIENE QUE PODER PONERSE ROJO, y dos no podían. QA los
 *  cazó en la primera versión:
 *    · «no retira el overlay» comparaba `"" === ""` porque el loader ya estaba
 *      cerrado — verde incluso con el bug puesto. Ahora el bloque 1 ABRE el
 *      overlay por el camino del juego (un `generating` propio) antes de
 *      entregar lo ajeno, así que el `hideLoader()` que teme sí tiene algo que
 *      cerrar.
 *    · «el error tampoco mueve al jugador» era infalsificable por
 *      construcción: un `phase:"error"` no lleva `spawn` y la escritura de
 *      `playerPos` exige `ready` + `spawn`. Borrado.
 *  Un aserto que no puede fallar no acompaña: infla el recuento y hace creer
 *  que algo está cubierto.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";

/** La sesión que NO se está jugando. Un id imposible de confundir con uno
 *  real, para que un fallo diga en su detalle de dónde salió. */
const LA_MUERTA = "sesion-muerta-de-otro-arranque";

/** Se queda con la instancia de WebSocket que crea el cliente, sin tocarla:
 *  el constructor se envuelve, se guarda el socket y se devuelve tal cual.
 *  Hay que instalarlo ANTES de que cargue la app, y se reinstala en cada
 *  navegación. */
async function quedarseConElSocket(ctx) {
  await ctx.page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__qaSockets = [];
    const Envuelto = function (...args) {
      const sock = new Original(...args);
      window.__qaSockets.push(sock);
      return sock;
    };
    Envuelto.prototype = Original.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Envuelto[k] = Original[k];
    window.WebSocket = Envuelto;
  });
}

/** Entrega un frame al cliente por el mismo `onmessage` que usa el bridge, y
 *  devuelve la foto de ANTES y DESPUÉS en el mismo turno síncrono.
 *
 *  Elige el socket del BRIDGE y no «el último»: el cliente abre más de uno a
 *  lo largo de una partida (reintentos, el pulso de otros guiones), y entregar
 *  por uno que ya nadie escucha daría un verde que solo dice que no llegó. Se
 *  reconoce por tener `onmessage` puesto — `bridge-client.ts` es quien lo
 *  asigna. Si no hay ninguno, se lanza: un guion que no puede entregar tiene
 *  que caerse, no pasar. */
async function entregar(ctx, frame) {
  return ctx.page.evaluate((f) => {
    const vivos = (window.__qaSockets ?? []).filter(
      (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
    );
    if (vivos.length === 0) {
      throw new Error(
        `ningún socket con onmessage: hay ${(window.__qaSockets ?? []).length} sockets espiados`,
      );
    }
    const sock = vivos[vivos.length - 1];
    const foto = () => ({
      pos: { ...window.__nefan.state().pos },
      descartados: window.__nefan.descartados(),
      errores: [...document.querySelectorAll("#error-log .error-log__msg")].map(
        (e) => e.textContent ?? "",
      ),
      overlay: document.getElementById("narrative-loader")?.className ?? "",
    });
    const antes = foto();
    sock.onmessage({ data: JSON.stringify(f) });
    return { antes, despues: foto(), sockets: vivos.length };
  }, frame);
}

/** El frame exacto del issue: el `ready` que trae el punto de aparición. */
const readyConSpawn = (sessionId, spawn) => ({
  type: "narrative_status",
  sessionId,
  phase: "ready",
  kind: "scene",
  message: "El lugar está listo.",
  placeId: "la-forja",
  spawn,
});

export default async function (ctx) {
  await quedarseConElSocket(ctx);
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const partida = await comenzar(ctx);
  ctx.log(`la partida viva es ${partida.sessionId}`);

  // ── 1 · El `ready` de la partida muerta NO mueve al jugador ──────────────
  // El destino se calcula desde donde está: así el aserto no depende de dónde
  // aparezca el jugador en el tile inicial, que lo decide el motor.
  const dondeEsta = await ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
  const destinoAjeno = { x: Math.round(dondeEsta.x) + 17.25, z: Math.round(dondeEsta.z) + 17.25 };
  ctx.log(`el jugador está en ${JSON.stringify(dondeEsta)}; el spawn ajeno pide ${JSON.stringify(destinoAjeno)}`);

  // EL OVERLAY SE ABRE PRIMERO, y no es decorado: sin él, «el ready ajeno no
  // retira el loader» comparaba `"" === ""` y salía VERDE CON EL BUG PUESTO —
  // lo cazó QA en la corrida donde el jugador se teletransportaba 17 m. Se
  // abre por el camino del juego (un `generating` de MI sesión, que es lo que
  // hace `showLoader`), no tocando el DOM: así lo que se mide después es lo
  // que le pasa a quien está esperando de verdad.
  const conOverlay = await entregar(ctx, {
    type: "narrative_status",
    sessionId: partida.sessionId,
    phase: "generating",
    kind: "scene",
    message: "El motor narrativo está construyendo el mundo.",
  });
  ctx.log(`tras abrir el overlay con un generating propio: ${JSON.stringify(conOverlay.despues.overlay)}`);
  ctx.expect(
    "el overlay de carga está ABIERTO antes de entregar lo ajeno (si no, no se mide nada)",
    conOverlay.despues.overlay.includes("visible"),
    `#narrative-loader "${conOverlay.antes.overlay}" → "${conOverlay.despues.overlay}"`,
  );

  const ajeno = await entregar(ctx, readyConSpawn(LA_MUERTA, destinoAjeno));
  ctx.log(`tras el ready ajeno: ${JSON.stringify(ajeno)}`);

  ctx.expect(
    "el frame ajeno LLEGA de verdad al cliente (si no, no se mide nada)",
    ajeno.despues.descartados.status > ajeno.antes.descartados.status,
    `descartados.status ${ajeno.antes.descartados.status} → ${ajeno.despues.descartados.status} ` +
      `con ${ajeno.sockets} socket(s) del bridge`,
  );
  ctx.expect(
    "…y el jugador de la partida VIVA no se mueve un milímetro (#312)",
    ajeno.despues.pos.x === ajeno.antes.pos.x && ajeno.despues.pos.z === ajeno.antes.pos.z,
    `${JSON.stringify(ajeno.antes.pos)} → ${JSON.stringify(ajeno.despues.pos)} ` +
      `(el spawn ajeno pedía ${JSON.stringify(destinoAjeno)})`,
  );
  ctx.expect(
    "…y tampoco le retira el overlay al que SÍ está esperando (`hideLoader` del ready ajeno)",
    ajeno.despues.overlay.includes("visible"),
    `#narrative-loader "${ajeno.antes.overlay}" → "${ajeno.despues.overlay}"`,
  );

  // Se cierra por donde se abrió —un `ready` propio, sin `spawn`— para que el
  // bloque siguiente mida sobre el mismo estado de pantalla de siempre.
  const cerrado = await entregar(ctx, {
    type: "narrative_status",
    sessionId: partida.sessionId,
    phase: "ready",
    kind: "scene",
    message: "Listo.",
  });
  ctx.log(`overlay tras el ready propio: ${JSON.stringify(cerrado.despues.overlay)}`);

  // ── 2 · Un ERROR de esa misma partida muerta SÍ llega a quien juega ──────
  // La otra mitad del criterio, y la razón por la que este embudo no filtraba
  // nada: descartar el status ajeno entero silenciaría un fallo del motor. Se
  // conserva porque se reparte en canales, no porque se filtre menos.
  const fallo = await entregar(ctx, {
    type: "narrative_status",
    sessionId: LA_MUERTA,
    phase: "error",
    kind: "tile",
    message: "El motor narrativo no pudo construirlo; inténtalo de nuevo.",
  });
  const nuevas = fallo.despues.errores.filter((m) => !fallo.antes.errores.includes(m));
  ctx.log(`entradas nuevas del registro: ${JSON.stringify(nuevas)}`);
  ctx.expect(
    "un `error` de la sesión muerta SIGUE llegando al registro de errores (fail-loud)",
    fallo.despues.errores.length > fallo.antes.errores.length,
    `${fallo.antes.errores.length} → ${fallo.despues.errores.length} entradas`,
  );
  ctx.expect(
    "…con el motivo que el motor mandó, no un genérico",
    nuevas.some((m) => m.includes("no pudo construirlo")),
    JSON.stringify(nuevas),
  );
  await ctx.shot("tras-el-status-de-la-partida-muerta");

  // ── 3 · CONTROL: el `ready` de LA partida sí mueve al jugador ────────────
  // Sin esto, los dos bloques de arriba pasarían igual con el canal roto. Va
  // el último porque es el único que deja al jugador en otro sitio.
  const destinoPropio = { x: Math.round(dondeEsta.x) + 3.25, z: Math.round(dondeEsta.z) + 3.25 };
  const propio = await entregar(ctx, readyConSpawn(partida.sessionId, destinoPropio));
  ctx.log(`tras el ready PROPIO: ${JSON.stringify(propio)}`);
  ctx.expect(
    "el `ready` de LA partida sí coloca al jugador donde el bridge lo pide (el canal funciona)",
    propio.despues.pos.x === destinoPropio.x && propio.despues.pos.z === destinoPropio.z,
    `${JSON.stringify(propio.antes.pos)} → ${JSON.stringify(propio.despues.pos)}, ` +
      `pedía ${JSON.stringify(destinoPropio)}`,
  );
  ctx.expect(
    "…y no lo cuenta como descartado: lo suyo no se tira",
    propio.despues.descartados.status === propio.antes.descartados.status,
    `descartados.status ${propio.antes.descartados.status} → ${propio.despues.descartados.status}`,
  );
  await ctx.shot("el-ready-propio-si-coloca-al-jugador");
}
