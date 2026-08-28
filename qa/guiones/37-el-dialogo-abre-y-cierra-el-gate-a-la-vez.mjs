/** #311. «Hay una conversación abierta» vive en DOS sitios que nadie obliga a
 *  coincidir —el panel (`dialoguePanel`) y el gate del input
 *  (`input.dialogueActive`, que suprime moverse y atacar)— y hasta esta tanda
 *  se emparejaban a mano en cinco lugares del cliente.
 *
 *  POR QUÉ EXISTE. El arreglo de #311 es `abrirDialogo()` / `cerrarDialogo()`,
 *  dueños únicos del par. Lo que lo canda es que no haya más sitios donde
 *  escribirlo… y eso no lo comprueba nada: la regla de `arch-rules.json` que el
 *  plan pedía se retiró (subía la deuda +5, ver #314), y el sink `dialogo` de
 *  las facetas —lo único que `tsc` sí canda— cubre OTRA cosa: volver al título.
 *  Además NINGÚN guion de la batería abría un diálogo (grep a cero el
 *  2026-08-28), así que desemparejar el flag del panel compilaba, pasaba lint y
 *  pasaba los 34 guiones. Esto es lo que se pone rojo si vuelve a pasar.
 *
 *  SE CORRE SIN `?input=scripted` A PROPÓSITO. El gate solo se LEE en
 *  `keyboard-input-provider.ts`: `ScriptedInputProvider` tiene el campo
 *  `dialogueActive` y no lo mira nunca, así que con el driver de bench el
 *  jugador se movería durante la conversación y el aserto mediría el vacío.
 *  Mismo motivo y mismo remedio que el guion 34.
 *
 *  EL CONTROL VA PRIMERO (bloque 1). «El jugador no se movió» y «este guion no
 *  sabe mover al jugador» son el mismo verde: primero se comprueba que `W`
 *  mueve, y solo entonces significa algo que con el diálogo delante no mueva.
 *  Va antes y no después porque el motor falso contesta a cada elección con
 *  OTRA línea de diálogo: el estado «cerrado» solo dura hasta que llega la
 *  respuesta, y un control colocado ahí sería una carrera.
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

  // El vigilante del INVARIANTE, encendido para toda la partida: en ningún
  // fotograma pueden discrepar el panel y el gate.
  //
  // ES UNA RED, NO EL CANDADO, y conviene saber qué caza. Probado en negativo
  // el 2026-08-28: con el gate quitado al ABRIR lo pilla (5 fotogramas de
  // divergencia); con el gate quitado al CERRAR NO lo pilla, porque el motor
  // contesta con otra línea y el panel vuelve a abrirse antes del siguiente
  // rAF. Ese caso lo caza el aserto del bloque 3, que lee las dos mitades en
  // el MISMO turno síncrono del click. Por eso están los dos.
  await ctx.page.evaluate(() => {
    window.__qaPar = { muestras: 0, abierto: 0, divergencias: [] };
    const mirar = () => {
      const panel = window.__nefan.dialogue().visible;
      const gate = window.__nefan.state().dialogueActive;
      window.__qaPar.muestras++;
      if (panel) window.__qaPar.abierto++;
      if (panel !== gate && window.__qaPar.divergencias.length < 5) {
        window.__qaPar.divergencias.push({ panel, gate, n: window.__qaPar.muestras });
      }
      requestAnimationFrame(mirar);
    };
    requestAnimationFrame(mirar);
  });

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
        ? {
            panel: true,
            gate: window.__nefan.state().dialogueActive,
            texto: (window.__nefan.dialogue().text ?? "").slice(0, 60),
          }
        : null,
    120_000,
  );
  ctx.log(`diálogo abierto: ${JSON.stringify(abierto)}`);
  ctx.expect(
    "abrir el diálogo pone el panel Y el gate del input, no uno solo (#311)",
    abierto.panel && abierto.gate === true,
    JSON.stringify(abierto),
  );

  // Y lo que el gate SIGNIFICA para quien juega, que es lo que un booleano no
  // dice: con la conversación delante, andar no anda.
  //
  // HONESTIDAD SOBRE LO QUE ESTE ASERTO NO AÍSLA, medido el 2026-08-28: el
  // movimiento está gateado DOS veces —`input.dialogueActive` en el provider de
  // teclado y `if (dialoguePanel.isVisible)` en el propio bucle de juego
  // (`main.ts`, «Movement (suppressed during dialogue)»)—, así que quitando el
  // `dialogueActive = true` de `abrirDialogo` este aserto sigue VERDE: lo caza
  // el de arriba. Se conserva porque es el hecho del jugador y porque es el
  // único que se pondría rojo si alguien quitara el gate del bucle; el que
  // vigila el emparejamiento es el par de asertos de estado, no este.
  const conDialogo = await cuantoAnda(ctx);
  ctx.log(`con el diálogo delante: ${JSON.stringify(conDialogo)}`);
  ctx.expect(
    "…y con la conversación delante el jugador NO se mueve al mantener W",
    conDialogo.metros === 0,
    `${conDialogo.metros.toFixed(2)} m (libre: ${libre.metros.toFixed(2)} m)`,
  );
  await ctx.shot("con-la-conversacion-delante");

  // ── 3 · Se cierra, y los DOS se sueltan en el mismo turno ───────────────
  // Se pulsa el botón de la opción —el elemento real del panel— desde dentro
  // de la página para que la lectura de después caiga en el MISMO turno
  // síncrono que el click: `chooseByIndex` hace `hide()` y llama a `onChoice`,
  // que es donde vive `cerrarDialogo()`. Sin esa simultaneidad, la respuesta
  // del motor reabre el panel y lo medido sería otra cosa.
  await ctx.page.evaluate(() => {
    // Cortesía del panel: un click en su cuerpo completa el texto de golpe, y
    // las opciones no se pintan hasta entonces.
    document.getElementById("dialogue-text").click();
  });
  await ctx.waitFor(
    "las opciones de respuesta están en pantalla",
    () => document.querySelector('#dialogue-choices [data-action="choice:0"]')?.textContent ?? null,
    30_000,
  );
  const alCerrar = await ctx.page.evaluate(() => {
    const leer = () => ({
      panel: window.__nefan.dialogue().visible,
      gate: window.__nefan.state().dialogueActive,
    });
    const antes = leer();
    document.querySelector('#dialogue-choices [data-action="choice:0"]').click();
    return { antes, despues: leer() };
  });
  ctx.log(`al elegir una opción: ${JSON.stringify(alCerrar)}`);
  ctx.expect(
    "cerrar el diálogo suelta el panel Y el gate en el mismo turno (#311)",
    alCerrar.antes.panel === true &&
      alCerrar.antes.gate === true &&
      alCerrar.despues.panel === false &&
      alCerrar.despues.gate === false,
    JSON.stringify(alCerrar),
  );

  // ── 4 · El invariante, sobre toda la partida ────────────────────────────
  const par = await ctx.page.evaluate(() => ({ ...window.__qaPar }));
  ctx.log(`vigilante del par: ${JSON.stringify(par)}`);
  ctx.expect(
    "el vigilante ha visto la conversación abierta de verdad (si no, no vigiló nada)",
    par.abierto > 0 && par.muestras > 30,
    JSON.stringify(par),
  );
  ctx.expect(
    "en NINGÚN fotograma el panel y el gate del input discreparon (#311)",
    par.divergencias.length === 0,
    JSON.stringify(par.divergencias),
  );
  await ctx.shot("tras-elegir-una-respuesta");
}
