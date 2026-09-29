/** Una poción cura: el motor emite `player_healed` y la barra de vida sube,
 *  topada en el máximo (#613, pieza D).
 *
 *  La decisión del usuario del 2026-09-29 («se cura por consecuencias»): la
 *  única curación del juego la da el motor narrativo —pociones, curanderos—
 *  con la consequence `player_healed`. Hasta esta tanda el reducer existía y
 *  nadie la producía: la única forma de recuperar vida era morir.
 *
 *  El escenario, entero por el camino del jugador y desde el arranque:
 *   1 · el jugador se deja herir por el bandido del tile de bootstrap hasta
 *       quedar a 90 PV o menos, y después lo mata: herido es lo que hace falta
 *       para ver subir la barra;
 *   2 · se habla con el tabernero y se le escribe la marca de la poción en el
 *       texto libre (`UNA POCION`, `labs/narrative/fake-ai-server.ts`): el
 *       motor falso contesta con un diálogo y `player_healed{10}`;
 *   3 · LA MEDIDA, turno a turno: la vida del HUD pasa a min(antes + 10,
 *       máximo) —ni más, ni menos— y se repite hasta topar, para ver también
 *       que no pasa del máximo.
 *
 *  Si el jugador sale de la pelea sin un rasguño, o muere, el escenario no
 *  existe y se DECLARA (⊘).
 *
 *  EN NEGATIVO (2026-09-29, tanda BN): ver `implementacion.md` de la tanda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, dejarseHerirHasta, herirHasta } from "../lib/combate.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `saves`   — la partida tiene que arrancar en el tile de bootstrap, que
 *                 es el que trae al bandido y al tabernero.
 *   · `fake-ai` — los turnos de diálogo del motor falso ponen hostiles; con el
 *                 contador heredado de otro guion podrían caer a mitad. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
/** La marca y la cantidad del motor falso (no se importan: el fake es TS y
 *  este guion es el banco). Si cambian allí, este guion se pone rojo en la
 *  primera subida, que es donde tiene que verse. */
const MARCA_POCION = "UNA POCION";
const POCION_PV = 10;

const vidaDelHud = (ctx) =>
  ctx.page.evaluate(() => ({
    hp: Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"),
    max: Number((document.getElementById("player-hp-max")?.textContent ?? "").replace(/[^\d.]/g, "")),
  }));

/** El panel de diálogo TERMINADO de pintar: con el typewriter corriendo, la
 *  primera `T` solo completa el texto y no abre la caja (medido en el guion
 *  118, de donde sale esta espera). */
const panelPintado = (ctx) =>
  ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && botones > 0 && texto === d.text ? { botones } : null;
    },
    60_000,
  );

/** Una poción: la marca por el texto libre y esperar a que el motor conteste. */
async function beberUnaPocion(ctx, n) {
  await panelPintado(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    `T abre la caja de texto libre (poción ${n})`,
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  const antes = await ctx.page.evaluate(() => window.__nefan.dialogue().text);
  await ctx.page.keyboard.type(MARCA_POCION);
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFor(
    `el motor contesta a la poción ${n}`,
    (t) => {
      const d = window.__nefan.dialogue();
      return d.visible && d.text && d.text !== t ? true : null;
    },
    60_000,
    antes,
  );
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  await comenzar(ctx);

  // ── 1 · herirse matando al bandido ──────────────────────────────────────
  await ctx.waitFor(
    `el bandido "${BANDIDO}" está en escena`,
    (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null,
    60_000,
    BANDIDO,
  );
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  // Herirse A PROPÓSITO antes de pelear (QA H8 de BN): antes la herida
  // dependía de cómo saliera la pelea, y alguna corrida acababa a 100/100.
  const herida = await dejarseHerirHasta(ctx, BANDIDO, 90, { sim: 60 });
  if (!herida) ctx.sinMedir("el bandido no hirió al jugador en 60 s de mundo: no hay vida que subir");
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) {
    ctx.sinMedir("el bandido mató al jugador: un muerto no se cura (solo R lo levanta), no hay qué medir");
  }
  ctx.expect("el jugador mata al bandido (su barra llega a 0)", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;
  const herido = await vidaDelHud(ctx);
  ctx.log(`tras la pelea: ${herido.hp} / ${herido.max}`);
  ctx.expect("el HUD dice el máximo (si no, el tope no se puede medir)", herido.max > 0, JSON.stringify(herido));
  if (!(herido.hp < herido.max)) {
    ctx.sinMedir(`el jugador salió de la pelea sin un rasguño (${herido.hp}/${herido.max}): no hay vida que subir`);
  }

  // ── 2 · hablar con el tabernero ─────────────────────────────────────────
  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    30_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);

  // ── 3 · LA MEDIDA: cada poción sube min(+10, hasta el máximo) ───────────
  let vida = herido.hp;
  for (let n = 1; n <= 12 && vida < herido.max; n++) {
    const esperada = Math.min(vida + POCION_PV, herido.max);
    await beberUnaPocion(ctx, n);
    const { ultimo } = await ctx.expectEspera(
      `la poción ${n} deja la vida en ${esperada} (de ${vida}, +${POCION_PV}, tope ${herido.max})`,
      true,
      (e) => {
        const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
        return hp === e ? { hp } : null;
      },
      { sim: 2, arg: esperada },
    );
    vida = ultimo?.hp ?? vida;
  }
  ctx.expect("tras las pociones, la vida está EN el máximo", vida === herido.max, `${vida} / ${herido.max}`);
  // Y el tope es tope: una más con la vida llena no la sube.
  await beberUnaPocion(ctx, "de más");
  await ctx.expectEspera(
    `con la vida llena, otra poción no la pasa de ${herido.max}`,
    false,
    (m) => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
      return hp > m ? { hp } : null;
    },
    { sim: 2, arg: herido.max },
  );
  await ctx.shot("curado-hasta-el-maximo");
}
