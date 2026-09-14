/** LO ELEGIDO VUELVE DEL EDITOR, PERO NO SE QUEDA GUARDADO: salir al home y
 *  pulsar «Nueva partida» otra vez empieza de cero, en Maqueta 3D.
 *
 *  ES EL CANDADO DE UNA OPCIÓN DESCARTADA, y por eso existe. Al triaje del
 *  2026-09-14 se le ofrecieron tres respuestas a «con qué modo arranca una
 *  partida nueva» y el usuario eligió la (b) —«nace en Maqueta 3D, y encender
 *  Imagen IA es explícito»—, descartando expresamente la (c): *«se recuerda lo
 *  último que elegiste entre pantallas del título»*. El arreglo de #552 pone en
 *  el título una memoria de lo elegido, y esa memoria es exactamente el
 *  material con el que se implementaría la (c) por accidente: basta con que
 *  sobreviva una navegación de más y la decisión del usuario queda deshecha sin
 *  que nadie lo haya escrito.
 *
 *  Y NO SERÍA COSMÉTICO: la (c) implementada de gorra significa que el jugador
 *  que una vez encendió Imagen IA la encuentra encendida en todas sus partidas
 *  nuevas a partir de entonces — «nace gastando por omisión» con otro nombre,
 *  que es justo lo que la tanda vino a quitar.
 *
 *  EL RECORRIDO, que es el del jugador y no un estado forzado:
 *   1. selector → se elige el último mundo, un estilo que no es el suyo y
 *      Imagen IA en los dos modos;
 *   2. editor de personaje → «← Volver»: todo sigue puesto (esto es #552, y es
 *      el control que impide que este guion salga verde porque el arreglo no
 *      esté; lo mide a fondo el 107);
 *   3. «← Volver» otra vez, al home;
 *   4. «Nueva partida»: mundo por defecto, estilo por defecto de ese mundo y
 *      los DOS modos en Maqueta 3D.
 *
 *  El paso 2 es lo que separa esto de un guion que pasaría igual sin arreglo
 *  ninguno. Sin él, «al volver al título está de fábrica» sería verde también
 *  el día en que nada se conserva nunca.
 *
 *  Cero créditos: no arranca partida, no pide una imagen y no encola ninguna
 *  generación — solo el título contra el bridge del preset sin créditos.
 */
import { esperarListaDeSaves, esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";

export const sinMotor =
  "recorre el título (selector ⇄ editor de personaje ⇄ home) y nunca arranca partida ni encola generación";

const BORDE_ACTIVO = "rgb(221, 170, 102)";

/** Lo que el jugador tiene elegido, leído como lo ve él: del borde que pinta
 *  el selector y del valor del desplegable. */
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

export default async function (ctx) {
  await recargarAlTitulo(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });

  // El estado DE FÁBRICA con el que hay que acabar. Se lee, no se escribe a
  // mano: qué mundo viene puesto depende del catálogo del bench.
  const deFabrica = await leer(ctx);
  ctx.log(`el selector de fábrica: ${JSON.stringify(elegido(deFabrica))}`);
  ctx.expect(
    "de fábrica, los dos modos vienen en Maqueta 3D (la decisión (b) del 2026-09-14)",
    deFabrica.escenarios === "vector" && deFabrica.personajes === "vector",
    JSON.stringify(elegido(deFabrica)),
  );
  ctx.expect(
    "y hay más de un mundo y más de un estilo, o este guion no podría elegir NADA distinto",
    deFabrica.mundos.length >= 2 && deFabrica.estilos.length >= 2,
    `${deFabrica.mundos.length} mundos · ${deFabrica.estilos.length} estilos`,
  );

  // ── 1 · elegirlo todo distinto ──
  const mundo = deFabrica.mundos[deFabrica.mundos.length - 1];
  await ctx.page.click(`[data-game-id="${mundo}"]`);
  const conMundo = await leer(ctx);
  const estilo = conMundo.estilos.find((s) => s !== conMundo.estilo) ?? conMundo.estilo;
  await ctx.page.selectOption("#ts-style", estilo);
  await ctx.page.click('#ts-rendermode [data-rendermode="image"]');
  const elegidoPorElJugador = await leer(ctx);
  ctx.log(`lo elegido: ${JSON.stringify(elegido(elegidoPorElJugador))}`);

  // ── 2 · el control: ir al editor y volver NO lo pierde (#552) ──
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  const trasVolver = await leer(ctx);
  ctx.expect(
    "CONTROL — volviendo del editor sí se conserva todo (sin esto, lo de abajo saldría verde con el arreglo desmontado)",
    trasVolver.mundo === mundo &&
      trasVolver.estilo === estilo &&
      trasVolver.escenarios === "image" &&
      trasVolver.personajes === "image",
    `${JSON.stringify(elegido(elegidoPorElJugador))} → ${JSON.stringify(elegido(trasVolver))}`,
  );
  await ctx.shot("lo-elegido-vuelve-del-editor");

  // ── 3 · al home, por el botón del jugador ──
  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // ── 4 · y «Nueva partida» empieza de cero ──
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  const otraVez = await leer(ctx);
  ctx.log(`«Nueva partida» tras la ida y vuelta: ${JSON.stringify(elegido(otraVez))}`);
  await ctx.shot("nueva-partida-empieza-de-cero");
  ctx.expect(
    "una partida NUEVA vuelve a nacer en Maqueta 3D en las dos filas: la memoria de #552 no se filtra entre visitas al título",
    otraVez.escenarios === "vector" && otraVez.personajes === "vector",
    `${JSON.stringify(elegido(trasVolver))} → ${JSON.stringify(elegido(otraVez))}`,
  );
  ctx.expect(
    "…y el mundo y el estilo también vuelven a los de fábrica (el jugador no hereda la elección de la visita anterior)",
    otraVez.mundo === deFabrica.mundo && otraVez.estilo === deFabrica.estilo,
    `${JSON.stringify(elegido(deFabrica))} → ${JSON.stringify(elegido(otraVez))}`,
  );
}
