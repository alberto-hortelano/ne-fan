/** Morir justo después de CAMBIAR DE TILE sigue siendo despertar a salvo, y
 *  en un tile que el cliente tiene (#613, piezas A y B, pasada adversarial de
 *  la QA de la tanda BN; adaptado a «que decida el motor»).
 *
 *  El punto seguro (la sugerencia que el motor recibe) vive en el sim y no
 *  sabe de tiles: es una posición del plano continuo. La pregunta es si un
 *  viaje (el panel «Salidas» teletransporta al jugador a otro tile y el sim lo
 *  sigue por el input) deja el despertar en el tile de antes, o en un sitio
 *  que el cliente ya no tiene activo.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · dónde vive el bandido del tile de bootstrap;
 *   2 · ida y vuelta por el panel: «Molino del bench» y de vuelta a la
 *       «Taberna del bench» (tile_0_0);
 *   3 · nada más volver, ir andando hasta el bandido y morir; sin tecla, el
 *       motor decide dónde despierta (el velo lo dice);
 *   4 · LA MEDIDA: la misma que el 262 tras cada muerte, y además el jugador
 *       sigue en tile_0_0 (el tile activo del cliente es el suyo).
 *
 *  EN NEGATIVO (QA tanda BN, 2026-09-29): ver `qa.md` de la tanda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar, esperarElDespertar } from "../lib/combate.mjs";
import { viajarSiSePuede } from "../lib/viaje.mjs";
import { HOSTILE_AGGRO_M } from "../../nefan-core/dist/src/combat/hostiles.js";

/** `fake-ai`: el motor tarda un poco en decidir, para que el velo se vea. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const OBSERVAR_TRAS_REAPARECER = 3;
const EN_SU_SITIO_M = 0.25;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Una vuelta entera: acercarse, morir, despertar, y medir. `n` es el número de la
 *  muerte, para que el rojo diga cuál falló. */
async function unaMuerte(ctx, casa, n) {
  // Desde la llegada de la vuelta hay casas por medio y el paseo en línea
  // recta se queda contra una pared a ~8 m (medido en la QA de BN); basta con
  // ENTRAR en su radio (10 m): el bandido enganchado cierra la distancia solo.
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
  // Aquí NO se afirma «lejos del cadáver»: el paseo se para a ~9 m, justo
  // DENTRO del radio, y el bandido viene a matarte ahí, así que el último
  // punto fuera de combate puede estar a menos de 1 m de donde caes (medido en
  // la QA de BN: 0,90 m) y eso es correcto. Lo que importa es el radio, abajo.
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
      return e ? { casa: { x: e.pos.x, z: e.pos.z }, tile: window.__nefan.currentTile } : null;
    },
    60_000,
    BANDIDO,
  );

  // ── 2 · ida y vuelta ──────────────────────────────────────────────────────
  const ida = await viajarSiSePuede(ctx, "Molino del bench", "el viaje de ida llega", "la ida es precondición del escenario");
  if (!ida.llegada) ctx.sinMedir(`no se pudo viajar al Molino (${ida.causa})`);
  const vuelta = await viajarSiSePuede(ctx, "Taberna del bench", "el viaje de vuelta llega", "la vuelta es precondición del escenario");
  if (!vuelta.llegada) ctx.sinMedir(`no se pudo volver a la Taberna (${vuelta.causa})`);
  ctx.log(`ida a ${ida.llegada.tile}, vuelta a ${vuelta.llegada.tile} en (${vuelta.llegada.pos.x.toFixed(2)}, ${vuelta.llegada.pos.z.toFixed(2)})`);
  if (vuelta.llegada.tile !== alta.tile) ctx.sinMedir(`la vuelta no llegó al tile del bandido (${vuelta.llegada.tile})`);
  if (dist(vuelta.llegada.pos, alta.casa) <= HOSTILE_AGGRO_M) {
    ctx.sinMedir("la vuelta deja al jugador dentro del radio del bandido: no hay tick fuera de combate que medir");
  }

  // ── 3 y 4 · morir nada más volver ─────────────────────────────────────────
  await unaMuerte(ctx, alta.casa, 1);
  const tile = await ctx.page.evaluate(() => window.__nefan.currentTile);
  ctx.expect(`tras despertar, el tile activo del cliente es ${alta.tile}`, tile === alta.tile, String(tile));
}
