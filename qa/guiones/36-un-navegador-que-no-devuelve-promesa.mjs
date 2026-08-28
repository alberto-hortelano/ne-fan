/** #268. `paso()` recibe algo que NO es una promesa porque el navegador no la
 *  devuelve, y tiene que tolerarlo SIN callarse.
 *
 *  POR QUÉ EXISTE. El plan y el informe de la tanda declararon esta rama «no
 *  verificable»: en Chrome `requestPointerLock()` siempre devuelve promesa, así
 *  que —dijeron— lo único que se puede probar es el TIPO (`tsc` rechaza
 *  `paso(42)`) y la rama `undefined` no la ejerce nadie. Eso deja el arreglo de
 *  #268 sin nada que pueda ponerse rojo en ejecución: el tipo canda a quien
 *  ESCRIBE mal la llamada, no al navegador que devuelve `undefined`, que es
 *  justo el sujeto del issue.
 *
 *  Y sí se puede ejercer, sin tocar una línea de producción: lo que cambia
 *  entre Chrome y Firefox es `Element.prototype.requestPointerLock`, así que se
 *  sustituye ESE seam en `addInitScript` —el mismo patrón con el que el guion
 *  35 se queda con el WebSocket y el 11 cuenta contextos WebGL— y el cliente
 *  se encuentra exactamente el navegador que describe el issue. No se fuerza
 *  ningún estado del juego ni se oculta nada: se cambia el NAVEGADOR, que es
 *  la variable del issue.
 *
 *  LAS TRES COSAS QUE SE MIDEN, y las tres pueden ponerse rojas:
 *   1. que el seam se ejerza de verdad (control: si el click no llega al
 *      lienzo, todo lo demás es un verde vacío);
 *   2. que NO reviente — antes de #268 `undefined.catch` lanzaba un `TypeError`
 *      sin recoger en CADA click sobre el lienzo, que es el bug del issue;
 *   3. que deje RASTRO y una sola vez — tolerar en silencio es lo que `paso()`
 *      existe para no hacer, e inundar el registro con una entrada por click
 *      es la otra forma de no decir nada.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, y este guion ni siquiera abre
 *  partida — el lienzo y su listener existen desde el arranque.
 */
import { esperarListaDeSaves, esperarTituloListo } from "../lib/sesion.mjs";

/** Cuántas veces se pulsa el lienzo. Más de una porque la mitad del criterio
 *  es que el aviso NO se repita: con una sola pulsación, «avisa una vez» y
 *  «avisa por click» son el mismo verde. */
const PULSACIONES = 3;

/** El texto con el que `paso()` etiqueta la captura del ratón (`main.ts`).
 *  Se busca por aquí y no por «promesa» para que el aserto siga midiendo lo
 *  del jugador —qué se estaba intentando— y no la redacción del aviso. */
const LO_QUE_SE_INTENTABA = "pointer lock";

export default async function (ctx) {
  // ── 0 · Un navegador que no devuelve promesa ────────────────────────────
  // Firefox resuelve `requestPointerLock()` devolviendo `undefined`. Se
  // instala ANTES de que cargue la app (el listener del lienzo se registra en
  // el arranque) y se cuenta cada llamada, que es el control del bloque 1.
  await ctx.page.addInitScript(() => {
    window.__qaLock = { llamadas: 0 };
    Element.prototype.requestPointerLock = function () {
      window.__qaLock.llamadas++;
      return undefined;
    };
    // Lo que reventaría con el `promesa.catch(…)` pelado: un rechazo síncrono
    // dentro del listener del click, que sale del cliente sin recoger.
    window.__qaErrores = [];
    window.addEventListener("error", (e) => {
      window.__qaErrores.push(String(e.message ?? e.error ?? "error sin mensaje"));
    });
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // Se cierra el título POR SU BOTÓN (modo fixtures, sin sesión): con el
  // overlay delante el lienzo no recibe clicks, y ocultarlo a mano sería el
  // workaround que este rol tiene prohibido.
  await ctx.nefan("closeTitle");
  await ctx.waitFor(
    "el título está cerrado y el lienzo a la vista",
    () => (document.documentElement.dataset.titulo === "0" ? { titulo: "0" } : null),
  );

  // ── 1 · El click llega al LIENZO, no a la interfaz de encima ────────────
  // Se comprueba antes de pulsar: si `#game-ui` interceptara el punto, el
  // «no reventó» de abajo solo diría que nunca se intentó capturar el ratón.
  const punto = await ctx.page.evaluate(() => {
    const c = document.getElementById("fps-canvas");
    const r = c.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height * 0.5);
    const encima = document.elementFromPoint(x, y);
    return { x, y, golpea: encima?.id || encima?.tagName || null, esElLienzo: encima === c };
  });
  ctx.log(`punto del lienzo: ${JSON.stringify(punto)}`);
  ctx.expect(
    "el click del jugador llega al lienzo (si no, no se pide el pointer lock y no se mide nada)",
    punto.esElLienzo,
    JSON.stringify(punto),
  );

  const antes = await ctx.page.evaluate(() => ({
    llamadas: window.__qaLock.llamadas,
    errores: [...window.__qaErrores],
    registro: [...document.querySelectorAll("#error-log .error-log__msg")].map(
      (e) => e.textContent ?? "",
    ),
  }));

  for (let i = 0; i < PULSACIONES; i++) {
    await ctx.page.mouse.click(punto.x, punto.y);
  }
  // Todo el camino es síncrono (listener → `paso()` → `errors.push` → render),
  // pero el click viaja por CDP: se espera por el ESTADO que produce, nunca
  // por reloj.
  await ctx.waitFor(
    `el lienzo ha pedido el pointer lock ${PULSACIONES} veces`,
    (n) => (window.__qaLock.llamadas >= n ? { llamadas: window.__qaLock.llamadas } : null),
    15_000,
    PULSACIONES,
  );

  const despues = await ctx.page.evaluate(() => ({
    llamadas: window.__qaLock.llamadas,
    errores: [...window.__qaErrores],
    registro: [...document.querySelectorAll("#error-log .error-log__msg")].map(
      (e) => e.textContent ?? "",
    ),
  }));
  ctx.log(`antes: ${JSON.stringify(antes)}`);
  ctx.log(`después: ${JSON.stringify(despues)}`);

  ctx.expect(
    "el navegador emulado NO devolvió promesa y el cliente se lo pidió de verdad (control)",
    despues.llamadas - antes.llamadas >= PULSACIONES,
    `${antes.llamadas} → ${despues.llamadas} llamadas a requestPointerLock`,
  );

  // ── 2 · No revienta ─────────────────────────────────────────────────────
  // El bug del issue: `promesa.catch(…)` sobre `undefined` lanza un TypeError
  // dentro del listener del click, en CADA click sobre el lienzo, y el cliente
  // no tiene handler de `unhandledrejection` que lo recoja.
  const nuevos = despues.errores.filter((m) => !antes.errores.includes(m));
  ctx.expect(
    "clicar el lienzo NO lanza un error sin recoger en un navegador sin promesa (#268)",
    nuevos.length === 0,
    JSON.stringify(nuevos),
  );

  // ── 3 · Deja rastro, y UNA vez ──────────────────────────────────────────
  // Las dos mitades son el criterio: sin entrada, `paso()` estaría tolerando
  // en silencio —lo que existe para no hacer—; una por click inunda el panel
  // de quien juegue en Firefox y un registro inundado no se lee.
  const nuevasEntradas = despues.registro.filter((m) => !antes.registro.includes(m));
  const delPointerLock = nuevasEntradas.filter((m) => m.includes(LO_QUE_SE_INTENTABA));
  ctx.log(`entradas nuevas del registro: ${JSON.stringify(nuevasEntradas)}`);
  ctx.expect(
    "…y queda RASTRO en el registro de errores: tolerar no es callar (#268)",
    delPointerLock.length >= 1,
    JSON.stringify(nuevasEntradas),
  );
  ctx.expect(
    `…una SOLA vez, no una por cada uno de los ${PULSACIONES} clicks`,
    delPointerLock.length === 1,
    `${delPointerLock.length} entradas: ${JSON.stringify(delPointerLock)}`,
  );
  // Y que el aviso DIGA algo. `every` sobre una lista vacía es verdad, así que
  // este aserto se escribe sobre la entrada concreta: sin entrada es rojo, no
  // un verde por vacío — la trampa que este mismo guion vino a cazar.
  const aviso = delPointerLock[0] ?? "";
  ctx.expect(
    "…y el aviso dice qué se intentaba Y por qué no se puede informar del fallo",
    aviso.includes(LO_QUE_SE_INTENTABA) && aviso.includes("no devuelve promesa"),
    JSON.stringify(aviso),
  );
  await ctx.shot("el-navegador-sin-promesa-deja-rastro");
}
