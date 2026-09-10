/** LA PREGUNTA DE LA FRONTERA VUELVE DESPUÉS DE UNA CONVERSACIÓN.
 *
 *  Hallazgo del ingeniero al sacar el HUD de la frontera de `main.ts` (#515),
 *  y es el defecto de siempre con otra ropa: DOS representaciones de «esto está
 *  oculto» que nadie obliga a coincidir.
 *
 *  Mientras hay un diálogo abierto, el bucle no llama a la frontera, así que la
 *  pregunta de explorar se quedaría congelada en pantalla con unas teclas que
 *  ya no responden — hay que retirarla. Se retiraba con un
 *  `tileConfirmPromptEl.style.display = "none"` escrito en el bucle de
 *  `main.ts`, y NADIE volvía a quitarlo: `grep style.display main.ts` daba ese
 *  único acierto. Un estilo en línea gana al atributo `hidden`, que es el canal
 *  por el que la frontera pone y quita su panel, así que **tras la primera
 *  conversación de la partida la propuesta de explorar no se volvía a ver
 *  nunca**. El jugador llegaba al muro, leía el velo y no tenía nada que
 *  pulsar; la `Y` seguía viva —el proveedor de teclado la deriva de la
 *  propuesta de core, no del DOM—, o sea que la única forma de gastar era
 *  adivinar la tecla.
 *
 *  Hoy el silencio del diálogo va por el MISMO canal con el que se pone
 *  (`hidden`), en `ui/frontera-en-pantalla.ts`, y el frame siguiente lo
 *  deshace solo.
 *
 *  Se mide con el TECLADO real y por el camino del jugador: se anda hasta que
 *  el juego propone, se habla con el tabernero, se cierra, se vuelve al borde.
 *  Ni un `display` forzado, ni una propuesta inyectada.
 *
 *  Cero créditos: motor falso, `charMode: "vector"`, y ni una `Y` en todo el
 *  guion — no se pide un solo tile.
 */

import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

// `mundo` además de `saves` y `fake-ai`: este guion necesita un borde SIN
// generar para que el juego proponga explorar, y con el snapshot de mundo
// pre-generado en disco el vecino ya está instalado al arrancar la partida —
// entonces no hay propuesta y no hay panel que mirar. Es la misma precondición
// del 109, y sin declararla el guion depende de que el 109 corra justo antes.
export const aisla = ["saves", "mundo", "fake-ai"];

const NPC = "barkeep";
/** Un paso al este del NPC, como el guion 83. */
const A_UN_PASO = 1.2;

/** Lo que el jugador ve del panel de la pregunta: si está en pantalla y con
 *  qué texto. Se mira el `display` COMPUTADO y no el atributo `hidden`, porque
 *  el defecto era justo un estilo en línea que ganaba al atributo: preguntar
 *  por `hidden` habría salido verde con el panel invisible. */
const laPregunta = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("tile-confirm-prompt");
    if (!el) return { existe: false };
    const cs = getComputedStyle(el);
    return {
      existe: true,
      display: cs.display,
      inline: el.style.display,
      hidden: el.hidden,
      visible: cs.display !== "none" && el.offsetWidth > 0,
      texto: (document.getElementById("tile-confirm-text")?.textContent ?? "").trim(),
      botones: [...document.querySelectorAll("#tile-confirm-actions button")].map((b) =>
        (b.textContent ?? "").trim(),
      ),
    };
  });

async function frames(ctx, n) {
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  return ctx.waitFor(
    `el bucle avanza ${n} fotograma(s)`,
    (m) => {
      const f = window.__nefan.fps()?.frames ?? 0;
      return f >= m.desde + m.n ? { f } : null;
    },
    20_000,
    { desde, n },
  );
}

/** E con el teclado REAL, cuatro fotogramas (el bucle la consume por frame). */
async function pulsarE(ctx) {
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
}

/** El bandido del turno 2 del motor falso pega: si el jugador cae, R. Andar
 *  con el jugador muerto no es andar, y este guion mide un paseo. */
async function revivirSiHaceFalta(ctx) {
  const vida = await ctx.page.evaluate(() =>
    Number(document.getElementById("player-hp-text")?.textContent ?? 1),
  );
  if (vida > 0) return;
  await ctx.page.keyboard.press("r");
  await ctx.waitFor(
    "el jugador revive (R)",
    () => (Number(document.getElementById("player-hp-text")?.textContent ?? 0) > 0 ? { vivo: true } : null),
    15_000,
  );
}

/** Se planta junto al tabernero y espera a que el juego ofrezca hablar. */
async function plantarseJuntoAlNpc(ctx) {
  await revivirSiHaceFalta(ctx);
  const npc = await ctx.waitFor(
    `el NPC ${NPC} está en el mundo`,
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    30_000,
    NPC,
  );
  await ctx.nefan("setPlayerPos", npc.pos.x + A_UN_PASO, npc.pos.z);
  await ctx.waitFor(
    `el juego ofrece hablar con ${NPC}`,
    () => document.querySelector('#interact-prompt [data-action="interact"]')?.textContent ?? null,
    30_000,
  );
}

/** Anda al este hasta que el juego PROPONE explorar. Devuelve la propuesta. */
async function andarHastaLaPropuesta(ctx, maxMs = 120_000) {
  await ctx.page.keyboard.down("w");
  try {
    const { ocurrio, ultimo } = await ctx.expectEspera(
      "andando hacia el borde, el juego PROPONE generar la zona vecina",
      true,
      () => window.__nefan.frontier.proposal ?? null,
      { ms: maxMs },
    );
    return ocurrio ? ultimo : null;
  } finally {
    await ctx.page.keyboard.up("w");
  }
}

export default async function (ctx) {
  // ── 0 · Teclado real: la propuesta y la `E` viven ahí ────────────────────
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor("el mundo está pintado", () => window.__nefan.ready());

  const plano = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    return { origin: g?.origin ?? null, mpc: g?.meters_per_cell ?? null, cols: g?.grid?.[0]?.length ?? 0 };
  });
  if (!Number.isFinite(plano.mpc) || !Array.isArray(plano.origin) || plano.cols === 0) {
    return ctx.sinMedir(`el grid del tile no da origen/paso: ${JSON.stringify(plano)}`);
  }
  const bordeEste = plano.origin[0] + plano.cols * plano.mpc;

  // ── 1 · La pregunta se ve ANTES de hablar con nadie ──────────────────────
  await ctx.nefan("setPlayerPos", bordeEste - 19, 0);
  await ctx.nefan("setYaw", Math.PI / 2);
  await frames(ctx, 4);
  const primera = await andarHastaLaPropuesta(ctx);
  if (!primera) return ctx.sinMedir("sin propuesta no hay pregunta que medir");
  const antes = await laPregunta(ctx);
  ctx.log(`la pregunta antes de hablar: ${JSON.stringify(antes)}`);
  ctx.expect(
    "el juego pone la pregunta de explorar EN PANTALLA, con sus dos salidas",
    antes.visible && antes.botones.length === 2 && antes.texto.length > 0,
    JSON.stringify(antes),
  );
  await ctx.shot("pregunta-antes-de-hablar");

  // ── 2 · Con el diálogo abierto se RETIRA (sus teclas quedan mudas) ───────
  await plantarseJuntoAlNpc(ctx);
  await pulsarE(ctx);
  await ctx.waitFor(
    "el NPC contesta y el panel de diálogo se abre",
    () => (window.__nefan.dialogue().visible ? window.__nefan.dialogue() : null),
    120_000,
  );
  await frames(ctx, 4);
  const hablando = await laPregunta(ctx);
  ctx.log(`la pregunta con el diálogo abierto: ${JSON.stringify(hablando)}`);
  ctx.expect(
    "mientras se conversa, la pregunta de explorar NO se queda en pantalla con las teclas mudas",
    !hablando.visible,
    JSON.stringify(hablando),
  );

  // ── 3 · Cerrado el diálogo, VUELVE al acercarse otra vez al borde ────────
  await ctx.nefan("advanceDialogue");
  await ctx.waitFor(
    "el panel de diálogo se cierra",
    () => (!window.__nefan.dialogue().visible ? { cerrado: true } : null),
    20_000,
  );
  await revivirSiHaceFalta(ctx);
  await ctx.nefan("setPlayerPos", bordeEste - 19, 0);
  await ctx.nefan("setYaw", Math.PI / 2);
  await frames(ctx, 4);
  const segunda = await andarHastaLaPropuesta(ctx);
  if (!segunda) return ctx.sinMedirBloque("el juego no vuelve a proponer: sin propuesta no hay panel que mirar");
  const despues = await laPregunta(ctx);
  ctx.log(`la pregunta después de hablar: ${JSON.stringify(despues)}`);
  ctx.expect(
    "tras la conversación, la propuesta de explorar VUELVE a verse (era la única forma de gastar sin adivinar la tecla)",
    despues.visible && despues.botones.length === 2,
    JSON.stringify(despues),
  );
  ctx.expect(
    "…y no queda ningún estilo en línea decidiendo por su cuenta si el panel se ve",
    despues.inline === "",
    `style.display = ${JSON.stringify(despues.inline)}`,
  );
  await ctx.shot("pregunta-despues-de-hablar");

  ctx.expect(
    "en todo el guion no se ha pedido un solo tile: mirar la pregunta no gasta",
    (await ctx.page.evaluate(() => window.__nefan.frontier.requested)).length === 0,
    JSON.stringify(await ctx.page.evaluate(() => window.__nefan.frontier)),
  );
}
