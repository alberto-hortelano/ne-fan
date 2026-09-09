/** IR Y VOLVER de una pantalla del título, cuatro veces, sin dejar rastro.
 *
 *  Escrito con la PR 2 de #346 («El título troceado»), que es la primera que
 *  saca una PANTALLA entera de `ui/title-screen.ts` a su propio módulo
 *  (`ui/titulo/subir-estilo.ts`) y la primera que estrena el callback
 *  `ir(destino)`: una hoja del título no puede llamar a otra —lo impide el
 *  candado `las-hojas-del-titulo-no-se-atan-entre-si`—, así que «Volver» ya no
 *  es `this.renderWorldSelect()` sino un callback que resuelve la raíz.
 *
 *  QUÉ MIDE, y por qué no lo mide nadie más. Las cinco PR que quedan mueven
 *  cinco pantallas más por el mismo camino, y el modo de fallo de un
 *  movimiento así no es que la pantalla salga fea —eso se ve— sino que la hoja
 *  se quede ENGANCHADA a algo que sobrevive a su repintado: un listener sobre
 *  `document`, `window`, `#title-screen` o `content`, un `<style>` que se
 *  vuelve a inyectar, un nodo que se añade a la raíz. Nada de eso se ve en una
 *  sola visita: se ve a la CUARTA, cuando el mismo click hace cuatro cosas o
 *  cuando la columna tiene tres bandas de «hay más partidas» encima. El plan
 *  de la tanda lo llama riesgo 4 y dice que ningún test verde lo ve; esto es
 *  lo que lo ve.
 *
 *  Las tres afirmaciones son distintas y las tres hacen falta:
 *   1. EL CHASIS no crece: `#title-screen` sigue con sus tres hijos
 *      (`content`, `#ts-mas`, `#ts-close`) y `#title-screen-responsive` sigue
 *      siendo uno solo, visita tras visita.
 *   2. LA PANTALLA es la misma cada vez: el digest estructural de lo pintado
 *      —etiquetas, ids, atributos y texto— es idéntico en las cuatro visitas.
 *      Una hoja que acumulara estado propio entre visitas saldría aquí.
 *   3. UN CLICK, UNA FILA: «+ otra imagen» añade EXACTAMENTE una fila en la
 *      cuarta visita igual que en la primera. Es el control positivo del
 *      listener duplicado, que es la avería concreta que (1) y (2) no verían
 *      si la hoja se enganchara a un nodo que ella misma recrea.
 *
 *  Y de paso mide lo único que el callback nuevo puede romper de forma
 *  invisible: que «Volver» VUELVE — cuatro veces, no una.
 *
 *  Cero créditos: no arranca partida, no pide una sola imagen y no toca el
 *  motor. Solo el título contra el bridge del preset sin créditos.
 */
import { abrirSelectorDeMundos, recargarAlTitulo } from "../lib/sesion.mjs";

export const sinMotor =
  "recorre el título (selector ⇄ subir estilo) y nunca arranca partida ni pide generación";

const VISITAS = 4;

/** Digest de lo pintado: etiquetas, ids, atributos y texto con los espacios
 *  colapsados. Los espacios se colapsan a propósito — la sangría del HTML
 *  fuente no es lo que ve el jugador, y esta pantalla cambió de sangría al
 *  pasar de método de clase a función de módulo. */
function digestEnLaPagina() {
  const raiz = document.getElementById("title-screen");
  const content = raiz?.firstElementChild;
  if (!content) return null;
  const out = [];
  const anda = (n, prof) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(`${prof}"${t}"`);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const attrs = [...n.attributes]
      .map((a) => `${a.name}=${a.value.replace(/\s+/g, " ").trim()}`)
      .sort()
      .join(" ");
    out.push(`${prof}<${n.tagName.toLowerCase()} ${attrs}>`);
    for (const h of n.childNodes) anda(h, prof + 1);
  };
  for (const h of content.childNodes) anda(h, 0);
  return out.join("\n");
}

export default async function (ctx) {
  await recargarAlTitulo(ctx);
  await abrirSelectorDeMundos(ctx);

  const chasis = () =>
    ctx.page.evaluate(() => {
      const raiz = document.getElementById("title-screen");
      return {
        hijos: raiz ? raiz.children.length : -1,
        ids: raiz ? [...raiz.children].map((c) => c.id || "(content)").join(",") : "",
        responsive: document.querySelectorAll("#title-screen-responsive").length,
        mas: document.querySelectorAll("#ts-mas").length,
        cerrar: document.querySelectorAll("#ts-close").length,
      };
    });

  const antes = await chasis();
  ctx.log(`chasis al entrar: ${JSON.stringify(antes)}`);
  ctx.expect(
    "el chasis del título son sus tres hijos de siempre (content, #ts-mas, #ts-close)",
    antes.hijos === 3 && antes.ids === "(content),ts-mas,ts-close",
    JSON.stringify(antes),
  );

  const digests = [];
  const filas = [];
  for (let v = 1; v <= VISITAS; v++) {
    await ctx.page.click("#ts-upload-style");
    await ctx.page.waitForSelector("#ts-style-name", { timeout: 30_000 });

    digests.push(await ctx.page.evaluate(digestEnLaPagina));

    // Control positivo del listener duplicado: un click, una fila.
    const conteo = await ctx.page.evaluate(() => {
      const cuenta = () => document.querySelectorAll("[data-upload-row]").length;
      const antes = cuenta();
      document.getElementById("ts-add-row").click();
      return { antes, despues: cuenta() };
    });
    filas.push(conteo);

    if (v === 1) await ctx.shot("subir-estilo-visita-1");
    if (v === VISITAS) await ctx.shot(`subir-estilo-visita-${VISITAS}`);

    await ctx.page.click("#ts-back");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  }

  ctx.log(`filas por click: ${JSON.stringify(filas)}`);
  ctx.expect(
    `«Volver» vuelve al selector las ${VISITAS} veces (el callback ir(destino), no una llamada entre hojas)`,
    digests.length === VISITAS && digests.every((d) => typeof d === "string" && d.length > 0),
    `digests: ${digests.map((d) => (d ? d.length : d)).join(", ")}`,
  );
  ctx.expect(
    "«+ otra imagen» añade UNA fila en la última visita igual que en la primera",
    filas.every((f) => f.despues === f.antes + 1),
    JSON.stringify(filas),
  );
  ctx.expect(
    `la pantalla de subida se pinta IGUAL en las ${VISITAS} visitas (ninguna acumula estado)`,
    digests.every((d) => d === digests[0]),
    digests
      .map((d, i) => `${i + 1}: ${d === digests[0] ? "igual" : "DISTINTA"}`)
      .join(" · "),
  );

  const despues = await chasis();
  ctx.log(`chasis al salir: ${JSON.stringify(despues)}`);
  ctx.expect(
    `tras ${VISITAS} idas y vueltas el chasis sigue siendo el mismo (ninguna hoja cuelga nada de la raíz)`,
    JSON.stringify(despues) === JSON.stringify(antes),
    `${JSON.stringify(antes)} → ${JSON.stringify(despues)}`,
  );
  ctx.expect(
    "sigue habiendo UN solo <style> del título y UN solo #ts-close (nada se re-inyecta al repintar)",
    despues.responsive === 1 && despues.cerrar === 1 && despues.mas === 1,
    JSON.stringify(despues),
  );
}
