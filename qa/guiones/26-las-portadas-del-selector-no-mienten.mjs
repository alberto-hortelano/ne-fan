/** Las portadas del selector de mundos: o se ven, o se degradan diciéndolo (#218).
 *
 *  Es lo PRIMERO que ve quien abre el juego. Hasta hoy la tarjeta elegía entre
 *  `<img>` y marcador mirando si el estilo declaraba `cover_url`, y ahí se
 *  acababa la historia: si el fichero declarado no llegaba —el asset-store
 *  caído, un pack a medias, el fake del bench sin esa ruta— el navegador
 *  pintaba su icono de imagen rota y no quedaba rastro en ningún sitio. En el
 *  preset `e2e-sin-creditos` pasaba SIEMPRE, en las cuatro tarjetas, desde
 *  #207, y ningún guion miraba.
 *
 *  Lo que afirma, en los dos estados que existen:
 *
 *  1. Con las portadas servidas (el bench las sirve desde #218: el fake copia
 *     `GET /styles/{id}/{file}` del asset-store), las cuatro tarjetas enseñan
 *     una IMAGEN de verdad — `naturalWidth > 0`, no "el <img> está en el DOM".
 *  2. Sin ellas, ninguna tarjeta se queda con un marco roto: cae al marcador
 *     con el nombre del estilo y el fallo deja ENTRADA en el registro de
 *     errores. Un icono roto es un fallo mudo con cara de fallo; un marcador
 *     sin entrada sería un fallo mudo sin cara: hacen falta los dos.
 *  3. Y ese marcador DICE que la portada falló, en vez de parecerse al de un
 *     pack que no declara portada. Los dos casos se veían idénticos —el mismo
 *     cuadro gris con el nombre— y lo único que los separaba era una entrada
 *     del registro que el título esconde mientras está delante. El estado de
 *     avería lo escribe SOLO el listener del fallo, así que el pack sin arte
 *     no puede llevarlo; lo que este guion mide es que el que sí falló lo
 *     lleva y el que cargó bien no.
 *
 *  El sabotaje va en el BORDE (las imágenes del pack no llegan), no dentro del
 *  cliente, y se hace ANTES de que nadie pida ninguna portada: así el segundo
 *  bloque —el control— pide las suyas de verdad por la red en vez de cobrarlas
 *  de la caché del navegador, y los dos estados se miden por el mismo camino.
 *
 *  EN NEGATIVO (2026-08-25, uno por uno, cada uno en su corrida):
 *  - sin el listener de portadas (`vigilarPortadas`) → rojos el `<img>` roto y
 *    las dos entradas del registro; el bloque 2 sigue verde.
 *  - con el `coverHtml` de antes (marcador O imagen, excluyentes) → rojo SOLO
 *    el del marcador: la caja se queda vacía al quitar la imagen.
 *  - sin la ruta `/styles/{id}/{file}` en el fake → rojo SOLO el bloque 2, con
 *    las cuatro portadas a 0 px; la degradación sigue verde.
 */
import { abrirSelectorDeMundos } from "../lib/sesion.mjs";

/** Las imágenes de un pack de estilo (portadas y refs). Deja fuera
 *  `/styles/{id}/missing` y `style.json`, que son otras rutas y las usa el
 *  panel de generación: sabotearlas metería fallos ajenos al sujeto. */
const IMAGENES_DE_ESTILO = /\/styles\/[^/]+\/[^/]+\.(jpg|jpeg|png|webp)$/;

/** Lo que hay en las tarjetas del selector, leído del DOM: por cada mundo, si
 *  tiene imagen y si esa imagen se DECODIFICÓ, qué dice su marcador y qué
 *  estilo anuncia la etiqueta de la tarjeta. */
function loQueEnsenanLasTarjetas() {
  return [...document.querySelectorAll("[data-cover-for]")].map((caja) => {
    const img = caja.querySelector("img");
    const juego = caja.getAttribute("data-cover-for") ?? "";
    const etiqueta = document.querySelector(`[data-style-label-for="${CSS.escape(juego)}"]`);
    return {
      juego,
      hayImg: Boolean(img),
      cargada: Boolean(img?.complete && img.naturalWidth > 0),
      ancho: img?.naturalWidth ?? 0,
      src: img?.getAttribute("src") ?? "",
      marcador: (caja.querySelector("[data-cover-nombre]")?.textContent ?? "").trim(),
      // El estado «avería» de la caja: existe SOLO cuando una portada
      // declarada no llegó. Un pack que no declara portada pinta el mismo
      // marcador sin nada de esto.
      averia: Boolean(caja.querySelector("[data-cover-aviso]")),
      marcada: caja.getAttribute("data-cover-failed") ?? "",
      aviso: (caja.querySelector("[data-cover-aviso]")?.textContent ?? "").trim(),
      etiqueta: (etiqueta?.textContent ?? "").replace(/^·\s*Estilo:\s*/, "").trim(),
    };
  });
}

function entradasDelRegistro(fuente) {
  return [...document.querySelectorAll(".error-log__entry")]
    .filter((e) => (e.querySelector(".error-log__source")?.textContent ?? "") === fuente)
    .map((e) => e.querySelector(".error-log__msg")?.textContent ?? "");
}

export default async function (ctx) {
  // ── 1. Sin portadas: marcador y rastro, nunca un marco roto ──
  await ctx.page.route(IMAGENES_DE_ESTILO, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "portada no servida (caída simulada por QA)" }),
    }),
  );

  await abrirSelectorDeMundos(ctx);
  const rotas = await ctx
    .waitFor(
      "las tarjetas del selector reaccionan a las portadas que no llegan",
      () =>
        [...document.querySelectorAll("[data-cover-for]")].length > 0 &&
        [...document.querySelectorAll("[data-cover-for] img")].length === 0
          ? { listo: true }
          : null,
      15_000,
    )
    .catch(() => null);
  const sinPortada = await ctx.page.evaluate(loQueEnsenanLasTarjetas);
  // Del canal "title" solo interesan las quejas de portada: por ahí sale
  // también el fallo de listar las partidas guardadas, que es de otro dueño.
  const avisos = (await ctx.page.evaluate(entradasDelRegistro, "title")).filter((m) => /portada/i.test(m));
  for (const t of sinPortada) ctx.log(`${t.juego}: img=${t.hayImg} marcador="${t.marcador}" (estilo "${t.etiqueta}")`);

  ctx.expect(
    "hay tarjetas de mundo que mirar (si no, lo de abajo no significaría nada)",
    sinPortada.length > 0,
    `${sinPortada.length} tarjetas`,
  );
  ctx.expect(
    "ninguna tarjeta se queda con un <img> roto cuando la portada no llega",
    Boolean(rotas) && sinPortada.every((t) => !t.hayImg),
    JSON.stringify(sinPortada.filter((t) => t.hayImg)),
  );
  ctx.expect(
    "cada tarjeta cae al marcador, y el marcador lleva el nombre del ESTILO que anuncia",
    sinPortada.every((t) => t.marcador.length > 0 && t.marcador === t.etiqueta),
    JSON.stringify(sinPortada.map((t) => [t.marcador, t.etiqueta])),
  );
  ctx.expect(
    "…y el fallo deja rastro en el registro de errores, una entrada por portada caída",
    avisos.length >= sinPortada.length,
    `${avisos.length} entradas "title": ${JSON.stringify(avisos.slice(0, 4))}`,
  );
  // Un «algo falló» no sirve de nada: la entrada tiene que decir QUÉ portada,
  // con el nombre que se lee en la tarjeta y con la ruta del fichero que no
  // llegó — lo uno para encontrar la caja en pantalla, lo otro para ir al
  // disco.
  ctx.expect(
    "la entrada NOMBRA el estilo cuya portada falló, y la ruta que no llegó",
    sinPortada.length > 0 &&
      sinPortada.every((t) => avisos.some((m) => m.includes(t.etiqueta) && /\/styles\/[^/]+\//.test(m))),
    JSON.stringify(avisos.slice(0, 4)),
  );
  // Y la avería se ve EN LA TARJETA, no solo en un registro que esta pantalla
  // esconde: «se cayó el asset-store» y «este pack todavía no tiene portada»
  // eran el mismo cuadro gris. El estado de avería lo escribe únicamente el
  // listener del fallo, así que un pack sin `cover_url` nunca lo lleva.
  ctx.expect(
    "la tarjeta DICE que la portada falló, en vez de parecer un pack sin arte",
    sinPortada.every((t) => t.averia && /no disponible/i.test(t.aviso) && t.marcada.length > 0),
    JSON.stringify(sinPortada.map((t) => ({ juego: t.juego, aviso: t.aviso, marcada: t.marcada }))),
  );
  await ctx.shot("sin-portadas-marcador-y-registro");

  // ── 2. Con las portadas servidas: se ven de verdad (el control) ──
  //
  // Mismo selector, mismo camino, mismas tarjetas: lo único que cambia es que
  // el bench sirve las portadas. Sin este bloque, el de arriba estaría en
  // verde también con un selector que no pintara portadas nunca.
  await ctx.page.unroute(IMAGENES_DE_ESTILO);
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a arrancar", () => Boolean(window.__nefan));
  await abrirSelectorDeMundos(ctx);

  const pintadas = await ctx
    .waitFor(
      "las portadas del bench llegan y se decodifican",
      () => {
        const cajas = [...document.querySelectorAll("[data-cover-for]")];
        const imgs = [...document.querySelectorAll("[data-cover-for] img")];
        return cajas.length > 0 && imgs.length === cajas.length && imgs.every((i) => i.complete && i.naturalWidth > 0)
          ? { n: imgs.length }
          : null;
      },
      20_000,
    )
    .catch(() => null);
  const conPortada = await ctx.page.evaluate(loQueEnsenanLasTarjetas);
  const avisosAhora = (await ctx.page.evaluate(entradasDelRegistro, "title")).filter((m) => /portada/i.test(m));
  for (const t of conPortada) ctx.log(`${t.juego}: ${t.ancho}px ← ${t.src}`);

  ctx.expect(
    "con el stack del bench, las CUATRO portadas del selector se pintan de verdad",
    Boolean(pintadas) && conPortada.length > 0 && conPortada.every((t) => t.cargada),
    JSON.stringify(conPortada.map((t) => ({ juego: t.juego, ancho: t.ancho, src: t.src }))),
  );
  ctx.expect(
    "…y con ellas servidas no hay ni una queja de portada en el registro",
    avisosAhora.length === 0,
    JSON.stringify(avisosAhora.slice(0, 4)),
  );
  // El otro lado del aserto de arriba, y lo que lo convierte en una
  // distinción y no en un adorno: sin avería, la caja no lleva NADA de la
  // avería. Si el aviso se pintara siempre, «portada caída» volvería a ser
  // indistinguible de «pack sin portada», solo que al revés.
  ctx.expect(
    "una portada que SÍ llegó no lleva marca de avería (el aviso no es decorado)",
    conPortada.every((t) => !t.averia && t.marcada === ""),
    JSON.stringify(conPortada.map((t) => ({ juego: t.juego, averia: t.averia, marcada: t.marcada }))),
  );
  await ctx.shot("portadas-del-bench-pintadas");
}
