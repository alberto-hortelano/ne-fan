/** El enemigo que mataste SIGUE muerto después de que te maten a ti y pulses R
 *  (#613, pieza C2).
 *
 *  La decisión del usuario del 2026-08-31 es que «el muerto lo está para
 *  siempre», y el SAVE la cumplía desde #326 (`session/mundo-persistido.ts`,
 *  «LA MUERTE ES ABSORBENTE»). El SIM no: `GameSimulation.respawn` subía a
 *  TODO no-jugador a `maxHealth`, así que el `state_update` del respawn traía
 *  al bandido que acababas de matar `alive:true` a 60, de pie y pegando —
 *  hasta el siguiente resume, en el que desaparecía porque el save decía que
 *  estaba muerto. Dos verdades en la misma partida.
 *
 *  El escenario, entero por el camino del jugador y desde el arranque:
 *   1 · se mata al bandido del tile de bootstrap (se le pega hasta que su
 *       barra llega a 0);
 *   2 · se habla con el tabernero hasta que el motor falso manda al Secuaz
 *       (turno 2 de diálogo, como en el guion 41);
 *   3 · el jugador se queda quieto hasta que el Secuaz lo mata;
 *   4 · R hasta que el jugador está en pie;
 *   5 · Y AQUÍ LA MEDIDA: durante 3 s de simulación tras reaparecer, el
 *       bandido NO vuelve a estar vivo en `__nefan.enemies()` — ni desaparece
 *       de la lista (un cadáver que se va tampoco es lo que el jugador dejó).
 *
 *  Lo que NO mide, a propósito: dónde reapareces, si el Secuaz sigue
 *  enganchado y si se cura a tope al morir tú. Son las piezas A, B y C1 de
 *  #613, que el usuario decidió el 2026-09-29 y mide el guion 260.
 *
 *  Si el bandido mata al jugador ANTES de caer, o el Secuaz no llega a matarlo,
 *  el escenario no existe y el guion lo DECLARA (⊘), no sale verde.
 *
 *  EN NEGATIVO (2026-09-29, tanda BK): quitando la guarda
 *  `if (c.health <= 0) continue;` de `GameSimulation.respawn`
 *  (`nefan-core/src/simulation/game-loop.ts`), este guion se pone rojo en
 *  «tras reaparecer, el bandido que mataste NO vuelve a estar vivo». La salida
 *  está en el implementacion.md de la tanda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `saves`   — la partida tiene que arrancar en el tile de bootstrap, que
 *                 es el que trae al bandido.
 *   · `fake-ai` — `fakeDialogueTurn` hace determinista que el Secuaz llegue
 *                 en el segundo turno de diálogo; heredado caliente se movería. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
/** Segundos de MUNDO que se observa al bandido tras reaparecer. Cada tick del
 *  bridge trae un `state_update` con su `alive`, así que tres segundos son
 *  decenas de frames: si el sim lo hubiera levantado, alguno lo diría. */
const OBSERVAR_TRAS_REAPARECER = 3;

/** El bandido tal y como lo tiene el cliente. */
const bandidoEnElCliente = (ctx) =>
  ctx.page.evaluate((id) => {
    const e = window.__nefan.enemies().find((x) => x.id === id);
    return e ? { alive: e.alive, hp: e.hp } : null;
  }, BANDIDO);

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
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
  if (caido?.jugadorMuerto) {
    ctx.sinMedir(
      "el bandido mató al jugador antes de caer: sin un enemigo muerto delante no existe el escenario " +
        "de esta medida (reaparecer junto a un muerto), y el rojo diría otra cosa",
    );
  }
  ctx.expect("el jugador mata al bandido (su barra llega a 0)", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;
  const muertoAntes = await bandidoEnElCliente(ctx);
  ctx.expect(
    "antes de morir tú, el cliente lo tiene muerto: `alive:false` y 0 PV",
    muertoAntes?.alive === false && muertoAntes?.hp === 0,
    JSON.stringify(muertoAntes),
  );

  // ── 2 · el motor manda al Secuaz ────────────────────────────────────────
  const idsAntes = await ctx.page.evaluate(() => window.__nefan.enemies().map((e) => e.id));
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    30_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  const secuaz = await ctx.waitFor(
    "el motor materializa al Secuaz (spawn_entity del turno 2)",
    (previos) => window.__nefan.enemies().find((e) => !previos.includes(e.id)) ?? null,
    90_000,
    idsAntes,
  );
  ctx.log(`secuaz: ${JSON.stringify(secuaz)}`);
  await ctx.nefan("advanceDialogue");
  await ctx.waitFor("la conversación se cierra", () => (window.__nefan.dialogueVisible ? null : true), 15_000);

  // ── 3 · el Secuaz mata al jugador ───────────────────────────────────────
  // Quieto y sin devolver golpes: la IA de combate cierra la distancia sola.
  const muerte = await ctx.absorbe(
    "cortafuegos de la espera a que el Secuaz mate al jugador: es PRECONDICIÓN del escenario, no la " +
      "medida; si expira, la rama de abajo lo declara ⊘ con `ctx.sinMedir`",
    () =>
      ctx.waitFor(
        "el Secuaz mata al jugador",
        () => (Number(document.getElementById("player-hp-text")?.textContent ?? 1) <= 0 ? true : null),
        { sim: 120 },
      ),
  );
  if (!muerte) {
    ctx.sinMedir(
      "el Secuaz no mató al jugador en 120 s de simulación: sin morir no hay R que pulsar, y la medida " +
        "de este guion (el muerto sigue muerto al reaparecer) no se puede tomar",
    );
  }
  await ctx.shot("jugador-muerto-junto-al-bandido-caido");

  // ── 4 · R ───────────────────────────────────────────────────────────────
  const enPie = await ctx.waitFor(
    "el jugador reaparece al pulsar R",
    () => {
      const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
      if (hp > 0) return { hp };
      window.__nefan.inputDriver.queueRespawn();
      return null;
    },
    15_000,
  );
  ctx.log(`el jugador está en pie con ${enPie.hp} PV`);

  // ── 5 · LA MEDIDA ───────────────────────────────────────────────────────
  // «Debe NO ocurrir»: que el bandido esté vivo, con vida, o que se haya ido
  // de la lista. Las tres son el defecto visto por el jugador.
  await ctx.expectEspera(
    "tras reaparecer, el bandido que mataste NO vuelve a estar vivo (ni desaparece de la lista)",
    false,
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      if (!e) return { desaparecido: true };
      if (e.alive !== false || (e.hp ?? 0) > 0) return { alive: e.alive, hp: e.hp };
      return null;
    },
    { sim: OBSERVAR_TRAS_REAPARECER, arg: BANDIDO },
  );
  const despues = await bandidoEnElCliente(ctx);
  ctx.expect(
    "al final de la observación el bandido sigue `alive:false` y a 0 PV",
    despues?.alive === false && despues?.hp === 0,
    JSON.stringify(despues),
  );
  const sigueElSecuaz = await ctx.page.evaluate(
    (id) => window.__nefan.enemies().some((e) => e.id === id),
    secuaz.id,
  );
  ctx.expect(
    "el Secuaz sigue en la lista (a los vivos los mide el guion 260)",
    sigueElSecuaz,
    secuaz.id,
  );
  await ctx.shot("tras-reaparecer-el-bandido-sigue-caido");
}
