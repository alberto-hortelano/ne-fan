/** LA CORRIDA DE UN TILE NO TIRA LA DE OTRO (#729, tanda AX).
 *
 *  «Generar y aplicar» del menú dev sobre un vecino que va en clay, y mientras
 *  su atlas pinta, algo pasa en OTRO tile: el jugador pulsa G sobre el suyo, o
 *  cruza a otro tile. Hasta la tanda AX el controller compartía UN token entre
 *  todas las corridas, así que la segunda desechaba la primera: el vecino
 *  PAGABA su atlas, registraba su keep-list y se quedaba en clay. Con #757 (en
 *  desarrollo lo automático no pinta) el menú dev y la G son las únicas
 *  puertas que pagan arte nuevo, así que esto es el camino principal de quien
 *  desarrolla, no un rincón.
 *
 *  La ventana se CONSTRUYE, no se espera a que ocurra: el POST del vecino se
 *  RETIENE con `page.route` hasta que lo del otro tile ya ha salido, y solo
 *  entonces se suelta.
 *
 *   1 · menú dev sobre el vecino X (retenido) → G sobre el activo A → se
 *       suelta X. A y X texturados.
 *   2 · menú dev sobre el vecino W (retenido) → el jugador pasa a Y y su ciclo
 *       de activo lanza su corrida → se suelta W. W y Y texturados (Y, con la
 *       G si la librería no lo tenía).
 *
 *  El paso a Y es por TELETRANSPORTE (`setPlayerPos`), y es fabricación
 *  declarada: lo que se mide es el disparador (`activateByPosition` →
 *  `onActiveTile`), el mismo que al cruzar andando; andar solo añadiría una
 *  espera y la posibilidad de un muro en medio.
 *
 *  Corre en `produccion` (el entorno por defecto del banco), en MAQUETA: una
 *  partida nueva nace así, y el activo solo pregunta a la librería
 *  (`resolve_only`), así que lo único que pinta es lo que se pide a mano.
 *
 *  PROBADO EN NEGATIVO: con `politica-de-atlas.ts`, `fps-atlas.ts` y
 *  `carga-de-tile.ts` de `main` (token global), rojos los asertos del vecino
 *  (X y W salen en clay). La
 *  salida está en `docs/agents/2026-09-24-tanda-ax-el-atlas-se-dispara-cuando-toca/`.
 *
 *  LO QUE NO MIDE: la regla entera (la MISMA clave no paga dos veces, el
 *  re-disparo al quedar libre, el cambio de mundo): eso es
 *  `nefan-core/test/politica-de-atlas.test.ts` y la costura del controller,
 *  `nefan-html/test/la-corrida-de-un-tile-no-tira-la-de-otro.test.ts`.
 *
 *  CERO CRÉDITOS: motor falso. Pide pintar a propósito (menú dev y G), así que
 *  no es `sinMotor`.
 */
import { comenzar, nuevaPartida, pedirYEsperarTile } from "../lib/sesion.mjs";

export const aisla = ["mundo", "saves", "fake-ai"];

/** Medio lado de un tile, en metros (tiles de 64 m centrados en `64·t`). */
const MEDIO_TILE_M = 32;

/** Quieto: sin corridas en vuelo ni restauraciones pendientes. */
const esperarQuieto = (ctx, desc) =>
  ctx.waitFor(
    desc,
    () => {
      const n = window.__nefan;
      const f = n.fps();
      return f.ready && f.activeTile && !n.status().painting && n.status().restaurando === 0
        ? { activeTile: f.activeTile, textured: f.textured, tiles: n.tiles }
        : null;
    },
    90_000,
  );

/** «Generar y aplicar» del menú dev sobre el atlas de `key`: armar y
 *  confirmar, y cerrar el menú (la G tiene que llegar al juego). */
async function generarDesdeElMenu(ctx, key) {
  await ctx.page.click("#ds-menu-btn");
  await ctx.page.waitForSelector("#dev-menu-items", { state: "visible", timeout: 10_000 });
  const boton = ctx.page.locator("#dev-menu-items .dm-item", { hasText: `Atlas fps ${key} ` }).locator("button");
  await boton.waitFor({ state: "visible", timeout: 15_000 });
  await boton.click(); // armar
  await boton.click(); // confirmar
  await ctx.page.click("#dm-close");
}

/** Espera a que `key` esté texturado; devuelve `{ocurrio, ultimo}`. */
const quedaTexturado = (ctx, desc, key) =>
  ctx.expectEspera(
    desc,
    true,
    (k) => {
      const f = window.__nefan.fps();
      return f.ready && f.textured.includes(k) ? { activeTile: f.activeTile, textured: f.textured } : null;
    },
    { ms: 30_000, arg: key },
  );

export default async function (ctx) {
  /** Cuerpo de cada POST del atlas, en orden, desde el borde del navegador. */
  const posts = [];
  ctx.page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/generate_surface_atlas")) return;
    let body;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = null; // sin cuerpo legible: cuenta como que PINTA
    }
    posts.push({ layout_key: body?.layout_key ?? null, resolve_only: body?.resolve_only === true });
  });

  /** El PRIMER POST que pide pintar desde que se arma se retiene hasta
   *  `soltar()`. Los `resolve_only` y los que pintan después pasan. */
  let armado = false;
  let soltar = () => {};
  await ctx.page.route("**/generate_surface_atlas", async (route) => {
    let b;
    try {
      b = JSON.parse(route.request().postData() ?? "null");
    } catch {
      b = null; // sin cuerpo legible no hay nada que decidir: pasa
    }
    if (!armado || !b || b.resolve_only === true) return route.continue();
    armado = false;
    await new Promise((r) => (soltar = r));
    return route.continue();
  });
  /** Qué POST del atlas es cuál, leído del cuerpo. */
  const cuerpo = (r) => {
    try {
      return JSON.parse(r.postData() ?? "null");
    } catch {
      return null; // sin cuerpo legible no es ninguno de los que se esperan
    }
  };
  const esAtlas = (r) => r.method() === "POST" && r.url().includes("/generate_surface_atlas");
  /** Arma la retención y devuelve la espera del POST que va a quedar
   *  retenido (el primero que pide pintar). Se pide ANTES del click. */
  const retenerElSiguiente = () => {
    armado = true;
    return ctx.page.waitForRequest((r) => esAtlas(r) && cuerpo(r)?.resolve_only !== true, { timeout: 30_000 });
  };

  // ══ 0 · Partida nueva en maqueta con tres vecinos en clay ═════════════════
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  const q0 = await esperarQuieto(ctx, "0 · la partida arranca y el activo termina de preguntar a la librería");
  const [, txS, tyS] = /^tile_(-?\d+)_(-?\d+)$/.exec(q0.activeTile) ?? [];
  if (txS === undefined) ctx.sinMedir(`el tile activo «${q0.activeTile}» no tiene forma tile_<x>_<y>`);
  const tx = Number(txS);
  const ty = Number(tyS);
  const A = q0.activeTile;
  const X = `tile_${tx + 1}_${ty}`;
  const W = `tile_${tx - 1}_${ty}`;
  const Y = `tile_${tx}_${ty + 1}`;
  const yaInstalados = [X, W, Y].filter((k) => q0.tiles.includes(k));
  if (yaInstalados.length > 0) {
    ctx.sinMedir(`${yaInstalados.join(", ")} ya estaban instalados al empezar: su restauración no es la que este guion prepara`);
  }
  await pedirYEsperarTile(ctx, X, tx + 1, ty);
  await pedirYEsperarTile(ctx, W, tx - 1, ty);
  await pedirYEsperarTile(ctx, Y, tx, ty + 1);
  const q0b = await esperarQuieto(ctx, "0 · los tres vecinos instalados y su restauración terminada");
  ctx.log(`0 · ${JSON.stringify({ A, X, W, Y, ...q0b })}`);
  ctx.expect(
    "0 · PRECONDICIÓN — X, W e Y van en clay (el menú dev los ofrece) y el activo también: la librería está vacía",
    [A, X, W, Y].every((k) => q0b.tiles.includes(k) && !q0b.textured.includes(k)),
    JSON.stringify(q0b),
  );

  // ══ 1 · Menú dev sobre X, G sobre el activo mientras X pinta ══════════════
  const deX = retenerElSiguiente();
  await generarDesdeElMenu(ctx, X);
  await deX; // el POST de X salió y la ruta lo retiene
  const posts1 = posts.length;
  await ctx.page.keyboard.press("g");
  await quedaTexturado(ctx, `1 · la G textura el activo ${A} con X aún en el aire`, A);
  ctx.expect(
    "1 · la G mandó su propio POST de pintar mientras X seguía retenido",
    posts.slice(posts1).some((p) => !p.resolve_only),
    JSON.stringify(posts.slice(posts1)),
  );
  soltar();
  await quedaTexturado(
    ctx,
    `1 · al soltarlo, el vecino ${X} TAMBIÉN acaba texturado: la G sobre ${A} no tiró su corrida`,
    X,
  );
  const e1 = await ctx.page.evaluate(() => window.__nefan.fps().textured);
  ctx.log(`1 · textured=${JSON.stringify(e1)}`);
  ctx.expect(`1 · y el activo ${A} sigue texturado`, e1.includes(A), JSON.stringify(e1));
  await esperarQuieto(ctx, "1 · nada en vuelo");
  await ctx.shot("182-1-la-g-no-tira-el-vecino");

  // ══ 2 · Menú dev sobre W, el jugador pasa a Y mientras W pinta ════════════
  const deW = retenerElSiguiente();
  await generarDesdeElMenu(ctx, W);
  await deW;
  const posts2 = posts.length;
  // La corrida del activo Y sale con el POST de su ciclo (`resolve_only`, en
  // maqueta). Con el token global de antes, ESE `nuevoRun` es el que tiraba W.
  const deY = ctx.page.waitForRequest((r) => esAtlas(r) && cuerpo(r)?.resolve_only === true, { timeout: 30_000 });
  await ctx.nefan("setPlayerPos", tx * 2 * MEDIO_TILE_M, (ty + 1) * 2 * MEDIO_TILE_M);
  await ctx.waitFor(
    `2 · el jugador está en ${Y} y ${Y} es el tile activo`,
    (k) => (window.__nefan.currentTile === k && window.__nefan.fps().activeTile === k ? true : null),
    15_000,
    Y,
  );
  await deY;
  ctx.expect(
    `2 · el ciclo del activo ${Y} lanzó su corrida con W aún retenido`,
    posts.slice(posts2).some((p) => p.resolve_only),
    JSON.stringify(posts.slice(posts2)),
  );
  soltar();
  const { ocurrio: w2 } = await quedaTexturado(
    ctx,
    `2 · al soltarlo, el vecino ${W} acaba texturado: cambiar de activo no tiró su corrida`,
    W,
  );
  const q2 = await esperarQuieto(ctx, "2 · nada en vuelo");
  if (!q2.textured.includes(Y)) await ctx.page.keyboard.press("g");
  await quedaTexturado(ctx, `2 · y el activo ${Y} también (de la librería o con la G)`, Y);
  const f2 = await ctx.page.evaluate(() => window.__nefan.fps().textured);
  ctx.log(`2 · textured=${JSON.stringify(f2)}`);
  ctx.expect(`2 · ${W} y ${Y} texturados a la vez`, w2 && f2.includes(W) && f2.includes(Y), JSON.stringify(f2));
  await ctx.shot("182-2-cambiar-de-activo-no-tira-el-vecino");
}
