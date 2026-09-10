/** Tras aplicar el estilo, un fallo de navegación NO invita a pagar otra vez.
 *
 *  #548. El panel de «Aplicar estilo» (`ui/titulo/plan-de-estilo.ts`) es la
 *  única pantalla del juego donde el jugador acepta gastar dinero real. Su
 *  handler metía el GASTO y la NAVEGACIÓN dentro del mismo `try`, así que un
 *  fallo al volver al selector entraba por el `catch` de un batch que YA HABÍA
 *  OCURRIDO: borraba el «Estilo aplicado ($X)» y volvía a encender «Aplicar
 *  estilo (~$X)». Nada en pantalla decía que eso estaba pagado hacía diez
 *  segundos.
 *
 *  LO QUE ESTE GUION NO MIDE, dicho para que nadie lo cuente de más: si el
 *  servidor cobraría dos veces. No lo haría —es idempotente por caché, y eso se
 *  verificó en la crítica de #513— y ese no es el defecto. El defecto es lo que
 *  la PANTALLA le dice al jugador, y eso es lo que se afirma aquí.
 *
 *  CÓMO SE ROMPE LA NAVEGACIÓN, sin tocar una línea de cliente: volver al
 *  selector es `pintarSelectorDeMundo`, que empieza `await listGames()` y lanza
 *  si el bridge contesta con error. Por el socket YA ABIERTO se le reescribe al
 *  cliente la respuesta `games_listed` para que traiga `error`, y solo a partir
 *  del momento en que el guion lo enciende: el batch corre con el selector sano
 *  y lo que falla es exactamente la vuelta. Es lo que le pasa a quien pierde el
 *  `data/games` (un volumen desmontado) entre que paga y vuelve.
 *
 *  LO QUE AFIRMA:
 *
 *   1 · El comprobante SOBREVIVE: «Estilo aplicado…» sigue en pantalla con su
 *       importe. Es la única prueba que tiene el jugador de lo que pagó.
 *   2 · El botón que cobra NO vuelve: sigue deshabilitado. Sin esto, el
 *       siguiente click es un segundo intento de gasto.
 *   3 · Y se le DICE lo que pasó y qué hacer, en vez de dejarle una pantalla
 *       que parece que no hizo nada.
 *   4 · De paso, la cosmética de #548 que sí se podía cerrar: el botón que
 *       gasta y el que no gasta NO se ven iguales.
 *
 *  EN NEGATIVO (probado al escribirlo, la sonda revertida — ver el informe):
 *  devolviendo la navegación dentro del `try` del gasto, (1) se pone rojo con
 *  el motivo del fallo en el hueco y (2) con `disabled=false`.
 *
 *  CERO CRÉDITOS: motor falso (`e2e-sin-creditos`). El batch corre de verdad
 *  contra el fake, que no cobra; el mundo lo genera este guion, como el 07 y el
 *  97, para que el plan tenga bloques con precio que aplicar.
 */
import { nuevaPartida, regenerarMundo } from "../lib/sesion.mjs";

/** Precondición DECLARADA, las dos por el mismo motivo que el 07 y el 97:
 *   · `mundo`   — el plan deriva su roster del snapshot del mundo; heredar el
 *                 de otro guion es aplicar SU roster.
 *   · `fake-ai` — con la caché del motor falso caliente el plan llega con todos
 *                 sus bloques «en caché ($0)» y no queda nada que aplicar. */
export const aisla = ["mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** Lo que el jugador tiene delante del panel de coste. */
const fotoDelPanel = () => {
  const run = document.getElementById("ts-style-run");
  const cancel = document.getElementById("ts-style-cancel");
  const prog = document.getElementById("ts-style-progress");
  return {
    hayPanel: Boolean(run),
    boton: run?.textContent?.trim() ?? "",
    apagado: run?.disabled ?? null,
    fondo: run ? getComputedStyle(run).backgroundColor : "",
    cancelar: cancel?.disabled ?? null,
    progreso: (prog?.textContent ?? "").trim(),
  };
};

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });

  // ── 4 · el botón que gasta no se ve como el que no gasta ───────────────
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const conCoste = await ctx.page.evaluate(fotoDelPanel);
  ctx.log(`panel: botón «${conCoste.boton}» fondo ${conCoste.fondo}`);
  if (!/Aplicar estilo/.test(conCoste.boton)) {
    ctx.sinMedir(
      `este plan no tiene nada que aplicar (botón «${conCoste.boton}»): sin gasto no hay ` +
        `«ya se pagó» que medir`,
    );
  }
  // Se apagan todas las casillas para leer el botón SIN coste, y se vuelven a
  // encender: la comparación es entre los dos estados del mismo botón, no
  // contra un color escrito aquí.
  const idx = await ctx.page.$$eval("#ts-style-plan input[data-block-idx]:not([disabled])", (cbs) =>
    cbs.map((c) => c.dataset.blockIdx),
  );
  const marcar = (i, on) =>
    ctx.page.evaluate(
      ({ i: n, on: v }) => {
        const cb = document.querySelector(`#ts-style-plan input[data-block-idx="${n}"]`);
        cb.checked = v;
        cb.dispatchEvent(new Event("change"));
      },
      { i, on },
    );
  for (const i of idx) await marcar(i, false);
  const sinCoste = await ctx.page.evaluate(fotoDelPanel);
  ctx.log(`sin coste: botón «${sinCoste.boton}» fondo ${sinCoste.fondo}`);
  ctx.expect(
    "el botón que GASTA y el que no gastan NO se ven iguales (#548)",
    sinCoste.fondo !== conCoste.fondo &&
      /Registrar \(sin coste\)/.test(sinCoste.boton) &&
      /Aplicar estilo/.test(conCoste.boton),
    `con coste «${conCoste.boton}» ${conCoste.fondo} · sin coste «${sinCoste.boton}» ${sinCoste.fondo}`,
  );
  for (const i of idx) await marcar(i, true);
  await ctx.shot("panel-de-coste-el-boton-que-gasta");

  // ── LA VUELTA AL SELECTOR SE ROMPE, y solo a partir de ahora ───────────
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  // El interruptor vive en el RUNNER, como el del bloque 4 del guion 70: así no
  // hay reloj de por medio ni una condición que consultar desde el handler.
  let laVueltaEstaRota = false;
  await ctx.page.routeWebSocket(gateway, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      let msg = null;
      try {
        msg = JSON.parse(String(m));
      } catch {
        msg = null; // una trama que no es JSON no es un games_listed
      }
      if (laVueltaEstaRota && msg && msg.type === "games_listed") {
        ws.send(JSON.stringify({ ...msg, error: "games_dir_unreadable: (inyectado por el banco)" }));
        return;
      }
      ws.send(m);
    });
  });
  // Hay que RECARGAR para que la ruta del socket se aplique: la conexión viva
  // se abrió antes de instalarla. Se rehace el camino hasta el panel.
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const antesDePagar = await ctx.page.evaluate(fotoDelPanel);
  ctx.expect(
    "PRECONDICIÓN — el panel vuelve con algo que aplicar (si no, lo de abajo no mide un gasto)",
    /Aplicar estilo/.test(antesDePagar.boton) && antesDePagar.apagado === false,
    JSON.stringify(antesDePagar),
  );

  // A partir de aquí, `games_listed` vuelve con error: el batch corre entero y
  // lo que falla es la vuelta al selector.
  laVueltaEstaRota = true;
  await ctx.page.click("#ts-style-run");

  // Se espera al DESENLACE, no al reloj: entre el comprobante y la vuelta hay
  // un `setTimeout(1200)` en el cliente, y dormirlo aquí sería el sleep que
  // prohíbe `qa-guiones-sin-espera-por-reloj` (lo puso rojo la primera vez que
  // se escribió). Los tres desenlaces posibles se nombran, para que el guion
  // pare sabiendo cuál salió, y no por agotamiento:
  //   · la nota del fallo de la vuelta   → lo que esta tanda estrena;
  //   · el motivo crudo en el hueco      → el `catch` de antes de #548;
  //   · el panel desaparecido            → la vuelta NO falló (bloque sin medir).
  const tras = await ctx.expectEspera(
    "tras aplicar el estilo, la pantalla acaba de reaccionar al fallo de la vuelta",
    true,
    () => {
      const t = (document.getElementById("ts-style-progress")?.textContent ?? "").trim();
      if (/no hay que volver a pagarlo/i.test(t)) return t;
      if (/games_dir_unreadable/.test(t)) return t;
      if (!document.getElementById("ts-style-run")) return "(el panel ya no está)";
      return null;
    },
    { ms: 180_000 },
  );
  const final = await ctx.page.evaluate(fotoDelPanel);
  ctx.log(`tras el fallo de la vuelta: ${JSON.stringify(final)}`);
  await ctx.shot("estilo-pagado-con-la-vuelta-rota");

  if (!final.hayPanel) {
    ctx.sinMedirBloque(
      `la vuelta al selector NO falló (el panel ya no está): sin fallo no hay «invita a pagar ` +
        `otra vez» que medir — último progreso «${tras.ultimo}»`,
    );
    return;
  }
  ctx.expect(
    "el comprobante del gasto SOBREVIVE al fallo de la vuelta: sigue diciendo qué se pagó (#548)",
    /Estilo aplicado/.test(final.progreso) && /\$/.test(final.progreso),
    `«${final.progreso}»`,
  );
  ctx.expect(
    "…y el botón que COBRA no se rearma: pulsarlo otra vez no es una opción que la pantalla ofrezca",
    final.apagado === true,
    `botón «${final.boton}» disabled=${final.apagado}`,
  );
  ctx.expect(
    "…y se le dice al jugador qué falló y que el estilo YA está aplicado",
    /no hay que volver a pagarlo/i.test(final.progreso) && /selector de mundos/i.test(final.progreso),
    `«${final.progreso}»`,
  );
}
