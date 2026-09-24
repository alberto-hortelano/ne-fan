/** LO QUE LA VIGENCIA POR CLAVE NO CUBRE (#729, escrito por QA en la tanda AX).
 *
 *  El 182 mide que la corrida de un tile ya no tira la de otro. Este guion
 *  mide los tres estados VECINOS de esa regla, los que un desarrollador con el
 *  menú dev pisa a diario y que la vigencia por clave deja como están:
 *
 *   1 · la G sobre el tile activo MIENTRAS su propio ciclo pregunta a la
 *       librería (`resolve_only`, maqueta). La clave está ocupada: la G no
 *       manda un segundo POST (criterio 3, no pagar dos veces), LO DICE en el
 *       registro y se ENCOLA: al acabar la pregunta, pinta (H-2 de `qa.md`,
 *       cerrado en la misma tanda; antes se descartaba);
 *   2 · con una manual del menú dev pintando un VECINO, el panel dev enciende
 *       su aviso NOMBRANDO ese vecino (H-3; antes decía «del tile activo») y
 *       el menú deshabilita SOLO su fila (H-4; antes, todas);
 *   3 · en producción con Imagen IA, la RESTAURACIÓN de un vecino que llega
 *       por el cable pinta lo que falta (guion 180). Mientras ese POST va en
 *       el aire la clave está OCUPADA (H-1): el menú dice «Generando…» en esa
 *       fila y no hay forma de mandar un segundo POST de pintar con el mismo
 *       `layout_key`.
 *
 *  Los tres nacieron como `ctx.log` (hallazgos H-1..H-4 de QA, regla T10) y
 *  pasaron a `ctx.expect` con los arreglos de la tanda AX.
 *
 *  Las ventanas se CONSTRUYEN reteniendo el POST con `page.route`, como en el
 *  182. Corre en `produccion` (el defecto del banco); el bloque 3 es el único
 *  que pide PINTAR por un camino automático, y es el que #757 deja abierto ahí.
 *
 *  CERO CRÉDITOS: motor falso. Pide pintar a propósito, así que no es `sinMotor`.
 */
import { comenzar, nuevaPartida, pedirYEsperarTile, recargarAlTitulo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["mundo", "saves", "fake-ai"];

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

/** Todo lo que entra en `#combat-log` desde ahora (el HUD conserva pocas líneas). */
const espiarHud = (ctx) =>
  ctx.page.evaluate(() => {
    window.__qaHud184 = [];
    const log = document.getElementById("combat-log");
    if (!log) return;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qaHud184.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  });

async function contadoresDelFalso() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const c = await res.json();
  return {
    pagos: c.gasto.rutas["/generate_surface_atlas"] ?? 0,
    pintar: c.ejercicio?.rutas?.["pintar-superficies"] ?? 0,
  };
}

/** Abre el menú dev y devuelve el texto del botón de cada item; lo deja abierto. */
async function botonesDelMenu(ctx) {
  await ctx.page.click("#ds-menu-btn");
  await ctx.page.waitForSelector("#dev-menu-items", { state: "visible", timeout: 10_000 });
  return ctx.page.$$eval("#dev-menu-items .dm-item", (rows) =>
    rows.map((r) => ({
      label: r.querySelector(".dm-label")?.textContent ?? "",
      boton: r.querySelector("button")?.textContent ?? "",
      disabled: r.querySelector("button")?.disabled ?? null,
    })),
  );
}

/** «Generar y aplicar» sobre `key` con el menú YA abierto, y lo cierra. */
async function generarYCerrar(ctx, key) {
  const boton = ctx.page.locator("#dev-menu-items .dm-item", { hasText: `Atlas fps ${key} ` }).locator("button");
  await boton.waitFor({ state: "visible", timeout: 15_000 });
  await boton.click(); // armar
  await boton.click(); // confirmar
  await ctx.page.click("#dm-close");
}

const claveDe = (activo) => {
  const [, txS, tyS] = /^tile_(-?\d+)_(-?\d+)$/.exec(activo) ?? [];
  return txS === undefined ? null : { tx: Number(txS), ty: Number(tyS) };
};

export default async function (ctx) {
  /** Cuerpo de cada POST del atlas, en orden, desde el borde del navegador. */
  const posts = [];
  const cuerpo = (r) => {
    try {
      return JSON.parse(r.postData() ?? "null");
    } catch {
      return null; // sin cuerpo legible no es ninguno de los que se esperan
    }
  };
  const esAtlas = (r) => r.method() === "POST" && r.url().includes("/generate_surface_atlas");
  ctx.page.on("request", (r) => {
    if (!esAtlas(r)) return;
    const b = cuerpo(r);
    posts.push({ layout_key: b?.layout_key ?? null, resolve_only: b?.resolve_only === true });
  });

  /** Retiene el PRIMER POST que cumpla `retenerSi` hasta `soltar()`. */
  let retenerSi = null;
  let soltar = () => {};
  /** Con esto puesto, una PREGUNTA a la librería (`resolve_only`) vuelve
   *  vacía: fabricación declarada para el bloque 2. Tras la G del bloque 1 la
   *  librería del falso tiene las celdas del activo, y en Miravanda el vecino
   *  las comparte todas (lo mismo que resuelve el 180), así que sin esto el
   *  vecino se restauraría texturado y no habría fila en el menú. */
  let libreriaSinElVecino = false;
  await ctx.page.route("**/generate_surface_atlas", async (route) => {
    const b = cuerpo(route.request());
    if (libreriaSinElVecino && b?.resolve_only === true) {
      const vacio = { cells: {}, pages_painted: 0, cached: true, cost_usd: 0, missing: b.cells?.length ?? 0 };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(vacio) });
    }
    if (!retenerSi || !b || !retenerSi(b)) return route.continue();
    retenerSi = null;
    await new Promise((r) => (soltar = r));
    return route.continue();
  });
  const retener = (pred) => {
    retenerSi = pred;
    return ctx.page.waitForRequest((r) => esAtlas(r) && !!cuerpo(r) && pred(cuerpo(r)), { timeout: 30_000 });
  };

  // ══ 1 · Maqueta: la G mientras el activo pregunta a la librería ═══════════
  await ctx.page.addInitScript(() => {
    window.__qaHud184 = [];
    const enganchar = () => {
      const log = document.getElementById("combat-log");
      if (!log) return;
      new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) window.__qaHud184.push(n.textContent ?? "");
      }).observe(log, { childList: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enganchar);
    else enganchar();
  });
  await espiarHud(ctx);
  const delActivo = retener((b) => b.resolve_only === true);
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  await delActivo; // el ciclo del activo preguntó a la librería y la ruta lo retiene
  const activo1 = await ctx.page.evaluate(() => window.__nefan.fps().activeTile);
  const posts1 = posts.length;
  await ctx.page.keyboard.press("g");
  const { ocurrio: dicho } = await ctx.expectEspera(
    "1 · la G con la corrida del activo en vuelo LO DICE en el registro («ya hay una corrida en vuelo»)",
    true,
    () => {
      const l = (window.__qaHud184 ?? []).find((x) => x.includes("ya hay una corrida en vuelo"));
      return l ? { linea: l } : null;
    },
    { ms: 10_000 },
  );
  ctx.expect(
    "1 · y NO manda un segundo POST de esa clave mientras la primera sigue retenida (criterio 3: no se paga dos veces)",
    dicho && posts.slice(posts1).length === 0,
    JSON.stringify(posts.slice(posts1)),
  );
  soltar();
  const q1 = await esperarQuieto(ctx, "1 · el ciclo del activo termina");
  const pintarTrasLaG = posts.slice(posts1).filter((p) => !p.resolve_only).length;
  ctx.expect(
    `1 · H-2: la G no se descarta — al soltar la corrida del activo, pinta ${activo1} con UN POST`,
    q1.textured.includes(activo1) && pintarTrasLaG === 1,
    JSON.stringify({ texturado: q1.textured.includes(activo1), pintarTrasLaG }),
  );

  // ══ 2 · El rótulo del panel con una manual de un VECINO pintando ══════════
  const c1 = claveDe(q1.activeTile);
  if (!c1) ctx.sinMedir(`el tile activo «${q1.activeTile}» no tiene forma tile_<x>_<y>`);
  const X = `tile_${c1.tx + 1}_${c1.ty}`;
  if (q1.tiles.includes(X)) ctx.sinMedir(`${X} ya estaba instalado al empezar`);
  // Un segundo vecino en clay, W, para que «solo la fila de X» (H-4) tenga
  // con quién compararse.
  const W = `tile_${c1.tx - 1}_${c1.ty}`;
  if (q1.tiles.includes(W)) ctx.sinMedir(`${W} ya estaba instalado al empezar`);
  libreriaSinElVecino = true;
  await pedirYEsperarTile(ctx, X, c1.tx + 1, c1.ty);
  await pedirYEsperarTile(ctx, W, c1.tx - 1, c1.ty);
  const q2 = await esperarQuieto(ctx, "2 · el vecino instalado y su restauración terminada");
  libreriaSinElVecino = false;
  ctx.expect(
    "2 · PRECONDICIÓN — los dos vecinos van en clay",
    [X, W].every((k) => q2.tiles.includes(k) && !q2.textured.includes(k)),
    JSON.stringify(q2),
  );
  const deX = retener((b) => b.resolve_only !== true);
  await botonesDelMenu(ctx);
  await generarYCerrar(ctx, X);
  await deX; // la manual de X salió y la ruta la retiene
  const panel = await ctx.page.evaluate(() => ({
    rotulo: document.getElementById("ds-gen")?.textContent ?? "",
    painting: window.__nefan.status().painting,
    activeTile: window.__nefan.fps().activeTile,
  }));
  const botones = await botonesDelMenu(ctx);
  await ctx.page.click("#dm-close");
  ctx.log(`2 · panel=${JSON.stringify(panel)}`);
  ctx.log(`2 · menú con la manual de ${X} en vuelo: ${JSON.stringify(botones)}`);
  ctx.expect(
    `2 · el panel dev enciende el aviso de pintura con una corrida que NO es del activo (${X} ≠ ${panel.activeTile})`,
    panel.painting === true && panel.activeTile !== X && panel.rotulo.length > 0,
    JSON.stringify(panel),
  );
  ctx.expect(
    `2 · H-3: el aviso del panel NOMBRA el tile que pinta (${X}), no «el tile activo»`,
    panel.rotulo.includes(X) && !panel.rotulo.includes("tile activo"),
    panel.rotulo,
  );
  const filaX = botones.find((b) => b.label.includes(`Atlas fps ${X} `));
  const filaW = botones.find((b) => b.label.includes(`Atlas fps ${W} `));
  ctx.expect(
    `2 · H-4: el menú deshabilita SOLO la fila de ${X}; la de ${W} sigue viva`,
    filaX?.disabled === true && filaW?.disabled === false && filaW.boton === "Generar y aplicar",
    JSON.stringify(botones),
  );
  await ctx.shot("184-2-panel-con-manual-de-un-vecino");
  soltar();
  await esperarQuieto(ctx, "2 · nada en vuelo");

  // ══ 3 · Producción + Imagen IA: restauración del vecino + menú sobre él ═══
  await recargarAlTitulo(ctx); // el espía del registro lo reinstala el init script (sin `espiarHud`, que doblaría cada línea)
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "image" });
  await comenzar(ctx);
  const q3 = await esperarQuieto(ctx, "3 · la partida en Imagen IA textura su tile de entrada");
  const c3 = claveDe(q3.activeTile);
  if (!c3) ctx.sinMedir(`el tile activo «${q3.activeTile}» no tiene forma tile_<x>_<y>`);
  const V = `tile_${c3.tx}_${c3.ty + 1}`;
  if (q3.tiles.includes(V)) ctx.sinMedir(`${V} ya estaba instalado al empezar`);
  const falso0 = await contadoresDelFalso();
  const posts3 = posts.length;
  const deV = retener((b) => b.resolve_only !== true);
  await pedirYEsperarTile(ctx, V, c3.tx, c3.ty + 1);
  await deV; // la RESTAURACIÓN de V pide pintar (producción + Imagen IA) y la ruta la retiene
  const enVuelo = await ctx.page.evaluate(() => ({
    restaurando: window.__nefan.status().restaurando,
    painting: window.__nefan.status().painting,
  }));
  const botones3 = await botonesDelMenu(ctx);
  await ctx.page.click("#dm-close");
  const itemV = botones3.find((b) => b.label.includes(`Atlas fps ${V} `)) ?? null;
  ctx.log(`3 · con la restauración de ${V} retenida: ${JSON.stringify({ enVuelo, itemV })}`);
  ctx.expect(
    `3 · H-1: con la restauración de ${V} en vuelo su clave está OCUPADA — el menú dice «Generando…» y no deja pedir otro POST`,
    enVuelo.restaurando > 0 && itemV !== null && itemV.disabled === true && itemV.boton === "Generando…",
    JSON.stringify({ enVuelo, itemV }),
  );
  soltar();
  const q3b = await esperarQuieto(ctx, "3 · nada en vuelo");
  const falso1 = await contadoresDelFalso();
  const deV3 = posts.slice(posts3).filter((p) => !p.resolve_only);
  const porClave = new Map();
  for (const p of deV3) porClave.set(p.layout_key, (porClave.get(p.layout_key) ?? 0) + 1);
  const repetidos = [...porClave.entries()].filter(([, n]) => n > 1);
  ctx.log(`3 · POST de pintar desde que llegó ${V}: ${deV3.length} · falso: pintar ${falso1.pintar - falso0.pintar}, pagos ${falso1.pagos - falso0.pagos}`);
  ctx.expect(`3 · ningún layout_key pedido a PINTAR dos veces`, deV3.length > 0 && repetidos.length === 0, JSON.stringify(repetidos));
  ctx.expect(`3 · y ${V} acaba texturado`, q3b.textured.includes(V), JSON.stringify(q3b.textured));
  await ctx.shot("184-3-restauracion-y-manual-de-la-misma-clave");
}
