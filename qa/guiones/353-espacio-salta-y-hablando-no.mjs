/** Tanda BY («que pueda saltar»): la tecla ESPACIO de verdad hace saltar al
 *  jugador, y con una conversación en pantalla no.
 *
 *  SE CORRE SIN `?input=scripted` A PROPÓSITO, como el 37: el driver de bench
 *  no pasa por la puerta del teclado, y lo que se mide aquí es la tecla que
 *  pulsa quien juega. La física (cuánto sube, cuánto dura, qué cruza) no es de
 *  este guion: la mide el 352 y, sin navegador, `test/salto-del-jugador`.
 *
 *  EL CONTROL VA PRIMERO: «no despegó» y «este guion no sabe hacer saltar» son
 *  el mismo verde. Y va antes de abrir el diálogo porque el motor falso contesta
 *  a cada elección con otra línea: el estado «cerrado» es una carrera.
 *
 *  DOS GATES, como el andar del 37: el del proveedor de teclado (con el panel
 *  abierto no llega a pedir el salto) y el del bucle (`saltoDelFrame` solo
 *  despega con `puedeMoverse`). Medido en la tanda (implementacion.md): este
 *  guion es el BACKSTOP del hecho del jugador — sale ROJO solo con los dos
 *  quitados a la vez; cada uno por separado lo tapa el otro. El del bucle lo
 *  aísla `test/salto-del-jugador.test.ts` («con el panel abierto… no despega»).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["saves", "fake-ai"];

/** Se planta al jugador a esto del NPC (menos que `interact_range_m`). */
const A_UN_PASO = 1.2;

const frames = esperaDeFotogramas("mundo");

/** Pulsa Espacio con el teclado REAL, lo mantiene unos fotogramas y mira si
 *  el jugador llegó a estar en el aire en alguno de ellos. */
async function pulsaEspacio(ctx) {
  await ctx.page.evaluate(() => {
    window.__saltoVisto = { aire: false, elevMax: 0 };
    const mira = () => {
      const s = window.__nefan.state().salto;
      if (s.fase === "aire") window.__saltoVisto.aire = true;
      window.__saltoVisto.elevMax = Math.max(window.__saltoVisto.elevMax, s.elevacion);
      if (window.__saltoVisto.vivo) requestAnimationFrame(mira);
    };
    window.__saltoVisto.vivo = true;
    requestAnimationFrame(mira);
  });
  await ctx.page.keyboard.down(" ");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up(" ");
  }
  // Lo que dura un salto entero y algo más: si despegó, se ha visto.
  await frames(ctx, 60);
  return ctx.page.evaluate(() => {
    window.__saltoVisto.vivo = false;
    return { aire: window.__saltoVisto.aire, elevMax: window.__saltoVisto.elevMax, ahora: window.__nefan.state().salto };
  });
}

export default async function (ctx) {
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO",
    await ctx.page.evaluate(() => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver),
    url.toString(),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  // ── 1 · CONTROL: sin diálogo, Espacio salta ─────────────────────────────
  const libre = await pulsaEspacio(ctx);
  ctx.log(`sin diálogo: ${JSON.stringify(libre)}`);
  ctx.expect(
    "CONTROL: sin diálogo delante, Espacio hace saltar (sube y vuelve al suelo)",
    libre.aire && libre.elevMax > 0.5 && libre.ahora.fase === "suelo",
    JSON.stringify(libre),
  );

  // ── 2 · Se abre la conversación por el camino del jugador (E) ───────────
  const npc = await ctx.waitFor(
    "hay algún NPC en la escena con quien hablar",
    () => {
      const l = window.__nefan.npcs();
      return l.length > 0 ? l[0] : null;
    },
    30_000,
  );
  await ctx.nefan("setPlayerPos", npc.pos.x + A_UN_PASO, npc.pos.z);
  await ctx.waitFor(
    `el juego ofrece hablar con ${npc.label ?? npc.id}`,
    () => (document.querySelector('#interact-prompt [data-action="interact"]') ? true : null),
    30_000,
  );
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
  await ctx.waitFor("el NPC contesta y el panel de diálogo se abre", () => (window.__nefan.dialogue().visible ? true : null), 120_000);
  // Que el texto termine de escribirse y salgan las opciones, como quien lee:
  // con el typewriter en marcha el panel se come CUALQUIER tecla de acción
  // (Espacio incluido) para completarlo, y entonces este guion mediría al
  // panel y no a los gates del salto. Con opciones en pantalla, Espacio no
  // es de nadie en el panel y llega a la puerta del proveedor.
  await ctx.waitFor(
    "el diálogo muestra sus opciones (el texto terminó de escribirse)",
    () => (document.querySelectorAll("#dialogue-choices button").length > 0 && window.__nefan.dialogue().choices.length > 0 ? true : null),
    30_000,
  );

  // ── 3 · Con el panel delante, Espacio NO salta ──────────────────────────
  const hablando = await pulsaEspacio(ctx);
  ctx.log(`con el diálogo delante: ${JSON.stringify(hablando)}`);
  ctx.expect(
    "con la conversación delante Espacio NO hace saltar (ni un fotograma en el aire)",
    !hablando.aire && hablando.elevMax === 0,
    JSON.stringify(hablando),
  );
  await ctx.shot("espacio-con-la-conversacion-delante");
}
