/** El hook que carga fixtures no puede decir «hecho» antes de tiempo (#308).
 *
 *  POR QUÉ EXISTE, teniendo el 22 y el 24 delante. Los tres miran el mismo
 *  arreglo desde sitios distintos, y este cubre el hueco que dejaron los otros
 *  dos:
 *
 *   · el **22** afirma QUÉ escena midió, y lo afirma DESPUÉS de soltar la
 *     compuerta: mide el estado final, no el instante. Además el contrato solo
 *     está vigilado ahí como efecto lateral de un guion cuyo sujeto es el
 *     telegraph — el día que alguien reordene sus bloques o le deje una sola
 *     fixture, el arreglo de producción se queda sin candado.
 *   · el **24** afirma la otra mitad, el RECHAZO cuando el JSON no llega.
 *   · aquí se afirma el INSTANTE, que es lo que de verdad se rompió: con el
 *     JSON retenido en el borde de la red, la promesa de `loadFixture` tiene
 *     que seguir PENDIENTE, y al asentarse el mundo tiene que ser ya la fixture
 *     pedida. Un hook que resolviera al despachar el evento (el defecto de
 *     #308) o al recibir la respuesta pero antes de instalar la escena pasa los
 *     dos asertos de arriba y se pone rojo aquí.
 *
 *  Y REPRODUCE EL CAMINO DEL BUG, que es la parte que no era re-ejecutable.
 *  `qa/bateria-candados-en-negativo.mjs` rompe `loadFixture` para TODAS las
 *  cargas, así que el rojo del 22 cae en su bloque 1 —la PRIMERA fixture— y el
 *  camino original de #308 (la SEGUNDA fixture medida como la primera) no se
 *  vuelve a ejercer. Medido por QA el 2026-08-30 dejando viva la primera carga
 *  y rompiendo solo las siguientes: el 22 de `main` salió **3 verdes y 1 roja
 *  de 4** con ese mismo defecto delante, y este bloque sale rojo **3 de 3**.
 *
 *  El orden de las fixtures es el INVERSO del 22 a propósito: si el defecto
 *  dependiera de cuál va primero —el puerto trae 57 calcos y el pueblo 14—, dos
 *  guiones con el mismo orden no se enterarían.
 *
 *  Cero créditos: no le pide nada al motor, solo el selector «Room».
 */

import { retenerFixture } from "../lib/fixtures.mjs";

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA al
 *  motor. Solo conduce el selector de fixtures del panel de dev. */
export const sinMotor = "carga dos fixtures del selector con el JSON de la segunda retenido; nunca arranca partida";

/** Las dos, NOMBRADAS y en el orden contrario al del guion 22. */
const PRIMERA = "robledo_tile";
const SEGUNDA = "puerto_tile";

/** Cuántos fotogramas se le dan a la carga retenida para (equivocadamente)
 *  asentarse. Se espera por FRAMES y nunca por reloj: es la única forma
 *  honesta de decir «ya ha dado tiempo», y la que exige
 *  `qa-guiones-sin-espera-por-reloj`. Con el hook correcto la promesa no puede
 *  asentarse por muchos frames que pasen —la respuesta está retenida—, así que
 *  esperar de más solo hace más fuerte el negativo. */
const FRAMES = 5;

async function esperarFrames(ctx, n = FRAMES) {
  const antes = (await ctx.nefan("fps")).frames;
  await ctx.waitFor(
    `${n} frames nuevos`,
    ({ f0, k }) => (window.__nefan.fps().frames >= f0 + k ? true : null),
    10_000,
    { f0: antes, k: n },
  );
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? true : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  // ── 1 · La primera fixture: PRECONDICIÓN, no el sujeto ───────────────────
  // A propósito NO se usa `cargarFixture` aquí, que AFIRMA. El sujeto de este
  // guion es la carga de la SEGUNDA fixture, y con el helper afirmativo en la
  // precondición cualquier regresión del hook mataría el guion en esta línea —
  // que es justo lo que le pasa al 22, cuyo rojo cae en su bloque 1 y deja el
  // camino de #308 (la segunda medida como la primera) sin ejercer. Aquí se
  // ESPERA a la precondición, y lo que se afirma viene después.
  await ctx.nefan("loadFixture", PRIMERA);
  const antes = await ctx.waitFor(
    `precondición: el mundo está en «${PRIMERA}»`,
    (f) => {
      const g = window.__nefan.fps();
      return window.__nefan.scene?.scene_id === f && g && g.ready && g.activeTile && g.suelo ? g : null;
    },
    20_000,
    PRIMERA,
  );
  ctx.log(`midiendo «${PRIMERA}»: ${antes.suelo.calcos} calcos · tile ${antes.activeTile}`);

  // ── 2 · La SEGUNDA, con su JSON retenido en el borde de la red ───────────
  // La compuerta es lo que hace CAUSAL al negativo: con la respuesta retenida
  // el módulo no PUEDE haber llegado, así que un hook que diga «hecho» miente
  // siempre, no dos de cada cuatro veces.
  const compuerta = await retenerFixture(ctx, SEGUNDA);
  await ctx.page.evaluate((f) => {
    window.__qa308 = { asentada: false, escenaAlAsentarse: undefined, error: null };
    const p = window.__nefan.loadFixture(f);
    window.__qa308.esPromesa = typeof p?.then === "function";
    // Se le ponen los DOS manejadores aquí mismo: un rechazo sin manejar sería
    // una excepción de página, y el runner la contaría como fallo de otra cosa.
    Promise.resolve(p).then(
      () => {
        window.__qa308.asentada = true;
        window.__qa308.escenaAlAsentarse = window.__nefan.scene?.scene_id ?? null;
      },
      (e) => {
        window.__qa308.asentada = true;
        window.__qa308.error = String(e);
      },
    );
  }, SEGUNDA);

  const esPromesa = await ctx.page.evaluate(() => window.__qa308.esPromesa === true);
  ctx.expect(
    "el hook de fixtures devuelve algo que se puede esperar (una promesa), no «nada»",
    esPromesa,
    `typeof (loadFixture("${SEGUNDA}")).then === "function": ${esPromesa}`,
  );

  await esperarFrames(ctx);
  const durante = await ctx.page.evaluate(() => ({
    asentada: window.__qa308.asentada,
    error: window.__qa308.error,
    escena: window.__nefan.scene?.scene_id ?? null,
  }));
  ctx.log(`con el JSON de ${SEGUNDA} retenido, tras ${FRAMES} frames: ${JSON.stringify(durante)}`);
  // NO CONCLUYENTE ANTES QUE VERDE: si el mundo ya fuera la segunda fixture, la
  // compuerta no estaría reteniendo nada y el aserto de abajo sería un verde
  // vacío.
  ctx.expect(
    `el mundo sigue en «${PRIMERA}» mientras el JSON de «${SEGUNDA}» está retenido`,
    durante.escena === PRIMERA,
    `escena «${durante.escena}»`,
  );
  ctx.expect(
    `…y la carga de «${SEGUNDA}» sigue PENDIENTE: el hook no dice «hecho» con la respuesta retenida (#308)`,
    durante.asentada === false,
    `asentada=${durante.asentada}${durante.error ? ` · ${durante.error}` : ""} con el mundo en «${durante.escena}»`,
  );

  // ── 3 · Se suelta, y lo que llega es lo que se pidió ─────────────────────
  const retenida = await compuerta.soltar();
  ctx.log(`compuerta sobre ${SEGUNDA}.json: ${JSON.stringify(retenida)}`);
  // El otro «no concluyente»: si la compuerta no llegó a retener (la fixture ya
  // estaba en el registro de módulos ESM, el patrón dejó de casar), el bloque 2
  // pasó por no haber probado nada.
  ctx.expect(
    "la compuerta retuvo de verdad el JSON de la fixture (si no, no hay negativo que valga)",
    retenida.interceptadas === 1 && !retenida.porCortafuegos && retenida.fallos.length === 0,
    JSON.stringify(retenida),
  );

  const asentada = await ctx.waitFor(
    `la carga de ${SEGUNDA} se asienta al soltar la compuerta`,
    () => (window.__qa308.asentada ? { ...window.__qa308, esPromesa: undefined } : null),
    20_000,
  );
  const despues = await ctx.nefan("fps");
  ctx.log(
    `midiendo «${await ctx.page.evaluate(() => window.__nefan.scene?.scene_id ?? null)}»: ` +
      `${despues.suelo.calcos} calcos · asentada con la escena en «${asentada.escenaAlAsentarse}»`,
  );
  ctx.expect(
    `la carga de «${SEGUNDA}» resuelve sin error`,
    asentada.error === null,
    `${asentada.error}`,
  );
  // Lo que el 22 no puede afirmar: en el INSTANTE en que la promesa se asienta,
  // la escena ya es la pedida. Un hook que resolviera con la respuesta HTTP
  // pero antes de instalar la escena dejaría aquí la anterior.
  ctx.expect(
    `…y cuando se asienta, el mundo YA es «${SEGUNDA}»: la promesa no va por delante del estado`,
    asentada.escenaAlAsentarse === SEGUNDA,
    `escena al asentarse: «${asentada.escenaAlAsentarse}»`,
  );
  // Y el tell, que es el único número que separa una fixture de la otra: el
  // puerto trae 57 calcos y el pueblo 14. Sin él, «la escena cambió» se podría
  // afirmar sobre un `scene_id` que nadie pintó.
  ctx.expect(
    `el suelo que se mide ahora es el de «${SEGUNDA}» y no el de «${PRIMERA}»`,
    despues.suelo.calcos !== antes.suelo.calcos,
    `${despues.suelo.calcos} calcos ahora · ${antes.suelo.calcos} antes`,
  );
}
