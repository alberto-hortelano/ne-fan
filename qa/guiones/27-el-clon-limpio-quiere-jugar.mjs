/** Un clon limpio pulsa «Comenzar»: qué se le dice cuando no hay hojas (#255 p2).
 *
 *  El criterio de la tanda es que «un clon sin hojas se entera al arrancar».
 *  El guion 13 (bloque 4) mide ese enterarse en el REGISTRO de errores y lo
 *  mira con el título ya cerrado (`closeTitle`, el botón «✕ modo fixtures»).
 *  Eso deja fuera al jugador que hace lo único que se hace en esa pantalla:
 *  elegir un mundo y darle a empezar. Este guion recorre ESE camino.
 *
 *  Lo que pasa hoy, medido: `setPlayerAppearance` espera a `baseSheetsReady`,
 *  que en un clon rechaza; el fallo llega DESPUÉS de `session.enter`, así que
 *  `unIntentoDeArrancar` (main.ts) lo caza, abandona la partida y vuelve al
 *  título con `aviso`. El aviso lo redacta `motivoDeSesionParaElJugador`
 *  (nefan-core/src/protocol/status-labels.ts), que no reconoce «faltan 10 de
 *  10 hojas … HTTP 404 on /sprites/y_bot/…» y cae a su rama por defecto:
 *  «El servidor del juego no pudo completarlo; inténtalo de nuevo». El
 *  servidor no tiene nada que ver y reintentar no puede funcionar: la única
 *  línea que dice qué hacer («…docs/assets-de-personaje.md») va al error-log,
 *  que en el título está oculto por CSS (#246, dev-ui.css). Un fallo de
 *  ficheros que falta se disfraza de servidor con hipo — la misma familia de
 *  mentira que arregla esta tanda, un piso más arriba.
 *
 *  NACE ROJO (QA, 2026-08-25): los dos asertos del aviso son el hallazgo. El
 *  primero y el último SÍ están verdes hoy y son los que impiden que este
 *  fichero se vuelva un guion de una sola nota: que el juego no deje colgado
 *  al jugador, y que el registro lo sepa aunque no se lea.
 *
 *  EN NEGATIVO (2026-08-25):
 *  - sin el `route("**\/sprites\/**" → 404)` de la primera línea (o sea, con
 *    las hojas puestas) el desenlace medido es `{"arrancó":"tile_0_0"}` y se
 *    ponen rojos los dos asertos que HOY están verdes —«vuelve al título con
 *    un aviso» y «el cliente tiene escrito el remedio» (0 entradas,
 *    `#error-log display:block`)—: cuelgan del fallo, no del reloj ni de la
 *    pantalla.
 *  - los dos asertos del texto están rojos HOY: su capacidad de ponerse rojos
 *    no hay que demostrarla, hay que arreglarla.
 */
import { esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

/** La entrada accionable que el cliente escribe en el registro (main.ts). */
const REMEDIO = "docs/assets-de-personaje.md";

export default async function (ctx) {
  // El estado del clon limpio, producido en el BORDE: `public/sprites/` está
  // en .gitignore (28 MB de renders de FBX que Adobe no deja redistribuir),
  // así que quien clona el repo arranca exactamente así. No se toca nada del
  // lado del juego.
  await ctx.page.route("**/sprites/**", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "clon sin hojas (simulado por QA)" }),
    }),
  );
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin hojas", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);

  // El camino del jugador, entero: Nueva partida → mundo → Comenzar.
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");

  // Se espera al DESENLACE, sea cual sea: o se está jugando, o el título
  // vuelve con su aviso. Un `waitFor` sobre uno solo de los dos convertiría
  // el otro desenlace en un timeout opaco.
  //
  // «Se está jugando» NO es «hay escena»: el tile del bridge llega ANTES de
  // que se resuelva la apariencia, así que durante unos ms hay escena y
  // título a la vez — medido, este guion nació dando por arrancada una
  // partida que un instante después volvía al título. El juego solo esconde
  // el título cuando todo el arranque salió bien (`unIntentoDeArrancar`,
  // main.ts), y eso es lo que publica `data-titulo`.
  const desenlace = await ctx
    .waitFor(
      "el juego resuelve el intento de empezar (se juega, o vuelta al título)",
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
  ctx.log(`desenlace: ${JSON.stringify(desenlace)}`);
  await ctx.shot("clon-limpio-pulsa-comenzar");

  ctx.expect(
    "sin hojas, «Comenzar» no deja al jugador colgado: vuelve al título con un aviso VISIBLE",
    Boolean(desenlace?.aviso),
    JSON.stringify(desenlace ?? "(ni escena ni aviso en 60 s)"),
  );

  const aviso = desenlace?.aviso ?? "";
  // El aviso es lo ÚNICO que se lee en esta pantalla: el error-log está
  // oculto mientras el título está delante (#246). Si aquí no está el motivo,
  // el jugador no tiene ninguno.
  ctx.expect(
    "…y ese aviso nombra lo que de verdad falta (las hojas del personaje, o dónde se generan)",
    /hoja|sprite|personaje|assets-de-personaje/i.test(aviso),
    aviso,
  );
  ctx.expect(
    "…y no le manda reintentar lo que no puede funcionar, ni culpa al servidor",
    aviso.length > 0 && !/inténtalo de nuevo|servidor del juego/i.test(aviso),
    aviso,
  );

  // El otro lado de la moneda, y el que hace que el hallazgo sea de
  // VISIBILIDAD y no de diagnóstico: el cliente SÍ sabe qué pasa y lo tiene
  // escrito; lo que no puede es enseñarlo en la pantalla donde ocurre.
  const registro = await ctx.page.evaluate((remedio) => {
    const panel = document.getElementById("error-log");
    const entradas = [...document.querySelectorAll(".error-log__entry .error-log__msg")].map(
      (e) => e.textContent ?? "",
    );
    return {
      display: panel ? getComputedStyle(panel).display : "(sin panel)",
      remedioEnElDom: entradas.some((m) => m.includes(remedio)),
      entradas: entradas.length,
    };
  }, REMEDIO);
  ctx.log(
    `registro: ${registro.entradas} entradas, remedio en el DOM: ${registro.remedioEnElDom}, ` +
      `#error-log display:${registro.display} (con el título delante — #246)`,
  );
  ctx.expect(
    "el cliente SÍ tiene escrito el remedio (aunque el título no lo deje ver)",
    registro.remedioEnElDom,
    JSON.stringify(registro),
  );
}
