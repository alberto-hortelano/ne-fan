/** EN DESARROLLO, TAMBIÉN SIN SESIÓN Y EN EL TÍTULO: SOLO LO PAGADO (QA de la tanda AS).
 *
 *  El 179 mide la petición del usuario en PARTIDA («no volver a generar por
 *  defecto mientras estemos en desarrollo»). Este guion, escrito por QA al
 *  validar la tanda, mira los dos estados del sistema que el 179 no visita y
 *  donde el techo también tiene que valer:
 *
 *   1 · FIXTURE SIN SESIÓN (el selector «Room», preset `cliente-web`): no hay
 *       partida, así que el permiso de skins sale del toggle LOCAL del chip,
 *       que nace OFF. Encenderlo es un gesto del jugador, pero lo que dispara
 *       —los skins de TODOS los NPC descritos de la fixture— es un camino
 *       automático (`rePedirTodosLosSkins`), y en desarrollo tiene que
 *       preguntar solo por lo pagado: el permiso queda en `restaurar` (nunca
 *       `generar`), todo POST de skin lleva `resolve_only`, el motor falso no
 *       anota ni un pago ni una petición de pintar, y la nota del panel, el
 *       botón de confirmar y el chip lo dicen.
 *   2 · EL TÍTULO: el `bridge_hello` llega ANTES de que la lista de saves sea
 *       usable (la lista viaja por el mismo socket, después del hello), así
 *       que el badge de modo de una tarjeta, al armarse, promete lo que va a
 *       pasar: «¿Confirmar? Solo lo ya pagado», no «Gastará créditos».
 *
 *  Y LOS TEXTOS DE ANTES DE ELEGIR (H1 de la QA de la tanda AS, que al nacer
 *  este guion solo se registraban): el subtexto de la opción «Skins IA» del
 *  panel del chip, el selector de mundos del título y el tooltip del badge no
 *  dicen «gasta créditos» ni «pinta cada zona» en desarrollo. Salen de
 *  `loQuePagaImagenIA` (core), el mismo dato que decide el POST (H2).
 *
 *  PROBADO EN NEGATIVO (2026-09-24, QA): con el techo quitado en
 *  `gatesDeImagen` (`const techo = true || …`), salen ROJOS los asertos de
 *  `restaurar`, de `resolve_only` y de «ni un pago» del bloque 1 (el falso
 *  anota los skins de la fixture).
 *
 *  LO QUE NO MIDE: producción (180), la partida (179), y el preset
 *  `html-fixtures` SIN bridge (ahí no hay `bridge_hello`; el cliente cae al
 *  defecto `desarrollo` y no hay a quién preguntarle por el gasto).
 *
 *  CERO CRÉDITOS: motor falso. Enciende el toggle de skins a propósito, así
 *  que no es `sinMotor`.
 */
import { cargarFixture } from "../lib/fixtures.mjs";
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const entorno = "desarrollo";
export const aisla = ["saves", "fake-ai"];

const FIXTURE = "robledo_tile";
/** Lo que el cliente dice del techo (`ui/mode-labels.ts`, `MOTIVO_SIN_GENERACION`). */
const MOTIVO = "entorno de desarrollo: solo se restaura lo ya pagado (NEFAN_ENTORNO=produccion para generar)";

async function contadores() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const c = await res.json();
  return { gasto: c.gasto.rutas, puertas: c.ejercicio?.rutas ?? {} };
}
const ES_ARTE = (ruta) => ruta === "/generate_surface_atlas" || ruta === "/skin_sprite_sheet";
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

/** El botón «Imagen IA» de la fila de personajes del panel del chip, y lo que
 *  dice: su rótulo grande (`.gfx-label`, el que se arma) y el subtexto. */
const botonSkinsIa = (ctx) =>
  ctx.page.locator("#gfx-panel .gfx-row", { hasText: /personaje/i }).locator(".gfx-seg button").first();
const textosDelBoton = (btn) =>
  btn.evaluate((b) => ({
    label: b.querySelector(".gfx-label")?.textContent ?? null,
    sub: b.querySelector(".gfx-sub")?.textContent ?? null,
    disabled: b.disabled,
  }));

export default async function (ctx) {
  /** Cuerpo de cada POST de pago, desde el borde del navegador. */
  const posts = [];
  ctx.page.on("request", (r) => {
    const ruta = ["/generate_surface_atlas", "/skin_sprite_sheet"].find((x) => r.url().includes(x));
    if (r.method() !== "POST" || !ruta) return;
    let body;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = null; // sin cuerpo legible no hay resolve_only que leer: cuenta como que PINTA
    }
    posts.push({ ruta, resolveOnly: body?.resolve_only === true });
  });

  // ══ 1 · Fixture sin sesión, en desarrollo ═════════════════════════════════
  await ctx.waitFor("el título aparece al arrancar", () => window.__nefan?.status().title === true);
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);
  await cargarFixture(ctx, FIXTURE);
  const c1 = await contadores();
  const p1 = posts.length;
  const antes = await ctx.page.evaluate(() => ({
    entorno: window.__nefan.entorno,
    permiso: window.__nefan.permisoDeSkins,
    skins: window.__nefan.skins.length,
    chip: document.getElementById("gfx-chip")?.textContent ?? null,
  }));
  ctx.log(`1 · con la fixture puesta: ${JSON.stringify(antes)}`);
  ctx.expect(
    "1 · sin sesión el bridge ya dijo su entorno (desarrollo) y el toggle local nace OFF: permiso «base», ningún skin pedido",
    antes.entorno === "desarrollo" && antes.permiso === "base" && antes.skins === 0 && posts.length === p1,
    JSON.stringify(antes),
  );

  // El toggle, por el chip, como quien juega (dos clicks: armar y confirmar).
  await ctx.page.evaluate(() => document.getElementById("gfx-chip")?.click());
  await ctx.page.waitForSelector("#gfx-panel", { state: "visible", timeout: 10_000 });
  const nota = await ctx.page.$eval("#gfx-panel .gfx-note", (e) => e.textContent ?? "");
  ctx.expect(
    "1 · la nota del panel dice que no hay partida (fixtures) Y el motivo del techo con la variable",
    /Sin partida/.test(nota) && nota.includes(MOTIVO),
    JSON.stringify(nota),
  );
  const btn = botonSkinsIa(ctx);
  const reposo = await textosDelBoton(btn);
  if (reposo.disabled) ctx.sinMedir("el botón «Skins IA» está deshabilitado (graphics.ai_skin apagado): no hay toggle que medir");
  await btn.click(); // armar
  const armado = await textosDelBoton(btn);
  ctx.log(`1 · botón Skins IA — en reposo ${JSON.stringify(reposo)} · armado ${JSON.stringify(armado)}`);
  ctx.expect(
    "1 · al armar el toggle, el botón promete lo que va a pasar: «Solo lo ya pagado», no «Gastará créditos»",
    armado.label === "¿Confirmar? Solo lo ya pagado",
    JSON.stringify(armado),
  );
  await btn.click(); // confirmar
  const q1 = await ctx.waitFor(
    "1 · los NPC de la fixture terminan de preguntar por su skin",
    () => {
      const n = window.__nefan;
      if (n.permisoDeSkins === "base" || n.skins.length === 0) return null;
      if (n.skins.some((s) => s.queued.some((a) => !s.ready.includes(a)))) return null;
      return {
        permiso: n.permisoDeSkins,
        skins: n.skins,
        chip: document.getElementById("gfx-chip")?.textContent ?? null,
        chipTitle: document.getElementById("gfx-chip")?.title ?? null,
      };
    },
    60_000,
  );
  ctx.log(`1 · tras confirmar: ${JSON.stringify(q1)}`);
  ctx.expect(
    "1 · el permiso sube a «restaurar» y no a «generar»: en desarrollo el toggle local no puede pagar",
    q1.permiso === "restaurar",
    JSON.stringify({ permiso: q1.permiso }),
  );
  const deSkin = posts.slice(p1).filter((p) => p.ruta === "/skin_sprite_sheet");
  ctx.expect(
    "1 · los NPC descritos PREGUNTARON (hay POST de skin) y todos con resolve_only",
    deSkin.length > 0 && deSkin.every((p) => p.resolveOnly),
    JSON.stringify(deSkin),
  );
  const d1 = delta(c1, await contadores());
  ctx.expect(
    "1 · el motor falso no anotó NI un pago de arte NI una petición de pintar",
    Object.keys(d1.gasto).length === 0 && Object.keys(d1.puertas).length === 0,
    JSON.stringify(d1),
  );
  ctx.expect(
    "1 · sin arte pagado, ningún NPC queda como fallo (siguen en y_bot, sin fusible)",
    q1.skins.every((s) => s.failed === false && s.ready.length === 0),
    JSON.stringify(q1.skins),
  );
  ctx.expect(
    "1 · el chip dice «solo lo pagado» y su title trae el motivo",
    /solo lo pagado/.test(q1.chip ?? "") && (q1.chipTitle ?? "").includes(MOTIVO),
    JSON.stringify({ chip: q1.chip, title: q1.chipTitle }),
  );
  ctx.expect(
    "1 · el subtexto de la opción «Skins IA» dice «solo lo ya pagado», no «gasta créditos» (H1)",
    /solo lo ya pagado/.test(reposo.sub ?? "") && !/gasta créditos/.test(reposo.sub ?? ""),
    JSON.stringify(reposo.sub),
  );
  await ctx.shot("181-1-fixture-sin-sesion-solo-lo-pagado");

  // ══ 2 · El título: el hello llega antes que la lista, y el badge lo dice ══
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", renderMode: "vector", charMode: "vector" });
  const selector = await ctx.page.$eval("#ts-rendermode [data-rendermode=\"image\"]", (e) => e.innerText);
  ctx.log(`2 · lo que el selector de mundos dice de «Imagen IA»: ${JSON.stringify(selector)}`);
  const selectorSkins = await ctx.page.$eval("#ts-charmode [data-charmode=\"image\"]", (e) => e.innerText);
  ctx.expect(
    "2 · el selector de mundos no promete que se pinte ni que se gaste: en desarrollo solo se restaura lo pagado (H1)",
    [selector, selectorSkins].every((t) => /solo lo ya pagado/.test(t) && !/gasta créditos|pinta cada zona/.test(t)),
    JSON.stringify({ selector, selectorSkins }),
  );
  const { sessionId } = await comenzar(ctx);
  await recargarAlTitulo(ctx);
  const enElTitulo = await ctx.page.evaluate(
    (sid) => {
      const b = document.querySelector(`button[data-mode-facet="scenes"][data-session-id="${sid}"]`);
      return { entorno: window.__nefan.entorno, badge: b ? { text: (b.textContent ?? "").trim(), title: b.title } : null };
    },
    sessionId,
  );
  ctx.log(`2 · en el título: ${JSON.stringify(enElTitulo)}`);
  ctx.expect(
    "2 · el tooltip del badge del save dice «solo lo ya pagado», no «gasta créditos» (H1)",
    /solo lo ya pagado/.test(enElTitulo.badge?.title ?? "") && !/gasta créditos/.test(enElTitulo.badge?.title ?? ""),
    JSON.stringify(enElTitulo.badge),
  );
  ctx.expect(
    "2 · con la lista de saves ya pintada, el entorno del bridge ya ha llegado (el hello va antes que la lista)",
    enElTitulo.entorno === "desarrollo" && enElTitulo.badge !== null,
    JSON.stringify(enElTitulo),
  );
  await ctx.page.click(`button[data-mode-facet="scenes"][data-session-id="${sessionId}"]`); // armar
  const armadoEnTitulo = await ctx.page.$eval(
    `button[data-mode-facet="scenes"][data-session-id="${sessionId}"]`,
    (b) => (b.textContent ?? "").trim(),
  );
  ctx.expect(
    "2 · el badge armado del save promete «Solo lo ya pagado», no «Gastará créditos»",
    armadoEnTitulo === "¿Confirmar? Solo lo ya pagado",
    JSON.stringify(armadoEnTitulo),
  );
  await ctx.shot("181-2-titulo-badge-solo-lo-pagado");
}
