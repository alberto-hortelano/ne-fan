/** Reanudar la partida con el jugador caído vuelve a preguntar al motor dónde
 *  despierta, y no le devuelve al bucle (#613, pasada adversarial de la QA de
 *  la tanda BN; adaptado a «que decida el motor»).
 *
 *  La muerte del jugador SE GUARDA (es lo que vuelve al reanudar), y si el
 *  jugador cierra mientras el motor decide, al reanudar vuelve caído: el
 *  bridge tiene que volver a preguntar —al entrar en la partida, no antes, o
 *  el frame con el sitio se tiraría—, y el sitio tiene que estar fuera del
 *  alcance del bandido.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · dónde vive el bandido del tile de bootstrap;
 *   2 · el motor falso tarda MUCHO en decidir; ir andando hasta el bandido y
 *       quedarse quieto hasta que te mata;
 *   3 · con el velo puesto, recargar la página y reanudar desde el título, y el
 *       motor ya en `tarda` corto;
 *   4 · LA MEDIDA: vuelve caído, el velo dice que el mundo decide (sin R), y
 *       despierta sin tecla FUERA del radio de enganche del sitio ORIGINAL del
 *       bandido; durante 3 s el bandido no le quita vida.
 *
 *  EN NEGATIVO (tanda BN): sin relanzar el despertar al entrar en la partida
 *  (`handleSessionEntered`), el paso 4 es rojo: el jugador no despierta.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar, esperarElDespertar } from "../lib/combate.mjs";
import { HOSTILE_AGGRO_M } from "../../nefan-core/dist/src/combat/hostiles.js";

/** `fake-ai`: el guion cambia cómo contesta el motor ante una muerte. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const OBSERVAR = 3;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const { sessionId } = await comenzar(ctx);

  const alta = await ctx.waitFor(
    `el bandido "${BANDIDO}" está en escena`,
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      return e ? { casa: { x: e.pos.x, z: e.pos.z }, jugador: { ...window.__nefan.state().pos } } : null;
    },
    60_000,
    BANDIDO,
  );
  if (dist(alta.casa, alta.jugador) <= HOSTILE_AGGRO_M) {
    ctx.sinMedir("el jugador arranca dentro del radio del bandido: nunca hubo un tick fuera de combate");
  }
  // El motor tarda más de lo que dura el guion: el jugador se va con él pensando.
  await conductaDelDespertar(ctx, "tarda", 600_000);
  await acercarse(ctx, BANDIDO, { objetivo: 1.2, tramos: 14 });
  const cayoEn = await ctx.absorbe(
    "cortafuegos de la espera a que el bandido mate al jugador: PRECONDICIÓN; si expira se declara ⊘",
    () =>
      ctx.waitFor(
        "el bandido mata al jugador",
        (id) => {
          const e = window.__nefan.enemies().find((x) => x.id === id);
          const p = window.__nefan.state().pos;
          if (e && p) window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
          const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
          return hp === 0 ? { x: p.x, z: p.z, bandido: { x: e.pos.x, z: e.pos.z } } : null;
        },
        { sim: 120 },
        BANDIDO,
      ),
  );
  if (!cayoEn) ctx.sinMedir("el bandido no mató al jugador: sin morir no hay nada que reanudar");
  ctx.log(
    `cayó en (${cayoEn.x.toFixed(2)}, ${cayoEn.z.toFixed(2)}) con el bandido en ` +
      `(${cayoEn.bandido.x.toFixed(2)}, ${cayoEn.bandido.z.toFixed(2)}); su sitio es ` +
      `(${alta.casa.x.toFixed(2)}, ${alta.casa.z.toFixed(2)})`,
  );

  await ctx.waitFor(
    "caído, el velo dice que el mundo decide",
    () => (document.getElementById("velo-del-despertar")?.hidden === false ? true : null),
    { sim: 2 },
  );

  // ── 3 · recargar con el motor pensando, y reanudar ────────────────────────
  await conductaDelDespertar(ctx, "tarda", 1500);
  const r = await reanudar(ctx, sessionId);
  if (!r) return;
  const tras = await ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"));
  ctx.expect("vuelve caído: la muerte se guardó", tras === 0, `${tras} PV`);
  await ctx.shot("reanudado-caido");

  // ── 4 · LA MEDIDA ─────────────────────────────────────────────────────────
  const vivo = await esperarElDespertar(ctx, "reanudado caído");
  ctx.log(`despierta con ${vivo.hp} PV en (${vivo.pos.x.toFixed(2)}, ${vivo.pos.z.toFixed(2)})`);
  ctx.expect(
    `tras reanudar, despierta FUERA del radio de enganche del sitio del bandido (> ${HOSTILE_AGGRO_M} m)`,
    dist(vivo.pos, alta.casa) > HOSTILE_AGGRO_M,
    `${dist(vivo.pos, alta.casa).toFixed(2)} m del sitio original`,
  );
  await ctx.expectEspera(
    `durante ${OBSERVAR} s tras despertar, el bandido no te quita vida`,
    false,
    (a) => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp < a.hp ? { hp } : null;
    },
    { sim: OBSERVAR, arg: { hp: vivo.hp } },
  );
  await ctx.shot("reanudado-y-en-pie");
}
