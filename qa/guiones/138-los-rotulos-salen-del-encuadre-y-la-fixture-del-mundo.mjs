/** #484: el rótulo fuera del encuadre no permanece en DOM; una fixture
 * cargada desde una partida viva no recibe movimientos de sus viejos NPCs. */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { cargarFixture } from "../lib/fixtures.mjs";

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  const npc = await ctx.waitFor("el tabernero está en el mundo", () => window.__nefan.npcs().find(n => n.id === "barkeep") ?? null, 30000);
  await ctx.nefan("setPlayerPos", npc.pos.x, npc.pos.z + 4);
  await ctx.nefan("setYaw", Math.PI);
  await ctx.waitFor("el rótulo entra en el encuadre", () => !!document.querySelector('[data-label-id="barkeep"]'), 10000);
  // A 70° está delante del ojo, pero fuera del campo horizontal del visor.
  await ctx.nefan("setYaw", Math.PI + 70 * Math.PI / 180);
  await ctx.waitFor("el nombre fuera de cámara se retira del DOM", () => !document.querySelector('[data-label-id="barkeep"]'), 10000);
  await ctx.nefan("setYaw", Math.PI);
  await ctx.waitFor("mirarlo de nuevo devuelve el rótulo", () => !!document.querySelector('[data-label-id="barkeep"]'), 10000);
  const erroresAntes = await ctx.page.$eval("#error-log", el => el.textContent ?? "");
  await cargarFixture(ctx, "zorder_test");
  const desde = await ctx.nefan("reloj");
  await ctx.waitFor("la fixture avanza dos segundos de simulación", t => window.__nefan.reloj().sim >= t + 2, 20000, desde.sim);
  const errores = await ctx.page.$eval("#error-log", el => el.textContent ?? "");
  ctx.expect("la fixture no recibe movimientos de los personajes de la partida",
    !errores.slice(erroresAntes.length).includes("y el cliente no lo tiene en escena"), errores);
}
