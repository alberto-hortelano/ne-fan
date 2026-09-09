/** EL PROGRESO DE PRE-GENERACIÓN espera en la tarjeta de su mundo, esté donde
 *  esté el jugador — y cuando falla, lo dice.
 *
 *  Escrito por QA al validar la PR 5 de #346 («El título troceado»), que es
 *  la que MUEVE ESTA COSTURA: `renderGameGenProgress` deja de ser un método de
 *  la clase y pasa a ser `pintarProgresoDeMundo(line, estado)`, una función de
 *  `ui/titulo/selector-de-mundo.ts` que **recibe el estado ya resuelto** en vez
 *  del `gameId`. El mapa por juego (`gameGenStatus`, #313) y la memoria de qué
 *  tarjeta se mira (`lastSelectedGameId`) se quedan en la raíz, que es quien
 *  escucha al bridge; la hoja los ve por dos callbacks (`progresoDe`,
 *  `recordarMundo`). Antes esa resolución ocurría DENTRO de la función; ahora
 *  ocurre en los dos sitios que la llaman, y son dos sitios distintos: el
 *  oyente del bridge (que resuelve por `progresoDelMundoMirado()`) y el panel
 *  de generación de la hoja (que resuelve por `deps.progresoDe(...)`). Que las
 *  dos mitades sigan diciendo lo mismo es lo que este guion afirma.
 *
 *  POR QUÉ HACÍA FALTA. El 38 mide la mitad que ya existía —que el progreso de
 *  A no se pinta bajo la tarjeta de B (#313), y que una pre-generación de
 *  verdad llega a `ready`— pero SIEMPRE con el selector delante y siempre con
 *  la fase `progress`. Los tres estados que esta costura cruza y que no pisaba
 *  nadie son:
 *   · el estado que llega **mientras la línea no existe** (el jugador está en
 *     el home, o todavía no ha abierto el selector): el oyente de la raíz se
 *     encuentra `line === null`, apunta en el mapa y no pinta. Si el mapa
 *     dejara de ser suyo —o la hoja se lo llevara—, ese progreso se perdería y
 *     nadie se enteraría hasta abrir el selector;
 *   · la tarjeta **SIN estado**, que tiene que dejar la línea vacía Y BORRAR
 *     `data-gen-phase`. No es cosmética: es el dato por el que espera
 *     `regenerarMundo` (`qa/lib/sesion.mjs`), así que una fase terminal que se
 *     quedara pegada de la tarjeta anterior daría por terminada una generación
 *     que no ha empezado;
 *   · la rama de **error**, el `<span>` rojo, que no ejerce ningún guion: el 38
 *     conduce el camino vivo y el `ready`. Es la única de las tres fases que
 *     además escribe en el registro de errores desde la raíz.
 *
 *  CÓMO SE ENTREGA EL PROGRESO, y por qué así. Los `narrative_status` se
 *  entregan A MANO por el socket que el cliente ya tiene abierto, con la MISMA
 *  forma que el 38 registró de los frames reales (`kind:"game_gen"`, `phase`,
 *  `gameId`, `message`, sin sello de sesión). Es la técnica que el 38 estrenó y
 *  el motivo es el mismo: lo que se mide es el REPARTO y el PINTADO, no el
 *  motor. Encolar dos generaciones de verdad para llegar aquí sería lento, no
 *  daría nunca la fase `error` a voluntad y dejaría el guion a merced de qué
 *  tarda cada job. Todo lo demás —abrir el selector, cambiar de tarjeta,
 *  volver al home— es el camino del jugador, con sus clicks.
 *
 *  Cero créditos: no arranca partida, no pide una imagen y NO PULSA
 *  `#ts-gen-world` ni `#ts-apply-style`. No encola ni una generación: por eso
 *  puede declarar `sinMotor`.
 */
import { esperarListaDeSaves, esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";

export const sinMotor =
  "conduce el título y ENTREGA los narrative_status por el socket ya abierto: no encola ninguna generación ni arranca partida";

/** Guarda los sockets que abre la página para poder entregarles un frame.
 *  Va como `addInitScript` (antes de que cargue la app) porque el cliente abre
 *  el suyo en el arranque. Es la mitad «entregar» del espía del 38, sin la
 *  mitad «registrar», que aquí no hace falta. */
function coleccionarSockets() {
  const Original = window.WebSocket;
  window.__qaSockets = [];
  const Envuelto = function (...args) {
    const sock = new Original(...args);
    window.__qaSockets.push(sock);
    return sock;
  };
  Envuelto.prototype = Original.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Envuelto[k] = Original[k];
  window.WebSocket = Envuelto;
}

/** Entrega UN `narrative_status` de pre-generación por el socket vivo del
 *  bridge, como si lo hubiera mandado él. */
function entregar(ctx, marco) {
  return ctx.page.evaluate((m) => {
    const vivos = (window.__qaSockets ?? []).filter(
      (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
    );
    if (vivos.length === 0) throw new Error("ningún socket del bridge donde entregar");
    vivos[vivos.length - 1].onmessage({
      data: JSON.stringify({ type: "narrative_status", kind: "game_gen", ...m }),
    });
    return vivos.length;
  }, marco);
}

/** Lo que se lee de la línea de progreso: si existe, qué dice, en qué fase
 *  está y de qué COLOR la ve el jugador (el `<span>` que pinta la función). */
const laLinea = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("ts-gen-progress");
    if (!el) return { hay: false, texto: "", fase: null, color: "", atributo: false };
    return {
      hay: true,
      texto: el.textContent ?? "",
      fase: el.dataset.genPhase ?? null,
      color: el.firstElementChild?.style?.color ?? "",
      atributo: el.hasAttribute("data-gen-phase"),
    };
  });

/** El id del mundo cuya tarjeta está marcada como activa, leído del BORDE que
 *  pinta `refreshSelection` — que es como lo ve el jugador. */
const laTarjetaMirada = (ctx) =>
  ctx.page.evaluate(() => {
    const activa = [...document.querySelectorAll("[data-game-id]")].find(
      (c) => c.style.borderColor === "rgb(221, 170, 102)",
    );
    return activa?.dataset.gameId ?? null;
  });

const erroresDelRegistro = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.children.length ?? -1);

/** Marca el nodo de la lista de mundos para poder saber si el título se
 *  REPINTÓ solo: `content.innerHTML = …` crea uno nuevo y la marca se pierde. */
const marcarLaLista = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("ts-worlds");
    if (!el) throw new Error("no hay lista de mundos que marcar");
    el.__qaMarca = 1;
  });

export default async function (ctx) {
  await ctx.page.addInitScript(coleccionarSockets);
  await recargarAlTitulo(ctx);

  // Calentamiento: se abre el selector una vez para saber QUÉ TARJETA viene
  // seleccionada al entrar desde el home (`ir({a:"selector"})` va sin
  // preselección, así que es `games[0]`) y cuál es la otra. Se leen del DOM en
  // vez de escribirlas a mano: el catálogo del bench puede cambiar de orden y
  // un id fijo convertiría eso en un rojo que no habla de nada.
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  const [MUNDO_A, MUNDO_B] = await ctx.page.evaluate(() =>
    [...document.querySelectorAll("[data-game-id]")].slice(0, 2).map((c) => c.dataset.gameId),
  );
  ctx.log(`mundo que viene seleccionado al entrar: ${MUNDO_A} · el otro: ${MUNDO_B}`);
  ctx.expect(
    "el bench ofrece al menos dos mundos (sin el segundo, «la tarjeta sin estado» no se puede medir)",
    Boolean(MUNDO_A) && Boolean(MUNDO_B) && MUNDO_A !== MUNDO_B,
    `${MUNDO_A} · ${MUNDO_B}`,
  );
  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // ── A · el progreso que llega cuando la LÍNEA NO EXISTE ────────────────
  const enElHome = await laLinea(ctx);
  ctx.expect(
    "en el home no hay línea de progreso donde pintar (el estado de partida del bloque)",
    enElHome.hay === false,
    JSON.stringify(enElHome),
  );
  const erroresAntes = await erroresDelRegistro(ctx);
  const socketsA = await entregar(ctx, {
    phase: "progress",
    gameId: MUNDO_A,
    message: "sembrando el mundo (1 de 3)",
    elapsedMs: 120_000,
  });
  ctx.log(`entregado el progreso de ${MUNDO_A} con el jugador en el home (${socketsA} socket(s))`);
  const erroresTrasProgreso = await erroresDelRegistro(ctx);
  ctx.expect(
    "un progreso que llega sin línea donde pintarse no rompe el home ni deja un error",
    (await ctx.page.$("#ts-new")) !== null && erroresTrasProgreso === erroresAntes,
    `#ts-new sigue ahí · registro ${erroresAntes} → ${erroresTrasProgreso}`,
  );

  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  const alAbrir = await laLinea(ctx);
  const miradaAlAbrir = await laTarjetaMirada(ctx);
  ctx.log(`al abrir el selector: tarjeta ${miradaAlAbrir} · línea ${JSON.stringify(alAbrir)}`);
  ctx.expect(
    "al abrir el selector, la tarjeta enseña el progreso que llegó mientras el jugador estaba en el home",
    miradaAlAbrir === MUNDO_A &&
      alAbrir.texto.includes("sembrando el mundo (1 de 3)") &&
      alAbrir.fase === "progress",
    `tarjeta ${miradaAlAbrir} · ${JSON.stringify(alAbrir)}`,
  );
  ctx.expect(
    "…con los minutos que trae el estado, que es lo que dice que la espera no empezó ahora",
    alAbrir.texto.includes("2 min"),
    alAbrir.texto,
  );
  await ctx.shot("progreso-que-esperaba-al-abrir-el-selector");

  // ── B · la tarjeta SIN estado: línea vacía y `data-gen-phase` BORRADO ──
  await ctx.page.click(`[data-game-id="${MUNDO_B}"]`);
  const enB = await laLinea(ctx);
  ctx.log(`con la tarjeta de ${MUNDO_B} delante: ${JSON.stringify(enB)}`);
  ctx.expect(
    `la tarjeta de ${MUNDO_B}, que no genera nada, deja la línea VACÍA`,
    enB.texto === "",
    JSON.stringify(enB),
  );
  ctx.expect(
    "…y BORRA `data-gen-phase`, que es por donde el banco sabe si una generación terminó",
    enB.atributo === false && enB.fase === null,
    JSON.stringify(enB),
  );

  // ── C · lo que llega mientras se mira otra tarjeta se apunta IGUAL ─────
  await entregar(ctx, {
    phase: "progress",
    gameId: MUNDO_A,
    message: "sembrando el mundo (2 de 3)",
    elapsedMs: 180_000,
  });
  const enBTrasElSegundo = await laLinea(ctx);
  ctx.expect(
    `el progreso de ${MUNDO_A} sigue sin colarse bajo la tarjeta de ${MUNDO_B} (#313)`,
    enBTrasElSegundo.texto === "" && enBTrasElSegundo.fase === null,
    JSON.stringify(enBTrasElSegundo),
  );
  await ctx.page.click(`[data-game-id="${MUNDO_A}"]`);
  const alVolverAA = await laLinea(ctx);
  ctx.log(`al volver a la tarjeta de ${MUNDO_A}: ${JSON.stringify(alVolverAA)}`);
  ctx.expect(
    "…pero SE APUNTÓ: al volver a su tarjeta se lee el ÚLTIMO mensaje, no el que había al irse",
    alVolverAA.texto.includes("(2 de 3)") && !alVolverAA.texto.includes("(1 de 3)"),
    JSON.stringify(alVolverAA),
  );

  // ── D · la rama de ERROR: rojo en pantalla y entrada en el registro ────
  const erroresAntesDelFallo = await erroresDelRegistro(ctx);
  await marcarLaLista(ctx);
  await entregar(ctx, {
    phase: "error",
    gameId: MUNDO_A,
    message: "el motor no pudo sembrar el mundo",
  });
  const enError = await laLinea(ctx);
  ctx.log(`tras el fallo de pre-generación: ${JSON.stringify(enError)}`);
  ctx.expect(
    "el fallo de la pre-generación se LEE en la tarjeta, en rojo y con su motivo",
    enError.texto.includes("el motor no pudo sembrar el mundo") &&
      enError.fase === "error" &&
      enError.color === "rgb(170, 68, 68)",
    JSON.stringify(enError),
  );
  await ctx.expectEspera(
    "el fallo de pre-generación llega también al registro de errores",
    true,
    (antes) => {
      const n = document.getElementById("error-log")?.children.length ?? -1;
      return n > antes ? n : null;
    },
    {
      ms: 10_000,
      arg: erroresAntesDelFallo,
      aserto:
        "…y no solo en la tarjeta: el registro de errores gana su entrada (el texto rojo se lo lleva el siguiente repintado)",
    },
  );

  // El título se REPINTA solo cuando la fase es terminal, así que el motivo
  // tiene que sobrevivir a ese repintado: quien lo guarda es la raíz y quien
  // lo vuelve a pedir es la hoja. Si el mapa se hubiera ido con la pantalla,
  // aquí es donde el motivo desaparecería.
  await ctx.expectEspera(
    "el título se repinta solo cuando la fase es terminal (la lista de mundos se rehace)",
    true,
    () => (document.getElementById("ts-worlds")?.__qaMarca === undefined ? true : null),
    { ms: 30_000 },
  );
  const trasElRepintado = await laLinea(ctx);
  ctx.log(`tras el repintado automático: ${JSON.stringify(trasElRepintado)}`);
  ctx.expect(
    "el motivo del fallo SOBREVIVE al repintado que dispara la propia fase terminal",
    trasElRepintado.texto.includes("el motor no pudo sembrar el mundo") &&
      trasElRepintado.fase === "error",
    JSON.stringify(trasElRepintado),
  );
  await ctx.shot("la-pre-generacion-que-fallo");

  // ── E · y sobrevive a irse al home y volver ───────────────────────────
  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  const alVolverDelHome = await laLinea(ctx);
  const miradaFinal = await laTarjetaMirada(ctx);
  ctx.log(`tras ir al home y volver: tarjeta ${miradaFinal} · ${JSON.stringify(alVolverDelHome)}`);
  ctx.expect(
    "el estado del mundo sigue ahí después de salir al home y volver: lo guarda el título, no la pantalla",
    alVolverDelHome.texto.includes("el motor no pudo sembrar el mundo") &&
      alVolverDelHome.fase === "error",
    `tarjeta ${miradaFinal} · ${JSON.stringify(alVolverDelHome)}`,
  );
}
