/** EL TILE INSTALADO QUE NO ES EL ACTIVO RECUPERA SU ARTE YA PAGADO (#714).
 *
 *  Al reanudar sobre un mundo pre-generado, el save trae el anillo 3×3 y el
 *  cliente reinstala los nueve tiles, pero hasta #714 el atlas de superficies
 *  solo lo pedía el ACTIVO (`FpsAtlasController.onActiveTile`): el tile que
 *  pisa el jugador se texturaba y los ocho vecinos se quedaban en clay para
 *  siempre, con su arte pagado en la librería. Lo mismo en partida viva con el
 *  vecino que llega por prefetch, hasta que el jugador cruzaba la frontera.
 *
 *  El arreglo es un carril de RESTAURACIÓN en `PoliticaDeAtlas` (core): todo
 *  tile instalado que no es el activo recupera lo ya pagado (memoria → mapping
 *  → librería con `resolve_only`) y NUNCA pinta, tampoco con Imagen IA
 *  encendida (`modoDeCorrida`). Este guion lo mira desde el renderer
 *  (`fps().textured`) y desde la red (el cuerpo de cada POST del atlas):
 *
 *   E0 · CONTROL, la librería NO tiene el arte de los vecinos: reanudar en
 *        Imagen IA textura el activo, los vecinos PREGUNTAN con `resolve_only`
 *        (nunca sin él: sin eso restaurar PINTARÍA ocho atlas por reanudar),
 *        se quedan en clay, el carril se vacía y el menú dev los sigue
 *        contando como arte pendiente (`tilesSinAtlas`), que es la verdad.
 *        Cómo se llega: el motor falso resuelve POR CELDA, y los vecinos de
 *        Miravanda comparten todas sus celdas con el tile de entrada (medido
 *        el 2026-09-23: la partida pinta el tile_0_0 y los nueve quedan con
 *        arte en la librería; el batch de estilo, detrás, pinta 0 celdas). No
 *        hay forma de tener «un vecino sin arte» sin mundo a medida, así que
 *        la respuesta a las restauraciones de E0 se contesta VACÍA
 *        (`page.route`), que es lo que devuelve la librería sin esas celdas.
 *   E1 · Con el arte en la librería (el batch de estilo garantiza el mundo
 *        entero), reanudar la MISMA partida en Imagen IA deja texturados los
 *        nueve tiles; los POST de los vecinos son todos `resolve_only`, el
 *        motor falso no anota ningún pago y el activo sigue texturado.
 *   E2 · Partida VIVA nueva sobre el mundo pre-generado: el vecino que llega
 *        por el cable (`request_tile`, sin que el jugador cruce) se textura
 *        con el jugador aún en su tile de entrada. Sin mapping local (E1 lo
 *        dejó escrito para los nueve), para que la restauración vaya por la
 *        red y se pueda afirmar su `resolve_only`.
 *
 *  El `layout_key` del POST identifica el tile (hash del layout + estilo); el
 *  del activo se aprende de los POST que PINTAN en la partida viva, cuando es
 *  el único tile que puede pintar.
 *
 *  PROBADO EN NEGATIVO (2026-09-23): con `carga-de-tile.ts` sin la rama
 *  `else` que llama a `fpsAtlas.restaurar`, E1 y E2 salen rojos por la espera
 *  del texturado, nombrando los tiles en clay. Salida en
 *  `docs/agents/2026-09-23-tanda-ai-el-resume-pinta-lo-que-instala/`.
 *
 *  CERO CRÉDITOS: motor falso (`e2e-sin-creditos`); el batch de estilo y la
 *  partida en Imagen IA pintan dameros en el falso, que los anota como ruta de
 *  pago y por eso no se declara `sinMotor`. `aisla`: el mundo lo pre-genera
 *  este guion (la librería vacía de E0 depende de ello) y la caché del falso
 *  empieza fría.
 */
import { comenzar, esperarRegistro, nuevaPartida, pedirYEsperarTile, reanudar, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["mundo", "saves", "fake-ai"];

const GAME_ID = "alta_fantasia";

async function pagosDeAtlas() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const { gasto } = await res.json();
  return gasto.rutas["/generate_surface_atlas"] ?? 0;
}

/** Qué tiles siguen en clay: lo que dice el ✘ de una espera de texturado. */
const enClay = (ctx) =>
  ctx.page.evaluate(() => {
    const f = window.__nefan.fps();
    const textured = f.ready ? f.textured : [];
    return { activeTile: f.activeTile ?? null, enClay: window.__nefan.tiles.filter((k) => !textured.includes(k)) };
  });

const olvidarMappingLocal = (ctx) =>
  ctx.page.evaluate(() => {
    const claves = Object.keys(localStorage).filter((k) => k.startsWith("fps_atlas:"));
    for (const k of claves) localStorage.removeItem(k);
    return claves.length;
  });

/** Espera a que el carril de restauración se vacíe con el activo texturado:
 *  a partir de ahí el estado del renderer ya no cambia solo. */
const esperarQuieto = (ctx, desc) =>
  ctx.waitFor(
    desc,
    () => {
      const f = window.__nefan.fps();
      const quieto =
        f.ready &&
        f.activeTile &&
        f.textured.includes(f.activeTile) &&
        !window.__nefan.status().painting &&
        window.__nefan.status().restaurando === 0;
      return quieto ? { activeTile: f.activeTile, textured: f.textured, tiles: window.__nefan.tiles } : null;
    },
    90_000,
  );

/** Espera a que TODOS los tiles instalados estén texturados. Al expirar, el
 *  ✘ nombra los que siguen en clay. */
const esperarTodosTexturados = (ctx, desc) =>
  ctx.expectEspera(
    desc,
    true,
    () => {
      const f = window.__nefan.fps();
      if (!f.ready) return null;
      const enClay = window.__nefan.tiles.filter((k) => !f.textured.includes(k));
      return enClay.length === 0 ? { activeTile: f.activeTile, textured: f.textured } : null;
    },
    { ms: 90_000 },
  );

export default async function (ctx) {
  /** Cuerpo de cada POST del atlas, en orden, desde el borde del navegador. */
  const posts = [];
  ctx.page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/generate_surface_atlas")) return;
    let body = null;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = { __sin_json: r.postData() };
    }
    posts.push({ layout_key: body?.layout_key ?? null, resolve_only: body?.resolve_only === true });
  });
  /** Los POST desde `i` de un tile que no es el que tiene `claveActivo`. */
  const deOtrosTiles = (i, claveActivo) => posts.slice(i).filter((p) => p.layout_key !== claveActivo);

  await regenerarMundo(ctx, GAME_ID);

  // ── Partida viva en Imagen IA: pinta SU tile, y solo el suyo ──────────────
  const postsPartida = posts.length;
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  const partida = await comenzar(ctx);
  const viva = await esperarQuieto(ctx, "la partida viva texturó el tile de entrada");
  ctx.log(`partida viva: ${JSON.stringify(viva)}`);
  const pintaron = [...new Set(posts.slice(postsPartida).filter((p) => !p.resolve_only).map((p) => p.layout_key))];
  ctx.expect(
    "PRECONDICIÓN — en la partida viva solo pintó UN tile (el activo): de él se aprende su layout_key",
    pintaron.length === 1,
    JSON.stringify(pintaron),
  );
  const claveActivo = pintaron[0] ?? null;

  // ══ E0 · reanudar con la librería SIN el arte de los vecinos ══════════════
  await olvidarMappingLocal(ctx);
  const pagos0 = await pagosDeAtlas();
  const posts0 = posts.length;
  const libreriaSinVecinos = async (route) => {
    let b = null;
    try {
      b = JSON.parse(route.request().postData() ?? "null");
    } catch {
      b = null; // sin cuerpo legible no es una restauración que vaciar
    }
    if (!b || b.layout_key === claveActivo) return route.continue();
    return route.fulfill({
      json: { cells: {}, pages_painted: 0, cached: true, cost_usd: 0, missing: b.cells?.length ?? 0 },
    });
  };
  await ctx.page.route("**/generate_surface_atlas", libreriaSinVecinos);
  const vuelta0 = await reanudar(ctx, partida.sessionId);
  if (!vuelta0) ctx.sinMedir("no se pudo reanudar la partida (E0)");
  const e0 = await esperarQuieto(ctx, "E0 · el resume textura el activo y el carril de restauración se vacía");
  await ctx.page.unroute("**/generate_surface_atlas", libreriaSinVecinos);
  ctx.log(`E0 · tras reanudar: ${JSON.stringify(e0)}`);
  if (e0.tiles.length < 9) {
    ctx.sinMedir(
      `el save volvió con ${e0.tiles.length} tile(s) y este guion mide el anillo 3×3 del mundo pre-generado`,
    );
  }
  ctx.expect(
    "E0 · el tile del jugador vuelve texturado",
    e0.textured.includes(e0.activeTile),
    JSON.stringify(e0),
  );
  ctx.expect(
    "E0 · sin su arte en la librería, los vecinos siguen en clay (nada que restaurar, y el menú lo ofrece como pendiente)",
    e0.tiles.filter((k) => k !== e0.activeTile).every((k) => !e0.textured.includes(k)),
    JSON.stringify(e0),
  );
  const otros0 = deOtrosTiles(posts0, claveActivo);
  ctx.expect(
    "E0 · los vecinos PREGUNTARON a la librería (hay POST de tiles no activos) y todos con resolve_only: restaurar no pinta",
    otros0.length > 0 && otros0.every((p) => p.resolve_only),
    JSON.stringify({ claveActivo, otros: otros0 }),
  );
  ctx.expect(
    "E0 · reanudar no anotó ningún pago de atlas en el motor falso",
    (await pagosDeAtlas()) === pagos0,
    `pagos antes ${pagos0} → ${await pagosDeAtlas()}`,
  );
  const filasDelMenu = await ctx.page.evaluate(() => {
    const f = window.__nefan.fps();
    return f.surfaces.filter((k) => !f.textured.includes(k));
  });
  ctx.expect(
    "E0 · y el arte pendiente que cuenta el menú (tiles con superficies y sin atlas) son exactamente los ocho vecinos",
    filasDelMenu.length === 8 && !filasDelMenu.includes(e0.activeTile),
    JSON.stringify(filasDelMenu),
  );
  await ctx.shot("e0-vecinos-sin-arte-en-la-libreria");

  // ══ E1 · el batch de estilo pinta el mundo; reanudar lo trae entero ═══════
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  await ctx.page.click("#ts-style-run");
  const corrida = await esperarRegistro(
    ctx,
    "el batch de estilo termina",
    "estilo",
    () => (window.__nefan.estilo()?.done ? window.__nefan.estilo() : null),
    240_000,
  );
  ctx.log(`batch de estilo (lo que tuvo que pedir): ${JSON.stringify(corrida.issued ?? corrida)}`);

  await olvidarMappingLocal(ctx);
  const pagos1 = await pagosDeAtlas();
  const posts1 = posts.length;
  const vuelta1 = await reanudar(ctx, partida.sessionId);
  if (!vuelta1) ctx.sinMedir("no se pudo reanudar la partida (E1)");
  const { ocurrio: e1Todos, ultimo: e1 } = await esperarTodosTexturados(
    ctx,
    "E1 · con el arte en la librería, reanudar deja texturados los NUEVE tiles (ningún vecino en clay)",
  );
  ctx.log(`E1 · tras reanudar: ${JSON.stringify(e1 ?? (await enClay(ctx)))}`);
  await esperarQuieto(ctx, "E1 · el carril de restauración termina");
  const otros1 = deOtrosTiles(posts1, claveActivo);
  ctx.expect(
    "E1 · los POST de los tiles que no son el activo llevan TODOS resolve_only, también en Imagen IA",
    otros1.length > 0 && otros1.every((p) => p.resolve_only),
    JSON.stringify({ claveActivo, otros: otros1 }),
  );
  ctx.expect(
    "E1 · restaurar los vecinos no anotó ningún pago de atlas en el motor falso",
    (await pagosDeAtlas()) === pagos1,
    `pagos antes ${pagos1} → ${await pagosDeAtlas()}`,
  );
  if (e1Todos) {
    ctx.expect(
      "E1 · y el tile del jugador sigue texturado (la restauración no desechó su corrida)",
      Boolean(e1.activeTile) && e1.textured.includes(e1.activeTile),
      JSON.stringify(e1),
    );
  }
  await ctx.shot("e1-reanudada-con-los-nueve-tiles");

  // ══ E2 · partida viva: el vecino que llega por el cable se textura ════════
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await olvidarMappingLocal(ctx);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  const entrada = await esperarQuieto(ctx, "E2 · la partida nueva textura su tile de entrada");
  const [, tx, ty] = /^tile_(-?\d+)_(-?\d+)$/.exec(entrada.activeTile) ?? [];
  if (tx === undefined) ctx.sinMedir(`el tile activo «${entrada.activeTile}» no tiene forma tile_<x>_<y>`);
  const vecino = { tx: Number(tx) + 1, ty: Number(ty) };
  const claveVecino = `tile_${vecino.tx}_${vecino.ty}`;
  if (entrada.tiles.includes(claveVecino)) {
    ctx.sinMedir(`${claveVecino} ya estaba instalado al empezar: no hay llegada que medir`);
  }
  const pagos2 = await pagosDeAtlas();
  const posts2 = posts.length;
  await pedirYEsperarTile(ctx, claveVecino, vecino.tx, vecino.ty);
  const { ocurrio: e2Ok, ultimo: e2 } = await ctx.expectEspera(
    `E2 · el vecino ${claveVecino} que llega en partida viva se textura SIN que el jugador cruce`,
    true,
    ([k, activo]) => {
      const f = window.__nefan.fps();
      return f.ready && f.activeTile === activo && f.textured.includes(k)
        ? { activeTile: f.activeTile, textured: f.textured }
        : null;
    },
    { ms: 90_000, arg: [claveVecino, entrada.activeTile] },
  );
  ctx.log(`E2 · ${JSON.stringify(e2 ?? (await enClay(ctx)))}`);
  const otros2 = deOtrosTiles(posts2, claveActivo);
  ctx.expect(
    "E2 · el vecino preguntó a la librería con resolve_only y sin pagar",
    otros2.length > 0 && otros2.every((p) => p.resolve_only) && (await pagosDeAtlas()) === pagos2,
    JSON.stringify({ otros: otros2, pagosAntes: pagos2 }),
  );
  if (e2Ok) await ctx.shot("e2-vecino-texturado-sin-cruzar");
}
