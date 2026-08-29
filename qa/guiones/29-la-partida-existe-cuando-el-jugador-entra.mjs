/** El ACK que hace existir la partida, medido en los tres estados que tiene
 *  (#279, criterios 1, 2 y 5).
 *
 *  El guion 27 mide el criterio 1 con el 404 de las hojas RETARDADO hasta que
 *  el mundo está pintado, y lo hace por un motivo bueno: solo con ese orden su
 *  aserto puede ponerse rojo si alguien rompe la conjunción. Pero ese NO es el
 *  orden del clon limpio de verdad. Medido el 2026-08-26 por QA, con el 404
 *  contestado al instante —que es lo que hace un dev server con un fichero que
 *  no está— el orden real es
 *      sesión → abandonar → sesión:(ninguna) → addTile(active=false)
 *  o sea: el vestido falla ANTES de que llegue el tile, y lo que impide el
 *  save no es la conjunción sino el reset de la faceta. Los dos órdenes son
 *  alcanzables (dependen de si cargar diez hojas tarda más o menos que un
 *  round-trip por WebSocket), pero el que da nombre al issue es este, y desde
 *  que el 27 cambió no lo recorre nadie. Aquí se recorre.
 *
 *  Y se mide, además, lo que ningún guion medía: el ACK en sí. Que la partida
 *  se escriba cuando el jugador entra es un mecanismo NUEVO del cliente —un
 *  frame `session_entered` que antes no existía—, así que hay dos afirmaciones
 *  que valen por separado:
 *    · un arranque que falla NO manda el ack (bloque 1), y
 *    · un arranque que sale bien lo manda UNA vez y con SU id (bloque 2).
 *  Sin la segunda, un cliente que dejara de mandarlo se vería igual que uno
 *  que lo manda: la partida simplemente no se guardaría nunca, y el rojo
 *  saldría lejos del sitio del fallo.
 *
 *  El bloque 1 mide además #282: el tile que el bridge difunde para la partida
 *  que ya se abandonó LLEGA y el cliente lo descarta, así que el título no se
 *  queda con el mundo de una partida muerta detrás. Se espera al DESCARTE y no
 *  al tile —`__nefan.descartados()`—, porque esperar un tile que ya no se
 *  instala da un verde que solo dice «aún no ha llegado».
 *
 *  El bloque 3 es la ventana provisional —el mundo ya pintado y el jugador
 *  todavía sin vestir, con el título delante— y mide #285: ahí la tecla `H` no
 *  responde. Antes de esta tanda abría el libro dentro de `#game-ui`, que con
 *  el título delante mide cero píxeles (#246), y de paso pedía
 *  `resume_session` de una partida que aún no existe en disco. Se mide un
 *  NO-evento, así que va con control (el mismo espía sí vio el
 *  `start_session`) y con su recíproco (con el título fuera, la misma tecla
 *  abre el libro). Lo que ese `resume_session` fallido no puede hacerle al
 *  bridge —vaciarle los plugins a la partida viva, #279— se canda donde puede
 *  ponerse rojo ahora que la tecla no llega: `test/bridge-session.test.ts`.
 *
 *  Ninguna de las tres esperas es un reloj: el 404 sale al instante, la
 *  retención de las hojas se suelta cuando el guion ha terminado su bloque, y
 *  el sondeo del disco vive en `qa/lib/saves.mjs` (`esperarPartidaEnDisco`),
 *  que es donde la regla `qa-guiones-sin-espera-por-reloj` manda ponerlo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, listarSaves } from "../lib/saves.mjs";

/** Instala el espía de lo que el cliente MANDA, antes de que cargue la app (se
 *  re-instala en cada navegación, así que cada bloque empieza a cero). No toca
 *  el juego: envuelve `WebSocket.prototype.send` y deja pasar el frame.
 *
 *  Anota TODOS los frames y no solo el ack porque el bloque 3 mide un
 *  NO-EVENTO —que la tecla `H` no pida `resume_session`— y eso solo vale algo
 *  con un control al lado: el mismo espía tiene que haber registrado el
 *  `start_session` que sí ocurrió. Sin el control, un espía roto se lee igual
 *  que un cliente que se calla. */
async function espiarLoQueSeManda(ctx) {
  await ctx.page.addInitScript(() => {
    window.__qaFrames = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        if (typeof data === "string") {
          const m = JSON.parse(data);
          if (m?.type) window.__qaFrames.push({ type: m.type, sessionId: m.sessionId ?? "" });
        }
      } catch {
        /* un frame que no es JSON no es del protocolo */
      }
      return send.call(this, data);
    };
  });
}

/** Los tipos de frame mandados, en orden. */
async function mandados(ctx) {
  return ctx.page.evaluate(() => (window.__qaFrames ?? []).map((f) => f.type));
}

/** Los ids con los que se mandó `session_entered` (el ack de #279). */
async function acks(ctx) {
  return ctx.page.evaluate(() =>
    (window.__qaFrames ?? []).filter((f) => f.type === "session_entered").map((f) => f.sessionId),
  );
}

/** ¿Llegó a existir la partida? Envuelve la espera por condición de `qa/lib`
 *  para poder AFIRMAR sobre las dos respuestas, que aquí las dos son un dato. */
async function llegaAExistir(ctx, sessionId, maxMs = 30_000) {
  return esperarPartidaEnDisco(ctx, sessionId, maxMs)
    .then(() => true)
    .catch(() => false);
}

/** Pulsa «Comenzar» sin esperar al desenlace: cada bloque espera lo suyo. */
async function pulsarComenzar(ctx) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");
}

export default async function (ctx) {
  await espiarLoQueSeManda(ctx);

  // ── 1 · El clon limpio DE VERDAD: 404 al instante ────────────────────────
  // `public/sprites/` está en .gitignore, así que quien clona el repo arranca
  // exactamente así y el dev server contesta el 404 sin pensárselo. No se toca
  // nada del lado del juego: la condición se produce en el BORDE.
  const cortarLasHojas = async (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "clon sin hojas (simulado por QA)" }),
    });
  await ctx.page.route("**/sprites/**", cortarLasHojas);
  await recargarAlTitulo(ctx);

  const antes1 = await listarSaves(ctx);
  ctx.log(`saves antes del clon limpio: ${antes1.ids.length} · fuente: ${antes1.fuente}`);

  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await pulsarComenzar(ctx);

  const desenlace1 = await ctx
    .waitFor(
      "el juego resuelve el intento (se juega, o vuelta al título con aviso)",
      () => {
        const enElTitulo = document.documentElement.dataset.titulo === "1";
        const el = document.getElementById("ts-error");
        const texto = (el?.textContent ?? "").trim();
        if (enElTitulo && el && getComputedStyle(el).display !== "none" && texto) return { aviso: texto };
        const scene = window.__nefan.status().scene ? window.__nefan.scene.scene_id : null;
        return !enElTitulo && scene ? { arrancó: scene } : null;
      },
      60_000,
    )
    .catch(() => null);
  ctx.log(`desenlace del clon limpio: ${JSON.stringify(desenlace1)}`);
  ctx.expect(
    "con el 404 INSTANTÁNEO (el clon limpio real) el arranque también vuelve al título",
    Boolean(desenlace1?.aviso),
    JSON.stringify(desenlace1 ?? "(ni escena ni aviso en 60 s)"),
  );

  // #282. El tile del motor llega DESPUÉS de abandonar la partida, y hasta
  // esta tanda se instalaba igual: el mundo de una partida muerta se quedaba
  // pintado detrás del título y el intento siguiente lo heredaba.
  //
  // Se espera al DESCARTE y no al tile, que es la diferencia entre medir y
  // no medir: esperar el tile que ya no va a instalarse deja el aserto en
  // verde por «aún no ha llegado», que es un verde indistinguible de un guion
  // que no comprueba nada. Con el contador, el guion no sigue hasta que el
  // evento ajeno ha llegado DE VERDAD y se ha tirado.
  const descarte = await ctx
    .waitFor(
      "el tile de la partida muerta llega y el cliente lo DESCARTA",
      () => {
        const d = window.__nefan.descartados();
        return d.n >= 1 ? d : null;
      },
      30_000,
    )
    .catch(() => ({ n: 0 }));
  const trasFallar = await ctx.page.evaluate(() => ({
    tiles: window.__nefan.tiles,
    sesion: window.__nefan.sesion().sessionId,
  }));
  ctx.log(
    `tras volver al título: tiles = ${JSON.stringify(trasFallar.tiles)} · ` +
      `sesión aplicada = ${JSON.stringify(trasFallar.sesion)} · ` +
      `descartados = ${JSON.stringify(descarte)}`,
  );
  ctx.expect(
    "el tile que el bridge difunde para la partida muerta LLEGA y se descarta (si no, no se mide nada)",
    descarte.n >= 1,
    JSON.stringify(descarte),
  );
  ctx.expect(
    "…y el mundo del título se queda VACÍO: la partida que no arrancó no deja tiles detrás (#282)",
    trasFallar.tiles.length === 0,
    `quedaron ${JSON.stringify(trasFallar.tiles)} con sesión aplicada ${JSON.stringify(trasFallar.sesion)}`,
  );

  const acks1 = await acks(ctx);
  ctx.log(`acks «session_entered» mandados: ${JSON.stringify(acks1)}`);
  ctx.expect(
    "un arranque que falla no manda el ack que hace existir la partida",
    acks1.length === 0,
    JSON.stringify(acks1),
  );

  const despues1 = await listarSaves(ctx);
  const nuevos1 = despues1.ids.filter((id) => !antes1.ids.includes(id));
  ctx.log(`saves después: ${despues1.ids.length} · nuevos: ${JSON.stringify(nuevos1)}`);
  ctx.expect(
    "…y no deja NINGÚN directorio nuevo en saves/ (el orden del issue, no el construido)",
    nuevos1.length === 0,
    `aparecieron ${JSON.stringify(nuevos1)} (fuente: ${despues1.fuente})`,
  );
  await ctx.shot("clon-limpio-404-instantaneo");

  // ── 2 · El arranque BUENO manda el ack una vez, y con SU id ──────────────
  await ctx.page.unroute("**/sprites/**", cortarLasHojas);
  await recargarAlTitulo(ctx);

  const antes2 = await listarSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await pulsarComenzar(ctx);
  const arrancada = await ctx.waitFor(
    "la partida arranca: el título fuera y la escena dentro",
    () => {
      if (window.__nefan.status().title) return null;
      if (!window.__nefan.status().scene) return null;
      const sessionId = window.__nefan.sesion().sessionId;
      return sessionId ? { sessionId, scene: window.__nefan.scene.scene_id } : null;
    },
    180_000,
  );
  ctx.log(`partida ${arrancada.sessionId} en marcha (${arrancada.scene})`);

  const existe2 = await llegaAExistir(ctx, arrancada.sessionId);
  const acks2 = await acks(ctx);
  ctx.log(`acks del arranque bueno: ${JSON.stringify(acks2)} · antes había ${JSON.stringify(antes2.ids)}`);
  ctx.expect(
    "un arranque que sale bien manda el ack EXACTAMENTE una vez",
    acks2.length === 1,
    JSON.stringify(acks2),
  );
  ctx.expect(
    "…con el id de LA partida que se está jugando (un ack ajeno no la escribiría)",
    acks2[0] === arrancada.sessionId,
    `${JSON.stringify(acks2)} vs. ${arrancada.sessionId}`,
  );
  ctx.expect(
    "…y con eso la partida existe en disco (criterio 2: se guarda como siempre)",
    existe2,
    `${arrancada.sessionId} no apareció en saves/`,
  );

  // ── 3 · La ventana provisional existe, y con el título delante `H` no hace nada ──
  // Se abre la ventana reteniendo las HOJAS del personaje (no el mundo): el
  // tile llega y se pinta, el vestido se queda esperando y el título sigue
  // delante. Es el mismo borde del bloque 1 —un recurso que tarda— pero sin
  // fallar, y se suelta por ESTADO: cuando el guion ha hecho lo suyo, no
  // cuando pasa un tiempo.
  //
  // Lo que se mide aquí es #285: con el título delante, `H` NO responde. Un
  // no-evento no se puede afirmar a solas —el verde sería el mismo si el
  // guion no midiera nada—, así que va con dos anclas: el espía de
  // `WebSocket.send` tiene que NO ver un `resume_session` y SÍ haber visto el
  // `start_session` de hace dos líneas. El aserto puede ponerse rojo: sin la
  // guarda de `alPulsarTecla`, `H` manda el frame y abre el libro.
  //
  // Lo que este bloque YA NO mide, dicho para que no se busque: que un
  // `resume_session` fallido no vacíe `ctx.activePlugins` (#279). Al gatear
  // `H` esa llamada deja de ser alcanzable desde aquí, y afirmarlo igual
  // sería un verde que no comprueba nada. El mecanismo sigue candado donde
  // se puede poner rojo: `nefan-core/test/bridge-session.test.ts`, «un resume
  // que falla NO deja la sesión viva sin plugins».
  let soltarLasHojas = () => {};
  const hojasRetenidas = new Promise((res) => {
    soltarLasHojas = res;
  });
  // El `catch` no es pereza: cuando el guion termina (o falla) se sueltan a la
  // vez todas las peticiones retenidas, y para las que el navegador ya dio por
  // muertas `continue()` lanza «Route is already handled». Sin recogerlo, esa
  // promesa suelta mata el RUNNER ENTERO con un uncaught rejection y el
  // veredicto de los demás guiones se pierde — medido el 2026-08-26.
  const retenerLasHojas = async (route) => {
    await hojasRetenidas;
    await route.continue().catch(() => null);
  };
  await ctx.page.route("**/sprites/**", retenerLasHojas);
  try {
    await recargarAlTitulo(ctx);
    const antes3 = await listarSaves(ctx);
    await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
    await pulsarComenzar(ctx);

    // La ventana: el mundo YA está pintado y el título sigue delante.
    const ventana = await ctx.waitFor(
      "el mundo se pinta mientras el jugador todavía se viste (la ventana provisional)",
      () => {
        const t = window.__nefan.tiles;
        const sessionId = window.__nefan.sesion().sessionId;
        return t.length > 0 && sessionId
          ? { tiles: t, sessionId, titulo: window.__nefan.status().title }
          : null;
      },
      120_000,
    );
    ctx.log(`ventana provisional: ${JSON.stringify(ventana)} · antes había ${JSON.stringify(antes3.ids)}`);
    ctx.expect(
      "en esta ventana el título SIGUE DELANTE (si no, no se está midiendo #285)",
      ventana.titulo === true,
      `status().title = ${JSON.stringify(ventana.titulo)}`,
    );

    const enLaVentana = await listarSaves(ctx);
    ctx.expect(
      "con el mundo pintado y el jugador sin vestir, la partida TODAVÍA no existe en disco",
      !enLaVentana.ids.includes(ventana.sessionId),
      `${JSON.stringify(enLaVentana.ids)} contiene ${ventana.sessionId}`,
    );

    // La tecla H, por el camino del jugador (el listener vive en `window`).
    const antesDeLaH = await mandados(ctx);
    await ctx.page.keyboard.press("h");
    // No hace falta esperar a nada: el manejador de `H` corre SÍNCRONO con el
    // `keydown`, y `HistoryBrowser.show()` manda su `resume_session` antes de
    // su primer `await`. Para cuando `keyboard.press` ha vuelto, el frame o se
    // mandó o no se va a mandar. Aquí hubo un «pulso» —un socket propio al
    // bridge para esperar un round-trip— que además se tragaba su `onerror`:
    // con el bridge muerto se leía como pulso completado, o sea catorce líneas
    // que no podían ponerse rojas esperando algo que ya había ocurrido.
    const despuesDeLaH = await mandados(ctx);
    const nuevos = despuesDeLaH.slice(antesDeLaH.length);
    const libro = await ctx.page.evaluate(() => {
      const panel = document.getElementById("history-browser");
      const r = panel?.getBoundingClientRect();
      return {
        existe: Boolean(panel),
        oculto: panel?.hidden ?? null,
        px: r ? Math.round(r.width * r.height) : null,
        tituloDelante: document.documentElement.dataset.titulo === "1",
      };
    });
    ctx.log(`frames mandados tras la tecla H: ${JSON.stringify(nuevos)}`);
    ctx.log(`el libro tras la tecla H: ${JSON.stringify(libro)}`);
    await ctx.shot("la-tecla-h-con-el-titulo-delante");

    // CONTROL, obligatorio: el espía funciona. Sin esto, un espía roto se lee
    // exactamente igual que un cliente que se calla.
    ctx.expect(
      "el espía de frames SÍ registró el `start_session` de este arranque (control del no-evento)",
      antesDeLaH.includes("start_session"),
      JSON.stringify(antesDeLaH),
    );
    ctx.expect(
      "con el título delante, la tecla H no pide `resume_session` al bridge (#285)",
      !nuevos.includes("resume_session"),
      JSON.stringify(nuevos),
    );
    ctx.expect(
      "…y el libro de historia sigue cerrado, en vez de abrirse midiendo cero píxeles",
      libro.oculto === true,
      JSON.stringify(libro),
    );

    // Se suelta la retención: el jugador termina de vestirse y la partida se
    // establece. Si la puerta de teclado hubiera roto algo, aquí se vería.
    soltarLasHojas();
    const arrancada3 = await ctx.waitFor(
      "tras la tecla ignorada, la partida termina de arrancar igual",
      () => {
        if (window.__nefan.status().title) return null;
        const sessionId = window.__nefan.sesion().sessionId;
        return sessionId ? { sessionId } : null;
      },
      120_000,
    );
    const existe3 = await llegaAExistir(ctx, arrancada3.sessionId);
    ctx.expect(
      "…y entonces sí existe en disco: la ventana era una ESPERA, no un agujero",
      existe3,
      `${arrancada3.sessionId} no llegó a existir`,
    );

    // Y con el título FUERA la tecla vuelve a servir: la puerta cierra durante
    // el título, no para siempre. Sin esto, «H no responde» y «H está rota»
    // serían el mismo verde.
    await ctx.page.keyboard.press("h");
    const libroAbierto = await ctx
      .waitFor(
        "ya en la partida, la tecla H abre el libro",
        () => {
          const panel = document.getElementById("history-browser");
          return panel && !panel.hidden ? { abierto: true } : null;
        },
        30_000,
      )
      .catch(() => null);
    ctx.expect(
      "…y con el título fuera la MISMA tecla abre el libro (la puerta cierra durante el título, no siempre)",
      Boolean(libroAbierto),
      "H dejó de funcionar también en partida: la puerta se tragó una tecla legítima",
    );
  } finally {
    soltarLasHojas();
    await ctx.page.unroute("**/sprites/**", retenerLasHojas).catch(() => null);
  }
}
