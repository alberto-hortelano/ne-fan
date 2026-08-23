/** Los primeros segundos de partida: el título RESPONDE y se puede VOLVER a él.
 *
 *  Tres bugs de la misma pantalla, y los tres invisibles desde dentro del
 *  juego porque ninguno cambia una respuesta ni lanza una excepción:
 *
 *   · #181 — «Nueva partida» se pintaba de una tacada en el `innerHTML` y solo
 *     se le colgaba el handler DESPUÉS de `await listSessions()`. Entre las dos
 *     cosas el botón existía, se dejaba pulsar y el click NO HACÍA NADA: 151 ms
 *     en el caso feliz y hasta los 30 s del timeout de request si el bridge
 *     tardaba en contestar. Este guion es además el que quita la venda: el
 *     harness (`qa/lib/sesion.mjs`) esperaba a que el texto de `#ts-status`
 *     delatara que el handler ya estaba puesto, así que los quince guiones que
 *     arrancan partida ESQUIVABAN el bug en vez de ejercerlo.
 *
 *   · #181-c — y al llegar la lista de saves, `#ts-sessions` se repintaba
 *     ENCIMA del botón y lo empujaba hacia abajo tantos píxeles como partidas
 *     hubiera. Un botón que se mueve bajo el cursor mientras lo pulsas es la
 *     otra mitad del mismo «no ha pasado nada».
 *
 *   · #189 — cualquier fallo de sesión ocultaba el título en un `finally`, y
 *     `runTitleFlow` se llamaba UNA sola vez: el jugador se quedaba en una
 *     pantalla sin nada que pulsar y la única salida era recargar.
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

const GAME_ID = "alta_fantasia";

/** El espía: se instala ANTES de que corra el cliente y vigila el DOM. En
 *  cuanto aparece `#ts-new` anota dónde nació y qué decía el status, y —si la
 *  URL trae `qa18=click`— lo PULSA en ese mismo instante.
 *
 *  El callback de un MutationObserver corre en la microtarea siguiente al
 *  bloque síncrono que hizo la mutación: exactamente el primer momento en que
 *  el botón existe para el mundo exterior. Si el handler se cuelga después de
 *  un `await`, ahí todavía no está. */
function instalarEspia(page) {
  return page.addInitScript(() => {
    const querClicar = new URLSearchParams(location.search).get("qa18") === "click";
    window.__qa18 = { visto: false, status: null, offset: null };
    const obs = new MutationObserver(() => {
      const btn = document.getElementById("ts-new");
      if (!btn || window.__qa18.visto) return;
      const padre = btn.parentElement;
      // Offset relativo AL PADRE a propósito: el panel de dev reescribe el
      // padding superior del título con un ResizeObserver, así que medir
      // contra el viewport mezclaría dos movimientos distintos.
      window.__qa18.offset = Math.round(
        btn.getBoundingClientRect().top - padre.getBoundingClientRect().top,
      );
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
  // #181-c solo se ve con la lista NO vacía: sin saves no hay nada que empuje
  // al botón, y el guion aprobaría el bug por falta de sujeto.
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
  ctx.log(`al pulsar: status="${espiado.status}" · offset=${espiado.offset}px`);

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

  // ── 2. #181-c — el botón no se desplaza al llegar la lista de saves ─────
  await recargar(ctx); // sin `qa18=click`: el espía solo mira
  const alPintar = await ctx.waitFor(
    "el espía mide dónde nace el botón",
    () => (window.__qa18?.visto ? window.__qa18 : null),
    30_000,
  );
  const textoLista = await esperarListaDeSaves(ctx);
  const conLaLista = await ctx.page.evaluate(() => {
    const btn = document.getElementById("ts-new");
    const padre = btn.parentElement;
    return {
      offset: Math.round(btn.getBoundingClientRect().top - padre.getBoundingClientRect().top),
      partidas: document.querySelectorAll('button[data-action="resume"]').length,
    };
  });
  ctx.log(`«${textoLista}» · offset ${alPintar.offset}px → ${conLaLista.offset}px con ${conLaLista.partidas} partida(s)`);
  ctx.expect(
    "hay al menos una partida listada (si no, nada podría empujar al botón)",
    conLaLista.partidas >= 1,
    `${conLaLista.partidas} tarjetas de save`,
  );
  ctx.expect(
    "el botón NO se mueve cuando llega la lista de partidas",
    alPintar.offset === conLaLista.offset,
    `${alPintar.offset}px → ${conLaLista.offset}px: el botón se desplaza bajo el cursor`,
  );
  await ctx.shot("el-boton-no-se-mueve");

  // ── 3. #189 — un fallo de sesión devuelve al título, y VIVO ─────────────
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
  ctx.expect(
    "…y el título dice qué ha pasado, con el motivo",
    /reanudar/i.test(trasElFallo.texto) && /session_not_found/.test(trasElFallo.texto),
    trasElFallo.texto,
  );
  ctx.expect(
    "…y queda registrado en el log de errores con la fuente `session`",
    trasElFallo.registro.some((e) => e.fuente === "session"),
    JSON.stringify(trasElFallo.registro.slice(0, 3)),
  );

  // Lo que separa «el título se ve» de «el título FUNCIONA», que es la trampa
  // que tenía este arreglo: bastaba con no ocultarlo para que la pantalla
  // volviera, pero su promesa ya estaba consumida y el siguiente «Comenzar»
  // no resolvía a nadie. Se comprueba pulsando.
  await ctx.page.click("#ts-new");
  let vivo = true;
  try {
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  } catch {
    vivo = false;
  }
  ctx.expect(
    "el título de vuelta está VIVO: «Nueva partida» sigue abriendo el selector",
    vivo,
    "el título se ve pero no responde — visible y muerto",
  );
  await ctx.shot("el-titulo-de-vuelta-sigue-vivo");
}
