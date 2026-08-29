/** «De momento simplemente elimina completamente las dos vistas.»
 *
 *  El guion 11 comprueba que la pestaña abre UN solo contexto WebGL, que es la
 *  cara técnica del criterio. Este comprueba la otra, que es la que el jugador
 *  toca: que en NINGÚN estado alcanzable desde el título se le ofrezca —ni se
 *  le nombre— una vista que ya no existe. Un resto que el jugador ve cuenta
 *  como incumplido aunque el código esté limpio, así que aquí no se lee ni un
 *  import: se recorre la UI y se mira lo que hay pintado.
 *
 *  Los estados que recorre son los cinco por los que pasa una partida nueva
 *  (home → mundos → estilo/gráficos → apariencia → juego), más el panel de
 *  «Salidas» y el desplegable de fixtures (F12), que son los dos sitios donde
 *  históricamente vivió una elección de escenario.
 *
 *  Cero créditos: preset 5, y la partida se abre en «Maqueta 3D» (vector), que
 *  no pide una sola imagen.
 *
 *  ALCANCE del bloque de teclado (§7): la batería entra con `?input=scripted`,
 *  así que `KeyboardInputProvider` ni se instancia. Lo que ese bloque puede ver
 *  son los listeners globales vivos en ese modo (`dev-tools-input.ts` y los
 *  paneles), y por eso lleva un control positivo delante: sin él sería verde
 *  por construcción. Una elección de vista escondida DENTRO del provider de
 *  teclado se le escaparía; de eso se ocupan los otros siete bloques, que miran
 *  la pantalla y el DOM.
 */
import { abrirSelectorDeMundos, esperarListaDeSaves, esperarTituloListo } from "../lib/sesion.mjs";

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

/** Palabras que sólo tenían sentido con la oblicua o el proscenio vivos, EN
 *  LA LENGUA EN QUE EL JUGADOR LAS LEERÍA (la UI del juego está en español).
 *
 *  Los identificadores internos ingleses de las dos vistas NO se nombran aquí
 *  a propósito: `qa/**` es root de la regla `campos-retirados-no-vuelven`
 *  (`data/contract/arch-rules.json`), que prohíbe esos literales en los cinco
 *  procesos. Escribirlos aquí —aunque fuese para comprobar su ausencia— pone
 *  la suite en rojo, y con razón: de que no vuelvan al CÓDIGO ya se ocupa ese
 *  candado. Este guion cubre lo que el candado no puede ver, que es la
 *  PANTALLA. Por eso donde hace falta mirar nombres de carpeta se afirma con
 *  lista blanca (§3), no con lista negra.
 *
 *  «Escenarios» NO entra: es el modo de gráficos (world.render_mode), vivo y
 *  sin relación con las vistas retiradas. «Cámara» tampoco: la primera persona
 *  tiene una. */
const PROHIBIDAS =
  /\b(proscenio|prosceni|plató|plato de cine|cenital|oblicua|oblicuo|isométric|isometric|top ?down|vista superior|elegir vista|cambiar de vista|cambia de vista|perspectiva)\b/i;

/** Texto VISIBLE de la página: sólo nodos de texto de elementos con caja y sin
 *  ocultar. Nada de innerHTML (comentarios y atributos no los ve el jugador). */
function textoVisible() {
  return [...document.querySelectorAll("body *")]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      return [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    })
    .map((e) =>
      [...e.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
}

/** Todo lo que un jugador puede pulsar o elegir, con su etiqueta. */
function controles() {
  const out = [];
  for (const b of document.querySelectorAll("button, [role=button]")) {
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push({ tipo: "button", txt: (b.textContent ?? "").trim(), title: b.title ?? "" });
  }
  for (const s of document.querySelectorAll("select")) {
    out.push({
      tipo: "select",
      id: s.id,
      opts: [...s.options].map((o) => (o.textContent ?? "").trim()),
      // El VALOR es el id del rol (`faces`/`surfaces`/`characters`), que es lo
      // estable; la etiqueta es prosa y cambia sin avisar.
      vals: [...s.options].map((o) => o.value),
    });
  }
  return out;
}

export default async function (ctx) {
  const pantallas = [];

  /** Afirma sobre UNA pantalla: ni texto visible ni control ofrecen una vista. */
  async function revisar(nombre) {
    const { texto, ctrls } = await ctx.page.evaluate(
      ([fnTexto, fnCtrls]) => ({
        texto: new Function("return (" + fnTexto + ")()")(),
        ctrls: new Function("return (" + fnCtrls + ")()")(),
      }),
      [textoVisible.toString(), controles.toString()],
    );
    pantallas.push(nombre);
    const malTexto = texto.filter((t) => PROHIBIDAS.test(t));
    const malCtrl = ctrls.filter((c) =>
      PROHIBIDAS.test(JSON.stringify(c)),
    );
    ctx.expect(
      `«${nombre}»: ningún texto a la vista nombra una vista retirada`,
      malTexto.length === 0,
      malTexto.slice(0, 4).join(" ⁄ "),
    );
    ctx.expect(
      `«${nombre}»: ningún botón ni desplegable ofrece elegir vista`,
      malCtrl.length === 0,
      JSON.stringify(malCtrl.slice(0, 3)),
    );
    return { texto, ctrls };
  }

  // ── 1. Home del título ────────────────────────────────────────────────
  await esperarTituloListo(ctx);
  // El home se revisa ENTERO, así que se espera también a la lista de saves:
  // un home a medio pintar solo podría dejar pasar un control, no cazarlo.
  await esperarListaDeSaves(ctx);
  await revisar("home del título");

  // ── 2. Selector de mundos ─────────────────────────────────────────────
  await abrirSelectorDeMundos(ctx);
  const sel = await revisar("selector de mundos");
  const mundos = await ctx.page.$$eval("[data-game-id]", (els) => els.map((e) => e.dataset.gameId));
  ctx.expect("el selector ofrece los mundos del juego", mundos.length >= 4, mundos.join(", "));
  ctx.log(`mundos: ${mundos.join(", ")}`);

  // El paso de VISTA que existía entre mundo y estilo no debe reaparecer:
  // no hay ningún control con id de vista en toda la página.
  const idsDeVista = await ctx.page.evaluate(() =>
    [...document.querySelectorAll("[id],[data-view],[data-world-view]")]
      .map((e) => e.id || e.getAttribute("data-view") || e.getAttribute("data-world-view"))
      .filter((v) => v && /view|vista/i.test(v)),
  );
  ctx.expect("no hay ningún control de vista en el DOM (id/data-view)", idsDeVista.length === 0, idsDeVista.join(", "));

  // ── 3. Estilo y modo de gráficos ──────────────────────────────────────
  await ctx.page.click(`[data-game-id="alta_fantasia"]`);
  await ctx.page.waitForSelector("#ts-style", { timeout: 30_000 });
  const est = await revisar("elección de estilo y gráficos");
  const estilos = await ctx.page.$$eval("#ts-style option", (os) => os.map((o) => (o.textContent ?? "").trim()));
  ctx.log(`estilos: ${estilos.join(" · ")}`);
  // Las carpetas a las que se puede subir una imagen de estilo son ROLES del
  // contenido, no vistas. Lista BLANCA a propósito (ver cabecera): se afirma
  // lo que debe haber, no lo que no debe. Una carpeta de vista resucitada
  // suspende esta afirmación sin que el guion tenga que nombrarla.
  // Roles del CONTENIDO (data/styles/README.md): las tres carpetas obligatorias
  // de un pack. Se afirma sobre el `value` de cada opción —el id del rol, que
  // es lo que viaja al servidor— y no sobre su etiqueta: la etiqueta es prosa
  // («Lámina de materiales (rejilla de muestras planas)») y la lista blanca
  // anterior, escrita a ojo, no casaba con NINGUNA de las tres. Nadie se
  // enteró porque el array que filtraba estaba siempre vacío.
  const ROLES = ["surfaces", "faces", "characters"];
  // Los desplegables de carpeta viven en «Subir estilo», que es OTRA pantalla:
  // filtrarlos desde esta daba un array vacío, y `[].every(...)` es `true`. La
  // lista blanca —presentada arriba como la defensa fuerte— no había mirado
  // jamás una opción. Hay que ir a la pantalla, y luego volver.
  await ctx.page.click("#ts-upload-style");
  await ctx.page.waitForSelector("[data-folder]", { timeout: 30_000 });
  const subida = await revisar("subir estilo");
  const carpetas = subida.ctrls.filter(
    (c) => c.tipo === "select" && c.id !== "ts-style" && c.id !== "room-selector",
  );
  const opcionesDeCarpeta = carpetas.flatMap((c) => c.vals ?? []);
  ctx.log(`carpetas de subida: ${JSON.stringify(carpetas.flatMap((c) => c.opts ?? []))}`);
  ctx.expect(
    "la pantalla de subida ofrece de verdad sus carpetas (si no, el aserto de abajo no mira nada)",
    opcionesDeCarpeta.length > 0,
    `${carpetas.length} desplegables, ${opcionesDeCarpeta.length} opciones`,
  );
  ctx.expect(
    "las carpetas de subida de estilo son roles del contenido, no vistas",
    opcionesDeCarpeta.length > 0 && opcionesDeCarpeta.every((v) => ROLES.includes(v)),
    JSON.stringify(opcionesDeCarpeta),
  );
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("#ts-style", { timeout: 30_000 });

  // ── 4. Selector de fixtures (F12): sin escenas de plató ───────────────
  const rooms = await ctx.page.$$eval("#room-selector option", (os) => os.map((o) => (o.value ?? "").trim()).filter(Boolean));
  ctx.log(`fixtures del selector Room: ${rooms.join(", ")}`);
  ctx.expect(
    "el selector de fixtures no ofrece ninguna escena de plató",
    !rooms.some((r) => /stage|plato|plató|proscen/i.test(r)),
    rooms.join(", "),
  );

  // ── 5. Apariencia ─────────────────────────────────────────────────────
  await ctx.page.click(`#ts-charmode [data-charmode="vector"]`);
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await revisar("crear personaje");

  // ── 6. En partida ─────────────────────────────────────────────────────
  await ctx.page.click("#ts-start");
  await ctx.waitFor(
    "la escena de la sesión llega del bridge",
    () => (window.__nefan.scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  await revisar("en partida (HUD)");
  await ctx.shot("en-partida");

  // El HUD no lleva chip de vista: el que hubo se quedó anunciando una vista
  // muerta en cuanto nadie volvió a fijarlo.
  const chips = await ctx.page.evaluate(() =>
    [...document.querySelectorAll("[id*=chip], [class*=chip]")]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.textContent ?? "").trim().slice(0, 60)),
  );
  ctx.expect(
    "el HUD no lleva indicador de vista",
    !chips.some((c) => PROHIBIDAS.test(c)),
    chips.join(" ⁄ "),
  );

  // ── 7. Teclas: ninguna cambia de vista ────────────────────────────────
  // La vista nunca se cambió por teclado (era un paso del título), pero el
  // criterio es que HOY no exista ninguna: se pulsan las candidatas y se
  // comprueba que ni la escena ni el número de lienzos cambian.
  const antes = await ctx.page.evaluate(() => ({
    escena: window.__nefan.scene?.scene_id,
    lienzos: document.querySelectorAll("canvas").length,
  }));
  // Control POSITIVO. Sin él este bloque NO PUEDE ponerse rojo: la batería
  // entra con `?input=scripted`, y ese provider no instala un solo listener de
  // teclado (lo dice su propia cabecera), así que «pulso y no pasa nada» sería
  // cierto por construcción — verde sin comprobar nada, el vicio que esta
  // tanda persigue. `B` (ciclar la vista de depuración del renderer) SÍ
  // escucha en este modo, vía `dev-tools-input.ts`: si B mueve algo, las
  // teclas LLEGAN a la aplicación, y entonces que las candidatas no muevan
  // nada significa algo.
  const vistaDebug0 = (await ctx.nefan("fps")).debugView;
  await ctx.page.keyboard.press("b");
  const vistaDebug1 = await ctx
    .waitFor(
      "el canal de teclado está vivo (B cambia la vista de depuración)",
      (previa) => (window.__nefan.fps().debugView !== previa ? window.__nefan.fps().debugView : null),
      10_000,
      vistaDebug0,
    )
    .catch(() => null);
  ctx.expect(
    "las teclas LLEGAN a la aplicación en este modo (si no, lo de abajo no probaría nada)",
    vistaDebug1 !== null,
    `debugView: ${vistaDebug0} → ${vistaDebug1}`,
  );
  // Y se deja como estaba: la vista de depuración no puede quedarse encendida
  // para el resto del guion ni para las capturas.
  for (let i = 0; i < 8 && (await ctx.nefan("fps")).debugView !== vistaDebug0; i++) {
    await ctx.page.keyboard.press("b");
  }

  for (const k of ["KeyV", "KeyO", "KeyP", "KeyT", "KeyC", "Tab", "F1", "F2"]) {
    await ctx.page.keyboard.press(k.startsWith("Key") ? k.slice(3) : k).catch(() => {});
  }
  const despues = await ctx.page.evaluate(() => ({
    escena: window.__nefan.scene?.scene_id,
    lienzos: document.querySelectorAll("canvas").length,
  }));
  ctx.expect(
    "ninguna tecla suelta cambia de vista (misma escena, mismo número de lienzos)",
    antes.escena === despues.escena && antes.lienzos === despues.lienzos,
    `${JSON.stringify(antes)} → ${JSON.stringify(despues)}`,
  );
  ctx.expect("la pestaña tiene UN solo lienzo", despues.lienzos === 1, `hay ${despues.lienzos}`);

  // ── 8. Panel «Salidas»: destinos, no escenarios ───────────────────────
  const salidas = await ctx.nefan("exits");
  ctx.log(`salidas ofrecidas: ${JSON.stringify((salidas ?? []).map((s) => s.name))}`);
  ctx.expect(
    "el panel «Salidas» ofrece lugares del mundo, no escenarios de plató",
    !(salidas ?? []).some((s) => PROHIBIDAS.test(`${s.name} ${s.description ?? ""} ${s.link_kind ?? ""}`)),
    JSON.stringify(salidas),
  );

  // ── 9. El nombre de la pestaña ────────────────────────────────────────
  // Es la primera copia de interfaz que ve el jugador y sobrevive a todas las
  // pantallas. El cliente ya no es «2D»: es primera persona en three.js.
  const titulo = await ctx.page.title();
  ctx.expect(
    "el título de la pestaña no anuncia una vista que el juego ya no tiene",
    !/\b(2D|top ?down|cenital|oblicua)\b/i.test(titulo),
    `<title> = "${titulo}"`,
  );

  ctx.log(`pantallas recorridas: ${pantallas.length} (${pantallas.join(" → ")})`);
}
