/** Una partida guardada con el jugador CAÍDO se puede reanudar y despertar
 *  (#613, pasada adversarial de la QA de la tanda BN; adaptado a «que decida
 *  el motor»).
 *
 *  En la QA de BN esto era ROJO por dos lados (H3): un muerto podía viajar por
 *  «Salidas» —y el viaje guardaba la partida con 0 PV en otro sitio—, y al
 *  reanudar no se ofrecía R y, pulsándola igual, «Respawned!» con 0/100: la
 *  partida quedaba inservible. Hoy la muerte se guarda sola, un caído no viaja
 *  (el bridge lo rechaza y lo dice) y al entrar en la partida el bridge vuelve
 *  a preguntar al motor dónde despierta.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · el motor tarda MUCHO en decidir; ir andando hasta el bandido y morir;
 *   2 · caído, pulsar la salida «Molino del bench»: SE RECHAZA y se dice
 *       («Estás caído») en la línea de mensajes, el «Viajando...» no se queda,
 *       el tile no cambia y el velo SIGUE en «el mundo decide» (un rechazo no
 *       es el estado del despertar);
 *   3 · con el motor pensando, recargar y reanudar desde el título (el motor
 *       ya en `tarda` corto);
 *   4 · LA MEDIDA: vuelve caído, el velo dice que el mundo decide y NO se
 *       ofrece R; y despierta sin tecla con la vida LLENA (el máximo del HUD).
 *
 *  EN NEGATIVO (tanda BN): sin relanzar el despertar al entrar en la partida
 *  (`handleSessionEntered`), el paso 4 es rojo: el jugador no despierta.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar, esperarElDespertar } from "../lib/combate.mjs";
import { pulsarSalida } from "../lib/viaje.mjs";

/** `fake-ai`: el guion cambia cómo contesta el motor ante una muerte. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const SALIDA = "Molino del bench";

const vidaDelHud = () => ({
  hp: Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"),
  max: Number((document.getElementById("player-hp-max")?.textContent ?? "").replace(/[^\d.]/g, "")),
});

export default async function (ctx) {
  await conductaDelDespertar(ctx, "tarda", 600_000);
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const { sessionId } = await comenzar(ctx);

  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.2, tramos: 14 });
  const muerto = await ctx.absorbe(
    "cortafuegos de la espera a que el bandido mate al jugador: PRECONDICIÓN; si expira se declara ⊘",
    () =>
      ctx.waitFor(
        "el bandido mata al jugador",
        () => (Number(document.getElementById("player-hp-text")?.textContent ?? "NaN") === 0 ? true : null),
        { sim: 120 },
      ),
  );
  if (!muerto) ctx.sinMedir("el bandido no mató al jugador en 120 s de simulación");

  // ── 2 · caído, viajar: se rechaza y se dice ──────────────────────────────
  const tileAntes = await ctx.page.evaluate(() => window.__nefan.currentTile);
  const pulsada = await pulsarSalida(ctx, SALIDA);
  ctx.expect(`hay salida «${SALIDA}» que pulsar (si no, este paso no mide nada)`, pulsada, String(pulsada));
  await ctx.expectEspera(
    "caído, el viaje se rechaza y se DICE en la línea de mensajes («Estás caído»), y el «Viajando...» no se queda",
    true,
    () => {
      const linea = document.getElementById("combat-log")?.textContent ?? "";
      const muroVisible = document.getElementById("narrative-loader")?.classList.contains("visible") ?? false;
      return /Estás caído: no puedes viajar/.test(linea) && !muroVisible ? true : null;
    },
    { sim: 3 },
  );
  // El rechazo es una respuesta al viaje, NO el estado del despertar: el motor
  // sigue decidiendo, y el velo no puede pasar a «fallo» ni ofrecer R (QA de
  // BN, segunda vuelta).
  await ctx.expectEspera(
    "tras el rechazo, el velo sigue diciendo que el mundo decide, sin R que pulsar",
    false,
    () => {
      const texto = document.getElementById("velo-del-despertar-texto")?.textContent ?? "";
      const r = window.__nefan.ui.actions().prompt.some((a) => a.id === "respawn");
      return !/decide dónde despiertas/.test(texto) || r ? { texto, r } : null;
    },
    { sim: 2 },
  );
  const tileDespues = await ctx.page.evaluate(() => window.__nefan.currentTile);
  ctx.expect("y el jugador sigue en el mismo tile", tileDespues === tileAntes, `${tileAntes} → ${tileDespues}`);
  await ctx.shot("caido-no-viaja");

  // ── 3 · reanudar con el motor pensando ────────────────────────────────────
  await conductaDelDespertar(ctx, "tarda", 1500);
  const r = await reanudar(ctx, sessionId);
  if (!r) return;
  const vuelto = await ctx.page.evaluate(vidaDelHud);
  ctx.log(`tras reanudar: ${vuelto.hp} / ${vuelto.max}`);
  ctx.expect("vuelve caído: la muerte se guardó", vuelto.hp === 0, JSON.stringify(vuelto));

  // ── 4 · LA MEDIDA ─────────────────────────────────────────────────────────
  const enPie = await esperarElDespertar(ctx, "reanudado caído");
  const hud = await ctx.page.evaluate(vidaDelHud);
  ctx.expect("despierta con la vida LLENA (el máximo del HUD)", hud.hp > 0 && hud.hp === hud.max, JSON.stringify({ enPie, hud }));
  await ctx.shot("despierto-tras-reanudar");
}
