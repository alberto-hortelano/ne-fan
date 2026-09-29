/** Una respuesta VIEJA del motor no despierta a la partida que se cargó
 *  después (#613, pasada de la QA de la tanda BN; la diseñó la QA y no llegó a
 *  guardarla).
 *
 *  El motor puede tardar, y mientras tanto el jugador puede irse: recargar y
 *  reanudar. Esa partida cargada otra vez es OTRA petición —el bridge vuelve a
 *  preguntar al entrar— y la respuesta que el motor le debía a la carga
 *  anterior no puede decidir por ella: el bridge la tira por su `id` (la
 *  petición en vuelo es la nueva). Si no la tirara, el jugador se levantaría
 *  con el sitio que el motor eligió para la carga de antes, sin que nadie se lo
 *  preguntara a esta.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · el motor tarda 15 s en decidir (más que recargar y reanudar); ir hasta el bandido y morir;
 *   2 · con el velo puesto, recargar y reanudar, con el motor ya en `tarda`
 *       largo para la petición NUEVA;
 *   3 · LA MEDIDA: pasa el momento en que llega la respuesta vieja (la de 15 s)
 *       y el jugador SIGUE caído, con el velo en «el mundo decide».
 *
 *  EN NEGATIVO (tanda BN): quitando el filtro por `id` de
 *  `alLlegarElDespertar` (`bridge/handlers/despertar.ts`), 3 es rojo: la
 *  respuesta vieja levanta al jugador.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
/** Lo que tarda el motor en contestar a la carga VIEJA. */
const TARDA_VIEJA_MS = 15_000;
/** Y a la NUEVA: bastante más que lo que se observa. */
const TARDA_NUEVA_MS = 120_000;
/** Segundos de mundo que se observa tras reanudar: más que la respuesta vieja. */
const OBSERVAR = 25;

export default async function (ctx) {
  await conductaDelDespertar(ctx, "tarda", TARDA_VIEJA_MS);
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
  await ctx.waitFor(
    "caído, el velo dice que el mundo decide (la petición vieja está en vuelo)",
    () => (document.getElementById("velo-del-despertar")?.hidden === false ? true : null),
    { sim: 2 },
  );

  // ── 2 · recargar y reanudar con el motor aún pensando la vieja ─────────────
  await conductaDelDespertar(ctx, "tarda", TARDA_NUEVA_MS);
  const r = await reanudar(ctx, sessionId);
  if (!r) return;
  const tras = await ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"));
  ctx.expect("vuelve caído", tras === 0, `${tras} PV`);

  // ── 3 · LA MEDIDA ─────────────────────────────────────────────────────────
  await ctx.expectEspera(
    `durante ${OBSERVAR} s tras reanudar —pasado lo que tardaba la respuesta vieja— el jugador se levanta (lo levantaría la respuesta de la carga anterior)`,
    false,
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp > 0 ? { hp, pos: window.__nefan.state().pos } : null;
    },
    { sim: OBSERVAR },
  );
  const velo = await ctx.page.evaluate(() => ({
    visible: document.getElementById("velo-del-despertar")?.hidden === false,
    texto: document.getElementById("velo-del-despertar-texto")?.textContent ?? "",
  }));
  ctx.expect(
    "y el velo sigue diciendo que el mundo decide (la petición en vuelo es la nueva)",
    velo.visible && /decide dónde despiertas/.test(velo.texto),
    JSON.stringify(velo),
  );
  await ctx.shot("la-vieja-no-despierta");
}
