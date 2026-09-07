/** UN MODO DE PERSONAJES VACÍO SIGUE AL DE ESCENARIOS — visto por quien juega,
 *  y con el bridge diciendo lo mismo que el chip.
 *
 *  Escrito por QA de la PR 1 de #241 (#508, 2026-09-07), que sacó esa regla y
 *  los dos gates de gasto que cuelgan de ella del cliente y del bridge a
 *  `nefan-core/src/session/gates-de-imagen.ts`. La regla vivía en CUATRO sitios
 *  que la compartían por lectura (`ui/modos-de-graficos.ts`, el badge del save
 *  en `ui/title-screen.ts`, `bridge/handlers/session.ts` y
 *  `narrative/render-mode.ts`), tres de ellos sin una sola medida. Movida a un
 *  módulo puro, lo que ningún test de core puede ver es si los cuatro
 *  consumidores siguen leyéndola igual EN EL JUEGO: eso es esto.
 *
 *  QUÉ SE MIDE, y por qué hace falta una partida real. El save de una partida
 *  nueva SIEMPRE trae `character_mode` materializado (el bridge lo escribe al
 *  crearla), así que el único estado donde la regla decide es un save SIN el
 *  campo —los previos a que existiera— y ese estado hay que fabricarlo: se
 *  juega una partida de verdad y se le vacía `world.character_mode` en el disco
 *  efímero de la corrida (`aisla: ["saves"]`; el fichero se restaura al salir,
 *  también con Ctrl+C). A partir de ahí, el mismo save con las dos caras:
 *
 *   1 · ESCENARIOS EN IMAGEN. El título pinta el badge de personajes «🎨 Skins
 *       IA» aunque el save no tenga el campo (la regla ANTES de cargar); al
 *       reanudar, el cliente recibe `characterMode: ""` y aun así el chip dice
 *       «personajes: Skins IA», el registro dice «Gráficos: imagen IA (skins
 *       IA)» y SALEN skins por el cable — el gasto sigue a escenarios.
 *   2 · EL BRIDGE DICE LO MISMO. Sobre ese mismo `""`, un `set_render_mode`
 *       (characters → image) se RECHAZA con «la partida ya tiene los personajes
 *       en modo image»: el bridge resuelve el vacío igual que el chip. El
 *       cambio a `vector` sí se acepta, su `render_mode_changed` casa con lo
 *       que el chip pinta, y el save MATERIALIZA "vector" (antes de eso el
 *       resume lo deja vacío: reanudar no materializa nada).
 *   3 · ESCENARIOS EN MAQUETA. Con el campo otra vez vacío y los escenarios en
 *       maqueta, el badge del título dice «🧱 Personajes base», el chip también,
 *       y NO sale ni un `/skin_sprite_sheet`: cero créditos por herencia.
 *
 *  PROBADO EN NEGATIVO (2026-09-07), un sabotaje por vez en `gates-de-imagen.ts:37`
 *  (`modoEfectivoDePersonajes`) y restaurado byte a byte cada vez:
 *   · `f.renderMode || f.characterMode` (la regla GIRADA) → rojo en el bloque 2:
 *     tras aceptar el bridge personajes→vector, el chip se queda en «Skins IA».
 *     Los bloques 1 y 3 NO lo ven, y es correcto que no lo vean: con una de las
 *     dos facetas vacía, `a || b` y `b || a` dan lo mismo — girar el `||` no es
 *     un mutante de la herencia, es uno de la precedencia. Por eso hay un
 *     bloque 2: sin él, este guion pasaría por encima de ese mutante.
 *   · `return f.characterMode` (la regla BORRADA) → rojo en el bloque 1, cuatro
 *     veces: el título no pinta badge de personajes (`null`), el chip dice
 *     «Personajes base», la línea del registro dice «personajes en base y_bot»
 *     y `__nefan.skins` se queda vacío — nadie pide un skin.
 *   · `f.characterMode || "image"` (el vacío SIEMPRE gasta) → rojo en el bloque
 *     3: con todo en maqueta, el título ofrece «🎨 Skins IA» y el chip nunca
 *     llega a «Personajes base». Es el fallo que cuesta dinero, y sale rojo.
 *
 *  GOTCHA que costó un rojo en la batería y ninguno en las cuatro corridas
 *  sueltas: el registro del juego conserva OCHO líneas (`main.ts:495`), y
 *  «Gráficos: …» se imprime al aplicar las facetas del resume — con el tile y
 *  el atlas llegando detrás, se cae de la caja antes de que nadie la lea. La
 *  línea NO se lee del DOM: un observador puesto ANTES del resume (el hueco
 *  `alRecargar` de `reanudar`, como el observer del 60) RECUERDA todas.
 *
 *  Cero créditos: preset `e2e-sin-creditos` del runner; los skins los sirve (y
 *  los rechaza) el motor falso.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { comenzar, esperarRegistro, nuevaPartida, reanudar, recargarAlTitulo } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, rutaDelSave } from "../lib/saves.mjs";

export const aisla = ["saves"];

/** El badge de una faceta en la tarjeta del save, tal y como lo ve el jugador
 *  ANTES de cargar. `null` = no hay badge (que es lo que pasaba con los saves
 *  sin el campo antes de que la regla existiera). */
const badgeDelSave = (ctx, sessionId, facet) =>
  ctx.page.evaluate(
    ([sid, f]) => {
      const b = document.querySelector(`button[data-mode-facet="${f}"][data-session-id="${sid}"]`);
      return b ? { text: (b.textContent ?? "").trim(), title: b.title } : null;
    },
    [sessionId, facet],
  );

/** Instala un espía sobre el registro del juego (`#combat-log`) que RECUERDA
 *  todas las líneas que pasan por él.
 *
 *  Hace falta porque el registro conserva solo OCHO (`main.ts:495`): la línea
 *  «Gráficos: …» se imprime al aplicar las facetas del resume y las del tile
 *  que llega después la echan fuera. Leerla del DOM salía verde en una corrida
 *  suelta y ROJO dentro de la batería, que es la peor forma de fallar. Va como
 *  `alRecargar` de `reanudar` (el hueco que el guion 60 usa para su observer):
 *  el observador tiene que estar puesto ANTES de que el juego escriba nada. */
const espiarElRegistro = (ctx) =>
  ctx.page.evaluate(() => {
    window.__qa87 = [];
    const caja = document.getElementById("combat-log");
    if (!caja) throw new Error("no hay #combat-log donde espiar el registro del juego");
    for (const n of caja.children) window.__qa87.push(n.textContent ?? "");
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qa87.push(n.textContent ?? "");
    }).observe(caja, { childList: true });
  });

/** La primera línea recordada que case, o `null`. */
const lineaDelRegistro = (ctx, re) =>
  ctx.page.evaluate((fuente) => window.__qa87.find((l) => new RegExp(fuente).test(l)) ?? null, re.source);

/** Escribe los dos modos en el save de disco y devuelve lo que quedó escrito. */
function ponerModos(ruta, render_mode, character_mode) {
  const d = JSON.parse(readFileSync(ruta, "utf8"));
  d.world.render_mode = render_mode;
  d.world.character_mode = character_mode;
  writeFileSync(ruta, JSON.stringify(d));
  return { render_mode, character_mode };
}

/** Los dos modos que hay AHORA en el save de disco. */
const modosDelSave = (ruta) => {
  const w = JSON.parse(readFileSync(ruta, "utf8")).world;
  return { render_mode: w.render_mode, character_mode: w.character_mode };
};

/** Pide un cambio de modo al bridge como OTRO cliente de la partida (mismo
 *  molde que el guion 85): un socket propio contra el gateway que la página
 *  está usando. Devuelve el `render_mode_set` con que contesta el bridge. */
async function pedirAlBridge(ctx, sessionId, facet, renderMode) {
  return ctx.page.evaluate(
    ([sid, f, m]) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        let contestado = false;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url} como segundo cliente`));
        ws.onclose = () => {
          if (!contestado) rej(new Error(`${url} se cerró sin contestar al set_render_mode`));
        };
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "set_render_mode", requestId: "qa-87", sessionId: sid, facet: f, renderMode: m }));
        ws.onmessage = (ev) => {
          const m2 = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m2.type !== "render_mode_set" || m2.requestId !== "qa-87") return;
          contestado = true;
          ws.close();
          res(m2);
        };
      }),
    [sessionId, facet, renderMode],
  );
}

export default async function (ctx) {
  /** Cada POST de skin que sale hacia el motor falso. El listener sobrevive a
   *  los reloads de `reanudar`, así que cuenta lo de toda la corrida: se vacía
   *  a mano al empezar cada bloque. */
  const posts = [];
  ctx.page.on("request", (req) => {
    if (req.method() === "POST" && /\/skin_sprite_sheet(\?|$)/.test(req.url())) posts.push(req.url());
  });

  // ── 0 · Una partida real, por el camino del jugador ──────────────────────
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const { sessionId } = await comenzar(ctx);
  await esperarPartidaEnDisco(ctx, sessionId);
  const ruta = rutaDelSave(sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "sin disco efímero (stack adoptado con --url/--adoptar): no se puede fabricar el save sin " +
        "`character_mode`, que es el único estado donde la regla decide",
    );
    return;
  }
  const original = readFileSync(ruta, "utf8");
  const restaurar = () => writeFileSync(ruta, original);
  for (const s of ["SIGINT", "SIGTERM"]) process.once(s, restaurar);
  try {
    await cuerpo(ctx, { ruta, sessionId, posts });
  } finally {
    restaurar();
    for (const s of ["SIGINT", "SIGTERM"]) process.removeListener(s, restaurar);
  }
}

async function cuerpo(ctx, { ruta, sessionId, posts }) {
  // ── 1 · Escenarios en IMAGEN, personajes sin campo ───────────────────────
  await recargarAlTitulo(ctx);
  ctx.log(`save fabricado: ${JSON.stringify(ponerModos(ruta, "image", ""))}`);
  await recargarAlTitulo(ctx); // el título relee la lista de saves del bridge

  const badge1 = await badgeDelSave(ctx, sessionId, "characters");
  ctx.expect(
    "el título pinta el badge de PERSONAJES del save sin campo, y dice «Skins IA»: sigue a escenarios",
    badge1 !== null && /Skins IA/.test(badge1.text),
    JSON.stringify(badge1),
  );

  posts.length = 0;
  await reanudar(ctx, sessionId, { alRecargar: () => espiarElRegistro(ctx) });
  const facetas1 = await ctx.nefan("sesion");
  ctx.log(`facetas al reanudar: ${JSON.stringify({ renderMode: facetas1.renderMode, characterMode: facetas1.characterMode })}`);
  ctx.expect(
    "el cliente recibe el modo de personajes VACÍO tal cual (la regla la resuelve él, no el wire)",
    facetas1.renderMode === "image" && facetas1.characterMode === "",
    JSON.stringify(facetas1),
  );
  const chip1 = await ctx.waitFor(
    "el chip aparece en partida",
    () => {
      const el = document.getElementById("gfx-chip");
      return el && !el.hidden ? { text: el.textContent, title: el.title } : null;
    },
    30_000,
  );
  ctx.log(`chip: ${JSON.stringify(chip1)}`);
  ctx.expect(
    "el chip dice «escenarios: Imagen IA · personajes: Skins IA» con el campo vacío en el save",
    /escenarios: Imagen IA/.test(chip1.title) && /personajes: Skins IA/.test(chip1.title),
    JSON.stringify(chip1),
  );
  const linea1 = await lineaDelRegistro(ctx, /Gráficos: imagen IA/);
  ctx.log(`registro: ${linea1}`);
  ctx.expect(
    "el registro del juego dijo «Gráficos: imagen IA (skins IA)»",
    linea1 !== null && /skins IA/.test(linea1),
    String(linea1),
  );
  await esperarRegistro(
    ctx,
    "la partida PIDE skins de los personajes que hereda el modo de escenarios",
    "skins",
    () => (window.__nefan.skins.length > 0 ? window.__nefan.skins : null),
    90_000,
  );
  ctx.log(`POST /skin_sprite_sheet tras reanudar: ${posts.length}`);
  ctx.expect("…y salen por el cable: al menos un POST a /skin_sprite_sheet", posts.length > 0, `${posts.length} POST`);
  await ctx.shot("escenarios-imagen-personajes-heredan");

  // ── 2 · El BRIDGE resuelve el vacío igual que el chip ────────────────────
  ctx.expect(
    "reanudar NO materializa el campo: el save sigue vacío",
    modosDelSave(ruta).character_mode === "",
    JSON.stringify(modosDelSave(ruta)),
  );
  const rechazo = await pedirAlBridge(ctx, sessionId, "characters", "image");
  ctx.log(`bridge ← set_render_mode(characters, image): ${JSON.stringify(rechazo)}`);
  ctx.expect(
    "el bridge RECHAZA poner personajes en image: para él ya lo están (heredan de escenarios)",
    rechazo.ok === false && /ya tiene los personajes en modo image/.test(rechazo.error ?? ""),
    JSON.stringify(rechazo),
  );
  const aceptado = await pedirAlBridge(ctx, sessionId, "characters", "vector");
  ctx.expect(
    "…y ACEPTA bajarlos a vector, que sí es un cambio",
    aceptado.ok === true,
    JSON.stringify(aceptado),
  );
  const chip2 = await ctx.waitFor(
    "el chip pasa a «Personajes base» por el eco del bridge: cliente y bridge dicen lo mismo",
    () => {
      const el = document.getElementById("gfx-chip");
      return el && /personajes: Personajes base/.test(el.title) ? { text: el.textContent, title: el.title } : null;
    },
    20_000,
  );
  ctx.log(`chip tras el eco: ${JSON.stringify(chip2)}`);
  ctx.expect(
    "el bridge MATERIALIZA el campo al cambiarlo: el save deja de heredar",
    modosDelSave(ruta).character_mode === "vector",
    JSON.stringify(modosDelSave(ruta)),
  );

  // ── 3 · Escenarios en MAQUETA, personajes sin campo: cero gasto ──────────
  await recargarAlTitulo(ctx);
  ctx.log(`save fabricado: ${JSON.stringify(ponerModos(ruta, "vector", ""))}`);
  await recargarAlTitulo(ctx);

  const badge3 = await badgeDelSave(ctx, sessionId, "characters");
  ctx.expect(
    "el título dice ahora «Personajes base» en el mismo save vacío: la herencia cambió de signo",
    badge3 !== null && /Personajes base/.test(badge3.text),
    JSON.stringify(badge3),
  );

  posts.length = 0;
  await reanudar(ctx, sessionId, { alRecargar: () => espiarElRegistro(ctx) });
  const facetas3 = await ctx.nefan("sesion");
  ctx.expect(
    "precondición: el cliente vuelve a recibir el campo vacío, ahora con escenarios en maqueta",
    facetas3.renderMode === "vector" && facetas3.characterMode === "",
    JSON.stringify(facetas3),
  );
  const chip3 = await ctx.waitFor(
    "el chip dice «escenarios: Maqueta 3D · personajes: Personajes base»",
    () => {
      const el = document.getElementById("gfx-chip");
      return el && !el.hidden && /personajes: Personajes base/.test(el.title)
        ? { text: el.textContent, title: el.title }
        : null;
    },
    30_000,
  );
  ctx.log(`chip: ${JSON.stringify(chip3)}`);
  ctx.expect(
    "…y su rótulo entero es «Maqueta 3D», sin mezcla",
    /Maqueta 3D/.test(chip3.text ?? "") && /escenarios: Maqueta 3D/.test(chip3.title),
    JSON.stringify(chip3),
  );
  const linea3 = await lineaDelRegistro(ctx, /Gráficos: maqueta 3D/);
  ctx.log(`registro: ${linea3}`);
  ctx.expect(
    "el registro dijo «Gráficos: maqueta 3D (…; personajes en base y_bot)»",
    linea3 !== null && /personajes en base y_bot/.test(linea3),
    String(linea3),
  );
  // El «no ocurre» se AFIRMA con su umbral escrito una vez: el mundo del save
  // ya está pintado y sus NPCs materializados cuando el chip contesta, así que
  // si algún skin fuera a pedirse, se pediría en esta ventana.
  await ctx.expectEspera(
    "con los personajes heredando maqueta, la partida NO pide un solo skin",
    false,
    () => (window.__nefan.skins.length > 0 ? window.__nefan.skins : null),
    { ms: 8_000 },
  );
  ctx.log(`POST /skin_sprite_sheet con personajes heredando maqueta: ${posts.length}`);
  ctx.expect("…ni sale ni un POST a /skin_sprite_sheet", posts.length === 0, `${posts.length} POST`);
  await ctx.shot("escenarios-maqueta-personajes-heredan");
}
