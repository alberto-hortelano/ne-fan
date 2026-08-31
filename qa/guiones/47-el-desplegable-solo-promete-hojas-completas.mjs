/** El desplegable de modelo solo promete hojas completas (#216).
 *
 *  El título ofrecía 7 modelos base escritos a mano (`MIXAMO_MODELS`) de los
 *  que en esta máquina solo `y_bot` tiene el set completo: elegir cualquiera
 *  de los otros caía a la base con una línea de log que nadie ve. La cura es
 *  que OFRECER sea consecuencia de TENER: el dev server publica el censo del
 *  disco (`GET /sprites/index.json`) y el editor deriva el desplegable de
 *  `modelosCompletos` (nefan-core). Este guion pone ese desplegable frente a
 *  las dos verdades a la vez:
 *
 *   · frente al CENSO que él mismo fetch-ea — caza un desplegable que no se
 *     derive de él (la lista a mano resucitada);
 *   · frente al DISCO real — siembra `__qa_incompleto/` (solo `idle`, copiada
 *     de y_bot) y exige que el censo lo VEA y el desplegable NO lo ofrezca:
 *     eso es lo que caza un walk mal escrito, que las opciones ⊆ censo no ve.
 *
 *  Y la fase 2 es el criterio 6: si el censo no contesta, el editor degrada
 *  DICIÉNDOLO (nota inline + entrada en el registro), porque el error-log
 *  está oculto por CSS mientras el título está delante (#246/#306).
 *
 *  NACE ROJO (2026-08-31, medido contra main en 5101bc0): no existe
 *  `/sprites/index.json` (404 del appType mpa) — rojo el primer aserto
 *  («status 404») y el guion corta ahí: sin censo no hay términos que
 *  comparar, así que el ⊆ ni se mide (la lista de 7 seguía ofrecida, pero
 *  este guion lo dice con un solo rojo honesto, no con cuatro derivados).
 *  Con la implementación, verde entero.
 *
 *  EN NEGATIVO (2026-08-31): completando `__qa_incompleto` con las 10 anims
 *  (meta.json de cada una) el aserto «NO ofrece __qa_incompleto» se pone
 *  rojo — el desplegable lo ofrece porque ENTONCES está completo de verdad.
 *  Revertido: la siembra vuelve a ser solo `idle`.
 *
 *  El directorio sembrado vive dentro de `nefan-html/public/sprites/`, que
 *  está entero en .gitignore: no puede colarse en un commit. Se limpia antes
 *  (restos de una corrida muerta) y en `finally`.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";

// SIN exención del guardarraíl (#295) a propósito: este guion pulsa
// «Continuar» (#ts-continue), y el candado del guion 39 prohíbe ese click a
// cualquier exento — con razón: la lista de exenciones envejece y estirarla
// para un caso «seguro» es como se pudre. Este guion no genera nada (nunca
// pulsa #ts-start), así que pasa por el gate de créditos del runner como
// cualquier otro y no le cuesta nada.

const here = dirname(fileURLToPath(import.meta.url));
const SPRITES = join(here, "..", "..", "nefan-html", "public", "sprites");
const SEMBRADO = join(SPRITES, "__qa_incompleto");

/** ¿Tiene `modelo` el set completo EN DISCO? La exigencia (anims y ángulo) es
 *  la del censo, no una copia local: si el censo mintiera sobre lo exigido,
 *  este contraste con el disco es quien lo dice. */
function completoEnDisco(modelo, required) {
  return required.anims.every((a) =>
    existsSync(join(SPRITES, modelo, a, required.angle, "meta.json")),
  );
}

async function abrirEditor(ctx) {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await ctx.page.click("#ts-continue");
}

export default async function (ctx) {
  // Siembra: un modelo REAL en disco con una sola anim (idle copiada de
  // y_bot, meta.json y frames incluidos). Limpieza previa por si una corrida
  // muerta lo dejó atrás.
  rmSync(SEMBRADO, { recursive: true, force: true });
  const idleDeYbot = join(SPRITES, "y_bot", "idle");
  if (!existsSync(idleDeYbot)) {
    ctx.sinMedir(
      "no hay y_bot/idle en nefan-html/public/sprites/ — sin un modelo completo " +
        "en disco no hay contraste que medir (genera las hojas: docs/assets-de-personaje.md)",
    );
  }
  cpSync(idleDeYbot, join(SEMBRADO, "idle"), { recursive: true });

  try {
    // ── Fase 1: el desplegable frente al censo y frente al disco ──────────
    await abrirEditor(ctx);
    await ctx.page.waitForSelector("#ts-model", { timeout: 30_000 });
    await ctx.shot("editor-con-censo");

    const censo = await ctx.page.evaluate(async () => {
      const res = await fetch("/sprites/index.json");
      return { status: res.status, body: res.ok ? await res.json() : null };
    });
    ctx.expect(
      "el dev server publica el censo de hojas (GET /sprites/index.json → 200)",
      censo.status === 200 && Boolean(censo.body?.required?.anims?.length),
      `status ${censo.status}`,
    );
    if (!censo.body) return; // sin censo no hay términos que comparar: ya está el rojo de arriba

    const opciones = await ctx.page.$$eval("#ts-model option", (els) => els.map((e) => e.value));
    const completosSegunCenso = censo.body.models
      .filter((m) => censo.body.required.anims.every((a) => m.anims.includes(a)))
      .map((m) => m.id);
    ctx.log(`censo: ${JSON.stringify(censo.body.models.map((m) => `${m.id}(${m.anims.length})`))}`);
    ctx.log(`desplegable: ${JSON.stringify(opciones)} · completos según censo: ${JSON.stringify(completosSegunCenso)}`);

    ctx.expect(
      "cada opción del desplegable está COMPLETA según el censo (no hay lista a mano)",
      opciones.length > 0 && opciones.every((id) => completosSegunCenso.includes(id)),
      `ofrece ${JSON.stringify(opciones)} y el censo solo completa ${JSON.stringify(completosSegunCenso)}`,
    );

    // El contraste con el DISCO, que el ⊆ de arriba no ve: si el walk del
    // censo mintiera (un modelo completo que no lista, un incompleto que da
    // por completo), sería el censo entero el que miente con el desplegable
    // detrás. y_bot está completo en disco (precondición ya afirmada) y el
    // sembrado no — lo dice la siembra y se re-mide aquí.
    ctx.expect(
      "y_bot, completo en disco, se ofrece",
      completoEnDisco("y_bot", censo.body.required) && opciones.includes("y_bot"),
      `en disco: ${completoEnDisco("y_bot", censo.body.required)} · ofrecido: ${opciones.includes("y_bot")}`,
    );
    const sembradoEnCenso = censo.body.models.find((m) => m.id === "__qa_incompleto");
    ctx.expect(
      "el censo VE al modelo incompleto sembrado (el walk no se lo salta)",
      Boolean(sembradoEnCenso) && sembradoEnCenso.anims.length > 0,
      JSON.stringify(sembradoEnCenso ?? "(no aparece en el censo)"),
    );
    ctx.expect(
      "…y el desplegable NO lo ofrece (incompleto en disco: solo idle)",
      !completoEnDisco("__qa_incompleto", censo.body.required) && !opciones.includes("__qa_incompleto"),
      `en disco completo: ${completoEnDisco("__qa_incompleto", censo.body.required)} · ofrecido: ${opciones.includes("__qa_incompleto")}`,
    );

    // ── Fase 2 (criterio 6): el censo se cae y el editor lo DICE ──────────
    await ctx.page.route("**/sprites/index.json", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "censo roto (simulado por QA)" }),
      }),
    );
    await recargarAlTitulo(ctx);
    await abrirEditor(ctx);
    await ctx.page.waitForSelector('#ts-model-nota[data-motivo="fallo"]', { timeout: 30_000 });
    await ctx.shot("editor-sin-censo");

    const degradado = await ctx.page.evaluate(() => ({
      nota: (document.querySelector('#ts-model-nota[data-motivo="fallo"]')?.textContent ?? "").trim(),
      haySelect: Boolean(document.querySelector("#ts-model")),
      hayComenzar: Boolean(document.querySelector("#ts-start")),
      registro: [...document.querySelectorAll(".error-log__entry")]
        .filter((e) => (e.querySelector(".error-log__source")?.textContent ?? "") === "title")
        .map((e) => e.querySelector(".error-log__msg")?.textContent ?? "")
        .filter((m) => /censo/i.test(m)),
    }));
    ctx.log(`degradado: ${JSON.stringify(degradado)}`);
    ctx.expect(
      "sin censo, la nota inline dice el fallo y a qué se degrada (y_bot)",
      /censo/i.test(degradado.nota) && /y_bot/i.test(degradado.nota),
      degradado.nota || "(sin nota)",
    );
    ctx.expect(
      "…el fallo también queda en el registro de errores (canal, no solo pantalla)",
      degradado.registro.length > 0,
      `entradas "title" con "censo": ${degradado.registro.length}`,
    );
    ctx.expect(
      "…no se ofrece un desplegable que no puede decir la verdad, y se puede seguir (Comenzar sigue ahí)",
      !degradado.haySelect && degradado.hayComenzar,
      `select: ${degradado.haySelect} · comenzar: ${degradado.hayComenzar}`,
    );
  } finally {
    rmSync(SEMBRADO, { recursive: true, force: true });
  }
}
