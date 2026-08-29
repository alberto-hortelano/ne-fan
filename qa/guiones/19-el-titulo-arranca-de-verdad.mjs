/** Los primeros segundos del cliente, por donde el guion 18 no llega.
 *
 *  El 18 canda tres cosas y las canda bien: que el botón escuche desde su
 *  primer pintado, que la lista de saves no lo empuje DENTRO de su bloque y
 *  que un fallo de sesión devuelva al título con el motivo escrito. Este
 *  guion cubre los cuatro huecos que quedan, y los cuatro se descubrieron
 *  probando el 18 en negativo:
 *
 *   1. **`show()` arma su `resolve` antes de pintar.** El 18 pulsa «Nueva
 *      partida» dentro de la ventana de carga de saves, pero se para en el
 *      selector de mundos. Quien puede quedar sin armar es `this.resolve`,
 *      que no se lee hasta «Comenzar», dos pantallas más allá. Con el orden
 *      viejo (`resolve` después del `await renderHome()`) el bloque 1 se pone
 *      rojo y el 18 sigue verde.
 *
 *   2. **El botón no se desplaza BAJO EL CURSOR.** El 18 mide el offset
 *      relativo al bloque de contenido, y ahí no se mueve. El cursor del
 *      jugador no vive en coordenadas del bloque: vive en el viewport, y
 *      `#title-screen` centra su contenido verticalmente, así que la lista
 *      que crece POR DEBAJO del botón sube el bloque entero —y el botón con
 *      él— la mitad de lo que crece.
 *
 *   3. **«El título de vuelta está VIVO» hasta el final.** El 18 lo afirma
 *      pulsando «Nueva partida» y mirando que se abra el selector; ese click
 *      va contra un listener del DOM que sobrevive a cualquier cosa. Lo que
 *      distingue un título vivo de uno visible-y-muerto es si «Comenzar»
 *      resuelve a alguien. Probado: dejando el `resolve` sin rearmar entre
 *      vueltas del bucle, el 18 sigue en verde entero.
 *
 *   4. **El click no es mudo cuando el bridge no contesta** (#181-b). El plan
 *      lo pedía con el bridge caído, y así es inalcanzable: sin bridge el
 *      título ni siquiera se abre (`createGameClient` rechaza y
 *      `runTitleFlow` no llega a llamarse). El estado que sí se da es el
 *      bridge VIVO que no contesta, que es además el techo real de la ventana
 *      que describe #181: los 30 s del timeout de `bridge-client.ts`.
 *
 *  INSTRUMENTACIÓN, no estado sintético: los bloques 1 y 4 envuelven el
 *  `WebSocket` de la página para RETRASAR la respuesta de `list_sessions` y
 *  para no ENVIAR el `list_games`. Las dos cosas emulan un bridge lento —el
 *  estado que el propio issue describe— sin tocar el bridge de verdad, que es
 *  el mismo para toda la batería. No se oculta ningún obstáculo: se produce
 *  uno que el jugador puede tener.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import {
  asentarElLayout,
  borrarSaveComoOtroCliente,
  comenzar,
  espiarElPrimerPintado,
  esperarElPrimerPintado,
  esperarListaDeSaves,
  esperarTituloListo,
  nuevaPartida,
} from "../lib/sesion.mjs";

export const aisla = ["saves"];

const GAME_ID = "alta_fantasia";
/** Cuánto se hace esperar la lista de saves en el bloque 1. Tiene que dar
 *  para recorrer mundo → personajes → Continuar → Comenzar; el techo real de
 *  esa ventana en producción son los 30 s del timeout de request. */
const RETRASO_MS = 20_000;

/** Dónde está el botón, en las DOS referencias: el bloque de contenido (donde
 *  el guion 18 ya lo mide) y el VIEWPORT, que es donde vive el cursor de quien
 *  juega. La misma función la usa el espía del primer pintado y la medida de
 *  después, así que no pueden divergir. */
function medida() {
  const btn = document.getElementById("ts-new");
  const r = btn.getBoundingClientRect();
  return {
    enElBloque: Math.round(r.top - btn.parentElement.getBoundingClientRect().top),
    enElViewport: Math.round(r.top),
    status: document.getElementById("ts-status")?.textContent ?? "",
  };
}

/** El bridge que TARDA (modo "lento") o que no contesta a `list_games` (modo
 *  "mudo"). Nada más cambia: el socket sigue vivo y el resto de la sesión va
 *  por el cable de siempre. El espía del pintado vive en `qa/lib`. */
function instalarEspia(page) {
  return page.addInitScript(() => {
    const qs = new URLSearchParams(location.search);
    const modo = qs.get("qa19") ?? "";
    if (modo !== "lento" && modo !== "mudo") return;
    const Real = window.WebSocket;
    class Instrumentado extends Real {
      send(datos) {
        if (modo === "mudo" && typeof datos === "string" && datos.includes('"list_games"')) {
          window.__qa19tragado = (window.__qa19tragado ?? 0) + 1;
          return; // el bridge nunca se entera: la petición se queda esperando
        }
        super.send(datos);
      }
      set onmessage(fn) {
        super.onmessage = (ev) => {
          const txt = typeof ev.data === "string" ? ev.data : "";
          if (modo === "lento" && txt.includes('"sessions_listed"')) {
            window.__qa19retrasado = (window.__qa19retrasado ?? 0) + 1;
            setTimeout(() => {
              window.__qa19retrasado -= 1;
              fn(ev);
            }, Number(qs.get("qa19ms") ?? 20000));
            return;
          }
          fn(ev);
        };
      }
      get onmessage() {
        return super.onmessage;
      }
    }
    window.WebSocket = Instrumentado;
  });
}

/** Recarga conservando los parámetros del runner y limpiando SIEMPRE los de
 *  este guion: la URL sale de la página anterior y arrastraría el modo de la
 *  vuelta pasada. */
async function recargar(ctx, extra = {}) {
  const url = new URL(ctx.page.url());
  url.searchParams.delete("qa19");
  url.searchParams.delete("qa19ms");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, String(v));
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
}

/** El tramo del selector, sin el «Comenzar»: mundo → personajes → Continuar. */
async function hastaElBotonDeComenzar(ctx) {
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  await ctx.page.click(`#ts-charmode [data-charmode="vector"]`);
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
}

/** ¿Arranca la partida? Devuelve el id de escena, o null si no llegó. */
async function arranca(ctx, maxMs = 90_000) {
  await ctx.page.click("#ts-start");
  return ctx
    .waitFor(
      "la escena de la sesión llega del bridge",
      () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
      maxMs,
    )
    .catch(() => null);
}

export default async function (ctx) {
  // ── 0. Una partida sembrada: el título tendrá algo que listar ───────────
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);
  ctx.log("partida sembrada");
  await instalarEspia(ctx.page);
  await espiarElPrimerPintado(ctx, medida);

  // ── 1. «Comenzar» DENTRO de la ventana de carga de saves ────────────────
  await recargar(ctx, { qa19: "lento", qa19ms: RETRASO_MS });
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  await hastaElBotonDeComenzar(ctx);
  const enVuelo = await ctx.page.evaluate(() => window.__qa19retrasado ?? 0);
  // NO CONCLUYENTE antes que verde: si la lista ya hubiera llegado, el
  // «Comenzar» caería fuera de la ventana y este bloque no probaría nada.
  ctx.expect(
    "el «Comenzar» cae DENTRO de la ventana de carga de saves (si no, no prueba nada)",
    enVuelo >= 1,
    `respuestas de list_sessions todavía retenidas: ${enVuelo}`,
  );
  const escena1 = await arranca(ctx);
  ctx.expect(
    "arrancar dentro de esa ventana INICIA la partida (show() armó su resolve antes de pintar)",
    Boolean(escena1),
    "«Comenzar» no resolvió a nadie: el jugador se queda mirando el título",
  );
  await ctx.shot("comenzar-dentro-de-la-ventana");

  // ── 2. #181-c: el botón no se mueve BAJO EL CURSOR ──────────────────────
  await recargar(ctx);
  const alNacer = await esperarElPrimerPintado(ctx);
  const textoLista = await esperarListaDeSaves(ctx);
  await asentarElLayout(ctx);
  const conLaLista = {
    // La MISMA función que midió el nacimiento — se serializa a la página.
    ...(await ctx.page.evaluate(medida)),
    ...(await ctx.page.evaluate(() => ({
      partidas: document.querySelectorAll('button[data-action="resume"]').length,
      centrado: getComputedStyle(document.getElementById("title-screen")).justifyContent,
    }))),
  };
  ctx.log(`«${textoLista}» · ${conLaLista.partidas} partida(s) · justify-content=${conLaLista.centrado}`);
  ctx.log(`    en el bloque : ${alNacer.enElBloque}px → ${conLaLista.enElBloque}px`);
  ctx.log(`    en el viewport: ${alNacer.enElViewport}px → ${conLaLista.enElViewport}px`);
  ctx.expect(
    "hay al menos una partida listada (si no, nada podría mover al botón)",
    conLaLista.partidas >= 1,
    `${conLaLista.partidas} tarjetas`,
  );
  ctx.expect(
    "el botón no se desplaza BAJO EL CURSOR al llegar la lista de partidas",
    Math.abs(alNacer.enElViewport - conLaLista.enElViewport) <= 2,
    `${alNacer.enElViewport}px → ${conLaLista.enElViewport}px ` +
      `(${conLaLista.enElViewport - alNacer.enElViewport}px): el contenido del título está ` +
      `centrado verticalmente, así que la lista que crece por debajo sube el botón la mitad de lo que crece`,
  );
  await ctx.shot("el-boton-en-el-viewport");

  // ── 3. Tras un fallo de sesión, el título ARRANCA una partida ───────────
  const sessionId = await ctx.page.$eval(
    'button[data-action="resume"]',
    (b) => b.dataset.sessionId,
  );
  await borrarSaveComoOtroCliente(ctx, sessionId);
  await ctx.page.click(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  const motivo = await ctx.waitFor(
    "el título vuelve con el motivo del fallo",
    () => document.getElementById("ts-error")?.textContent?.trim() || null,
    30_000,
  );
  ctx.log(`#ts-error: ${motivo}`);
  await ctx.page.click("#ts-new");
  await hastaElBotonDeComenzar(ctx);
  const escena3 = await arranca(ctx);
  ctx.expect(
    "el título de vuelta no solo se ve: ARRANCA una partida entera desde «Comenzar»",
    Boolean(escena3),
    "el título está visible pero MUERTO: su promesa se consumió y «Comenzar» no resuelve a nadie",
  );
  await ctx.shot("tras-el-fallo-se-vuelve-a-jugar");

  // ── 4. #181-b: el click no es mudo cuando el bridge no contesta ─────────
  await recargar(ctx, { qa19: "mudo" });
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  const acuse = await ctx.waitFor(
    "el botón acusa recibo del click mientras espera al bridge",
    () => {
      const btn = document.getElementById("ts-new");
      if (!btn) return null;
      return btn.disabled ? { texto: btn.textContent ?? "" } : null;
    },
    10_000,
  ).catch(() => null);
  ctx.expect(
    "pulsar «Nueva partida» tiene acuse de recibo inmediato, aunque el bridge no conteste",
    Boolean(acuse) && /cargando/i.test(acuse.texto),
    JSON.stringify(acuse),
  );
  // Y al vencer el timeout de request (30 s), el fallo NO es mudo.
  const trasElTimeout = await ctx.waitFor(
    "el título dice por qué no pudo abrir el selector",
    () => {
      const texto = document.getElementById("ts-error")?.textContent?.trim() ?? "";
      if (!texto) return null;
      const btn = document.getElementById("ts-new");
      return {
        texto,
        botonTexto: btn?.textContent ?? "",
        botonDeshabilitado: Boolean(btn?.disabled),
        registro: [...document.querySelectorAll("#error-log .error-log__entry")].map(
          (e) => e.querySelector(".error-log__source")?.textContent ?? "",
        ),
      };
    },
    60_000,
  );
  ctx.log(`#ts-error: ${trasElTimeout.texto}`);
  ctx.expect(
    "el click NO es mudo: el motivo se lee en el propio título",
    trasElTimeout.texto.length > 0,
    trasElTimeout.texto,
  );
  ctx.expect(
    "…queda registrado en el log de errores con la fuente `title`",
    trasElTimeout.registro.includes("title"),
    JSON.stringify(trasElTimeout.registro.slice(0, 4)),
  );
  ctx.expect(
    "…y el botón vuelve a su sitio para reintentar, sin recargar",
    /nueva partida/i.test(trasElTimeout.botonTexto) && !trasElTimeout.botonDeshabilitado,
    `"${trasElTimeout.botonTexto}" deshabilitado=${trasElTimeout.botonDeshabilitado}`,
  );
  await ctx.shot("el-click-no-es-mudo");
}
