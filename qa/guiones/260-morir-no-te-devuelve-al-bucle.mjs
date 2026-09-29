/** Morir no te devuelve al bucle: reapareces en el último punto SEGURO y el
 *  enemigo que te mató te suelta y vuelve a su sitio (#613, piezas A y B).
 *
 *  La decisión del usuario del 2026-09-29 («punto seguro + suelta»): el punto
 *  donde vuelves lo decide el BRIDGE —el último sitio en el que estabas vivo
 *  y ningún enemigo te tenía enganchado— y al morir todos los enemigos te
 *  sueltan. Hasta esta tanda reaparecías donde caíste, con el que te mató al
 *  lado, enganchado y a tope: morir era volver a morir.
 *
 *  El escenario, entero por el camino del jugador y desde el arranque:
 *   1 · se apunta dónde está el bandido del tile de bootstrap (su sitio de
 *       alta) y se va andando hacia él hasta 1,2 m — en algún paso se entra en
 *       su radio de enganche (`HOSTILE_AGGRO_M`, 10 m);
 *   2 · el jugador se queda quieto y encarado hasta que el bandido lo mata;
 *   3 · R hasta que está en pie;
 *   4 · LA MEDIDA: NO está donde cayó, está FUERA del radio del sitio del
 *       bandido, el bandido está VIVO y de vuelta en su sitio, el botón
 *       «R · reaparecer» se ha ido (el `player_respawned` llegó al panel de
 *       combate: #613, el frame pendiente que se pisaba), y durante 3 s de
 *       mundo el bandido no se mueve de su sitio ni le quita vida.
 *
 *  Si el jugador empieza ya dentro del radio del bandido, el punto seguro es el
 *  de su alta —nunca hubo un tick fuera de combate— y el escenario no es el
 *  que se mide: se DECLARA (⊘). Igual si el bandido no llega a matarlo.
 *
 *  EN NEGATIVO (2026-09-29, tanda BN): ver `implementacion.md` de la tanda
 *  (`docs/agents/2026-09-29-tanda-bn-reaparecer-a-salvo/`).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
// El radio de enganche de un hostil del motor, leído del core para no escribir
// el número dos veces.
import { HOSTILE_AGGRO_M } from "../../nefan-core/dist/src/combat/hostiles.js";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `saves`   — la partida tiene que arrancar en el tile de bootstrap, que
 *                 es el que trae al bandido. */
export const aisla = ["saves"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
/** Segundos de MUNDO que se observa al bandido tras reaparecer. */
const OBSERVAR_TRAS_REAPARECER = 3;
/** Cuánto puede separarse del sitio de alta el bandido que «ha vuelto». El
 *  teletransporte es exacto; esto solo absorbe el redondeo del wire. */
const EN_SU_SITIO_M = 0.25;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  await comenzar(ctx);

  // ── 1 · dónde vive el bandido, y acercarse ──────────────────────────────
  const alta = await ctx.waitFor(
    `el bandido "${BANDIDO}" está en escena`,
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      return e ? { casa: { x: e.pos.x, z: e.pos.z }, jugador: { ...window.__nefan.state().pos } } : null;
    },
    60_000,
    BANDIDO,
  );
  const deInicio = dist(alta.casa, alta.jugador);
  ctx.log(`bandido en (${alta.casa.x.toFixed(2)}, ${alta.casa.z.toFixed(2)}) · jugador a ${deInicio.toFixed(2)} m`);
  if (deInicio <= HOSTILE_AGGRO_M) {
    ctx.sinMedir(
      `el jugador arranca a ${deInicio.toFixed(2)} m del bandido, dentro de su radio (${HOSTILE_AGGRO_M} m): ` +
        "nunca hubo un tick fuera de combate y el punto seguro es el de alta, que no es lo que se mide",
    );
  }
  await acercarse(ctx, BANDIDO, { objetivo: 1.2, tramos: 14 });

  // ── 2 · el bandido mata al jugador ──────────────────────────────────────
  const muerte = await ctx.absorbe(
    "cortafuegos de la espera a que el bandido mate al jugador: es PRECONDICIÓN del escenario, no la " +
      "medida; si expira, la rama de abajo lo declara ⊘ con `ctx.sinMedir`",
    () =>
      ctx.waitFor(
        "el bandido mata al jugador",
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
  if (!muerte) {
    ctx.sinMedir("el bandido no mató al jugador en 120 s de simulación: sin morir no hay R que medir");
  }
  const cayoEn = muerte;
  // La barra de acciones se compone ANTES del tick del frame (`main.ts`), así
  // que va un frame por detrás del HUD: se espera, no se lee de golpe.
  await ctx.expectEspera(
    "muerto, se ofrece «R · reaparecer»",
    true,
    () => (window.__nefan.ui.actions().prompt.some((a) => a.id === "respawn") ? true : null),
    { sim: 1 },
  );
  await ctx.shot("muerto-junto-al-bandido");

  // ── 3 · R ───────────────────────────────────────────────────────────────
  const vuelto = await ctx.waitFor(
    "el jugador reaparece al pulsar R",
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
      if (hp > 0) return { hp, pos: { ...window.__nefan.state().pos } };
      window.__nefan.inputDriver.queueRespawn();
      return null;
    },
    15_000,
  );
  ctx.log(
    `cayó en (${cayoEn.x.toFixed(2)}, ${cayoEn.z.toFixed(2)}) · reapareció en ` +
      `(${vuelto.pos.x.toFixed(2)}, ${vuelto.pos.z.toFixed(2)}) con ${vuelto.hp} PV`,
  );

  // ── 4 · LA MEDIDA ───────────────────────────────────────────────────────
  const deLaCaida = dist(vuelto.pos, cayoEn);
  ctx.expect("NO reaparece donde cayó", deLaCaida > 1, `${deLaCaida.toFixed(2)} m del cadáver`);
  const deLaCasa = dist(vuelto.pos, alta.casa);
  ctx.expect(
    `reaparece FUERA del radio de enganche del sitio del bandido (> ${HOSTILE_AGGRO_M} m)`,
    deLaCasa > HOSTILE_AGGRO_M,
    `${deLaCasa.toFixed(2)} m del sitio del bandido`,
  );
  await ctx.expectEspera(
    "el bandido está vivo y de vuelta en su sitio",
    true,
    (a) => {
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      if (!e || e.alive === false) return null;
      return Math.hypot(e.pos.x - a.casa.x, e.pos.z - a.casa.z) <= a.tol ? { hp: e.hp } : null;
    },
    { sim: 1, arg: { id: BANDIDO, casa: alta.casa, tol: EN_SU_SITIO_M } },
  );
  await ctx.expectEspera(
    "el botón «R · reaparecer» desaparece: el panel de combate se enteró de que volviste",
    true,
    () => (window.__nefan.ui.actions().prompt.some((a) => a.id === "respawn") ? null : true),
    { sim: 1 },
  );
  // «Debe NO ocurrir»: que el bandido eche a andar hacia el jugador o le quite
  // vida. Cualquiera de las dos es el bucle de vuelta.
  await ctx.expectEspera(
    `durante ${OBSERVAR_TRAS_REAPARECER} s el bandido ni se mueve de su sitio ni te quita vida (te soltó)`,
    false,
    (a) => {
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      if (hp < a.hp) return { hp };
      if (e && Math.hypot(e.pos.x - a.casa.x, e.pos.z - a.casa.z) > a.tol) return { bandido: e.pos };
      return null;
    },
    { sim: OBSERVAR_TRAS_REAPARECER, arg: { id: BANDIDO, casa: alta.casa, tol: EN_SU_SITIO_M, hp: vuelto.hp } },
  );
  await ctx.shot("reaparecido-a-salvo");
}
