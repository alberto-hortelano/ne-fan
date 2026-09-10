/** LA MIRILLA SE VE (#483): el punto del centro está POR ENCIMA del lienzo del
 *  mundo, no debajo.
 *
 *  Por qué hacía falta otro guion sobre la mirilla habiendo tres (10, 61, 79):
 *  los tres leen `#reticle[data-target]`, o sea el ESTADO, y el defecto no era
 *  de estado. `FpsRenderer` inserta su `<canvas>` como hijo de `#app-shell`, es
 *  decir DESPUÉS de `#game-ui` en el DOM; los dos eran `position:absolute` con
 *  `z-index:auto`, así que ganaba el último y el mundo se pintaba ENCIMA de
 *  todo lo de la UI de juego que no llevara banda propia. Las regiones y el
 *  diálogo se salvaban por sus `--z-*` y las etiquetas por el `zIndex` inline
 *  de `world-labels.ts`; `#reticle` no tenía nada. Medido por QA del corte 2 de
 *  #358: estilo computado impecable (`opacity 1`, `background` de acento) y en
 *  los píxeles, la cabeza del NPC. Los tres guiones, verdes.
 *
 *  CÓMO SE MIDE UNA CAPA SIN LEER PÍXELES. `document.elementFromPoint` en el
 *  centro EXACTO de la mirilla devuelve el elemento que está más arriba en ese
 *  punto, con el mismo orden de apilamiento con el que se pinta. Hay que
 *  habilitar `pointer-events` en la sonda a propósito —`#game-ui` los tiene en
 *  `none` para que el hueco entre paneles siga llegando al lienzo (pointer
 *  lock, clicks)— y se restaura al terminar: el instrumento no puede quedarse
 *  puesto. Con el defecto la respuesta es `canvas#fps-canvas`; con la capa
 *  decidida, `div#reticle`.
 *
 *  Los tres bloques miden la misma capa en los tres estados en los que el
 *  jugador la mira: sin nada delante, enfilando a un vecino (con la mirilla
 *  encendida, que es cuando importa) y con el HUD relleno.
 *
 *  PROBADO EN NEGATIVO (2026-09-10), quitando a la vez las tres declaraciones
 *  que ponen la capa (`#game-ui { z-index: 1 }` y `#reticle { z-index:
 *  var(--z-hud) }` en game-ui.css, `#app-shell > canvas { z-index: 0 }` en
 *  base.css): los tres asertos de capa se ponen rojos —`z-index: auto` en los
 *  tres nodos y `arriba: canvas#fps-canvas` en el centro, con y sin la mirilla
 *  encendida—, y el del solape de paneles se queda verde, que es correcto: mide
 *  otra cosa. El aserto de la banda de `#reticle` va aparte del de sus padres
 *  a propósito: es lo que impide que un hermano con `z-index` vuelva a taparla
 *  sin que nadie se entere.
 *
 *  Cero créditos: fixture commiteada del selector «Room», sin partida ni motor.
 */
import { cargarFixture } from "../lib/fixtures.mjs";

const FIXTURE = "robledo_tile";

/** Qué elemento está ARRIBA en el centro de la mirilla. La sonda enciende los
 *  `pointer-events` del punto, pregunta y los deja como estaban. */
function quienTapaLaMirilla() {
  const reticle = document.getElementById("reticle");
  if (!reticle) return { error: "no hay #reticle en el DOM" };
  const previo = reticle.style.pointerEvents;
  reticle.style.pointerEvents = "auto";
  try {
    const r = reticle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const arriba = document.elementFromPoint(x, y);
    const canvas = document.getElementById("fps-canvas");
    return {
      centro: [Math.round(x), Math.round(y)],
      arriba: arriba ? `${arriba.tagName.toLowerCase()}${arriba.id ? `#${arriba.id}` : ""}` : null,
      esLaMirilla: arriba === reticle,
      zMirilla: getComputedStyle(reticle).zIndex,
      zUi: getComputedStyle(document.getElementById("game-ui")).zIndex,
      zLienzo: canvas ? getComputedStyle(canvas).zIndex : null,
      target: reticle.dataset.target ?? null,
      // Lo que ya miraban los otros tres guiones, para que el rojo diga si el
      // problema es el estado o la capa.
      opacidad: getComputedStyle(reticle).opacity,
    };
  } finally {
    reticle.style.pointerEvents = previo;
  }
}

/** El vecino más cercano de la fixture, para enfilarlo. */
function vecinoMasCercano() {
  const p = window.__nefan.state().pos;
  const npcs = window.__nefan.npcs();
  if (npcs.length === 0) return null;
  return npcs
    .map((n) => ({ id: n.id, pos: n.pos, d: Math.hypot(n.pos.x - p.x, n.pos.z - p.z) }))
    .sort((a, b) => a.d - b.d)[0];
}

export default async function (ctx) {
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, FIXTURE);

  // ── 1 · Sin nada delante: la mirilla está por encima del mundo ───────────
  const suelta = await ctx.page.evaluate(quienTapaLaMirilla);
  ctx.log(`mirilla en reposo: ${JSON.stringify(suelta)}`);
  ctx.expect(
    "el lienzo del mundo y la UI de juego tienen capa DECIDIDA (0 y 1), no `auto`",
    suelta.zLienzo === "0" && suelta.zUi === "1",
    `lienzo ${suelta.zLienzo} · #game-ui ${suelta.zUi}`,
  );
  ctx.expect(
    "la mirilla lleva su propia banda del HUD y no depende del orden del DOM",
    suelta.zMirilla === "20",
    `z-index de #reticle: ${suelta.zMirilla}`,
  );
  ctx.expect(
    "en el centro de la pantalla, el elemento de arriba es la MIRILLA y no el lienzo (#483)",
    suelta.esLaMirilla === true,
    `arriba: ${suelta.arriba} · centro ${JSON.stringify(suelta.centro)}`,
  );
  await ctx.shot("mirilla-en-reposo");

  // ── 2 · Enfilando a un vecino: encendida y VISIBLE ───────────────────────
  // Es el estado del issue: la mirilla en acento es la única señal de «esto se
  // puede tratar» en primera persona, y era la que no llegaba a la pantalla.
  const vecino = await ctx.page.evaluate(vecinoMasCercano);
  if (!vecino) {
    ctx.sinMedirBloque(`la fixture ${FIXTURE} no trajo ningún NPC al que enfilar`);
  } else {
    const x = vecino.pos.x + 2.5;
    const z = vecino.pos.z;
    await ctx.nefan("setPlayerPos", x, z);
    await ctx.nefan("setYaw", Math.atan2(vecino.pos.x - x, vecino.pos.z - z));
    const { ultimo: enfilado } = await ctx.expectEspera(
      `enfilar a ${vecino.id} enciende la mirilla (data-target)`,
      true,
      () => (document.getElementById("reticle")?.dataset.target === "true" ? true : null),
      { ms: 15_000 },
    );
    if (enfilado) {
      const mirando = await ctx.page.evaluate(quienTapaLaMirilla);
      ctx.log(`mirilla enfilando a ${vecino.id}: ${JSON.stringify(mirando)}`);
      ctx.expect(
        "con la mirilla ENCENDIDA, el elemento de arriba en su centro sigue siendo ella",
        mirando.esLaMirilla === true && mirando.target === "true",
        `arriba: ${mirando.arriba} · data-target ${mirando.target}`,
      );
      await ctx.shot("mirilla-encendida-sobre-el-vecino");
    }
  }

  // ── 3 · Con el HUD relleno: ningún panel se la lleva por delante ─────────
  // La mirilla vive en la banda del HUD (20) y las regiones también: si alguien
  // le pusiera encima un panel a pantalla completa, aquí se vería.
  const conHud = await ctx.page.evaluate(() => {
    const r = document.getElementById("reticle").getBoundingClientRect();
    const paneles = [...document.querySelectorAll("#game-ui .nf-panel")]
      .filter((p) => !p.hidden)
      .map((p) => {
        const c = p.getBoundingClientRect();
        return { id: p.id, tapa: c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top };
      });
    return paneles;
  });
  ctx.log(`paneles visibles del HUD: ${JSON.stringify(conHud)}`);
  ctx.expect(
    "ningún panel visible del HUD se solapa con el centro de la mirilla",
    conHud.every((p) => !p.tapa),
    JSON.stringify(conHud.filter((p) => p.tapa)),
  );
}
