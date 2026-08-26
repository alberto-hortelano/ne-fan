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
 *  El bloque 3 es el criterio 5 EN VIVO: con la partida aún provisional —el
 *  mundo ya pintado y el jugador todavía sin vestir— la tecla `H` pide
 *  `resume_session` de una partida que aún no está en disco. El bridge
 *  contesta `session_not_found`, y antes de esta tanda eso vaciaba
 *  `ctx.activePlugins` ANTES del load fallido: la partida viva se quedaba sin
 *  sistemas de juego para el motor el resto de la sesión. Se mide donde se ve,
 *  que es el catálogo que el bridge le ofrece al motor (`GET /plugins`).
 *
 *  Ninguna de las tres esperas es un reloj: el 404 sale al instante, la
 *  retención de las hojas se suelta cuando el guion ha terminado su bloque, y
 *  el sondeo del disco vive en `qa/lib/saves.mjs` (`esperarPartidaEnDisco`),
 *  que es donde la regla `qa-guiones-sin-espera-por-reloj` manda ponerlo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, listarSaves } from "../lib/saves.mjs";

const API = "http://127.0.0.1:9878";

/** Los sistemas de juego que el bridge tiene ACTIVOS para el motor. Es lo que
 *  se pierde si un resume fallido los vacía, y NO se ve en el save: el slice
 *  sigue escrito; lo que desaparece es el catálogo vivo. */
async function pluginsActivos() {
  const res = await fetch(`${API}/plugins`);
  const body = await res.json().catch(() => null);
  return (body?.plugins ?? []).map((p) => p.name ?? p.id).sort();
}

/** Instala el espía del ack ANTES de que cargue la app (se re-instala en cada
 *  navegación, así que cada bloque empieza con la cuenta a cero). No toca el
 *  juego: envuelve `WebSocket.prototype.send` y deja pasar el frame. */
async function espiarElAck(ctx) {
  await ctx.page.addInitScript(() => {
    window.__qaAcks = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        if (typeof data === "string" && data.includes("session_entered")) {
          const m = JSON.parse(data);
          if (m?.type === "session_entered") window.__qaAcks.push(m.sessionId);
        }
      } catch {
        /* un frame que no es JSON no es el ack */
      }
      return send.call(this, data);
    };
  });
}

async function acks(ctx) {
  return ctx.page.evaluate(() => window.__qaAcks ?? []);
}

/** ¿Llegó a existir la partida? Envuelve la espera por condición de `qa/lib`
 *  para poder AFIRMAR sobre las dos respuestas, que aquí las dos son un dato. */
async function llegaAExistir(ctx, sessionId, maxMs = 30_000) {
  return esperarPartidaEnDisco(ctx, sessionId, maxMs)
    .then(() => true)
    .catch(() => false);
}

/** Recarga y espera al título listo (los tres bloques empiezan igual). */
async function volverAlTituloRecargando(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
}

/** Pulsa «Comenzar» sin esperar al desenlace: cada bloque espera lo suyo. */
async function pulsarComenzar(ctx) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");
}

export default async function (ctx) {
  await espiarElAck(ctx);

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
  await volverAlTituloRecargando(ctx);

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

  // El tile del motor puede llegar DESPUÉS de abandonar la partida: se espera
  // a que el bridge lo haya servido para no medir el disco antes de que el
  // camino peligroso se haya recorrido entero. Si no llega, se sigue igual —
  // lo que se afirma es sobre `saves/`, no sobre el tile.
  const tilesTrasFallar = await ctx
    .waitFor(
      "el tile del bootstrap llega (aunque sea tarde)",
      () => {
        const t = window.__nefan.tiles;
        return t.length > 0 ? t : null;
      },
      20_000,
    )
    .catch(() => []);
  const sesionTrasFallar = (await ctx.nefan("sesion")).sessionId;
  ctx.log(
    `tras volver al título: tiles en el mundo = ${JSON.stringify(tilesTrasFallar)} · ` +
      `sesión aplicada = ${JSON.stringify(sesionTrasFallar)}`,
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
  await volverAlTituloRecargando(ctx);

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

  // ── 3 · La ventana provisional existe, y la tecla `H` no la desarma ──────
  // Se abre la ventana reteniendo las HOJAS del personaje (no el mundo): el
  // tile llega y se pinta, el vestido se queda esperando y el título sigue
  // delante. Es el mismo borde del bloque 1 —un recurso que tarda— pero sin
  // fallar, y se suelta por ESTADO: cuando el guion ha hecho lo suyo, no
  // cuando pasa un tiempo.
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
    await volverAlTituloRecargando(ctx);
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

    const enLaVentana = await listarSaves(ctx);
    ctx.expect(
      "con el mundo pintado y el jugador sin vestir, la partida TODAVÍA no existe en disco",
      !enLaVentana.ids.includes(ventana.sessionId),
      `${JSON.stringify(enLaVentana.ids)} contiene ${ventana.sessionId}`,
    );

    const pluginsAntes = await pluginsActivos();
    ctx.log(`sistemas de juego activos antes de la tecla H: ${JSON.stringify(pluginsAntes)}`);

    // La tecla H, por el camino del jugador (el listener vive en `window`).
    await ctx.page.keyboard.press("h");
    const libro = await ctx.waitFor(
      "el libro de historia se abre y dice algo",
      () => {
        const panel = document.getElementById("history-browser");
        if (!panel || panel.hidden) return null;
        const nota = panel.querySelector(".hb-note");
        const texto = (nota?.textContent ?? "").trim();
        return texto && texto !== "Cargando…"
          ? { texto, error: nota.classList.contains("hb-note--error") }
          : null;
      },
      30_000,
    );
    ctx.log(`libro con la partida aún provisional: ${JSON.stringify(libro)}`);
    // …y CUÁNTOS PÍXELES ocupa. En esta variante de la ventana provisional el
    // título sigue delante, y con el título delante `#game-ui` mide cero
    // (guion 18, #246): el libro se abre pero no se VE, así que el mensaje
    // amable que traduce `session_not_found` solo lo lee quien llega a la otra
    // variante —vestido y sin mundo (#189)—, donde el título ya se fue. Va
    // como `ctx.log` y no como aserto porque es un hallazgo abierto de QA
    // (2026-08-26), igual que nació el del guion 24.
    const seVe = await ctx.page.evaluate(() => {
      const panel = document.getElementById("history-browser");
      const ui = document.getElementById("game-ui");
      const r = panel?.getBoundingClientRect();
      const ru = ui?.getBoundingClientRect();
      return {
        libroPx: r ? Math.round(r.width * r.height) : null,
        gameUiPx: ru ? Math.round(ru.width * ru.height) : null,
        tituloDelante: document.documentElement.dataset.titulo === "1",
      };
    });
    ctx.log(`…y lo que el JUGADOR ve de él: ${JSON.stringify(seVe)}`);
    await ctx.shot("libro-durante-la-ventana-provisional");
    ctx.expect(
      "…y lo que dice se entiende sin saber qué es un `session_not_found`",
      !/session_not_found/i.test(libro.texto),
      libro.texto,
    );

    const pluginsDespues = await pluginsActivos();
    ctx.log(`sistemas de juego activos después de la tecla H: ${JSON.stringify(pluginsDespues)}`);
    ctx.expect(
      "abrir el libro con la partida aún provisional NO deja la sesión viva sin sistemas de juego",
      pluginsDespues.length > 0 && pluginsDespues.join("|") === pluginsAntes.join("|"),
      `antes ${JSON.stringify(pluginsAntes)} · después ${JSON.stringify(pluginsDespues)}`,
    );

    // Se suelta la retención: el jugador termina de vestirse y la partida se
    // establece. Si la tecla H hubiera roto algo, aquí se vería.
    soltarLasHojas();
    const arrancada3 = await ctx.waitFor(
      "tras el libro, la partida termina de arrancar igual",
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
    const pluginsFinal = await pluginsActivos();
    ctx.expect(
      "…con los sistemas de juego intactos para el motor",
      pluginsFinal.join("|") === pluginsAntes.join("|"),
      `antes ${JSON.stringify(pluginsAntes)} · al final ${JSON.stringify(pluginsFinal)}`,
    );
  } finally {
    soltarLasHojas();
    await ctx.page.unroute("**/sprites/**", retenerLasHojas).catch(() => null);
  }
}
