/** La portada que se REPINTA tampoco miente (#218, el segundo estado).
 *
 *  El guion 26 mide las portadas tal como nacen al abrir el selector. Pero la
 *  tarjeta se vuelve a pintar ENTERA (`card.outerHTML = coverHtml(...)`,
 *  title-screen.ts) cada vez que el jugador toca un mundo o cambia el estilo
 *  del desplegable — y esa es la única vía por la que aparece la portada de un
 *  pack que no es el defecto de ningún mundo. Ninguno de los dos caminos los
 *  recorre el 26: abre el selector y mira, sin pulsar ninguna tarjeta ni tocar
 *  el desplegable.
 *
 *  Que ahí no vuelva el icono roto es justo lo que el plan de la tanda quería
 *  asegurar con un barrido de `complete && naturalWidth === 0`, que no se
 *  implementó porque el listener de CAPTURA sobre la raíz del título cubre
 *  también a los hijos que nacen después. Es cierto — pero eso era una
 *  deducción sobre el DOM, no una medida. Esto lo mide.
 *
 *  El sabotaje va en el BORDE (las imágenes del pack no llegan), nunca dentro
 *  del cliente, y se pone antes de abrir el selector para que ninguna portada
 *  venga de la caché del navegador.
 *
 *  EN NEGATIVO (QA, 2026-08-25): quitando `vigilarPortadas()` de
 *  `title-screen.ts`, la tarjeta repintada se queda con su `<img>` a 0 px y
 *  los dos asertos de este guion se ponen rojos; el 26 los pone rojos por su
 *  cuenta en su propio estado, así que no es el mismo aserto dos veces.
 */
import { abrirSelectorDeMundos } from "../lib/sesion.mjs";

const IMAGENES_DE_ESTILO = /\/styles\/[^/]+\/[^/]+\.(jpg|jpeg|png|webp)$/;

/** Estado de UNA tarjeta: si le queda imagen, qué dice su marcador y qué
 *  estilo anuncia su etiqueta.
 *
 *  `marcador` sale de `[data-cover-nombre]` y no del `textContent` de la caja:
 *  al cerrar C2 (distinguir «portada caída» de «pack sin portada») el marcador
 *  averiado ganó una segunda línea —«⚠ portada no disponible»— y comparar el
 *  texto ENTERO contra la etiqueta pasaría a ser falso por una razón que no es
 *  la que este guion vigila. Lo que afirma no cambia: el nombre del estilo que
 *  se lee en la caja es el del estilo NUEVO. */
function tarjeta(juego) {
  const caja = document.querySelector(`[data-cover-for="${CSS.escape(juego)}"]`);
  const etiqueta = document.querySelector(`[data-style-label-for="${CSS.escape(juego)}"]`);
  const img = caja?.querySelector("img");
  return {
    hayImg: Boolean(img),
    ancho: img?.naturalWidth ?? 0,
    marcador: (caja?.querySelector("[data-cover-nombre]")?.textContent ?? "").trim(),
    averia: Boolean(caja?.querySelector("[data-cover-aviso]")),
    etiqueta: (etiqueta?.textContent ?? "").replace(/^·\s*Estilo:\s*/, "").trim(),
  };
}

function quejasDePortada() {
  return [...document.querySelectorAll(".error-log__entry")]
    .filter((e) => (e.querySelector(".error-log__source")?.textContent ?? "") === "title")
    .map((e) => e.querySelector(".error-log__msg")?.textContent ?? "")
    .filter((m) => /portada/i.test(m));
}

export default async function (ctx) {
  await ctx.page.route(IMAGENES_DE_ESTILO, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "portada no servida (caída simulada por QA)" }),
    }),
  );
  await abrirSelectorDeMundos(ctx);

  // ── Repintado 1: el jugador PULSA una tarjeta de mundo ──
  const juego = "cuentos_oscuros";
  await ctx.page.click(`[data-game-id="${juego}"]`);
  const trasClick = await ctx
    .waitFor(
      "la tarjeta pulsada termina de repintarse y su portada no llega",
      (j) => {
        const caja = document.querySelector(`[data-cover-for="${CSS.escape(j)}"]`);
        return caja && !caja.querySelector("img") ? true : null;
      },
      15_000,
      juego,
    )
    .catch(() => null);
  const t1 = await ctx.page.evaluate(tarjeta, juego);
  ctx.log(`tras pulsar el mundo: ${JSON.stringify(t1)}`);
  ctx.expect(
    "la tarjeta REPINTADA al elegir mundo tampoco se queda con un <img> roto",
    Boolean(trasClick) && !t1.hayImg && t1.marcador.length > 0,
    JSON.stringify(t1),
  );

  // ── Repintado 2: el jugador cambia el ESTILO en el desplegable ──
  const opciones = await ctx.page.$eval("#ts-style", (s) =>
    [...s.options].map((o) => ({ value: o.value, texto: o.textContent ?? "" })),
  );
  ctx.log(`estilos ofrecidos para ${juego}: ${JSON.stringify(opciones.map((o) => o.value))}`);
  if (opciones.length < 2) {
    ctx.log("(solo un estilo compatible: el segundo repintado no se puede ejercer aquí)");
    return;
  }
  const antes = (await ctx.page.evaluate(quejasDePortada)).length;
  const otro = opciones[1];
  await ctx.page.selectOption("#ts-style", otro.value);
  const trasCambio = await ctx
    .waitFor(
      "la tarjeta se repinta con el estilo nuevo y su portada tampoco llega",
      ([j, n]) => {
        const caja = document.querySelector(`[data-cover-for="${CSS.escape(j)}"]`);
        const quejas = [...document.querySelectorAll(".error-log__entry .error-log__msg")].filter((e) =>
          /portada/i.test(e.textContent ?? ""),
        ).length;
        return caja && !caja.querySelector("img") && quejas > n ? { quejas } : null;
      },
      15_000,
      [juego, antes],
    )
    .catch(() => null);
  const t2 = await ctx.page.evaluate(tarjeta, juego);
  const quejas = await ctx.page.evaluate(quejasDePortada);
  ctx.log(`tras cambiar a "${otro.value}": ${JSON.stringify(t2)}`);
  ctx.log(`quejas de portada: ${antes} → ${quejas.length}`);
  await ctx.shot("portada-repintada-al-cambiar-de-estilo");

  ctx.expect(
    "cambiar de estilo con las portadas caídas deja marcador, no icono roto…",
    Boolean(trasCambio) && !t2.hayImg && t2.marcador.length > 0,
    JSON.stringify(t2),
  );
  ctx.expect(
    "…y el marcador y el registro hablan del estilo NUEVO, no del anterior",
    t2.marcador === t2.etiqueta && quejas.some((m) => m.includes(t2.etiqueta)),
    `marcador="${t2.marcador}" etiqueta="${t2.etiqueta}" quejas=${JSON.stringify(quejas.slice(-2))}`,
  );
}
