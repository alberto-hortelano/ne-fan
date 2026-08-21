/** Arranque de una PARTIDA real desde el título, por el camino del jugador.
 *
 *  Los guiones sembrados en agosto entraban por el selector de fixtures, que
 *  no ejerce el motor: la escena la normaliza el propio cliente. Todo lo que
 *  se quiera comprobar del recorrido COMPLETO (motor → bridge →
 *  `formatDToWorld` → cliente) necesita una sesión de verdad, y eso son seis
 *  clicks del título que no vale la pena copiar en cada guion.
 *
 *  Cero créditos: el preset 5 apunta `?ai=` al fake-ai-server, que sirve el
 *  tile de bootstrap y los sprite sheets sin GPU ni API de pago.
 */

/** ¿La página está apuntada a un backend de IA falso? Los guiones que pueden
 *  DISPARAR generación (el batch de estilo) se niegan a correr sin esto: el
 *  mismo click contra un stack real cuesta dólares. */
export async function backendEsFalso(ctx) {
  return ctx.page.evaluate(() => {
    const ai = new URLSearchParams(location.search).get("ai") ?? "";
    return /:18765(\/|$)/.test(ai);
  });
}

/** El home del título se termina de armar ASÍNCRONAMENTE: `renderHome` pinta
 *  el botón «Nueva partida» de una tacada en el `innerHTML` y solo le cuelga
 *  el handler DESPUÉS de `await listSessions()`. Entre las dos cosas hay una
 *  ventana —151 ms medidos contra el bridge del preset 5— en la que el botón
 *  existe, se deja pulsar y el click NO HACE NADA.
 *
 *  Esperar a que el botón exista es, por tanto, esperar a la señal
 *  equivocada: el guion pulsa dentro de la ventana y luego se queda colgado
 *  esperando una pantalla que nadie va a pintar. La señal buena es el status,
 *  que `renderHome` fija justo antes de enganchar el handler y sin ningún
 *  `await` por medio: si el texto ya se ve desde fuera, el handler está
 *  puesto.
 *
 *  Valen las dos salidas —bridge vivo y bridge caído— a propósito: con el
 *  bridge caído el guion debe seguir y fallar por su propia afirmación, no
 *  por un timeout opaco aquí. */
export async function esperarTituloListo(ctx, maxMs = 30_000) {
  return ctx.waitFor(
    "el home del título termina de cargar los saves (el botón ya escucha)",
    () => {
      if (!document.getElementById("ts-new")) return null;
      const t = document.getElementById("ts-status")?.textContent ?? "";
      return /^Bridge OK/.test(t) || /No se puede contactar al bridge/.test(t) ? t : null;
    },
    maxMs,
  );
}

/** Abre el selector de mundos desde el home. ÚNICO sitio donde se pulsa
 *  «Nueva partida»: la espera de arriba va incluida para que ningún guion
 *  vuelva a pulsar un botón que todavía no escucha. */
export async function abrirSelectorDeMundos(ctx) {
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
}

/** Abre partida nueva: mundo → vista → modo de personajes → estilo →
 *  Continuar → Comenzar. Devuelve `{ gameId, styleId }` para que el guion
 *  compare contra lo que el juego usa después (p. ej. el `style_id` que viaja
 *  en la petición de skin). */
export async function nuevaPartida(ctx, { gameId = "alta_fantasia", view = "overworld", charMode = "image" } = {}) {
  await abrirSelectorDeMundos(ctx);

  const mundos = await ctx.page.$$eval("[data-game-id]", (els) => els.map((e) => e.dataset.gameId));
  if (!mundos.includes(gameId)) {
    throw new Error(`el título no ofrece el mundo "${gameId}"; hay: ${mundos.join(", ")}`);
  }
  await ctx.page.click(`[data-game-id="${gameId}"]`);
  await ctx.page.click(`#ts-view [data-view="${view}"]`);
  await ctx.page.click(`#ts-charmode [data-charmode="${charMode}"]`);
  const styleId = await ctx.page.$eval("#ts-style", (s) => s.value);
  return { gameId, styleId };
}

/** Segundo tramo: apariencia y Comenzar. Espera a que la escena de la sesión
 *  haya llegado de verdad (no a un tiempo de pared: el motor falso tarda lo
 *  que tarda). */
export async function comenzar(ctx, maxMs = 180_000) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");
  await ctx.waitFor(
    "la escena de la sesión llega del bridge",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    maxMs,
  );
}

/** Celda del grid → centro de la celda en coordenadas de MUNDO, usando el
 *  origen y el metros-por-celda que declara la propia world scene (nada de
 *  constantes copiadas del código). */
export function celdaAMundo(scene, col, row) {
  const g = scene.terrain_grid;
  const [ox, oz] = g.origin;
  return [ox + (col + 0.5) * g.meters_per_cell, oz + (row + 0.5) * g.meters_per_cell];
}
