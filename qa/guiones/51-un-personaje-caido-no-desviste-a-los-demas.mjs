/** «Un solo HTTP 500 apaga los skins de la sesión entera» (#236), medido por
 *  donde el jugador lo nota: cuántos vecinos se quedan en maniquí.
 *
 *  El cortacircuitos de `character-sprites.ts` se disparaba al PRIMER 5xx y
 *  apagaba la generación de skins para toda la sesión. Con un backend que se
 *  atraganta con UN personaje, el jugador recuperaba el mundo de gente
 *  idéntica que #173 vino a arreglar, y no salía de ahí sin recargar. El radio
 *  era el defecto; el fusible, no: sigue existiendo con umbral
 *  (`UMBRAL_APAGADO_DE_SESION`), porque contra un servicio que cobra antes de
 *  fallar cada reintento es dinero.
 *
 *  POR QUÉ ESTE GUION Y NO UN TEST. `nefan-html` no tiene suite ni entra en
 *  mutación (`package.json`, `ci.yml`): para el cliente, «queda candado» es el
 *  tipo o un guion de `qa/`. Y esto no es de tipo — es una decisión de radio
 *  que solo se ve con varios personajes vivos en una partida de verdad.
 *
 *  EL FALLO SE INYECTA EN EL BORDE, no dentro del cliente: se intercepta
 *  `/skin_sprite_sheet` y se devuelve 500 SOLO para la descripción del primer
 *  personaje que pida skin. Las demás pasan al motor falso tal cual. Es
 *  exactamente el enunciado del criterio de cierre del issue: «con el backend
 *  devolviendo 500 para UN personaje, el resto siguen pidiendo y recibiendo su
 *  skin».
 *
 *  Cero créditos: el motor falso sirve las hojas y no cobra; las peticiones
 *  saboteadas ni le llegan.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): con el cortacircuitos de sesión de antes
 *  (`skinsDisabled = true` al primer 5xx), el bloque 2 se pone rojo — ningún
 *  personaje distinto del saboteado llega a tener una anim lista.
 */
import { nuevaPartida, comenzar, esperarRegistro } from "../lib/sesion.mjs";

/** El umbral que declara `character-sprites.ts`. Aquí solo se usa para SABER
 *  si este escenario puede medir la rama de «por debajo del umbral»: el rango
 *  entero lo recorre el guion 53. */
const UMBRAL = 3;

/** Lo que el cliente escribe en el registro por CADA skin que se le cae. */
const CANCELADA = /skin IA cancelada/g;
/** …y lo que escribe UNA sola vez, si se alcanza el umbral de la sesión. */
const APAGADO_DE_SESION = /skins IA desactivados para la sesión/g;

export default async function (ctx) {
  // El primer personaje que pida skin es el saboteado; los demás pasan.
  let victima = null;
  const respuestas = { caidas: 0, servidas: 0, saboteando: true };
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let prompt = "";
    try {
      prompt = String(JSON.parse(route.request().postData() ?? "{}").prompt ?? "");
    } catch (err) {
      // Un cuerpo que no es JSON no es «un personaje más»: es que la petición
      // cambió de forma y este guion ya no está midiendo lo que dice.
      ctx.log(`cuerpo de /skin_sprite_sheet ilegible: ${String(err).slice(0, 80)}`);
    }
    victima ??= prompt;
    if (respuestas.saboteando && prompt === victima) {
      respuestas.caidas++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "fallo del proveedor para ESTE personaje (simulado por QA)" }),
      });
      return;
    }
    respuestas.servidas++;
    await route.continue();
  });

  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "image" });
  await comenzar(ctx);

  await ctx.waitFor(
    "la partida tiene gente a la que vestir",
    () => (window.__nefan.status().npcs > 0 ? window.__nefan.npcs() : null),
    60_000,
  );

  // ── 1 · El personaje saboteado se cae, y el juego lo DICE ────────────────
  const libro = await esperarRegistro(
    ctx,
    "el personaje saboteado falla y el juego lo anota en su libro de skins",
    "skins",
    () => {
      const l = window.__nefan.skins;
      return l.length >= 2 && l.some((s) => s.failed) ? l : null;
    },
    90_000,
  );
  ctx.log(`libro de skins: ${JSON.stringify(libro)}`);
  ctx.log(`saboteado: "${String(victima).slice(0, 50)}" · 500 servidos: ${respuestas.caidas}`);

  const caido = libro.find((s) => s.prompt === victima);
  ctx.expect(
    "el personaje al que el backend le dice 500 se queda sin skin y el juego lo sabe",
    Boolean(caido?.failed) && (caido?.ready.length ?? 0) === 0,
    JSON.stringify(caido),
  );

  // ── 2 · …y los DEMÁS siguen pidiendo Y RECIBIENDO ───────────────────────
  // Es el criterio de cierre de #236, literal. Rojo con el cortacircuitos de
  // sesión: allí el primer 5xx cortaba la cola y ningún otro personaje llegaba
  // siquiera a pedir su hoja.
  const otros = await esperarRegistro(
    ctx,
    "otro personaje distinto del saboteado consigue su skin pese al 500 del primero",
    "skins",
    (v) => {
      const l = window.__nefan.skins.filter((s) => s.prompt !== v);
      return l.some((s) => s.ready.length > 0) ? l : null;
    },
    90_000,
    victima,
  );
  const vestidos = otros.filter((s) => s.ready.length > 0);
  ctx.expect(
    "al menos un personaje distinto del saboteado tiene una anim LISTA (pidió y recibió)",
    vestidos.length > 0,
    JSON.stringify(otros),
  );
  ctx.expect(
    "…y el backend le sirvió esas hojas de verdad: no es un verde de contabilidad interna",
    respuestas.servidas > 0,
    `hojas servidas por el motor falso: ${respuestas.servidas}`,
  );

  await ctx.shot("un-caido-los-demas-vestidos");

  // ── 3 · Ni un fallo mudo, ni un apagón sin umbral ────────────────────────
  const registro = await ctx.page.evaluate(
    () => document.getElementById("error-log")?.textContent ?? "",
  );
  const fallidos = (await ctx.nefan("skins")).filter((s) => s.failed);
  const canceladas = (registro.match(CANCELADA) ?? []).length;
  const apagados = (registro.match(APAGADO_DE_SESION) ?? []).length;
  ctx.log(
    `personajes fallidos: ${fallidos.length} · líneas «cancelada»: ${canceladas} · ` +
      `líneas «desactivados para la sesión»: ${apagados}`,
  );
  ctx.expect(
    "cada personaje que se cae deja UNA entrada en el registro: ni cero (mudo) ni una tormenta",
    canceladas === fallidos.length,
    `${canceladas} entradas para ${fallidos.length} personajes fallidos`,
  );
  // El apagón de sesión no desaparece: se acota. Este escenario solo puede
  // ejercer la mitad de ABAJO del umbral —el tile de entrada del motor falso
  // trae dos personajes— y eso se dice en vez de disfrazarse de condicional:
  // un `if (fallidos >= UMBRAL)` aquí viaja sobre algo que no pasa nunca, y un
  // aserto que no puede ejecutarse se ve igual que uno que funciona. El rango
  // entero (1, 2 y 3 caídos) lo mide el guion 53 sobre `robledo_tile`.
  if (fallidos.length >= UMBRAL) {
    ctx.sinMedirBloque(
      `este tile tumbó ${fallidos.length} personajes y el umbral es ${UMBRAL}: el escenario ` +
        "dejó de poder medir «por debajo del umbral». El rango vive en el guion 53",
    );
  } else {
    ctx.expect(
      `por debajo del umbral (${fallidos.length} < ${UMBRAL}), la sesión NO se apaga ` +
        "(era el bug: se apagaba al primero)",
      apagados === 0,
      `fallidos=${fallidos.length} apagados=${apagados} · ${registro.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }

  // ── 4 · Rearmar de verdad: el que falló vuelve a pedir Y RECIBE ─────────
  // «Rearmar el cortacircuitos» devolvía a la sesión la CAPACIDAD de pedir
  // skins pero no borraba el recuerdo de los personajes que ya habían fallado,
  // y `requestSkin` sale antes para un personaje con estado y sin `force`. Con
  // el manager como singleton de MÓDULO, el vecino caído se quedaba en maniquí
  // toda la vida de la pestaña: ni volver al título ni reanudar lo recuperaban,
  // que es justo el gesto que esta tanda cableó como rearme.
  //
  // El gesto es del jugador y no del guion: el chip de gráficos, Personajes
  // OFF y otra vez ON — el mismo camino (`applyRenderModes`) que dispara el
  // rearme al entrar o reanudar una partida.
  //
  // SE MIDE EL DELTA, no el estado final, y no es un rodeo: en el banco toda
  // hoja que no sea `idle` da 500, así que el personaje recuperado vuelve a
  // quedar `failed` en cuanto pide `walk`. Lo que prueba el rearme es que
  // AHORA TIENE ARTE que antes no tenía; exigir `failed:false` sería exigir
  // que el motor falso tuviera hojas que no tiene.
  const antes = (await ctx.nefan("skins")).find((s) => s.prompt === victima);
  ctx.expect(
    "precondición: el saboteado llega a este bloque sin una sola anim lista",
    antes?.failed === true && antes.ready.length === 0,
    JSON.stringify(antes),
  );

  respuestas.saboteando = false;
  await ctx.page.click("#gfx-chip");
  const seg = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /personaje/i })
    .locator(".gfx-seg button");
  await seg.first().waitFor({ state: "visible", timeout: 10_000 });
  await seg.nth(1).click(); // «maqueta»: apaga (sin confirmación, no gasta)
  await seg.first().click(); // arma el encendido («gastará créditos»)
  await seg.first().click(); // confirma

  const recuperado = await ctx.waitFor(
    "el personaje que había fallado vuelve a pedir su skin tras el rearme, Y LA RECIBE",
    (v) => {
      const s = window.__nefan.skins.find((x) => x.prompt === v);
      return s && s.ready.length > 0 ? s : null;
    },
    90_000,
    victima,
  );
  await ctx.shot("tras-rearmar-el-caido-vuelve");
  ctx.log(`recuperado: ${JSON.stringify(recuperado)}`);
  ctx.expect(
    "rearmar OLVIDA al que falló, así que su siguiente petición empieza limpia y se sirve",
    recuperado.ready.length > antes.ready.length,
    `antes ready=${JSON.stringify(antes.ready)} · ahora ready=${JSON.stringify(recuperado.ready)}`,
  );
}
