/** Los avisos del arranque (#306) no le mueven el suelo a quien juega.
 *
 *  QA de T9. El guion 69 afirma que el aviso LLEGA al título; este afirma lo
 *  otro, que es lo que decide si el arreglo se puede usar: que llegar no le
 *  cueste al jugador ni el botón que estaba a punto de pulsar, ni la pantalla
 *  entera, ni la única frase que le dice qué pasó con sus partidas.
 *
 *  1 · **#250 otra vez, por otra puerta.** `renderHome` ordena su columna a
 *      propósito —«todo lo que puede cambiar DESPUÉS del primer pintado va
 *      POR DEBAJO del botón»— porque un panel que crecía movía «Nueva
 *      partida» bajo el cursor de quien lo estaba pulsando (+24 px medidos).
 *      `#ts-error` está ENCIMA del botón y desde #306 es justo eso: un hueco
 *      que se rellena después, con un fallo que puede tardar lo que tarde la
 *      red — o llegar cinco segundos más tarde, cuando el socket reintenta.
 *      El fallo se suelta cuando el guion quiere (la ruta se retiene y se
 *      libera), no cuando toque: el bloque no depende de ninguna carrera.
 *  2 · **La familia 4 se lee.** De las cuatro familias que #306 decidió, la de
 *      la lista de partidas NO se etiqueta: conserva su `statusEl`. Eso solo
 *      vale si ese texto lo lee el jugador de verdad, así que aquí se le quita
 *      la respuesta al bridge y se comprueba que el título lo dice, dentro de
 *      la ventana y sin código del bridge.
 *  3 · **Los avisos apilados no se llevan el botón de la pantalla.** En la
 *      ventana pequeña del guion 33 (500×480), que es donde los mecanismos de
 *      layout del título se ven.
 *  4 · **El aviso no sobrevive a su causa hasta contradecir al título.** El
 *      aviso es PEGAJOSO a propósito —ese era el bug del `innerHTML`— pero no
 *      caduca nunca: no hay quien lo quite. Si el socket se recupera, el
 *      título acaba diciendo las dos cosas a la vez, «Bridge OK» debajo de «la
 *      partida respondió algo que no se entiende». Eso son las DOS VERDADES
 *      que el issue prohíbe, solo que separadas en el tiempo en vez de en el
 *      texto. Se mide sin carreras: se corrompe la respuesta, se deja de
 *      corromper y se repinta el home por el camino del jugador.
 *
 *  Cero créditos: preset `e2e-sin-creditos` y ni una partida abierta.
 */
export const sinMotor =
  "mira solo el título con fallos inyectados en el borde (el chunk de three.js, las hojas base y " +
  "la respuesta del bridge a list_sessions); no abre partida ni pide nada al motor";

import {
  alcanceDelCursor,
  asentarElLayout,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";

const ESTRECHA = { width: 500, height: 480 };
const ANCHA = { width: 1280, height: 800 };

const AVISOS = {
  mundo: "No se puede dibujar el mundo",
  personajes: "Los personajes van sin vestir",
};

/** Dónde está «Nueva partida» EN EL VIEWPORT, que es donde vive el cursor.
 *  Misma medida que el guion 33 usa para #250. */
function medida() {
  const btn = document.getElementById("ts-new");
  const hueco = document.getElementById("ts-error");
  const r = btn?.getBoundingClientRect();
  return {
    botonY: r ? Math.round(r.top) : null,
    huecoAlto: hueco ? Math.round(hueco.getBoundingClientRect().height) : null,
    avisos: [...(hueco?.querySelectorAll("[data-aviso]") ?? [])].map((e) =>
      e.getAttribute("data-aviso"),
    ),
  };
}

/** Espera a que el título enseñe ese aviso. Por ESTADO. */
function esperarAviso(ctx, titulo, maxMs = 25_000) {
  return ctx.waitFor(
    `el título enseña el aviso «${titulo}»`,
    (t) =>
      [...document.querySelectorAll("#ts-error [data-aviso]")].some(
        (e) => e.getAttribute("data-aviso") === t,
      )
        ? { visto: true }
        : null,
    maxMs,
    titulo,
  );
}

export default async function (ctx) {
  await ctx.page.setViewportSize(ANCHA);

  // ─── 1 · el aviso que llega TARDE no mueve el botón (#250) ─────────────
  //
  // La ruta del chunk se RETIENE: el guion decide cuándo falla, así que la
  // medida «antes» está garantizada con el botón ya pintado. Es el caso real
  // de una petición que tarda y acaba fallando, y el de cualquier aviso del
  // socket, que puede llegar en cualquier momento con el título delante.
  let soltarElChunk;
  const chunkRetenido = new Promise((r) => {
    soltarElChunk = r;
  });
  await ctx.page.route("**/fps-gl*", async (route) => {
    await chunkRetenido;
    await route.abort("failed");
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await asentarElLayout(ctx);
  const antes = await ctx.page.evaluate(medida);
  ctx.log(`antes del aviso: ${JSON.stringify(antes)}`);
  // NO CONCLUYENTE antes que verde: si ya hubiera un aviso puesto, la medida
  // «antes» ya lo incluiría y el Δ saldría 0 sin probar nada.
  ctx.expect(
    "el botón se mide con el hueco de avisos VACÍO (si no, el Δ de abajo no mide nada)",
    antes.avisos.length === 0 && antes.botonY !== null,
    JSON.stringify(antes),
  );

  soltarElChunk();
  await esperarAviso(ctx, AVISOS.mundo);
  await asentarElLayout(ctx);
  const despues = await ctx.page.evaluate(medida);
  ctx.log(`tras el aviso: ${JSON.stringify(despues)}`);
  ctx.expect(
    "un aviso que llega con el título YA pintado no desplaza «Nueva partida» bajo el cursor (#250)",
    antes.botonY !== null &&
      despues.botonY !== null &&
      Math.abs(antes.botonY - despues.botonY) <= 2,
    `${antes.botonY}px → ${despues.botonY}px (Δ ${(despues.botonY ?? 0) - (antes.botonY ?? 0)}px) ` +
      `con el hueco de avisos de ${antes.huecoAlto}px → ${despues.huecoAlto}px`,
  );
  await ctx.shot("qa-70-aviso-tardio-mueve-el-boton");
  await ctx.page.unroute("**/fps-gl*");

  // ─── 2 · la familia 4 (la lista de partidas) SE LEE ────────────────────
  //
  // No se etiqueta a propósito: conserva su `statusEl`. La contrapartida es
  // que ese texto tiene que llegar al jugador. Se le quita al bridge la
  // respuesta a `list_sessions` —solo esa— y se mira qué queda en pantalla.
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  await ctx.page.routeWebSocket(gateway, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      let tipo = "";
      try {
        tipo = JSON.parse(String(m)).type ?? "";
      } catch {
        tipo = "";
      }
      if (tipo === "list_sessions") return; // se traga SOLO esa
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  // El request del bridge expira a los 30 s: la espera es por ESTADO, y el
  // maxMs es el cortafuegos.
  const estado = await ctx.waitFor(
    "el título dice qué ha pasado con las partidas guardadas",
    () => {
      const el = document.getElementById("ts-status");
      const t = el?.textContent ?? "";
      return t && !/^Cargando/.test(t)
        ? {
            texto: t,
            alto: Math.round(el.getBoundingClientRect().height),
            top: Math.round(el.getBoundingClientRect().top),
            bottom: Math.round(el.getBoundingClientRect().bottom),
            dentro:
              el.getBoundingClientRect().top >= 0 &&
              el.getBoundingClientRect().bottom <= window.innerHeight,
            visible: getComputedStyle(el).display !== "none",
          }
        : null;
    },
    45_000,
  );
  ctx.log(`familia 4 · #ts-status: "${estado.texto}"`);
  // El aserto pide el texto del FALLO, no «partidas guardadas»: el caso feliz
  // dice «Bridge OK — 0 partidas guardadas» y habría pasado en verde sin que
  // nada fallara.
  ctx.expect(
    "la lista de partidas que no llega SE DICE en el título (familia 4, sin etiquetar a propósito)",
    /No se pudieron cargar las partidas guardadas/.test(estado.texto),
    estado.texto,
  );
  ctx.expect(
    "…y se LEE: está en pantalla, dentro de la ventana y con alto propio",
    estado.visible && estado.dentro && estado.alto > 0,
    JSON.stringify(estado),
  );
  ctx.expect(
    "…y no le enseña al jugador el código del bridge",
    !/Bridge request timeout|Bridge not connected|list_sessions/.test(estado.texto),
    estado.texto,
  );
  await ctx.shot("qa-70-familia-4-la-lista-que-no-llega");

  // ─── 3 · los avisos apilados no se llevan el botón de la pantalla ──────
  //
  // 500×480 es la ventana del guion 33: la única donde los mecanismos de
  // layout del título se ven (a 800 de alto el suelo estético gana).
  await ctx.page.setViewportSize(ESTRECHA);
  await ctx.page.route("**/fps-gl*", (r) => r.abort("failed"));
  await ctx.page.route("**/sprites/y_bot/**", (r) => r.abort("failed"));
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarAviso(ctx, AVISOS.mundo);
  await esperarAviso(ctx, AVISOS.personajes);
  await asentarElLayout(ctx);
  const apilados = await ctx.page.evaluate(medida);
  const alcance = await alcanceDelCursor(ctx, "ts-new");
  ctx.log(`apilados: ${JSON.stringify(apilados)} · alcance: ${JSON.stringify(alcance)}`);
  ctx.expect(
    "con dos avisos apilados el título sigue enseñando los dos (no se traga ninguno)",
    apilados.avisos.length === 2,
    JSON.stringify(apilados.avisos),
  );
  ctx.expect(
    "…y «Nueva partida» sigue DENTRO de la ventana en 500×480",
    alcance.dentroDelViewport === true,
    JSON.stringify(alcance.caja) + ` · ventana ${ESTRECHA.height}px`,
  );
  ctx.expect(
    "…y sigue siendo lo que el cursor golpea en su centro (nadie lo tapa)",
    alcance.loGolpea === true,
    `golpea ${alcance.golpea}`,
  );
  await ctx.shot("qa-70-dos-avisos-en-ventana-pequena");
  await ctx.page.unroute("**/fps-gl*");
  await ctx.page.unroute("**/sprites/y_bot/**");
  await ctx.page.setViewportSize(ANCHA);

  // ─── 4 · el aviso no contradice al título cuando su causa se ha ido ────
  //
  // Se corrompe lo que contesta el gateway, se espera al aviso, se DEJA de
  // corromper y se repinta el home entrando y saliendo del selector de
  // mundos. Todo por estado; el interruptor vive en el runner, así que no hay
  // reloj de por medio.
  let corrompiendo = true;
  await ctx.page.routeWebSocket(gateway, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(corrompiendo ? "}{ esto no es json" : m));
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarAviso(ctx, "La partida respondió algo que no se entiende");
  corrompiendo = false;
  ctx.log("el socket vuelve a contestar bien");
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  const sano = await esperarListaDeSaves(ctx, 45_000);
  const final = await ctx.page.evaluate(() => ({
    status: document.getElementById("ts-status")?.textContent ?? "",
    avisos: [...document.querySelectorAll("#ts-error [data-aviso]")].map((e) =>
      e.getAttribute("data-aviso"),
    ),
  }));
  ctx.log(`socket sano · status "${sano}" · avisos ${JSON.stringify(final.avisos)}`);
  // NO CONCLUYENTE antes que verde: sin el «Bridge OK» no hay contradicción
  // que medir y el aserto de abajo pasaría sin probar nada.
  ctx.expect(
    "el bridge vuelve a contestar (si no, no hay contradicción que medir)",
    /^Bridge OK/.test(final.status),
    final.status,
  );
  ctx.expect(
    "el título no dice a la vez «Bridge OK» y «la partida respondió algo que no se entiende»",
    !final.avisos.includes("La partida respondió algo que no se entiende"),
    `status "${final.status}" · avisos ${JSON.stringify(final.avisos)}`,
  );
  await ctx.shot("qa-70-el-aviso-contradice-al-titulo");
}
