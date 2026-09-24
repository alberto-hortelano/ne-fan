/** El UMBRAL del cortacircuitos de skins (#236), medido en su rango entero:
 *  1 personaje caído, 2 y 3.
 *
 *  El guion 51 demuestra el criterio de cierre del issue —«con el backend
 *  devolviendo 500 para UN personaje, el resto siguen pidiendo y recibiendo su
 *  skin»— pero solo puede ejercer la mitad de abajo del umbral: el tile de
 *  entrada del motor falso tiene DOS personajes, así que su aserto de
 *  «alcanzado el umbral, se anuncia UNA vez» viaja como condicional
 *  (`fallidos.length >= 3`) sobre una condición que ese escenario nunca
 *  cumple. Media rama del cambio de #236 —justo la que decide que el fusible
 *  de COSTE sigue existiendo— se quedaba sin ocupante, y una rama sin ocupante
 *  no se distingue de una que no funciona.
 *
 *  Aquí el escenario es la fixture commiteada `robledo_tile`, que trae CINCO
 *  vecinos, y el número de personajes que el backend tumba es la variable:
 *
 *    A · 1 caído  → la sesión NO se apaga y los otros cuatro se visten
 *    B · 2 caídos → la sesión NO se apaga y los otros tres se visten
 *    C · 3 caídos → la sesión SÍ se apaga, lo dice UNA vez, y lo dice con el
 *                   número y el umbral dentro (es lo que el jugador lee)
 *    D · sin sabotaje ninguno y sin máscara, con el motor falso tal cual → qué
 *        ve un jugador del banco en una escena de cinco vecinos
 *
 *  DOS CONDICIONES INYECTADAS, las dos en el BORDE (`page.route`), ninguna
 *  dentro del cliente:
 *
 *   1. `500` a las anims de los personajes elegidos como víctimas. Es el
 *      enunciado literal del criterio de cierre del issue.
 *   2. `404` a `walk`/`run` de los DEMÁS (bloques A, B y C). **Por qué sigue
 *      aquí, revisado en la tanda F (2026-09-16).** Nació porque el motor falso
 *      solo tenía hoja `idle` y contestaba **500** a `walk`: sin máscara, los
 *      cinco vecinos fallaban con error de backend y el umbral se alcanzaba
 *      solo. Eso YA NO ES CIERTO desde **#627/#498** — `animDelBanco`
 *      (`labs/narrative/fake-ai-server.ts`) sirve `idle` para toda anim de
 *      `HOJAS_BASE_ANIMS` que `paladin` no tenga, y `walk` y `run` están dentro
 *      (`nefan-core/src/contracts/sprite-census.ts`). Lo que la máscara sujeta
 *      HOY es la otra mitad del criterio del fusible, y no la sujeta nadie más
 *      en el banco: un 404 es lo que devuelve el servidor real ante una anim
 *      que no tiene, y `FusibleDeSkins.fallo` lo trata como lo que es
 *      (`!backendDown` → "ignorar"): cancela ESA anim y **no gasta evidencia
 *      contra el umbral**. Con la máscara puesta, los bloques A y B tienen 4 y
 *      3 vecinos sanos tomando 404 a la vez que 1 y 2 víctimas toman 500, así
 *      que su aserto «la sesión NO se apaga» solo puede salir verde si los 4xx
 *      de verdad no cuentan. El bloque D corre SIN máscara y retrata al banco
 *      de hoy.
 *
 *  ORDEN QUE IMPORTA, y costó una corrida en rojo: el toggle de personajes IA
 *  se PERSISTE en localStorage (`nefan.aichar`, `ui/modos-de-graficos.ts`), así que a partir
 *  del segundo bloque la recarga de página vuelve con los skins ya encendidos
 *  y la fixture empieza a pedirlos ANTES de que el guion pueda hablar. Por eso
 *  el plan de sabotaje se fija SIEMPRE antes de recargar, y el reparto se lee
 *  una sola vez en una pasada de reconocimiento (con el toggle todavía
 *  apagado, que es como llega un navegador limpio).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, y las peticiones
 *  saboteadas ni le llegan.
 *
 *  Y EL BLOQUE C MIDE ADEMÁS LO QUE EL JUGADOR LEE DEL CHIP (#510, 2026-09-10).
 *  Aquí es donde el fusible salta de verdad, así que es el único sitio del banco
 *  donde se puede afirmar que el chip de gráficos DEJA de decir «Skins IA»
 *  cuando ya no se genera ninguno —medido antes de arreglarlo: `title:
 *  "personajes: Skins IA"` con el registro diciendo lo contrario dos líneas más
 *  abajo—. Rojo con `charsSuspendidos` fuera de `ui/graphics-mode.ts`.
 *
 *  Y de paso deja MEDIDO #509: con tres personajes caídos el registro de errores
 *  (z-index 8900) tapa el chip (z-index 30) y el click no le llega. El bloque
 *  sondea la capa con `elementFromPoint` y, si está tapado, se declara sin medir
 *  con su motivo en vez de morir en un timeout de 30 s.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): con `UMBRAL_APAGADO_DE_SESION = 1` —el
 *  comportamiento anterior a #236— los bloques A y B se ponen rojos.
 *
 *  PROBADO EN NEGATIVO (tanda F, 2026-09-16), lo reescrito aquí:
 *   · **el bloque D**, con `animDelBanco` devolviendo `anim` a secas —el banco
 *     de antes de #627— sale ROJO en sus TRES asertos: `vestidos 3/5 ·
 *     fallidos 3 · apagones 1 · canceladas 3`, que es exactamente el retrato
 *     que este bloque afirmaba hasta hoy. A, B y C siguen verdes.
 *   · **la máscara de A/B/C**, con `FusibleDeSkins.fallo` contando los 4xx
 *     (`status >= 400`), tumba el bloque A ya en su espera: «los 4 vecinos que
 *     el backend NO tumba consiguen su skin» expira, porque el fusible salta
 *     con los 404 de la máscara antes de que se vistan. O sea que la máscara no
 *     es decorado: es el único sitio del banco donde «un 4xx no gasta
 *     evidencia» puede ponerse rojo.
 */
import { cargarFixture } from "../lib/fixtures.mjs";

export const aisla = ["saves"];

const FIXTURE = "robledo_tile";
/** El valor que declara `nefan-core/src/session/fusible-de-skins.ts` (`UMBRAL_APAGADO_DE_SESION`). Se
 *  escribe aquí porque este guion mide el COMPORTAMIENTO en su rango, no la
 *  constante: cambiar una sin la otra tiene que ponerse rojo. */
const UMBRAL = 3;
const APAGADO = /skins IA desactivados/g;
const CANCELADA = /skin IA cancelada/g;

/** El texto del registro de errores del cliente, tal y como lo ve el jugador. */
const registro = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");

/** Enciende los skins IA de personaje desde el chip de gráficos, por el camino
 *  del jugador (armar y confirmar). Mismo gesto que el guion 15. */
async function encenderSkins(ctx) {
  await ctx.page.click("#gfx-chip");
  const boton = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /personaje/i })
    .locator(".gfx-seg button")
    .first();
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  if (await boton.isDisabled()) return false;
  await boton.click(); // arma: «¿Confirmar? Gastará créditos»
  await boton.click(); // confirma
  return true;
}

/** Pestaña limpia con la fixture puesta; devuelve las descripciones de sus
 *  vecinos en el orden en que la escena las trae. */
async function pueblo(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, FIXTURE);
  return ctx.page.evaluate(() =>
    (window.__nefan.scene?.npcs ?? []).map((n) => n.description ?? n.name ?? n.id),
  );
}

export default async function (ctx) {
  // El plan de sabotaje es MUTABLE y lo lee el interceptor: una sola ruta
  // registrada para los cuatro bloques, sin re-registrar nada entre recargas.
  const plan = { victimas: [], mascara: true, servidas: 0, caidas: 0, traza: [] };
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let cuerpo;
    try {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // Un cuerpo que no es JSON significa que la petición cambió de forma y
      // este guion ya no mide lo que dice: se deja pasar, y el bloque fallará
      // por sus asertos y no por un 500 inventado aquí.
      await route.continue();
      return;
    }
    const prompt = String(cuerpo.prompt ?? "");
    const anim = String(cuerpo.anim ?? "");
    const quien = prompt.slice(0, 20);
    if (plan.victimas.includes(prompt)) {
      plan.caidas++;
      plan.traza.push(`500 ${anim}/${quien}`);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "fallo del proveedor para ESTE personaje (simulado por QA)" }),
      });
      return;
    }
    if (plan.mascara && anim !== "idle") {
      plan.traza.push(`404 ${anim}/${quien}`);
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: `sin hoja para "${anim}" (máscara de QA)` }),
      });
      return;
    }
    plan.servidas++;
    plan.traza.push(`→ ${anim}/${quien}`);
    await route.continue();
  });

  // ── Reconocimiento: quién vive en el pueblo ──────────────────────────────
  // Con el toggle de personajes IA todavía apagado (navegador limpio), así que
  // esta pasada no pide un solo skin y no contamina nada.
  const VECINOS = await pueblo(ctx);
  ctx.log(`vecinos (${VECINOS.length}): ${JSON.stringify(VECINOS)}`);
  ctx.expect(
    "la fixture del pueblo trae al menos cinco vecinos: sin ellos el umbral no se puede recorrer",
    VECINOS.length >= 5,
    `${VECINOS.length} NPC(s): ${JSON.stringify(VECINOS)}`,
  );
  if (VECINOS.length < 5) {
    ctx.sinMedir(
      `la fixture ${FIXTURE} trae ${VECINOS.length} vecinos y hacen falta 5 para tumbar a 3 y ` +
        "dejar sanos a otros dos: el rango del umbral no se puede recorrer",
    );
  }

  /** Prepara y arranca un bloque. El plan se fija ANTES de recargar (ver la
   *  cabecera): con el toggle persistido, la fixture pide skins sola. */
  async function bloque(n, { mascara = true } = {}) {
    plan.victimas = VECINOS.slice(0, n);
    plan.mascara = mascara;
    plan.servidas = 0;
    plan.caidas = 0;
    plan.traza = [];
    await pueblo(ctx);
    ctx.log(`víctimas (${n}): ${JSON.stringify(plan.victimas.map((v) => v.slice(0, 20)))}`);
    const pidiendo = await ctx.page.evaluate(() => window.__nefan.skins.length > 0);
    if (!pidiendo && !(await encenderSkins(ctx))) {
      ctx.sinMedir("el chip de gráficos no deja encender los skins IA (graphics.ai_skin=false)");
    }
    return ctx.waitFor(
      `el juego apunta en su libro a los ${VECINOS.length} vecinos`,
      (k) => (window.__nefan.skins.length >= k ? window.__nefan.skins : null),
      60_000,
      VECINOS.length,
    );
  }

  /** Lo observable al final de un bloque, con el registro que ve el jugador. */
  async function foto(ctx) {
    const libro = await ctx.nefan("skins");
    const texto = await registro(ctx);
    return {
      libro,
      texto,
      vestidos: libro.filter((s) => s.ready.length > 0).length,
      fallidos: libro.filter((s) => s.failed).length,
      apagones: (texto.match(APAGADO) ?? []).length,
      canceladas: (texto.match(CANCELADA) ?? []).length,
    };
  }

  /** Espera a que los vecinos SANOS de este bloque tengan su anim lista. Es la
   *  prueba positiva de que la sesión sigue viva: si el fusible hubiera
   *  saltado, ni siquiera llegarían a pedirla. */
  const sanosVestidos = (ctx, cuantos) =>
    ctx.waitFor(
      `los ${cuantos} vecinos que el backend NO tumba consiguen su skin`,
      (v) => {
        const sanos = window.__nefan.skins.filter((s) => !v.includes(s.prompt));
        return sanos.length >= v.length && sanos.every((s) => s.ready.length > 0) ? sanos : null;
      },
      90_000,
      plan.victimas,
    ).then(() => undefined);

  // ── A · UN personaje caído: la sesión NO se apaga ────────────────────────
  {
    await bloque(1);
    await sanosVestidos(ctx, VECINOS.length - 1);
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(`1 caído · vestidos ${f.vestidos}/${VECINOS.length} · apagones ${f.apagones}`);
    await ctx.shot("umbral-1-caido");
    ctx.expect(
      "con UN personaje caído, los otros cuatro vecinos se visten igual",
      f.vestidos === VECINOS.length - 1,
      `vestidos=${f.vestidos} de ${VECINOS.length} · libro=${JSON.stringify(f.libro)}`,
    );
    ctx.expect(
      "…y la sesión NO se apaga (era el bug: se apagaba al primero)",
      f.apagones === 0,
      f.texto.replace(/\s+/g, " ").slice(0, 300),
    );
  }

  // ── B · DOS personajes caídos: sigue sin apagarse ────────────────────────
  {
    await bloque(2);
    await sanosVestidos(ctx, VECINOS.length - 2);
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(`2 caídos · vestidos ${f.vestidos}/${VECINOS.length} · apagones ${f.apagones}`);
    ctx.expect(
      "con DOS personajes caídos, los otros tres se visten igual",
      f.vestidos === VECINOS.length - 2,
      `vestidos=${f.vestidos} de ${VECINOS.length} · libro=${JSON.stringify(f.libro)}`,
    );
    ctx.expect(
      `…y la sesión sigue SIN apagarse por debajo del umbral (${UMBRAL})`,
      f.apagones === 0,
      f.texto.replace(/\s+/g, " ").slice(0, 300),
    );
  }

  // ── C · TRES caídos: el fusible sigue existiendo, salta y se explica ─────
  {
    await bloque(UMBRAL);
    await ctx.waitFor(
      `con ${UMBRAL} personajes caídos el juego apaga los skins de la sesión y lo dice`,
      () => {
        const t = document.getElementById("error-log")?.textContent ?? "";
        return /skins IA desactivados/.test(t) ? t : null;
      },
      90_000,
    );
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(
      `3 caídos · vestidos ${f.vestidos}/${VECINOS.length} · fallidos ${f.fallidos} · ` +
        `apagones ${f.apagones} · canceladas ${f.canceladas}`,
    );
    ctx.log(
      `aviso: ${f.texto.replace(/\s+/g, " ").match(/skins IA desactivados[^|]{0,200}/)?.[0] ?? "(?)"}`,
    );
    await ctx.shot("umbral-3-caidos");
    ctx.expect(
      `alcanzado el umbral (${UMBRAL}), el apagón de sesión se anuncia UNA sola vez`,
      f.apagones === 1,
      `apagones=${f.apagones} · ${f.texto.replace(/\s+/g, " ").slice(0, 400)}`,
    );
    // NI UN FALLO MUDO, CON N ≥ 3 — y es aquí y no en el 51 (QA de la tanda F,
    // hallazgo H-4). El 51 afirma esto mismo (`canceladas === fallidos.length`,
    // líneas 142-146) pero con **N = 1**: tumba a un solo personaje, así que
    // «una entrada por fallo» y «una entrada, y punto» son ahí el mismo verde.
    // La rama muda que el comentario de producción nombra en
    // `character-sprites.ts:321-325` —un 5xx que no escribe nada cuando ya
    // había evidencia anotada— es INVISIBLE con N = 1 y no la mide nadie más:
    // no hay test de `CharacterSpriteManager`, y el único «cancelada» del banco
    // fuera de aquí es el del 51. Este bloque tumba a TRES, que es donde la
    // diferencia existe. El `>= UMBRAL` no es adorno: sin él, `0 === 0` sería
    // un verde vacío el día que el sabotaje dejara de tumbar a nadie.
    ctx.expect(
      `…y cada uno de los ${UMBRAL} caídos deja SU entrada en el registro: ni cero (mudo) ni UNA sola por todos`,
      f.canceladas === f.fallidos && f.fallidos >= UMBRAL,
      `canceladas=${f.canceladas} fallidos=${f.fallidos} · ${f.texto.replace(/\s+/g, " ").slice(0, 400)}`,
    );
    ctx.expect(
      "…y el aviso dice CUÁNTOS personajes cayeron y cuál es el umbral, no solo que algo falló",
      new RegExp(`${UMBRAL} personajes`).test(f.texto) && new RegExp(`umbral ${UMBRAL}`).test(f.texto),
      f.texto.replace(/\s+/g, " ").slice(0, 400),
    );
    ctx.expect(
      "…y dice qué va a ver el jugador (la base y_bot), que es lo accionable",
      /y_bot/.test(f.texto),
      f.texto.replace(/\s+/g, " ").slice(0, 400),
    );

    // Y EL CHIP NO DICE LO CONTRARIO (#510). Medido antes de arreglarlo:
    // `title: "personajes: Skins IA"` con el registro diciendo «skins IA
    // desactivados… (umbral 3)». Dos verdades en pantalla a la vez, que es la
    // clase de fallo que T9 ya cazó en el título. La causa: `charsOn` leía
    // `skinsAllowed && ai_skin`, y el fusible de #236 no toca `skinsAllowed`
    // —no puede: el rearme ES el OFF→ON del chip, que canda el guion 51—, así
    // que el chip enseña ahora el estado EFECTIVO por su cuenta.
    const chip = await ctx.page.evaluate(() => {
      const c = document.getElementById("gfx-chip");
      return { texto: c?.textContent ?? null, title: c?.title ?? null, oculto: c?.hidden ?? null };
    });
    ctx.log(`chip de gráficos con el fusible saltado: ${JSON.stringify(chip)}`);
    ctx.expect(
      "con el cortacircuitos saltado, el chip DICE que los skins están suspendidos (#510)",
      /suspendidos/i.test(chip.title ?? ""),
      JSON.stringify(chip),
    );
    ctx.expect(
      "…y dice cómo se rearman, que es lo accionable",
      /apaga y enciende/i.test(chip.title ?? ""),
      JSON.stringify(chip),
    );
    await ctx.shot("chip-con-el-fusible-saltado");

    // El panel es donde el jugador viene a mirar el gasto, así que el aviso va
    // también ahí… PERO ABRIRLO ES #509. Este bloque acaba de tumbar a TRES
    // personajes, o sea que `#error-log` (z-index 8900, `position: fixed`,
    // creciendo desde `top: 34px`) está lleno justo cuando hay que tocar el
    // chip, que vive en `#ui-bottom-right` con z-index 30. Medido aquí el
    // 2026-09-10: el click de Playwright sobre `#gfx-chip` expira a los 30 s
    // con «<span class="error-log__time"> from <div id="error-log"> subtree
    // intercepts pointer events». Es EXACTAMENTE el enunciado de #509 —«el
    // registro tapa el panel del chip y se come el click»— y no es de este
    // guion arreglarlo: se SONDEA la capa, y si el registro tapa el chip el
    // bloque se declara sin medir con su motivo en vez de morirse en un
    // timeout. El chip en sí ya está medido arriba, que es lo de #510.
    const puerta = await ctx.page.evaluate(() => {
      const c = document.getElementById("gfx-chip");
      if (!c) return { hay: false };
      const r = c.getBoundingClientRect();
      const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        hay: true,
        abierto: document.getElementById("gfx-panel")?.hidden === false,
        alcanzable: Boolean(arriba) && (arriba === c || c.contains(arriba)),
        tapa: arriba
          ? `${arriba.tagName.toLowerCase()}${arriba.id ? `#${arriba.id}` : ""}` +
            `${arriba.closest("#error-log") ? " (dentro de #error-log)" : ""}`
          : null,
      };
    });
    ctx.log(`puerta del chip: ${JSON.stringify(puerta)}`);
    if (!puerta.hay || (!puerta.abierto && !puerta.alcanzable)) {
      ctx.sinMedirBloque(
        `#509 EN VIVO: el registro de errores tapa el chip de gráficos (el click del centro cae en ` +
          `${puerta.tapa}), así que su panel no se puede abrir por el camino del jugador y el aviso de ` +
          `suspensión no se puede leer ahí. El CHIP sí queda medido arriba (#510). Cuando #509 cierre, ` +
          `este bloque mide solo`,
      );
    } else {
      if (!puerta.abierto) await ctx.page.click("#gfx-chip");
      const panel = await ctx.page.evaluate(() => {
        const s = document.querySelector("#gfx-panel .gfx-suspension");
        return { visible: Boolean(s) && !s.hidden, texto: s?.textContent ?? null };
      });
      ctx.log(`panel del chip: ${JSON.stringify(panel)}`);
      ctx.expect(
        "el panel del chip trae el aviso de suspensión con el gesto que la deshace",
        panel.visible === true && /apaga y enciende/i.test(panel.texto ?? ""),
        JSON.stringify(panel),
      );
      // Y se deja como se encontró: el bloque D vuelve a recargar, pero un panel
      // abierto tapando media pantalla no es el estado del que se parte.
      await ctx.page.click("#gfx-chip");
    }
  }

  // ── D · El banco tal cual, sin sabotaje y sin máscara ────────────────────
  // EL RETRATO DEL BANCO, reescrito en la tanda F. Hasta #627 este bloque
  // medía un banco que contestaba 500 a `walk`: TODOS los vecinos caían con
  // error de backend y el umbral se alcanzaba sin que nadie saboteara nada.
  // #627 cerró #498 a propósito —el banco no debe fundir el fusible de
  // PRODUCCIÓN por una limitación de sus propios assets— y con aquel 500 se
  // fue el sujeto de los dos asertos de este bloque, que salieron rojos el
  // 2026-09-16 sin que nada del jugador se hubiera roto.
  //
  // El rango del fusible de #236 NO se pierde: lo miden los bloques A, B y C
  // de aquí con su propio 500 inyectado, y `qa/guiones/51-…` afirma
  // `canceladas === fallidos.length` con el suyo. Lo exclusivo de este bloque
  // era, y sigue siendo, el RETRATO: qué ve un jugador del banco en una escena
  // de cinco vecinos cuando nadie sabotea nada. Hoy ese retrato es el
  // contrario del de ayer, y es el que se escribe.
  {
    await bloque(0, { mascara: false });
    // El desenlace es «ya no queda nada en vuelo», y eso NO es «tiene alguna
    // anim lista»: `idle` llega antes que `walk` y `run`, así que esperar por
    // `ready.length > 0` leería el libro a media cola y el aserto de las tres
    // anims sería un intermitente. `queued` es lo que se ha ENCOLADO alguna vez
    // (nunca se vacía al acertar, ver `character-sprites.ts`), así que asentado
    // = todo lo encolado está listo, o el personaje falló. El predicado va
    // ENTERO dentro del `evaluate`: lo que se pasa viaja como fuente y un
    // cierre del guion no existe en la página (medido: `asentado is not
    // defined`).
    //
    // LO QUE ESTO SE JUEGA (QA de la tanda F, H-7): `queued` puede CRECER solo
    // —`modelFor` encola perezosamente la anim de combate que una entidad
    // empiece a dibujar—, así que un pueblo que peleara podría no asentarse
    // nunca. Se asume a propósito: aquí nadie pelea (fixture del selector Room,
    // sin sesión ni combate), y el modo de fallo es una espera que EXPIRA
    // imprimiendo el libro entero —un rojo legible—, no un verde prematuro.
    // Mirar solo el set automático evitaría eso, pero dejaría pasar justo lo
    // que la espera existe para impedir: una petición todavía en vuelo.
    await ctx.waitFor(
      "el banco llega a su desenlace: o cada vecino tiene listas todas sus anims, o alguno falló, o el fusible salta y lo dice",
      (k) => {
        const l = window.__nefan.skins;
        const t = document.getElementById("error-log")?.textContent ?? "";
        if (/skins IA desactivados/.test(t)) return { l, t };
        const asentado = (s) => s.failed || (s.queued.length > 0 && s.queued.every((a) => s.ready.includes(a)));
        return l.length >= k && l.every(asentado) ? { l, t } : null;
      },
      90_000,
      VECINOS.length,
    );
    const f = await foto(ctx);
    ctx.log(`traza: ${plan.traza.join(" | ")}`);
    ctx.log(
      `banco sin máscara · vestidos ${f.vestidos}/${VECINOS.length} · fallidos ${f.fallidos} · ` +
        `apagones ${f.apagones} · canceladas ${f.canceladas} · servidas ${plan.servidas}`,
    );
    // LA FOTO SE PONE DELANTE DE UN VECINO (QA de la tanda F, hallazgo H-8: la
    // captura no enseñaba a ninguno de los que el bloque afirma). Se encuadra
    // UNO de cerca y no los cinco: MEDIDO, los cinco están repartidos en un
    // círculo de ~23 m de radio y desde el ojo del jugador no caben en un
    // encuadre con los sprites a un tamaño que se vea — el intento «mirador a
    // 42 m» salió peor que la foto de antes, con la cámara entre dos edificios
    // y ni una cara. Lo que esta captura enseña es lo que no se puede leer en
    // un JSON: que el arte del banco llegó a un CUERPO. Los cinco están en el
    // libro, que se registra entero aquí al lado. Receta del guion 138: el
    // jugador a unos metros en +z y mirando a −z (`yaw = π`).
    const posado = await ctx.page.evaluate(() => {
      const npc = window.__nefan.npcs()[0];
      return npc ? { id: npc.id, x: npc.pos.x, z: npc.pos.z } : null;
    });
    if (posado) {
      await ctx.nefan("setPlayerPos", posado.x, posado.z + 3);
      await ctx.nefan("setYaw", Math.PI);
      ctx.log(`foto delante de ${posado.id}, a 3 m`);
    }
    await ctx.shot("banco-sin-mascara");
    ctx.expect(
      "en el banco tal cual, los CINCO vecinos acaban con sus tres anims LISTAS y NINGUNO cae: el motor falso no tumba a nadie por su cuenta (#498/#627)",
      f.vestidos === VECINOS.length &&
        f.fallidos === 0 &&
        f.libro.length === VECINOS.length &&
        f.libro.every((s) => ["idle", "walk", "run"].every((a) => s.ready.includes(a))),
      `vestidos=${f.vestidos}/${VECINOS.length} fallidos=${f.fallidos} · ${JSON.stringify(f.libro)}`,
    );
    // Y LO QUE EL JUGADOR LEE. No es una propiedad independiente y no cuenta
    // como evidencia aparte: con `fallidos === 0` no puede haber cancelaciones
    // —la línea y el `state.failed` salen del MISMO `catch`— ni apagón, que
    // pide tres. Se afirma igual porque el registro es el canal por el que esto
    // le llega a quien juega, y porque un día el `catch` puede dejar de ser uno
    // (QA de la tanda F, hallazgo H-6: implicado y declarado como tal).
    ctx.expect(
      "…y el registro del jugador queda LIMPIO: ni una cancelación, ni el apagón del fusible de PRODUCCIÓN por una limitación de los assets del banco",
      f.canceladas === 0 && f.apagones === 0,
      `canceladas=${f.canceladas} apagones=${f.apagones} · ${f.texto.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
}
