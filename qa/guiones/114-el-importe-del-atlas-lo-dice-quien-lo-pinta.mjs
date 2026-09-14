/** EL IMPORTE DEL ATLAS ES EL QUE COTIZA QUIEN LO VA A PINTAR.
 *
 *  #513, tanda «el dinero no miente» (2026-09-14). El panel de «Aplicar estilo»
 *  es la única pantalla del juego donde el jugador acepta gastar dinero real, y
 *  hasta esa fecha el importe de la librería de superficies se lo calculaba el
 *  CLIENTE con una fórmula propia: `ceil(celdas_que_faltan / 12) × $0.15`. Esa
 *  fórmula llevaba tiempo divergida del empaquetador que de verdad manda las
 *  llamadas de pago (`pack_missing`, en `ai_server/surface_atlas_generator.py`),
 *  que abre página por GRUPO —tiles aparte de uniques, y un subgrupo por cada
 *  ref de cara— y cobra cada página al precio de SU modelo. Medido sobre las
 *  fixtures de `data/scenes/` con la caché vacía: se prometía $0.15 y se
 *  cobraban $0.47 en el peor caso (3,1×); el techo de una petición de 64 celdas
 *  con ref propia cada una es 12,1× ($0.90 → $10.88).
 *
 *  El arreglo no fue corregir la aritmética del cliente —eso habría sido el
 *  TERCER port del empaquetador— sino que `resolve_only` devuelva
 *  `quoted_cost_usd` y que el cliente enseñe lo que le den. Este guion canda
 *  exactamente eso, en las dos direcciones:
 *
 *   1. Lo que el panel promete por el atlas es, AL CÉNTIMO, la suma de lo que
 *      el servidor cotizó en las respuestas de `resolve_only` que pasaron por
 *      el cable. No se compara contra un número fijo del bench ni contra una
 *      cuenta repetida aquí: se lee del wire. Si el cliente volviera a calcular
 *      el precio por su cuenta, cualquier divergencia con el servidor —que es
 *      la que costaba dinero— sale roja.
 *   2. Y si el servidor NO cotiza (respuesta sin `quoted_cost_usd`), el panel
 *      dice «coste no disponible» y lo arrastra al total y al botón. Jamás una
 *      cifra inventada — ni siquiera el «$0.00 + ?» que el botón enseñaba hasta
 *      hoy, que es el último punto vivo de #548: de «Aplicar estilo (~$0.00 +
 *      ?)» lo primero que se lee es el cero.
 *   3. La otra clase de cifra, que el atlas ya no es pero los skins sí: una
 *      COTA se lee «hasta $X» y vuelve cota el total y el botón. El caso hay
 *      que CONSTRUIRLO —el catálogo del motor falso no publica el plan de las
 *      tres anims, así que en el bench los skins salen sin precio—, y se
 *      construye sirviendo el catálogo que sí lo publica, como el servicio de
 *      verdad. Sin esto, «hasta» sería una palabra que ningún guion ve.
 *   4. Y las TRES clases a la vez, que es el estado de un jugador con un estilo
 *      subido a medias: un bloque exacto, uno cota y uno sin precio. La mezcla
 *      se lee «hasta $X + ?» — el «hasta» del que no es exacto y el «+ ?» del
 *      que no tiene precio, sin que uno se coma al otro (hallazgo H9 del QA).
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más: que la cotización del
 *  servidor sea la factura. Eso no se puede afirmar aquí sin gastar, y su sitio
 *  es `ai_server/tests/test_atlas_cotizacion.py`, que compara `cotizar()` con el
 *  `cost_usd` de `generate()` con el pintor stubeado. Este guion mide la otra
 *  mitad: que el cliente no se invente la cifra por el camino.
 *
 *  CERO CRÉDITOS Y CERO GASTO: este guion NUNCA pulsa `#ts-style-run`. Genera su
 *  mundo con el motor falso (como el 07, el 97 y el 123) y sale por «Cancelar».
 *
 *  EN NEGATIVO (probado al escribirlo, las cuatro sondas revertidas — ver el
 *  informe): devolviendo `resolveMissing` al `ceil(missing/12) × 0.15` de antes,
 *  (1) se pone rojo ($0.30 en pantalla contra $0.15 del wire); devolviendo el
 *  bloque a `{clase:"exacto", usd:0}` cuando falta la cotización, (2) se pone
 *  rojo; pintando la cota sin su «hasta» en `precioEnTexto`, (3) se pone rojo en
 *  la fila; y con `esCota = false` en `resumirElImporte`, (3) se pone rojo en el
 *  total y en el botón. Las dos mitades de (3) hacen falta: la fila y el total
 *  los decide código distinto.
 */
import { nuevaPartida, regenerarMundo } from "../lib/sesion.mjs";

/** Precondición DECLARADA, las dos por el mismo motivo que el 97:
 *   · `mundo`   — el plan deriva sus celdas del snapshot del mundo; heredar el
 *                 de otro guion es medir SU atlas.
 *   · `fake-ai` — el motor falso cachea en memoria las celdas ya «pintadas», y
 *                 con la caché caliente el bloque del atlas llega a «en caché
 *                 ($0)»: sin celdas que falten no hay nada que cotizar, o sea
 *                 que este guion se queda sin sujeto. */
export const aisla = ["mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** La fila del atlas del panel, tal como la lee el jugador. */
function leerLaFilaDelAtlas() {
  const fila = [...document.querySelectorAll("#ts-style-plan label")].find((l) =>
    /Librer[ií]a de superficies/i.test(l.textContent ?? ""),
  );
  const texto = (fila?.textContent ?? "").replace(/\s+/g, " ").trim();
  const m = /—\s*(hasta\s+)?\$(\d+(?:\.\d+)?)\s*$/.exec(texto);
  return {
    hay: Boolean(fila),
    texto,
    enCache: /en cach[eé] \(\$0\)/i.test(texto),
    sinPrecio: /coste no disponible/i.test(texto),
    esCota: Boolean(m && m[1]),
    precio: m ? Number(m[2]) : null,
    total: (document.getElementById("ts-style-total")?.textContent ?? "").trim(),
    boton: (document.getElementById("ts-style-run")?.textContent ?? "").trim(),
    // ¿Queda ALGÚN bloque encendido con cifra? De eso depende cómo se dice un
    // desconocido: con «+ ?» detrás de la suma, o solo, sin un «$0.00» que
    // parezca el precio.
    otraConCifra: [...document.querySelectorAll("#ts-style-plan label")].some((l) => {
      const t = (l.textContent ?? "").replace(/\s+/g, " ").trim();
      const cb = l.querySelector("input[data-block-idx]");
      if (!cb?.checked || /en cach[eé] \(\$0\)/i.test(t)) return false;
      return !/Librer[ií]a de superficies/i.test(t) && /—\s*(hasta\s+)?\$/.test(t);
    }),
  };
}

export default async function (ctx) {
  // Lo que el SERVIDOR cotizó por el cable, lote a lote. Es la única fuente de
  // la cifra esperada: repetir aquí la cuenta sería la cuarta copia.
  const cotizaciones = [];
  /** `sinCotizar`: se le quita `quoted_cost_usd` a la respuesta del atlas — el
   *  servidor que no cotiza, caso (2). `catalogoQueCostea`: el catálogo de
   *  sprites publica el plan de las tres anims, con lo que los skins pasan a
   *  tener precio y son la COTA del caso (3). */
  const plan = { sinCotizar: false, catalogoQueCostea: false, packIncompleto: false };

  // Un estilo SUBIDO y no completado: su pack declara refs sin imagen, así que
  // el bloque «Referencias del estilo» tiene precio en vez de estar en caché.
  // Es un flujo soportado del juego (/styles/upload → confirmar → /complete) y
  // el motor falso no lo sirve, porque sus packs están completos.
  await ctx.page.route("**/styles/*/missing", async (route) => {
    const res = await route.fetch();
    const texto = await res.text();
    if (!plan.packIncompleto) {
      await route.fulfill({ response: res, body: texto });
      return;
    }
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      await route.fulfill({ response: res, body: texto });
      return;
    }
    cuerpo.missing = [{ id: "fachada", folder: "faces", description: "una fachada de piedra" }];
    // Cifra de ATREZO, y a propósito no una tarifa real: quien cotiza el pack
    // es `style_pack_builder.precio_de_ref` y aquí solo hace falta un número
    // que se lea en pantalla. Escribir $0.17 haría saltar —con razón— la regla
    // `el-precio-lo-dice-quien-empaqueta`, que vigila también `qa/**`.
    cuerpo.estimated_cost_usd = 0.11;
    await route.fulfill({
      response: res,
      contentType: "application/json",
      body: JSON.stringify(cuerpo),
    });
  });

  await ctx.page.route("**/sprite_catalog", async (route) => {
    const res = await route.fetch();
    const texto = await res.text();
    if (!plan.catalogoQueCostea) {
      await route.fulfill({ response: res, body: texto });
      return;
    }
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      await route.fulfill({ response: res, body: texto });
      return;
    }
    // Los perfiles del set que usa el juego, que es lo que el servicio real
    // publica: idle 8 llamadas, walk y run 4. Con ellos `skinImageCalls` sabe
    // costear (1 hero + 16 = 17 por personaje) y el bloque pasa a ser cota.
    cuerpo.animations = [
      { id: "idle", keyframes: 8, play_fps: 2.2, calls_per_anim: 8 },
      { id: "walk", keyframes: 4, play_fps: 3.6, calls_per_anim: 4 },
      { id: "run", keyframes: 4, play_fps: 6.0, calls_per_anim: 4 },
    ];
    await route.fulfill({
      response: res,
      contentType: "application/json",
      body: JSON.stringify(cuerpo),
    });
  });

  await ctx.page.route("**/generate_surface_atlas", async (route) => {
    const res = await route.fetch();
    const texto = await res.text();
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      // La respuesta cambió de forma y este guion ya no mide lo que dice: pasa
      // tal cual y que fallen sus asertos, no este interceptor.
      await route.fulfill({ response: res, body: texto });
      return;
    }
    let pedido = {};
    try {
      pedido = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      pedido = {};
    }
    if (plan.sinCotizar) {
      delete cuerpo.quoted_cost_usd;
      delete cuerpo.quoted_pages;
    } else if (pedido.resolve_only === true) {
      cotizaciones.push({
        missing: cuerpo.missing,
        usd: cuerpo.quoted_cost_usd,
        paginas: cuerpo.quoted_pages,
      });
    }
    await route.fulfill({
      response: res,
      contentType: "application/json",
      body: JSON.stringify(cuerpo),
    });
  });

  // El mundo lo genera ESTE guion (el runner acaba de borrar el que hubiera):
  // sin snapshot, «Aplicar estilo» está deshabilitado y no hay panel que leer.
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image", charMode: "image" });

  // ── 1 · el panel promete lo que el servidor cotizó ───────────────────────
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const atlas = await ctx.page.evaluate(leerLaFilaDelAtlas);
  ctx.log(`fila del atlas: «${atlas.texto}»`);
  ctx.log(`cotizaciones del servidor: ${JSON.stringify(cotizaciones)}`);

  ctx.expect(
    "PRECONDICIÓN — el panel trae la fila de la librería de superficies",
    atlas.hay,
    atlas.texto,
  );
  const faltan = cotizaciones.reduce((a, c) => a + (c.missing ?? 0), 0);
  if (cotizaciones.length === 0 || faltan === 0) {
    ctx.sinMedirBloque(
      `no quedó ninguna celda por pintar (${JSON.stringify(cotizaciones)}): sin celdas que ` +
        "cotizar, el importe del atlas no tiene sujeto",
    );
  } else {
    const esperado = Number(cotizaciones.reduce((a, c) => a + (c.usd ?? 0), 0).toFixed(2));
    ctx.expect(
      "el importe del atlas es AL CÉNTIMO el que cotizó quien lo va a pintar",
      atlas.precio === esperado,
      `wire ⇒ $${esperado.toFixed(2)} · pantalla ⇒ «${atlas.texto}»`,
    );
    ctx.expect(
      "…y se presenta como EXACTO, no como cota: el servidor sabe lo que va a cobrar",
      atlas.esCota === false && atlas.sinPrecio === false,
      `«${atlas.texto}»`,
    );
    ctx.expect(
      "el servidor cotiza páginas de verdad para las celdas que faltan (si no, no hay precio que comparar)",
      cotizaciones.every((c) => (c.missing > 0 ? c.paginas > 0 : true)),
      JSON.stringify(cotizaciones),
    );
  }
  await ctx.shot("importe-del-atlas-cotizado-por-el-servidor");

  // ── 2 · sin cotización del servidor, NO hay cifra ────────────────────────
  await ctx.page.click("#ts-style-cancel");
  plan.sinCotizar = true;
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const mudo = await ctx.page.evaluate(leerLaFilaDelAtlas);
  ctx.log(`sin cotización: «${mudo.texto}» · total «${mudo.total}» · botón «${mudo.boton}»`);

  if (mudo.enCache) {
    ctx.sinMedirBloque(
      "en la segunda pasada el atlas ya está en caché: no hay bloque de pago que quedarse sin precio",
    );
  } else {
    ctx.expect(
      "un servidor que no cotiza deja el atlas en «coste no disponible», nunca en una cifra inventada",
      mudo.sinPrecio && mudo.precio === null,
      `«${mudo.texto}»`,
    );
    // Cómo se DICE ese desconocido depende de si queda algo con cifra. Con
    // otro bloque con precio, «+ ?» detrás de la suma; sin ninguno, «coste no
    // disponible» a secas y SIN un «$0.00» delante — ese cero era el último
    // punto vivo de #548: lo primero que se lee de «Aplicar estilo (~$0.00 +
    // ?)» es que no cuesta nada, y el batch podía costar tres dólares.
    if (mudo.otraConCifra) {
      ctx.expect(
        "el desconocido no desaparece del total ni del botón: los dos llevan «+ ?»",
        /\+\s*\?/.test(mudo.total) && /\+\s*\?/.test(mudo.boton),
        `total «${mudo.total}» · botón «${mudo.boton}»`,
      );
    } else {
      ctx.expect(
        "sin ningún bloque con precio, el total y el botón dicen «coste no disponible», no «$0.00»",
        /coste no disponible/i.test(mudo.total) &&
          /coste no disponible/i.test(mudo.boton) &&
          !/\$0\.00/.test(mudo.total) &&
          !/\$0\.00/.test(mudo.boton),
        `total «${mudo.total}» · botón «${mudo.boton}»`,
      );
    }
  }
  await ctx.shot("importe-del-atlas-sin-cotizacion");

  // ── 3 · una cota se lee «hasta», y arrastra al total y al botón ──────────
  await ctx.page.click("#ts-style-cancel");
  plan.sinCotizar = false;
  plan.catalogoQueCostea = true;
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const conCota = await ctx.page.evaluate(() => {
    const filas = [...document.querySelectorAll("#ts-style-plan label")].map((l) =>
      (l.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    return {
      filas,
      skins: filas.find((t) => /Skins de personaje/i.test(t)) ?? "",
      total: (document.getElementById("ts-style-total")?.textContent ?? "").trim(),
      boton: (document.getElementById("ts-style-run")?.textContent ?? "").trim(),
    };
  });
  ctx.log(`con catálogo que costea: ${JSON.stringify(conCota.filas)}`);
  ctx.log(`total «${conCota.total}» · botón «${conCota.boton}»`);
  if (/en cach[eé] \(\$0\)/i.test(conCota.skins)) {
    // Único caso legítimo sin sujeto: este mundo no tiene personajes que vestir
    // (o ya están todos pintados). Que el bloque exista y NO sea cota no lo es:
    // eso es el defecto, y por eso se afirma abajo en vez de declararse.
    ctx.sinMedirBloque(
      `los skins de este mundo están en caché («${conCota.skins}»): no hay bloque de pago que sea cota`,
    );
  } else {
    ctx.expect(
      "con un catálogo que SABE costear, el bloque de skins se lee como cota: «hasta $X»",
      /hasta\s+\$/.test(conCota.skins),
      `«${conCota.skins}»`,
    );
    ctx.expect(
      "una COTA encendida vuelve cota el total: no se promete exacto lo que no lo es",
      /hasta\s+\$/.test(conCota.total),
      `skins «${conCota.skins}» · total «${conCota.total}»`,
    );
    ctx.expect(
      "…y el botón que dispara el gasto tampoco se come el «hasta»",
      /hasta\s+\$/.test(conCota.boton),
      `«${conCota.boton}»`,
    );
  }
  await ctx.shot("importe-con-una-cota-encendida");

  // ── 4 · las TRES clases a la vez: exacto + cota + desconocido ────────────
  await ctx.page.click("#ts-style-cancel");
  plan.sinCotizar = true;       // el atlas se queda sin precio
  plan.packIncompleto = true;   // el pack tiene uno exacto
  plan.catalogoQueCostea = true; // y los skins, una cota
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const mezcla = await ctx.page.evaluate(() => {
    const filas = [...document.querySelectorAll("#ts-style-plan label")].map((l) =>
      (l.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    return {
      filas,
      exactos: filas.filter((t) => /—\s*\$\d/.test(t)).length,
      cotas: filas.filter((t) => /—\s*hasta\s+\$/.test(t)).length,
      sinPrecio: filas.filter((t) => /coste no disponible/i.test(t)).length,
      total: (document.getElementById("ts-style-total")?.textContent ?? "").trim(),
      boton: (document.getElementById("ts-style-run")?.textContent ?? "").trim(),
    };
  });
  ctx.log(`mezcla: ${JSON.stringify(mezcla.filas)}`);
  ctx.log(`total «${mezcla.total}» · botón «${mezcla.boton}»`);
  ctx.expect(
    "PRECONDICIÓN — el plan trae una fila de cada clase: exacta, cota y sin precio",
    mezcla.exactos >= 1 && mezcla.cotas >= 1 && mezcla.sinPrecio >= 1,
    JSON.stringify({ exactos: mezcla.exactos, cotas: mezcla.cotas, sinPrecio: mezcla.sinPrecio }),
  );
  ctx.expect(
    "con las tres clases encendidas el total dice «hasta $X + ?»: ni el «hasta» ni el «+ ?» se comen al otro",
    /hasta\s+\$\d/.test(mezcla.total) && /\+\s*\?/.test(mezcla.total),
    `«${mezcla.total}»`,
  );
  ctx.expect(
    "…y el botón que dispara el gasto promete lo mismo",
    /hasta\s+\$\d/.test(mezcla.boton) && /\+\s*\?/.test(mezcla.boton),
    `«${mezcla.boton}»`,
  );
  await ctx.shot("importe-con-las-tres-clases");

  // ── Salir por «Cancelar»: ni un céntimo ──────────────────────────────────
  await ctx.page.click("#ts-style-cancel");
  const tras = await ctx.page.evaluate(() => ({
    hueco: (document.getElementById("ts-style-plan")?.innerHTML ?? "?").trim(),
    aplicar: Boolean(document.getElementById("ts-apply-style")),
  }));
  ctx.expect(
    "«Cancelar» cierra el panel sin gastar y deja el selector en pie",
    tras.hueco === "" && tras.aplicar,
    JSON.stringify(tras),
  );
}
