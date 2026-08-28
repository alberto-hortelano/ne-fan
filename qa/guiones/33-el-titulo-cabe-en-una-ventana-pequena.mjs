/** El título en una ventana PEQUEÑA: el botón no se mueve bajo el cursor
 *  (#250) y la columna que no cabe lo dice (#251).
 *
 *  POR QUÉ 500×480 Y NO EL 1280×800 DEL RESTO DE LA BATERÍA. Los dos
 *  mecanismos siguen vivos, pero solo ahí:
 *
 *   · #250. El panel de dev se rellena async (poll a remote-gen) y CRECE
 *     después de que el botón «Nueva partida» ya esté en pantalla. Mientras el
 *     hueco que le reservaba el título se midió del panel REAL
 *     (`reserveDevPanelSpace` + `ResizeObserver`), ese crecimiento bajaba el
 *     botón bajo el cursor de quien lo estaba pulsando: QA midió +24 px a
 *     480 de alto. Hoy el hueco sale de `--dev-status-alto`, la misma variable
 *     que acota el panel, así que es constante — pero el aserto sigue teniendo
 *     que medirse DONDE el mecanismo existía: a 800 de alto el suelo estético
 *     (160) ganaba de todas formas y un aserto ahí nacería verde desde
 *     `62e96be` sin arreglar nada.
 *
 *   · #251. La columna del título (`this.content`, `max-height:100%`) recorta
 *     a 1280×800 solo con muchas partidas; a 500×480 caben tres o cuatro. El
 *     scroller es la COLUMNA ENTERA, no la lista de saves — una señal sobre
 *     `#ts-sessions` iría al elemento equivocado.
 *
 *  `aisla: ["saves"]` y no un borrado a mitad del guion: el bloque 1 necesita
 *  CERO partidas (con la columna llena la señal de #251 aparecería y su
 *  aserto negativo se caería), y el aislamiento del runner corre una sola vez,
 *  antes del guion. Por eso esto es un guion propio y no un bloque del 19, que
 *  siembra una partida en su primera línea.
 *
 *  Las doce partidas del bloque 2 se CLONAN de una real (`clonarSaves`) en vez
 *  de jugarse: lo que hace falta es que el bridge tenga doce que listar, y su
 *  `list()` las lee del disco igual vengan de donde vengan. Jugar doce
 *  arranques serían minutos de batería para medir un layout.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { clonarSaves } from "../lib/saves.mjs";
import {
  asentarElLayout,
  comenzar,
  espiarElPrimerPintado,
  esperarElPrimerPintado,
  nuevaPartida,
  recargarAlTitulo,
} from "../lib/sesion.mjs";

export const aisla = ["saves"];

const ESTRECHA = { width: 500, height: 480 };
/** El viewport por defecto de la batería (`run.mjs`), o sea el caso más
 *  común que existe. */
const ANCHA = { width: 1280, height: 800 };

/** Dónde está «Nueva partida» EN EL VIEWPORT (que es donde vive el cursor de
 *  quien juega, no en coordenadas del bloque) y cuánto ocupa el panel de dev.
 *  Los dos juntos porque el segundo es la causa del primero.
 *
 *  `devScroll` es el alto NATURAL del panel (su contenido, sin la cota) y
 *  `devBottom` el que de verdad ocupa: la diferencia entre los dos es
 *  exactamente lo que hace el arreglo de #250. */
function medida() {
  const btn = document.getElementById("ts-new");
  const dev = document.getElementById("dev-status");
  const r = btn?.getBoundingClientRect();
  const rd = dev?.getBoundingClientRect();
  return {
    botonY: r ? Math.round(r.top) : null,
    devBottom: rd ? Math.round(rd.bottom) : null,
    devScroll: dev ? dev.scrollHeight : null,
    devChars: (dev?.textContent ?? "").trim().length,
    padding: Math.round(
      parseFloat(getComputedStyle(document.getElementById("title-screen")).paddingTop)),
    // Dónde EMPIEZA la columna del título. Es lo que el hueco reservado tiene
    // que dejar por debajo de la barra de dev.
    contenidoY: Math.round(
      document.getElementById("title-screen").firstElementChild.getBoundingClientRect().top),
    innerHeight: window.innerHeight,
  };
}

export default async function (ctx) {
  await ctx.page.setViewportSize(ESTRECHA);
  // La MISMA fórmula para las dos medidas: el espía la recibe como texto.
  await espiarElPrimerPintado(ctx, medida);

  // ── 1 · #250: el botón no se mueve mientras el panel de dev se rellena ───
  await recargarAlTitulo(ctx);
  const alNacer = await esperarElPrimerPintado(ctx);
  ctx.log(`al nacer: ${JSON.stringify(alNacer)}`);

  // El panel se rellena solo: en este preset no hay remote-gen, y la
  // transición a «offline» es lo que le añade la línea de config. Se espera al
  // ESTADO —que el panel diga más de lo que decía— y no a un reloj.
  const relleno = await ctx
    .waitFor(
      "el panel de dev termina de rellenarse (es lo que movía el botón)",
      (chars) => {
        const dev = document.getElementById("dev-status");
        if (!dev) return null;
        const alto = dev.scrollHeight;
        return (dev.textContent ?? "").trim().length > chars ? { chars: alto } : null;
      },
      20_000,
      alNacer.devChars,
    )
    .catch(() => null);
  await asentarElLayout(ctx);
  const yaLleno = await ctx.page.evaluate(medida);
  ctx.log(`ya lleno: ${JSON.stringify(yaLleno)} · relleno=${JSON.stringify(relleno)}`);

  // NO CONCLUYENTE antes que verde: si el panel no CRECIERA entre las dos
  // medidas, nada podría haber movido el botón y el verde no diría nada. Es
  // el error que este bloque tuvo primero, encontrado midiéndolo.
  ctx.expect(
    "el panel de dev CRECE entre que nace el botón y que termina de llenarse (si no, no se mide nada)",
    (yaLleno.devScroll ?? 0) > (alNacer.devScroll ?? 0),
    `alto natural ${alNacer.devScroll}px → ${yaLleno.devScroll}px`,
  );
  ctx.expect(
    "…y ese crecimiento SÍ bastaría para mover el botón sin la cota (el bug sigue teniendo sujeto)",
    (yaLleno.devScroll ?? 0) + 10 > 96,
    `sin cota el título reservaría ${(yaLleno.devScroll ?? 0) + 10}px contra el suelo 96`,
  );
  // EL INVARIANTE, y es el que se rompe si alguien descuelga los dos lados de
  // `--dev-status-alto`: el título reserva el hueco de la barra a partir de esa
  // variable, no midiendo el panel. Si el panel deja de estar acotado por ella,
  // crece por encima del hueco y la columna nace DEBAJO de la barra.
  ctx.expect(
    "el título reserva el hueco de la barra de dev: su columna empieza por debajo (#250)",
    yaLleno.contenidoY !== null &&
      yaLleno.devBottom !== null &&
      yaLleno.contenidoY >= yaLleno.devBottom,
    `la columna empieza en ${yaLleno.contenidoY}px y la barra acaba en ${yaLleno.devBottom}px ` +
      `(alto natural del panel: ${yaLleno.devScroll}px, padding reservado: ${yaLleno.padding}px)`,
  );
  // QUÉ CANDA CADA ASERTO, para que nadie se confíe del verde equivocado. El
  // de arriba es el que carga #250 hoy: se pone rojo en cuanto el panel deja
  // de estar acotado por `--dev-status-alto` (medido: la columna nace en 96 px
  // con la barra llegando a 110). El de abajo es el TESTIGO DE REGRESIÓN del
  // diseño viejo: con el hueco derivado de la variable, el Δ es 0 por
  // construcción y solo vuelve a ponerse rojo si alguien descota el panel Y
  // vuelve a medirlo desde JavaScript — las dos a la vez dan exactamente el
  // +24 px que midió QA (`181 → 205`, padding `96 → 120`).
  ctx.expect(
    "«Nueva partida» no se desplaza bajo el cursor cuando el panel de dev se rellena (#250)",
    alNacer.botonY !== null &&
      yaLleno.botonY !== null &&
      Math.abs(alNacer.botonY - yaLleno.botonY) <= 2,
    `${alNacer.botonY}px → ${yaLleno.botonY}px (Δ ${(yaLleno.botonY ?? 0) - (alNacer.botonY ?? 0)}px) ` +
      `con el panel de ${alNacer.devBottom}px → ${yaLleno.devBottom}px y padding ` +
      `${alNacer.padding} → ${yaLleno.padding}`,
  );

  // ── 1c · La cota no puede esconder el GASTO justo cuando se gasta ───────
  // El panel existe para vigilar lo que cuesta la generación de imágenes
  // (`dev-ui.css`, cabecera), y su estado más alto es precisamente el aviso
  // que precede a una llamada de pago. Con la cota anterior (72 px) el chip
  // del gasto caía en y 63–75 y se cortaba: el defecto que la cota vino a
  // evitar, mudado de sitio.
  //
  // Se conduce por el MISMO camino que el juego (`devPanel.setPainting`, que
  // el bucle llama con `fpsAtlasController.running`) y se mide en el mismo
  // turno síncrono, porque el frame siguiente lo devuelve a reposo. No es un
  // estado inventado: es el que no se puede alcanzar en este preset sin
  // gastar créditos de verdad.
  const generando = await ctx.page.evaluate(() => {
    window.__nefan.devPanel.setPainting(false);
    window.__nefan.devPanel.setPainting(true);
    const dev = document.getElementById("dev-status");
    const caja = dev.getBoundingClientRect();
    const gasto = document.getElementById("ds-spend").getBoundingClientRect();
    return {
      devAlto: Math.round(caja.height),
      devScroll: dev.scrollHeight,
      gastoTop: Math.round(gasto.top),
      gastoBottom: Math.round(gasto.bottom),
      aviso: (document.getElementById("ds-gen").textContent ?? "").trim(),
    };
  });
  ctx.log(`panel generando: ${JSON.stringify(generando)}`);
  ctx.expect(
    "el panel está de verdad avisando de que genera (si no, no se mide el peor caso)",
    /GENERANDO/i.test(generando.aviso),
    JSON.stringify(generando.aviso),
  );
  ctx.expect(
    "…y el chip del GASTO se lee entero mientras genera: la cota no esconde lo que el panel vigila",
    generando.gastoBottom <= generando.devAlto && generando.gastoTop >= 0,
    `gasto en y ${generando.gastoTop}–${generando.gastoBottom} contra una barra de ${generando.devAlto}px ` +
      `(el panel entero pide ${generando.devScroll}px)`,
  );

  // ── 1d · El hueco del título se DERIVA de la variable, no lo copia ───────
  // El candado de arriba sujeta que el panel no crezca por encima del número;
  // este sujeta la otra mitad, que es la que se rompe sola: que el título siga
  // leyendo ESE número. Comparar los valores de hoy no vale —con la variable
  // a 136 y un `padding` escrito a mano coincidirían—, así que se MUEVE la
  // variable y se mira si el hueco la sigue.
  const derivado = await ctx.page.evaluate(() => {
    const raiz = document.documentElement;
    const t = document.getElementById("title-screen");
    const leer = () => Math.round(parseFloat(getComputedStyle(t).paddingTop));
    const antes = leer();
    raiz.style.setProperty("--dev-status-alto", "240px");
    const despues = leer();
    raiz.style.removeProperty("--dev-status-alto");
    return { antes, despues, restaurado: leer() };
  });
  ctx.log(`hueco del título: ${JSON.stringify(derivado)}`);
  ctx.expect(
    "el hueco superior del título SIGUE a `--dev-status-alto` (no es un número copiado)",
    derivado.despues === 250 && derivado.restaurado === derivado.antes,
    JSON.stringify(derivado),
  );

  // ── 1b · #251 en negativo: sin partidas no hay nada que avisar ───────────
  const sinPartidas = await ctx.page.evaluate(() => {
    const el = document.getElementById("ts-mas");
    const r = el?.getBoundingClientRect();
    return {
      existe: Boolean(el),
      oculto: el?.hidden ?? null,
      area: r ? Math.round(r.width * r.height) : 0,
      tarjetas: document.querySelectorAll(".ts-save").length,
    };
  });
  ctx.log(`con 0 partidas: ${JSON.stringify(sinPartidas)}`);
  ctx.expect(
    "con 0 partidas guardadas la columna cabe y NO se avisa de nada (#251 no grita de más)",
    sinPartidas.tarjetas === 0 && sinPartidas.oculto === true,
    JSON.stringify(sinPartidas),
  );
  await ctx.shot("titulo-estrecho-sin-partidas");

  // ── 2 · El caso COMÚN: ventana ancha, la lista entera a la vista ────────
  // Una partida REAL (para tener un save válido que clonar) y cuatro copias:
  // CINCO, que es donde QA vio el defecto. A 1280×800 —el viewport por
  // defecto de la batería, o sea el caso más común que existe— la columna
  // DESBORDA por los 24 px de `margin-bottom` de la lista con las cinco
  // tarjetas a la vista, y el aviso decía «↓ hay 0 partidas más».
  await ctx.page.setViewportSize(ANCHA);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const jugada = await comenzar(ctx);
  clonarSaves(jugada.sessionId, 4);
  await recargarAlTitulo(ctx);
  const conCinco = await ctx.waitFor(
    "el título ancho pinta sus cinco partidas",
    () => {
      if (document.querySelectorAll(".ts-save").length < 5) return null;
      const content = document.getElementById("title-screen").firstElementChild;
      const caja = content.getBoundingClientRect();
      const el = document.getElementById("ts-mas");
      return {
        tarjetas: document.querySelectorAll(".ts-save").length,
        desborda: content.scrollHeight > content.clientHeight + 1,
        fuera: [...content.querySelectorAll(".ts-save")].filter(
          (f) => f.getBoundingClientRect().bottom > caja.bottom + 1,
        ).length,
        oculto: el?.hidden ?? null,
        texto: (el?.textContent ?? "").trim(),
      };
    },
    30_000,
  );
  ctx.log(`a ${ANCHA.width}×${ANCHA.height} con 5 partidas: ${JSON.stringify(conCinco)}`);
  // NO CONCLUYENTE antes que verde: sin desborde no hay nada que distinguir.
  ctx.expect(
    "la columna DESBORDA con las cinco tarjetas a la vista (el estado que confundía al aviso)",
    conCinco.desborda && conCinco.fuera === 0,
    JSON.stringify(conCinco),
  );
  ctx.expect(
    "…y aun así NO se avisa: la condición es que falte algo por ver, no que la columna desborde",
    conCinco.oculto === true,
    `dice "${conCinco.texto}"`,
  );
  await ctx.shot("titulo-ancho-con-la-lista-entera-a-la-vista");

  // ── 3 · #251: con más partidas de las que caben, el jugador se entera ────
  clonarSaves(`${jugada.sessionId}_clon0`, 7);
  ctx.log("sembradas 12 partidas en total");
  await ctx.page.setViewportSize(ESTRECHA);
  await recargarAlTitulo(ctx);
  const conDoce = await ctx.waitFor(
    "el título pinta la lista de partidas en la ventana estrecha",
    () => {
      const tarjetas = document.querySelectorAll(".ts-save").length;
      if (tarjetas < 12) return null;
      const content = document.getElementById("title-screen").firstElementChild;
      const el = document.getElementById("ts-mas");
      const r = el?.getBoundingClientRect();
      // Cuántas tarjetas quedan FUERA de verdad, medido aquí y no leído del
      // aviso: es contra esto contra lo que se contrasta lo que dice.
      const caja = content.getBoundingClientRect();
      const fuera = [...content.querySelectorAll(".ts-save")].filter(
        (f) => f.getBoundingClientRect().bottom > caja.bottom + 1,
      ).length;
      const texto = (el?.textContent ?? "").trim();
      return {
        tarjetas,
        fuera,
        // El número que ANUNCIA el aviso, extraído del texto. `null` si no lo
        // lleva: un aviso sin número no puede pasar por bueno.
        anunciadas: /hay (\d+) partida/.exec(texto) ? Number(RegExp.$1) : null,
        desborda: content.scrollHeight > content.clientHeight + 1,
        oculto: el?.hidden ?? null,
        texto,
        area: r ? Math.round(r.width * r.height) : 0,
        dentroDelViewport: r ? r.top >= 0 && r.bottom <= window.innerHeight : false,
        botonY: Math.round(document.getElementById("ts-new").getBoundingClientRect().top),
      };
    },
    30_000,
  );
  ctx.log(`con 12 partidas: ${JSON.stringify(conDoce)}`);

  // NO CONCLUYENTE antes que verde, otra vez: si la columna cupiera, la señal
  // no tendría que estar y el aserto de abajo mediría lo contrario de nada.
  ctx.expect(
    "con 12 partidas la columna NO cabe (si cupiera, no habría nada que señalar)",
    conDoce.desborda,
    JSON.stringify(conDoce),
  );
  ctx.expect(
    "quien tiene más partidas de las que caben SE ENTERA: la señal existe y se ve (#251)",
    conDoce.oculto === false && conDoce.area > 0 && conDoce.dentroDelViewport,
    JSON.stringify(conDoce),
  );
  // EL NÚMERO, no la forma de la frase. Con `/hay .* más/` el aserto pasaba
  // sobre «↓ hay 0 partidas más», que es el caso absurdo que este guion
  // existe para distinguir del bueno: un candado que bendice las dos cosas no
  // es un candado.
  ctx.expect(
    "…y dice CUÁNTAS quedan fuera, contrastado con las que de verdad no se ven",
    conDoce.anunciadas !== null && conDoce.anunciadas === conDoce.fuera && conDoce.fuera > 0,
    `anuncia ${JSON.stringify(conDoce.anunciadas)} y fuera de la caja hay ${conDoce.fuera} · "${conDoce.texto}"`,
  );
  ctx.expect(
    "…y lo dice en español",
    /desplaza la lista/.test(conDoce.texto),
    JSON.stringify(conDoce.texto),
  );
  // Y no ha vuelto a mover el botón: la señal es ABSOLUTA sobre el overlay
  // justo para eso (#181-c). Si algún día alguien la mete en el flujo, esto
  // se pone rojo.
  ctx.expect(
    "…sin mover «Nueva partida»: la señal se pinta encima, no dentro de la columna",
    Math.abs(conDoce.botonY - yaLleno.botonY) <= 2,
    `${yaLleno.botonY}px sin lista → ${conDoce.botonY}px con doce partidas`,
  );
  await ctx.shot("titulo-estrecho-con-doce-partidas");

  // Al llegar abajo del todo la señal se retira: un «hay más» permanente con
  // la última tarjeta a la vista es la otra forma de mentir sobre lo mismo.
  const alFinal = await ctx.waitFor(
    "al desplazar la columna hasta el final, la señal se retira",
    () => {
      const content = document.getElementById("title-screen").firstElementChild;
      content.scrollTop = content.scrollHeight;
      const el = document.getElementById("ts-mas");
      return el?.hidden === true ? { oculto: true } : null;
    },
    10_000,
  );
  ctx.expect("…y desaparece al llegar al final de la lista", alFinal.oculto === true);

  // Se deja el viewport como lo encontró: la página se cierra al acabar el
  // guion, pero el siguiente lee el defecto del runner y no un residuo.
  await ctx.page.setViewportSize({ width: 1280, height: 800 });
}
