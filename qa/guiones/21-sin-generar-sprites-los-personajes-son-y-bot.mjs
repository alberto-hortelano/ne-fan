/** «Sin generar sprites usa y_bot» (#199), medido donde el jugador lo nota.
 *
 *  Es la primera mitad literal de la petición que cerró la retirada del
 *  gpu-worker, y la que NINGÚN test podía sujetar: el fallback vive entre el
 *  cliente y un backend de skins que puede no estar (`character-sprites.ts`
 *  ↔ `main.ts`), y su síntoma no es una excepción sino gente que desaparece
 *  de la pantalla. El `13` afirma que las diez hojas base de `y_bot` están
 *  SERVIDAS y completas; esto afirma lo otro, que es lo que se rompe cuando
 *  alguien toca el pipeline de personajes: que cuando no hay quien genere,
 *  el juego LAS USA en vez de quedarse sin nadie.
 *
 *  El estado se produce como se produce de verdad —el backend de skins
 *  contesta 503, que es lo que da remote-gen sin sprite-forge detrás—, no
 *  eligiendo «Personajes base» en el título: ese camino es el fácil y no
 *  ejerce el fallback. Aquí la partida se abre en el modo POR DEFECTO
 *  («Skins IA»), que es el que tiene delante quien no toca nada, y se mide
 *  qué pasa cuando la generación no llega.
 *
 *  Lo que afirma, en el orden en que se rompería:
 *
 *  1. El juego LO INTENTA (hubo peticiones de skin). Sin esto el resto es un
 *     verde vacío: un cliente que no pide nada también «cae a y_bot».
 *  2. La partida SIGUE teniendo gente montada en el mundo 3D después del
 *     fallo — el fallback no es un log, es que el NPC se sigue viendo.
 *  3. Toda hoja de personaje que se ha ido a buscar es de `y_bot`, y ni una
 *     de un modelo vestido. Es la afirmación de la petición, contada por el
 *     cable en vez de por el código.
 *  4. El juego lo DICE en cristiano y nombra a y_bot: un jugador que ve
 *     maniquíes tiene que poder saber por qué, sin abrir la consola.
 *  5. Y la otra mitad de #199, que solo se puede medir en una sesión viva:
 *     NADIE llama a los cuatro endpoints del worker retirado ni a su puerto.
 *     El `grep` canda el repo; esto canda lo que de verdad sale por la red,
 *     que es donde se vería un `serviceUrl` resuelto en runtime.
 *
 *  Cero créditos: el `?ai=` apunta al motor falso y las peticiones de skin
 *  ni siquiera llegan a él — las corta este guion.
 */
import { nuevaPartida, comenzar, esperarRegistro } from "../lib/sesion.mjs";

/** Los cuatro endpoints del gpu-worker (#199) y el puerto en el que vivía, y
 *  desde T4 (#257) los blobs de los siete kinds del asset-store sin productor
 *  (`/cache/albedo/…`, `/cache/model/…`, `/cache/plate/…`…). Se escriben aquí
 *  porque lo que se canda es que NO aparezcan: si alguien los resucita, esta
 *  lista es la que tiene que ponerse roja. */
const RETIRADOS =
  /:8766(\D|$)|\/generate_texture\b|\/generate_model\b|\/generate_skin\b|\/generate_sprite\b|\/cache\/(albedo|normal|roughness|model|skin|sprite|scene|plate|segment)\//;

/** Hojas base servidas por Vite desde `public/sprites/{modelo}/…`. */
const HOJA_BASE = /\/sprites\/([^/]+)\//;

/** Frames de un personaje VESTIDO: no salen de `public/`, sino de las URLs
 *  que devuelve `/skin_sprite_sheet` (`/cache/sprite_sheet/{key}/dir_…` del
 *  asset-store; `remote_generation.py`, y el fake igual). Hasta T4 esta regex
 *  decía `/sprite_sheets/` —el DIRECTORIO en disco, que nunca viaja en una
 *  URL— y `/cache/skin`, un kind muerto: no podía casar nada, así que el
 *  «cero frames vestidos» de abajo era un verde que no comprobaba. */
const HOJA_VESTIDA = /\/cache\/sprite_sheet\//;

export default async function (ctx) {
  // Se escucha ANTES de navegar y se recarga: el runner ya había abierto la
  // página, y lo que se afirma abajo es que NO hubo cierta petición. Contar
  // desde la mitad haría que ese verde no significara nada.
  const peticiones = [];
  ctx.page.on("request", (r) => peticiones.push(r.url()));
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));

  // El backend de skins, CAÍDO. 503 es literalmente lo que contesta
  // remote-gen cuando sprite-forge no está detrás (`sprites-sin-servicio`),
  // así que este es el estado del sistema, no un atajo del guion.
  let skinsPedidos = 0;
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    skinsPedidos++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "sprite-forge no disponible (caída simulada por QA)" }),
    });
  });

  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "image" });
  await comenzar(ctx);

  const gente = await ctx.waitFor(
    "la partida tiene gente",
    () => {
      const s = window.__nefan.status();
      return s.npcs > 0 ? window.__nefan.npcs() : null;
    },
    60_000,
  );
  ctx.log(`NPCs: ${gente.map((n) => n.id).join(", ")}`);

  // 1. El juego INTENTA vestirlos: sin esto, nada de lo de abajo prueba nada.
  const libro = await esperarRegistro(
    ctx,
    "el juego pide skins y registra que se le caen",
    "skins",
    () => {
      const l = window.__nefan.skins;
      return l.length && l.some((s) => s.failed) ? l : null;
    },
    60_000,
  );
  ctx.log(`libro de skins: ${JSON.stringify(libro.map((s) => ({ rol: s.role, failed: s.failed })))}`);
  ctx.expect(
    "la partida PIDIÓ skins de verdad (si no pidiera nada, «cae a y_bot» sería un verde vacío)",
    skinsPedidos > 0,
    `peticiones a /skin_sprite_sheet: ${skinsPedidos}`,
  );
  ctx.expect(
    "…y el juego anotó el fallo en su libro de skins en vez de tragárselo",
    libro.some((s) => s.failed),
    JSON.stringify(libro),
  );

  // 2. Con el backend caído la gente SIGUE en pantalla.
  const mundo = await ctx.nefan("fps");
  ctx.expect(
    "cada NPC sigue teniendo su billboard de PERSONAJE montado pese al backend caído",
    mundo.billboardsPersonaje >= gente.length,
    `billboardsPersonaje=${mundo.billboardsPersonaje} npcs=${gente.length}`,
  );

  // 3. Y lo que se ha ido a buscar para dibujarlos es y_bot, nada más.
  const hojas = peticiones.filter((u) => HOJA_BASE.test(u));
  const modelos = [...new Set(hojas.map((u) => u.match(HOJA_BASE)[1]))];
  const vestidas = peticiones.filter((u) => HOJA_VESTIDA.test(u));
  ctx.log(`hojas de personaje pedidas: ${hojas.length} · modelos: ${JSON.stringify(modelos)}`);
  ctx.expect(
    "se han cargado hojas de personaje (si no hubiera ninguna, no habría nadie que dibujar)",
    hojas.length > 0,
    `${hojas.length} peticiones a /sprites/`,
  );
  ctx.expect(
    "y TODAS son de la base y_bot: sin generación, el juego dibuja con lo que tiene gratis",
    modelos.length > 0 && modelos.every((m) => m === "y_bot"),
    `modelos: ${JSON.stringify(modelos)}`,
  );
  ctx.expect(
    "ni un frame de personaje vestido llegó a cargarse (no hay quien los genere)",
    vestidas.length === 0,
    JSON.stringify(vestidas.slice(0, 3)),
  );

  // 4. Y el jugador puede enterarse sin abrir la consola.
  const registro = await ctx.page.evaluate(
    () => document.getElementById("error-log")?.textContent ?? "",
  );
  ctx.expect(
    "el juego DICE por qué los personajes van en maniquí, y nombra a y_bot",
    /y_bot/.test(registro),
    registro.replace(/\s+/g, " ").slice(0, 200),
  );

  await ctx.shot("gente-en-y-bot");

  // 5. La otra mitad de #199: nadie llama al worker retirado.
  const muertas = peticiones.filter((u) => RETIRADOS.test(u));
  ctx.log(`peticiones de la sesión: ${peticiones.length} · a endpoints retirados: ${muertas.length}`);
  ctx.expect(
    "ninguna petición de una partida entera va a un endpoint del gpu-worker retirado ni a un blob de un kind muerto del asset-store",
    muertas.length === 0,
    JSON.stringify(muertas.slice(0, 5)),
  );
}
