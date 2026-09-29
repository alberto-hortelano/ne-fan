/** Una poción cura también DESPUÉS de reanudar (#613, pieza D, pasada
 *  adversarial de la QA de la tanda BN).
 *
 *  El 261 bebe en la misma sesión en la que se hirió. Aquí la partida se
 *  cierra herida y se reanuda: el tope de `curarAlJugador` es el
 *  `maxHealth` del combatiente del sim, y al reanudar ese combatiente se
 *  vuelve a crear desde el save (`reseedSimForSession`). Si el máximo que
 *  vuelve no es el de verdad, la barra dice «87 / 100» y la poción no sube
 *  nada — y lo mismo le pasaría a la vida con la que te levanta R.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · se mata al bandido del tile (herirse; su muerte GUARDA la partida con
 *       la vida viva del jugador, #326);
 *   2 · se recarga la página y se reanuda desde el título;
 *   3 · se habla con el tabernero y se bebe una poción (`UNA POCION`, +10);
 *   4 · LA MEDIDA: la vida del HUD pasa a min(antes + 10, máximo del HUD).
 *
 *  Si el jugador sale sin un rasguño o muere, el escenario no existe (⊘).
 *
 *  EN NEGATIVO (QA tanda BN, 2026-09-29): ver `qa.md` de la tanda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, dejarseHerirHasta, herirHasta } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
const MARCA_POCION = "UNA POCION";
const POCION_PV = 10;

const vidaDelHud = (ctx) =>
  ctx.page.evaluate(() => ({
    hp: Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"),
    max: Number((document.getElementById("player-hp-max")?.textContent ?? "").replace(/[^\d.]/g, "")),
  }));

/** El panel de diálogo TERMINADO de pintar: con el typewriter corriendo, la
 *  primera `T` solo completa el texto y no abre la caja (medido en el guion
 *  118, de donde sale esta espera). */
const panelPintado = (ctx) =>
  ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && botones > 0 && texto === d.text ? { botones } : null;
    },
    60_000,
  );

/** Una poción: la marca por el texto libre y esperar a que el motor conteste. */
async function beberUnaPocion(ctx, n) {
  await panelPintado(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    `T abre la caja de texto libre (poción ${n})`,
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  const antes = await ctx.page.evaluate(() => window.__nefan.dialogue().text);
  await ctx.page.keyboard.type(MARCA_POCION);
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFor(
    `el motor contesta a la poción ${n}`,
    (t) => {
      const d = window.__nefan.dialogue();
      return d.visible && d.text && d.text !== t ? true : null;
    },
    60_000,
    antes,
  );
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const { sessionId } = await comenzar(ctx);

  // ── 1 · herirse matando al bandido (su muerte guarda) ───────────────────
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  // Herirse A PROPÓSITO (QA H8 de BN): la pelea sola a veces deja 100/100.
  const herida = await dejarseHerirHasta(ctx, BANDIDO, 90, { sim: 60 });
  if (!herida) ctx.sinMedir("el bandido no hirió al jugador en 60 s de mundo: no hay vida que subir");
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) ctx.sinMedir("el bandido mató al jugador: no es este escenario");
  ctx.expect("el jugador mata al bandido", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;
  const herido = await vidaDelHud(ctx);
  ctx.log(`tras la pelea: ${herido.hp} / ${herido.max}`);
  if (!(herido.hp < herido.max)) ctx.sinMedir(`sin un rasguño (${herido.hp}/${herido.max}): no hay vida que subir`);

  // ── 2 · recargar y reanudar ─────────────────────────────────────────────
  const r = await reanudar(ctx, sessionId);
  if (!r) return;
  await ctx.absorbe(
    "asentar: un segundo de mundo para que el HUD sea el del bridge y no el frame por defecto; la espera no mide nada",
    () => ctx.waitFor("un segundo de mundo tras reanudar", () => null, { sim: 1 }),
  );
  const vuelto = await vidaDelHud(ctx);
  ctx.log(`tras reanudar: ${vuelto.hp} / ${vuelto.max}`);
  ctx.expect("reanuda con la vida con la que se guardó", vuelto.hp === herido.hp, `${vuelto.hp} vs ${herido.hp}`);
  // El MÁXIMO tampoco cambia al reanudar (QA H2 de BN): el reseed lo igualaba
  // a la vida guardada, y desde que el HUD lee el máximo del sim eso se veía
  // como «vida llena» — un ⊘ que tapaba el defecto en vez de un rojo.
  ctx.expect("reanuda con el mismo máximo de vida", vuelto.max === herido.max, `${vuelto.max} vs ${herido.max}`);

  // ── 3 · la poción ───────────────────────────────────────────────────────
  await ctx.waitFor("el tabernero está en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 30_000, TABERNERO);
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);
  const esperada = Math.min(vuelto.hp + POCION_PV, herido.max);
  await beberUnaPocion(ctx, 1);

  // ── 4 · LA MEDIDA ───────────────────────────────────────────────────────
  await ctx.expectEspera(
    `tras reanudar, la poción deja la vida en ${esperada} (de ${vuelto.hp}, +${POCION_PV}, tope ${herido.max})`,
    true,
    (e) => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp === e ? { hp } : null;
    },
    { sim: 2, arg: esperada },
  );
  await ctx.shot("pocion-tras-reanudar");
}
