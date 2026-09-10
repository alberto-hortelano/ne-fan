/** La conversación SUELTA el ratón al abrirse y lo DEVUELVE al cerrarse, y solo
 *  si lo tenía (#323); lo que el jugador teclea con el panel delante va al
 *  motor tal cual (opción numerada y texto libre), y una tecla de más no pide
 *  otra conversación. Es lo que `ui/conversacion.ts` (corte 6 de #358) promete
 *  y ningún guion medía: el 41 comprueba que DESPUÉS de hablar se puede volver
 *  a capturar el ratón con un click; aquí se mide que no hace falta el click.
 *
 *  Cuatro hechos, cada uno con su sabotaje medido (QA del corte 6, 2026-09-06):
 *
 *   · CURSOR: sin el ratón capturado, abrir y cerrar no lo capturan por su
 *     cuenta (`pointerlockchange` no se dispara ni una vez). Rojo si `cerrar`
 *     pide el lock sin mirar si lo tenía.
 *   · LOCK: con el ratón capturado por click, abrir lo suelta (el panel lo
 *     hace por dentro), y elegir con `1` lo DEVUELVE antes de que llegue la
 *     línea siguiente, que lo vuelve a soltar: la cronología es
 *     `false, true, false`. Rojo con `devolverElRatonTrasElDialogo` → `return`
 *     (medido: `[false]` — la línea siguiente no tiene nada que soltar — y el
 *     cierre final se queda en `[]` en vez de `[true]`).
 *   · TEXTO LIBRE: `T`, escribir, `Enter` → el motor ecoa lo escrito. Rojo con
 *     `chosenText: ""` y sin `freeText` en `onFreeText` (medido: eco vacío).
 *   · E DOS VECES: con el panel abierto, una segunda `E` completa el texto y NO
 *     manda otro `interact_entity` (el turno del motor falso no sube). Rojo si
 *     el proveedor deja pasar la E con la conversación abierta.
 *
 *  Y dos más, de la tanda del 2026-09-10, que son el mismo mecanismo —quién
 *  posee el pointer lock— visto desde los dos sitios que lo tocan:
 *
 *   · DOS LÍNEAS SEGUIDAS (#502): el motor manda dos `dialogue` en la MISMA
 *     respuesta (son entradas de `consequences[]`) y el cliente las abre una
 *     detrás de otra. `abrir()` apuntaba «tenía el ratón» en cada llamada, y la
 *     segunda encontraba el lock ya soltado por la primera: `false`, y al
 *     cerrar el ratón no volvía. Rojo sin el `if (!panel.isVisible)` de
 *     `ui/conversacion.ts` (medido: `[]` en vez de `[true]` al cerrar).
 *   · EL MURO CON BOTÓN (#503): con el motor caído, elegir una opción cierra el
 *     panel, devuelve el lock y acto seguido el fallo pinta el muro a pantalla
 *     completa con «Cerrar» — un botón, el ratón capturado y ningún cursor.
 *     Rojo sin `soltarElRatonParaLosBotones()` en `fallo()`
 *     (`ui/muro-de-carga.ts`): `pointerLockElement !== null` con el muro
 *     delante, y el centro de «Cerrar» sin recibir el click.
 *
 *  SE CORRE SIN `?input=scripted` A PROPÓSITO, como el 37 y el 43: el driver
 *  de bench no pasa por la puerta del teclado ni por el panel. El lock se
 *  observa con un `pointerlockchange` instalado ANTES de hablar, no leyendo
 *  `pointerLockElement` en momentos elegidos: la devolución dura 5 ms antes de
 *  que la línea siguiente lo suelte otra vez, y un sondeo la perdería.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

const A_UN_PASO = 1.2;
const NPC = "barkeep";
/** La marca que hace que el motor falso conteste con DOS `dialogue` en la misma
 *  respuesta, y el prefijo de esa segunda línea. Las declara
 *  `labs/narrative/fake-ai-server.ts` (`MARCA_DOS_LINEAS` / `SEGUNDA_LINEA`);
 *  aquí se copian porque el guion es `.mjs` y el motor falso `.ts`, y cambiar
 *  una sin la otra tiene que ponerse rojo — el bloque 4 afirma las dos. */
const MARCA_DOS_LINEAS = "DOS LINEAS SEGUIDAS";
const SEGUNDA_LINEA = "(bench bis)";
/** Y la que hace que el motor falso conteste 500 a esa elección
 *  (`MARCA_MOTOR_CAIDO`), que es como se llega al muro de fallo del bloque 5. */
const MARCA_MOTOR_CAIDO = "MOTOR CAIDO";

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

/** Se planta al lado del NPC (teletransporte de bench) y espera a que el juego
 *  OFREZCA hablar en la barra contextual; si el jugador murió por el camino
 *  (el bandido del turno 2 del fake pega), revive con R antes. */
async function plantarse(ctx) {
  const vida = await ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? 1));
  if (vida <= 0) {
    await ctx.page.keyboard.press("r");
    await ctx.waitFor(
      "el jugador revive (R)",
      () => (Number(document.getElementById("player-hp-text")?.textContent ?? 0) > 0 ? { vivo: true } : null),
      15_000,
    );
  }
  const npc = await ctx.waitFor(
    `el NPC ${NPC} está en el mundo`,
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    30_000,
    NPC,
  );
  await ctx.nefan("setPlayerPos", npc.pos.x + A_UN_PASO, npc.pos.z);
  await ctx.waitFor(
    `el juego ofrece hablar con ${NPC}`,
    () => document.querySelector('#interact-prompt [data-action="interact"]')?.textContent ?? null,
    30_000,
  );
}

/** E con el teclado REAL, cuatro fotogramas (el bucle la consume por frame). */
async function pulsarE(ctx) {
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
}

async function hablar(ctx) {
  await pulsarE(ctx);
  return ctx.waitFor(
    "el NPC contesta y el panel se abre",
    () => (window.__nefan.dialogue().visible ? window.__nefan.dialogue() : null),
    120_000,
  );
}

/** Espera a que el typewriter termine y las opciones estén en pantalla. */
function panelPintado(ctx) {
  return ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && botones > 0 && texto === d.text ? { botones, lock: document.pointerLockElement !== null } : null;
    },
    60_000,
  );
}

/** La línea siguiente del motor, distinta de la actual (la elección llegó). */
function respuestaDelMotor(ctx, textoAntes) {
  return ctx.waitFor(
    "el motor contesta con OTRA línea",
    (antes) => {
      const d = window.__nefan.dialogue();
      return d.visible && d.text !== antes ? d.text : null;
    },
    120_000,
    textoAntes,
  );
}

async function turnoDelFake(ctx) {
  const url = await ctx.page.evaluate(() => window.__nefan.servicios?.()?.["narrative-llm"] ?? null);
  if (!url) return null;
  const r = await fetch(`${url.replace(/\/$/, "")}/dev/counters`);
  return (await r.json()).dialogueTurn;
}

async function cerrarConElSeam(ctx) {
  await ctx.nefan("advanceDialogue");
  await ctx.waitFor("el panel se cierra", () => (!window.__nefan.dialogue().visible ? { cerrado: true } : null), 10_000);
}

export default async function (ctx) {
  // ── 0 · Proveedor de TECLADO y observador del lock ───────────────────────
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO (el de bench no pasa por el panel ni por la puerta)",
    await ctx.page.evaluate(() => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver),
    url.toString(),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  await ctx.page.evaluate(() => {
    window.__g83 = { lock: [] };
    document.addEventListener("pointerlockchange", () => {
      window.__g83.lock.push(document.pointerLockElement !== null);
    });
  });
  const cronologia = () => ctx.page.evaluate(() => window.__g83.lock.splice(0));

  // ── 1 · CURSOR: nadie captura el ratón por su cuenta ─────────────────────
  await plantarse(ctx);
  const sinLock = await ctx.page.evaluate(() => document.pointerLockElement === null);
  ctx.expect("precondición: el jugador está en modo cursor (nadie ha hecho click en el mundo)", sinLock);
  const abierto1 = await hablar(ctx);
  const turnoAbierto = await turnoDelFake(ctx);
  // E DOS VECES: la segunda, con el typewriter corriendo, completa el texto.
  await pulsarE(ctx);
  const pintado1 = await panelPintado(ctx);
  const turnoTrasE2 = await turnoDelFake(ctx);
  ctx.log(`turno del fake al abrir: ${turnoAbierto} · tras la segunda E: ${turnoTrasE2} · botones: ${pintado1.botones}`);
  ctx.expect(
    "una segunda E con el panel abierto NO pide otra conversación (el turno del motor falso no sube)",
    turnoAbierto !== null && turnoTrasE2 === turnoAbierto,
    `${turnoAbierto} → ${turnoTrasE2}`,
  );
  await ctx.shot("cursor-panel-abierto");
  await ctx.page.keyboard.press("1");
  await respuestaDelMotor(ctx, abierto1.text);
  const enCursor = await cronologia();
  ctx.expect(
    "en modo cursor, abrir y cerrar (elegir con 1) NO capturan el ratón: cero cambios de lock",
    enCursor.length === 0,
    JSON.stringify(enCursor),
  );

  // ── 2 · TEXTO LIBRE: T, escribir, Enter → el motor lo ecoa ───────────────
  await panelPintado(ctx);
  const antesT = await ctx.page.evaluate(() => window.__nefan.dialogue().text);
  await ctx.page.keyboard.press("t");
  const caja = await ctx.waitFor(
    "T abre la caja de texto libre",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? { abierta: true } : null),
    5_000,
  );
  ctx.expect("T abre la caja de texto libre con el panel delante", caja.abierta === true);
  const FRASE = "guion ochenta y tres";
  await ctx.page.keyboard.type(FRASE);
  await ctx.page.keyboard.press("Enter");
  const eco = await respuestaDelMotor(ctx, antesT);
  ctx.expect("lo escrito llega al motor tal cual: la línea siguiente lo ecoa", eco.includes(FRASE), eco.slice(0, 120));
  await panelPintado(ctx);
  await ctx.shot("eco-del-texto-libre");
  await cerrarConElSeam(ctx);
  await cronologia();

  // ── 3 · LOCK: abrir suelta, elegir devuelve, la línea siguiente suelta ───
  await plantarse(ctx);
  const lienzo = await ctx.page.$("canvas");
  const caja3 = await lienzo.boundingBox();
  await ctx.page.mouse.click(caja3.x + caja3.width / 2, caja3.y + caja3.height / 2);
  const capturado = await ctx.waitFor(
    "el click sobre el mundo captura el ratón",
    () => (document.pointerLockElement !== null ? { lock: true } : null),
    10_000,
  );
  ctx.expect("precondición: el click sobre el mundo captura el ratón", capturado.lock === true);
  // El `pointerlockchange` del click llega DESPUÉS de que `pointerLockElement`
  // ya lo enseñe: esperar a que esté anotado antes de vaciar la cronología, o
  // el `true` del click se cuela en la cuenta de la conversación.
  await ctx.waitFor("el pointerlockchange del click queda anotado", () => (window.__g83.lock.length > 0 ? { n: window.__g83.lock.length } : null), 5_000);
  await cronologia();
  const abierto3 = await hablar(ctx);
  const pintado3 = await panelPintado(ctx);
  ctx.expect("al abrirse, el panel SUELTA el ratón (sin cursor no se pueden clicar las opciones)", pintado3.lock === false);
  await ctx.shot("lock-soltado-panel-abierto");
  await ctx.page.keyboard.press("1");
  await respuestaDelMotor(ctx, abierto3.text);
  const conLock = await cronologia();
  ctx.log(`cronología del lock desde abrir: ${JSON.stringify(conLock)}`);
  ctx.expect(
    "abrir suelta (false) → elegir con 1 DEVUELVE el ratón (true, #323) → la línea siguiente lo suelta otra vez (false)",
    JSON.stringify(conLock) === "[false,true,false]",
    JSON.stringify(conLock),
  );
  await panelPintado(ctx);
  await cerrarConElSeam(ctx);
  const alCerrar = await cronologia();
  ctx.expect(
    "cerrar la última línea (abierta con el ratón ya devuelto) lo devuelve: el jugador acaba como empezó, con el ratón capturado",
    JSON.stringify(alCerrar) === "[true]",
    JSON.stringify(alCerrar),
  );
  // ── 4 · DOS LÍNEAS SEGUIDAS: la segunda no pisa el apunte (#502) ─────────
  // El motor puede mandar dos `dialogue` en la MISMA respuesta —son entradas de
  // `consequences[]`— y el cliente las abre una detrás de otra. `abrir()`
  // apuntaba «tenía el ratón» en CADA llamada, y la segunda encontraba el lock
  // ya soltado por la primera (`pointerLockElement` se vacía síncrono tras
  // `exitPointerLock()`): el apunte pasaba a `false` y al cerrar el ratón no
  // volvía, aunque el jugador lo tuviera capturado antes de hablar. Se pide con
  // la marca del motor falso en el texto libre.
  await plantarse(ctx);
  const caja4 = await (await ctx.page.$("canvas")).boundingBox();
  await ctx.page.mouse.click(caja4.x + caja4.width / 2, caja4.y + caja4.height / 2);
  await ctx.expectEspera(
    "precondición del bloque 4: el click sobre el mundo captura el ratón",
    true,
    () => (document.pointerLockElement !== null ? { lock: true } : null),
    { ms: 10_000 },
  );
  await ctx.waitFor("el pointerlockchange del click queda anotado", () => (window.__g83.lock.length > 0 ? { n: window.__g83.lock.length } : null), 5_000);
  await cronologia();
  const abierto4 = await hablar(ctx);
  await panelPintado(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre (bloque 4)",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? { abierta: true } : null),
    5_000,
  );
  await ctx.page.keyboard.type(MARCA_DOS_LINEAS);
  await ctx.page.keyboard.press("Enter");
  const segunda = await respuestaDelMotor(ctx, abierto4.text);
  await panelPintado(ctx);
  ctx.expect(
    "el motor mandó DOS líneas en una respuesta y la que queda en pantalla es la SEGUNDA",
    segunda.startsWith(SEGUNDA_LINEA),
    segunda.slice(0, 120),
  );
  const dosLineas = await cronologia();
  ctx.log(`cronología con dos líneas seguidas: ${JSON.stringify(dosLineas)}`);
  ctx.expect(
    "abrir suelta (false) → el texto libre cierra y DEVUELVE (true) → las dos líneas nuevas lo sueltan UNA vez (false)",
    JSON.stringify(dosLineas) === "[false,true,false]",
    JSON.stringify(dosLineas),
  );
  await ctx.shot("dos-lineas-seguidas");
  await cerrarConElSeam(ctx);
  const trasDosLineas = await cronologia();
  ctx.expect(
    "cerrar tras DOS líneas seguidas devuelve el ratón: la segunda `abrir()` no pisó el apunte (#502)",
    JSON.stringify(trasDosLineas) === "[true]",
    JSON.stringify(trasDosLineas),
  );

  // ── 5 · EL MURO CON BOTÓN SUELTA EL RATÓN (#503) ─────────────────────────
  // Medido por QA del corte 6: con una conversación abierta y el motor muerto,
  // elegir una opción cierra el panel y DEVUELVE el lock (#323, correcto), y
  // acto seguido el fallo del motor pinta el muro a pantalla completa con
  // «Cerrar». Resultado: un botón, el ratón capturado y ningún cursor con el
  // que pulsarlo —y `#game-ui[data-locked="true"] .nf-action` le quita además
  // los `pointer-events`—. Esc lo salvaba y nada en pantalla lo decía.
  // El motor se mata en el BORDE (`page.route`), no dentro del cliente.
  await plantarse(ctx);
  const caja5 = await (await ctx.page.$("canvas")).boundingBox();
  await ctx.page.mouse.click(caja5.x + caja5.width / 2, caja5.y + caja5.height / 2);
  await ctx.expectEspera(
    "precondición del bloque 5: el jugador vuelve a tener el ratón capturado",
    true,
    () => (document.pointerLockElement !== null ? { lock: true } : null),
    { ms: 10_000 },
  );
  await hablar(ctx);
  await panelPintado(ctx);
  await cronologia();
  // El motor se cae CONTESTANDO, y lo pide el jugador con su propio texto: el
  // 500 lo sirve el motor falso ante la marca (`MARCA_MOTOR_CAIDO`) y el bridge
  // lo traduce a `narrative_status: error` kind `consequences`. No se toca
  // ningún proceso, y el fallo recorre la cadena entera —que es lo que
  // `page.route` NO podía hacer: `/report_player_choice` lo llama el BRIDGE, no
  // el navegador.
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre (bloque 5)",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? { abierta: true } : null),
    5_000,
  );
  await ctx.page.keyboard.type(MARCA_MOTOR_CAIDO);
  await ctx.page.keyboard.press("Enter");
  const muro = await ctx.waitFor(
    "el fallo del motor pinta el muro con «Cerrar»",
    () => {
      const el = document.getElementById("narrative-loader");
      const boton = document.getElementById("narrative-loader-dismiss");
      if (!el?.classList.contains("visible") || !el.classList.contains("error") || !boton || boton.hidden) return null;
      const r = boton.getBoundingClientRect();
      const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        lock: document.pointerLockElement !== null,
        locked: document.getElementById("game-ui")?.dataset.locked ?? null,
        alcanzable: arriba === boton || boton.contains(arriba),
        titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      };
    },
    60_000,
  );
  ctx.log(`muro de fallo: ${JSON.stringify(muro)}`);
  ctx.expect(
    "con el muro de fallo en pantalla, el ratón ya NO está capturado: hay cursor con el que pulsar (#503)",
    muro.lock === false && muro.locked === "false",
    JSON.stringify(muro),
  );
  ctx.expect(
    "…y el click en el centro de «Cerrar» le llega al botón, no a otra capa",
    muro.alcanzable === true,
    JSON.stringify(muro),
  );
  await ctx.shot("muro-con-boton-y-cursor");
  await cronologia();
  await ctx.page.click("#narrative-loader-dismiss");
  await ctx.waitFor(
    "«Cerrar» retira el muro",
    () => (!document.getElementById("narrative-loader")?.classList.contains("visible") ? { fuera: true } : null),
    10_000,
  );
  // Se ESPERA al `pointerlockchange`, no se lee en el acto: la clase del muro se
  // quita síncrona y el evento del lock llega después (el mismo cuidado que el
  // bloque 3 con el click del mundo).
  await ctx.expectEspera(
    "cerrar el muro DEVUELVE el ratón que soltó (#503): soltar y devolver son las dos mitades de un acto",
    true,
    () =>
      document.pointerLockElement !== null &&
      window.__g83.lock.length === 1 &&
      window.__g83.lock[0] === true
        ? true
        : null,
    { ms: 15_000 },
  );
  await cronologia();
  const errores = await ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  ctx.log(`registro de errores: ${JSON.stringify(errores)}`);
  ctx.expect(
    "ninguna devolución del ratón acabó en el registro («no se pudo devolver el ratón»): el navegador las concedió todas",
    !errores.some((t) => t.includes("no se pudo devolver el ratón")),
    JSON.stringify(errores),
  );
}
