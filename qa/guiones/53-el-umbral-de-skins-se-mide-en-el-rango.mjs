/** El UMBRAL del cortacircuitos de skins (#236), medido en su rango entero:
 *  1 personaje caído, 2 y 3.
 *
 *  El guion 51 demuestra el criterio de cierre del issue —«con el backend
 *  devolviendo 500 para UN personaje, el resto siguen pidiendo y recibiendo su
 *  skin»— pero solo puede ejercer la mitad de abajo del umbral: el tile de
 *  entrada del motor falso tiene DOS personajes, así que su aserto de
 *  «alcanzado el umbral, se anuncia UNA vez» viaja como condicional
 *  (`fallidos.length >= 3`) sobre una condición que ese escenario nunca
 *  cumple. Media rama del cambio de #236 —justo la que decide que el fusible
 *  de COSTE sigue existiendo— se quedaba sin ocupante, y una rama sin ocupante
 *  no se distingue de una que no funciona.
 *
 *  Aquí el escenario es la fixture commiteada `robledo_tile`, que trae CINCO
 *  vecinos, y el número de personajes que el backend tumba es la variable:
 *
 *    A · 1 caído  → la sesión NO se apaga y los otros cuatro se visten
 *    B · 2 caídos → la sesión NO se apaga y los otros tres se visten
 *    C · 3 caídos → la sesión SÍ se apaga, lo dice UNA vez, y lo dice con el
 *                   número y el umbral dentro (es lo que el jugador lee)
 *    D · sin sabotaje ninguno, con el motor falso tal cual → qué ve un jugador
 *        del banco en una escena de cinco vecinos
 *
 *  DOS CONDICIONES INYECTADAS, las dos en el BORDE (`page.route`), ninguna
 *  dentro del cliente:
 *
 *   1. `500` a las anims de los personajes elegidos como víctimas. Es el
 *      enunciado literal del criterio de cierre del issue.
 *   2. `404` a `walk`/`run` de los DEMÁS (bloques A, B y C). Hace falta para
 *      poder medir: el motor falso solo tiene hoja `idle` y contesta **500** a
 *      `walk`, así que SIN esta máscara los cinco vecinos fallan con error de
 *      backend y el umbral se alcanza solo — la variable que este guion mueve
 *      dejaría de ser la que decide. Un 404 es lo que devuelve el servidor
 *      real ante una anim que no tiene, y el cliente lo trata como lo que es
 *      (`!backendDown`): cancela ESA anim y no cuenta contra el umbral. El
 *      bloque D corre SIN máscara y deja escrito lo que pasa en el banco.
 *
 *  ORDEN QUE IMPORTA, y costó una corrida en rojo: el toggle de personajes IA
 *  se PERSISTE en localStorage (`AICHAR_KEY`, `main.ts:380`), así que a partir
 *  del segundo bloque la recarga de página vuelve con los skins ya encendidos
 *  y la fixture empieza a pedirlos ANTES de que el guion pueda hablar. Por eso
 *  el plan de sabotaje se fija SIEMPRE antes de recargar, y el reparto se lee
 *  una sola vez en una pasada de reconocimiento (con el toggle todavía
 *  apagado, que es como llega un navegador limpio).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, y las peticiones
 *  saboteadas ni le llegan.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): con `UMBRAL_APAGADO_DE_SESION = 1` —el
 *  comportamiento anterior a #236— los bloques A y B se ponen rojos.
 */
import { cargarFixture } from "../lib/fixtures.mjs";

export const aisla = ["saves"];

const FIXTURE = "robledo_tile";
/** El valor que declara `nefan-html/src/renderer/character-sprites.ts`. Se
 *  escribe aquí porque este guion mide el COMPORTAMIENTO en su rango, no la
 *  constante: cambiar una sin la otra tiene que ponerse rojo. */
const UMBRAL = 3;
const APAGADO = /skins IA desactivados para la sesión/g;
const CANCELADA = /skin IA cancelada/g;

/** El texto del registro de errores del cliente, tal y como lo ve el jugador. */
const registro = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");

/** Enciende los skins IA de personaje desde el chip de gráficos, por el camino
 *  del jugador (armar y confirmar). Mismo gesto que el guion 15. */
async function encenderSkins(ctx) {
  await ctx.page.click("#gfx-chip");
  const boton = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /personaje/i })
    .locator(".gfx-seg button")
    .first();
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  if (await boton.isDisabled()) return false;
  await boton.click(); // arma: «¿Confirmar? Gastará créditos»
  await boton.click(); // confirma
  return true;
}

/** Pestaña limpia con la fixture puesta; devuelve las descripciones de sus
 *  vecinos en el orden en que la escena las trae. */
async function pueblo(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, FIXTURE);
  return ctx.page.evaluate(() =>
    (window.__nefan.scene?.npcs ?? []).map((n) => n.description ?? n.name ?? n.id),
  );
}

export default async function (ctx) {
  // El plan de sabotaje es MUTABLE y lo lee el interceptor: una sola ruta
  // registrada para los cuatro bloques, sin re-registrar nada entre recargas.
  const plan = { victimas: [], mascara: true, servidas: 0, caidas: 0, traza: [] };
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let cuerpo = {};
    try {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // Un cuerpo que no es JSON significa que la petición cambió de forma y
      // este guion ya no mide lo que dice: se deja pasar, y el bloque fallará
      // por sus asertos y no por un 500 inventado aquí.
      await route.continue();
      return;
    }
    const prompt = String(cuerpo.prompt ?? "");
    const anim = String(cuerpo.anim ?? "");
    const quien = prompt.slice(0, 20);
    if (plan.victimas.includes(prompt)) {
      plan.caidas++;
      plan.traza.push(`500 ${anim}/${quien}`);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "fallo del proveedor para ESTE personaje (simulado por QA)" }),
      });
      return;
    }
    if (plan.mascara && anim !== "idle") {
      plan.traza.push(`404 ${anim}/${quien}`);
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: `sin hoja para "${anim}" (máscara de QA)` }),
      });
      return;
    }
    plan.servidas++;
    plan.traza.push(`→ ${anim}/${quien}`);
    await route.continue();
  });

  // ── Reconocimiento: quién vive en el pueblo ──────────────────────────────
  // Con el toggle de personajes IA todavía apagado (navegador limpio), así que
  // esta pasada no pide un solo skin y no contamina nada.
  const VECINOS = await pueblo(ctx);
  ctx.log(`vecinos (${VECINOS.length}): ${JSON.stringify(VECINOS)}`);
  ctx.expect(
    "la fixture del pueblo trae al menos cinco vecinos: sin ellos el umbral no se puede recorrer",
    VECINOS.length >= 5,
    `${VECINOS.length} NPC(s): ${JSON.stringify(VECINOS)}`,
  );
  if (VECINOS.length < 5) {
    ctx.sinMedir(
      `la fixture ${FIXTURE} trae ${VECINOS.length} vecinos y hacen falta 5 para tumbar a 3 y ` +
        "dejar sanos a otros dos: el rango del umbral no se puede recorrer",
    );
  }

  /** Prepara y arranca un bloque. El plan se fija ANTES de recargar (ver la
   *  cabecera): con el toggle persistido, la fixture pide skins sola. */
  async function bloque(n, { mascara = true } = {}) {
    plan.victimas = VECINOS.slice(0, n);
    plan.mascara = mascara;
    plan.servidas = 0;
    plan.caidas = 0;
    plan.traza = [];
    await pueblo(ctx);
    ctx.log(`víctimas (${n}): ${JSON.stringify(plan.victimas.map((v) => v.slice(0, 20)))}`);
    const pidiendo = await ctx.page.evaluate(() => window.__nefan.skins.length > 0);
    if (!pidiendo && !(await encenderSkins(ctx))) {
      ctx.sinMedir("el chip de gráficos no deja encender los skins IA (graphics.ai_skin=false)");
    }
    return ctx.waitFor(
      `el juego apunta en su libro a los ${VECINOS.length} vecinos`,
      (k) => (window.__nefan.skins.length >= k ? window.__nefan.skins : null),
      60_000,
      VECINOS.length,
    );
  }

  /** Lo observable al final de un bloque, con el registro que ve el jugador. */
  async function foto(ctx) {
    const libro = await ctx.nefan("skins");
    const texto = await registro(ctx);
    return {
      libro,
      texto,
      vestidos: libro.filter((s) => s.ready.length > 0).length,
      fallidos: libro.filter((s) => s.failed).length,
      apagones: (texto.match(APAGADO) ?? []).length,
      canceladas: (texto.match(CANCELADA) ?? []).length,
    };
  }

  /** Espera a que los vecinos SANOS de este bloque tengan su anim lista. Es la
   *  prueba positiva de que la sesión sigue viva: si el fusible hubiera
   *  saltado, ni siquiera llegarían a pedirla. */
  const sanosVestidos = (ctx, cuantos) =>
    ctx.waitFor(
      `los ${cuantos} vecinos que el backend NO tumba consiguen su skin`,
      (v) => {
        const sanos = window.__nefan.skins.filter((s) => !v.includes(s.prompt));
        return sanos.length >= v.length && sanos.every((s) => s.ready.length > 0) ? sanos : null;
      },
      90_000,
      plan.victimas,
    ).then(() => undefined);

  // ── A · UN personaje caído: la sesión NO se apaga ────────────────────────
  {
    await bloque(1);
    await sanosVestidos(ctx, VECINOS.length - 1);
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(`1 caído · vestidos ${f.vestidos}/${VECINOS.length} · apagones ${f.apagones}`);
    await ctx.shot("umbral-1-caido");
    ctx.expect(
      "con UN personaje caído, los otros cuatro vecinos se visten igual",
      f.vestidos === VECINOS.length - 1,
      `vestidos=${f.vestidos} de ${VECINOS.length} · libro=${JSON.stringify(f.libro)}`,
    );
    ctx.expect(
      "…y la sesión NO se apaga (era el bug: se apagaba al primero)",
      f.apagones === 0,
      f.texto.replace(/\s+/g, " ").slice(0, 300),
    );
  }

  // ── B · DOS personajes caídos: sigue sin apagarse ────────────────────────
  {
    await bloque(2);
    await sanosVestidos(ctx, VECINOS.length - 2);
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(`2 caídos · vestidos ${f.vestidos}/${VECINOS.length} · apagones ${f.apagones}`);
    ctx.expect(
      "con DOS personajes caídos, los otros tres se visten igual",
      f.vestidos === VECINOS.length - 2,
      `vestidos=${f.vestidos} de ${VECINOS.length} · libro=${JSON.stringify(f.libro)}`,
    );
    ctx.expect(
      `…y la sesión sigue SIN apagarse por debajo del umbral (${UMBRAL})`,
      f.apagones === 0,
      f.texto.replace(/\s+/g, " ").slice(0, 300),
    );
  }

  // ── C · TRES caídos: el fusible sigue existiendo, salta y se explica ─────
  {
    await bloque(UMBRAL);
    await ctx.waitFor(
      `con ${UMBRAL} personajes caídos el juego apaga los skins de la sesión y lo dice`,
      () => {
        const t = document.getElementById("error-log")?.textContent ?? "";
        return /skins IA desactivados para la sesión/.test(t) ? t : null;
      },
      90_000,
    );
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(`3 caídos · vestidos ${f.vestidos}/${VECINOS.length} · apagones ${f.apagones}`);
    ctx.log(
      `aviso: ${f.texto.replace(/\s+/g, " ").match(/skins IA desactivados[^|]{0,200}/)?.[0] ?? "(?)"}`,
    );
    await ctx.shot("umbral-3-caidos");
    ctx.expect(
      `alcanzado el umbral (${UMBRAL}), el apagón de sesión se anuncia UNA sola vez`,
      f.apagones === 1,
      `apagones=${f.apagones} · ${f.texto.replace(/\s+/g, " ").slice(0, 400)}`,
    );
    ctx.expect(
      "…y el aviso dice CUÁNTOS personajes cayeron y cuál es el umbral, no solo que algo falló",
      new RegExp(`${UMBRAL} personajes`).test(f.texto) && new RegExp(`umbral ${UMBRAL}`).test(f.texto),
      f.texto.replace(/\s+/g, " ").slice(0, 400),
    );
    ctx.expect(
      "…y dice qué va a ver el jugador (la base y_bot), que es lo accionable",
      /y_bot/.test(f.texto),
      f.texto.replace(/\s+/g, " ").slice(0, 400),
    );
  }

  // ── D · El banco tal cual, sin sabotaje y sin máscara ────────────────────
  // El motor falso solo tiene hoja `idle` y contesta 500 a `walk`, así que
  // TODOS los vecinos fallan con error de backend: el umbral se alcanza sin
  // que nadie sabotee nada. Este bloque no juzga el arreglo — deja MEDIDO lo
  // que ve un jugador del banco en una escena de cinco vecinos, que es un dato
  // que hoy no está escrito en ningún sitio.
  {
    await bloque(0, { mascara: false });
    await ctx.waitFor(
      "el banco llega a su desenlace: o se visten todos, o el fusible salta y lo dice",
      (k) => {
        const l = window.__nefan.skins;
        const t = document.getElementById("error-log")?.textContent ?? "";
        if (/skins IA desactivados para la sesión/.test(t)) return { l, t };
        return l.length >= k && l.every((s) => s.ready.length > 0 || s.failed) ? { l, t } : null;
      },
      90_000,
      VECINOS.length,
    );
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(
      `banco sin máscara · vestidos ${f.vestidos}/${VECINOS.length} · fallidos ${f.fallidos} · ` +
        `apagones ${f.apagones} · canceladas ${f.canceladas} · servidas ${plan.servidas}`,
    );
    await ctx.shot("banco-sin-mascara");
    ctx.expect(
      "en el banco, ni un fallo se queda mudo: cada personaje caído deja SU entrada en el registro",
      f.canceladas === f.fallidos && f.fallidos > 0,
      `canceladas=${f.canceladas} fallidos=${f.fallidos} · ${JSON.stringify(f.libro)}`,
    );
    ctx.expect(
      "…y si el fusible salta, se anuncia UNA sola vez (nunca cero, nunca una tormenta)",
      f.apagones <= 1 && (f.fallidos >= UMBRAL) === (f.apagones === 1),
      `fallidos=${f.fallidos} apagones=${f.apagones} · ${f.texto.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
}
