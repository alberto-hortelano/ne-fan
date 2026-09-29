/** El despertar sin respuesta tiene salida (#613, pasada adversarial de la QA
 *  de la tanda BN; reescrito con el despertar que decide el motor).
 *
 *  Al morir en partida, el cliente deja de mandar input hasta que llega el
 *  frame con el sitio donde despierta —el cadáver no se mueve— y ese frame lo
 *  decide el MOTOR, que puede tardar. La pregunta de este guion es la del
 *  jugador: ¿qué ve mientras tanto, y sale de ahí?
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · el motor falso tarda en decidir (`/dev/despertar tarda`);
 *   2 · ir andando hasta el bandido y morir;
 *   3 · LA MEDIDA mecánica: el velo dice que el mundo decide, sin R que
 *       pulsar; durante 3 s el jugador sigue caído, el velo sigue y el cliente
 *       NO manda input (la espera es real);
 *   4 · la salida: la respuesta llega sola y el jugador se levanta a tope, y
 *       el cliente vuelve a mandar input.
 *
 *  EN NEGATIVO (tanda BN): quitando la pausa de input del cliente
 *  (`elJugadorEsperaDespertar` en `BridgeGameClient.tick`) el paso 3 es rojo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar, esperarElDespertar } from "../lib/combate.mjs";

/** `fake-ai`: este guion cambia cómo contesta el motor ante una muerte. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const ESPERA = 3;
/** Lo que tarda el motor falso en decidir: más que la espera que se mide. */
const TARDA_MS = 7000;

export default async function (ctx) {
  await conductaDelDespertar(ctx, "tarda", TARDA_MS);
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);
  // El espía del cable: CUENTA lo que sale por tipo. No toca nada: es la
  // única forma de ver desde fuera si el cliente se calla de verdad.
  await ctx.page.evaluate(() => {
    const w = window;
    w.__qaCable = { enviados: {} };
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      let tipo;
      try {
        tipo = JSON.parse(String(data)).type ?? "?";
      } catch (err) {
        tipo = `no-json:${String(err).slice(0, 20)}`;
      }
      w.__qaCable.enviados[tipo] = (w.__qaCable.enviados[tipo] ?? 0) + 1;
      return orig.call(this, data);
    };
  });

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

  // ── 3 · LA MEDIDA ─────────────────────────────────────────────────────────
  // El velo y la falta de tecla los afirma `esperarElDespertar` más abajo; aquí,
  // antes, la espera en sí: sigue caído, sigue el velo, y el cable callado.
  await ctx.waitFor(
    "el velo dice que el mundo decide dónde despiertas",
    () => (document.getElementById("velo-del-despertar")?.hidden === false ? true : null),
    { sim: 2 },
  );
  const inputsAntes = await ctx.page.evaluate(() => window.__qaCable.enviados.input ?? 0);
  await ctx.expectEspera(
    `durante ${ESPERA} s sin respuesta del motor, el jugador se levanta o el velo desaparece (sería un despertar mudo o un velo que miente)`,
    false,
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      const velo = document.getElementById("velo-del-despertar")?.hidden === false;
      return hp > 0 || !velo ? { hp, velo } : null;
    },
    { sim: ESPERA },
  );
  const inputsDespues = await ctx.page.evaluate(() => window.__qaCable.enviados.input ?? 0);
  ctx.expect(
    "mientras el motor decide, el cliente NO manda input (el cadáver no se mueve, y la espera existe)",
    inputsDespues === inputsAntes,
    `${inputsDespues - inputsAntes} inputs en ${ESPERA} s`,
  );
  await ctx.shot("el-mundo-decide");

  // ── 4 · la salida: la respuesta llega sola ────────────────────────────────
  const enPie = await esperarElDespertar(ctx, "el motor contesta tarde", { sim: 30 });
  ctx.expect("se levanta con la vida llena", enPie.hp === 100, JSON.stringify(enPie));
  await ctx.expectEspera(
    "y el cliente vuelve a mandar input",
    true,
    (n) => ((window.__qaCable.enviados.input ?? 0) > n ? true : null),
    { sim: 1, arg: inputsDespues },
  );
}
