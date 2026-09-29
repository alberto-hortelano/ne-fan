/** El hostil que el motor pone A TU LADO también te suelta al morir (#613,
 *  piezas A y B, pasada adversarial de la QA de la tanda BN).
 *
 *  El 260 mide al bandido de la escena, que está quieto en su sitio y al que el
 *  jugador se acerca: siempre hay un paso fuera de su radio. Pero el motor
 *  narrativo también materializa hostiles EN RUNTIME junto al jugador
 *  (`spawn_entity`, «te asaltan en la taberna»), y entonces:
 *   · el último punto «fuera de combate» es donde estabas cuando apareció, y
 *   · su «casa» es donde apareció — a unos metros de ese punto.
 *  Si los dos caen dentro del radio de enganche, reaparecer es volver a su
 *  alcance: el bucle que #613 quería romper.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · se mata al bandido del tile (para que no haya dos hostiles mezclados);
 *   2 · se habla con el tabernero hasta que el motor falso manda al Secuaz
 *       (turno 2, como en el 240);
 *   3 · quieto hasta que el Secuaz mata al jugador; SIN TECLA, el motor decide
 *       dónde despierta (#613, «que decida el motor») y el velo lo dice;
 *   4 · LA MEDIDA: el jugador despierta FUERA del radio de enganche del sitio
 *       donde apareció el Secuaz, y durante 8 s el Secuaz no le quita vida.
 *
 *  Era ROJO sobre `bc372d64` (el sim reaparecía en el último punto seguro, que
 *  el Secuaz había aparecido a 4,8 m): el motor falso en `normal` prueba ese
 *  mismo punto primero, y `validarDespertar` lo rechaza por estar dentro del
 *  radio de la casa del Secuaz.
 *
 *  Si el bandido mata al jugador antes, o el Secuaz no llega a matarlo, se
 *  DECLARA (⊘).
 *
 *  EN NEGATIVO (QA tanda BN, 2026-09-29): ver `qa.md` de la tanda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar, esperarElDespertar, herirHasta } from "../lib/combate.mjs";
import { HOSTILE_AGGRO_M } from "../../nefan-core/dist/src/combat/hostiles.js";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
const OBSERVAR = 8;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export default async function (ctx) {
  // El motor tarda un poco en decidir: lo justo para que el velo se vea.
  await conductaDelDespertar(ctx, "tarda", 1500);
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);

  // ── 1 · matar al bandido ────────────────────────────────────────────────
  await ctx.waitFor(
    `el bandido "${BANDIDO}" está en escena`,
    (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null,
    60_000,
    BANDIDO,
  );
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) ctx.sinMedir("el bandido mató al jugador antes de caer: no es este escenario");
  ctx.expect("el jugador mata al bandido", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;

  // ── 2 · el motor manda al Secuaz ────────────────────────────────────────
  const idsAntes = await ctx.page.evaluate(() => window.__nefan.enemies().map((e) => e.id));
  await ctx.waitFor("el tabernero está en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 30_000, TABERNERO);
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  const secuaz = await ctx.waitFor(
    "el motor materializa al Secuaz (spawn_entity del turno 2)",
    (previos) => {
      const e = window.__nefan.enemies().find((x) => !previos.includes(x.id));
      return e ? { id: e.id, casa: { x: e.pos.x, z: e.pos.z }, jugador: { ...window.__nefan.state().pos } } : null;
    },
    90_000,
    idsAntes,
  );
  ctx.log(
    `secuaz ${secuaz.id} aparece en (${secuaz.casa.x.toFixed(2)}, ${secuaz.casa.z.toFixed(2)}), a ` +
      `${dist(secuaz.casa, secuaz.jugador).toFixed(2)} m del jugador`,
  );
  await ctx.nefan("advanceDialogue");
  await ctx.waitFor("la conversación se cierra", () => (window.__nefan.dialogueVisible ? null : true), 15_000);

  // ── 3 · el Secuaz mata al jugador; el motor decide dónde despierta ──────
  const cayoEn = await ctx.absorbe(
    "cortafuegos de la espera a que el Secuaz mate al jugador: PRECONDICIÓN; si expira se declara ⊘",
    () =>
      ctx.waitFor(
        "el Secuaz mata al jugador",
        () => {
          const hp = Number(document.getElementById("player-hp-text")?.textContent ?? 1);
          return hp <= 0 ? { ...window.__nefan.state().pos } : null;
        },
        { sim: 120 },
      ),
  );
  if (!cayoEn) ctx.sinMedir("el Secuaz no mató al jugador en 120 s de simulación");
  const vuelto = await esperarElDespertar(ctx, "muerto junto al Secuaz");
  ctx.log(
    `cayó en (${cayoEn.x.toFixed(2)}, ${cayoEn.z.toFixed(2)}) · reapareció en ` +
      `(${vuelto.pos.x.toFixed(2)}, ${vuelto.pos.z.toFixed(2)}) · ${dist(vuelto.pos, secuaz.casa).toFixed(2)} m ` +
      "del sitio donde apareció el Secuaz",
  );

  // ── 4 · LA MEDIDA ───────────────────────────────────────────────────────
  ctx.expect(
    `despierta FUERA del radio de enganche del sitio del Secuaz (> ${HOSTILE_AGGRO_M} m)`,
    dist(vuelto.pos, secuaz.casa) > HOSTILE_AGGRO_M,
    `${dist(vuelto.pos, secuaz.casa).toFixed(2)} m`,
  );
  await ctx.expectEspera(
    `durante ${OBSERVAR} s el Secuaz no te quita vida (te soltó)`,
    false,
    (a) => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      if (hp < a.hp) return { hp, secuaz: e?.pos };
      return null;
    },
    { sim: OBSERVAR, arg: { id: secuaz.id, hp: vuelto.hp } },
  );
  await ctx.shot("reaparecido-junto-al-secuaz");
}
