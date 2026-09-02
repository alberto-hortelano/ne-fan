/** LAS SUPERFICIES VIENEN DE LA LIBRERÍA — y la Maqueta 3D no pinta nada.
 *
 *  T4 (#257) dejó el asset-store con UN solo kind, `surface`, y el cliente pide
 *  cada celda pintada como `/cache/surface/{hash}`. El guion 21 canda que
 *  ninguna petición de una partida vaya a un blob de un kind MUERTO; este canda
 *  la otra mitad, que hasta hoy ningún guion miraba: que las celdas VIVAS
 *  lleguen, y por dónde. La batería no levanta el asset-store real (el motor
 *  falso lo emula: `/generate_surface_atlas` + `/cache/surface/{hash}`), así
 *  que lo que se mide es la FORMA del cable y la conducta del cliente, que son
 *  las dos cosas que un cambio en `fps-atlas.ts` o en `http-server.ts` puede
 *  romper sin que `npm test` se entere (`nefan-html` no tiene tests).
 *
 *  Dos partidas, en el orden en que se rompería:
 *
 *  1 · **Maqueta 3D** (la opción que NO gasta). El cliente pide el atlas del
 *      tile igual —es como restaura arte ya pagado—, pero SOLO con
 *      `resolve_only: true`: contra una librería vacía vuelve sin celdas, sin
 *      pintar y sin coste, y el jugador lee en pantalla por qué está en clay y
 *      qué tecla pinta. Se afirma que hubo peticiones (si no las hubiera, «no
 *      pinta» sería un verde vacío), que TODAS llevan `resolve_only`, que el
 *      motor falso no anotó `/generate_surface_atlas` como ruta de pago, y
 *      que el aviso al jugador existe. Medido en el stack real el 2026-09-02
 *      (`cliente-web`, Miravanda + Acuarela luminosa): 16 celdas de la
 *      librería, 7 por pintar, gasto 0,00 €.
 *
 *  2 · **Imagen IA** (la que sí). El atlas se instala y cada celda descargada
 *      es `{assets}/cache/surface/{16 hex}` — ni un `/cache/albedo/`,
 *      `/cache/plate/`… (los siete kinds sin productor) ni ninguna otra forma
 *      de URL. Es el criterio 7 de T4, contado por el cable: la cascada de
 *      `cache_url` por kind murió con la tanda, y si alguien la resucita, lo
 *      que cambia es exactamente esta URL.
 *
 *  Cero créditos REALES: preset `e2e-sin-creditos`. La partida 2 pinta en el
 *  motor FALSO (dameros), que lo anota como ruta de pago igual que anota el
 *  `/generate_scene` de cualquier partida; por eso este guion no declara
 *  `sinMotor`. `aisla: ["fake-ai"]` deja la librería del falso VACÍA, que es
 *  la precondición de la partida 1 (con celdas ya pintadas, Maqueta 3D las
 *  descargaría y el bloque mediría otra cosa).
 */
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** La única forma viva de una celda del asset-store desde T4 (#257). */
const CELDA_VIVA = /\/cache\/surface\/[a-f0-9]{16}$/;
/** Los siete kinds sin productor (+ la ruta `/cache/check`, que murió con ellos). */
const CELDA_MUERTA = /\/cache\/(albedo|normal|roughness|model|skin|sprite|scene|plate|segment|check)\//;

/** Lo que el motor falso lleva anotado como rutas DE PAGO. */
async function gastoDelFake() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const { gasto } = await res.json();
  return gasto; // { total, rutas }
}

/** Nueva partida con el modo de ESCENARIOS elegido en el título (Maqueta 3D =
 *  `vector`, Imagen IA = `image`) y personajes base (los skins no son el
 *  sujeto). `nuevaPartida` no expone el modo de escenarios: se pulsa aquí el
 *  mismo botón que pulsa el jugador. */
async function partidaEnModo(ctx, renderMode) {
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await ctx.page.click(`#ts-rendermode [data-rendermode="${renderMode}"]`);
  return comenzar(ctx);
}

/** El texto del atlas que el cliente escribe en el registro de pantalla. */
const esperarMensajeDeAtlas = (ctx, desc, regex) =>
  ctx.waitFor(
    desc,
    (src) => document.body.innerText.match(new RegExp(src))?.[0] ?? null,
    90_000,
    regex.source,
  );

export default async function (ctx) {
  // Se escucha ANTES de navegar y se recarga: lo que se afirma abajo es que
  // ciertas peticiones NO ocurrieron, y contar desde la mitad lo vaciaría.
  const peticiones = [];
  const atlasPosts = [];
  ctx.page.on("request", (r) => {
    peticiones.push(r.url());
    if (r.method() === "POST" && r.url().includes("/generate_surface_atlas")) {
      let body = null;
      try {
        body = JSON.parse(r.postData() ?? "null");
      } catch {
        body = { __sin_json: r.postData() };
      }
      atlasPosts.push(body);
    }
  });
  await recargarAlTitulo(ctx);

  // ── 1 · Maqueta 3D: resuelve, no pinta, y lo dice ────────────────────────
  const gastoAntes = await gastoDelFake();
  await partidaEnModo(ctx, "vector");
  const avisoClay = await esperarMensajeDeAtlas(
    ctx,
    "el cliente termina de resolver el atlas del tile contra la librería",
    /Atlas fps de [^\n]*/,
  );
  ctx.log(`aviso del atlas en Maqueta 3D: ${JSON.stringify(avisoClay)}`);
  const postsMaqueta = atlasPosts.slice();
  ctx.expect(
    "en Maqueta 3D el cliente SÍ pide el atlas (es como restaura arte pagado; sin petición, «no pinta» sería un verde vacío)",
    postsMaqueta.length > 0,
    `POST /generate_surface_atlas: ${postsMaqueta.length}`,
  );
  ctx.expect(
    "…y TODAS las peticiones llevan resolve_only: true — la Maqueta nunca manda pintar",
    postsMaqueta.length > 0 && postsMaqueta.every((b) => b && b.resolve_only === true),
    JSON.stringify(postsMaqueta.map((b) => ({ resolve_only: b?.resolve_only, cells: b?.cells?.length }))),
  );
  const gastoTrasMaqueta = await gastoDelFake();
  ctx.expect(
    "el motor falso no anotó /generate_surface_atlas como ruta de pago durante la Maqueta 3D",
    (gastoTrasMaqueta.rutas["/generate_surface_atlas"] ?? 0) === (gastoAntes.rutas["/generate_surface_atlas"] ?? 0),
    JSON.stringify({ antes: gastoAntes.rutas, despues: gastoTrasMaqueta.rutas }),
  );
  ctx.expect(
    "con la librería vacía no se descargó NINGUNA celda (no hay de dónde)",
    !peticiones.some((u) => /\/cache\/surface\//.test(u)),
    JSON.stringify(peticiones.filter((u) => /\/cache\//.test(u)).slice(0, 3)),
  );
  ctx.expect(
    "el jugador lee por qué el mundo está en clay y cómo pintarlo (sin abrir la consola)",
    /sin celdas en la librería/.test(avisoClay) && /clay/.test(avisoClay) && /G o Imágenes/.test(avisoClay),
    avisoClay,
  );
  await ctx.shot("maqueta-3d-en-clay");

  // ── 2 · Imagen IA: las celdas llegan, y llegan como /cache/surface/{hash} ─
  await recargarAlTitulo(ctx);
  const desde = peticiones.length;
  await partidaEnModo(ctx, "image");
  // Se espera al DESENLACE, no solo al éxito: si el atlas falla, el cliente lo
  // dice en su registro («falló — se queda en clay») y es ESO lo que hay que
  // ver en rojo, no un timeout opaco noventa segundos después.
  const avisoInstalado = await esperarMensajeDeAtlas(
    ctx,
    "el atlas del tile en Imagen IA llega a un desenlace (instalado o fallido)",
    /Atlas fps de \S+ instalado[^\n]*|atlas fps de \S+ falló[^\n]*/,
  );
  ctx.log(`aviso del atlas en Imagen IA: ${JSON.stringify(avisoInstalado)}`);
  ctx.expect(
    "el atlas del tile quedó INSTALADO (las celdas pintadas se descargaron y se aplicaron)",
    /instalado/.test(avisoInstalado),
    avisoInstalado,
  );
  const celdas = peticiones.slice(desde).filter((u) => /\/cache\//.test(u));
  const vivas = celdas.filter((u) => CELDA_VIVA.test(u));
  const muertas = peticiones.filter((u) => CELDA_MUERTA.test(u));
  ctx.log(`celdas descargadas: ${celdas.length} · vivas: ${vivas.length} · muertas: ${muertas.length}`);
  ctx.expect(
    "en Imagen IA se descargó al menos una celda del asset-store (si no, la forma de la URL no se mide)",
    celdas.length > 0,
    `celdas: ${celdas.length}`,
  );
  ctx.expect(
    "cada celda descargada es /cache/surface/{16 hex} — la ÚNICA forma viva desde T4 (#257)",
    celdas.length > 0 && celdas.every((u) => CELDA_VIVA.test(u)),
    JSON.stringify(celdas.filter((u) => !CELDA_VIVA.test(u)).slice(0, 3)),
  );
  ctx.expect(
    "y en las dos partidas ni una petición fue a un blob de un kind sin productor",
    muertas.length === 0,
    JSON.stringify(muertas.slice(0, 5)),
  );
  const postsImagen = atlasPosts.slice(postsMaqueta.length);
  ctx.expect(
    "en Imagen IA al menos una petición del atlas fue SIN resolve_only (la que pinta): el modo cambia la conducta, no solo la etiqueta",
    postsImagen.some((b) => b && b.resolve_only !== true),
    JSON.stringify(postsImagen.map((b) => ({ resolve_only: b?.resolve_only, cells: b?.cells?.length }))),
  );
  await ctx.shot("imagen-ia-con-celdas");
}
