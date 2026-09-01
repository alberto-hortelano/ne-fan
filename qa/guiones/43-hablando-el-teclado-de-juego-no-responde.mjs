/** #314, la mitad que el guion 37 NO mide: lo que el gate del diálogo suprime
 *  EN EXCLUSIVA, y con el teclado de verdad.
 *
 *  POR QUÉ EXISTE. #314 quitó el espejo (el campo público del proveedor) y puso
 *  al proveedor a PREGUNTAR (`InputDeps.dialogoAbierto()`, derivado del panel).
 *  El guion 37 vigilaba que el panel y el gate no discreparan… pero desde #314
 *  las dos mitades que comparaba salen de la MISMA expresión:
 *  `__nefan.dialogue().visible` y `__nefan.state().dialogueActive` eran las dos
 *  `dialoguePanel.isVisible` (`main.ts`). Su vigilante comparaba un booleano
 *  consigo mismo. (La segunda clave se retiró del hook el 2026-09-01 con #329,
 *  por eso mismo: un segundo nombre de la primera, sin un solo lector.) Al reportarlo se le quitó, y el 37 quedó con lo único que sí
 *  puede ponerse rojo: que hablando el jugador no anda — que es el gate del
 *  BUCLE, no el del proveedor.
 *
 *  MEDIDO, y es la razón de sembrar este guion (QA 2026-08-30): neutralizando
 *  el gate del proveedor (`if (this.deps.dialogoAbierto()) return;` → `if
 *  (false) return;`) la batería sale **37 verde entero, 43 rojo**. Un candado
 *  que no puede ponerse rojo no cierra nada; este sí.
 *
 *  QUÉ SUPRIME SOLO EL GATE, leído de `main.ts` y comprobado con el sabotaje:
 *
 *   · **la selección de ataque con 1..N** — `selectAttack` la hace el proveedor
 *     en su `keydown` y el bucle no la mira nunca: sin gate, el HUD cambia de
 *     arma en mitad de la conversación (rojo con el sabotaje);
 *   · **las teclas de DESARROLLO** (`dev-tools-input.ts`, el fichero al que
 *     #314 le quitó `DevToolsDeps`) — el bucle llama a
 *     `consumeToggleCollisionDebug()` ANTES del `if (dialoguePanel.isVisible)`,
 *     así que `B` solo la para el gate (rojo con su propio sabotaje).
 *
 *  QUÉ NO AÍSLA, dicho para que no se lea de más: el WASD, el giro por flechas
 *  (`applyTurnKeys` vive DENTRO del `if (!dialoguePanel.isVisible)` del bucle),
 *  el ataque, la interacción y la propuesta de tile están gateados DOS veces.
 *  El aserto de las flechas se conserva porque es el hecho que ve el jugador
 *  —hablando, la cámara no se mueve— pero NO mide el gate del proveedor: con
 *  el sabotaje sale verde.
 *
 *  Y EL RIESGO 2 DEL PLAN DE #314, que ningún guion ejercía: elegir la opción
 *  «1» con el teclado apaga el panel EN EL MISMO EVENTO, así que la tecla puede
 *  llegar al proveedor cuando el gate ya está abierto. Lo que salva es el
 *  `preventDefault`/`stopImmediatePropagation` del panel más la guarda
 *  `if (e.defaultPrevented) return`. Aquí se ejerce con la tecla real: elegir
 *  no puede cambiar el ataque seleccionado.
 *
 *  SE CORRE SIN `?input=scripted`, igual que el 37 y por el mismo motivo: el
 *  driver de bench no pregunta por el gate nunca.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server. No
 *  se pulsa `G` a propósito —pide el atlas de superficies, que en el juego de
 *  verdad GASTA—: la tecla dev que se mide es `B`, que solo cicla una vista.
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** Ataque donde se «aparca» la selección antes de hablar. No es el 1 ni el 5 a
 *  propósito: los dos que se pulsan durante la conversación son otros, así que
 *  una fuga se ve como un CAMBIO y no como un no-cambio. */
const TECLA_APARCADA = "3";
const ATAQUE_APARCADO = "medium";
/** La que se pulsa hablando y NO es ninguna opción del diálogo (hay 2): el
 *  panel la deja pasar, así que lo único que la para es el gate. */
const TECLA_SUELTA = "5";
const ATAQUE_SUELTO = "precise";

async function frames(ctx, n) {
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  return ctx.waitFor(
    `el bucle de juego avanza ${n} fotograma(s)`,
    (m) => {
      const f = window.__nefan.fps()?.frames ?? 0;
      return f >= m.desde + m.n ? { f } : null;
    },
    20_000,
    { desde, n },
  );
}

/** Lo que hace falta leer del jugador para decidir si una tecla pasó. */
const leer = (ctx) =>
  ctx.page.evaluate(() => ({
    panel: window.__nefan.dialogue().visible,
    ataque: window.__nefan.state().input.selectedAttack,
    forward: { ...window.__nefan.state().forward },
    vistaDebug: window.__nefan.fps()?.debugView ?? null,
    puedeAtacar: window.__nefan.puedeAtacar().ok,
  }));

/** Mantiene una tecla unos fotogramas con el teclado REAL. Un `press()` hace
 *  keydown y keyup antes del siguiente rAF y la intención se pierde entera
 *  (misma lección que el guion 37). */
async function mantener(ctx, tecla, nFrames = 4) {
  await ctx.page.keyboard.down(tecla);
  try {
    await frames(ctx, nFrames);
  } finally {
    await ctx.page.keyboard.up(tecla);
  }
}

/** Deja al jugador al lado del NPC y ESPERA a que el juego OFREZCA hablar. El
 *  NPC tiene vida ambiental y se mueve, así que se re-planta en cada vuelta:
 *  plantar una vez y confiar es lo que convierte este guion en una moneda al
 *  aire (medido a mano el 2026-08-30 — la primera `E` cayó fuera de rango). */
async function ponerseAlLadoDelNpc(ctx) {
  return ctx.waitFor(
    "el juego ofrece hablar con el NPC (la acción que ve el jugador)",
    () => {
      const n = window.__nefan.npcs()[0];
      if (!n) return null;
      window.__nefan.setPlayerPos(n.pos.x + 1.0, n.pos.z);
      const btn = document.querySelector('#interact-prompt [data-action="interact"]');
      return btn ? { etiqueta: btn.textContent ?? "", npc: n.id } : null;
    },
    60_000,
  );
}

export default async function (ctx) {
  // ── 0 · El proveedor de TECLADO, que es el único que lee el gate ────────
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO (el de bench no lee el gate del diálogo)",
    await ctx.page.evaluate(
      () => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver,
    ),
    url.toString(),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  // El catálogo tiene que dar para distinguir tres ataques, o los asertos de
  // abajo no pueden ponerse rojos.
  const catalogo = await ctx.page.evaluate(() => window.__nefan.state().attackCatalog);
  ctx.expect(
    "la sesión trae un catálogo de ataques con teclas 1..5 (si no, una fuga sería invisible)",
    catalogo.length >= 5,
    JSON.stringify(catalogo),
  );

  // ── 1 · CONTROL, sin diálogo: las tres teclas SÍ hacen su efecto ────────
  // Va primero por la misma razón que en el 37: «no pasó nada» y «este guion
  // no sabe hacer que pase» son el mismo verde.
  await mantener(ctx, TECLA_SUELTA);
  const trasCincoLibre = await leer(ctx);
  ctx.expect(
    `CONTROL: sin conversación, la tecla ${TECLA_SUELTA} selecciona «${ATAQUE_SUELTO}»`,
    trasCincoLibre.ataque === ATAQUE_SUELTO,
    trasCincoLibre.ataque,
  );

  const antesDeGirar = trasCincoLibre.forward;
  await mantener(ctx, "ArrowLeft", 6);
  const trasGirarLibre = await leer(ctx);
  const giroLibre = Math.hypot(
    trasGirarLibre.forward.x - antesDeGirar.x,
    trasGirarLibre.forward.z - antesDeGirar.z,
  );
  ctx.log(
    `sin diálogo · flecha: ${JSON.stringify(antesDeGirar)} → ` +
      `${JSON.stringify(trasGirarLibre.forward)} (Δ ${giroLibre.toFixed(3)})`,
  );
  ctx.expect(
    "CONTROL: sin conversación, la flecha izquierda GIRA al jugador",
    giroLibre > 0.1,
    `Δforward ${giroLibre.toFixed(3)}`,
  );

  const vistaAntesLibre = trasGirarLibre.vistaDebug;
  await ctx.page.keyboard.press("b");
  await frames(ctx, 3);
  const trasBLibre = await leer(ctx);
  ctx.log(`sin diálogo · tecla B: vista de debug ${vistaAntesLibre} → ${trasBLibre.vistaDebug}`);
  ctx.expect(
    "CONTROL: sin conversación, la tecla dev B cicla la vista de debug del renderer",
    trasBLibre.vistaDebug !== null && trasBLibre.vistaDebug !== vistaAntesLibre,
    `${vistaAntesLibre} → ${trasBLibre.vistaDebug}`,
  );
  // Se cierra el ciclo (off → collision → surfaces → off) para que la captura
  // de más abajo enseñe el juego y no el tinte de depuración.
  await ctx.page.keyboard.press("b");
  await frames(ctx, 3);
  await ctx.page.keyboard.press("b");
  await frames(ctx, 3);

  // Se aparca la selección en un ataque que NO es ninguno de los que se van a
  // pulsar hablando.
  await mantener(ctx, TECLA_APARCADA);
  const aparcado = await leer(ctx);
  ctx.expect(
    `el ataque queda aparcado en «${ATAQUE_APARCADO}» antes de hablar`,
    aparcado.ataque === ATAQUE_APARCADO,
    aparcado.ataque,
  );

  // ── 2 · Se abre la conversación por el camino del jugador ───────────────
  const cerca = await ponerseAlLadoDelNpc(ctx);
  ctx.log(`al lado del NPC: ${JSON.stringify(cerca)}`);
  await ctx.page.keyboard.down("e");
  try {
    await ctx.waitFor(
      "el NPC contesta y el panel de diálogo se abre",
      () => {
        // Se re-planta mientras se mantiene la tecla: el NPC anda.
        const n = window.__nefan.npcs()[0];
        if (n) window.__nefan.setPlayerPos(n.pos.x + 1.0, n.pos.z);
        return window.__nefan.dialogue().visible ? true : null;
      },
      120_000,
    );
  } finally {
    await ctx.page.keyboard.up("e");
  }
  // Cortesía del panel: un click en el cuerpo completa el texto de golpe, y
  // las opciones no se pintan hasta entonces.
  await ctx.page.evaluate(() => document.getElementById("dialogue-text").click());
  const opciones = await ctx.waitFor(
    "las opciones de respuesta están en pantalla",
    () =>
      [...document.querySelectorAll('#dialogue-choices [data-action^="choice:"]')].map(
        (b) => b.textContent ?? "",
      ),
    30_000,
  );
  ctx.log(`conversación abierta con opciones: ${JSON.stringify(opciones)}`);
  const hablando = await leer(ctx);
  ctx.expect(
    "hablando, el juego dice que NO se puede atacar (`puedeAtacar().ok`)",
    hablando.panel === true && hablando.puedeAtacar === false,
    JSON.stringify(hablando),
  );

  // ── 3 · Lo que el gate suprime EN EXCLUSIVA ────────────────────────────
  await mantener(ctx, TECLA_SUELTA);
  const trasCincoHablando = await leer(ctx);
  ctx.log(`hablando · tecla ${TECLA_SUELTA}: ataque=${trasCincoHablando.ataque}`);
  ctx.expect(
    `con la conversación delante, la tecla ${TECLA_SUELTA} NO cambia el ataque del HUD ` +
      `(el bucle no lo suprime: SOLO el gate del proveedor)`,
    trasCincoHablando.ataque === ATAQUE_APARCADO,
    `${trasCincoHablando.ataque} (esperado ${ATAQUE_APARCADO})`,
  );

  const vistaAntesHablando = trasCincoHablando.vistaDebug;
  await ctx.page.keyboard.press("b");
  await frames(ctx, 3);
  const trasBHablando = await leer(ctx);
  ctx.log(
    `hablando · tecla dev B: vista de debug ${vistaAntesHablando} → ${trasBHablando.vistaDebug}`,
  );
  ctx.expect(
    "con la conversación delante, la tecla dev B NO cicla la vista de debug " +
      "(el bucle la consume ANTES del gate del diálogo: SOLO lo para `dev-tools-input`)",
    trasBHablando.vistaDebug === vistaAntesHablando,
    `${vistaAntesHablando} → ${trasBHablando.vistaDebug}`,
  );

  // Y el hecho que ve el jugador, que NO aísla el gate (el bucle también lo
  // suprime) pero es el que le importa: hablando, la cámara no se mueve.
  const antesFlechaHablando = trasBHablando.forward;
  await mantener(ctx, "ArrowLeft", 6);
  const trasFlechaHablando = await leer(ctx);
  const giroHablando = Math.hypot(
    trasFlechaHablando.forward.x - antesFlechaHablando.x,
    trasFlechaHablando.forward.z - antesFlechaHablando.z,
  );
  ctx.expect(
    "con la conversación delante, la flecha NO gira la cámara (gateado dos veces: no aísla nada)",
    giroHablando === 0,
    `Δforward ${giroHablando.toFixed(3)} (libre: ${giroLibre.toFixed(3)})`,
  );
  await ctx.shot("hablando-con-el-teclado-de-juego-mudo");

  // ── 4 · Riesgo 2 del plan: elegir con «1» cierra el panel en el MISMO
  //        evento; la tecla no puede acabar en el selector de ataque ───────
  const antesDeElegir = await leer(ctx);
  await ctx.page.keyboard.press("1");
  const alElegir = await leer(ctx);
  ctx.log(
    `al elegir la opción 1 con el teclado: panel ${antesDeElegir.panel} → ${alElegir.panel} · ` +
      `ataque ${antesDeElegir.ataque} → ${alElegir.ataque}`,
  );
  ctx.expect(
    "elegir la opción «1» con el teclado CIERRA la conversación",
    antesDeElegir.panel === true && alElegir.panel === false,
    JSON.stringify(alElegir),
  );
  ctx.expect(
    "…y esa misma «1» NO se filtra al selector de ataque del HUD (riesgo 2 de #314)",
    alElegir.ataque === ATAQUE_APARCADO,
    `${alElegir.ataque} (esperado ${ATAQUE_APARCADO}; «1» seleccionaría «${catalogo[0]}»)`,
  );
  await ctx.shot("tras-elegir-con-la-tecla-1");
}
