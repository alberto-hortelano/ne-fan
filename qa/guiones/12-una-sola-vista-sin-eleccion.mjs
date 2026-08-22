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
 */
import { abrirSelectorDeMundos, esperarTituloListo } from "../lib/sesion.mjs";

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
    out.push({ tipo: "select", id: s.id, opts: [...s.options].map((o) => (o.textContent ?? "").trim()) });
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
  const ROLES = ["superficies", "caras", "personajes", "surfaces", "faces", "characters"];
  const carpetas = est.ctrls.filter((c) => c.tipo === "select" && c.id !== "ts-style" && c.id !== "room-selector");
  const opcionesDeCarpeta = carpetas.flatMap((c) => c.opts ?? []);
  ctx.expect(
    "las carpetas de subida de estilo son roles del contenido, no vistas",
    opcionesDeCarpeta.every((o) => ROLES.some((r) => o.toLowerCase().includes(r))),
    JSON.stringify(opcionesDeCarpeta),
  );

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
