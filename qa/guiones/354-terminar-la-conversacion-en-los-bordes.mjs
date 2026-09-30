/** TERMINAR UNA CONVERSACIÓN, en los bordes (pasada adversarial de la QA de
 *  la tanda BX, 2026-09-30). El 351 mide el camino normal; aquí lo que un
 *  jugador hace sin pensarlo:
 *
 *   T · TEXTO A MEDIO ESCRIBIR + click en «terminar»: el panel se cierra y lo
 *       escrito NO viaja al motor (su turno no sube). Y el aviso: con Esc,
 *       lo escrito se pierde sin preguntar (se registra, es juicio).
 *   M · MORIR CON EL PANEL ABIERTO: el bandido pega mientras se habla. Con el
 *       jugador caído, ¿sigue el panel? Si sigue, «terminar» es alcanzable y
 *       lo cierra sin error; al despertar se puede atacar.
 *   D · DOBLE CLIC en «terminar» con el ratón del jugador: se cierra UNA vez
 *       (una sola acotación de fin en el contexto del motor) y el segundo
 *       click NO ataca a nadie.
 *   V · PEDIR UN VIAJE CON EL PANEL ABIERTO lo TERMINA (H1 de la QA de BX):
 *       salida pulsada → con el tile aún generándose, el panel ya está fuera
 *       (no queda vivo bajo el velo «Viajando…», donde su botón no recibía el
 *       click) y el cliente mandó UN `dialogue_end` → al llegar, el jugador
 *       anda y ataca, y el panel no vuelve.
 *
 *  EN NEGATIVO (medido):
 *   · con `conversacion.ts` sin la llamada a `sendDialogueEnd`, D2 se pone
 *     rojo (el motor no ve los fines) — QA de BX;
 *   · con `ui/pedir-un-viaje.ts` sin `conversacion.terminar()`, V se pone
 *     rojo (el panel sigue abierto bajo el velo) — ingeniero, arreglo de H1.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, herirHasta, dejarseHerirHasta, conductaDelDespertar, esperarElDespertar } from "../lib/combate.mjs";
import { pulsarSalida, sondaDeViaje } from "../lib/viaje.mjs";
import { MS_DEL_TILE } from "../lib/tile-episodio.mjs";
import { URLS } from "../lib/stack.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
const FIN = "(el jugador da por terminada la conversación y se aparta)";

const frames = esperaDeFotogramas("mundo");

async function contadores() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters: HTTP ${r.status}`);
  return r.json();
}

async function conductaDeTiles(ctx, cambio) {
  const res = await fetch(`${URLS.fake_ai}/dev/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambio),
  });
  if (!res.ok) throw new Error(`POST /dev/tiles HTTP ${res.status}: ${await res.text()}`);
}

const opcionesEnPantalla = (ctx) =>
  ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      return d.visible && botones > 0 && (document.getElementById("dialogue-text")?.textContent ?? "") === d.text ? true : null;
    },
    60_000,
  );

const botonAlcanzable = (ctx) =>
  ctx.page.evaluate(() => {
    const b = document.getElementById("dialogue-end");
    if (!b) return { existe: false };
    const r = b.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      existe: true,
      visible: !b.closest("[hidden]") && r.width > 0,
      alcanzable: arriba === b || b.contains(arriba),
      tapa: arriba && arriba !== b && !b.contains(arriba) ? `${arriba.tagName}#${arriba.id}.${arriba.className}` : null,
      centro: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
    };
  });

const panelVisible = (ctx) => ctx.page.evaluate(() => window.__nefan.dialogue().visible);
const errores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div"))
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => !t.includes("sin errores")),
  );
const episodio = (ctx) => ctx.page.evaluate(() => window.__nefan.fps().telegraphEpisode?.episode ?? 0);

async function saludarScripted(ctx, desc) {
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  return (
    (await ctx.absorbe("lo afirma el sitio de llamada", () =>
      ctx.waitFor(desc, () => (window.__nefan.dialogue().visible ? true : null), 60_000),
    )) === true
  );
}

async function plantarse(ctx, etiqueta) {
  const npc = await ctx.waitFor(`${etiqueta}: el tabernero está en la escena`, (id) => window.__nefan.npcs().find((n) => n.id === id)?.pos ?? null, 60_000, TABERNERO);
  await ctx.nefan("setPlayerPos", npc.x + 1.2, npc.z);
  await ctx.page.evaluate((id) => {
    const n = window.__nefan.npcs().find((x) => x.id === id);
    const p = window.__nefan.state().pos;
    if (n && p) window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
  }, TABERNERO);
  await ctx.waitFor(`${etiqueta}: el juego ofrece hablar`, () => document.querySelector('#interact-prompt [data-action="interact"]')?.textContent ?? null, 30_000);
}

async function pulsarE(ctx) {
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
}

async function clickEnElMundo(ctx) {
  const caja = await (await ctx.page.$("canvas")).boundingBox();
  await ctx.page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const partida = await comenzar(ctx);

  // ── M · MORIR CON EL PANEL ABIERTO (el bandido sigue vivo) ───────────────
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await conductaDelDespertar(ctx, "tarda", 8_000);
  const abiertoM = await saludarScripted(ctx, "M: el tabernero contesta (panel)");
  ctx.expect("M: saludar con el bandido vivo abre el panel", abiertoM);
  if (!abiertoM) return;
  // WORKAROUND declarado en qa.md: se lleva al jugador junto al bandido con el
  // panel abierto (el jugador de verdad llega ahí si el bandido le persigue
  // mientras habla). Solo produce el ESTADO «caído con el panel abierto».
  const b = await ctx.page.evaluate((id) => window.__nefan.enemies().find((x) => x.id === id)?.pos ?? null, BANDIDO);
  await ctx.nefan("setPlayerPos", b.x + 1.0, b.z);
  const herido = await dejarseHerirHasta(ctx, BANDIDO, 0, { sim: 120 });
  if (!herido) ctx.sinMedir("el bandido no llegó a tumbar al jugador");
  await frames(ctx, 10);
  const caidoM = await ctx.page.evaluate(() => ({
    panel: window.__nefan.dialogue().visible,
    velo: !document.getElementById("velo-del-despertar")?.hidden,
  }));
  ctx.log(`M: caído → ${JSON.stringify(caidoM)}`);
  await ctx.shot("m-caido-con-el-panel");
  ctx.expect("M: PREMISA: el jugador cae con el panel abierto (el estado que se mide)", caidoM.panel === true, JSON.stringify(caidoM));
  const bm = await botonAlcanzable(ctx);
  ctx.expect("M: caído con el panel abierto, «terminar» es alcanzable", bm.alcanzable === true, JSON.stringify(bm));
  await ctx.page.click("#dialogue-end");
  await frames(ctx, 10);
  ctx.expect("M: «terminar» con el jugador caído cierra el panel", !(await panelVisible(ctx)));
  ctx.expect("M: sin errores en el registro tras terminar caído", (await errores(ctx)).length === 0, JSON.stringify(await errores(ctx)));
  const desp = await esperarElDespertar(ctx, "M", { velo: false, sim: 60 });
  ctx.expect("M: el jugador despierta", desp?.hp > 0, JSON.stringify(desp));
  ctx.expect("M: al despertar el panel no está", !(await panelVisible(ctx)));
  await conductaDelDespertar(ctx, "normal");

  // El bandido fuera, para lo que sigue.
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  const muerto = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (!muerto?.muerto) ctx.sinMedir(`no se pudo quitar al bandido de en medio: ${JSON.stringify(muerto)}`);

  // ── T · TEXTO A MEDIO ESCRIBIR ───────────────────────────────────────────
  const abiertoT = await saludarScripted(ctx, "T: el tabernero contesta (panel)");
  ctx.expect("T: saludar abre el panel", abiertoT);
  if (!abiertoT) return;
  await opcionesEnPantalla(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor("T abre la caja", () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null), 5_000);
  await ctx.page.keyboard.type("quería preguntarte por el mol");
  await ctx.shot("t-texto-a-medio-escribir");
  const turnoT = (await contadores()).dialogueTurn;
  await ctx.page.click("#dialogue-end");
  await frames(ctx, 10);
  ctx.expect("T: click en «terminar» con texto a medias cierra el panel", !(await panelVisible(ctx)));
  ctx.expect("T: lo escrito a medias NO viaja al motor", (await contadores()).dialogueTurn === turnoT);
  // Esc con texto a medias: ¿qué pasa con lo escrito?
  const abiertoT2 = await saludarScripted(ctx, "T2: el tabernero contesta (panel)");
  ctx.expect("T2: saludar otra vez abre el panel", abiertoT2);
  if (!abiertoT2) return;
  await opcionesEnPantalla(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.page.keyboard.type("una frase larga que llevo un rato escribiendo");
  await ctx.page.keyboard.press("Escape");
  await frames(ctx, 4);
  await ctx.page.keyboard.press("t");
  await frames(ctx, 4);
  const conservado = await ctx.page.evaluate(() => document.getElementById("dialogue-input")?.value ?? null);
  ctx.log(`T2: tras Esc y T otra vez, la caja trae: ${JSON.stringify(conservado)} (juicio en qa.md)`);
  // Doble toque de Esc a ritmo humano: unos fotogramas entre pulsaciones
  // (~100 ms a 60 fps), contados en fotogramas y no en reloj de pared.
  await ctx.page.keyboard.press("Escape");
  await frames(ctx, 6);
  await ctx.page.keyboard.press("Escape");
  await frames(ctx, 4);
  ctx.expect("T2: Esc, Esc (a ritmo humano) cierra la caja y termina", !(await panelVisible(ctx)));

  // El Secuaz hostil del turno 2 del motor falso, fuera (si no, mata al
  // jugador a mitad de D y el bloque mide su muerte).
  const secuaz = await ctx.page.evaluate(() => window.__nefan.enemies().find((e) => e.alive)?.id ?? null);
  if (secuaz) {
    await acercarse(ctx, secuaz, { objetivo: 1.6, tramos: 14 });
    const fuera = await herirHasta(ctx, secuaz, 0, { sim: 90 });
    if (!fuera?.muerto) ctx.sinMedir(`no se pudo quitar al ${secuaz} de en medio: ${JSON.stringify(fuera)}`);
  }

  // ── D · DOBLE CLIC con el ratón del jugador ──────────────────────────────
  const reanudada = await reanudar(ctx, partida.sessionId, {
    alRecargar: async () => {
      const url = new URL(ctx.page.url());
      url.searchParams.delete("input");
      await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
    },
  });
  if (!reanudada) return;
  const aviso = await ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    const boton = document.getElementById("narrative-loader-dismiss");
    return el?.classList.contains("visible") && boton && !boton.hidden ? document.getElementById("narrative-loader-title")?.textContent ?? "?" : null;
  });
  if (aviso) {
    ctx.log(`D: HALLAZGO al reanudar: aviso «${aviso}» tapa la pantalla; se cierra con su botón`);
    await ctx.page.click("#narrative-loader-dismiss");
  }
  await plantarse(ctx, "D");
  await clickEnElMundo(ctx);
  await ctx.expectEspera("D: PREMISA: el ratón capturado", true, () => (document.pointerLockElement !== null ? true : null), { ms: 10_000 });
  await frames(ctx, 10);
  await pulsarE(ctx);
  await ctx.waitFor("D: E abre el panel", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  await opcionesEnPantalla(ctx);
  const bd = await botonAlcanzable(ctx);
  const epD = await episodio(ctx);
  await ctx.page.mouse.dblclick(bd.centro.x, bd.centro.y);
  await frames(ctx, 20);
  const trasD = await ctx.page.evaluate(() => ({ panel: window.__nefan.dialogue().visible, lock: document.pointerLockElement !== null }));
  const epTrasD = await episodio(ctx);
  ctx.log(`D: tras doble clic ${JSON.stringify(trasD)} · episodio ${epD} → ${epTrasD}`);
  ctx.expect("D: el doble clic cierra el panel", trasD.panel === false);
  ctx.expect("D: el segundo click del doble clic NO ataca", epTrasD === epD, `${epD} → ${epTrasD}`);
  await ctx.expectEspera("D: el ataque (si lo hubo) termina", true, () => (window.__nefan.fps().telegraph === null ? true : null), { ms: 10_000 });
  // ¿Cuántos fines vio el motor? Un saludo más y se cuentan en su contexto.
  await plantarse(ctx, "D2");
  if (!(await ctx.page.evaluate(() => document.pointerLockElement !== null))) await clickEnElMundo(ctx);
  await frames(ctx, 10);
  await pulsarE(ctx);
  await ctx.waitFor("D2: E abre el panel", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  const recientes = (await contadores()).ultimosDialogosRecientes ?? [];
  const fines = recientes.filter((d) => d?.chosen === FIN).length;
  ctx.log(`D2: fines en recent_dialogues = ${fines} · ${JSON.stringify(recientes.map((d) => d.chosen || d.free_text).slice(-6))}`);
  // Hasta aquí se terminaron: M (si el panel siguió), T, T2 y D = 3 o 4.
  ctx.expect("D2: el doble clic apuntó UN fin, no dos (fines ≤ 4)", fines <= 4 && fines >= 3, String(fines));

  // ── V · TERMINAR CON EL VIAJE EN MARCHA ──────────────────────────────────
  await opcionesEnPantalla(ctx);
  const antes = await ctx.page.evaluate(() => ({ tile: window.__nefan.currentTile, pedido: window.__nefan.viaje?.pedido ?? null }));
  await conductaDeTiles(ctx, { delay_ms: 15_000 });
  try {
    // Espía de lo que el cliente MANDA: cuántos `dialogue_end` salen al pedir
    // el viaje (el socket ya existe, así que se envuelve el prototipo).
    await ctx.page.evaluate(() => {
      window.__g354 = { fines: 0 };
      const enviar = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) {
        if (typeof d === "string" && d.includes('"type":"dialogue_end"')) window.__g354.fines++;
        return enviar.call(this, d);
      };
    });
    const pulsada = await pulsarSalida(ctx, "Molino del bench");
    if (!pulsada) ctx.sinMedir("no hay salida «Molino del bench»");
    await frames(ctx, 10);
    const enMarcha = await ctx.page.evaluate(() => ({
      panel: window.__nefan.dialogue().visible,
      tile: window.__nefan.currentTile,
      llegado: window.__nefan.viaje?.llegado ?? null,
      fines: window.__g354.fines,
    }));
    ctx.log(`V: con el viaje pedido: ${JSON.stringify(enMarcha)}`);
    await ctx.shot("v-viaje-en-marcha-sin-panel");
    ctx.expect(
      "V (H1): pedir el viaje TERMINA la conversación: con el tile aún sin llegar, el panel ya no está bajo el velo",
      enMarcha.panel === false && enMarcha.tile === antes.tile,
      JSON.stringify(enMarcha),
    );
    ctx.expect("V (H1): …y queda el fin, como con el botón: el cliente mandó UN dialogue_end", enMarcha.fines === 1, JSON.stringify(enMarcha));
    const llegada = await ctx.absorbe("si el viaje no llega lo afirma el expect de llegada justo debajo de esta espera", () =>
      ctx.waitFor("V: el viaje llega", sondaDeViaje, MS_DEL_TILE, { desde: antes.tile, pedidoPrevio: antes.pedido }),
    );
    ctx.expect("V: el viaje llega tras terminar la conversación", llegada?.estado === "llegado", JSON.stringify(llegada?.estado ?? null));
    await frames(ctx, 20);
    ctx.expect("V: al llegar, el panel no vuelve", !(await panelVisible(ctx)));
    ctx.expect("V: sin errores", (await errores(ctx)).length === 0, JSON.stringify(await errores(ctx)));
    const lockV = await ctx.page.evaluate(() => document.pointerLockElement !== null);
    const erroresV = await errores(ctx);
    ctx.expect(
      "V: tras terminar, el ratón vuelve solo o el registro dice que no se pudo",
      lockV || erroresV.some((t) => t.includes("no se pudo devolver el ratón")),
      JSON.stringify({ lockV, erroresV }),
    );
    if (!lockV) {
      await clickEnElMundo(ctx);
      await ctx.expectEspera("V: un click recaptura el ratón", true, () => (document.pointerLockElement !== null ? true : null), { ms: 10_000 });
    }
    const antesW = await ctx.page.evaluate(() => window.__nefan.state().pos);
    await ctx.page.keyboard.down("w");
    try {
      await frames(ctx, 30);
    } finally {
      await ctx.page.keyboard.up("w");
    }
    const despuesW = await ctx.page.evaluate(() => window.__nefan.state().pos);
    const andado = Math.hypot(despuesW.x - antesW.x, despuesW.z - antesW.z);
    ctx.expect("V: W mueve al jugador", andado > 0.2, `${andado.toFixed(2)} m`);
    const ep = await episodio(ctx);
    await ctx.page.mouse.down();
    await ctx.page.mouse.up();
    await ctx.expectEspera("V: LMB ataca", true, (n) => ((window.__nefan.fps().telegraphEpisode?.episode ?? 0) > n ? true : null), { ms: 10_000, arg: ep });
    await ctx.expectEspera("V: el ataque termina", true, () => (window.__nefan.fps().telegraph === null ? true : null), { ms: 10_000 });
    await ctx.shot("v-llegado-anda-y-ataca");
  } finally {
    await conductaDeTiles(ctx, { delay_ms: 0 });
  }
}
