/** EN DESARROLLO, EL TILE INSTALADO RECUPERA SU ARTE YA PAGADO Y NADA MÁS
 *  (#714, rehecho en la tanda AS).
 *
 *  Al reanudar sobre un mundo pre-generado, el save trae el anillo 3×3 y el
 *  cliente reinstala los nueve tiles, pero hasta #714 el atlas de superficies
 *  solo lo pedía el ACTIVO: los ocho vecinos se quedaban en clay para siempre,
 *  con su arte pagado en la librería. El arreglo fue un carril de
 *  RESTAURACIÓN en `PoliticaDeAtlas` (core).
 *
 *  Lo que #714 cableó además —«un vecino NUNCA pinta, también con Imagen IA»—
 *  el usuario lo sacó del código (2026-09-24): pagar arte en los caminos
 *  automáticos es CONFIGURACIÓN del stack (`NEFAN_ENTORNO`), y el activo y el
 *  vecino reciben el MISMO trato (`gatesDeImagen`). Este guion mide el lado de
 *  DESARROLLO (`export const entorno`): nada automático pinta, ni el activo ni
 *  los vecinos, y lo pagado vuelve. El lado de producción —el vecino PINTA lo
 *  que falta— es el 180.
 *
 *   E0 · Partida viva en Imagen IA y reanudar con la librería VACÍA: el activo
 *        y los vecinos PREGUNTAN (hay POST) y todos con `resolve_only`; los
 *        NUEVE se quedan en clay, el motor falso no anota ni un pago de atlas
 *        ni una petición de pintar, y el menú dev los ofrece a los nueve como
 *        arte pendiente, que es la verdad. Hasta la tanda AS este bloque
 *        necesitaba vaciar la librería con `page.route`, porque la partida
 *        viva pintaba el tile de entrada y los vecinos de Miravanda comparten
 *        todas sus celdas con él; en desarrollo nadie pinta, y la librería está
 *        vacía de verdad.
 *   E1 · Con el arte en la librería —el batch de «Aplicar estilo», que es una
 *        vía DELIBERADA y paga también en desarrollo—, reanudar la MISMA
 *        partida deja texturados los nueve tiles; todo POST del atlas lleva
 *        `resolve_only` y el motor falso no anota ningún pago.
 *
 *  PROBADO EN NEGATIVO (2026-09-24): con el techo quitado en `gatesDeImagen`
 *  (`const techo = true || …`) salen ROJOS los asertos de `resolve_only` y de
 *  «ningún pago» de E0 (el activo pinta y los vecinos preguntan pintando).
 *  Salida en `docs/agents/2026-09-24-tanda-as-generar-arte-es-configuracion/`.
 *  El de #714 sigue en pie: sin la llamada a `fpsAtlas.restaurar` en
 *  `carga-de-tile.ts`, E1 sale rojo en «los NUEVE» por expiración.
 *
 *  CERO CRÉDITOS: motor falso. El batch de estilo pinta dameros en el falso,
 *  que los anota como ruta de pago, y por eso no se declara `sinMotor`.
 *  `aisla`: el mundo lo pre-genera este guion y la librería del falso empieza
 *  fría.
 */
import { comenzar, esperarRegistro, nuevaPartida, reanudar, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const entorno = "desarrollo";
export const aisla = ["mundo", "saves", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** Lo que el motor falso lleva anotado del ATLAS: pagos y peticiones de pintar. */
async function atlasDelFalso() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const c = await res.json();
  return {
    pagos: c.gasto.rutas["/generate_surface_atlas"] ?? 0,
    pintar: c.ejercicio?.rutas?.["pintar-superficies"] ?? 0,
  };
}

const olvidarMappingLocal = (ctx) =>
  ctx.page.evaluate(() => {
    const claves = Object.keys(localStorage).filter((k) => k.startsWith("fps_atlas:"));
    for (const k of claves) localStorage.removeItem(k);
    return claves.length;
  });

/** Espera a que el carril de restauración se vacíe y el activo termine: a
 *  partir de ahí el estado del renderer ya no cambia solo. No exige que el
 *  activo esté texturado: en desarrollo, sin arte, no lo estará. */
const esperarQuieto = (ctx, desc) =>
  ctx.waitFor(
    desc,
    () => {
      const f = window.__nefan.fps();
      const quieto =
        f.ready && f.activeTile && !window.__nefan.status().painting && window.__nefan.status().restaurando === 0;
      return quieto
        ? { activeTile: f.activeTile, textured: f.textured, tiles: window.__nefan.tiles, surfaces: f.surfaces }
        : null;
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
  const quePintan = (desde) => posts.slice(desde).filter((p) => !p.resolve_only);

  await regenerarMundo(ctx, GAME_ID);

  // ── Partida viva en Imagen IA, en desarrollo: nadie pinta ────────────────
  const falso0 = await atlasDelFalso();
  const postsPartida = posts.length;
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "image" });
  const partida = await comenzar(ctx);
  const viva = await esperarQuieto(ctx, "la partida viva termina de preguntar por su arte");
  ctx.log(`partida viva: ${JSON.stringify(viva)}`);
  ctx.expect(
    "partida viva en Imagen IA · el tile de entrada PREGUNTÓ a la librería, con resolve_only: en desarrollo no pinta",
    posts.length > postsPartida && quePintan(postsPartida).length === 0,
    JSON.stringify(posts.slice(postsPartida)),
  );

  // ══ E0 · reanudar con la librería VACÍA ═══════════════════════════════════
  await olvidarMappingLocal(ctx);
  const posts0 = posts.length;
  const vuelta0 = await reanudar(ctx, partida.sessionId);
  if (!vuelta0) ctx.sinMedir("no se pudo reanudar la partida (E0)");
  const e0 = await esperarQuieto(ctx, "E0 · el resume termina: el activo y el carril de restauración");
  ctx.log(`E0 · tras reanudar: ${JSON.stringify(e0)}`);
  if (e0.tiles.length < 9) {
    ctx.sinMedir(
      `el save volvió con ${e0.tiles.length} tile(s) y este guion mide el anillo 3×3 del mundo pre-generado`,
    );
  }
  ctx.expect(
    "E0 · los tiles PREGUNTARON a la librería (un POST por tile, o más) y todos con resolve_only, también el activo",
    posts.length - posts0 >= e0.tiles.length && quePintan(posts0).length === 0,
    JSON.stringify(posts.slice(posts0)),
  );
  const falso0b = await atlasDelFalso();
  ctx.expect(
    "E0 · desde que empezó la partida, el motor falso no anotó ningún pago de atlas ni ninguna petición de pintar",
    falso0b.pagos === falso0.pagos && falso0b.pintar === falso0.pintar,
    JSON.stringify({ antes: falso0, ahora: falso0b }),
  );
  ctx.expect(
    "E0 · sin arte en la librería, los NUEVE siguen en clay",
    e0.textured.length === 0,
    JSON.stringify(e0),
  );
  const filasDelMenu = e0.surfaces.filter((k) => !e0.textured.includes(k));
  ctx.expect(
    "E0 · y el arte pendiente que cuenta el menú (tiles con superficies y sin atlas) son los nueve",
    filasDelMenu.length === 9 && filasDelMenu.includes(e0.activeTile),
    JSON.stringify(filasDelMenu),
  );
  await ctx.shot("e0-en-desarrollo-nada-pinta");

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
  const falsoBatch = await atlasDelFalso();
  ctx.expect(
    "E1 · el batch de estilo es DELIBERADO y paga también en desarrollo (el motor falso anota el atlas)",
    falsoBatch.pagos > falso0b.pagos,
    JSON.stringify({ antes: falso0b, ahora: falsoBatch }),
  );

  await olvidarMappingLocal(ctx);
  const posts1 = posts.length;
  const vuelta1 = await reanudar(ctx, partida.sessionId);
  if (!vuelta1) ctx.sinMedir("no se pudo reanudar la partida (E1)");
  const { ultimo: e1 } = await esperarTodosTexturados(
    ctx,
    "E1 · con el arte en la librería, reanudar deja texturados los NUEVE tiles (ningún vecino en clay)",
  );
  ctx.log(`E1 · tras reanudar: ${JSON.stringify(e1)}`);
  const quietoE1 = await esperarQuieto(ctx, "E1 · el carril de restauración termina");
  ctx.expect(
    "E1 · todo POST del atlas lleva resolve_only, el del activo incluido",
    posts.length > posts1 && quePintan(posts1).length === 0,
    JSON.stringify(posts.slice(posts1)),
  );
  const falso1 = await atlasDelFalso();
  ctx.expect(
    "E1 · restaurar no anotó ningún pago de atlas ni ninguna petición de pintar",
    falso1.pagos === falsoBatch.pagos && falso1.pintar === falsoBatch.pintar,
    JSON.stringify({ antes: falsoBatch, ahora: falso1 }),
  );
  ctx.expect(
    "E1 · y el tile del jugador está texturado",
    quietoE1.textured.includes(quietoE1.activeTile),
    JSON.stringify(quietoE1),
  );
  await ctx.shot("e1-reanudada-con-los-nueve-tiles");
}
