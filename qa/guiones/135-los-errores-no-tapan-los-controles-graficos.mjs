/** #509/#497: un registro largo no intercepta los controles de gasto.
 * Se llena el registro real; los gestos son clicks de Playwright, sin force.
 * Encender solo ARMA la confirmación: no hace falta gastar para medir el click.
 * Cero créditos, sobre el motor falso del runner. */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  await ctx.page.evaluate(async () => {
    const { errors } = await import("/src/ui/error-log.ts");
    for (let i = 0; i < 20; i++) errors.push("scene", `QA509: error ${i}: diagnóstico largo del mundo que sigue disponible para depurar.`);
  });
  ctx.expect("el registro contiene al menos cinco entradas", await ctx.page.locator(".error-log__entry").count() >= 5);

  for (const viewport of [{ width: 1280, height: 745 }, { width: 500, height: 480 }]) {
    await ctx.page.setViewportSize(viewport);
    await ctx.page.click("#gfx-chip");
    await ctx.page.waitForSelector("#gfx-panel:not([hidden])");
    ctx.expect("el registro cede los píxeles al panel translúcido", await ctx.page.locator("#error-log").evaluate(el => getComputedStyle(el).visibility === "hidden"));
    const filas = ctx.page.locator("#gfx-panel .gfx-row");
    ctx.expect("el panel ofrece ambas facetas", await filas.count() === 2);
    for (let i = 0; i < 2; i++) {
      const boton = filas.nth(i).locator("button").first();
      const encima = await boton.evaluate(el => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return top === el || el.contains(top);
      });
      ctx.expect(`${viewport.width}px: faceta ${i} recibe el hit-test`, encima);
      await boton.click();
      await ctx.waitFor(`faceta ${i} confirma que recibió el click`, index =>
        document.querySelectorAll("#gfx-panel .gfx-row")[index]?.querySelector("button")?.classList.contains("armed"),
      5000, i);
      ctx.expect(`${viewport.width}px: faceta ${i} arma su confirmación`, await boton.evaluate(el => el.classList.contains("armed")));
    }
    await ctx.shot(`controles-sobre-errores-${viewport.width}`);
    await ctx.page.click("#gfx-chip");
    ctx.expect("cerrar gráficos devuelve el registro sin perder entradas", await ctx.page.locator("#error-log").evaluate(el => getComputedStyle(el).visibility === "visible" && el.querySelectorAll(".error-log__entry").length >= 5));
  }
}
