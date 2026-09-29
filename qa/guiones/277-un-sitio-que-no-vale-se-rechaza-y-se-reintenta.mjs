/** Si el motor elige un sitio que no vale, el juego lo rechaza, lo dice y se
 *  reintenta con R (#613, pasada de la QA de la tanda BN; la diseñó la QA y no
 *  llegó a guardarla).
 *
 *  El pre-flight de narrative-mcp es la PRIMERA puerta, pero el motor puede no
 *  pasar por ella (la vía API) o el mundo puede cambiar mientras piensa: la
 *  SEGUNDA, la que manda, es el bridge al recibir la respuesta
 *  (`validarDespertar` en `alLlegarElDespertar`). El motor falso en modo `mal`
 *  contesta el sitio donde cayó el jugador, junto al bandido, sin preguntar.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · el motor falso en `mal`; ir hasta el bandido y morir;
 *   2 · LA MEDIDA del rechazo: el velo pasa a decir que el mundo eligió un
 *       sitio donde no se puede despertar —«pulsa R»—, se ofrece «R ·
 *       reintentar», y el jugador SIGUE caído;
 *   3 · el motor vuelve a `normal`, R: despierta, fuera del alcance del
 *       bandido.
 *
 *  EN NEGATIVO (tanda BN): quitando la segunda validación del bridge (el
 *  `validarDespertar` de `alLlegarElDespertar`), 2 es rojo: el jugador
 *  despierta en el cadáver.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar } from "../lib/combate.mjs";
import { HOSTILE_AGGRO_M } from "../../nefan-core/dist/src/combat/hostiles.js";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";

export default async function (ctx) {
  await conductaDelDespertar(ctx, "mal");
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);

  const casa = await ctx.waitFor(
    `el bandido "${BANDIDO}" está en escena`,
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      return e ? { x: e.pos.x, z: e.pos.z } : null;
    },
    60_000,
    BANDIDO,
  );
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

  // ── 2 · el sitio del motor no vale: se dice, con tecla, y sigue caído ─────
  await ctx.expectEspera(
    "el velo dice que el mundo eligió un sitio donde no se puede despertar —«pulsa R»— y ofrece «R · reintentar»",
    true,
    () => {
      const v = document.getElementById("velo-del-despertar");
      const texto = document.getElementById("velo-del-despertar-texto")?.textContent ?? "";
      const r = window.__nefan.ui.actions().prompt.find((a) => a.id === "respawn");
      return v && !v.hidden && /no se puede despertar/.test(texto) && /pulsa R/.test(texto) && r?.label === "reintentar"
        ? { texto }
        : null;
    },
    { sim: 5 },
  );
  await ctx.expectEspera(
    "con el sitio rechazado, el jugador se levanta igual (lo levantaría en el cadáver)",
    false,
    () => (Number(document.getElementById("player-hp-text")?.textContent ?? "NaN") > 0 ? true : null),
    { sim: 2 },
  );
  await ctx.shot("sitio-rechazado");

  // ── 3 · el motor vuelve, R reintenta ──────────────────────────────────────
  await conductaDelDespertar(ctx, "normal");
  await ctx.nefan("inputDriver.queueRespawn");
  const enPie = await ctx.waitFor(
    "con el motor de vuelta, R reintenta y el jugador despierta",
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp > 0 ? { hp, pos: { ...window.__nefan.state().pos } } : null;
    },
    { sim: 10 },
  );
  const d = Math.hypot(enPie.pos.x - casa.x, enPie.pos.z - casa.z);
  ctx.expect(`despierta FUERA del radio de enganche del bandido (> ${HOSTILE_AGGRO_M} m)`, d > HOSTILE_AGGRO_M, `${d.toFixed(2)} m`);
}
