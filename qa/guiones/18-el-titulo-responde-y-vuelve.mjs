/** Los primeros segundos de partida: el título RESPONDE y se puede VOLVER a él.
 *
 *  Dos bugs de la misma pantalla, los dos invisibles desde dentro del juego
 *  porque ninguno cambia una respuesta ni lanza una excepción:
 *
 *   · #181 — «Nueva partida» se pintaba de una tacada en el `innerHTML` y solo
 *     se le colgaba el handler DESPUÉS de `await listSessions()`. Entre las dos
 *     cosas el botón existía, se dejaba pulsar y el click NO HACÍA NADA: 151 ms
 *     en el caso feliz y hasta los 30 s del timeout de request si el bridge
 *     tardaba en contestar. Este guion es además el que quita la venda: el
 *     harness (`qa/lib/sesion.mjs`) esperaba a que el texto de `#ts-status`
 *     delatara que el handler ya estaba puesto, así que los trece guiones que
 *     arrancan partida ESQUIVABAN el bug en vez de ejercerlo.
 *
 *   · #189 — cualquier fallo de sesión ocultaba el título en un `finally`, y
 *     `runTitleFlow` se llamaba UNA sola vez: el jugador se quedaba en una
 *     pantalla sin nada que pulsar y la única salida era recargar.
 *
 *  DOS ASERTOS SALIERON DE AQUÍ (QA 2026-08-24), porque los dos pasaban con su
 *  bug puesto y un verde que no puede ponerse rojo es peor que no tener guion:
 *
 *   · #181-c «el botón NO se mueve cuando llega la lista» medía
 *     `rect(#ts-new).top − rect(padre).top`, y el padre es justo el bloque que
 *     se desplaza: daba 97 px → 97 px con el botón moviéndose 119 px bajo el
 *     cursor. Lo mide ahora, en coordenadas de VIEWPORT, el bloque 2 de
 *     `19-el-titulo-arranca-de-verdad.mjs`.
 *   · «el título de vuelta está VIVO» pulsaba `#ts-new`, un listener del DOM
 *     que sobrevive a todo, y no llegaba a «Comenzar», que es lo único que lee
 *     `this.resolve` — lo único que puede quedar muerto. Probado: con `show()`
 *     sin rearmar su promesa, este guion pasaba entero. Lo canda ahora el
 *     bloque 3 del 19, que ARRANCA una partida desde el título de vuelta.
 *
 *  El repro de #189 que traía el issue («arranca sin bridge y pulsa Nueva
 *  partida») es FALSO y por eso no se usa aquí: sin bridge no se sale del
 *  título, así que aquel `finally` no llegaba a ejecutarse nunca. El camino
 *  que sí lo alcanza es un fallo de sesión con el bridge ARRIBA, y se produce
 *  borrando el save por el cable del propio bridge mientras el título sigue
 *  enseñando su tarjeta: «Reanudar» se encuentra un `session_not_found`.
 *
 *  Probado en NEGATIVO (ver el informe de implementación): devolviendo el
 *  `addEventListener` del botón detrás del `await listSessions()` —y nada
 *  más— el bloque 1 se pone rojo por timeout esperando el selector de mundos.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import {
  borrarSaveComoOtroCliente,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
  nuevaPartida,
} from "../lib/sesion.mjs";

export const aisla = ["saves"];

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

const GAME_ID = "alta_fantasia";

/** El espía: se instala ANTES de que corra el cliente y vigila el DOM. En
 *  cuanto aparece `#ts-new` anota qué decía el status en ese instante y —si la
 *  URL trae `qa18=click`— lo PULSA.
 *
 *  El callback de un MutationObserver corre en la microtarea siguiente al
 *  bloque síncrono que hizo la mutación: exactamente el primer momento en que
 *  el botón existe para el mundo exterior. Si el handler se cuelga después de
 *  un `await`, ahí todavía no está.
 *
 *  Ya NO mide dónde nace el botón: esa medida vive en el guion 19, y en
 *  coordenadas de viewport (ver la cabecera). */
function instalarEspia(page) {
  return page.addInitScript(() => {
    const querClicar = new URLSearchParams(location.search).get("qa18") === "click";
    window.__qa18 = { visto: false, status: null };
    const obs = new MutationObserver(() => {
      const btn = document.getElementById("ts-new");
      if (!btn || window.__qa18.visto) return;
      window.__qa18.status = document.getElementById("ts-status")?.textContent ?? "(sin #ts-status)";
      window.__qa18.visto = true;
      obs.disconnect();
      if (querClicar) btn.click();
    });
    // Sobre `document` y no sobre `documentElement`: el init script corre
    // ANTES que cualquier script de la página, y ahí `documentElement`
    // todavía puede ser null.
    obs.observe(document, { childList: true, subtree: true });
  });
}

/** Recarga la página con un parámetro extra, conservando los que trae el
 *  runner (`?input=scripted&ai=…&raf=timer`). */
async function recargar(ctx, extra = {}) {
  const url = new URL(ctx.page.url());
  // `qa18` se limpia SIEMPRE antes de aplicar lo que pida esta recarga: la URL
  // sale de la página anterior y arrastraría el `qa18=click` de la vuelta
  // pasada, con el espía pulsando cuando esta vez solo tenía que mirar.
  url.searchParams.delete("qa18");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
}

export default async function (ctx) {
  // ── 0. Una partida de verdad, para que el título tenga algo que listar ──
  // El fallo de sesión del bloque 2 se produce borrando ESE save por el cable
  // del bridge: sin una tarjeta que pulsar no hay «Reanudar» que falle.
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);
  ctx.log("partida sembrada: el título tendrá una tarjeta que listar");

  // ── 1. #181-a — el botón escucha desde el primer pintado ────────────────
  await instalarEspia(ctx.page);
  await recargar(ctx, { qa18: "click" });

  const espiado = await ctx.waitFor(
    "el espía ve aparecer #ts-new y lo pulsa en ese instante",
    () => (window.__qa18?.visto ? window.__qa18 : null),
    30_000,
  );
  ctx.log(`al pulsar: status="${espiado.status}"`);

  // NO CONCLUYENTE antes que verde: si el espía llegó tarde —después de que
  // volviera `listSessions`— el click habría registrado por la razón
  // equivocada y este guion no estaría probando nada. El status que pinta
  // `renderHome` justo antes del `await` es la marca de agua de ese instante.
  ctx.expect(
    "el click cae DENTRO de la ventana muerta (si no, el guion no prueba nada)",
    /^Cargando saves/.test(espiado.status ?? ""),
    `status en el instante del click: "${espiado.status}" — se esperaba "Cargando saves…"`,
  );

  let respondio = true;
  try {
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  } catch {
    respondio = false;
  }
  ctx.expect(
    "pulsar «Nueva partida» en su primer pintado abre el selector de mundos",
    respondio,
    "el click no hizo nada: el botón estaba pintado pero todavía no escuchaba (#181)",
  );
  await ctx.shot("el-primer-click-abre-el-selector");
  if (!respondio) return;

  // ── 2. #189 — un fallo de sesión devuelve al título con el motivo ───────
  // Volver al home: el bloque 1 dejó la página en el selector de mundos, y el
  // save que hay que sabotear se lee de su tarjeta. La espera por la LISTA es
  // de quien va a LEERLA (no gatea ningún click, que era el workaround).
  await recargar(ctx); // sin `qa18=click`: el espía solo mira
  await esperarListaDeSaves(ctx);
  // La MARCA DE AGUA del cliente sin partida: recién recargado, el título
  // arriba y nada aplicado. Es contra esto contra lo que se compara la vuelta
  // — «los dos caminos de vuelta al título dejan el cliente idéntico» (#249).
  const antesDelIntento = await leerCliente(ctx);
  ctx.log(`cliente en el título: ${JSON.stringify(antesDelIntento)}`);
  const sessionId = await ctx.page.$eval(
    'button[data-action="resume"]',
    (b) => b.dataset.sessionId,
  );
  ctx.log(`save a sabotear: ${sessionId}`);
  // El repro real: el save desaparece del disco mientras el título sigue
  // enseñando su tarjeta. Va por WS y no por el botón «Borrar», que abre un
  // confirm() y bloquearía el navegador.
  await borrarSaveComoOtroCliente(ctx, sessionId);

  await ctx.page.click(`button[data-action="resume"][data-session-id="${sessionId}"]`);

  const trasElFallo = await ctx.waitFor(
    "el título vuelve con el motivo del fallo escrito",
    () => {
      const err = document.getElementById("ts-error");
      const texto = err?.textContent?.trim() ?? "";
      if (!texto) return null;
      const raiz = document.getElementById("title-screen");
      return {
        texto,
        visible: raiz !== null && getComputedStyle(raiz).display !== "none",
        registro: [...document.querySelectorAll("#error-log .error-log__entry")].map((e) => ({
          fuente: e.querySelector(".error-log__source")?.textContent ?? "",
          msg: e.querySelector(".error-log__msg")?.textContent ?? "",
        })),
      };
    },
    30_000,
  );
  await ctx.shot("de-vuelta-en-el-titulo-con-el-motivo");
  ctx.log(`#ts-error: ${trasElFallo.texto}`);

  ctx.expect(
    "tras el fallo de sesión el jugador está OTRA VEZ en el título",
    trasElFallo.visible,
    "el título quedó oculto: el jugador se queda en una pantalla sin nada que pulsar (#189)",
  );
  // El motivo, y EN CRISTIANO. Aquí se leía «No se pudo reanudar la partida:
  // session_not_found»: la primera mitad escrita para el jugador y la segunda
  // para el programador. El código sigue entero en el `detail` de la entrada
  // del error-log, que es donde sirve.
  ctx.expect(
    "…y el título dice qué ha pasado sin enseñarle el código del bridge",
    /reanudar/i.test(trasElFallo.texto) &&
      /ya no está/i.test(trasElFallo.texto) &&
      !/session_not_found/.test(trasElFallo.texto),
    trasElFallo.texto,
  );
  ctx.expect(
    "…y queda registrado en el log de errores con la fuente `session`",
    trasElFallo.registro.some((e) => e.fuente === "session"),
    JSON.stringify(trasElFallo.registro.slice(0, 3)),
  );

  // ── 3. #249 — la vuelta no deja media sesión pegada ─────────────────────
  // El catch del bucle deshacía UNA de las cinco cosas que aplica el éxito
  // (`activeSessionId`), y se dejaba puestas el estilo, el tema, los modos de
  // render y la sesión del libro de historia. La peor de todas es el gate del
  // gasto: con él armado, el tile que el bridge difunde DESPUÉS del fallo
  // paga un atlas con el estilo de la partida que no arrancó.
  const despuesDelFallo = await leerCliente(ctx);
  ctx.log(`cliente tras el fallo: ${JSON.stringify(despuesDelFallo)}`);
  ctx.expect(
    "volver al título deja el cliente COMO ESTABA: ni sesión, ni estilo, ni modos, ni tema",
    JSON.stringify(despuesDelFallo.sesion) === JSON.stringify(antesDelIntento.sesion),
    `${JSON.stringify(antesDelIntento.sesion)} → ${JSON.stringify(despuesDelFallo.sesion)}`,
  );
  ctx.expect(
    "…y no ha pagado ni una imagen por el camino",
    despuesDelFallo.imagenes === antesDelIntento.imagenes,
    `caché ${antesDelIntento.imagenes} → ${despuesDelFallo.imagenes}`,
  );

  // ── 4. #246 — el HUD no se lee por debajo del título ─────────────────────
  // El overlay del título es traslúcido: con la partida pintando detrás se
  // leían fantasmas de la barra de acciones y del panel de errores entre su
  // texto, al lado del botón de cerrar. Se mide la CAJA, no el CSS.
  ctx.expect(
    "con el título arriba, el HUD de juego no ocupa ni un píxel",
    despuesDelFallo.cajas.gameUi === 0,
    `#game-ui: ${despuesDelFallo.cajas.gameUi} px²`,
  );
  ctx.expect(
    "…ni el panel de errores, que se leía justo al lado del botón de cerrar",
    despuesDelFallo.cajas.errorLog === 0,
    `#error-log: ${despuesDelFallo.cajas.errorLog} px²`,
  );
  // Y el panel de dev SÍ sigue: vigila el gasto, y crear mundo o estilo desde
  // el título es justo donde se gasta. Sin esto, «ocultar el HUD» podría
  // haberse hecho tapándolo todo.
  ctx.expect(
    "…pero el panel de dev sigue visible: es el que vigila el gasto",
    despuesDelFallo.cajas.devStatus > 0,
    `#dev-status: ${despuesDelFallo.cajas.devStatus} px²`,
  );
  // Aquí NO se comprueba que el título de vuelta esté vivo: pulsar «Nueva
  // partida» solo ejercita un listener del DOM, que sobrevive a cualquier
  // cosa. Lo que puede quedar muerto es `this.resolve`, y no se lee hasta
  // «Comenzar», dos pantallas más allá. Lo canda el bloque 3 del guion 19,
  // que arranca una partida entera desde este mismo título de vuelta.
}

/** Lo que el cliente tiene APLICADO ahora mismo: las facetas de la sesión, el
 *  contador de imágenes del panel de dev y el tamaño de las cajas que el
 *  título tiene que tapar. Un solo `evaluate` para que las tres medidas sean
 *  del mismo instante. */
function leerCliente(ctx) {
  return ctx.page.evaluate(() => {
    const area = (id) => {
      const el = document.getElementById(id);
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return Math.round(r.width * r.height);
    };
    return {
      sesion: window.__nefan.sesion(),
      // "caché 0✓/1✗ · cliente 2" → la línea entera: cualquier generación
      // nueva la mueve.
      imagenes: document.getElementById("ds-cache")?.textContent ?? "(sin panel)",
      cajas: { gameUi: area("game-ui"), errorLog: area("error-log"), devStatus: area("dev-status") },
    };
  });
}
