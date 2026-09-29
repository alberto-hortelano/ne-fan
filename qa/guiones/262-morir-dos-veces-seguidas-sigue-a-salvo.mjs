/** Morir DOS veces seguidas sigue siendo reaparecer a salvo (#613, piezas A y B,
 *  pasada adversarial de la QA de la tanda BN).
 *
 *  El 260 mide UNA muerte. La pregunta de este guion es la segunda: tras el
 *  primer despertar el bandido se ha soltado y ha vuelto a su sitio, y la
 *  segunda muerte vuelve a preguntar al motor (`despertar.enVuelo` se limpió).
 *  Si el primer `soltar()` dejara algo a medias (el enganche, el reloj de
 *  reacción) o la primera petición no se cerrara, es en la SEGUNDA muerte
 *  donde el jugador lo pagaría: no despertar, o con el bandido encima.
 *
 *  El escenario, entero por el camino del jugador y desde el arranque:
 *   1 · dónde vive el bandido del tile de bootstrap;
 *   2 · dos veces: ir andando hasta él, quedarse quieto hasta que te mata, y
 *       SIN TECLA esperar a que el motor decida (el velo lo dice);
 *   3 · LA MEDIDA, tras CADA despertar: no despiertas donde caíste, despiertas
 *       fuera del radio de enganche de su sitio, él está vivo y en su sitio, el
 *       velo se ha ido, y durante 3 s ni se mueve ni te quita vida.
 *
 *  Si el bandido no llega a matar al jugador, el escenario no existe (⊘).
 *
 *  EN NEGATIVO (QA tanda BN, 2026-09-29): ver `qa.md` de la tanda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar, esperarElDespertar } from "../lib/combate.mjs";
import { HOSTILE_AGGRO_M } from "../../nefan-core/dist/src/combat/hostiles.js";

/** Precondición DECLARADA: la partida arranca en el tile de bootstrap, que es
 *  el que trae al bandido; y el motor falso vuelve a `normal` tras el guion
 *  (aquí tarda un poco, para que el velo se vea). */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const OBSERVAR_TRAS_REAPARECER = 3;
const EN_SU_SITIO_M = 0.25;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Una vuelta entera: acercarse, morir, despertar, y medir. `n` es el número de la
 *  muerte, para que el rojo diga cuál falló. */
async function unaMuerte(ctx, casa, n) {
  // Tras el primer despertar el motor falso deja al jugador en la Taberna, con
  // casas entre él y el bandido: el paseo en línea recta se queda contra una
  // pared (como en el 268). Basta con ENTRAR en su radio (10 m): el bandido
  // enganchado cierra la distancia solo.
  await acercarse(ctx, BANDIDO, { objetivo: 9, tramos: 14 });
  const cayoEn = await ctx.absorbe(
    `cortafuegos de la espera a que el bandido mate al jugador (muerte ${n}): es PRECONDICIÓN, no la ` +
      "medida; si expira, la rama de abajo lo declara ⊘",
    () =>
      ctx.waitFor(
        `el bandido mata al jugador (muerte ${n})`,
        (id) => {
          const e = window.__nefan.enemies().find((x) => x.id === id);
          const p = window.__nefan.state().pos;
          if (e && p) window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
          const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
          return hp === 0 ? { x: p.x, z: p.z } : null;
        },
        { sim: 120 },
        BANDIDO,
      ),
  );
  if (!cayoEn) ctx.sinMedir(`el bandido no mató al jugador en la muerte ${n}: sin morir no hay R que medir`);
  const vuelto = await esperarElDespertar(ctx, `muerte ${n}`);
  ctx.log(
    `muerte ${n}: cayó en (${cayoEn.x.toFixed(2)}, ${cayoEn.z.toFixed(2)}) · despertó en ` +
      `(${vuelto.pos.x.toFixed(2)}, ${vuelto.pos.z.toFixed(2)}) con ${vuelto.hp} PV`,
  );
  ctx.expect(`muerte ${n}: NO despierta donde cayó`, dist(vuelto.pos, cayoEn) > 1, `${dist(vuelto.pos, cayoEn).toFixed(2)} m`);
  ctx.expect(
    `muerte ${n}: despierta FUERA del radio de enganche del sitio del bandido (> ${HOSTILE_AGGRO_M} m)`,
    dist(vuelto.pos, casa) > HOSTILE_AGGRO_M,
    `${dist(vuelto.pos, casa).toFixed(2)} m`,
  );
  await ctx.expectEspera(
    `muerte ${n}: el bandido está vivo y de vuelta en su sitio`,
    true,
    (a) => {
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      if (!e || e.alive === false) return null;
      return Math.hypot(e.pos.x - a.casa.x, e.pos.z - a.casa.z) <= a.tol ? true : null;
    },
    { sim: 1, arg: { id: BANDIDO, casa, tol: EN_SU_SITIO_M } },
  );
  await ctx.expectEspera(
    `muerte ${n}: el velo «Has caído» desaparece`,
    true,
    () => (document.getElementById("velo-del-despertar")?.hidden === true ? true : null),
    { sim: 1 },
  );
  await ctx.expectEspera(
    `muerte ${n}: durante ${OBSERVAR_TRAS_REAPARECER} s el bandido ni se mueve ni te quita vida`,
    false,
    (a) => {
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      if (hp < a.hp) return { hp };
      if (e && Math.hypot(e.pos.x - a.casa.x, e.pos.z - a.casa.z) > a.tol) return { bandido: e.pos };
      return null;
    },
    { sim: OBSERVAR_TRAS_REAPARECER, arg: { id: BANDIDO, casa, tol: EN_SU_SITIO_M, hp: vuelto.hp } },
  );
  await ctx.shot(`reaparecido-tras-la-muerte-${n}`);
  return { cayoEn, vuelto };
}

export default async function (ctx) {
  await conductaDelDespertar(ctx, "tarda", 1500);
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);

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

  const primera = await unaMuerte(ctx, alta.casa, 1);
  const segunda = await unaMuerte(ctx, alta.casa, 2);
  // Dónde despertó cada vez, para leerlo: lo decide el motor, así que no se
  // afirma que coincidan.
  ctx.log(
    `puntos: 1ª (${primera.vuelto.pos.x.toFixed(2)}, ${primera.vuelto.pos.z.toFixed(2)}) · ` +
      `2ª (${segunda.vuelto.pos.x.toFixed(2)}, ${segunda.vuelto.pos.z.toFixed(2)})`,
  );
}
