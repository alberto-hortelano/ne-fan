/** EN DESARROLLO, UNA PARTIDA EN IMAGEN IA NO PAGA NADA QUE NO SE PIDA (tanda AS).
 *
 *  Petición del usuario (2026-09-24): *«Los assets ya pagados o no es algo que
 *  tenemos que sacar del código, debe ser configuración y no volver a generar
 *  por defecto mientras estemos en desarrollo, no queremos que recargas
 *  automáticas y pruebas gasten créditos pero cuando estemos en prod sí.»*
 *
 *  El gasto automático que quedaba vivo en desarrollo era el de un SAVE EN
 *  IMAGEN IA: reanudar, viajar o que apareciera un personaje pagaba el arte
 *  que faltase sin que nadie lo pidiera. Desde esta tanda el entorno es del
 *  stack (`NEFAN_ENTORNO`, lo lee el bridge y lo dice en `bridge_hello`), y en
 *  `desarrollo` los gates de core bajan todo `generar` a `restaurar`. Este
 *  guion corre en ese entorno (`export const entorno`) y lo mira como quien
 *  juega, contando en el que PAGA (los contadores del motor falso) y en el
 *  cable (el cuerpo de cada POST):
 *
 *   1 · Partida NUEVA en Imagen IA (escenarios y personajes), con el jugador
 *       vestido desde el título: el tile de entrada PREGUNTA a la librería y
 *       el skin del jugador también, siempre con `resolve_only`; la librería
 *       está vacía, así que el tile se queda en clay y el jugador en y_bot, y
 *       el motor falso no anota ni un pago NI una petición de pintar
 *       (`pintar-superficies` / `pedir-skins`). El chip y el registro dicen
 *       por qué: «solo lo pagado» y el motivo con la variable que lo cambia
 *       (criterio 5).
 *   2 · Un VECINO que llega por el cable (`request_tile`) sigue el mismo trato
 *       que el activo: pregunta y no paga.
 *   3 · Las vías DELIBERADAS pagan igual (criterio 3): la tecla G pinta el
 *       tile activo y el menú dev viste al jugador. Aquí el contador SUBE.
 *   4 · RECARGAR y reanudar: lo que se pagó en 3 VUELVE —el tile texturado, el
 *       skin del jugador listo, que con el permiso en `restaurar` es lo que se
 *       dibuja—, y otra vez sin un pago ni una petición de pintar. El chip y
 *       el registro lo vuelven a decir.
 *
 *  PROBADO EN NEGATIVO (2026-09-24): con el techo quitado en `gatesDeImagen`
 *  (`const techo = true || …`), salen ROJOS los asertos de «ni un pago» de 1,
 *  2 y 4 y los de `resolve_only` — el motor falso anota el atlas y los skins.
 *  Salida en `docs/agents/2026-09-24-tanda-as-generar-arte-es-configuracion/`.
 *
 *  LO QUE NO MIDE: el cruce a pie a otro tile (lo activa `activateByPosition`,
 *  el mismo `onActiveTile` del arranque, que aquí se ejerce al empezar y al
 *  reanudar); los NPC del motor (el jugador es el personaje que este guion
 *  controla; un NPC pasa por el mismo `requestSkin`); y producción, que es el
 *  180.
 *
 *  CERO CRÉDITOS: motor falso. Pide pintar a propósito en 3 (G y el menú dev),
 *  así que no es `sinMotor`.
 */
import { esperarPartidaEnDisco } from "../lib/saves.mjs";
import { nuevaPartida, pedirYEsperarTile, reanudar } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const entorno = "desarrollo";
export const aisla = ["saves", "fake-ai"];

/** Distintivo: ningún NPC del motor falso lo lleva. */
const PROMPT = "herrera tuerta de delantal de cuero (QA-179)";
/** Lo que el cliente dice del techo (`ui/mode-labels.ts`, `MOTIVO_SIN_GENERACION`). */
const MOTIVO = "entorno de desarrollo: solo se restaura lo ya pagado (NEFAN_ENTORNO=produccion para generar)";

async function contadores() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const c = await res.json();
  return { gasto: c.gasto.rutas, puertas: c.ejercicio?.rutas ?? {} };
}
/** Las rutas de pago que son ARTE. `/generate_scene` también cuenta como pago
 *  en el motor falso, pero es la narrativa (el LLM que escribe el tile), no
 *  imagen: la configuración de esta tanda es la del arte, y el tile de la
 *  partida y el del vecino se escriben igual en los dos entornos. */
const ES_ARTE = (ruta) => ruta === "/generate_surface_atlas" || ruta === "/skin_sprite_sheet" || ruta.startsWith("/styles/");

/** Lo que subió cada contador de ARTE desde `antes` (solo lo que se movió). */
function delta(antes, ahora) {
  const de = (a, b) =>
    Object.fromEntries(
      Object.entries(b)
        .map(([k, v]) => [k, v - (a[k] ?? 0)])
        .filter(([k, v]) => v !== 0 && (ES_ARTE(k) || !k.startsWith("/"))),
    );
  return { gasto: de(antes.gasto, ahora.gasto), puertas: de(antes.puertas, ahora.puertas) };
}

/** Todo lo que entra en `#combat-log` desde que carga la página (y tras cada
 *  reload): el registro conserva pocas líneas y el rótulo de gráficos sale
 *  UNA vez por partida. */
function espiarElRegistro() {
  window.__qa179 = [];
  const enganchar = () => {
    const log = document.getElementById("combat-log");
    if (!log) return;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qa179.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enganchar);
  else enganchar();
}

/** Como `comenzar` de `lib/sesion.mjs`, con el skin del jugador escrito en el
 *  editor de personaje (el camino del 156). */
async function comenzarVestido(ctx) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  if (!(await ctx.page.$("#ts-skin"))) return ctx.sinMedir("el editor de personaje no ofrece `#ts-skin`");
  await ctx.page.fill("#ts-skin", PROMPT);
  await ctx.page.click("#ts-start");
  const arrancada = await ctx.waitFor(
    "el juego está en marcha: el título fuera y la escena de la sesión dentro",
    () => {
      if (window.__nefan.status().title || !window.__nefan.status().scene) return null;
      const sessionId = window.__nefan.sesion().sessionId;
      return sessionId ? { sessionId } : null;
    },
    180_000,
  );
  await esperarPartidaEnDisco(ctx, arrancada.sessionId, 180_000);
  return arrancada;
}

/** Quieto: el atlas del activo terminó, el carril de vecinos vacío y la cola
 *  de skins del jugador sin nada pendiente. Devuelve la foto de ESE tick. */
const esperarQuieto = (ctx, desc) =>
  ctx.waitFor(
    desc,
    (prompt) => {
      const n = window.__nefan;
      const f = n.fps();
      if (!f.ready || !f.activeTile || n.status().painting || n.status().restaurando > 0) return null;
      const skin = n.skins.find((s) => s.prompt === prompt);
      if (!skin || skin.queued.some((a) => !skin.ready.includes(a))) return null;
      return {
        activeTile: f.activeTile,
        textured: f.textured,
        tiles: n.tiles,
        skin,
        permiso: n.permisoDeSkins,
        entorno: n.entorno,
        chip: document.getElementById("gfx-chip")?.textContent ?? null,
        chipTitle: document.getElementById("gfx-chip")?.title ?? null,
      };
    },
    90_000,
    PROMPT,
  );

const registro = (ctx) => ctx.page.evaluate(() => window.__qa179 ?? []);

export default async function (ctx) {
  await ctx.page.addInitScript(espiarElRegistro);
  await ctx.page.evaluate(espiarElRegistro);
  /** Cuerpo de cada POST de pago, desde el borde del navegador. */
  const posts = [];
  ctx.page.on("request", (r) => {
    const ruta = ["/generate_surface_atlas", "/skin_sprite_sheet"].find((x) => r.url().includes(x));
    if (r.method() !== "POST" || !ruta) return;
    let body = null;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = null; // sin cuerpo legible no hay resolve_only que leer: cuenta como que PINTA
    }
    posts.push({ ruta, resolveOnly: body?.resolve_only === true });
  });
  const quePintan = (desde) => posts.slice(desde).filter((p) => !p.resolveOnly);
  const deRuta = (desde, ruta) => posts.slice(desde).filter((p) => p.ruta === ruta);

  // ══ 1 · Partida nueva en Imagen IA, en desarrollo ═════════════════════════
  const c1 = await contadores();
  const p1 = posts.length;
  await nuevaPartida(ctx, { renderMode: "image", charMode: "image" });
  const partida = await comenzarVestido(ctx);
  const q1 = await esperarQuieto(ctx, "1 · la partida arranca y termina de preguntar a la librería");
  ctx.log(`1 · ${JSON.stringify(q1)}`);
  ctx.expect(
    "1 · el stack es de DESARROLLO y los skins de una partida en Imagen IA quedan en «restaurar» (ni generar ni base)",
    q1.entorno === "desarrollo" && q1.permiso === "restaurar",
    JSON.stringify({ entorno: q1.entorno, permiso: q1.permiso }),
  );
  ctx.expect(
    "1 · el tile y el skin del jugador PREGUNTARON a la librería (hay POST de los dos) y todos con resolve_only",
    deRuta(p1, "/generate_surface_atlas").length > 0 &&
      deRuta(p1, "/skin_sprite_sheet").length > 0 &&
      quePintan(p1).length === 0,
    JSON.stringify(posts.slice(p1)),
  );
  const d1 = delta(c1, await contadores());
  ctx.expect(
    "1 · el motor falso no anotó NI un pago de arte NI una petición de pintar",
    Object.keys(d1.gasto).length === 0 && Object.keys(d1.puertas).length === 0,
    JSON.stringify(d1),
  );
  ctx.expect(
    "1 · con la librería vacía, el tile se queda en clay y el jugador en y_bot (sin arte, pero SIN fallo)",
    !q1.textured.includes(q1.activeTile) && q1.skin.ready.length === 0 && q1.skin.failed === false,
    JSON.stringify({ textured: q1.textured, skin: q1.skin }),
  );
  ctx.expect(
    "1 · el CHIP dice que solo se restaura lo pagado, y su title el motivo con la variable",
    /solo lo pagado/.test(q1.chip ?? "") && (q1.chipTitle ?? "").includes(MOTIVO),
    JSON.stringify({ chip: q1.chip, title: q1.chipTitle }),
  );
  const reg1 = await registro(ctx);
  ctx.expect(
    "1 · el REGISTRO dice «Gráficos: imagen IA …» con el motivo del entorno",
    reg1.some((l) => l.includes("Gráficos: imagen IA") && l.includes(MOTIVO)),
    JSON.stringify(reg1.filter((l) => l.includes("Gráficos"))),
  );
  await ctx.shot("179-1-desarrollo-en-imagen-ia-sin-pagar");

  // ══ 2 · Un vecino que llega por el cable ══════════════════════════════════
  const [, txS, tyS] = /^tile_(-?\d+)_(-?\d+)$/.exec(q1.activeTile) ?? [];
  if (txS === undefined) ctx.sinMedir(`el tile activo «${q1.activeTile}» no tiene forma tile_<x>_<y>`);
  const vecino = { tx: Number(txS) + 1, ty: Number(tyS) };
  const c2 = await contadores();
  const p2 = posts.length;
  await pedirYEsperarTile(ctx, `tile_${vecino.tx}_${vecino.ty}`, vecino.tx, vecino.ty);
  const q2 = await esperarQuieto(ctx, "2 · el vecino se instala y su restauración termina");
  ctx.expect(
    "2 · el vecino PREGUNTÓ a la librería con resolve_only (hay POST del atlas, ninguno pinta)",
    deRuta(p2, "/generate_surface_atlas").length > 0 && quePintan(p2).length === 0,
    JSON.stringify({ posts: posts.slice(p2), tiles: q2.tiles }),
  );
  const d2 = delta(c2, await contadores());
  ctx.expect("2 · y el motor falso no anotó ningún pago de arte", Object.keys(d2.gasto).length === 0 && Object.keys(d2.puertas).length === 0, JSON.stringify(d2));

  // ══ 3 · Las vías DELIBERADAS pagan ════════════════════════════════════════
  const c3 = await contadores();
  await ctx.page.keyboard.press("g");
  await ctx.expectEspera(
    "3 · la tecla G pinta el tile activo aunque el entorno sea de desarrollo",
    true,
    () => {
      const f = window.__nefan.fps();
      return f.ready && f.textured.includes(f.activeTile) && !window.__nefan.status().painting ? f.activeTile : null;
    },
    { ms: 60_000 },
  );
  await ctx.page.click("#ds-menu-btn");
  await ctx.page.waitForSelector("#dev-menu-items", { state: "visible", timeout: 10_000 });
  const fila = ctx.page.locator("#dev-menu-items .dm-item", { hasText: `Skin: ${PROMPT}` });
  const boton = fila.locator("button");
  await boton.waitFor({ state: "visible", timeout: 15_000 });
  await boton.click(); // armar
  await boton.click(); // confirmar
  await ctx.expectEspera(
    "3 · el menú dev viste al jugador: su skin queda listo (idle)",
    true,
    (prompt) => (window.__nefan.skins.find((s) => s.prompt === prompt)?.ready.includes("idle") ? true : null),
    { ms: 60_000, arg: PROMPT },
  );
  const d3 = delta(c3, await contadores());
  ctx.expect(
    "3 · y ESO sí se paga: el motor falso anota el atlas y el skin",
    (d3.gasto["/generate_surface_atlas"] ?? 0) > 0 && (d3.gasto["/skin_sprite_sheet"] ?? 0) > 0,
    JSON.stringify(d3),
  );
  await ctx.shot("179-3-lo-deliberado-pinta");

  // ══ 4 · Recargar y reanudar: vuelve lo pagado, sin pagar ══════════════════
  const c4 = await contadores();
  const p4 = posts.length;
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) ctx.sinMedir("no se pudo reanudar la partida");
  const { ocurrio: volvio, ultimo: q4 } = await ctx.expectEspera(
    "4 · al reanudar vuelve lo pagado: el tile del jugador texturado y su skin listo",
    true,
    (prompt) => {
      const n = window.__nefan;
      const f = n.fps();
      if (!f.ready || !f.activeTile || n.status().painting || n.status().restaurando > 0) return null;
      const skin = n.skins.find((s) => s.prompt === prompt);
      if (!f.textured.includes(f.activeTile) || !skin?.ready.includes("idle")) return null;
      return {
        activeTile: f.activeTile,
        skin,
        permiso: n.permisoDeSkins,
        chip: document.getElementById("gfx-chip")?.textContent ?? null,
      };
    },
    { ms: 90_000, arg: PROMPT },
  );
  ctx.log(`4 · ${JSON.stringify(q4)}`);
  ctx.expect(
    "4 · con el permiso en «restaurar» (no «base»), el skin listo es el que se DIBUJA: el jugador no vuelve en y_bot",
    volvio && q4.permiso === "restaurar",
    JSON.stringify(q4),
  );
  ctx.expect(
    "4 · reanudar no pidió pintar NADA (todo POST de pago con resolve_only)",
    quePintan(p4).length === 0,
    JSON.stringify(posts.slice(p4)),
  );
  const d4 = delta(c4, await contadores());
  ctx.expect(
    "4 · y el motor falso no anotó NI un pago de arte NI una petición de pintar",
    Object.keys(d4.gasto).length === 0 && Object.keys(d4.puertas).length === 0,
    JSON.stringify(d4),
  );
  ctx.expect(
    "4 · el chip lo sigue diciendo tras reanudar",
    /solo lo pagado/.test(q4?.chip ?? ""),
    JSON.stringify(q4?.chip),
  );
  const reg4 = await registro(ctx);
  ctx.expect(
    "4 · y el registro de la partida reanudada también",
    reg4.some((l) => l.includes("Gráficos: imagen IA") && l.includes(MOTIVO)),
    JSON.stringify(reg4.filter((l) => l.includes("Gráficos"))),
  );
  await ctx.shot("179-4-reanudada-con-lo-pagado");
}
