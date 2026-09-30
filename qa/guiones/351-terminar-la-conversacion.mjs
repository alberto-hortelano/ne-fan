/** TERMINAR UNA CONVERSACIÓN sin contestar (tanda BX): «La conversacion
 *  deberia tener un boton para finalizarla».
 *
 *  Hasta esta tanda, con opciones en pantalla el panel solo se cerraba
 *  ELIGIENDO una —y elegir manda una petición al motor—, y el panel suelta el
 *  ratón, así que tampoco se podía alejar uno andando. Ahora hay un botón
 *  «terminar» (`#dialogue-end`, fuera de la barra de opciones: se ve también
 *  durante el typewriter) y Esc hace lo mismo. Terminar NO pregunta al motor:
 *  el bridge lo apunta en el historial (`dialogue_end`) y el motor lo lee en
 *  `recent_dialogues` la próxima vez que le hablen (opción B).
 *
 *  Con el driver de bench (`?input=scripted`), las teclas del panel SÍ pasan
 *  por la puerta (la T del 342 las usa):
 *   B · CON OPCIONES: click REAL en «terminar» → el panel se cierra y el motor
 *       falso no recibe ninguna petición (su turno no sube).
 *   C · TEXTO LIBRE: T + texto → Esc cierra SOLO la caja (el panel sigue, sin
 *       input) → un segundo Esc termina. Y el saludo de este bloque trae en su
 *       contexto el fin del bloque B (R4: el motor se entera sin gastar).
 *   E · LA RÉPLICA TARDÍA TRAS TERMINAR: texto libre con la marca que retiene
 *       la réplica → E otra vez → llega el saludo → Esc → se suelta la réplica
 *       → el panel NO se abre y el registro trae la línea (motivo `terminada`).
 *   F · CONTROL: la marca sin terminar nada → la réplica SÍ abre el panel.
 *  Y con el proveedor de TECLADO y ratón (el del jugador; recarga + reanudar):
 *   A · E al tabernero con el ratón capturado → Esc DURANTE el typewriter → el
 *       panel se cierra; WASD mueve y un LMB con el lock ataca. Esc NO es un
 *       gesto de activación (spec HTML), así que el navegador puede negarse a
 *       devolver el ratón: si se niega, el registro lo dice y UN click sobre el
 *       mundo lo recaptura SIN atacar. Se afirma lo que haya pasado, no se
 *       elige de antemano.
 *   G · EL BOTÓN SÍ ES GESTO: con el ratón capturado, E → click en «terminar»
 *       → el ratón vuelve solo.
 *
 *  EN NEGATIVO (medido al escribirlo, ver `implementacion.md` de BX):
 *   · bloque A rojo con Esc detrás de la guarda del typewriter en el panel;
 *   · bloque E rojo con `dialogue.ts` sin la foto de `conversacion.terminadas`.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

/** `saves` para arrancar en el tile de bootstrap; `fake-ai` para que los
 *  turnos del motor falso empiecen en cero y no haya réplica heredada. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
/** `MARCA_REPLICA_TARDIA` del motor falso (copiada: el guion es `.mjs`). */
const MARCA = "REPLICA TARDIA";
/** La acotación con la que el bridge apunta el fin (`FIN_DE_CONVERSACION`,
 *  `bridge/handlers/dialogue.ts`). Copiada: si cambia una sin la otra, el
 *  bloque C se pone rojo. */
const FIN = "(el jugador da por terminada la conversación y se aparta)";

const frames = esperaDeFotogramas("mundo");

async function urlDelFake(ctx) {
  const url = await ctx.page.evaluate(() => window.__nefan.servicios?.()?.["narrative-llm"] ?? null);
  if (!url) throw new Error("el cliente no dice dónde está el motor (servicios()['narrative-llm'])");
  return url.replace(/\/$/, "");
}

async function contadores(base) {
  const r = await fetch(`${base}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters: HTTP ${r.status}`);
  return r.json();
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

/** El typewriter terminó y las opciones están en pantalla (ver el 342). */
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

/** ¿Se ve «terminar» y un click en su centro le llega a él? */
const botonAlcanzable = (ctx) =>
  ctx.page.evaluate(() => {
    const b = document.getElementById("dialogue-end");
    if (!b) return { existe: false };
    const r = b.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { existe: true, ancho: r.width, alto: r.height, alcanzable: arriba === b || b.contains(arriba), texto: b.textContent };
  });

const panelCerrado = (ctx, desc) =>
  ctx.absorbe("si el panel no se cierra, lo afirma el `expect` de abajo", () =>
    ctx.waitFor(desc, () => (window.__nefan.dialogue().visible ? null : true), 10_000),
  );

const lineasDelRegistro = (ctx) =>
  ctx.page.evaluate(() => [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? ""));

/** Saluda con el driver de bench y espera el panel. */
async function saludar(ctx, desc) {
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  return (
    (await ctx.absorbe("si el panel no se abre, lo afirma el `expect` del sitio de llamada", () =>
      ctx.waitFor(desc, () => (window.__nefan.dialogue().visible ? true : null), 60_000),
    )) === true
  );
}

/** T, escribir, y Enter si se pide. */
async function escribir(ctx, frase, { enviar }) {
  await opcionesEnPantalla(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(frase);
  if (enviar) {
    await ctx.page.keyboard.press("Enter");
    await ctx.waitFor("el panel se cierra al mandar", () => (window.__nefan.dialogue().visible ? null : true), 10_000);
  }
}

/** E con el teclado REAL (el proveedor la consume por fotograma). */
async function pulsarE(ctx) {
  await ctx.page.keyboard.down("e");
  try {
    await frames(ctx, 4);
  } finally {
    await ctx.page.keyboard.up("e");
  }
}

/** Al lado del tabernero, mirándole, y con el juego OFRECIENDO hablar (como
 *  el 83): el tabernero pasea, así que su posición se lee cada vez. */
async function plantarse(ctx, etiqueta) {
  const npc = await ctx.waitFor(`${etiqueta}: el tabernero está en la escena`, (id) => window.__nefan.npcs().find((n) => n.id === id)?.pos ?? null, 60_000, TABERNERO);
  await ctx.nefan("setPlayerPos", npc.x + 1.2, npc.z);
  await ctx.page.evaluate((id) => {
    const n = window.__nefan.npcs().find((x) => x.id === id);
    const p = window.__nefan.state().pos;
    if (n && p) window.__nefan.setYaw(Math.atan2(n.pos.x - p.x, n.pos.z - p.z));
  }, TABERNERO);
  await ctx.waitFor(
    `${etiqueta}: el juego ofrece hablar con el tabernero`,
    () => document.querySelector('#interact-prompt [data-action="interact"]')?.textContent ?? null,
    30_000,
  );
}

async function clickEnElMundo(ctx) {
  const caja = await (await ctx.page.$("canvas")).boundingBox();
  await ctx.page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
}

const episodioDelAtaque = (ctx) => ctx.page.evaluate(() => window.__nefan.fps().telegraphEpisode?.episode ?? 0);

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const partida = await comenzar(ctx);
  const base = await urlDelFake(ctx);

  // ── 0 · PREMISA: paz (el bandido pega mientras se habla) ─────────────────
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) ctx.sinMedir("el bandido mató al jugador antes de caer: sin paz no hay conversación que medir");
  ctx.expect("PREMISA: el jugador mata al bandido", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;

  // ── B · CON OPCIONES: click en «terminar» ────────────────────────────────
  const abiertoB = await saludar(ctx, "B: el tabernero contesta al saludo (panel)");
  ctx.expect("B: saludar abre el panel", abiertoB);
  if (!abiertoB) return;
  await opcionesEnPantalla(ctx);
  const botonB = await botonAlcanzable(ctx);
  ctx.expect("B: con opciones, «terminar» se ve y un click en su centro le llega", botonB.alcanzable === true, JSON.stringify(botonB));
  await ctx.shot("b-con-opciones-y-terminar");
  const turnoAntesB = (await contadores(base)).dialogueTurn;
  await ctx.page.click("#dialogue-end");
  const cerradoB = await panelCerrado(ctx, "B: el click en «terminar» cierra el panel");
  ctx.expect("B: el click REAL en «terminar» cierra el panel", cerradoB === true);
  await frames(ctx, 10);
  const turnoTrasB = (await contadores(base)).dialogueTurn;
  ctx.expect("B: terminar NO pide nada al motor (su turno no sube)", turnoTrasB === turnoAntesB, `${turnoAntesB} → ${turnoTrasB}`);

  // ── C · TEXTO LIBRE: Esc retrocede un nivel, el segundo termina ──────────
  const abiertoC = await saludar(ctx, "C: el tabernero vuelve a contestar (panel)");
  ctx.expect("C: saludar otra vez abre el panel", abiertoC);
  if (!abiertoC) return;
  // R4: el saludo de C es la primera petición al motor tras el fin de B.
  const recientes = (await contadores(base)).ultimosDialogosRecientes ?? [];
  ctx.log(`C: recent_dialogues del saludo: ${JSON.stringify(recientes).slice(0, 400)}`);
  ctx.expect(
    "C: el motor se entera del fin de B en su contexto (recent_dialogues trae la acotación), sin haber gastado una petición",
    recientes.some((d) => d?.chosen === FIN),
    JSON.stringify(recientes).slice(0, 400),
  );
  const turnoAntesC = (await contadores(base)).dialogueTurn;
  await escribir(ctx, "esto no lo mando", { enviar: false });
  const botonC = await botonAlcanzable(ctx);
  ctx.expect("C: con el texto libre abierto, «terminar» sigue alcanzable", botonC.alcanzable === true, JSON.stringify(botonC));
  await ctx.page.keyboard.press("Escape");
  await frames(ctx, 4);
  const trasEsc1 = await ctx.page.evaluate(() => ({
    panel: window.__nefan.dialogue().visible,
    input: document.getElementById("dialogue-input")?.style.display ?? null,
  }));
  ctx.expect("C: el primer Esc cierra SOLO la caja: el panel sigue, sin input", trasEsc1.panel === true && trasEsc1.input === "none", JSON.stringify(trasEsc1));
  await ctx.page.keyboard.press("Escape");
  const cerradoC = await panelCerrado(ctx, "C: el segundo Esc termina la conversación");
  ctx.expect("C: el segundo Esc termina la conversación", cerradoC === true);
  await frames(ctx, 10);
  const turnoTrasC = (await contadores(base)).dialogueTurn;
  ctx.expect("C: ni la caja ni el fin piden nada al motor", turnoTrasC === turnoAntesC, `${turnoAntesC} → ${turnoTrasC}`);

  // El Secuaz del turno 2 del motor falso es hostil y está al lado: se le
  // quita de en medio para que la pelea no estorbe a lo que sigue.
  const secuaz = await ctx.page.evaluate(() => window.__nefan.enemies().find((e) => e.alive)?.id ?? null);
  if (secuaz) {
    await acercarse(ctx, secuaz, { objetivo: 1.6, tramos: 14 });
    const fuera = await herirHasta(ctx, secuaz, 0, { sim: 90 });
    if (fuera?.jugadorMuerto) ctx.sinMedir(`el ${secuaz} mató al jugador: sin paz no hay réplica que medir`);
    ctx.expect(`PREMISA: el jugador mata al ${secuaz}`, Boolean(fuera?.muerto), JSON.stringify(fuera));
  }

  // ── E · LA RÉPLICA QUE LLEGA TRAS TERMINAR OTRA LÍNEA ────────────────────
  const abiertoE = await saludar(ctx, "E: el tabernero contesta (panel)");
  ctx.expect("E: saludar abre el panel", abiertoE);
  if (!abiertoE) return;
  const FRASE_E = `${MARCA} y ya me callo`;
  await escribir(ctx, FRASE_E, { enviar: true });
  const retenidaE = await esperarRetenida(ctx, base, "bloque E");
  ctx.expect("E: el motor falso retiene la réplica (la marca llegó)", retenidaE);
  if (!retenidaE) return;
  // OTRA línea mientras el motor piensa: un saludo nuevo (no retenido).
  const otraE = await saludar(ctx, "E: el saludo nuevo llega con la réplica aún retenida (panel)");
  ctx.expect("E: con la réplica retenida, saludar otra vez abre el panel", otraE);
  if (!otraE) return;
  await ctx.page.keyboard.press("Escape");
  const cerradoE = await panelCerrado(ctx, "E: Esc termina el saludo nuevo");
  ctx.expect("E: Esc termina el saludo nuevo", cerradoE === true);
  await frames(ctx, 10);
  ctx.expect("PREMISA E: la frase aún no está en el registro", !(await lineasDelRegistro(ctx)).some((t) => t.includes(FRASE_E)));
  await soltar(base);
  const lineaE = await ctx.absorbe("si la línea no llega, lo afirman los `expect` de abajo", () =>
    ctx.waitFor(
      "E: la réplica llega al REGISTRO",
      (f) => [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? "").find((t) => t.includes(f)) ?? null,
      30_000,
      FRASE_E,
    ),
  );
  await frames(ctx, 10);
  const trasE = await ctx.page.evaluate(() => ({ panel: window.__nefan.dialogue().visible, dialogo: window.__nefan.puedeAtacar().dialogo }));
  ctx.log(`E: línea ${JSON.stringify(lineaE)} · ${JSON.stringify(trasE)}`);
  ctx.expect("E: la réplica que llega tras TERMINAR una conversación NO abre el panel", trasE.panel === false, JSON.stringify(trasE));
  ctx.expect(
    "E: va al registro, entera, con la pista de volver a hablarle con E",
    typeof lineaE === "string" && lineaE.includes("💬") && lineaE.includes("(vuelve a hablarle con E)"),
    JSON.stringify(lineaE),
  );
  await ctx.shot("e-replica-tras-terminar-en-el-registro");

  // ── F · CONTROL: sin terminar nada, la réplica abre el panel ─────────────
  const abiertoF = await saludar(ctx, "F: el tabernero contesta (panel)");
  ctx.expect("F: saludar abre el panel", abiertoF);
  if (!abiertoF) return;
  const FRASE_F = `${MARCA} aqui espero`;
  await escribir(ctx, FRASE_F, { enviar: true });
  const retenidaF = await esperarRetenida(ctx, base, "bloque F");
  ctx.expect("F: el motor falso retiene la réplica", retenidaF);
  if (!retenidaF) return;
  await frames(ctx, 10);
  await soltar(base);
  const control = await ctx.absorbe("si el panel no se abre, lo afirma el `expect` de abajo", () =>
    ctx.waitFor(
      "F: la réplica abre el panel",
      (f) => {
        const d = window.__nefan.dialogue();
        return d.visible && (d.text ?? "").includes(f) ? true : null;
      },
      30_000,
      FRASE_F,
    ),
  );
  ctx.expect("F CONTROL: sin terminar nada entretanto, la réplica abre el panel como siempre", control === true);
  if (!control) return;
  await ctx.page.keyboard.press("Escape");
  await panelCerrado(ctx, "F: Esc cierra la réplica");

  // ── A · TECLADO Y RATÓN: Esc durante el typewriter ───────────────────────
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
    "A: corre con el proveedor de TECLADO y ratón (el del jugador)",
    await ctx.page.evaluate(() => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver),
  );
  // Los spawns del motor falso (turnos 3 y 4, `near_player`) caen a veces un
  // palmo fuera del tile cuando se habla con el tabernero, y al reanudar la
  // partida lo dice con el aviso «Tu partida vuelve incompleta» a pantalla
  // completa (medido en 1 de 3 corridas; no es de esta tanda). Quien juega lo
  // cierra con su botón, y eso hace el guion: tapado, el click no llegaría al
  // mundo y el bloque A mediría el aviso.
  const aviso = await ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    const boton = document.getElementById("narrative-loader-dismiss");
    return el?.classList.contains("visible") && boton && !boton.hidden
      ? document.getElementById("narrative-loader-title")?.textContent ?? "?"
      : null;
  });
  if (aviso) {
    ctx.log(`A: al reanudar sale el aviso «${aviso}»: se cierra con su botón, como el jugador`);
    await ctx.page.click("#narrative-loader-dismiss");
    await ctx.waitFor("A: el aviso se cierra", () => (document.getElementById("narrative-loader")?.classList.contains("visible") ? null : true), 10_000);
  }
  // Espía de Esc ANTES de la puerta (captura en window): en qué estado estaba
  // el panel cuando llegó la tecla.
  await ctx.page.evaluate(() => {
    window.__g351 = { esc: [] };
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        const d = window.__nefan.dialogue();
        window.__g351.esc.push({
          panel: d.visible,
          typewriter: d.visible && document.querySelectorAll("#dialogue-choices button").length === 0 && (document.getElementById("dialogue-text")?.textContent ?? "").length < (d.text ?? "").length,
        });
      },
      { capture: true },
    );
  });
  await plantarse(ctx, "A");
  const epAntesDelClick = await episodioDelAtaque(ctx);
  await clickEnElMundo(ctx);
  await ctx.expectEspera("A: PREMISA: el click sobre el mundo captura el ratón", true, () => (document.pointerLockElement !== null ? true : null), { ms: 10_000 });
  await frames(ctx, 10);
  const epTrasElClick = await episodioDelAtaque(ctx);
  ctx.expect("A: el click que CAPTURA el ratón no ataca", epTrasElClick === epAntesDelClick, `${epAntesDelClick} → ${epTrasElClick}`);
  await pulsarE(ctx);
  // Se pulsa Esc en cuanto el panel está en pantalla: el typewriter tarda
  // ~2 s con la línea del motor falso, y el espía dice si seguía corriendo.
  await ctx.waitFor("A: E abre el panel", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  const botonA = await botonAlcanzable(ctx);
  await ctx.page.keyboard.press("Escape");
  const cerradoA = await panelCerrado(ctx, "A: Esc cierra el panel");
  const espia = await ctx.page.evaluate(() => window.__g351.esc.slice());
  ctx.log(`A: Esc con ${JSON.stringify(espia)} · botón durante el typewriter ${JSON.stringify(botonA)}`);
  ctx.expect("A: PREMISA: Esc llegó con el typewriter corriendo (sin opciones aún)", espia[0]?.typewriter === true, JSON.stringify(espia));
  ctx.expect("A: durante el typewriter «terminar» ya se ve y es alcanzable", botonA.alcanzable === true, JSON.stringify(botonA));
  ctx.expect("A: Esc DURANTE el typewriter termina la conversación", cerradoA === true);
  await frames(ctx, 10);
  const trasEscA = await ctx.page.evaluate(() => ({
    lock: document.pointerLockElement !== null,
    errores: Array.from(document.querySelectorAll("#error-log > div")).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()),
  }));
  ctx.log(`A: tras Esc, ratón capturado: ${trasEscA.lock} · errores: ${JSON.stringify(trasEscA.errores)}`);
  // Esc no es gesto de activación (spec HTML): el navegador puede negarse a
  // devolver el ratón. Se afirma que pasa UNA de las dos cosas honestas: o
  // vuelve solo, o el registro lo dice (y entonces un click lo arregla).
  ctx.expect(
    "A: tras Esc, el ratón vuelve solo o el registro de errores dice que no se pudo",
    trasEscA.lock || trasEscA.errores.some((t) => t.includes("no se pudo devolver el ratón")),
    JSON.stringify(trasEscA),
  );
  if (!trasEscA.lock) {
    const epAntes = await episodioDelAtaque(ctx);
    await clickEnElMundo(ctx);
    await ctx.expectEspera("A: un click sobre el mundo recaptura el ratón", true, () => (document.pointerLockElement !== null ? true : null), { ms: 10_000 });
    await frames(ctx, 10);
    ctx.expect("A: …y ese click NO ataca (captura, no golpea)", (await episodioDelAtaque(ctx)) === epAntes, `${epAntes}`);
  }
  // Moverse: W unos fotogramas.
  const posAntes = await ctx.page.evaluate(() => window.__nefan.state().pos);
  await ctx.page.keyboard.down("w");
  try {
    await frames(ctx, 30);
  } finally {
    await ctx.page.keyboard.up("w");
  }
  const posDespues = await ctx.page.evaluate(() => window.__nefan.state().pos);
  const andado = Math.hypot(posDespues.x - posAntes.x, posDespues.z - posAntes.z);
  ctx.expect("A: tras terminar, W mueve al jugador", andado > 0.2, `${andado.toFixed(2)} m`);
  // Atacar: LMB con el lock.
  const epAntesLmb = await episodioDelAtaque(ctx);
  await ctx.page.mouse.down();
  await ctx.page.mouse.up();
  await ctx.expectEspera(
    "A: tras terminar, un LMB con el ratón capturado ATACA (abre un episodio del telegraph)",
    true,
    (n) => ((window.__nefan.fps().telegraphEpisode?.episode ?? 0) > n ? true : null),
    { ms: 10_000, arg: epAntesLmb },
  );
  await ctx.shot("a-tras-esc-se-mueve-y-ataca");
  await ctx.expectEspera("A: el ataque termina antes de seguir", true, () => (window.__nefan.fps().telegraph === null ? true : null), { ms: 10_000 });

  // ── G · EL BOTÓN ES GESTO: devuelve el ratón ─────────────────────────────
  await plantarse(ctx, "G");
  const lockG = await ctx.page.evaluate(() => document.pointerLockElement !== null);
  ctx.expect("G: PREMISA: el ratón sigue capturado antes de hablar", lockG);
  if (!lockG) return;
  await pulsarE(ctx);
  await ctx.waitFor("G: E abre el panel", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  await ctx.expectEspera("G: el panel suelta el ratón", true, () => (document.pointerLockElement === null ? true : null), { ms: 5_000 });
  await ctx.page.click("#dialogue-end");
  const cerradoG = await panelCerrado(ctx, "G: el click en «terminar» cierra el panel");
  ctx.expect("G: el click en «terminar» cierra el panel", cerradoG === true);
  await ctx.expectEspera(
    "G: el click en «terminar» (un gesto) DEVUELVE el ratón como tras elegir",
    true,
    () => (document.pointerLockElement !== null ? true : null),
    { ms: 10_000 },
  );
}
