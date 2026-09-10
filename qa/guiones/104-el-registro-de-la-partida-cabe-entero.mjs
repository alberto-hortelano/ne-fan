/** EL REGISTRO DE LA PARTIDA CABE ENTERO (#506, punto 2): cuántas líneas se
 *  conservan y cuánto alto tiene la caja salen del MISMO número.
 *
 *  El issue decía que la última línea la cortaba el borde inferior del
 *  viewport. No era eso: `#ui-bottom-left` vive en `bottom: 12px` y no puede
 *  salirse. Lo que pasaba es que dos números vivían en ficheros distintos sin
 *  nada que los obligara a coincidir — `main.ts` cortaba a **8** entradas y
 *  `game-ui.css` daba `max-height: 110px` con `line-height: 1.5` sobre
 *  `font-size: 11px`, o sea 16,5 px por línea y **6,67 líneas de caja**. La
 *  séptima salía partida por la mitad, siempre y en cualquier resolución.
 *
 *  QUÉ SE AFIRMA, Y POR QUÉ ESTO ES «NINGUNA LÍNEA SALE PARTIDA». El contenido
 *  del registro fluye en una rejilla de líneas uniforme (todos los hijos son
 *  divs de bloque, mismo `line-height`, sin márgenes), así que el corte de
 *  `overflow: hidden` cae SIEMPRE a `max-height` del borde superior del
 *  contenido. Si esa altura es un múltiplo EXACTO de la interlínea, el corte
 *  aterriza en una frontera entre líneas: una línea se ve entera o no se ve, y
 *  no hay tercer caso — también cuando una entrada larga envuelve en dos
 *  visuales, que es lo normal (la región mide 34vw). Por eso el bloque 1 no es
 *  «geometría bonita»: es el enunciado del issue, medido.
 *
 *  Y el bloque 2 mide la otra mitad: que el número de entradas que el cliente
 *  conserva sea ESE múltiplo y no otro. Se cuentan las líneas AÑADIDAS con un
 *  observador —el DOM tope a N, así que contar hijos no puede ver el rebose— y
 *  se rebosa peleando, que es de donde salen las líneas de verdad.
 *
 *  PROBADO EN NEGATIVO (2026-09-10): devolviendo `max-height: 110px` a
 *  `#combat-log`, el bloque 1 se pone rojo con los números del issue
 *  (`110px / 16.5px = 6.67 líneas` de caja para un tope de 8 entradas) y la
 *  geometría lo enseña recortando de verdad: `contenido 132 · caja 110`.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, `charMode: "vector"` (sin skins).
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const ENEMIGO = "bandido_1";
/** Cuántas líneas de más hay que provocar para demostrar que el tope corta. */
const REBOSE = 3;

/** La geometría del registro, tal y como llega a la pantalla. */
function geometria() {
  const el = document.getElementById("combat-log");
  if (!el) return { error: "no hay #combat-log" };
  const cs = getComputedStyle(el);
  return {
    lineas: Number(cs.getPropertyValue("--nf-log-lineas")),
    interlinea: parseFloat(cs.lineHeight),
    maxAlto: parseFloat(cs.maxHeight),
    overflow: cs.overflowY,
    entradas: el.children.length,
    // La de ARRIBA, que es la más nueva (`prepend`).
    primera: el.firstElementChild?.textContent ?? null,
    // `scrollHeight` mide el contenido REAL: mayor que la caja = hay recorte.
    contenido: el.scrollHeight,
    caja: el.clientHeight,
  };
}

export default async function (ctx) {
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  // Observador de líneas AÑADIDAS: el DOM tope a N, así que sin esto el rebose
  // es invisible desde fuera.
  await ctx.page.evaluate(() => {
    window.__g104 = { anadidas: 0, textos: [] };
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) window.__g104.textos.push(n.textContent ?? "");
        window.__g104.anadidas += m.addedNodes.length;
      }
    }).observe(document.getElementById("combat-log"), { childList: true });
  });

  // ── 1 · El alto de la caja es un múltiplo EXACTO de la interlínea ────────
  const g = await ctx.page.evaluate(geometria);
  ctx.log(`geometría del registro: ${JSON.stringify(g)}`);
  ctx.expect(
    "el registro declara su tope de líneas en `--nf-log-lineas` (lo escribe ui/registro-de-la-partida.ts)",
    Number.isInteger(g.lineas) && g.lineas > 0,
    `--nf-log-lineas = ${JSON.stringify(g.lineas)}`,
  );
  ctx.expect(
    "el registro recorta lo que rebosa (`overflow: hidden`), que es lo que hace que el corte importe",
    g.overflow === "hidden",
    g.overflow,
  );
  const enLineas = g.maxAlto / g.interlinea;
  ctx.expect(
    "el alto máximo es un múltiplo EXACTO de la interlínea: el corte cae entre líneas, nunca por la mitad de una",
    Math.abs(enLineas - Math.round(enLineas)) < 1e-6,
    `max-height ${g.maxAlto}px / line-height ${g.interlinea}px = ${enLineas} líneas`,
  );
  ctx.expect(
    "…y ese múltiplo es EL MISMO número que el tope de entradas (#506: eran 8 contra 6,67)",
    Math.round(enLineas) === g.lineas,
    `caja ${enLineas} líneas · tope ${g.lineas} entradas`,
  );

  // ── 2 · El tope de entradas es ese número, y rebosar no lo mueve ─────────
  // Las líneas salen de PELEAR, que es de donde salen en una partida: cada
  // impacto escribe una (`ui/eco-del-combate.ts`). Lo que se afirma no es
  // cuántas llegan —eso lo decide la pelea— sino que el registro siga en su
  // tope y que la última en llegar esté ARRIBA: recortar por el otro extremo
  // dejaría al jugador leyendo lo de hace un minuto.
  const antes = await ctx.page.evaluate(geometria);
  ctx.expect(
    "precondición: el registro ya llegó a su tope al arrancar la partida",
    antes.entradas === antes.lineas,
    `${antes.entradas} entradas para un tope de ${antes.lineas}`,
  );
  await acercarse(ctx, ENEMIGO, { lista: "enemies", objetivo: 1.6 });
  const { ocurrio, ultimo } = await ctx.expectEspera(
    `pelear con ${ENEMIGO} escribe al menos ${REBOSE} líneas nuevas encima de un registro ya lleno`,
    true,
    (a) => {
      // Mismo gesto que `herirHasta`: revivir si toca, encarar y pegar.
      if (Number(document.getElementById("player-hp-text")?.textContent ?? 0) <= 0) {
        window.__nefan.inputDriver?.queueRespawn?.();
      }
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      const p = window.__nefan.state().pos;
      const drv = window.__nefan.inputDriver;
      if (e && p && drv) {
        window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
        drv.queueAttack();
      }
      return window.__g104.anadidas >= a.n ? window.__g104.anadidas : null;
    },
    { ms: 90_000, arg: { id: ENEMIGO, n: REBOSE } },
  );
  const tras = await ctx.page.evaluate(geometria);
  const libro = await ctx.page.evaluate(() => window.__g104);
  ctx.log(`tras rebosar: ${JSON.stringify(tras)} · añadidas ${libro.anadidas} · últimas ${JSON.stringify(libro.textos.slice(-3))}`);
  if (!ocurrio) {
    ctx.sinMedirBloque(
      `la pelea solo escribió ${libro.anadidas} línea(s) nuevas (hacían falta ${REBOSE}, último ${ultimo ?? "null"}): sin rebose no hay tope que medir`,
    );
  } else {
    ctx.expect(
      "el registro conserva EXACTAMENTE su tope de entradas por más líneas que lleguen",
      tras.entradas === tras.lineas,
      `${tras.entradas} entradas para un tope de ${tras.lineas} (${libro.anadidas} añadidas)`,
    );
    ctx.expect(
      "…y lo que se recorta es lo VIEJO: la última línea que llegó está arriba del todo",
      tras.primera === libro.textos[libro.textos.length - 1],
      `arriba: ${JSON.stringify(tras.primera)} · última añadida: ${JSON.stringify(libro.textos[libro.textos.length - 1])}`,
    );
  }
  await ctx.shot("registro-al-tope");
}
