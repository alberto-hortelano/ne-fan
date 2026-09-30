/** Lo que el 342 no mide de punta a punta (QA de la tanda BW, 2026-09-30):
 *  la réplica que llega TRAS UN VIAJE (H1b tal como salió jugando), la barra
 *  del enemigo al cambiar de tile SIN haber muerto (H2), y que el click que
 *  CAPTURA el ratón no cuenta como «el jugador se puso a pelear».
 *
 *   1 · H2, VIAJE SIN MORIR: el jugador se acerca al bandido hasta verle la
 *       barra (≤ 18 m) sin entrar en su radio de enganche; viaja al Molino por
 *       el panel «Salidas» → la barra del bandido (vivo, suelto, en otro tile)
 *       NO se ve y el panel de enemigos no se pinta vacío. Vuelta a la Taberna.
 *   2 · H1b, LA RÉPLICA TRAS UN VIAJE: se mata al bandido (paz), se saluda al
 *       tabernero, texto libre con la marca que RETIENE la réplica, y sin
 *       esperarla el jugador viaja al Molino (como con Maela y la Escalinata).
 *       Se suelta ya en el Molino → el panel NO se abre, el ataque no se
 *       bloquea y el registro trae la línea con «vuelve a hablarle con E».
 *   3 · ADVERSARIAL, EL CLICK QUE CAPTURA: de vuelta en la Taberna se recarga
 *       SIN `?input=scripted` (el proveedor de TECLADO y ratón, el del
 *       jugador) y se reanuda. E al tabernero, T + texto libre con la marca, y
 *       mientras el motor piensa, un click sobre el mundo con el ratón SIN
 *       capturar (lo que hace cualquiera para volver a mirar). Ese click
 *       captura, no ataca: al soltar la réplica, el panel SE ABRE.
 *
 *  EN NEGATIVO (medido al escribirlo, ver `qa.md` de la tanda BW):
 *   · bloque 1 rojo con `barras-de-enemigo.ts` sin ocultar (vital.hidden = false);
 *   · bloque 2 rojo con el `dialogue.ts` de antes de la tanda (sin entrega);
 *   · bloque 3 rojo si el mousedown ataca sin mirar el pointer lock.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";
import { viajarSiSePuede } from "../lib/viaje.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
/** `MARCA_REPLICA_TARDIA` del motor falso (copiada: el guion es `.mjs`). */
const MARCA = "REPLICA TARDIA";
const ENGANCHE_M = 10;
const ALCANCE_M = 18;

const frames = esperaDeFotogramas("mundo");

async function urlDelFake(ctx) {
  const url = await ctx.page.evaluate(() => window.__nefan.servicios?.()?.["narrative-llm"] ?? null);
  if (!url) throw new Error("el cliente no dice dónde está el motor (servicios()['narrative-llm'])");
  return url.replace(/\/$/, "");
}

const esperarRetenida = async (ctx, base, etiqueta) =>
  (await ctx.absorbe("si el motor no retiene la réplica, lo afirma el `expect` del sitio de llamada", () =>
    ctx.waitFor(
      `el motor falso tiene la réplica retenida (${etiqueta})`,
      async (b) => ((await (await fetch(`${b}/dev/counters`)).json()).replicaRetenida === true ? true : null),
      60_000,
      base,
    ),
  )) === true;

async function soltar(base) {
  const r = await fetch(`${base}/dev/soltar-replica`, { method: "POST" });
  if (!r.ok) throw new Error(`/dev/soltar-replica: HTTP ${r.status} ${await r.text()}`);
}

/** T, escribir, Enter — con las opciones ya en pantalla (ver el 342). */
async function textoLibre(ctx, frase) {
  await ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      return d.visible && botones > 0 && (document.getElementById("dialogue-text")?.textContent ?? "") === d.text ? true : null;
    },
    60_000,
  );
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(frase);
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFor("el panel se cierra al mandar", () => (window.__nefan.dialogue().visible ? null : true), 10_000);
}

/** La barra del enemigo tal como la ve el jugador. */
const barraDe = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const vital = document.getElementById(`hp-text-${eid}`)?.parentElement ?? null;
    const panel = document.getElementById("enemy-bars");
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    const p = window.__nefan.state().pos;
    return {
      existe: Boolean(vital),
      oculta: vital ? vital.hidden || getComputedStyle(vital).display === "none" : null,
      panelVisible: panel ? getComputedStyle(panel).display !== "none" : null,
      d: e ? Math.hypot(e.pos.x - p.x, e.pos.z - p.z) : null,
      vivo: e?.alive ?? null,
      tile: window.__nefan.currentTile,
    };
  }, id);

const lineaConFrase = (ctx, desc, frase) =>
  ctx.absorbe("si la línea no llega al registro, lo afirman los `expect` de abajo", () =>
    ctx.waitFor(
      desc,
      (f) =>
        [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? "").find((t) => t.includes(f)) ?? null,
      30_000,
      frase,
    ),
  );

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  const partida = await comenzar(ctx);
  const base = await urlDelFake(ctx);
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);

  // ── 1 · H2: viajar SIN morir, con el bandido suelto ───────────────────────
  await acercarse(ctx, BANDIDO, { objetivo: 15, tramos: 14 });
  const cerca = await barraDe(ctx, BANDIDO);
  ctx.log(`bloque 1, cerca del bandido: ${JSON.stringify(cerca)}`);
  if (cerca.d <= ENGANCHE_M) {
    ctx.sinMedirBloque(`el paseo dejó al jugador a ${cerca.d?.toFixed(1)} m, dentro del radio de enganche: el bloque 1 mide al bandido SUELTO`);
  } else {
    ctx.expect("CONTROL H2: a ≤ 18 m del bandido vivo su barra SE VE", cerca.oculta === false && cerca.d <= ALCANCE_M, JSON.stringify(cerca));
    const ida = await viajarSiSePuede(ctx, "Molino del bench", "el viaje al Molino llega", "la ida es precondición del bloque 1");
    if (!ida.llegada) ctx.sinMedir(`no se pudo viajar al Molino (${ida.causa})`);
    await frames(ctx, 10);
    const lejos = await barraDe(ctx, BANDIDO);
    ctx.log(`bloque 1, en el Molino: ${JSON.stringify(lejos)}`);
    ctx.expect("H2: tras viajar a otro tile (sin morir), la barra del bandido suelto NO se ve", lejos.oculta === true, JSON.stringify(lejos));
    ctx.expect("H2: y el panel de enemigos no se pinta vacío", lejos.panelVisible === false, JSON.stringify(lejos));
    await ctx.shot("h2-tras-viajar-sin-morir");
    const vuelta = await viajarSiSePuede(ctx, "Taberna del bench", "el viaje de vuelta llega", "la vuelta es precondición del bloque 2");
    if (!vuelta.llegada) ctx.sinMedir(`no se pudo volver a la Taberna (${vuelta.causa})`);
  }

  // ── 2 · H1b: la réplica que llega tras un viaje ───────────────────────────
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 16 });
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) ctx.sinMedir("el bandido mató al jugador: sin paz no hay conversación que medir");
  ctx.expect("PREMISA: el jugador mata al bandido", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta al saludo (panel)", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  const FRASE_VIAJE = `${MARCA} me voy al molino`;
  await textoLibre(ctx, FRASE_VIAJE);
  const retenida = await esperarRetenida(ctx, base, "antes del viaje");
  ctx.expect("el motor falso retiene la réplica (la marca llegó)", retenida);
  if (!retenida) return;
  const tileAntes = await ctx.page.evaluate(() => window.__nefan.currentTile);
  const ida2 = await viajarSiSePuede(ctx, "Molino del bench", "el viaje al Molino con la réplica pendiente llega", "el viaje es la premisa de H1b");
  if (!ida2.llegada) ctx.sinMedir(`no se pudo viajar al Molino con la réplica pendiente (${ida2.causa})`);
  ctx.log(`bloque 2: ${tileAntes} → ${ida2.llegada.tile}`);
  ctx.expect("PREMISA: el jugador está en OTRO tile antes de que llegue la réplica", ida2.llegada.tile !== tileAntes, `${tileAntes} → ${ida2.llegada.tile}`);
  await soltar(base);
  const linea = await lineaConFrase(ctx, "la réplica tras el viaje llega al REGISTRO", FRASE_VIAJE);
  await frames(ctx, 10);
  const tras = await ctx.page.evaluate(() => ({ panel: window.__nefan.dialogue().visible, dialogo: window.__nefan.puedeAtacar().dialogo }));
  ctx.log(`bloque 2: línea ${JSON.stringify(linea)} · ${JSON.stringify(tras)}`);
  ctx.expect("H1b: la réplica que llega tras un viaje NO abre el panel", tras.panel === false, JSON.stringify(tras));
  ctx.expect("H1b: ni bloquea el ataque", tras.dialogo === false, JSON.stringify(tras));
  ctx.expect(
    "H1b: la réplica va al registro, entera, con la pista de volver a hablarle con E",
    typeof linea === "string" && linea.includes("💬") && linea.includes("(vuelve a hablarle con E)"),
    JSON.stringify(linea),
  );
  await ctx.shot("h1b-replica-tras-viajar-en-el-registro");
  const vuelta2 = await viajarSiSePuede(ctx, "Taberna del bench", "la vuelta a la Taberna llega", "la vuelta es precondición del bloque 3");
  if (!vuelta2.llegada) ctx.sinMedir(`no se pudo volver a la Taberna (${vuelta2.causa})`);

  // ── 3 · ADVERSARIAL: el click que captura el ratón no es un ataque ───────
  const reanudada = await reanudar(ctx, partida.sessionId, {
    alRecargar: async () => {
      const url = new URL(ctx.page.url());
      url.searchParams.delete("input");
      await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
    },
  });
  if (!reanudada) return;
  ctx.expect(
    "el bloque 3 corre con el proveedor de TECLADO y ratón (el del jugador)",
    await ctx.page.evaluate(() => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver),
  );
  const tab = await ctx.waitFor(
    "el tabernero está en la escena reanudada",
    (id) => window.__nefan.npcs().find((n) => n.id === id)?.pos ?? null,
    60_000,
    TABERNERO,
  );
  await ctx.nefan("setPlayerPos", tab.x + 1.2, tab.z);
  await frames(ctx, 10);
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
  await ctx.waitFor("E: el tabernero contesta (panel)", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  const FRASE_CLICK = `${MARCA} solo capturo el raton`;
  await textoLibre(ctx, FRASE_CLICK);
  const retenida3 = await esperarRetenida(ctx, base, "bloque 3");
  ctx.expect("el motor falso retiene la réplica del bloque 3", retenida3);
  if (!retenida3) return;
  const lockAntes = await ctx.page.evaluate(() => document.pointerLockElement !== null);
  ctx.expect("PREMISA: tras mandar el texto el ratón NO está capturado (no lo estaba al hablar)", lockAntes === false);
  const caja = await (await ctx.page.$("canvas")).boundingBox();
  await ctx.page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await ctx.expectEspera("el click sobre el mundo captura el ratón", true, () => (document.pointerLockElement !== null ? true : null), { ms: 10_000 });
  await frames(ctx, 20);
  await soltar(base);
  const abierto = await ctx.absorbe("si el panel no se abre, lo afirma el `expect` de abajo", () =>
    ctx.waitFor(
      "la réplica abre el panel (el click solo capturó)",
      (f) => {
        const d = window.__nefan.dialogue();
        return d.visible && (d.text ?? "").includes(f) ? true : null;
      },
      30_000,
      FRASE_CLICK,
    ),
  );
  const enRegistro = (await ctx.page.evaluate(() => [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? ""))).find(
    (t) => t.includes(FRASE_CLICK),
  );
  ctx.log(`bloque 3: panel ${abierto === true} · registro ${JSON.stringify(enRegistro ?? null)}`);
  ctx.expect("ADVERSARIAL: el click que CAPTURA el ratón no cuenta como ataque — la réplica abre el panel", abierto === true, JSON.stringify(enRegistro ?? null));
  await ctx.shot("click-que-captura-no-es-ataque");
}
