/** EN DESARROLLO, EL BALANCE DE SKINS CUENTA PERSONAJES Y EL FORZADO NO PAGA
 *  LO LAZY (tanda BA, #755 y #756).
 *
 *  #755: la línea «Skins: …» del registro sumaba una por ANIM. Con cinco
 *  personajes delante decía «15 sin arte pagado», y «anim(s)» es jerga del
 *  gestor. Ahora cuenta PERSONAJES —el skin, uno por prompt, jugador incluido—
 *  y uno ya contado en esta partida no vuelve a salir cuando sus anims lazy
 *  preguntan después.
 *
 *  #756, salida (b): pulsar «Generar» sobre un personaje en el menú dev dejaba
 *  `forzado` puesto, y desde ahí sus anims lazy (ataques, muerte) se PAGABAN
 *  al aparecer, sin aviso y mientras durase la pestaña. Ahora el forzado paga
 *  su set automático (idle/walk/run) y nada más: sus lazy siguen al permiso,
 *  que en desarrollo es `restaurar`. La regla es de core
 *  (`skinPideSoloLoPagado`, junto a `gatesDeImagen`).
 *
 *   1 · Partida nueva en Imagen IA con el jugador vestido, quieta: la suma de
 *       las líneas «Skins:» es el número de prompts distintos que pidió la
 *       partida (`__nefan.skins`), no el de anims, y ninguna dice «anim».
 *   2 · Forzar el skin del jugador desde el menú dev (solo se PULSA): el motor
 *       falso anota exactamente 3 pagos de `/skin_sprite_sheet`.
 *   3 · El jugador ataca: sale un POST de una anim fuera de idle/walk/run con
 *       `resolve_only`, el motor falso no anota ningún pago más, y el balance
 *       no vuelve a contar al jugador.
 *
 *  PROBADO EN NEGATIVO (2026-09-24, a mano, salida en implementacion.md):
 *  - `delSetAutomatico: true` en la llamada de `character-sprites.ts` (el
 *    forzado vuelve a pagarlo todo) → rojos los asertos de 3.
 *  - `cerrarSiVacia` sumando por anim en vez de por personaje → rojo 1.
 *
 *  LO QUE NO MIDE: el «a medias» (restauró alguna anim y otra no), que pide
 *  una librería con arte PARCIAL de un personaje; lo cubre el unitario
 *  `nefan-html/test/el-balance-de-skins-cuenta-personajes.test.ts`. Ni
 *  producción, donde nada cambia (unitario `en-desarrollo-lo-automatico-no-
 *  paga.test.ts`, «…y en producción la lazy genera»).
 *
 *  CERO CRÉDITOS: motor falso. Paga a propósito en 2 (el menú dev).
 */
import { esperarPartidaEnDisco } from "../lib/saves.mjs";
import { nuevaPartida } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const entorno = "desarrollo";
export const aisla = ["saves", "fake-ai"];

/** Distintivo: ningún NPC del motor falso lo lleva. */
const PROMPT = "cazadora de capa remendada y arco corto (QA-194)";
const AUTO = ["idle", "walk", "run"];

async function pagosDeSkins() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  return (await res.json()).gasto.rutas["/skin_sprite_sheet"] ?? 0;
}

/** Todo lo que entra en `#combat-log` (el registro conserva pocas líneas) y
 *  el cuerpo de cada POST de `/skin_sprite_sheet`, apuntados EN la página
 *  para que una espera por condición pueda leerlos. */
function espiar() {
  window.__qa194 = { lineas: [], posts: [] };
  const fetchOriginal = window.fetch;
  window.fetch = (url, init) => {
    if (String(url).includes("/skin_sprite_sheet") && init?.method === "POST") {
      let body;
      try {
        body = JSON.parse(String(init.body ?? "null"));
      } catch {
        body = null; // sin cuerpo legible no hay resolve_only: cuenta como que PAGA
      }
      window.__qa194.posts.push({ prompt: body?.prompt ?? null, anim: body?.anim ?? null, resolveOnly: body?.resolve_only === true });
    }
    return fetchOriginal(url, init);
  };
  const enganchar = () => {
    const log = document.getElementById("combat-log");
    if (!log) return;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qa194.lineas.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enganchar);
  else enganchar();
}

const lineasDeSkins = async (ctx) =>
  (await ctx.page.evaluate(() => window.__qa194.lineas)).filter((l) => l.startsWith("Skins:"));
const posts = (ctx) => ctx.page.evaluate(() => window.__qa194.posts);

/** Cuántos personajes cuenta una línea: la suma de sus números. */
const personajesDe = (linea) => [...linea.matchAll(/(\d+) personajes?/g)].reduce((s, m) => s + Number(m[1]), 0);

/** Sin nada en cola: todos los skins pedidos terminaron de preguntar. */
const esperarQuieto = (ctx, desc) =>
  ctx.waitFor(
    desc,
    (prompt) => {
      const skins = window.__nefan.skins;
      if (!skins.some((s) => s.prompt === prompt)) return null;
      if (skins.some((s) => s.queued.some((a) => !s.ready.includes(a)))) return null;
      return skins;
    },
    90_000,
    PROMPT,
  );

export default async function (ctx) {
  await ctx.page.addInitScript(espiar);
  await ctx.page.evaluate(espiar);

  // ══ 1 · El balance cuenta personajes ══════════════════════════════════════
  await nuevaPartida(ctx, { renderMode: "image", charMode: "image" });
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  if (!(await ctx.page.$("#ts-skin"))) return ctx.sinMedir("el editor de personaje no ofrece `#ts-skin`");
  await ctx.page.fill("#ts-skin", PROMPT);
  await ctx.page.click("#ts-start");
  const arrancada = await ctx.waitFor(
    "el juego está en marcha: el título fuera y la escena de la sesión dentro",
    () => (!window.__nefan.status().title && window.__nefan.status().scene ? window.__nefan.sesion().sessionId : null),
    180_000,
  );
  await esperarPartidaEnDisco(ctx, arrancada, 180_000);
  const skins1 = await esperarQuieto(ctx, "1 · todos los skins de la partida terminaron de preguntar a la librería");
  const permiso = await ctx.page.evaluate(() => window.__nefan.permisoDeSkins);
  ctx.expect("1 · precondición: desarrollo, skins en «restaurar»", permiso === "restaurar", String(permiso));
  const lineas1 = await lineasDeSkins(ctx);
  ctx.log(`1 · skins=${JSON.stringify(skins1.map((s) => s.prompt))} · líneas=${JSON.stringify(lineas1)}`);
  ctx.expect(
    "1 · las líneas «Skins:» suman tantos personajes como prompts distintos pidió la partida (jugador incluido)",
    lineas1.length > 0 && lineas1.reduce((s, l) => s + personajesDe(l), 0) === skins1.length,
    `${lineas1.reduce((s, l) => s + personajesDe(l), 0)} contados · ${skins1.length} skins · ${JSON.stringify(lineas1)}`,
  );
  ctx.expect("1 · y ninguna habla de «anim»", lineas1.every((l) => !/anim/i.test(l)), JSON.stringify(lineas1));
  await ctx.shot("194-1-el-balance-en-personajes");

  // ══ 2 · Forzar el skin del jugador paga su set automático ═════════════════
  const pagos2 = await pagosDeSkins();
  await ctx.page.click("#ds-menu-btn");
  await ctx.page.waitForSelector("#dev-menu-items", { state: "visible", timeout: 10_000 });
  const boton = ctx.page.locator("#dev-menu-items .dm-item", { hasText: `Skin: ${PROMPT}` }).locator("button");
  await boton.waitFor({ state: "visible", timeout: 15_000 });
  await boton.click(); // armar
  await boton.click(); // confirmar
  await ctx.expectEspera(
    "2 · el menú dev viste al jugador: su set automático queda listo",
    true,
    (prompt) => {
      const s = window.__nefan.skins.find((x) => x.prompt === prompt);
      return s && ["idle", "walk", "run"].every((a) => s.ready.includes(a)) ? true : null;
    },
    { ms: 60_000, arg: PROMPT },
  );
  await ctx.page.click("#ds-menu-btn"); // cerrar el menú
  const pagados2 = (await pagosDeSkins()) - pagos2;
  ctx.expect("2 · el motor falso anota EXACTAMENTE 3 pagos de /skin_sprite_sheet (idle, walk, run)", pagados2 === 3, `Δ pagos = ${pagados2}`);

  // ══ 3 · El jugador ataca: su lazy pregunta por lo pagado ══════════════════
  const pagos3 = await pagosDeSkins();
  const p3 = (await posts(ctx)).length;
  const lineas3 = (await lineasDeSkins(ctx)).length;
  // Se pega hasta que el render lleva al jugador a una anim de ataque y
  // `modelFor` pide su hoja: lo que se espera es ESE POST, no un reloj.
  const { ocurrio } = await ctx.expectEspera(
    "3 · al atacar, el jugador pide una anim fuera de su set automático",
    true,
    ({ desde, auto, prompt }) => {
      window.__nefan.inputDriver?.queueAttack();
      const lazy = window.__qa194.posts.slice(desde).filter((p) => p.prompt === prompt && !auto.includes(p.anim));
      return lazy.length > 0 ? lazy : null;
    },
    { ms: 30_000, arg: { desde: p3, auto: AUTO, prompt: PROMPT } },
  );
  if (!ocurrio) return ctx.sinMedirBloque("el ataque no llevó al jugador a ninguna anim lazy");
  // La cadena contesta: esperar a que la cola se vacíe antes de contar pagos.
  await esperarQuieto(ctx, "3 · la lazy del jugador terminó de preguntar");
  const tras = (await posts(ctx)).slice(p3);
  const lazies = tras.filter((p) => p.prompt === PROMPT && !AUTO.includes(p.anim));
  ctx.log(`3 · POST tras atacar: ${JSON.stringify(tras)}`);
  ctx.expect(
    "3 · sale un POST de una anim lazy del jugador, y TODOS con resolve_only",
    lazies.length > 0 && lazies.every((p) => p.resolveOnly),
    JSON.stringify(lazies),
  );
  const pagados3 = (await pagosDeSkins()) - pagos3;
  ctx.expect("3 · el motor falso no anota NINGÚN pago más", pagados3 === 0, `Δ pagos = ${pagados3}`);
  const nuevas = (await lineasDeSkins(ctx)).slice(lineas3);
  ctx.expect(
    "3 · ninguna línea «Skins:» nueva vuelve a contar al jugador",
    nuevas.length === 0,
    JSON.stringify(nuevas),
  );
  await ctx.shot("194-3-el-forzado-ataca-sin-pagar");
}
