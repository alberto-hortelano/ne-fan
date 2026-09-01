/** Con una conversación en pantalla, el jugador no anda. Es el hecho de #311
 *  que ve quien juega, y lo sostienen DOS gates independientes: la puerta del
 *  proveedor de teclado (`keyboard-input-provider.ts`, que no llega a poner
 *  `state.up`) y el bucle de juego (`main.ts`, `if (!dialoguePanel.isVisible)`
 *  alrededor del WASD). Cualquiera de los dos basta.
 *
 *  QUÉ MIDE ESTE GUION, Y CUÁNDO PUEDE PONERSE ROJO. Medido el 2026-08-30, los
 *  tres sabotajes, cada uno restaurado antes del siguiente:
 *
 *    · solo el gate del BUCLE (`if (!dialoguePanel.isVisible)` → `if (true)`)
 *      ................................................. VERDE (0,00 m)
 *    · solo el gate del PROVEEDOR (`if (this.deps.dialogoAbierto()) return;`
 *      → `if (false) return;`) ......................... VERDE (0,00 m)
 *    · LOS DOS a la vez ............................ **ROJO** (3,32 m andados
 *      con la conversación delante, frente a 3,95 m libre)
 *
 *  O sea: este guion es el BACKSTOP del hecho del jugador, no el candado de
 *  ninguno de los dos mecanismos. Se pone rojo exactamente cuando el jugador
 *  puede andar hablando —que es el bug— y no antes. Quien aísla el gate del
 *  proveedor es el **guion 43**; al gate del bucle no lo aísla nadie, porque el
 *  del proveedor lo tapa.
 *
 *  Se dice así de explícito porque la primera versión de este comentario
 *  afirmaba que quitar el gate del bucle lo ponía rojo. No lo medí antes de
 *  escribirlo, y era FALSO: sale verde. Es el fallo que este repositorio tiene
 *  escrito como el más caro —la justificación redactada después, que nadie mide
 *  y que se congela como documentación—, y estuvo a punto de entrar en el mismo
 *  fichero que se estaba arreglando por eso mismo.
 *
 *  LO QUE ESTE GUION MEDÍA ANTES Y YA NO PUEDE, porque hay que decirlo. Hasta
 *  #314 se llamaba «el diálogo abre y cierra el gate a la vez» y llevaba un
 *  vigilante por fotograma que comparaba el panel con el gate del input, más
 *  dos asertos sobre ese par. Tenía sentido mientras el gate era una COPIA (un
 *  campo público del proveedor que el bucle escribía a mano): copia y original
 *  podían desemparejarse, y eso es lo que vigilaba.
 *
 *  #314 se llevó la copia — el proveedor PREGUNTA (`InputDeps.dialogoAbierto()`,
 *  que es `() => dialoguePanel.isVisible`)—, y con ella se llevó el sujeto del
 *  vigilante: `__nefan.dialogue().visible` y `__nefan.state().dialogueActive`
 *  pasaron a ser LA MISMA expresión. (Esa segunda clave ya no existe: se retiró
 *  del hook el 2026-09-01 con #329, precisamente por ser un segundo nombre de
 *  la primera que nadie leía.) El vigilante comparaba un booleano consigo
 *  mismo por dos caminos de una línea, y no podía ponerse rojo: QA lo midió el
 *  2026-08-30 neutralizando el gate del proveedor por completo y este guion
 *  salió VERDE ENTERO, los cinco asertos. Se quitaron el vigilante y sus dos
 *  asertos tautológicos en vez de dejarlos dando falsa confianza; un test que no
 *  puede ponerse rojo es peor que uno intermitente, porque el intermitente al
 *  menos se nota.
 *
 *  SE CORRE SIN `?input=scripted` A PROPÓSITO. `ScriptedInputProvider` no
 *  pregunta por el diálogo nunca —conduce el juego por su API programática, sin
 *  pasar por la puerta del teclado—, así que con el driver de bench el jugador
 *  se movería durante la conversación y el aserto mediría el vacío. Mismo
 *  motivo y mismo remedio que los guiones 34 y 43.
 *
 *  EL CONTROL VA PRIMERO. «El jugador no se movió» y «este guion no sabe mover
 *  al jugador» son el mismo verde: primero se comprueba que `W` mueve, y solo
 *  entonces significa algo que con el diálogo delante no mueva. Va antes y no
 *  después porque el motor falso contesta a cada elección con OTRA línea de
 *  diálogo: el estado «cerrado» solo dura hasta que llega la respuesta, y un
 *  control colocado ahí sería una carrera.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** Rango de interacción del cliente (`main.ts`, `INTERACT_RANGE`). Se planta
 *  al jugador algo más cerca para que un descuadre de medio metro no convierta
 *  el guion en una moneda al aire. */
const A_UN_PASO = 1.2;

/** Cuántos fotogramas se mantiene `W`. Con el gate quitado, el jugador recorre
 *  metros en este tiempo; con él puesto, cero. */
const FRAMES_ANDANDO = 20;

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

/** Cuánto se desplaza el jugador manteniendo `W` con el teclado REAL. */
async function cuantoAnda(ctx) {
  const antes = await ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
  await ctx.page.keyboard.down("w");
  try {
    await frames(ctx, FRAMES_ANDANDO);
  } finally {
    await ctx.page.keyboard.up("w");
  }
  const despues = await ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
  return {
    antes,
    despues,
    metros: Math.hypot(despues.x - antes.x, despues.z - antes.z),
  };
}

export default async function (ctx) {
  // ── 0 · El proveedor de TECLADO, que es el único que consulta el gate ────
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO (el de bench no consulta el gate del diálogo)",
    await ctx.page.evaluate(
      () => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver,
    ),
    url.toString(),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);

  // ── 1 · CONTROL: sin diálogo, `W` mueve ─────────────────────────────────
  const libre = await cuantoAnda(ctx);
  ctx.log(`sin diálogo: ${JSON.stringify(libre)}`);
  ctx.expect(
    "CONTROL: sin diálogo delante, mantener W mueve al jugador (si no, el bloque 2 no dice nada)",
    libre.metros > 0.5,
    `${libre.metros.toFixed(2)} m en ${FRAMES_ANDANDO} fotogramas`,
  );

  // ── 2 · Se abre la conversación por el camino del jugador ───────────────
  // Plantarse al lado del NPC es el teletransporte de bench que usan otros
  // guiones para tener un punto de partida determinista; hablar es la tecla E
  // de verdad, sobre la acción que el juego ANUNCIA en la barra contextual.
  const npc = await ctx.waitFor(
    "hay algún NPC en la escena con quien hablar",
    () => {
      const l = window.__nefan.npcs();
      return l.length > 0 ? l[0] : null;
    },
    30_000,
  );
  await ctx.nefan("setPlayerPos", npc.pos.x + A_UN_PASO, npc.pos.z);
  const cerca = await ctx.waitFor(
    `el juego ofrece hablar con ${npc.label ?? npc.id} (la acción que ve el jugador)`,
    (id) => {
      const btn = document.querySelector('#interact-prompt [data-action="interact"]');
      if (!btn) return null;
      const n = window.__nefan.npcs().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      return { etiqueta: btn.textContent ?? "", dist: Math.hypot(n.pos.x - p.x, n.pos.z - p.z) };
    },
    30_000,
    npc.id,
  );
  ctx.log(`al lado de ${npc.id}: ${JSON.stringify(cerca)}`);

  // `E` se MANTIENE unos fotogramas y no se «pulsa»: el provider pone
  // `state.interact` en el keydown y lo quita en el keyup, y el bucle lo
  // consume en un frame. Un `press()` de Playwright hace las dos cosas antes
  // del siguiente rAF y la intención se pierde entera. Una pulsación humana
  // dura decenas de fotogramas, así que esto es lo que se parece al jugador.
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
  const abierto = await ctx.waitFor(
    "el NPC contesta y el panel de diálogo se abre",
    () =>
      window.__nefan.dialogue().visible
        ? { panel: true, texto: (window.__nefan.dialogue().text ?? "").slice(0, 60) }
        : null,
    120_000,
  );
  ctx.log(`diálogo abierto: ${JSON.stringify(abierto)}`);

  // ── 3 · Y lo que eso SIGNIFICA para quien juega ─────────────────────────
  // Rojo SOLO con los dos gates caídos a la vez (3,32 m; la tabla de la
  // cabecera tiene las tres medidas). Es el hecho del jugador, no el candado de
  // un mecanismo concreto.
  const conDialogo = await cuantoAnda(ctx);
  ctx.log(`con el diálogo delante: ${JSON.stringify(conDialogo)}`);
  ctx.expect(
    "con la conversación delante el jugador NO se mueve al mantener W",
    conDialogo.metros === 0,
    `${conDialogo.metros.toFixed(2)} m (libre: ${libre.metros.toFixed(2)} m)`,
  );
  await ctx.shot("con-la-conversacion-delante");
}
