/** El desplegable de modelo solo promete hojas completas (#216).
 *
 *  El título ofrecía 7 modelos base escritos a mano (`MIXAMO_MODELS`) de los
 *  que en esta máquina solo `y_bot` tiene el set completo: elegir cualquiera
 *  de los otros caía a la base con una línea de log que nadie ve. La cura es
 *  que OFRECER sea consecuencia de TENER: el dev server publica el censo del
 *  disco (`GET /sprites/index.json`) y el editor deriva el desplegable de
 *  `modelosCompletos` (nefan-core). Este guion recorre los CINCO estados del
 *  editor, que es donde vivía la mentira:
 *
 *   1 · censo real (vector): el desplegable frente al CENSO que el guion
 *       fetch-ea (caza la lista a mano resucitada) y frente al DISCO real —
 *       siembra `__qa_incompleto/` (solo `idle`, copiada de y_bot) y exige
 *       que el censo lo VEA y el desplegable NO lo ofrezca: eso caza un walk
 *       mal escrito, que el ⊆ censo no ve.
 *   2 · censo real (image): el desplegable SE QUEDA con su nota de respaldo
 *       (criterio 5 — QA H2: la decisión estaba tomada pero sin candado).
 *   3 · censo OK y 0 modelos (el clon limpio — QA H1): nota `vacio` con el
 *       remedio (sprite-forge + docs/assets-de-personaje.md), sin select, y
 *       se puede Comenzar (el arranque fail-louda por FALLO_HOJAS_BASE).
 *   4 · censo corrupto (JSON válido que no es un censo — QA H3): degrada con
 *       motivo EN EL IDIOMA DEL JUGADOR, no con la jerga del TypeError.
 *   5 · censo caído (500 — criterio 6): nota inline + entrada en el registro
 *       (el error-log está oculto por CSS durante el título, #246/#306) y se
 *       puede seguir.
 *
 *  NACE ROJO (2026-08-31, medido contra main en 5101bc0): no existe
 *  `/sprites/index.json` (404 del appType mpa) — rojo el primer aserto
 *  («status 404») y el guion corta ahí: sin censo no hay términos que
 *  comparar. Con la implementación, verde entero.
 *
 *  EN NEGATIVO (2026-08-31, cada aserto nuevo con su rojo visto y revertido):
 *   · completar `__qa_incompleto` con las 10 anims → rojo el «NO lo ofrece»
 *     de la fase 1 (entonces está completo de verdad).
 *   · quitar la nota image del editor → rojo el aserto de la fase 2.
 *   · quitar la ruta del doc de la nota vacío → rojo el «nombra el remedio»
 *     de la fase 3.
 *   · quitar el guard de forma del editor → rojo el «habla en el idioma del
 *     jugador» de la fase 4 (vuelve el «Cannot read properties of…»).
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

async function abrirEditor(ctx, charMode = "vector") {
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode });
  await ctx.page.click("#ts-continue");
}

/** Lo que el editor degradado le enseña al jugador (nota, select, Comenzar)
 *  y lo que dejó en el registro. Mismo lector para las fases 3–5. */
function estadoDelEditor(ctx) {
  return ctx.page.evaluate(() => ({
    nota: (document.querySelector("#ts-model-nota")?.textContent ?? "").trim().replace(/\s+/g, " "),
    motivo: document.querySelector("#ts-model-nota")?.dataset.motivo ?? "",
    haySelect: Boolean(document.querySelector("#ts-model")),
    hayComenzar: Boolean(document.querySelector("#ts-start")),
    registro: [...document.querySelectorAll(".error-log__entry")]
      .filter((e) => (e.querySelector(".error-log__source")?.textContent ?? "") === "title")
      .map((e) => e.querySelector(".error-log__msg")?.textContent ?? "")
      .filter((m) => /censo/i.test(m)),
  }));
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

  // UNA route para todas las fases, conmutada por variable: null deja pasar
  // al dev server real; los otros modos fabrican el censo de cada fase. Se
  // instala antes de abrir nada para que ninguna fase dependa del orden de
  // registro de playwright.
  let modoCenso = null; // null | "vacio" | "corrupto" | "roto"
  let requiredReal = null; // capturado del censo real: la fase «vacío» no copia la lista a mano
  await ctx.page.route("**/sprites/index.json", (route) => {
    if (modoCenso === null) return route.continue();
    if (modoCenso === "vacio") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ required: requiredReal, models: [] }),
      });
    }
    if (modoCenso === "corrupto") {
      // JSON perfectamente válido que NO es un censo: la forma que QA usó en
      // su pasada adversarial (H3) y que sin guard pintaba un TypeError.
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "censo roto (simulado por QA)" }),
    });
  });

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
    requiredReal = censo.body.required;

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

    // ── Fase 2 (criterio 5 — QA H2): en modo image el desplegable se queda,
    // con su nota de respaldo. El modelo elegido es lo que se VE mientras el
    // skin IA no llega o si falla (modelFor): ocultarlo costaría una elección
    // viva en cuanto haya un segundo modelo completo.
    await recargarAlTitulo(ctx);
    await abrirEditor(ctx, "image");
    await ctx.page.waitForSelector("#ts-model", { timeout: 30_000 });
    const enImage = await estadoDelEditor(ctx);
    ctx.log(`modo image: ${JSON.stringify({ motivo: enImage.motivo, nota: enImage.nota })}`);
    ctx.expect(
      "en modo image el desplegable sigue, y su nota dice qué papel juega el modelo (respaldo sobre y_bot)",
      enImage.haySelect && enImage.motivo === "image" && /y_bot/i.test(enImage.nota),
      `select: ${enImage.haySelect} · motivo: "${enImage.motivo}" · nota: "${enImage.nota}"`,
    );

    // ── Fase 3 (QA H1): censo OK y 0 modelos — el clon limpio de verdad ───
    // El único estado que hasta esta vuelta solo sujetaba el ojo de QA: en
    // esta máquina y_bot existe, así que ningún guion lo recorría solo.
    modoCenso = "vacio";
    await recargarAlTitulo(ctx);
    await abrirEditor(ctx);
    await ctx.page.waitForSelector('#ts-model-nota[data-motivo="vacio"]', { timeout: 30_000 });
    await ctx.shot("editor-clon-limpio-0-modelos");
    const vacio = await estadoDelEditor(ctx);
    ctx.log(`clon limpio: ${JSON.stringify(vacio)}`);
    ctx.expect(
      "con 0 modelos la nota nombra el remedio (sprite-forge y la receta del doc)",
      /sprite-forge/i.test(vacio.nota) && vacio.nota.includes("docs/assets-de-personaje.md"),
      vacio.nota || "(sin nota)",
    );
    ctx.expect(
      "…sin select que prometa nada, y se puede Comenzar (el arranque ya fail-louda: guion 27)",
      !vacio.haySelect && vacio.hayComenzar,
      `select: ${vacio.haySelect} · comenzar: ${vacio.hayComenzar}`,
    );

    // ── Fase 4 (QA H3): censo corrupto — degrada en el idioma del jugador ──
    modoCenso = "corrupto";
    await recargarAlTitulo(ctx);
    await abrirEditor(ctx);
    await ctx.page.waitForSelector('#ts-model-nota[data-motivo="fallo"]', { timeout: 30_000 });
    const corrupto = await estadoDelEditor(ctx);
    ctx.log(`censo corrupto: ${JSON.stringify(corrupto)}`);
    ctx.expect(
      "un censo corrupto degrada hablando en el idioma del jugador, no en jerga JS",
      /censo/i.test(corrupto.nota) &&
        /y_bot/i.test(corrupto.nota) &&
        !/Cannot read|undefined|TypeError/i.test(corrupto.nota),
      corrupto.nota || "(sin nota)",
    );
    ctx.expect(
      "…y el fallo del censo corrupto queda en el registro (canal)",
      corrupto.registro.length > 0,
      `entradas "title" con "censo": ${corrupto.registro.length}`,
    );

    // ── Fase 5 (criterio 6): el censo se cae (500) y el editor lo DICE ────
    modoCenso = "roto";
    await recargarAlTitulo(ctx);
    await abrirEditor(ctx);
    await ctx.page.waitForSelector('#ts-model-nota[data-motivo="fallo"]', { timeout: 30_000 });
    await ctx.shot("editor-sin-censo");
    const degradado = await estadoDelEditor(ctx);
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
