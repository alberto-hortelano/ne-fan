/** IR Y VOLVER entre el HOME y el SELECTOR DE MUNDOS, cinco veces, sin rastro.
 *
 *  Escrito con la PR 5 de #346 («El título troceado»), el corte MAYOR: el
 *  selector de mundos sale de `ui/title-screen.ts` a
 *  `ui/titulo/selector-de-mundo.ts` (432 líneas, seis colaboradores) y con él
 *  se van los cinco últimos `let` y los dos últimos `render*` privados de la
 *  raíz.
 *
 *  POR QUÉ ESTE PAR Y NO OTRO. El 95 mide selector ⇄ subir estilo, que es el
 *  par de la PR 2. Éste mide **home ⇄ selector**, que es el camino por el que
 *  pasa TODO el que empieza una partida y el que esta PR mueve por los dos
 *  extremos a la vez: «Nueva partida» va al selector por `ir({a:"selector"})` y
 *  «Volver» vuelve al home por `ir({a:"home"})`. Ninguno de los dos era un
 *  callback antes de esta tanda.
 *
 *  Y porque el selector es la pantalla con MÁS oyentes del título: dos botones
 *  de escenarios, dos de personajes, una tarjeta por mundo, el desplegable de
 *  estilo, los dos botones del panel de generación y los cuatro de la fila de
 *  acciones. Si el corte hubiera enganchado uno solo de ellos a algo que
 *  sobrevive al repintado —`document`, `window`, `#title-screen` o `content`—,
 *  cada visita al selector dejaría un oyente más, cada click haría el trabajo
 *  cinco veces a la quinta visita, y **ningún test verde lo vería**: el plan de
 *  la tanda lo llama riesgo 4. Esto es lo que lo ve.
 *
 *  Las cinco afirmaciones, y las cinco hacen falta:
 *   1. LOS OYENTES DE POR VIDA no crecen. Se envuelve `addEventListener` ANTES
 *      de que cargue nada (si no, los cinco del chasis ni se cuentan) y se
 *      apunta todo registro sobre algo que SOBREVIVE a un repintado del título:
 *      `window`, `document`, `#title-screen` y sus hijos directos, y —la regla
 *      general— **cualquier elemento vivo que no esté dentro de
 *      `#title-screen`**. Tras las cinco idas y vueltas tiene que haber CERO
 *      nuevos, y cada fugado se nombra con su objeto y su evento — un conteo a
 *      secas no dice cuál se escapó. Receta de la PR 2.
 *
 *      LA ÚLTIMA RAMA NO ES ADORNO, y la trajo la QA de esta PR (H2). La sonda
 *      nacía enumerando los cinco objetos que el riesgo 4 del plan nombra, y
 *      «lo que sobrevive» es más que cinco: `<html>`, `document.head` y el
 *      `<style id="title-screen-responsive">` que cuelga de él, `#error-log`,
 *      `#dev-status` y el lienzo del juego sobreviven igual. QA lo midió con el
 *      MISMO oyente un nodo más arriba —`document.documentElement` en vez de
 *      `document`— y el guion salía **verde entero con ocho oyentes fugados**,
 *      mientras el control sobre `document` salía rojo. Enumerar objetos es una
 *      lista que no acaba; preguntar «¿está fuera del título y sigue vivo?» es
 *      el invariante. Es el mismo cambio de forma que llevó al candado de las
 *      hojas a mirar el import RESUELTO en vez del especificador escrito.
 *
 *      LO QUE ESTA RAMA SIGUE SIN VER, dicho para que nadie lo cuente de más:
 *      un oyente puesto sobre un nodo TODAVÍA DESCONECTADO (`isConnected` en
 *      false) que se conecte después fuera del título. No tiene ocupante hoy
 *      —los cinco de por vida se registran así a propósito, dentro del
 *      constructor del chasis, y por eso la foto de referencia los incluye— y
 *      reconocerlo exigiría vigilar también los `appendChild`.
 *
 *      LA FOTO SE TOMA TRAS UNA IDA Y VUELTA DE CALENTAMIENTO, y está medido
 *      por qué: el PRIMER `page.click` del harness instala trece oyentes de
 *      Playwright sobre `window` (`mousemove`, `pointerdown`, `click`… y su
 *      `__playwright_global_listeners_check__`). Se instalan UNA vez y no una
 *      por click —comprobado: catorce clicks, trece oyentes—, así que con la
 *      foto tomada después de la primera navegación la sonda cuenta lo que
 *      registra la PÁGINA y no lo que registra quien la conduce. La alternativa
 *      era una lista negra de nombres del harness, que caduca sola. Lo que se
 *      pierde es el primer pintado del selector, y no importa: una fuga es algo
 *      que CRECE con las visitas, y las cinco que se miden vienen después.
 *   2. EL CHASIS no crece: `#title-screen` sigue con sus tres hijos y hay UN
 *      `#title-screen-responsive`, UN `#ts-mas` y UN `#ts-close`. Es la señal
 *      exacta que el plan §8 escribió para este corte.
 *   3. LAS DOS PANTALLAS son las mismas las cinco veces: el digest estructural
 *      de lo pintado —etiquetas, ids, atributos y texto— es idéntico visita a
 *      visita, en el selector y en el home. Una hoja que acumulara estado
 *      propio entre visitas (un array de módulo que crece, un `<option>` que se
 *      repite) sale aquí y no en (1) ni en (2).
 *   4. LOS OYENTES PROPIOS DE LA HOJA SIGUEN VIVOS Y RESPONDEN IGUAL: elegir el
 *      otro modo de escenarios deja EXACTAMENTE un botón activo —el pulsado— en
 *      la quinta visita igual que en la primera. Un repintado que se dejara los
 *      handlers sin enganchar sale aquí y no en (3), porque el HTML pintado es
 *      el mismo con listeners y sin ellos.
 *
 *      LO QUE ESTA AFIRMACIÓN **NO** VE, y se dice en vez de dejarlo creer: el
 *      oyente DUPLICADO sobre un nodo que la hoja crea. En el 95 lo caza
 *      «+ otra imagen» porque ese click ACUMULA una fila; aquí no hay ninguno
 *      así — los cinco handlers del selector (modo, tarjeta, desplegable,
 *      «Volver», «Continuar») son idempotentes, y ejecutarlos dos veces da lo
 *      mismo que una. El ÚNICO que no lo es —«Regenerar mundo», con su
 *      confirmación armada en dos clicks, donde un handler doble armaría y
 *      generaría de una sola pulsación, o sea GASTARÍA sin preguntar— no se
 *      puede conducir sin encolar una generación de verdad. Queda declarado
 *      como no cubierto, que es distinto de cubierto.
 *   5. LOS TRES BOTONES QUE CAMBIARON DE CABLEADO siguen navegando. «Volver»,
 *      «✚ Crear mundo» y «🎨 Subir estilo» dejaron de ser llamadas a métodos de
 *      la clase (`this.pintarElHome()`, `this.crearMundo()`,
 *      `pintarSubirEstilo(this.subirEstilo())`) y pasan por
 *      `paso(deps.ir({…}), …)`, que es una promesa por medio donde antes no
 *      había ninguna. Si esa promesa se quedara colgada o el destino no
 *      existiera, el botón sería un no-op MUDO — el #181 de siempre. Se
 *      comprueba en la ÚLTIMA visita, no en la primera, para que además cuente
 *      como el quinto uso de un oyente que ya ha visto cuatro repintados.
 *
 *  Cero créditos: no arranca partida, no pide una imagen y no encola ninguna
 *  generación — no se toca `#ts-gen-world` ni `#ts-apply-style`. Solo el título
 *  contra el bridge del preset sin créditos.
 */
import { esperarListaDeSaves, esperarTituloListo, recargarAlTitulo } from "../lib/sesion.mjs";

export const sinMotor =
  "recorre el título (home ⇄ selector de mundos) y nunca arranca partida ni encola generación";

const VISITAS = 5;

/** Digest de lo pintado dentro de `content`: etiquetas, ids, atributos y texto
 *  con los espacios colapsados. Se colapsan a propósito — la sangría del HTML
 *  fuente no es lo que ve el jugador, y esta pantalla perdió dos espacios de
 *  sangría por línea al pasar de método de clase a función de módulo. */
function digestEnLaPagina() {
  const raiz = document.getElementById("title-screen");
  const content = raiz?.firstElementChild;
  if (!content) return null;
  const out = [];
  const anda = (n, prof) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(`${prof}"${t}"`);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const attrs = [...n.attributes]
      .map((a) => `${a.name}=${a.value.replace(/\s+/g, " ").trim()}`)
      .sort()
      .join(" ");
    out.push(`${prof}<${n.tagName.toLowerCase()} ${attrs}>`);
    for (const h of n.childNodes) anda(h, prof + 1);
  };
  for (const h of content.childNodes) anda(h, 0);
  return out.join("\n");
}

/** Envuelve `addEventListener` ANTES de que cargue nada y apunta los registros
 *  sobre los objetos que SOBREVIVEN a un repintado del título. Es lo único que
 *  ve una fuga ahí: `document` no gana un nodo ni cambia el HTML pintado, así
 *  que ninguna de las otras cuatro medidas puede notarla.
 *
 *  Va como `addInitScript` y no como `evaluate` porque el chasis del título se
 *  monta en el arranque de `main.ts`: enganchar después dejaría fuera
 *  precisamente los cinco oyentes de por vida que hay que ver estables. */
function espiarOyentes() {
  window.__oyentesQueSobreviven = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (tipo, fn, opts) {
    let donde = null;
    if (this === window) donde = "window";
    else if (this === document) donde = "document";
    else if (this === document.body) donde = "document.body";
    else if (this && this.nodeType === 1) {
      const raiz = document.getElementById("title-screen");
      if (this.id === "title-screen") donde = "#title-screen";
      else if (this.parentElement && this.parentElement.id === "title-screen") {
        donde = `#title-screen > ${this.id || this.tagName.toLowerCase()}`;
      } else if (raiz && this.isConnected && !raiz.contains(this)) {
        // CUALQUIER elemento vivo de FUERA del título, no una lista de cinco.
        donde = `fuera del titulo · ${this.id || this.tagName.toLowerCase()}`;
      }
    }
    if (donde !== null) window.__oyentesQueSobreviven.push(`${donde} · ${tipo}`);
    return original.call(this, tipo, fn, opts);
  };
}

/** El otro modo de escenarios, y cuántos botones quedan marcados como activos.
 *
 *  El «activo» se lee del color de borde que pinta `refreshRenderMode`, que es
 *  lo mismo que ve el jugador. Se devuelve el conteo Y cuál quedó: un repintado
 *  que enganchara los handlers al botón equivocado dejaría también UN activo, y
 *  solo el «cuál» separa eso de que funcione. */
function pulsarElOtroModo() {
  const botones = [...document.querySelectorAll("#ts-rendermode [data-rendermode]")];
  const activo = botones.find((b) => b.style.borderColor === "rgb(221, 170, 102)");
  const otro = botones.find((b) => b !== activo);
  otro.click();
  const activosAhora = botones.filter((b) => b.style.borderColor === "rgb(221, 170, 102)");
  return {
    pulsado: otro.dataset.rendermode,
    activos: activosAhora.length,
    quedo: activosAhora.map((b) => b.dataset.rendermode).join(","),
  };
}

export default async function (ctx) {
  // ANTES de la recarga: si no, el chasis ya está montado y sus oyentes de por
  // vida no se cuentan.
  await ctx.page.addInitScript(espiarOyentes);
  await recargarAlTitulo(ctx);

  const oyentes = () => ctx.page.evaluate(() => [...(window.__oyentesQueSobreviven ?? [])]);
  const alCargar = await oyentes();
  ctx.log(`oyentes que sobreviven al repintado, recién cargada la página: ${alCargar.length}`);
  ctx.expect(
    "la sonda de oyentes está puesta (sin esto, la afirmación del final sería verde por vacía)",
    alCargar.length > 0,
    `${alCargar.length} registros — ${alCargar.join(" | ")}`,
  );

  // Ida y vuelta de CALENTAMIENTO: el primer `page.click` instala los trece
  // oyentes de entrada de Playwright sobre `window`, una sola vez. La foto de
  // referencia se toma después, para que la sonda cuente lo que registra la
  // página y no lo que registra quien la conduce (ver la cabecera).
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const oyentesAntes = await oyentes();
  ctx.log(
    `oyentes tras el calentamiento (la foto de referencia): ${oyentesAntes.length}` +
      ` — el harness puso ${oyentesAntes.length - alCargar.length}`,
  );

  const chasis = () =>
    ctx.page.evaluate(() => {
      const raiz = document.getElementById("title-screen");
      return {
        hijos: raiz ? raiz.children.length : -1,
        ids: raiz ? [...raiz.children].map((c) => c.id || "(content)").join(",") : "",
        responsive: document.querySelectorAll("#title-screen-responsive").length,
        mas: document.querySelectorAll("#ts-mas").length,
        cerrar: document.querySelectorAll("#ts-close").length,
      };
    });

  const antes = await chasis();
  ctx.log(`chasis al entrar: ${JSON.stringify(antes)}`);
  ctx.expect(
    "el chasis del título son sus tres hijos de siempre (content, #ts-mas, #ts-close)",
    antes.hijos === 3 && antes.ids === "(content),ts-mas,ts-close",
    JSON.stringify(antes),
  );

  const delSelector = [];
  const delHome = [];
  const modos = [];
  for (let v = 1; v <= VISITAS; v++) {
    await ctx.page.click("#ts-new");
    await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
    delSelector.push(await ctx.page.evaluate(digestEnLaPagina));
    modos.push(await ctx.page.evaluate(pulsarElOtroModo));
    if (v === 1) await ctx.shot("selector-visita-1");
    if (v === VISITAS) await ctx.shot(`selector-visita-${VISITAS}`);

    await ctx.page.click("#ts-back");
    await esperarTituloListo(ctx);
    await esperarListaDeSaves(ctx);
    delHome.push(await ctx.page.evaluate(digestEnLaPagina));
  }

  ctx.expect(
    `«Nueva partida» y «Volver» funcionan las ${VISITAS} veces (los dos son ya el callback ir(destino))`,
    delSelector.length === VISITAS &&
      delHome.length === VISITAS &&
      [...delSelector, ...delHome].every((d) => typeof d === "string" && d.length > 0),
    `selector: ${delSelector.map((d) => (d ? d.length : d)).join(", ")} · home: ${delHome
      .map((d) => (d ? d.length : d))
      .join(", ")}`,
  );
  ctx.expect(
    `el SELECTOR se pinta igual en las ${VISITAS} visitas (no acumula estado entre pintados)`,
    delSelector.every((d) => d === delSelector[0]),
    delSelector.map((d, i) => `${i + 1}: ${d === delSelector[0] ? "igual" : "DISTINTA"}`).join(" · "),
  );
  ctx.expect(
    `el HOME se pinta igual las ${VISITAS} veces que se vuelve a él`,
    delHome.every((d) => d === delHome[0]),
    delHome.map((d, i) => `${i + 1}: ${d === delHome[0] ? "igual" : "DISTINTA"}`).join(" · "),
  );

  ctx.log(`modo de escenarios por visita: ${JSON.stringify(modos)}`);
  ctx.expect(
    `los oyentes de la hoja siguen vivos: un click deja UN modo activo —el pulsado— en la visita ${VISITAS} igual que en la 1`,
    modos.every((m) => m.activos === 1 && m.quedo === m.pulsado),
    JSON.stringify(modos),
  );

  // ── (5) los tres botones que esta PR pasó a `paso(deps.ir({…}), …)` ──
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });

  await ctx.page.click("#ts-create-world");
  const enCrearMundo = await ctx.page.waitForSelector("#ts-draft", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });

  await ctx.page.click("#ts-upload-style");
  const enSubirEstilo = await ctx.page.waitForSelector("#ts-style-name", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });

  ctx.expect(
    "«✚ Crear mundo» y «🎨 Subir estilo» abren su pantalla tras 5 repintados del selector (no son un no-op mudo)",
    Boolean(enCrearMundo) && Boolean(enSubirEstilo),
    `crear-mundo: ${Boolean(enCrearMundo)} · subir-estilo: ${Boolean(enSubirEstilo)}`,
  );

  await ctx.page.click("#ts-back");
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const homeFinal = await ctx.page.evaluate(digestEnLaPagina);
  ctx.expect(
    "y «← Volver» sigue devolviendo al MISMO home después de todo el recorrido",
    homeFinal === delHome[0],
    homeFinal === delHome[0] ? "idéntico al primero" : "el home volvió DISTINTO",
  );
  await ctx.shot("home-tras-el-recorrido");

  // ── (1) y (2): lo que ningún test verde ve ──
  const oyentesDespues = await oyentes();
  const nuevos = oyentesDespues.slice(oyentesAntes.length);
  ctx.log(
    `oyentes al salir: ${oyentesDespues.length}` +
      (nuevos.length ? ` — NUEVOS: ${nuevos.join(" | ")}` : " (ninguno nuevo)"),
  );
  ctx.expect(
    `el selector no engancha a NADA que sobreviva al repintado: 0 oyentes nuevos tras ${VISITAS} idas y vueltas`,
    nuevos.length === 0,
    `${oyentesAntes.length} → ${oyentesDespues.length}; nuevos: ${nuevos.join(" | ") || "(ninguno)"}`,
  );

  const despues = await chasis();
  ctx.log(`chasis al salir: ${JSON.stringify(despues)}`);
  ctx.expect(
    `tras ${VISITAS} idas y vueltas el chasis sigue siendo el mismo (nadie cuelga nada de la raíz)`,
    JSON.stringify(despues) === JSON.stringify(antes),
    `${JSON.stringify(antes)} → ${JSON.stringify(despues)}`,
  );
  ctx.expect(
    "sigue habiendo UN #title-screen-responsive, UN #ts-mas y UN #ts-close",
    despues.responsive === 1 && despues.mas === 1 && despues.cerrar === 1,
    JSON.stringify(despues),
  );
}
