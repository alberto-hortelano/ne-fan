/** EN PRODUCCIÓN, EL VECINO QUE LLEGA PINTA LO QUE LE FALTA (tanda AS).
 *
 *  El gemelo del 160. Hasta la tanda AS, «un vecino nunca pinta, también con
 *  Imagen IA» era código (#714, `modoDeCorrida`); el usuario lo sacó a
 *  configuración (2026-09-24): *«no volver a generar por defecto mientras
 *  estemos en desarrollo… pero cuando estemos en prod sí»*. En producción, con
 *  Imagen IA, el activo y el vecino reciben el MISMO trato (`gatesDeImagen`):
 *  pintan lo que falte. Este guion corre en `produccion` (el defecto del
 *  banco) y mira el vecino que llega por el cable en partida viva:
 *
 *   1 · Partida viva en Imagen IA sobre el mundo pre-generado: el tile de
 *       entrada se textura PINTANDO (el motor falso anota la puerta
 *       `pintar-superficies`). Precondición de todo lo demás.
 *   2 · El vecino pedido por el cable (`request_tile`, sin que el jugador
 *       cruce) manda su POST del atlas SIN `resolve_only` y SE TEXTURA.
 *       Para que pintar cueste de verdad hace falta que su arte NO esté en la
 *       librería, y en Miravanda los vecinos comparten todas sus celdas con el
 *       tile de entrada, que acaba de pintarse; así que a su POST se le cambia
 *       la descripción de cada celda por el camino (`page.route`), que es lo
 *       que tendría un vecino con materiales propios. Con eso el motor falso
 *       ANOTA EL PAGO del atlas: el vecino pagó arte nuevo sin que nadie lo
 *       pidiera, que es exactamente lo que producción permite.
 *   3 · Y el HUD lo dice como gasto: la línea de balance del carril nombra el
 *       vecino PINTADO aparte de los restaurados ($0), para que el gasto de
 *       producción no quede mudo.
 *
 *  PROBADO EN NEGATIVO (2026-09-24): forzando `resolveOnly = true` en el carril
 *  de los vecinos (`ejecutarRestauracion`, `fps-atlas.ts`) salen ROJOS 2 y 3:
 *  el POST sale con `resolve_only`, el motor falso no anota el pago y el
 *  vecino se queda en clay. Salida en
 *  `docs/agents/2026-09-24-tanda-as-generar-arte-es-configuracion/`.
 *
 *  LO QUE NO MIDE: el coste de un anillo entero pintado a la vez al reanudar
 *  un mundo virgen en producción (está escrito, con su cota, en el informe de
 *  la tanda; el falso no cobra dólares); y el orden estilo-después-de-la-escena
 *  (#730), que es inalcanzable en partida: el bridge manda `session_started`
 *  antes de difundir escena (candado en
 *  `nefan-core/test/el-estilo-llega-antes-que-la-escena.test.ts`) y el cliente
 *  fija el estilo antes del siguiente mensaje (guion 183).
 *
 *  CERO CRÉDITOS: motor falso. Pinta a propósito, así que no es `sinMotor`.
 */
import { comenzar, nuevaPartida, pedirYEsperarTile, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["mundo", "saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Lo que se añade a la descripción de cada celda del vecino: otra
 *  descripción es otra celda de la librería, sin pagar todavía. */
const MATERIAL_PROPIO = " (materiales propios del vecino, QA-180)";

async function atlasDelFalso() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const c = await res.json();
  return {
    pagos: c.gasto.rutas["/generate_surface_atlas"] ?? 0,
    pintar: c.ejercicio?.rutas?.["pintar-superficies"] ?? 0,
  };
}

/** El HUD conserva pocas líneas: se recogen TODAS las que entren desde ahora. */
const espiarHud = (ctx) =>
  ctx.page.evaluate(() => {
    window.__qaHud180 = [];
    const log = document.getElementById("combat-log");
    if (!log) return;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qaHud180.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  });

export default async function (ctx) {
  /** Cuerpo de cada POST del atlas, en orden, desde el borde del navegador. */
  const posts = [];
  ctx.page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/generate_surface_atlas")) return;
    let body;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = { __sin_json: r.postData() };
    }
    posts.push({ layout_key: body?.layout_key ?? null, resolve_only: body?.resolve_only === true });
  });

  await regenerarMundo(ctx, GAME_ID);

  // ══ 1 · Partida viva en Imagen IA: el tile de entrada PINTA ═══════════════
  const falso0 = await atlasDelFalso();
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  const entrada = await ctx.waitFor(
    "1 · la partida viva textura su tile de entrada y el carril se vacía",
    () => {
      const n = window.__nefan;
      const f = n.fps();
      return f.ready && f.activeTile && f.textured.includes(f.activeTile) && !n.status().painting && n.status().restaurando === 0
        ? { activeTile: f.activeTile, tiles: n.tiles, entorno: n.entorno }
        : null;
    },
    90_000,
  );
  ctx.log(`1 · ${JSON.stringify(entrada)}`);
  const falso1 = await atlasDelFalso();
  ctx.expect(
    "1 · PRECONDICIÓN — el stack es de producción y la partida pidió PINTAR (puerta `pintar-superficies`)",
    entrada.entorno === "produccion" && falso1.pintar > falso0.pintar,
    JSON.stringify({ entorno: entrada.entorno, antes: falso0, ahora: falso1 }),
  );

  // ══ 2 · El vecino que llega por el cable pinta lo que le falta ════════════
  const [, tx, ty] = /^tile_(-?\d+)_(-?\d+)$/.exec(entrada.activeTile) ?? [];
  if (tx === undefined) ctx.sinMedir(`el tile activo «${entrada.activeTile}» no tiene forma tile_<x>_<y>`);
  const vecino = { tx: Number(tx) + 1, ty: Number(ty) };
  const claveVecino = `tile_${vecino.tx}_${vecino.ty}`;
  if (entrada.tiles.includes(claveVecino)) {
    ctx.sinMedir(`${claveVecino} ya estaba instalado al empezar: no hay llegada que medir`);
  }
  /** Solo lo que pide PINTAR cambia de materiales: una restauración pregunta
   *  por lo que hay, y cambiarle la pregunta mediría otra cosa. */
  const materialesPropios = async (route) => {
    let b;
    try {
      b = JSON.parse(route.request().postData() ?? "null");
    } catch {
      b = null; // sin cuerpo legible no hay celdas que cambiar
    }
    if (!b || b.resolve_only === true || !Array.isArray(b.cells)) return route.continue();
    b.cells = b.cells.map((c) => ({ ...c, desc: `${c.desc}${MATERIAL_PROPIO}` }));
    return route.continue({ postData: JSON.stringify(b) });
  };
  await espiarHud(ctx);
  const posts2 = posts.length;
  await ctx.page.route("**/generate_surface_atlas", materialesPropios);
  await pedirYEsperarTile(ctx, claveVecino, vecino.tx, vecino.ty);
  const { ocurrio: texturado, ultimo: e2 } = await ctx.expectEspera(
    `2 · el vecino ${claveVecino} que llega en partida viva se textura SIN que el jugador cruce`,
    true,
    ([k, activo]) => {
      const n = window.__nefan;
      const f = n.fps();
      return f.ready && f.activeTile === activo && f.textured.includes(k) && n.status().restaurando === 0
        ? { activeTile: f.activeTile, textured: f.textured }
        : null;
    },
    { ms: 90_000, arg: [claveVecino, entrada.activeTile] },
  );
  await ctx.page.unroute("**/generate_surface_atlas", materialesPropios);
  ctx.log(`2 · ${JSON.stringify(e2)}`);
  const delVecino = posts.slice(posts2);
  ctx.expect(
    "2 · el vecino mandó su POST del atlas SIN resolve_only: en producción con Imagen IA pinta lo que falta",
    delVecino.length > 0 && delVecino.some((p) => !p.resolve_only),
    JSON.stringify(delVecino),
  );
  const falso2 = await atlasDelFalso();
  ctx.expect(
    "2 · y lo PAGÓ: el motor falso anota el atlas del vecino",
    falso2.pagos > falso1.pagos,
    JSON.stringify({ antes: falso1, ahora: falso2 }),
  );

  // ══ 3 · El HUD lo dice como gasto ═════════════════════════════════════════
  const hud = await ctx.page.evaluate(() => (window.__qaHud180 ?? []).filter((l) => /tlas fps/.test(l)));
  ctx.log(`3 · HUD: ${JSON.stringify(hud)}`);
  ctx.expect(
    "3 · la línea de balance del carril nombra el vecino PINTADO como gasto, aparte de los restaurados",
    texturado && hud.some((l) => /\b1 vecino\(s\) PINTADO\(S\) \(gasto\)/.test(l)),
    JSON.stringify(hud),
  );
  await ctx.shot("180-vecino-pintado-en-produccion");
}
