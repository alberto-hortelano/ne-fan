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
import { esperarPartidaEnDisco } from "./saves.mjs";

/** ¿Puede este stack disparar generación SIN gastar un céntimo?
 *
 *  Lo que había aquí antes se llamaba `backendEsFalso` y no medía nada: leía
 *  el `?ai=` de la página y comprobaba si contenía el puerto 18765 — o sea,
 *  leía de vuelta la constante que el propio runner acababa de escribir en esa
 *  URL (`run.mjs` fijaba `FAKE_AI`, la metía en la query y era la única
 *  navegación del banco). Una tautología: siempre decía «sí». Los tres guiones
 *  que se protegían con ella (07, 15, 21) llevaban meses creyéndose guardados
 *  por un `if` que no podía dar `false`.
 *
 *  Ahora la respuesta la dan los BACKENDS, y hacen falta LAS DOS VÍAS de gasto:
 *
 *   (a) **la del cliente** — la URL a la que la página resuelve `narrative-llm`
 *       de verdad (`window.__nefan.servicios()`, ya con los overrides de la
 *       query aplicados; jamás una constante de este proceso) declara
 *       `fake: true` en su `/health`;
 *   (b) **la del bridge** — el `/health` de la State API publica
 *       `ai_server_url`, y ESA url declara `fake: true`. Es la vía que el
 *       `?ai=` nunca cubrió: las escenas y las consecuencias las pide el
 *       bridge por su cuenta, así que un cliente apuntado al fake con un
 *       bridge apuntado al motor real gasta igual.
 *
 *  Cualquier otra cosa es `false`: campo ausente, `fake: false`, respuesta
 *  ilegible, timeout, puerto muerto, CORS que no deja leer. No existe una rama
 *  que devuelva `true` sin dos afirmaciones leídas del backend — el desenlace
 *  caro (bendecir como gratis algo que cobra) es inexpresable, y el barato
 *  (negarse con un fake legítimo) solo cuesta un guion que no corre y lo dice.
 *
 *  El fetch va DENTRO de la página a propósito: es el navegador del jugador
 *  quien tiene que poder hablar con esos backends, y así el CORS forma parte
 *  de lo que se comprueba. Devuelve `{ ok, motivo, cliente, bridge }` para que
 *  el guion pueda decir POR QUÉ no corre; `stackSinCreditos` es el booleano. */
export async function diagnosticoDeCreditos(ctx, timeoutMs = 5000) {
  return ctx.page.evaluate(async (ms) => {
    /** `/health` de un backend, o el motivo por el que no se pudo leer. */
    const salud = async (url) => {
      if (!url) return { url, fake: false, motivo: "sin URL" };
      const corte = AbortSignal.timeout(ms);
      try {
        const r = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: corte });
        if (!r.ok) return { url, fake: false, motivo: `HTTP ${r.status}` };
        const body = await r.json();
        // `=== true` y no truthy: un `"fake": "no"` o un `1` que se colaran por
        // un serializador descuidado NO son una declaración de gratuidad.
        if (body?.fake === true) return { url, fake: true, motivo: "declara fake:true" };
        return {
          url,
          fake: false,
          motivo: body?.fake === false ? "declara fake:false (backend real)" : "no declara `fake`",
        };
      } catch (e) {
        return { url, fake: false, motivo: `no contesta (${String(e).slice(0, 80)})` };
      }
    };

    const hook = window.__nefan;
    if (!hook?.servicios) {
      return { ok: false, motivo: "la página no publica __nefan.servicios()", cliente: null, bridge: null };
    }
    const urls = hook.servicios();
    const cliente = await salud(urls["narrative-llm"]);

    // La segunda vía: a quién habla el BRIDGE. Se pregunta a la State API, que
    // es quien lo sabe; si no contesta o no lo publica, no es falso.
    let bridge = { url: null, fake: false, motivo: "la State API no contesta" };
    try {
      const base = String(urls["world-state"] ?? "").replace(/\/+$/, "");
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(ms) });
      const body = r.ok ? await r.json() : null;
      const motor = typeof body?.ai_server_url === "string" ? body.ai_server_url : "";
      bridge = motor
        ? await salud(motor)
        : { url: null, fake: false, motivo: "la State API no publica ai_server_url" };
    } catch (e) {
      bridge = { url: null, fake: false, motivo: `State API ilegible (${String(e).slice(0, 80)})` };
    }

    const ok = cliente.fake === true && bridge.fake === true;
    const motivo = ok
      ? `cliente y bridge declaran fake:true (${cliente.url} · ${bridge.url})`
      : `cliente: ${cliente.motivo} · bridge: ${bridge.motivo}`;
    return { ok, motivo, cliente, bridge };
  }, timeoutMs);
}

/** El booleano del guardarraíl: `true` solo si las dos vías declaran ser
 *  falsas. Lo que se escribe en un `if` de guion. */
export async function stackSinCreditos(ctx) {
  const d = await diagnosticoDeCreditos(ctx);
  if (!d.ok) ctx.log(`⛔ guardarraíl de gasto: ${d.motivo}`);
  return d.ok;
}

/** El título está en pantalla y su botón de partida nueva, pintado.
 *
 *  HASTA #181 esto no bastaba, y aquí vivía el workaround que lo decía: el
 *  botón se pintaba de una tacada en el `innerHTML` y `renderHome` solo le
 *  colgaba el handler DESPUÉS de `await listSessions()` —151 ms medidos, hasta
 *  30 s si el bridge tardaba—, así que la espera tenía que colarse por la
 *  puerta de atrás y mirar el texto de `#ts-status` para adivinar que el
 *  handler ya estaba puesto. Los TRECE guiones que pasan por aquí
 *  (05,07,08,09,10,11,12,13,14,15,17,18,19) esquivaban el bug en vez de
 *  ejercerlo — no quince: los otros cinco de `qa/guiones/` entran por
 *  `closeTitle` (modo fixtures) y nunca tocaron este workaround.
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
export async function borrarSaveComoOtroCliente(ctx, sessionId, wsUrl = null) {
  const ok = await ctx.page.evaluate(
    ([urlPedida, id]) =>
      new Promise((res, rej) => {
        // Sin URL explícita, la del juego: el gateway que la página está
        // usando de verdad, con su `?bridge=` ya aplicado.
        const url = urlPedida ?? window.__nefan.servicios()["game-gateway"];
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

/** Segundo tramo: apariencia y Comenzar. Vuelve cuando LA PARTIDA ESTÁ EN
 *  MARCHA, que son tres cosas y no una (#270):
 *
 *   (a) el título ya no intercepta — mientras siga delante, el arranque puede
 *       volver a él con un aviso y lo que se mida después no es una partida;
 *   (b) hay escena — el mundo llegó del bridge;
 *   (c) la partida EXISTE en disco — desde #279 se escribe con el ack del
 *       cliente, así que un guion que mire el `state.json` justo después de
 *       arrancar (el 17) corría contra un fichero que aún no está.
 *
 *  Esperar solo a (b) era el bug: el tile del bridge llega ANTES de que se
 *  resuelva la apariencia, así que durante unos ms hay escena y título a la
 *  vez —medido en el guion 27— y esta función daba por arrancada una partida
 *  que un instante después volvía al título. Ninguna de las tres es un tiempo
 *  de pared: `maxMs` es el cortafuegos de deadlock. */
export async function comenzar(ctx, maxMs = 180_000) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");
  const arrancada = await ctx.waitFor(
    "el juego está en marcha: el título fuera y la escena de la sesión dentro",
    () => {
      if (window.__nefan.status().title) return null;
      if (!window.__nefan.status().scene) return null;
      const sessionId = window.__nefan.sesion().sessionId;
      return sessionId ? { sessionId, scene: window.__nefan.scene.scene_id } : null;
    },
    maxMs,
  );
  const { fuente } = await esperarPartidaEnDisco(ctx, arrancada.sessionId, maxMs);
  ctx.log(
    `partida ${arrancada.sessionId} en marcha · escena ${arrancada.scene} · existe en disco (${fuente})`,
  );
  return arrancada;
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
