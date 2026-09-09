/** El VOCABULARIO VISUAL del título: los átomos que comparten sus pantallas,
 *  medidos en el juego real y en las cinco pantallas a la vez.
 *
 *  Escrito por QA al validar la PR 1 de #346 («El título troceado»), que saca
 *  de `ui/title-screen.ts` a `ui/titulo/atomos.ts` las siete constantes de CSS,
 *  los dos escapes y la portada con su marcador. Ese movimiento se declaró
 *  «sin cambio de comportamiento» y se demostró con dos medidas de TEXTO —129
 *  líneas byte a byte y los 67 ids del DOM idénticos—. Las dos son necesarias y
 *  ninguna mira el juego: un `style="…"` sigue siendo el mismo string aunque
 *  quien lo pinta haya dejado de importar la constante y se haya quedado con
 *  una copia. Esto mira lo que ve el jugador.
 *
 *  Y sobre todo mira lo que las CINCO PANTALLAS SIGUIENTES pueden romper. El
 *  troceo continúa en cinco PR más, cada una llevándose una pantalla a su
 *  módulo; el modo de fallo de un movimiento así no es que una pantalla quede
 *  fea, es que el botón primario del home y el del selector dejen de ser el
 *  MISMO botón porque uno de los dos se llevó su CSS en la maleta. Eso compila,
 *  pasa el `tsc`, no toca ningún id del DOM y no lo ve ningún checker: el
 *  candado `las-hojas-del-titulo-no-se-atan-entre-si` impide el anillo, no la
 *  copia. Por eso el bloque 6 no compara contra una tabla sino las pantallas
 *  ENTRE SÍ.
 *
 *  Dos afirmaciones, y son distintas:
 *
 *   - **Los valores** (bloques 1-5): cada átomo pinta EXACTAMENTE lo que dice
 *     `ui/titulo/atomos.ts`, leído del `getComputedStyle` del elemento vivo. Es
 *     la tabla que se pone roja si alguien retoca un color «al mover».
 *   - **La unidad** (bloque 6): el primario es el mismo en las cinco pantallas,
 *     el secundario en las cuatro que lo tienen, el input en las tres, el
 *     select en las que lo tienen. Sin esto, seis copias divergentes pasarían
 *     los bloques 1-5 el día que la tabla se actualice de una en una.
 *
 *  Si un día el diseño CAMBIA a propósito, este guion se pone rojo y la tabla
 *  se actualiza en el mismo commit: eso es lo que se quiere: que un cambio de
 *  vocabulario visual sea una decisión escrita y no un efecto colateral.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server. No
 *  declara `sinMotor` porque el bloque 0 siembra una partida de verdad (es la
 *  única forma de que el home tenga una fila de save, que es donde viven los
 *  dos botones pequeños).
 */
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";

export const aisla = ["saves"];

const GAME_ID = "alta_fantasia";

/** Los átomos, como los declara `ui/titulo/atomos.ts`, traducidos a lo que
 *  devuelve `getComputedStyle`. Los hex del módulo, en rgb:
 *  #da6→221,170,102 · #111→17 · #999→153 · #444→68 · #3a6→51,170,102 ·
 *  #a55→170,85,85 · #533→85,51,51 · #1a1a22→26,26,34 · #ddd→221 ·
 *  #23222c→35,34,44 · #3a3846→58,56,70 · #a99→170,153,153.
 *
 *  `fuente` NO entra aquí a propósito: `font-family:inherit` resuelve a la
 *  pila que declara `game-ui.css`, que no es de este módulo. Entra en el
 *  bloque 6, donde lo que se compara es que las pantallas coincidan. */
const ATOMOS = {
  BTN_PRIMARY_CSS: {
    bg: "rgb(221, 170, 102)",
    color: "rgb(17, 17, 17)",
    borde: "0px none rgb(17, 17, 17)",
    padding: "10px 22px 10px 22px",
    fontSize: "14px",
    radio: "3px",
    cursor: "pointer",
  },
  BTN_SECONDARY_CSS: {
    bg: "rgba(0, 0, 0, 0)",
    color: "rgb(153, 153, 153)",
    borde: "1px solid rgb(68, 68, 68)",
    padding: "10px 22px 10px 22px",
    fontSize: "14px",
    radio: "3px",
    cursor: "pointer",
  },
  BTN_SMALL_PRIMARY_CSS: {
    bg: "rgb(51, 170, 102)",
    color: "rgb(255, 255, 255)",
    borde: "0px none rgb(255, 255, 255)",
    padding: "5px 12px 5px 12px",
    fontSize: "12px",
    radio: "3px",
    cursor: "pointer",
  },
  BTN_SMALL_DANGER_CSS: {
    bg: "rgba(0, 0, 0, 0)",
    color: "rgb(170, 85, 85)",
    borde: "1px solid rgb(85, 51, 51)",
    padding: "5px 12px 5px 12px",
    fontSize: "12px",
    radio: "3px",
    cursor: "pointer",
  },
  // SELECT_CSS e INPUT_CSS son la MISMA constante (`INPUT_CSS = SELECT_CSS`),
  // así que su tabla es una sola y el bloque 6 lo vuelve a afirmar cruzando
  // los `<input>` con los `<select>`.
  SELECT_CSS: {
    bg: "rgb(26, 26, 34)",
    color: "rgb(221, 221, 221)",
    borde: "1px solid rgb(68, 68, 68)",
    padding: "8px 10px 8px 10px",
    fontSize: "13px",
    radio: "0px",
  },
  BADGE_CSS: {
    bg: "rgb(35, 34, 44)",
    borde: "1px solid rgb(58, 56, 70)",
    padding: "1px 7px 1px 7px",
    fontSize: "10px",
    radio: "8px",
  },
};

/** Lo que se lee de un elemento vivo. Una sola función para las dos
 *  afirmaciones (la tabla y la unidad): con dos, el día que una mire
 *  `paddingTop` y la otra `padding` el bloque 6 sale verde comparando otra
 *  cosa. `cursor` y `color` se piden por nombre porque hay átomos donde el
 *  sitio de uso los pisa a propósito (el chip tiñe su `color` por estado, el
 *  badge del save añade `cursor`). */
function medir(sel, campos, raiz) {
  const el = (raiz ?? document).querySelector(sel);
  if (!el) return null;
  const s = getComputedStyle(el);
  const todo = {
    bg: s.backgroundColor,
    color: s.color,
    borde: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
    padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
    fontSize: s.fontSize,
    radio: s.borderTopLeftRadius,
    cursor: s.cursor,
    fuente: s.fontFamily,
  };
  return Object.fromEntries(campos.map((c) => [c, todo[c]]));
}

/** Lee en la página, con la MISMA `medir` serializada. */
function leer(ctx, sel, campos) {
  return ctx.page.evaluate(
    ([s, c, fn]) => new Function(`return (${fn})`)()(s, c),
    [sel, campos, medir.toString()],
  );
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esperado = (atomo) => ATOMOS[atomo];
const campos = (atomo) => Object.keys(ATOMOS[atomo]);

/** Afirma que `sel` pinta el átomo `atomo`, y devuelve lo leído para el
 *  bloque 6. `null` si el elemento no está (lo decide quien llama). */
async function afirmarAtomo(ctx, pantalla, sel, atomo) {
  const visto = await leer(ctx, sel, campos(atomo));
  if (visto === null) return null;
  ctx.expect(
    `${pantalla}: «${sel}» pinta ${atomo} tal como lo declara ui/titulo/atomos.ts`,
    igual(visto, esperado(atomo)),
    `esperado ${JSON.stringify(esperado(atomo))} · leído ${JSON.stringify(visto)}`,
  );
  return visto;
}

/** Los campos que el bloque 6 compara entre pantallas: los del átomo MÁS
 *  `fuente`, que es lo que delata una copia hecha con otra pila de fuentes. */
const camposUnidad = (atomo) => [...campos(atomo), "fuente"];

async function leerUnidad(ctx, sel, atomo) {
  return leer(ctx, sel, camposUnidad(atomo));
}

/** Los cinco elementos del bloque 6, por átomo: `[pantalla, selector]`. Se
 *  rellena a lo largo del recorrido y se compara al final. */
const unidad = { BTN_PRIMARY_CSS: [], BTN_SECONDARY_CSS: [], SELECT_CSS: [] };

async function apuntarUnidad(ctx, pantalla, sel, atomo) {
  const v = await leerUnidad(ctx, sel, atomo);
  if (v !== null) unidad[atomo].push([`${pantalla} ${sel}`, v]);
  return v;
}

async function volverAlSelector(ctx) {
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
}

export default async function (ctx) {
  // ── 0. Una partida sembrada: sin ella el home no tiene fila de save y los
  //       dos botones pequeños (la excepción declarada del corte) no existen.
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);
  await recargarAlTitulo(ctx);
  const filas = await ctx.page.evaluate(
    () => document.querySelectorAll('button[data-action="resume"]').length,
  );
  if (filas === 0) {
    ctx.sinMedir("el home no lista ninguna partida: los botones pequeños del save no existen");
    return;
  }
  ctx.log(`home con ${filas} partida(s) listada(s)`);

  // ── 1. El home ──────────────────────────────────────────────────────────
  await afirmarAtomo(ctx, "home", "#ts-new", "BTN_PRIMARY_CSS");
  await apuntarUnidad(ctx, "home", "#ts-new", "BTN_PRIMARY_CSS");
  await afirmarAtomo(ctx, "home", 'button[data-action="resume"]', "BTN_SMALL_PRIMARY_CSS");
  await afirmarAtomo(ctx, "home", 'button[data-action="delete"]', "BTN_SMALL_DANGER_CSS");
  // El badge de modo del save es `BADGE_CSS` + cursor + fuente: se afirma la
  // parte que NO se pisa en el sitio de uso.
  const badgeSave = await afirmarAtomo(ctx, "home", "button[data-mode-facet]", "BADGE_CSS");
  ctx.expect(
    "home: el badge de modo del save existe (si no, BADGE_CSS no se mide en el home)",
    badgeSave !== null,
    "ningún button[data-mode-facet] en la fila del save",
  );
  await ctx.shot("home-con-el-save");

  // ── 2. El selector de mundos ────────────────────────────────────────────
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await afirmarAtomo(ctx, "selector", "#ts-continue", "BTN_PRIMARY_CSS");
  await apuntarUnidad(ctx, "selector", "#ts-continue", "BTN_PRIMARY_CSS");
  await afirmarAtomo(ctx, "selector", "#ts-back", "BTN_SECONDARY_CSS");
  await apuntarUnidad(ctx, "selector", "#ts-back", "BTN_SECONDARY_CSS");
  await afirmarAtomo(ctx, "selector", "#ts-create-world", "BTN_SECONDARY_CSS");
  await afirmarAtomo(ctx, "selector", "#ts-upload-style", "BTN_SECONDARY_CSS");
  await afirmarAtomo(ctx, "selector", "#ts-style", "SELECT_CSS");
  await apuntarUnidad(ctx, "selector", "#ts-style", "SELECT_CSS");
  await afirmarAtomo(ctx, "selector", "[data-game-id] span[style*='border-radius:8px']", "BADGE_CSS");

  // La portada: caja de 192×128 (`COVER_BOX`) y el marcador SIEMPRE debajo
  // (#218) — las dos cosas viven hoy en `atomos.ts`, y las dos son lo primero
  // que ve quien abre el juego.
  const portadas = await ctx.page.evaluate(() =>
    [...document.querySelectorAll("[data-game-id]")].map((card) => {
      const box = card.querySelector("[data-cover-for]");
      const r = box?.getBoundingClientRect();
      return {
        juego: card.dataset.gameId,
        w: r ? Math.round(r.width) : null,
        h: r ? Math.round(r.height) : null,
        borde: box ? getComputedStyle(box).borderTopColor + " " + getComputedStyle(box).borderTopWidth : null,
        marcador: Boolean(box?.querySelector("[data-cover-marker]")),
        nombre: box?.querySelector("[data-cover-nombre]")?.textContent?.trim() ?? null,
      };
    }),
  );
  ctx.log(`portadas: ${JSON.stringify(portadas)}`);
  ctx.expect(
    "selector: hay tarjetas de mundo que medir",
    portadas.length > 0,
    "ninguna [data-game-id]",
  );
  ctx.expect(
    "selector: TODA portada mide 192×128 con su borde #333 (COVER_BOX)",
    portadas.every((p) => p.w === 192 && p.h === 128 && p.borde === "rgb(51, 51, 51) 1px"),
    JSON.stringify(portadas.map((p) => [p.juego, p.w, p.h, p.borde])),
  );
  ctx.expect(
    "selector: TODA portada lleva su marcador debajo con el nombre del estilo (#218)",
    portadas.every((p) => p.marcador && (p.nombre ?? "").length > 0),
    JSON.stringify(portadas.map((p) => [p.juego, p.marcador, p.nombre])),
  );
  await ctx.shot("selector-de-mundos");

  // ── 3. Crear mundo ──────────────────────────────────────────────────────
  await ctx.page.click("#ts-create-world");
  await ctx.page.waitForSelector("#ts-draft", { timeout: 30_000 });
  await afirmarAtomo(ctx, "crear-mundo", "#ts-create", "BTN_PRIMARY_CSS");
  await apuntarUnidad(ctx, "crear-mundo", "#ts-create", "BTN_PRIMARY_CSS");
  await afirmarAtomo(ctx, "crear-mundo", "#ts-back", "BTN_SECONDARY_CSS");
  await apuntarUnidad(ctx, "crear-mundo", "#ts-back", "BTN_SECONDARY_CSS");
  // `#ts-draft` es INPUT_CSS + `resize` y `min-height`: lo del átomo no lo pisa.
  await afirmarAtomo(ctx, "crear-mundo", "#ts-draft", "SELECT_CSS");
  await apuntarUnidad(ctx, "crear-mundo", "#ts-draft", "SELECT_CSS");
  await volverAlSelector(ctx);

  // ── 4. Subir estilo ─────────────────────────────────────────────────────
  await ctx.page.click("#ts-upload-style");
  await ctx.page.waitForSelector("#ts-style-name", { timeout: 30_000 });
  await afirmarAtomo(ctx, "subir-estilo", "#ts-upload", "BTN_PRIMARY_CSS");
  await apuntarUnidad(ctx, "subir-estilo", "#ts-upload", "BTN_PRIMARY_CSS");
  await afirmarAtomo(ctx, "subir-estilo", "#ts-back", "BTN_SECONDARY_CSS");
  await afirmarAtomo(ctx, "subir-estilo", "#ts-style-name", "SELECT_CSS");
  await apuntarUnidad(ctx, "subir-estilo", "#ts-style-name", "SELECT_CSS");
  await ctx.shot("subir-estilo");
  await volverAlSelector(ctx);

  // ── 5. El editor de personaje ───────────────────────────────────────────
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  await ctx.page.click("#ts-charmode [data-charmode='vector']");
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await afirmarAtomo(ctx, "editor", "#ts-start", "BTN_PRIMARY_CSS");
  await apuntarUnidad(ctx, "editor", "#ts-start", "BTN_PRIMARY_CSS");
  await afirmarAtomo(ctx, "editor", "#ts-back", "BTN_SECONDARY_CSS");
  await apuntarUnidad(ctx, "editor", "#ts-back", "BTN_SECONDARY_CSS");
  // `#ts-model` solo existe si el censo trae modelos con hojas completas: se
  // apunta si está y se DICE si no, en vez de dar por medido lo que no se midió.
  const model = await afirmarAtomo(ctx, "editor", "#ts-model", "SELECT_CSS");
  if (model === null) ctx.log("editor: sin #ts-model (censo sin modelos completos) — SELECT_CSS no se mide aquí");
  else await apuntarUnidad(ctx, "editor", "#ts-model", "SELECT_CSS");
  await ctx.shot("editor-de-personaje");

  // ── 6. La UNIDAD: el mismo átomo en todas las pantallas ─────────────────
  for (const [atomo, vistos] of Object.entries(unidad)) {
    const nombres = vistos.map(([n]) => n);
    ctx.log(`${atomo} medido en ${vistos.length}: ${nombres.join(" · ")}`);
    ctx.expect(
      `${atomo} se mide en al menos TRES pantallas (si no, «coinciden» no dice nada)`,
      vistos.length >= 3,
      `solo ${vistos.length}: ${nombres.join(", ")}`,
    );
    const [refN, ref] = vistos[0] ?? ["", null];
    const distintos = vistos.filter(([, v]) => !igual(v, ref)).map(([n, v]) => `${n} → ${JSON.stringify(v)}`);
    ctx.expect(
      `${atomo} es EL MISMO en todas las pantallas del título (una copia divergente no compila distinto: se ve)`,
      distintos.length === 0,
      `referencia ${refN} → ${JSON.stringify(ref)} · difieren: ${distintos.join(" | ")}`,
    );
  }

  // Y el cruce que afirma `INPUT_CSS === SELECT_CSS`: el `<textarea>` del
  // borrador y el `<select>` de estilo son el mismo átomo, no dos parecidos.
  const conSelect = unidad.SELECT_CSS.filter(([n]) => n.includes("#ts-style") || n.includes("#ts-model"));
  const conInput = unidad.SELECT_CSS.filter(([n]) => n.includes("#ts-draft") || n.includes("#ts-style-name"));
  ctx.expect(
    "INPUT_CSS y SELECT_CSS siguen siendo la MISMA constante: input y select pintan igual",
    conSelect.length > 0 && conInput.length > 0 && igual(conSelect[0][1], conInput[0][1]),
    `select ${JSON.stringify(conSelect[0]?.[1])} · input ${JSON.stringify(conInput[0]?.[1])}`,
  );
}
