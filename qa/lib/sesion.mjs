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

/** El título está en pantalla y su botón de partida nueva, pintado.
 *
 *  HASTA #181 esto no bastaba, y aquí vivía el workaround que lo decía: el
 *  botón se pintaba de una tacada en el `innerHTML` y `renderHome` solo le
 *  colgaba el handler DESPUÉS de `await listSessions()` —151 ms medidos, hasta
 *  30 s si el bridge tardaba—, así que la espera tenía que colarse por la
 *  puerta de atrás y mirar el texto de `#ts-status` para adivinar que el
 *  handler ya estaba puesto. Los quince guiones que pasan por aquí esquivaban
 *  el bug en vez de ejercerlo.
 *
 *  Ahora el enganche va en el mismo bloque síncrono que pinta el botón: si el
 *  botón está en el DOM, escucha. La espera vuelve a ser lo que debía ser —que
 *  el título haya llegado— y el guion 18 es quien afirma que responde. */
export async function esperarTituloListo(ctx, maxMs = 30_000) {
  return ctx.waitFor(
    "el título está en pantalla con su botón de partida nueva",
    () => document.getElementById("ts-new")?.textContent ?? null,
    maxMs,
  );
}

/** La lista de partidas del bridge ya ha llegado al título.
 *
 *  NO es el workaround de arriba con otro nombre, y la diferencia es toda:
 *  aquello gateaba el CLICK de «Nueva partida» —una acción que no depende de
 *  los saves— en la señal de otra cosa. Esto lo espera SOLO quien va a leer la
 *  lista (la tarjeta de un save, una revisión del home entero), que es
 *  esperar lo que de verdad se necesita. Vale el bridge caído a propósito: el
 *  guion debe seguir y fallar por su propia afirmación, no por un timeout
 *  opaco aquí. */
export async function esperarListaDeSaves(ctx, maxMs = 30_000) {
  return ctx.waitFor(
    "el título termina de listar las partidas guardadas del bridge",
    () => {
      const t = document.getElementById("ts-status")?.textContent ?? "";
      return /^Bridge OK/.test(t) || /No se puede contactar al bridge/.test(t) ? t : null;
    },
    maxMs,
  );
}

/** Abre el selector de mundos desde el home. ÚNICO sitio donde se pulsa
 *  «Nueva partida». */
export async function abrirSelectorDeMundos(ctx) {
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
}

/** Borra un save POR EL CABLE DEL BRIDGE, no por la UI.
 *
 *  Sirve para producir el repro real de #189: un fallo de sesión con el bridge
 *  ARRIBA. El save desaparece del disco mientras el título sigue enseñando su
 *  tarjeta, y «Reanudar» se encuentra un `session_not_found`.
 *
 *  Va por WebSocket y no por el botón «Borrar» del título a propósito: ese
 *  botón abre un `confirm()` del navegador, que BLOQUEA la página y deja al
 *  harness sin respuesta. Y el bridge sigue siendo el único escritor del save:
 *  `delete_session` es su propia ruta (`bridge/router.ts`), la misma que usa
 *  la UI. */
export async function borrarSaveComoOtroCliente(ctx, sessionId, wsUrl = "ws://127.0.0.1:9877") {
  const ok = await ctx.page.evaluate(
    ([url, id]) =>
      new Promise((res, rej) => {
        const ws = new WebSocket(url);
        let contestado = false;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        // Un socket que se cierra sin contestar es un fallo, no una espera
        // eterna: sin esto el guion se colgaría dentro del evaluate.
        ws.onclose = () => {
          if (!contestado) rej(new Error(`${url} se cerró sin contestar a delete_session`));
        };
        ws.onopen = () => ws.send(JSON.stringify({ type: "delete_session", sessionId: id, requestId: "qa-18" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_deleted") return;
          contestado = true;
          ws.close();
          res(Boolean(m.ok));
        };
      }),
    [wsUrl, sessionId],
  );
  if (!ok) throw new Error(`el bridge no borró el save ${sessionId}`);
  return ok;
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

  // Se espera a la FASE que publica el título (`data-gen-phase`), no a un
  // regex sobre el texto: el mensaje cambia y la espera no se entera. Pasó de
  // verdad — al añadir el aviso de "pre-generación abandonada", ninguno de los
  // dos patrones que se casaban aquí lo reconocía y la espera se comía sus
  // 240 s enteros para reportar un timeout genérico. El tope vuelve a ser lo
  // que debe ser: un cortafuegos de deadlock.
  const fin = await ctx.waitFor(
    "la pre-generación del mundo llega a un estado terminal",
    () => {
      const el = document.getElementById("ts-gen-progress");
      const fase = el?.dataset.genPhase ?? "";
      return fase === "ready" || fase === "error"
        ? { fase, texto: el?.textContent ?? "" }
        : null;
    },
    240_000,
  );
  ctx.log(`pre-generación (${fin.fase}): ${fin.texto}`);
  ctx.expect("la pre-generación del mundo termina bien", fin.fase === "ready", fin.texto);
  ctx.expect("…y sin fallos parciales", !/Fallos parciales/i.test(fin.texto), fin.texto);
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
