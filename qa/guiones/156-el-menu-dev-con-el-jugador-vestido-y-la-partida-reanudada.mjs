/** EL MENÚ DEV EN LOS ESTADOS QUE EL 155 NO MIRA (#492, escrito por QA de la tanda AD).
 *
 *  El 155 compara la lista del menú dev con el algoritmo que tenía `main.ts`
 *  antes de la tanda en TRES estados: maqueta, imagen y un skin caído. Su A/B
 *  contra `a25d8c2f` es la prueba de «lista idéntica»… en esos tres. Este guion
 *  mira los que se quedaron fuera, y el primero es el que la propia
 *  implementación declaró sin candado:
 *
 *  1. **El JUGADOR vestido desde el título.** El thunk de la raíz pasa DOS
 *     fuentes de prompts vivos a `CharacterSpriteManager.pendientes()`:
 *     `aspecto.skinPrompt()` (el jugador) y `mundo.personajes` (npcs y
 *     enemigos). El 155 solo tiene sujeto para la segunda, porque en su
 *     escenario el jugador llega sin prompt — y la implementación lo dijo por
 *     escrito: «no hay aserto que se ponga rojo si la raíz deja de pasar
 *     `aspecto.skinPrompt()`». Aquí el jugador escribe su skin en `#ts-skin`,
 *     el campo del editor de personaje del título, que es el camino normal.
 *     Con el thunk sin el jugador, la fila «Skin: <su prompt> (base y_bot)» no
 *     está y este guion se pone rojo.
 *  2. **Generar DESDE el menú con el modo global en MAQUETA.** El 155 genera
 *     desde el menú en imagen (revivir un caído). La vía de gasto controlado
 *     que justifica que el menú exista es la otra: partida en vector y el
 *     jugador pide UNA superficie y UN skin. Se mira que la petición SALE
 *     (`/generate_surface_atlas` SIN `resolve_only`, `/skin_sprite_sheet` con
 *     el prompt del jugador), que la fila dice «Generando…» mientras tanto y
 *     que se va cuando el arte llega.
 *  3. **Partida REANUDADA desde el save**, en maqueta y en imagen. `resume`
 *     vacía el mundo y lo vuelve a instalar (`tileStore.clear` +
 *     `fpsRenderer.clearTiles` y los tiles del save otra vez): es el estado en
 *     el que `surfaces` y `entries` podrían dejar de ir en el mismo orden, y
 *     la lista nueva itera `surfaces` donde la vieja iteraba `entries`.
 *  4. **Todo el arte puesto** (imagen, skins llegados, tile texturado): el
 *     menú tiene que decir «Sin imágenes fake» y el modelo tiene que estar
 *     vacío EN EL MISMO TICK — y para que dos vacíos no se comparen entre sí,
 *     se exige que el libro tenga a los personajes con su `idle` listo.
 *
 *  EL MODELO DE REFERENCIA es una segunda escritura del algoritmo de
 *  `a25d8c2f:nefan-html/src/main.ts:798-840` (independiente de la del 152,
 *  mismo contrato): orden del `TileStore` (`__nefan.tiles`), texturado del GL
 *  (`fps()`), prompts vivos de `aspecto` + `npcs()` + `enemies()`, estado por
 *  `skins`. Modelo y DOM se leen en el MISMO `evaluate`, por el mismo motivo
 *  que en el 155 (el menú se re-pinta cada segundo).
 *
 *  ABRIR EL MENÚ es pulsar `#ds-menu-btn`: no existe tecla (el docblock de
 *  `ui/dev-menu.ts` lo dice: «todo por ratón»), así que no hay otra puerta
 *  que medir.
 *
 *  LO QUE NO CUBRE: el orden entre VARIOS tiles (el motor falso sirve uno);
 *  `CONFIG.graphics.ai_skin=false`; la miniatura (regla 2); y un skin con
 *  `idle` listo pero SIN entrada en el libro (el rearme borra la entrada y
 *  conserva el arte; `__nefan.skins` no lo publica).
 *
 *  CERO CRÉDITOS: motor falso.
 */

import { nuevaPartida, reanudar } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco } from "../lib/saves.mjs";

export const aisla = ["saves", "fake-ai"];

/** Distintivo: ningún NPC del motor falso lo lleva, y cabe en 70 (sin «…»). */
const PROMPT_DEL_JUGADOR = "escudera de jubón verde con una trenza (QA-153)";
const ATLAS_DE = (key) => `Atlas fps ${key} (clay — celdas ya en la librería salen gratis)`;

function instalarElModelo() {
  window.__qa156 = () => {
    const n = window.__nefan;
    const fps = n.fps();
    const texturados = new Set(fps.ready ? fps.textured : []);
    const conSuperficies = new Set(fps.surfaces);
    const atlas = n.tiles
      .filter((k) => conSuperficies.has(k) && !texturados.has(k))
      .map((k) => `Atlas fps ${k} (clay — celdas ya en la librería salen gratis)`);
    const libro = n.skins;
    const vivos = [
      n.aspecto.skinPrompt,
      ...n.npcs().map((x) => x.skinPrompt ?? ""),
      ...n.enemies().map((x) => x.skinPrompt ?? ""),
    ];
    const skins = [];
    for (const prompt of new Set(vivos)) {
      if (!prompt) continue;
      const s = libro.find((e) => e.prompt === prompt);
      if (s && s.ready.includes("idle")) continue;
      const estado = !s ? "base y_bot" : s.failed ? "falló" : "generándose";
      const corto = prompt.length > 70 ? `${prompt.slice(0, 70)}…` : prompt;
      skins.push(`Skin: ${corto} (${estado})`);
    }
    const esperado = [...atlas, ...skins];
    const filas = [...document.querySelectorAll("#dev-menu-items .dm-item")].map((r) => ({
      label: r.querySelector(".dm-label")?.textContent ?? "",
      boton: r.querySelector("button")?.textContent ?? "",
      deshabilitado: r.querySelector("button")?.disabled ?? false,
    }));
    const pintado = filas.map((f) => f.label);
    const vacioPintado = document.querySelector("#dev-menu-items .dm-empty")?.textContent ?? null;
    return {
      atlas,
      skins,
      esperado,
      pintado,
      filas,
      vacioPintado,
      jugador: n.aspecto.skinPrompt,
      libro: libro.map((e) => ({ prompt: e.prompt, ready: e.ready, failed: e.failed })),
      cuadran: JSON.stringify(pintado) === JSON.stringify(esperado),
    };
  };
}

const foto = (ctx) => ctx.page.evaluate(() => window.__qa156());

async function abrirElMenu(ctx) {
  const abierto = await ctx.page.evaluate(() => !(document.getElementById("dev-menu")?.hidden ?? true));
  if (!abierto) await ctx.page.click("#ds-menu-btn");
  await ctx.page.waitForSelector("#dev-menu-items", { state: "visible", timeout: 10_000 });
}

/** Como `comenzar` de `lib/sesion.mjs`, pero el jugador escribe su skin en el
 *  editor de personaje antes de pulsar «Comenzar». */
async function comenzarVestido(ctx, prompt, maxMs = 180_000) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  const hayCampo = await ctx.page.$("#ts-skin");
  if (!hayCampo) return ctx.sinMedir("el editor de personaje no ofrece `#ts-skin`: sin campo no hay jugador vestido");
  await ctx.page.fill("#ts-skin", prompt);
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
  await esperarPartidaEnDisco(ctx, arrancada.sessionId, maxMs);
  ctx.log(`partida ${arrancada.sessionId} en marcha · escena ${arrancada.scene}`);
  return arrancada;
}

async function cuadraLaLista(ctx, desc, ms = 30_000) {
  const { ocurrio } = await ctx.expectEspera(
    desc,
    true,
    () => (window.__qa156().cuadran ? true : null),
    { ms },
  );
  const f = await foto(ctx);
  ctx.log(`   pintado: ${JSON.stringify(f.pintado)}${f.vacioPintado ? ` · vacío: «${f.vacioPintado}»` : ""}`);
  ctx.log(`   modelo:  ${JSON.stringify(f.esperado)}`);
  return { ocurrio, f };
}

/** Armar y confirmar la fila que empieza por `etiqueta`; devuelve el texto del
 *  botón LEÍDO nada más confirmar (lo que ve el jugador durante el vuelo). */
async function generarLaFila(ctx, etiqueta) {
  const fila = ctx.page.locator("#dev-menu-items .dm-item", { hasText: etiqueta });
  const boton = fila.locator("button");
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  await boton.click();
  const armado = await boton.textContent();
  await boton.click();
  const enVuelo = await ctx.page.evaluate(
    (et) =>
      [...document.querySelectorAll("#dev-menu-items .dm-item")]
        .find((r) => (r.querySelector(".dm-label")?.textContent ?? "").startsWith(et))
        ?.querySelector("button")?.textContent ?? null,
    etiqueta,
  );
  return { armado, enVuelo };
}

export default async function (ctx) {
  await ctx.page.addInitScript(instalarElModelo);
  await ctx.page.evaluate(instalarElModelo);

  // Censo de lo que SALE hacia el motor falso, desde el borde del navegador.
  const red = { atlasPintando: 0, atlasResolveOnly: 0, skinsDelJugador: 0, skins: 0 };
  await ctx.page.route("**/generate_surface_atlas", async (route) => {
    let cuerpo = {};
    try {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      await route.continue();
      return;
    }
    if (cuerpo.resolve_only) red.atlasResolveOnly++;
    else red.atlasPintando++;
    await route.continue();
  });
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let cuerpo = {};
    try {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      await route.continue();
      return;
    }
    red.skins++;
    if (String(cuerpo.prompt ?? "") === PROMPT_DEL_JUGADOR) red.skinsDelJugador++;
    await route.continue();
  });

  // ══ 1 · MAQUETA con el jugador VESTIDO desde el título ═══════════════════
  await nuevaPartida(ctx, { renderMode: "vector", charMode: "vector" });
  const partidaA = await comenzarVestido(ctx, PROMPT_DEL_JUGADOR);
  await abrirElMenu(ctx);

  const { ocurrio: hayLista } = await ctx.expectEspera(
    "en maqueta el menú dev pinta filas",
    true,
    () => (document.querySelectorAll("#dev-menu-items .dm-item").length > 0 ? true : null),
    { ms: 20_000 },
  );
  if (!hayLista) return ctx.sinMedir("el menú dev no pinta ni una fila en maqueta");

  const { f: maqueta } = await cuadraLaLista(
    ctx,
    "MAQUETA con el jugador vestido: la lista del menú es la del algoritmo de antes, item a item",
  );
  await ctx.shot("156-maqueta-con-el-jugador-vestido");
  ctx.expect(
    "el jugador lleva su prompt puesto (`__nefan.aspecto.skinPrompt`): el escenario existe",
    maqueta.jugador === PROMPT_DEL_JUGADOR,
    JSON.stringify(maqueta.jugador),
  );
  const filaJugador = `Skin: ${PROMPT_DEL_JUGADOR} (base y_bot)`;
  ctx.expect(
    "…y SU fila está en el menú: la raíz sigue pasando `aspecto.skinPrompt()` al gestor (D-2 de la " +
      "implementación, que no tenía candado)",
    maqueta.pintado.includes(filaJugador),
    JSON.stringify(maqueta.pintado),
  );
  if (maqueta.atlas.length === 0 || maqueta.skins.length < 3) {
    ctx.sinMedirBloque(
      `hacen falta un atlas y TRES skins (jugador + dos personajes) y salieron atlas=${maqueta.atlas.length} ` +
        `skins=${maqueta.skins.length}: sin eso no se distingue «los cuenta a todos» de «cuenta algunos»`,
    );
  }

  // ── 1b · Generar UNA superficie desde el menú, con el modo global en maqueta ─
  const tile = maqueta.atlas[0]?.match(/^Atlas fps (\S+) /)?.[1] ?? null;
  if (!tile) {
    ctx.sinMedirBloque("no hay fila de atlas en maqueta que generar (la librería ya traía el tile)");
  } else {
    const antes = { ...red };
    const { armado, enVuelo } = await generarLaFila(ctx, ATLAS_DE(tile));
    ctx.expect(
      "el primer click ARMA la fila del atlas (pide confirmar el gasto)",
      armado === "¿Confirmar? Gastará créditos",
      JSON.stringify(armado),
    );
    // Si el motor falso ya contestó, la fila se fue antes de poder leerla: no es
    // un rojo, es que no se pudo mirar el vuelo.
    if (enVuelo === null) ctx.sinMedirBloque("la corrida del atlas terminó antes de leer el botón en vuelo");
    else ctx.expect("…y mientras vuela, la fila dice «Generando…»", enVuelo === "Generando…", JSON.stringify(enVuelo));
    await ctx.expectEspera(
      "generar desde el menú EN MAQUETA textura el tile y su fila se va (la vía de gasto controlado)",
      true,
      (k) => {
        const fps = window.__nefan.fps();
        if (!fps.ready || !fps.textured.includes(k)) return null;
        return window.__qa156().pintado.some((l) => l.startsWith(`Atlas fps ${k} `)) ? null : { textured: fps.textured };
      },
      { ms: 90_000, arg: tile },
    );
    ctx.expect(
      "…y la petición salió PINTANDO (sin `resolve_only`), que es lo que distingue el botón del menú de la " +
        "restauración automática de maqueta",
      red.atlasPintando > antes.atlasPintando,
      `pintando antes ${antes.atlasPintando} → ${red.atlasPintando} · resolve_only ${red.atlasResolveOnly}`,
    );
  }

  // ── 1c · Generar UN skin (el del jugador) desde el menú, en maqueta ───────
  {
    const antes = { ...red };
    const { armado, enVuelo } = await generarLaFila(ctx, `Skin: ${PROMPT_DEL_JUGADOR}`);
    ctx.expect(
      "el primer click ARMA la fila del skin del jugador",
      armado === "¿Confirmar? Gastará créditos",
      JSON.stringify(armado),
    );
    if (enVuelo === null) ctx.sinMedirBloque("el skin del jugador llegó antes de leer el botón en vuelo");
    else ctx.expect("…y mientras vuela, su fila dice «Generando…»", enVuelo === "Generando…", JSON.stringify(enVuelo));
    await ctx.expectEspera(
      "el skin del jugador pedido desde el menú EN MAQUETA llega (idle listo) y su fila se va",
      true,
      (prompt) => {
        const s = window.__nefan.skins.find((e) => e.prompt === prompt);
        if (!s || !s.ready.includes("idle")) return null;
        return window.__qa156().pintado.some((l) => l.startsWith(`Skin: ${prompt}`)) ? null : { ready: s.ready };
      },
      { ms: 90_000, arg: PROMPT_DEL_JUGADOR },
    );
    ctx.expect(
      "…y la petición SALIÓ con el prompt del jugador (el `force` del item salta el gate de maqueta)",
      red.skinsDelJugador > antes.skinsDelJugador,
      `skins del jugador antes ${antes.skinsDelJugador} → ${red.skinsDelJugador} · skins totales ${red.skins}`,
    );
    await cuadraLaLista(ctx, "tras generar desde el menú, la lista sigue siendo la del algoritmo de antes");
    await ctx.shot("156-maqueta-tras-generar-desde-el-menu");
  }

  // ══ 2 · REANUDAR la partida de maqueta ════════════════════════════════════
  const vueltaA = await reanudar(ctx, partidaA.sessionId);
  if (!vueltaA) return ctx.sinMedir("no se pudo reanudar la partida de maqueta");
  await ctx.page.evaluate(instalarElModelo);
  await abrirElMenu(ctx);
  const { f: reanudadaA } = await cuadraLaLista(
    ctx,
    "REANUDADA en maqueta: la lista del menú es la del algoritmo de antes, item a item",
  );
  ctx.expect(
    "…y no está vacía ni en el modelo ni en pantalla (si no, dos vacíos se estarían comparando entre sí)",
    reanudadaA.esperado.length > 0 && reanudadaA.pintado.length > 0,
    JSON.stringify(reanudadaA.pintado),
  );
  await ctx.shot("156-reanudada-en-maqueta");

  // ══ 3 · IMAGEN: todo el arte llega, el menú se queda vacío; y reanudar ════
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await nuevaPartida(ctx, { renderMode: "image", charMode: "image" });
  const partidaB = await comenzarVestido(ctx, PROMPT_DEL_JUGADOR);
  await abrirElMenu(ctx);
  const { ocurrio: vacio } = await ctx.expectEspera(
    "con Imagen IA todo el arte llega: el menú dice «Sin imágenes fake» y el modelo está vacío en el MISMO tick",
    true,
    () => {
      const f = window.__qa156();
      const listos = f.libro.filter((e) => e.ready.includes("idle")).length;
      if (listos < 3) return null; // jugador + dos personajes: sin ellos, vacío contra vacío
      return f.esperado.length === 0 && f.pintado.length === 0 && f.vacioPintado ? { listos, texto: f.vacioPintado } : null;
    },
    { ms: 120_000 },
  );
  const imagen = await foto(ctx);
  ctx.log(`   imagen · libro: ${JSON.stringify(imagen.libro.map((e) => [e.prompt.slice(0, 24), e.ready.length, e.failed]))}`);
  if (vacio) {
    ctx.expect(
      "…y el texto del vacío es el de siempre",
      imagen.vacioPintado === "Sin imágenes fake: todo lo visible está generado.",
      JSON.stringify(imagen.vacioPintado),
    );
  }
  await ctx.shot("156-imagen-todo-generado");

  const vueltaB = await reanudar(ctx, partidaB.sessionId);
  if (!vueltaB) return ctx.sinMedir("no se pudo reanudar la partida de imagen");
  await ctx.page.evaluate(instalarElModelo);
  await abrirElMenu(ctx);
  await cuadraLaLista(ctx, "REANUDADA en imagen: la lista del menú es la del algoritmo de antes, item a item");
  await ctx.expectEspera(
    "…y vuelve a quedarse vacía cuando el arte se restaura (atlas de la librería, skins re-pedidos)",
    true,
    () => {
      const f = window.__qa156();
      const listos = f.libro.filter((e) => e.ready.includes("idle")).length;
      return listos >= 3 && f.esperado.length === 0 && f.pintado.length === 0 && f.vacioPintado ? { listos } : null;
    },
    { ms: 120_000 },
  );
  ctx.log(`   red: ${JSON.stringify(red)}`);
  await ctx.shot("156-reanudada-en-imagen");
}
