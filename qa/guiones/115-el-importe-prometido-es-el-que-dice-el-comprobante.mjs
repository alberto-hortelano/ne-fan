/** LO QUE EL BOTÓN PROMETE ES LO QUE EL COMPROBANTE DICE QUE SE PAGÓ, Y LO YA
 *  PINTADO NO SE VUELVE A COTIZAR.
 *
 *  QA de la PR 3 de la tanda «el dinero no miente» (#513, 2026-09-14). El
 *  criterio de aceptación del usuario no es «el cliente enseña el número del
 *  wire» sino, literal, **«el importe que se enseña es el que se cobra»**. Esa
 *  frase tiene DOS extremos y los candados de la PR solo sujetan uno cada uno:
 *
 *   · `qa/guiones/114-…` compara la PANTALLA con la cotización del wire, pero
 *     nunca pulsa el botón que paga: no ve la factura.
 *   · `ai_server/tests/test_atlas_cotizacion.py` compara la cotización con el
 *     cobro DENTRO del servidor, con el pintor stubeado: no ve la pantalla.
 *
 *  Entre los dos queda el tramo que es del jugador: desde el importe que acepta
 *  hasta el comprobante que lee después. Aquí se cierra, de punta a punta y en
 *  el navegador.
 *
 *  Y el segundo estado, que la PR no probó en ninguna de sus formas: **la caché
 *  CALIENTE**. Toda su tabla antes/después es con la caché vacía; el test que
 *  llamó «lo que ya está en la librería no se cotiza» mide el servidor, no el
 *  panel. Lo que el jugador tiene delante la SEGUNDA vez que abre «Aplicar
 *  estilo» —después de haber pagado— es justo donde «cotiza sobre la misma
 *  lista que va a pintar» se gana o se pierde: si el cliente volviera a contar
 *  celdas por su cuenta, ahí pediría dinero por lo que ya está pagado.
 *
 *  LO QUE AFIRMA:
 *
 *   1 · Con un plan de precio EXACTO (solo el bloque del atlas encendido, sin
 *       cotas ni «+ ?» que emborronen la comparación), el importe del botón y
 *       el del comprobante son la MISMA cifra, al céntimo.
 *   2 · Tras pagar, la segunda cotización del servidor por las mismas celdas es
 *       **$0.00** — no «más barata», cero.
 *   3 · …y la pantalla lo dice: la fila del atlas pasa a «en caché ($0)» con su
 *       casilla DESHABILITADA, que es lo único que impide repagarla con un
 *       click.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más: que la cifra del
 *  comprobante sea la factura de fal. Aquí quien cobra es el motor falso, que
 *  no cobra nada; lo que se mide es que el número no se transforme por el
 *  camino entre la promesa y el recibo. La paridad con el pintor de verdad vive
 *  en `ai_server/tests/`, y la tabla de precios de `meshy_client.py` no la
 *  comprueba nada (hallazgo H4 de `qa-3.md`).
 *
 *  EN NEGATIVO (probado al escribirlo, las dos sondas revertidas — ver
 *  `qa-3.md`): con `resolveMissing` devuelto a su `ceil(missing/12) × $0.15`,
 *  (1) se pone rojo —promete $0.30 y el comprobante dice $0.15—; y devolviendo
 *  al panel el precio del atlas cuando ya está todo en caché, (3) se pone rojo.
 *
 *  CERO CRÉDITOS: motor falso (`e2e-sin-creditos`), igual que el 123 — que ya
 *  pulsa este mismo botón. El batch corre de verdad contra el fake, que no
 *  cobra ni un céntimo.
 */
import { nuevaPartida, regenerarMundo } from "../lib/sesion.mjs";

/** Precondición DECLARADA, las dos por el mismo motivo que el 114:
 *   · `mundo`   — el plan deriva sus celdas del snapshot del mundo; heredar el
 *                 de otro guion es pagar SU atlas.
 *   · `fake-ai` — con la caché del motor falso ya caliente no queda nada que
 *                 pintar, o sea que la PRIMERA mitad de este guion (pagar) se
 *                 queda sin sujeto. */
export const aisla = ["mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** El panel tal como lo lee quien va a pagar. */
const fotoDelPanel = () => {
  const filas = [...document.querySelectorAll("#ts-style-plan label")].map((l) => ({
    texto: (l.textContent ?? "").replace(/\s+/g, " ").trim(),
    idx: l.querySelector("input[data-block-idx]")?.dataset.blockIdx ?? null,
    marcada: l.querySelector("input[data-block-idx]")?.checked ?? null,
    apagada: l.querySelector("input[data-block-idx]")?.disabled ?? null,
  }));
  return {
    filas,
    atlas: filas.find((f) => /Librer[ií]a de superficies/i.test(f.texto)) ?? null,
    total: (document.getElementById("ts-style-total")?.textContent ?? "").trim(),
    boton: (document.getElementById("ts-style-run")?.textContent ?? "").trim(),
    progreso: (document.getElementById("ts-style-progress")?.textContent ?? "").trim(),
  };
};

/** La cifra en dólares de un texto, o `null`. Se lee la ÚLTIMA: el comprobante
 *  lleva la suya al final («… y 0 skins nuevos ($0.15)»). */
const dolaresDe = (texto) => {
  const todas = [...String(texto).matchAll(/\$(\d+(?:\.\d+)?)/g)];
  return todas.length ? Number(todas[todas.length - 1][1]) : null;
};

export default async function (ctx) {
  /** Lo que el servidor cotizó por el cable en cada `resolve_only`, en orden.
   *  Es la única fuente de la cifra del wire: repetir la cuenta aquí sería otra
   *  copia del empaquetador, que es el defecto que esta PR arregla. */
  const cotizaciones = [];
  await ctx.page.route("**/generate_surface_atlas", async (route) => {
    const res = await route.fetch();
    const texto = await res.text();
    let pedido = {};
    try {
      pedido = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      pedido = {};
    }
    if (pedido.resolve_only === true) {
      try {
        const cuerpo = JSON.parse(texto);
        cotizaciones.push({ missing: cuerpo.missing, usd: cuerpo.quoted_cost_usd });
      } catch {
        // Respuesta que no es JSON: este guion ya no mide lo que dice, y que
        // fallen sus asertos en vez de este interceptor.
      }
    }
    await route.fulfill({ response: res, body: texto });
  });

  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });

  // ── 1 · un plan de precio EXACTO: solo el atlas ─────────────────────────
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const frio = await ctx.page.evaluate(fotoDelPanel);
  ctx.log(`plan en frío: ${JSON.stringify(frio.filas.map((f) => f.texto))}`);

  if (!frio.atlas || frio.atlas.apagada !== false) {
    ctx.sinMedir(
      `el bloque del atlas no tiene nada que pintar («${frio.atlas?.texto ?? "(no está)"}»): ` +
        "sin gasto no hay promesa que comparar con un comprobante",
    );
  }

  // Se apaga TODO lo que no sea el atlas: un plan con una cota («hasta $X») o
  // con un bloque sin precio («+ ?») no se puede comparar al céntimo con el
  // comprobante, y lo que se afirma aquí es una igualdad, no un parecido.
  const marcar = (idx, on) =>
    ctx.page.evaluate(
      ({ i, v }) => {
        const cb = document.querySelector(`#ts-style-plan input[data-block-idx="${i}"]`);
        cb.checked = v;
        cb.dispatchEvent(new Event("change"));
      },
      { i: idx, v: on },
    );
  for (const f of frio.filas) {
    if (f.idx !== null && f.apagada === false && f !== frio.atlas) await marcar(f.idx, false);
  }
  await marcar(frio.atlas.idx, true);

  const prometido = await ctx.page.evaluate(fotoDelPanel);
  ctx.log(`promesa: total «${prometido.total}» · botón «${prometido.boton}»`);
  ctx.log(`cotizaciones del servidor (frío): ${JSON.stringify(cotizaciones)}`);
  const laPromesa = dolaresDe(prometido.boton);
  ctx.expect(
    "PRECONDICIÓN — con solo el atlas encendido la promesa es una cifra EXACTA (ni «hasta» ni «+ ?»)",
    laPromesa !== null && !/hasta|\+\s*\?|no disponible/i.test(prometido.boton),
    `botón «${prometido.boton}»`,
  );
  await ctx.shot("promesa-exacta-antes-de-pagar");

  // ── El pago ─────────────────────────────────────────────────────────────
  await ctx.page.click("#ts-style-run");
  // Se espera al DESENLACE, no al reloj (el cliente mete un setTimeout(1200)
  // entre el comprobante y la vuelta al selector). Los dos finales posibles se
  // nombran para que el guion pare sabiendo cuál salió:
  //   · el comprobante «Estilo aplicado…» → lo que este guion mide;
  //   · un error en rojo en el hueco      → el batch no llegó a pagar.
  const desenlace = await ctx.expectEspera(
    "tras pulsar, la pantalla dice en qué acabó el batch",
    true,
    () => {
      const t = (document.getElementById("ts-style-progress")?.textContent ?? "").trim();
      if (/Estilo aplicado/.test(t)) return t;
      if (/^\s*$/.test(t)) return null;
      return /celdas|skins|Pintando|Completando|Protegiendo|Vistiendo/i.test(t) ? null : t;
    },
    { ms: 240_000 },
  );
  ctx.log(`comprobante: «${desenlace.ultimo}»`);
  await ctx.shot("comprobante-del-gasto");

  if (!/Estilo aplicado/.test(String(desenlace.ultimo))) {
    ctx.sinMedirBloque(
      `el batch no llegó a pagar («${desenlace.ultimo}»): sin comprobante no hay factura que ` +
        "comparar con la promesa",
    );
    return;
  }
  const elComprobante = dolaresDe(desenlace.ultimo);
  ctx.expect(
    "el importe que prometió el botón es, AL CÉNTIMO, el que el comprobante dice que se pagó",
    elComprobante !== null && Math.abs(elComprobante - laPromesa) < 0.005,
    `prometido $${laPromesa?.toFixed(2)} · comprobante «${desenlace.ultimo}»`,
  );

  // ── 2 y 3 · la caché CALIENTE: lo pagado no se vuelve a cotizar ─────────
  const cotizacionesFrias = cotizaciones.length;
  await ctx.waitFor("el cliente vuelve al selector de mundos", () =>
    Boolean(document.getElementById("ts-apply-style")),
  );
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const caliente = await ctx.page.evaluate(fotoDelPanel);
  const trasPagar = cotizaciones.slice(cotizacionesFrias);
  ctx.log(`plan con la caché caliente: ${JSON.stringify(caliente.filas.map((f) => f.texto))}`);
  ctx.log(`cotizaciones del servidor (caliente): ${JSON.stringify(trasPagar)}`);

  if (trasPagar.length === 0) {
    ctx.sinMedirBloque(
      "la segunda apertura del panel no volvió a preguntar al servidor: sin cotización nueva " +
        "no se puede afirmar qué cotiza con la caché caliente",
    );
  } else {
    ctx.expect(
      "tras pagar, el servidor cotiza $0.00 por las mismas celdas: no «más barato», CERO",
      trasPagar.every((c) => c.usd === 0),
      JSON.stringify(trasPagar),
    );
  }
  ctx.expect(
    "…y la pantalla lo dice: la fila del atlas pasa a «en caché ($0)» y no a un precio nuevo",
    Boolean(caliente.atlas) && /en cach[eé] \(\$0\)/i.test(caliente.atlas.texto),
    `«${caliente.atlas?.texto ?? "(no está la fila)"}»`,
  );
  ctx.expect(
    "…con la casilla DESHABILITADA, que es lo único que impide repagar lo pagado con un click",
    caliente.atlas?.apagada === true,
    `«${caliente.atlas?.texto}» disabled=${caliente.atlas?.apagada}`,
  );
  await ctx.shot("plan-con-la-cache-caliente");

  await ctx.page.click("#ts-style-cancel");
}
