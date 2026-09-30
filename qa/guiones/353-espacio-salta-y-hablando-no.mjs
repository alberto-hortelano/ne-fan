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
 *  ESPACIO SOLO ES DEL JUEGO EN PARTIDA (vuelta de QA, H4): con el ratón
 *  capturado y sin panel ni título. Sin ratón capturado ni salta ni le quita a
 *  la tecla su efecto de siempre (activar el botón con el foco); el bloque 1 lo
 *  afirma leyendo `defaultPrevented` desde un oyente puesto después de los del
 *  juego. Probado en negativo: sin la guarda del ratón, ese bloque sale ROJO
 *  (`{"aire":true,"consumida":true,"raton":false}`).
 *
 *  EL BLOQUE DEL DIÁLOGO ES UN BACKSTOP DE TRES GATES, no el candado de
 *  ninguno: la conversación SUELTA el ratón (guion 83) y el click para
 *  recapturarlo no lo recupera con el panel delante, así que además del gate
 *  del proveedor (conversación abierta) y del bucle (`saltoDelFrame` con
 *  `puedeMoverse`) frena el del ratón. Antes de la guarda del ratón se midió
 *  que salía ROJO solo con los otros dos quitados a la vez; el del bucle lo
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

/** Captura el ratón como el jugador: un click sobre el mundo. */
async function capturarRaton(ctx, desc) {
  const caja = await (await ctx.page.$("canvas")).boundingBox();
  await ctx.page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 3);
  return ctx.expectEspera(desc, true, () => (document.pointerLockElement !== null ? true : null), { ms: 10_000 });
}

/** Pulsa Espacio con el teclado REAL, lo mantiene unos fotogramas y mira si
 *  el jugador llegó a estar en el aire en alguno de ellos, y si alguien le
 *  quitó a Espacio su efecto por defecto (`defaultPrevented`, leído por un
 *  oyente puesto DESPUÉS de los del juego). */
async function pulsaEspacio(ctx) {
  await ctx.page.evaluate(() => {
    window.__saltoVisto = { aire: false, elevMax: 0, consumida: null };
    if (!window.__oyeEspacio) {
      window.__oyeEspacio = true;
      window.addEventListener("keydown", (e) => {
        if (e.key === " " && !e.repeat && window.__saltoVisto) window.__saltoVisto.consumida = e.defaultPrevented;
      });
    }
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
    const v = window.__saltoVisto;
    return { aire: v.aire, elevMax: v.elevMax, consumida: v.consumida, raton: document.pointerLockElement !== null, ahora: window.__nefan.state().salto };
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

  // ── 1 · Sin el ratón capturado Espacio NO es del juego (QA de BY, H4) ───
  // Ni salta ni le quita a la tecla su efecto de siempre (activar el botón
  // con el foco): el juego solo se la queda EN PARTIDA, como el LMB.
  const sinRaton = await pulsaEspacio(ctx);
  ctx.log(`sin ratón capturado: ${JSON.stringify(sinRaton)}`);
  ctx.expect(
    "sin el ratón capturado, Espacio ni salta ni se consume (la página conserva su efecto por defecto)",
    !sinRaton.raton && !sinRaton.aire && sinRaton.consumida === false,
    JSON.stringify(sinRaton),
  );

  // ── 2 · CONTROL: en partida (ratón capturado), Espacio salta ────────────
  await capturarRaton(ctx, "el click sobre el mundo captura el ratón");
  const libre = await pulsaEspacio(ctx);
  ctx.log(`sin diálogo: ${JSON.stringify(libre)}`);
  ctx.expect(
    "CONTROL: en partida, Espacio hace saltar (sube y vuelve al suelo) y se lo queda el juego",
    libre.raton && libre.aire && libre.elevMax > 0.5 && libre.ahora.fase === "suelo" && libre.consumida === true,
    JSON.stringify(libre),
  );

  // ── 3 · Se abre la conversación por el camino del jugador (E) ───────────
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

  // ── 4 · Con el panel delante, Espacio NO salta ──────────────────────────
  // La conversación suelta el ratón (83). Se intenta recapturarlo con un click
  // sobre el mundo para que lo que frene el salto sean los gates del diálogo
  // y no el del ratón; si no se deja, se dice en el log.
  await ctx.page.mouse.click(10, 300);
  await frames(ctx, 5);
  const hablando = await pulsaEspacio(ctx);
  ctx.log(`con el diálogo delante: ${JSON.stringify(hablando)}`);
  ctx.expect(
    "con la conversación delante Espacio NO hace saltar (ni un fotograma en el aire)",
    !hablando.aire && hablando.elevMax === 0,
    JSON.stringify(hablando),
  );
  await ctx.shot("espacio-con-la-conversacion-delante");
}
