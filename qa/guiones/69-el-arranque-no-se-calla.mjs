/** Lo que se rompe SOLO durante el título llega a quien juega (#306).
 *
 *  EL AGUJERO, medido antes de esta tanda: `#ts-error` guardaba UN mensaje
 *  (`el.innerHTML = …`) y cada `renderHome` lo borraba, así que los fallos que
 *  saltan sin que nadie pulse nada —three.js que no carga, las hojas base que
 *  no llegan, el socket de la partida— solo existían en un `error-log` que
 *  `html[data-titulo="1"] #error-log{display:none}` (#246) mantiene apagado
 *  mientras el título manda. El jugador veía un título normal encima de un
 *  cliente roto.
 *
 *  QUÉ SE AFIRMA AQUÍ, y por qué cada cosa:
 *
 *  1 · **Las tres familias llegan al hueco del título.** Se rompen EN EL
 *      BORDE —abortando la petición de red, no stubeando el cliente—, que es
 *      lo que le pasa a quien juega con un chunk que no llega o unas hojas que
 *      no están.
 *  2 · **El texto de la pantalla es el del registro.** Una sola verdad: el
 *      aviso es una proyección del mismo `errors.push`, no una segunda
 *      redacción que pueda divergir. Se comparan los dos textos del MISMO DOM.
 *  3 · **Sobrevive al repintado.** El `innerHTML` de `renderHome` era
 *      literalmente el bug: se entra al selector de mundos y se vuelve, y el
 *      aviso tiene que seguir puesto.
 *  4 · **Un aviso por fallo, y no crece.** `bridge-client` reintenta cada 5 s
 *      y `preloadBase` falla una vez por hoja: si el aviso no fuera idempotente
 *      por (fuente, título), la pantalla se inundaría. Se mide con DOS muestras
 *      separadas por fotogramas, no por reloj.
 *  5 · **#246 sigue intacto**: `#game-ui` (y con él `#narrative-loader` y el
 *      `#error-log`) sigue oculto con el título delante. El aviso llega al
 *      hueco del TÍTULO, no encendiendo lo que #246 apagó.
 *
 *  Lo que NO se afirma aquí: el caso del socket que no llega a conectar
 *  (`onerror`), porque entonces `bootstrap` falla y el título no se pinta
 *  nunca — ese estado es el sujeto de `qa/fixtures-sin-bridge.mjs`, que corre
 *  sin bridge y mira el muro. Aquí el bridge existe y se le hace contestar
 *  basura, que es la otra fuente de la misma familia y sí ocurre con el título
 *  delante.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, y este guion no le pide nada al
 *  motor.
 */

/** El guardarraíl de gasto (#295) quiere el motivo escrito, no un booleano. */
export const sinMotor =
  "solo mira el título con tres fallos inyectados en el borde (chunk de three.js, " +
  "hojas base y tramas del socket); no abre partida ni pide nada al motor";

import { abrirSelectorDeMundos, esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";

/** Los titulares que el emisor decidió, tal cual viajan en `alJugador`. Se
 *  escriben aquí para que el guion se ponga ROJO si alguien los cambia sin
 *  mirar quién los lee: son texto de producto, no detalle interno. */
const AVISOS = {
  mundo: "No se puede dibujar el mundo",
  personajes: "Los personajes van sin vestir",
  socket: "La partida respondió algo que no se entiende",
};

/** Todo lo que hace falta para juzgar, leído del MISMO DOM y en la misma
 *  evaluación: los avisos del título, las entradas del registro y el estado
 *  del interruptor de #246. Comparar el aviso con el log en dos lecturas
 *  distintas dejaría hueco para que uno cambiara entre medias. */
function loQueSeLee() {
  const hueco = document.getElementById("ts-error");
  const gameUi = document.getElementById("game-ui");
  return {
    huecoVisible: hueco ? hueco.style.display !== "none" : false,
    avisos: [...(hueco?.querySelectorAll("[data-aviso]") ?? [])].map((e) => ({
      titulo: e.getAttribute("data-aviso") ?? "",
      texto: e.textContent ?? "",
    })),
    log: [...document.querySelectorAll(".error-log__entry")].map((e) => ({
      fuente: e.querySelector(".error-log__source")?.textContent ?? "",
      msg: e.querySelector(".error-log__msg")?.textContent ?? "",
    })),
    // El interruptor de #246 y su efecto, no solo el atributo: que el atributo
    // esté puesto no demuestra que la regla de CSS siga apagando nada.
    titulo: document.documentElement.dataset.titulo ?? null,
    gameUiOculto: gameUi ? getComputedStyle(gameUi).display === "none" : null,
  };
}

/** Espera a que el título enseñe el aviso `titulo` y lo devuelve con el resto
 *  de la lectura. Por ESTADO, nunca por reloj. */
function esperarAviso(ctx, titulo, maxMs = 25_000) {
  return ctx.waitFor(
    `el título enseña el aviso «${titulo}»`,
    (t) => {
      const hueco = document.getElementById("ts-error");
      const avisos = [...(hueco?.querySelectorAll("[data-aviso]") ?? [])];
      return avisos.some((e) => e.getAttribute("data-aviso") === t) ? { visto: true } : null;
    },
    maxMs,
    titulo,
  );
}

/** El aviso `titulo`, con el texto que el jugador lee y la entrada del
 *  registro que lo originó. `null` en cualquiera de los dos si no está. */
function pareja(lectura, titulo) {
  const aviso = lectura.avisos.find((a) => a.titulo === titulo) ?? null;
  if (!aviso) return { aviso: null, entrada: null };
  // El texto del aviso ES el `message` de una entrada del log: el emisor lo
  // escribió UNA vez. Si divergen, hay dos verdades — que es justo lo que
  // #306 prohíbe.
  const entrada = lectura.log.find((e) => aviso.texto.includes(e.msg)) ?? null;
  return { aviso, entrada };
}

export default async function (ctx) {
  // ─── 1 · three.js no carga: no hay mundo que pintar ────────────────────
  //
  // El chunk se pide desde el constructor de `FpsRenderer`, en la evaluación
  // del módulo: abortarlo es exactamente un chunk que no llega.
  await ctx.page.route("**/fps-gl*", (route) => route.abort("failed"));
  await recargarAlTitulo(ctx);
  await esperarAviso(ctx, AVISOS.mundo);
  const conMundoRoto = await ctx.page.evaluate(loQueSeLee);
  const mundo = pareja(conMundoRoto, AVISOS.mundo);
  ctx.log(`aviso: «${mundo.aviso?.titulo}» → ${mundo.aviso?.texto}`);
  ctx.expect(
    "three.js que no carga se DICE en el título, no solo en un panel apagado",
    Boolean(mundo.aviso),
    JSON.stringify(conMundoRoto.avisos),
  );
  ctx.expect(
    "…y lo que se lee es el mensaje del MISMO errors.push que lo registró (una verdad)",
    Boolean(mundo.entrada),
    `aviso "${mundo.aviso?.texto}" · registro ${JSON.stringify(conMundoRoto.log.slice(0, 3))}`,
  );
  ctx.expect(
    "el interruptor de #246 sigue intacto: con el título delante #game-ui está apagado",
    conMundoRoto.titulo === "1" && conMundoRoto.gameUiOculto === true,
    JSON.stringify({ titulo: conMundoRoto.titulo, gameUiOculto: conMundoRoto.gameUiOculto }),
  );
  await ctx.shot("306-el-mundo-no-se-puede-dibujar");

  // ─── 2 · Sobrevive al repintado ────────────────────────────────────────
  //
  // `renderHome` reescribe `this.content.innerHTML` entero: hasta esta tanda
  // eso borraba el hueco de error y con él el motivo. Se va al selector de
  // mundos y se vuelve, que es el repintado que hace quien juega.
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  const trasRepintar = await ctx.page.evaluate(loQueSeLee);
  ctx.expect(
    "el aviso SOBREVIVE al repintado del home (era literalmente el bug del innerHTML)",
    trasRepintar.avisos.some((a) => a.titulo === AVISOS.mundo),
    JSON.stringify(trasRepintar.avisos),
  );
  ctx.expect(
    "…y sigue habiendo UNO, no dos: el aviso es idempotente por (fuente, título)",
    trasRepintar.avisos.filter((a) => a.titulo === AVISOS.mundo).length === 1,
    JSON.stringify(trasRepintar.avisos.map((a) => a.titulo)),
  );
  await ctx.page.unroute("**/fps-gl*");

  // ─── 3 · Las hojas base no llegan: los personajes van en maniquí ───────
  await ctx.page.route("**/sprites/y_bot/**", (route) => route.abort("failed"));
  await recargarAlTitulo(ctx);
  await esperarAviso(ctx, AVISOS.personajes);
  const conHojasRotas = await ctx.page.evaluate(loQueSeLee);
  const hojas = pareja(conHojasRotas, AVISOS.personajes);
  ctx.log(`aviso: «${hojas.aviso?.titulo}» → ${hojas.aviso?.texto}`);
  ctx.expect(
    "las hojas base que no llegan se DICEN en el título",
    Boolean(hojas.aviso),
    JSON.stringify(conHojasRotas.avisos),
  );
  ctx.expect(
    "…con el mensaje del registro, que NOMBRA EL REMEDIO (#255)",
    Boolean(hojas.entrada) && /sprite-forge/.test(hojas.aviso?.texto ?? ""),
    hojas.aviso?.texto ?? "(sin aviso)",
  );
  // Diez hojas fallan, y el agregado de `preloadBase` falla detrás: si el
  // aviso no colapsara por (fuente, título), aquí habría once.
  const delSprite = conHojasRotas.avisos.filter((a) => a.titulo === AVISOS.personajes);
  ctx.expect(
    "una familia rota = UN aviso, aunque falle una hoja tras otra (no se inunda la pantalla)",
    delSprite.length === 1,
    `${delSprite.length} avisos: ${JSON.stringify(delSprite.map((a) => a.texto.slice(0, 60)))}`,
  );
  ctx.expect(
    "y el tope de la pantalla se respeta: como mucho tres avisos a la vez",
    conHojasRotas.avisos.length <= 3,
    JSON.stringify(conHojasRotas.avisos.map((a) => a.titulo)),
  );
  await ctx.shot("306-los-personajes-van-sin-vestir");
  await ctx.page.unroute("**/sprites/y_bot/**");

  // ─── 4 · El socket contesta algo que no se entiende ────────────────────
  //
  // Se conecta al bridge de VERDAD (si no, el título no arrancaría: sin
  // socket, `bootstrap` falla y no hay título que mirar) y se le corrompe lo
  // que devuelve. Es la fuente `Failed to parse WS frame` de `bridge-client`,
  // que sí ocurre con el título delante — el `onerror` del socket que no llega
  // a abrirse lo mide `qa/fixtures-sin-bridge.mjs`, donde no hay título.
  //
  // La ruta se acota al gateway DEL JUEGO, preguntándole a la página a qué URL
  // resolvió (`servicios()`, el mismo hook que usa el candado de #341). Con un
  // patrón que cazara todos los WebSocket se corrompe también el canal de HMR
  // de Vite, cuyo cliente parsea sin `try` — y entonces lo que sale rojo es una
  // excepción del dev server, no el juego. Medido: eso pasó a la primera.
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  ctx.log(`corrompiendo lo que contesta ${gateway}`);
  await ctx.page.routeWebSocket(gateway, (ws) => {
    const server = ws.connectToServer();
    server.onMessage(() => ws.send("}{ esto no es json"));
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  // Sin `esperarListaDeSaves`: con las respuestas corrompidas la lista no
  // llega nunca, y esperar por ella sería esperar por lo que este bloque rompe
  // a propósito.
  await esperarTituloListo(ctx);
  await esperarAviso(ctx, AVISOS.socket);
  const conSocketRoto = await ctx.page.evaluate(loQueSeLee);
  const socket = pareja(conSocketRoto, AVISOS.socket);
  ctx.log(`aviso: «${socket.aviso?.titulo}» → ${socket.aviso?.texto}`);
  ctx.expect(
    "una trama del socket que no se entiende se DICE en el título",
    Boolean(socket.aviso),
    JSON.stringify(conSocketRoto.avisos),
  );
  ctx.expect(
    "…con el mensaje del registro, no con una segunda redacción",
    Boolean(socket.entrada),
    `aviso "${socket.aviso?.texto}" · registro ${JSON.stringify(conSocketRoto.log.slice(0, 3))}`,
  );
  await ctx.shot("306-el-socket-no-se-entiende");

  // El control de la inundación, y es el riesgo que el plan mandó vigilar: el
  // socket recibe tramas sin parar. Dos muestras separadas por FOTOGRAMAS del
  // bucle de juego (esperar por reloj lo prohíbe `qa-guiones-sin-espera-por-
  // reloj`), y lo que se afirma es que el número no se mueve.
  const antes = conSocketRoto.avisos.length;
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  await ctx.waitFor(
    "el bucle de juego avanza 60 fotogramas con el socket escupiendo basura",
    (d) => ((window.__nefan.fps()?.frames ?? 0) >= d + 60 ? { ok: true } : null),
    30_000,
    desde,
  );
  const despues = await ctx.page.evaluate(loQueSeLee);
  ctx.expect(
    "el aviso NO crece con los reintentos: la pantalla del jugador no se inunda",
    despues.avisos.length === antes,
    `${antes} → ${despues.avisos.length}: ${JSON.stringify(despues.avisos.map((a) => a.titulo))}`,
  );
  ctx.expect(
    "y #game-ui sigue apagado: el aviso llega al hueco del TÍTULO, no encendiendo lo que #246 apagó",
    despues.gameUiOculto === true,
    JSON.stringify({ titulo: despues.titulo, gameUiOculto: despues.gameUiOculto }),
  );
}
