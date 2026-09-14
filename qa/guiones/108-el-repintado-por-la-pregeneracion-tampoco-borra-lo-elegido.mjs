/** EL REPINTADO DEL SELECTOR tras una pre-generación tampoco se lleva lo que
 *  el jugador tenía elegido — el mismo #552 por la OTRA puerta.
 *
 *  QUÉ PASA DE VERDAD, y por qué no lo cubre el 107. Cuando un `game_gen` llega
 *  a `ready` o a `error` con el selector delante, el enrutador REPINTA la
 *  pantalla entera (`title-screen.ts`) — tiene que hacerlo: los chips de «lo
 *  generado» de cada tarjeta y los botones del panel salen del catálogo, y ese
 *  catálogo acaba de cambiar. Hasta este arreglo ese repintado se hacía con lo
 *  ÚNICO que la raíz recordaba, el id del mundo mirado, así que al jugador que
 *  estaba esperando a que su mundo terminara se le borraban el estilo y los dos
 *  modos en el instante del «Mundo generado». No hace falta ir a ningún sitio:
 *  basta con esperar mirando la pantalla.
 *
 *  Es el mismo defecto y el mismo arreglo —lo elegido viaja a la raíz y vuelve—
 *  pero el disparador es otro y ningún click lo produce, así que se mide
 *  aparte.
 *
 *  CÓMO SE DISPARA. El `narrative_status` se entrega A MANO por el socket que
 *  el cliente ya tiene abierto, con la misma forma que registró el 38 de los
 *  frames reales (`kind:"game_gen"`, `phase`, `gameId`, sin sello), que es la
 *  técnica del 100. Encolar una pre-generación de verdad tardaría minutos, no
 *  daría la fase `error` a voluntad y dejaría el guion a merced del motor.
 *
 *  LAS DOS FASES TERMINALES, las dos: `ready` y `error` son las que repintan, y
 *  se prueban las dos porque son dos ramas distintas del oyente —la de `error`
 *  además escribe en el registro— y un arreglo que solo cubriera una dejaría al
 *  jugador perdiendo su elección justo cuando algo ha fallado.
 *
 *  EL CONTROL QUE IMPIDE EL VERDE VACÍO: antes de afirmar nada se comprueba que
 *  el repintado OCURRIÓ, marcando el nodo de la lista de mundos y viendo que la
 *  marca desaparece (`content.innerHTML = …` crea un nodo nuevo). Sin eso, un
 *  frame que no llegara a disparar nada dejaría la pantalla intacta y el guion
 *  saldría verde sin haber medido el repintado.
 *
 *  Cero créditos: no arranca partida, no pide una imagen y no pulsa ni
 *  `#ts-gen-world` ni `#ts-apply-style` — no encola ni una generación.
 */
import { abrirSelectorDeMundos, recargarAlTitulo } from "../lib/sesion.mjs";

export const sinMotor =
  "conduce el título y ENTREGA los narrative_status por el socket ya abierto: no encola ninguna generación ni arranca partida";

const BORDE_ACTIVO = "rgb(221, 170, 102)";

/** Guarda los sockets que abre la página para poder entregarles un frame. Va
 *  como `addInitScript` porque el cliente abre el suyo en el arranque. */
function coleccionarSockets() {
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
}

/** Entrega UN `narrative_status` de pre-generación por el socket vivo del
 *  bridge, como si lo hubiera mandado él. */
function entregar(ctx, marco) {
  return ctx.page.evaluate((m) => {
    const vivos = (window.__qaSockets ?? []).filter(
      (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
    );
    if (vivos.length === 0) throw new Error("ningún socket del bridge donde entregar");
    vivos[vivos.length - 1].onmessage({
      data: JSON.stringify({ type: "narrative_status", kind: "game_gen", ...m }),
    });
    return vivos.length;
  }, marco);
}

/** Lo que el jugador tiene elegido, leído como lo ve él. */
function estadoDelSelector(borde) {
  const tarjetas = [...document.querySelectorAll("[data-game-id]")];
  const fila = (sel, attr) =>
    [...document.querySelectorAll(`${sel} [data-${attr}]`)]
      .filter((b) => b.style.borderColor === borde)
      .map((b) => b.dataset[attr])
      .join(",");
  const desplegable = document.getElementById("ts-style");
  return {
    mundo: tarjetas.find((c) => c.style.borderColor === borde)?.dataset.gameId ?? null,
    mundos: tarjetas.map((c) => c.dataset.gameId),
    estilo: desplegable?.value ?? null,
    estilos: [...(desplegable?.options ?? [])].map((o) => o.value),
    escenarios: fila("#ts-rendermode", "rendermode"),
    personajes: fila("#ts-charmode", "charmode"),
  };
}

const leer = (ctx) => ctx.page.evaluate(estadoDelSelector, BORDE_ACTIVO);
const elegido = ({ mundo, estilo, escenarios, personajes }) => ({
  mundo,
  estilo,
  escenarios,
  personajes,
});

/** Marca el nodo de la lista de mundos: si el título se repinta, `innerHTML`
 *  crea uno nuevo y la marca se pierde. Es la prueba de que hubo repintado. */
const marcarLaLista = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("ts-worlds");
    if (!el) throw new Error("no hay lista de mundos que marcar");
    el.__qaMarca = 1;
  });

/** Deja el selector con una elección COMPLETA y distinta de la de fábrica:
 *  el último mundo, un estilo que no es el suyo y los dos modos cruzados. */
async function elegirloTodo(ctx) {
  const alAbrir = await leer(ctx);
  const mundo = alAbrir.mundos[alAbrir.mundos.length - 1];
  await ctx.page.click(`[data-game-id="${mundo}"]`);
  const conMundo = await leer(ctx);
  const estilo = conMundo.estilos.find((s) => s !== conMundo.estilo) ?? conMundo.estilo;
  await ctx.page.selectOption("#ts-style", estilo);
  await ctx.page.click('#ts-rendermode [data-rendermode="image"]');
  await ctx.page.click('#ts-charmode [data-charmode="vector"]');
  return { mundo, estilo };
}

export default async function (ctx) {
  await ctx.page.addInitScript(coleccionarSockets);
  await recargarAlTitulo(ctx);
  await abrirSelectorDeMundos(ctx);

  const { mundo, estilo } = await elegirloTodo(ctx);
  const antes = await leer(ctx);
  ctx.log(`lo elegido antes del aviso de pre-generación: ${JSON.stringify(elegido(antes))}`);
  ctx.expect(
    "el punto de partida es una elección COMPLETA y distinta de la de fábrica (mundo, estilo y los dos modos cruzados)",
    antes.mundo === mundo &&
      antes.estilo === estilo &&
      antes.escenarios === "image" &&
      antes.personajes === "vector",
    JSON.stringify(elegido(antes)),
  );
  await ctx.shot("antes-del-ready");

  // ── `ready`: el caso feliz, y el que más se ve ──
  await marcarLaLista(ctx);
  const sockets = await entregar(ctx, {
    phase: "ready",
    gameId: mundo,
    message: "Mundo generado.",
  });
  ctx.log(`frame ready entregado por el socket del bridge (sockets vivos: ${sockets})`);
  const repintadoReady = await ctx.waitFor(
    "el selector se repinta tras el ready (la marca de la lista desaparece)",
    () => (document.getElementById("ts-worlds")?.__qaMarca ? null : { repintado: true }),
    15_000,
  );
  ctx.expect(
    "el aviso de pre-generación REPINTA el selector (sin esto, lo de abajo sería verde por no haber pasado nada)",
    Boolean(repintadoReady),
    JSON.stringify(repintadoReady),
  );

  const trasReady = await leer(ctx);
  ctx.log(`tras el ready: ${JSON.stringify(elegido(trasReady))}`);
  await ctx.shot("tras-el-ready");
  ctx.expect(
    "…y el repintado NO se lleva lo elegido: mundo, estilo y los dos modos siguen donde estaban",
    trasReady.mundo === mundo &&
      trasReady.estilo === estilo &&
      trasReady.escenarios === "image" &&
      trasReady.personajes === "vector",
    `${JSON.stringify(elegido(antes))} → ${JSON.stringify(elegido(trasReady))}`,
  );

  // ── `error`: la otra fase terminal, la que además escribe en el registro ──
  await marcarLaLista(ctx);
  await entregar(ctx, {
    phase: "error",
    gameId: mundo,
    message: "la pre-generación falló (guion 108)",
  });
  const repintadoError = await ctx.waitFor(
    "el selector se repinta también tras el error",
    () => (document.getElementById("ts-worlds")?.__qaMarca ? null : { repintado: true }),
    15_000,
  );
  ctx.expect(
    "la fase `error` repinta igual que `ready` (son las dos terminales)",
    Boolean(repintadoError),
    JSON.stringify(repintadoError),
  );

  const trasError = await leer(ctx);
  ctx.log(`tras el error: ${JSON.stringify(elegido(trasError))}`);
  ctx.expect(
    "…y cuando algo FALLA tampoco se le quita al jugador lo que había elegido",
    trasError.mundo === mundo &&
      trasError.estilo === estilo &&
      trasError.escenarios === "image" &&
      trasError.personajes === "vector",
    `${JSON.stringify(elegido(antes))} → ${JSON.stringify(elegido(trasError))}`,
  );
  await ctx.shot("tras-el-error");
}
