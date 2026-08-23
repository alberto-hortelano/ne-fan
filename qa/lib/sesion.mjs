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

/** Abre partida nueva: mundo → modo de personajes → estilo → Continuar →
 *  Comenzar. Devuelve `{ gameId, styleId }` para que el guion compare contra
 *  lo que el juego usa después (p. ej. el `style_id` que viaja en la petición
 *  de skin).
 *
 *  Ya no hay paso de VISTA: el cliente tiene una sola (primera persona) y el
 *  título dejó de ofrecer el selector. */
export async function nuevaPartida(ctx, { gameId = "alta_fantasia", charMode = "image" } = {}) {
  await abrirSelectorDeMundos(ctx);

  const mundos = await ctx.page.$$eval("[data-game-id]", (els) => els.map((e) => e.dataset.gameId));
  if (!mundos.includes(gameId)) {
    throw new Error(`el título no ofrece el mundo "${gameId}"; hay: ${mundos.join(", ")}`);
  }
  await ctx.page.click(`[data-game-id="${gameId}"]`);
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

/** Pre-genera el mundo del juego desde el título, por el camino del jugador
 *  (el botón «Generar mundo», que pide confirmación en dos clicks como las
 *  acciones de pago) y deja al guion de vuelta en el home.
 *
 *  Lo necesitan los guiones cuyo sujeto vive en el world map (places, links,
 *  salidas) o que leen el snapshot (el batch de estilo): ese mapa lo siembra
 *  el motor durante la pre-generación, y sin ella no existe.
 *
 *  Copiado estaba en 08 y 09, con el 09 sin la afirmación del 08. Se unifica
 *  aquí CON ella: el guion que regenera comprueba de paso que la
 *  pre-generación no trae fallos parciales — la versión compartida es la
 *  fuerte, no el mínimo común.
 */
export async function regenerarMundo(ctx, gameId = "alta_fantasia") {
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${gameId}"]`);

  await ctx.page.click("#ts-gen-world");
  const armado = await ctx.page.$eval("#ts-gen-world", (b) => b.textContent ?? "");
  if (armado.startsWith("¿Regenerar")) await ctx.page.click("#ts-gen-world");

  await ctx.waitFor(
    "la pre-generación del mundo termina",
    () => {
      const t = document.getElementById("ts-gen-progress")?.textContent ?? "";
      return /generado:/.test(t) || /falló|error/i.test(t) ? t : null;
    },
    240_000,
  );
  const linea = await ctx.page.$eval("#ts-gen-progress", (e) => e.textContent ?? "");
  ctx.log(`pre-generación: ${linea}`);
  ctx.expect("el mundo se pre-genera sin fallos parciales", !/Fallos parciales|falló/i.test(linea), linea);
  await ctx.page.click("#ts-back");
}

/** Espera a que un REGISTRO del juego cumpla una condición, y devuelve el
 *  registro entero.
 *
 *  Es el sustituto de las esperas por reloj: en vez de «duerme 200 ms y mira a
 *  ver si ya han salido N peticiones», se espera a que el propio juego declare
 *  el paso en uno de sus libros (`__nefan.viaje`, `.tileEpisodios`, `.skins`,
 *  `.estilo()`). `maxMs` es un cortafuegos de deadlock, no la condición de
 *  parada, y al saltar el mensaje trae el ÚLTIMO valor del registro — que es
 *  lo que dice qué paso está muerto.
 *
 *  `libro` es el nombre de la clave en `window.__nefan` (`nombre()` si es
 *  función) y solo se usa para CONTAR QUÉ PASÓ si el cortafuegos salta;
 *  `probe` es la condición, evaluada dentro de la página como en `waitFor`. */
export async function esperarRegistro(ctx, desc, libro, probe, maxMs = 60_000, arg = undefined) {
  try {
    return await ctx.waitFor(desc, probe, maxMs, arg);
  } catch {
    const v = await leerLibro(ctx, libro).catch((e) => ({ __err: String(e) }));
    throw new Error(`${desc}: el juego nunca lo registró · ${libro}=${JSON.stringify(v)}`);
  }
}

/** Lee uno de los libros del juego (`viaje`, `tileEpisodios`, `skins`,
 *  `estilo`), sea propiedad o función. */
export async function leerLibro(ctx, libro) {
  return ctx.page.evaluate((nombre) => {
    const hook = window.__nefan;
    const v = hook[nombre];
    return typeof v === "function" ? v.call(hook) : (v ?? null);
  }, libro);
}

/** Celda del grid → centro de la celda en coordenadas de MUNDO, usando el
 *  origen y el metros-por-celda que declara la propia world scene (nada de
 *  constantes copiadas del código). */
export function celdaAMundo(scene, col, row) {
  const g = scene.terrain_grid;
  const [ox, oz] = g.origin;
  return [ox + (col + 0.5) * g.meters_per_cell, oz + (row + 0.5) * g.meters_per_cell];
}
