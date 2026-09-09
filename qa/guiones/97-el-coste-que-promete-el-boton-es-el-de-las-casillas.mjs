/** EL COSTE QUE PROMETE EL BOTÓN ES EL DE LAS CASILLAS ENCENDIDAS.
 *
 *  El panel de «Aplicar estilo» (`ui/titulo/plan-de-estilo.ts` desde la PR 2 de
 *  #346) es la pantalla donde el jugador ACEPTA GASTAR: enseña un plan por
 *  bloques con su precio, deja encender y apagar cada bloque, y estampa la
 *  cifra resultante en el propio botón que dispara el batch de pago. Entre lo
 *  que dicen las casillas y lo que promete el botón hay tres pasos de código
 *  —el filtro `selected && missing > 0`, la suma con `?? 0` y el rótulo—, y un
 *  error en cualquiera de ellos cobra de más sin que nadie lo note: el jugador
 *  no puede sumar los bloques a mano, porque el desglose y el total están en la
 *  misma pantalla y ninguno de los dos es la factura.
 *
 *  QUÉ MIDE, Y POR QUÉ NO LO MIDE NADIE MÁS. El guion 07 mira la otra mitad —
 *  que el batch EMITA los skins que su plan anunció— pero entra al panel, lee
 *  el texto y pulsa: nunca toca una casilla, así que no ve el filtro ni la
 *  suma. El 72 solo mira si `#ts-apply-style` está deshabilitado. O sea que hoy
 *  nadie comprueba lo primero que el jugador hace en esa pantalla, que es
 *  quitar bloques para pagar menos.
 *
 *  Las afirmaciones NO están escritas contra números fijos del bench: se
 *  derivan de las ETIQUETAS que el propio panel pinta (`… — ~$0.30`,
 *  `… — en caché ($0)`, `… — coste no disponible`), así que valen con
 *  cualquier mundo, estilo y estado de caché. Lo que se afirma es la RELACIÓN
 *  entre lo que se lee y lo que se promete:
 *
 *   1. El total es la suma EXACTA de las casillas encendidas con precio, y el
 *      botón repite esa misma cifra.
 *   2. Un bloque ya en caché lleva la casilla DESHABILITADA, que es lo único
 *      que impide encenderlo y repagar lo que ya está pagado.
 *   3. Apagar un bloque BAJA el total exactamente su precio, y volver a
 *      encenderlo lo devuelve. Es el paso que el jugador da para gastar menos.
 *   4. Con nada encendido el botón NO promete gasto: dice «Registrar (sin
 *      coste)».
 *   5. Si hay un bloque sin precio, el total y el botón lo dicen con «+ ?» en
 *      vez de tragárselo como 0 — un coste desconocido que desaparece del
 *      total es la forma más barata de cobrar de más.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más: que un bloque en
 *  caché no sume en el total. En el bench su precio interno es 0, así que
 *  meterlo en el filtro de la suma no mueve la cifra y sale verde igual
 *  (medido: sonda S1 de qa-2.md). Lo que sí queda candado es la casilla
 *  deshabilitada — sin ella el jugador puede encenderlo.
 *
 *  CERO CRÉDITOS Y CERO GASTO: este guion NUNCA pulsa `#ts-style-run`. Genera
 *  su mundo con el motor falso (como el 07) y sale por «Cancelar».
 *
 *  EN NEGATIVO (probado al escribirlo, cada sonda revertida — ver qa-2.md):
 *  tragarse el bloque sin precio (`sinPrecio = false`) pone rojo (5); dejar el
 *  rótulo del botón sin la cifra pone rojo (1) y (5); ignorar `selected` en el
 *  filtro de la suma pone rojo (3); quitar el `disabled` del bloque en caché
 *  pone rojo (2).
 */
import { nuevaPartida, regenerarMundo } from "../lib/sesion.mjs";

/** Precondición DECLARADA, las dos por el mismo motivo que el guion 07:
 *   · `mundo`   — el plan deriva su roster del snapshot del mundo; heredar el
 *                 de otro guion es leer SU roster.
 *   · `fake-ai` — el motor falso cachea en memoria de proceso las páginas de
 *                 atlas ya «pintadas», y un plan con la caché caliente llega
 *                 con TODOS sus bloques a «en caché ($0)». Medido en la
 *                 batería entera: sin esto el plan sale «23 celdas, 0 por
 *                 pintar» y este guion se queda sin ningún bloque con precio
 *                 que apagar — o sea, sin la mitad que mide. */
export const aisla = ["mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** Lo que el panel PINTA en cada casilla, tal como lo lee el jugador. El
 *  precio se saca del rótulo (`— ~$0.30`, `— $0.30`), no de ninguna API: si el
 *  rótulo y el total dejaran de contar lo mismo, esa divergencia es justo lo
 *  que hay que ver. */
function leerElPanel() {
  const filas = [...document.querySelectorAll("#ts-style-plan label")].map((l) => {
    const cb = l.querySelector("input[data-block-idx]");
    const texto = (l.textContent ?? "").replace(/\s+/g, " ").trim();
    const m = /—\s*~?\$(\d+(?:\.\d+)?)\s*$/.exec(texto);
    return {
      idx: Number(cb?.dataset.blockIdx ?? -1),
      texto,
      checked: Boolean(cb?.checked),
      disabled: Boolean(cb?.disabled),
      enCache: /en cach[eé] \(\$0\)/i.test(texto),
      sinPrecio: /coste no disponible/i.test(texto),
      precio: m ? Number(m[1]) : null,
    };
  });
  const totalEl = document.getElementById("ts-style-total");
  const runEl = document.getElementById("ts-style-run");
  return {
    filas,
    total: (totalEl?.textContent ?? "").trim(),
    boton: (runEl?.textContent ?? "").trim(),
  };
}

/** La cifra que la pantalla enseña, y si además admite que hay algo sin
 *  precio. `null` cuando la pantalla dice que no hay nada que gastar. */
const cifraDe = (texto) => {
  if (/Nada seleccionado|Registrar \(sin coste\)/.test(texto)) return null;
  const m = /~?\$(\d+(?:\.\d+)?)(\s*\+\s*\?)?/.exec(texto);
  return m ? { valor: Number(m[1]), masInterrogante: Boolean(m[2]) } : undefined;
};

/** Lo que el jugador DEBERÍA leer, derivado de las casillas: la suma de las
 *  encendidas con precio, y si alguna encendida no lo tiene. */
const esperadoDe = (filas) => {
  const activos = filas.filter((f) => f.checked && !f.enCache);
  return {
    valor: Number(activos.reduce((a, f) => a + (f.precio ?? 0), 0).toFixed(2)),
    masInterrogante: activos.some((f) => f.sinPrecio),
    hayAlgo: activos.length > 0,
  };
};

const marcar = (ctx, idx, encendida) =>
  ctx.page.evaluate(
    ({ i, on }) => {
      const cb = document.querySelector(`#ts-style-plan input[data-block-idx="${i}"]`);
      cb.checked = on;
      cb.dispatchEvent(new Event("change"));
    },
    { i: idx, on: encendida },
  );

export default async function (ctx) {
  // El mundo lo genera ESTE guion (el runner acaba de borrar el que hubiera):
  // sin snapshot, «Aplicar estilo» está deshabilitado y no hay panel que leer.
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "image" });

  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });

  const inicial = await ctx.page.evaluate(leerElPanel);
  ctx.log(`plan: ${JSON.stringify(inicial.filas.map((f) => f.texto))}`);
  ctx.log(`total «${inicial.total}» · botón «${inicial.boton}»`);

  ctx.expect(
    "PRECONDICIÓN — el panel ofrece bloques con su rótulo (si no, no hay nada que sumar)",
    inicial.filas.length > 0,
    JSON.stringify(inicial.filas.length),
  );

  // ── 1 · el total es la suma de lo encendido, y el botón repite la cifra ──
  const esp = esperadoDe(inicial.filas);
  const leidoTotal = cifraDe(inicial.total);
  const leidoBoton = cifraDe(inicial.boton);
  ctx.expect(
    "el total es la suma EXACTA de las casillas encendidas con precio",
    esp.hayAlgo
      ? leidoTotal !== null && leidoTotal !== undefined && leidoTotal.valor === esp.valor
      : leidoTotal === null,
    `casillas ⇒ ${JSON.stringify(esp)} · pantalla ⇒ «${inicial.total}»`,
  );
  ctx.expect(
    "el botón que dispara el gasto promete la MISMA cifra que el total",
    JSON.stringify(leidoBoton) === JSON.stringify(leidoTotal),
    `botón «${inicial.boton}» vs total «${inicial.total}»`,
  );

  // ── 2 · lo que está en caché NO SE PUEDE ENCENDER ────────────────────────
  //  Se afirma la casilla deshabilitada y no «no suma»: ver «LO QUE NO MIDE».
  const enCache = inicial.filas.filter((f) => f.enCache);
  if (enCache.length === 0) {
    ctx.sinMedirBloque(
      "el plan de este mundo no trae ningún bloque en caché: no hay «no se repaga» que medir",
    );
  } else {
    ctx.expect(
      "un bloque ya en caché lleva la casilla DESHABILITADA (es lo que impide repagarlo)",
      enCache.every((f) => f.disabled),
      JSON.stringify(enCache.map((f) => ({ texto: f.texto, disabled: f.disabled }))),
    );
  }

  // ── 5 · un bloque sin precio se dice con «+ ?», no se traga como 0 ───────
  const sinPrecio = inicial.filas.filter((f) => f.checked && f.sinPrecio);
  if (sinPrecio.length === 0) {
    ctx.sinMedirBloque("ningún bloque encendido viene sin precio: no hay «+ ?» que medir");
  } else {
    ctx.expect(
      "un bloque encendido SIN precio no desaparece del total: se dice con «+ ?»",
      leidoTotal !== null && leidoTotal !== undefined && leidoTotal.masInterrogante,
      `«${inicial.total}»`,
    );
    ctx.expect(
      "…y el botón tampoco se lo traga",
      leidoBoton !== null && leidoBoton !== undefined && leidoBoton.masInterrogante,
      `«${inicial.boton}»`,
    );
  }

  // ── 3 · apagar un bloque baja el total EXACTAMENTE su precio ─────────────
  const conPrecio = inicial.filas.filter((f) => f.checked && !f.disabled && f.precio !== null);
  if (conPrecio.length === 0) {
    ctx.sinMedirBloque("ningún bloque encendido tiene precio: no hay resta que medir");
  } else {
    for (const f of conPrecio) {
      await marcar(ctx, f.idx, false);
      const apagado = await ctx.page.evaluate(leerElPanel);
      const espApagado = esperadoDe(apagado.filas);
      const leido = cifraDe(apagado.total);
      ctx.expect(
        `apagar «${f.texto.slice(0, 40)}…» baja el total exactamente sus $${f.precio.toFixed(2)}`,
        espApagado.hayAlgo
          ? leido !== null && leido !== undefined && leido.valor === espApagado.valor
          : leido === null,
        `esperado ${JSON.stringify(espApagado)} · pantalla «${apagado.total}»`,
      );
      await marcar(ctx, f.idx, true);
      const devuelto = await ctx.page.evaluate(leerElPanel);
      ctx.expect(
        "…y volver a encenderlo devuelve el total de partida",
        devuelto.total === inicial.total && devuelto.boton === inicial.boton,
        `«${devuelto.total}» vs «${inicial.total}»`,
      );
    }
  }

  // ── 4 · con nada encendido, el botón no promete gasto ────────────────────
  for (const f of inicial.filas) if (!f.disabled) await marcar(ctx, f.idx, false);
  const vacio = await ctx.page.evaluate(leerElPanel);
  ctx.log(`sin nada encendido: total «${vacio.total}» · botón «${vacio.boton}»`);
  ctx.expect(
    "sin ninguna casilla encendida el botón NO promete gasto («Registrar (sin coste)»)",
    vacio.boton === "Registrar (sin coste)" && /Nada seleccionado/.test(vacio.total),
    `total «${vacio.total}» · botón «${vacio.boton}»`,
  );
  await ctx.shot("plan-de-coste-sin-nada-encendido");

  // ── Salir por «Cancelar»: ni un céntimo, y el selector sigue en pie ──────
  await ctx.page.click("#ts-style-cancel");
  const tras = await ctx.page.evaluate(() => ({
    hueco: (document.getElementById("ts-style-plan")?.innerHTML ?? "?").trim(),
    mundos: document.querySelectorAll("[data-game-id]").length,
    aplicar: Boolean(document.getElementById("ts-apply-style")),
  }));
  ctx.expect(
    "«Cancelar» cierra el panel sin gastar y deja el selector de mundos en pie",
    tras.hueco === "" && tras.mundos > 0 && tras.aplicar,
    JSON.stringify(tras),
  );
}
