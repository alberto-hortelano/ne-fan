/** Si el mundo no puede decidir dónde despiertas, SE DICE y se reintenta con R
 *  (#613, «que decida el motor»: fallos sin respaldo mudo).
 *
 *  El motor puede caerse justo cuando el jugador muere. Lo que el jugador no
 *  puede ver es un velo que dice «el mundo decide…» para siempre: el fallo
 *  tiene que llegar con su motivo, y tiene que haber una tecla que lo vuelva a
 *  intentar. Y R no puede ser un atajo al margen del motor: en partida, R
 *  REINTENTA, no levanta al jugador por su cuenta.
 *
 *  El escenario, por el camino del jugador y desde el arranque:
 *   1 · el motor falso falla ante una muerte (`/dev/despertar error`);
 *   2 · ir andando hasta el bandido y morir;
 *   3 · LA MEDIDA del fallo: el velo pasa a decir el motivo, se ofrece
 *       «R · reintentar», y el jugador SIGUE caído (nadie le levanta a ciegas);
 *   4 · el motor vuelve (`normal`) y el jugador pulsa R: despierta, a tope, y
 *       el velo se va.
 *
 *  EN NEGATIVO (tanda BN): tragándose el fallo en el bridge (el `fallo()` de
 *  `bridge/handlers/despertar.ts` sin difundir el `narrative_status`), el paso
 *  3 es rojo: el velo se queda en «decidiendo» y no hay R.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, conductaDelDespertar } from "../lib/combate.mjs";

/** `saves`: el tile de bootstrap trae al bandido. `fake-ai`: el guion cambia
 *  cómo contesta el motor ante una muerte, y el reset lo devuelve a `normal`. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";

export default async function (ctx) {
  await conductaDelDespertar(ctx, "error");
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  await comenzar(ctx);

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

  // ── 3 · el fallo se dice, con tecla ───────────────────────────────────────
  const aviso = await ctx.expectEspera(
    "el velo dice por qué no despiertas —«pulsa R»— y ofrece «R · reintentar»",
    true,
    () => {
      const v = document.getElementById("velo-del-despertar");
      const texto = document.getElementById("velo-del-despertar-texto")?.textContent ?? "";
      const r = window.__nefan.ui.actions().prompt.find((a) => a.id === "respawn");
      // El motivo dice lo que el caído PUEDE hacer —R— y no el consejo de un
      // diálogo (QA S1 de BN: «prueba a decir otra cosa»).
      return v && !v.hidden && /pulsa R/.test(texto) && !/decir otra cosa/.test(texto) && r?.label === "reintentar"
        ? { texto }
        : null;
    },
    { sim: 5 },
  );
  ctx.log(`el velo dice: ${JSON.stringify(aviso.ultimo)}`);
  await ctx.shot("el-mundo-no-decide");
  await ctx.expectEspera(
    "mientras nadie reintenta, el jugador sigue caído (el fallo no levanta a nadie)",
    false,
    () => (Number(document.getElementById("player-hp-text")?.textContent ?? "NaN") > 0 ? true : null),
    { sim: 2 },
  );

  // ── 4 · el motor vuelve, y R reintenta ────────────────────────────────────
  await conductaDelDespertar(ctx, "normal");
  await ctx.nefan("inputDriver.queueRespawn");
  await ctx.expectEspera(
    "con el motor de vuelta, R reintenta y el jugador despierta a tope, sin velo",
    true,
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      const velo = document.getElementById("velo-del-despertar")?.hidden === false;
      return hp === 100 && !velo ? { hp } : null;
    },
    { sim: 10 },
  );
  await ctx.shot("despierto-tras-reintentar");
}
