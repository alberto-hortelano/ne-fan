/** Los personajes siguen ahí después de tirar el motor que los renderizaba.
 *
 *  Es el criterio que justificó toda la tanda de la retirada del cliente Godot
 *  (2026-08-22): el renderizador de hojas de sprites se portó a three.js
 *  (hoy el CLI de sprite-forge, repo aparte) ANTES de borrar nada, para que
 *  el juego no se quedara sin gente. Un `npm test` verde no dice nada de esto:
 *  las hojas son 28 MB fuera de git, las carga el cliente por HTTP y el fallo
 *  se ve en pantalla, no en el compilador.
 *
 *  Lo que afirma, en el orden en que se rompería:
 *
 *  1. Las 10 hojas del set base de `y_bot` están servidas y completas — no
 *     "existe el directorio": `meta.json` con más de un frame y el ÚLTIMO PNG
 *     que ese meta promete, que es el que falta cuando un render se corta a
 *     medias (le pasó al port: 43 frames en vez de 44).
 *  1-bis. Y que ese "están servidas" SIGNIFIQUE algo: lo que no está devuelve
 *     404 (#217). Sin esto el punto 1 es un verde que no puede ponerse rojo.
 *  2. En una partida REAL (desde el título, no una fixture) hay gente y se
 *     mueve sola.
 *  3. El jugador se mueve.
 *  4. Y el estado en el que arranca un CLON limpio —sin hojas, que son 28 MB
 *     fuera de git— se ve y dice qué hacer (#255): el juego lo grita en su
 *     registro de errores, nombrando el set que falta y el documento que
 *     explica cómo generarlo.
 *
 *  Modo de personajes "vector" (base y_bot) a propósito: no depende de que el
 *  backend de skins tenga sheets para el modelo del bench, y no encola ni una
 *  petición de generación. Cero créditos.
 *
 *  EN NEGATIVO (2026-08-25, uno por uno, cada uno en su corrida):
 *  - quitando `appType: "mpa"` de nefan-html/vite.config.ts → el 404 del
 *    bloque 1-bis se pone rojo (`200 text/html` los dos), y su control —el
 *    fichero hermano que sí existe— sigue verde: el bloque distingue.
 *  - devolviendo `Promise.all` a `preloadBase` → rojo SOLO «es la PRIMERA
 *    entrada»: el remedio vuelve a quedar sepultado bajo diez trazas.
 *  - quitando el remedio del mensaje de main.ts → rojos «dice qué hacer», «se
 *    LEE en pantalla» y «es la PRIMERA», que es lo que cuelga de esa línea.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

/** Las 10 del set base — `BASE_ANIMS` en renderer/character-sprites.ts, que es
 *  fail-loud: si falta una, el cliente no arranca los personajes. */
const ANIMS_BASE = [
  "idle", "walk", "run",
  "quick", "heavy", "medium", "defensive", "precise",
  "hit_react", "death",
];

export default async function (ctx) {
  // --- 1. Las hojas que produce sprite-forge, servidas por Vite ---
  const hojas = await ctx.page.evaluate(async (anims) => {
    const out = [];
    for (const anim of anims) {
      const base = `/sprites/y_bot/${anim}/frontal_8`;
      try {
        const r = await fetch(`${base}/meta.json`);
        if (!r.ok) { out.push({ anim, error: `meta.json HTTP ${r.status}` }); continue; }
        const m = await r.json();
        const ultimo = `${base}/dir_0_frame_${String(m.frame_count - 1).padStart(3, "0")}.png`;
        const png = await fetch(ultimo, { method: "GET" });
        // El `png.ok` ya vale por sí mismo desde #217 (el dev server devuelve
        // 404 a lo que no está; lo afirma el bloque 1-bis). El content-type se
        // queda porque este mismo camino se sirve también desde el build y
        // desde el asset-store, donde Vite no está: es la comprobación de que
        // lo servido es una IMAGEN, no el chequeo de un servidor concreto.
        const tipo = png.headers.get("content-type") ?? "";
        out.push({
          anim,
          frames: m.frame_count,
          dirs: m.directions,
          lado: m.frame_width,
          ultimoOk: png.ok && tipo.startsWith("image/"),
          tipo,
          ultimo,
        });
      } catch (e) {
        out.push({ anim, error: String(e) });
      }
    }
    return out;
  }, ANIMS_BASE);

  const rotas = hojas.filter((h) => h.error || !h.ultimoOk || !(h.frames > 1) || h.dirs !== 8);
  ctx.log(`hojas y_bot: ${hojas.map((h) => `${h.anim}=${h.error ?? h.frames}`).join(" ")}`);
  ctx.expect(
    "las 10 hojas del set base de y_bot están servidas, con >1 frame y sus 8 direcciones",
    rotas.length === 0,
    JSON.stringify(rotas),
  );
  ctx.expect(
    "el último frame que promete cada meta.json existe de verdad (un render cortado no se ve hasta que se ve)",
    hojas.every((h) => h.ultimoOk),
    JSON.stringify(hojas.filter((h) => !h.ultimoOk).map((h) => h.ultimo)),
  );

  // --- 1-bis. Lo que NO está devuelve 404, y lo que está no (#217) ---
  //
  // Hasta hoy el dev server contestaba a cualquier ruta desconocida con el
  // index.html de la SPA —200 text/html, 7127 B medidos— así que el `r.ok`
  // del bloque de arriba NO PODÍA ponerse rojo: una hoja a la que le faltaban
  // frames daba verde, y por eso este guion tenía que apuntalarse con el
  // content-type. `appType: "mpa"` (nefan-html/vite.config.ts) lo quita.
  //
  // Los dos pares van en la MISMA sonda a propósito: el 404 solo significa
  // algo si el fichero hermano que sí existe sigue dando 200 por el mismo
  // camino. Un servidor que 404ee todo pondría este bloque rojo igual.
  const estaticos = await ctx.page.evaluate(async () => {
    const pedir = async (url) => {
      const r = await fetch(url);
      return { url, status: r.status, tipo: r.headers.get("content-type") ?? "" };
    };
    return {
      metaAusente: await pedir("/sprites/no_existe_qa/idle/frontal_8/meta.json"),
      metaReal: await pedir("/sprites/y_bot/idle/frontal_8/meta.json"),
      // Un frame que no existe DENTRO de una hoja que sí existe: el fallo
      // exacto de un render cortado a medias (43 frames en vez de 44).
      pngAusente: await pedir("/sprites/y_bot/idle/frontal_8/dir_0_frame_999.png"),
      pngReal: await pedir("/sprites/y_bot/idle/frontal_8/dir_0_frame_000.png"),
    };
  });
  for (const [qué, r] of Object.entries(estaticos)) ctx.log(`${qué}: HTTP ${r.status} ${r.tipo} · ${r.url}`);
  ctx.expect(
    "un estático que no existe bajo /sprites/** devuelve 404 (no el index.html con 200)",
    estaticos.metaAusente.status === 404 && estaticos.pngAusente.status === 404,
    JSON.stringify([estaticos.metaAusente, estaticos.pngAusente]),
  );
  ctx.expect(
    "…y el fichero hermano que SÍ existe sigue sirviéndose por el mismo camino",
    estaticos.metaReal.status === 200 &&
      estaticos.metaReal.tipo.includes("application/json") &&
      estaticos.pngReal.status === 200 &&
      estaticos.pngReal.tipo.startsWith("image/"),
    JSON.stringify([estaticos.metaReal, estaticos.pngReal]),
  );

  // --- 2. Partida real desde el título, con la base y_bot (sin IA) ---
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  const estado = await ctx.waitFor(
    "la partida tiene gente",
    () => {
      const s = window.__nefan.status();
      return s.npcs > 0 ? { ...s, npcs: window.__nefan.npcs() } : null;
    },
    60_000,
  );
  ctx.log(`NPCs: ${estado.npcs.map((n) => `${n.id}(${n.label})`).join(", ")}`);
  ctx.expect("hay al menos un NPC en la escena de la sesión", estado.npcs.length > 0);

  const mundo = await ctx.nefan("fps");
  // `billboards` a secas cuenta TAMBIÉN el decorado (updateObject comparte el
  // mapa con updateEntity), así que «hay al menos tantos billboards como NPCs»
  // lo cumple cualquier escena con cajas y CERO personajes montados — el fallo
  // exacto que este aserto existe para cazar. Se cuenta lo que se afirma.
  ctx.expect(
    "cada NPC de la escena tiene su billboard de PERSONAJE montado en el mundo 3D",
    mundo.billboardsPersonaje >= estado.npcs.length,
    `billboardsPersonaje=${mundo.billboardsPersonaje} npcs=${estado.npcs.length} (billboards totales, decorado incluido: ${mundo.billboards})`,
  );

  // --- El NPC se mueve SOLO (el sim del bridge lo conduce) ---
  const partida = estado.npcs.map((n) => ({ id: n.id, x: n.pos.x, z: n.pos.z }));
  const movido = await ctx
    .waitFor(
      "algún NPC se desplaza por su cuenta",
      (inicio) => {
        const ahora = window.__nefan.npcs();
        for (const a of inicio) {
          const b = ahora.find((n) => n.id === a.id);
          if (!b) continue;
          const d = Math.hypot(b.pos.x - a.x, b.pos.z - a.z);
          if (d > 0.5) return { id: a.id, d };
        }
        return null;
      },
      30_000,
      partida,
    )
    .catch((err) => {
      ctx.expect("algún NPC se mueve solo (vida ambiental viva)", false, err.message);
      return null;
    });
  if (movido) {
    ctx.expect(`el NPC ${movido.id} se desplazó solo`, movido.d > 0.5, `${movido.d.toFixed(2)} m`);
  }
  await ctx.shot("npc-en-partida");

  // --- 3. El jugador se mueve (rAF vivo y control en manos del jugador) ---
  const antes = (await ctx.nefan("state")).pos;
  const despues = await ctx
    .holdUntil(
      "up",
      "el jugador avanza al mantener 'up'",
      (inicio) => {
        const p = window.__nefan.state().pos;
        return Math.hypot(p.x - inicio.x, p.z - inicio.z) > 1 ? p : null;
      },
      15_000,
      antes,
    )
    .catch((err) => {
      ctx.expect("el jugador se mueve", false, err.message);
      return null;
    });
  if (despues) {
    const d = Math.hypot(despues.x - antes.x, despues.z - antes.z);
    ctx.expect("el jugador se desplazó >1 m", d > 1, `${d.toFixed(2)} m`);
  }
  await ctx.shot("jugador-tras-andar");

  // --- 4. El clon limpio: sin hojas, el juego se entera y dice qué hacer ---
  //
  // Las hojas son 28 MB fuera de git (#255): quien clona el repo arranca
  // EXACTAMENTE así, y hasta ahora el cliente daba un motivo falso —«non-JSON
  // response … content-type: text/html», que era el index.html del fallback
  // SPA— y ningún remedio. Se produce como se produce en un clon: los
  // estáticos no están, no se toca nada del lado del juego. Va al final del
  // guion porque recarga la página y se lleva la partida por delante.
  await ctx.page.route("**/sprites/**", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "clon sin hojas (simulado por QA)" }),
    }),
  );
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a arrancar, ya sin hojas", () => Boolean(window.__nefan));

  const queja = await ctx
    .waitFor(
      "el cliente dice que le faltan las hojas del set base",
      (modelo) =>
        [...document.querySelectorAll(".error-log__entry")]
          .map((e) => ({
            fuente: e.querySelector(".error-log__source")?.textContent ?? "",
            msg: e.querySelector(".error-log__msg")?.textContent ?? "",
            detalle: e.querySelector(".error-log__detail")?.textContent ?? "",
          }))
          .find((e) => e.msg.includes(modelo) && /incompleto/.test(e.msg)) ?? null,
      20_000,
      "y_bot",
    )
    .catch(() => null);
  ctx.log(`registro: ${queja ? `[${queja.fuente}] ${queja.msg}` : "(ninguno)"}`);
  ctx.expect(
    "sin hojas, el cliente NOMBRA el set que falta en el registro de errores",
    Boolean(queja),
    "no hay entrada que nombre y_bot",
  );
  ctx.expect(
    "…y dice qué hacer: nombra el documento que explica cómo generarlas",
    Boolean(queja?.msg.includes("docs/assets-de-personaje.md")),
    queja?.msg ?? "",
  );
  // El motivo que da tiene que ser el de verdad. Antes de #217 este detalle
  // decía «non-JSON response (content-type: text/html)»: culpaba al formato
  // de la respuesta cuando lo que pasaba es que el fichero no estaba.
  ctx.expect(
    "…y el motivo apunta al fichero que falta (404), no a un content-type raro",
    Boolean(queja?.detalle.includes("404")) && !/non-JSON|text\/html/.test(queja?.detalle ?? ""),
    queja?.detalle.split("\n")[0] ?? "",
  );

  // Y se VE, que es lo que se pedía: el panel está oculto mientras el título
  // tapa la pantalla (regla de #246, `html[data-titulo="1"] #error-log`), así
  // que se mira donde el jugador lo tiene delante — con el título cerrado.
  const oculto = await ctx.page.evaluate(() => {
    const el = document.getElementById("error-log");
    return el ? getComputedStyle(el).display : "(sin panel)";
  });
  ctx.log(`con el título delante, #error-log está: display:${oculto} (#246)`);
  await ctx.nefan("closeTitle");
  // Se busca la línea ACCIONABLE, no "y_bot": los diez fallos de hoja sueltos
  // también nombran y_bot, así que un `includes("y_bot")` estaría verde con el
  // remedio borrado. Y se exige que esté ARRIBA del todo (la primera entrada
  // del panel, que va del más nuevo al más viejo): en un clon limpio hay once
  // entradas y solo una dice qué hacer — debajo de las otras diez no la lee
  // nadie.
  const enPantalla = await ctx
    .waitFor(
      "el remedio está EN PANTALLA al cerrar el título",
      () => {
        const el = document.getElementById("error-log");
        if (!el || getComputedStyle(el).display === "none") return null;
        const caja = el.getBoundingClientRect();
        if (caja.width === 0 || caja.height === 0) return null;
        const primera = el.querySelector(".error-log__entry .error-log__msg")?.textContent ?? "";
        return el.textContent?.includes("docs/assets-de-personaje.md")
          ? { primera, remedioArriba: primera.includes("docs/assets-de-personaje.md") }
          : null;
      },
      10_000,
    )
    .catch(() => null);
  // El motivo se MIDE cuando falla, no se deduce de `oculto` (que se tomó con
  // el título delante y vale "none" siempre): un detalle que no varía acusaría
  // al título de tapar un panel que está a la vista.
  const porQueNo = enPantalla
    ? ""
    : await ctx.page.evaluate(() => {
        const el = document.getElementById("error-log");
        if (!el) return "no hay panel de errores en el DOM";
        if (getComputedStyle(el).display === "none") return "el panel sigue oculto (display:none) con el título cerrado";
        return `el panel está a la vista pero sin el remedio: ${(el.textContent ?? "").slice(0, 120)}`;
      });
  ctx.expect(
    "el remedio se LEE en pantalla en cuanto el título deja de taparlo",
    Boolean(enPantalla),
    porQueNo,
  );
  ctx.expect(
    "…y es la PRIMERA entrada del panel, no la undécima debajo de diez trazas",
    Boolean(enPantalla?.remedioArriba),
    `primera entrada: ${enPantalla?.primera ?? "(ninguna)"}`,
  );
  await ctx.shot("clon-sin-hojas-lo-dice");
}
