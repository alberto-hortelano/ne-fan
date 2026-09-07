/** «No pagar dos veces»: las dos reglas de GASTO que la PR 3 de #241 sacó del
 *  cliente a core (`PoliticaDeAtlas`, `FusibleDeSkins`), medidas por donde le
 *  cuestan dinero al jugador y en los tres puntos que ningún guion candaba.
 *
 *  QUÉ NO ESTABA CANDADO. El 59 mide que la Maqueta no pinta y que las celdas
 *  vienen de la librería, pero no CUÁNTAS veces se pide cada clave; el 60 mide
 *  la deduplicación del atlas en el RESUME (A3) y el cruce de tile con otro run
 *  en vuelo (A4), los dos con el POST retenido; el 51 y el 53 recorren el
 *  umbral del fusible con fallos de BACKEND. Ninguno mide estas tres:
 *
 *   A · Que en una partida NORMAL —la que juega cualquiera: entrar con Imagen
 *       IA y quedarse quieto— el atlas del tile del jugador salga por UNA sola
 *       petición, se APLIQUE (el renderer lo da por texturado, o sea que el
 *       token del run seguía vigente) y ninguna `layout_key` se pida dos veces.
 *       El 59 mide la forma del cable y el 60 mide el resume; nadie CUENTA las
 *       peticiones del camino normal, que es donde vive la factura.
 *       OJO CON LO QUE ESTE BLOQUE NO ES: no es el candado de la
 *       deduplicación. Medido el 2026-09-07 anulando la guarda de `pedir`: en
 *       el arranque normal el disparo temprano sale por «sin estilo» y termina
 *       ANTES del retro-trigger, así que no hay solape y el contador sigue en
 *       1. La dedupe por solape la canda el 60 (A3), y con esa misma guarda
 *       anulada se pone rojo con 3 POST y 23 celdas repetidas.
 *   B · Que un 4xx NO gaste evidencia del fusible. El 53 usa el 404 como
 *       máscara para que el motor falso no tumbe a los sanos —o sea, se APOYA
 *       en que no cuenta— pero no lo AFIRMA: tres personajes distintos en 404 y
 *       la sesión tiene que seguir vistiendo gente. Es la mitad de
 *       `backendDown` que ningún guion podía poner roja.
 *   C · Que alcanzado el umbral la sesión se apague UNA vez y el jugador tenga
 *       delante el mando para deshacerlo. Lo primero lo mide también el 53; lo
 *       segundo no lo mide nadie, y es donde aparece el hallazgo del bloque D.
 *
 *  LO QUE ESTE GUION NO PUEDE MEDIR, y por qué no se fuerza: que el fusible
 *  REARMADO vuelva a contar desde cero. Al estado «rearmado» solo se llega por
 *  el chip de gráficos, y con el aviso del apagón en pantalla el registro de
 *  errores lo tapa (bloque D, #483). Ocultarlo por CSS para pulsarlo sería
 *  medir un juego que nadie tiene delante, así que el bloque D lo DECLARA con
 *  su medida en vez de saltárselo. Que `rearmar()` olvide la cuenta y no solo
 *  el flag lo mide `nefan-core/test/fusible-de-skins.test.ts` desde la PR 3.
 *
 *  CÓMO SE LLEGA AL ESTADO, sin forzar nada del cliente: la partida se abre
 *  desde el título, los modos de gráficos se ponen por el CHIP (armar +
 *  confirmar, como el jugador), las escenas de B y C entran por el selector
 *  «Room» y los fallos se inyectan en el BORDE (`page.route` sobre
 *  `/skin_sprite_sheet`), nunca dentro del cliente. Las anims que el motor
 *  falso no tiene se PIDEN como `idle` (200 de verdad) en vez de mascararse con
 *  un 404 como en el 53: así el único 4xx del guion es el que se mide, y las
 *  entradas del registro que no vienen del apagón no ensucian la medida del
 *  bloque D.
 *
 *  PROBADO EN NEGATIVO (2026-09-07), un sabotaje por vez sobre `nefan-core` y
 *  restaurado byte a byte después:
 *   · `politica-de-atlas.ts`, `vigente()` devuelve siempre `false` (el run
 *     nunca llega a aplicar su atlas) → bloque A rojo: la espera del texturado
 *     expira con el POST ya hecho y pagado. Es el mutante que convierte el
 *     atlas en dinero tirado.
 *   · `fusible-de-skins.ts`, `backendDown = true` siempre (un 4xx pasa a contar
 *     como caída del backend) → bloque B rojo: la sesión se apaga con tres 404
 *     y los sanos se quedan sin vestir.
 *
 *  Cero créditos: todo contra el motor falso del runner. `aisla` deja los saves
 *  y el estado del falso vírgenes — el bloque A cuenta POST de atlas, y un
 *  atlas ya servido a otro guion los falsearía.
 */
import { cargarFixture } from "../lib/fixtures.mjs";
import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const FIXTURE = "robledo_tile";
/** El umbral que declara `nefan-core/src/session/fusible-de-skins.ts`
 *  (`UMBRAL_APAGADO_DE_SESION`). Aquí se escribe para saber cuántos personajes
 *  hacen falta en cada rama; el rango entero lo recorre el guion 53. */
const UMBRAL = 3;
const APAGADO = /skins IA desactivados para la sesión/g;

const registro = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");

const apagones = async (ctx) => ((await registro(ctx)).match(APAGADO) ?? []).length;

/** ¿Le llega el click del jugador al centro del chip de gráficos, o hay algo
 *  encima? Se pregunta ANTES de pulsar: el registro de errores crece hasta
 *  taparlo, y un `click` que Playwright reintenta 30 s no dice quién estorba. */
const alcanceDelChip = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("gfx-chip");
    if (!el) return { existe: false };
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const reg = document.getElementById("error-log")?.getBoundingClientRect();
    return {
      existe: true,
      golpea: t ? `${t.tagName}${t.id ? `#${t.id}` : `.${t.className}`}` : null,
      chipY: Math.round(r.y),
      registroAlto: reg ? Math.round(reg.height) : 0,
      entradas: document.querySelectorAll("#error-log .error-log__entry").length,
    };
  });

/** Pone una faceta de gráficos desde el chip, como el jugador: abre el panel,
 *  arma el botón («¿Confirmar? Gastará créditos») y confirma. `fila` casa
 *  /escenario/ o /personaje/; `cual` es 0 (el modo que gasta) o 1 (el gratis). */
async function ponerFaceta(ctx, fila, cual) {
  await ctx.page.click("#gfx-chip");
  const boton = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: fila })
    .locator(".gfx-seg button")
    .nth(cual);
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  if (await boton.isDisabled()) return false;
  await boton.click(); // arma
  await boton.click(); // confirma
  await ctx.page.click("#gfx-chip"); // cerrar el panel
  return true;
}

/** Pestaña limpia con el título cerrado (los bloques B y C van por fixtures). */
async function pestañaLimpia(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente está en pie", () => Boolean(window.__nefan));
  await ctx.nefan("closeTitle");
}

export default async function (ctx) {
  // El plan de sabotaje es MUTABLE y lo leen los interceptores: una sola ruta
  // registrada para los tres bloques, sin re-registrar nada entre recargas.
  const plan = { victimas: [], status: 500, pedidosDeSkin: 0, atlas: [] };

  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let c = {};
    try {
      c = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // La petición cambió de forma y este guion ya no mide lo que dice: se
      // deja pasar, y el bloque fallará por sus asertos, no por un 500 de aquí.
      await route.continue();
      return;
    }
    if (plan.victimas.includes(String(c.prompt ?? ""))) {
      await route.fulfill({
        status: plan.status,
        contentType: "application/json",
        body: JSON.stringify({ detail: `fallo ${plan.status} para ESTE personaje (simulado por QA)` }),
      });
      return;
    }
    plan.pedidosDeSkin++;
    await route.continue({ postData: JSON.stringify({ ...c, anim: "idle" }) });
  });

  await ctx.page.route("**/generate_surface_atlas", async (route) => {
    let b = null;
    try {
      b = JSON.parse(route.request().postData() ?? "null");
    } catch {
      b = null;
    }
    plan.atlas.push({ layout_key: b?.layout_key ?? null, celdas: b?.cells?.length ?? 0 });
    await route.continue();
  });

  // ── A · el atlas del tile del jugador se paga UNA vez ────────────────────
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await ctx.page.click('#ts-rendermode [data-rendermode="image"]');
  const partida = await comenzar(ctx);
  await ctx.expectEspera(
    "el atlas del tile de entrada termina y el renderer lo da por texturado",
    true,
    () => {
      const g = window.__nefan.fps();
      return g?.ready && g.activeTile && g.textured?.includes(g.activeTile) ? g.textured : null;
    },
    { ms: 120_000 },
  );
  const conCeldas = plan.atlas.filter((p) => p.celdas > 0);
  const claves = new Set(conCeldas.map((p) => p.layout_key));
  ctx.log(`partida ${partida.sessionId} · escena ${partida.scene}`);
  ctx.log(`POST /generate_surface_atlas: ${plan.atlas.length} · ${JSON.stringify(plan.atlas)}`);
  await ctx.shot("88-A-el-atlas-se-paga-una-vez");
  ctx.expect(
    "el juego SÍ pide el atlas del tile (sin petición, «no se paga dos veces» sería un verde vacío)",
    conCeldas.length >= 1,
    `POST con celdas: ${conCeldas.length}`,
  );
  ctx.expect(
    "y lo paga UNA vez: un solo POST con celdas y ni una layout_key repetida en toda la partida",
    conCeldas.length === claves.size && claves.size === 1,
    `${conCeldas.length} POST con celdas · ${claves.size} clave(s): ${JSON.stringify([...claves])}`,
  );

  // ── B · un 4xx no gasta evidencia del fusible ────────────────────────────
  await pestañaLimpia(ctx);
  await cargarFixture(ctx, FIXTURE);
  const vecinos = await ctx.page.evaluate(() =>
    (window.__nefan.scene?.npcs ?? []).map((n) => n.description ?? n.name ?? n.id));
  ctx.log(`vecinos (${vecinos.length}): ${JSON.stringify(vecinos.map((v) => v.slice(0, 22)))}`);
  if (vecinos.length < UMBRAL + 1) {
    ctx.sinMedir(
      `${FIXTURE} trae ${vecinos.length} vecinos y hacen falta ${UMBRAL + 1}: ${UMBRAL} para tumbar y ` +
        "al menos uno sano que demuestre que la sesión sigue vistiendo gente",
    );
  }
  plan.victimas = vecinos.slice(0, UMBRAL);
  plan.status = 404;

  await pestañaLimpia(ctx);
  if (await ctx.page.evaluate(() => window.__nefan.skins.length === 0)) {
    if (!(await ponerFaceta(ctx, /personaje/i, 0))) {
      ctx.sinMedir("el chip no deja encender los skins IA (graphics.ai_skin apagado)");
    }
  }
  await cargarFixture(ctx, FIXTURE);
  await ctx.expectEspera(
    `con ${UMBRAL} personajes en 404 los SANOS siguen vistiéndose: la sesión no se apagó`,
    true,
    (v) => {
      const sanos = window.__nefan.skins.filter((s) => !v.includes(s.prompt));
      return sanos.length > 0 && sanos.every((s) => s.ready.length > 0) ? sanos.length : null;
    },
    { ms: 90_000, arg: plan.victimas },
  );
  const ap404 = await apagones(ctx);
  ctx.log(`404 · libro: ${JSON.stringify((await ctx.nefan("skins")).map((s) => ({ p: s.prompt.slice(0, 16), failed: s.failed, ready: s.ready.length })))}`);
  await ctx.shot("88-B-un-4xx-no-apaga-la-sesion");
  ctx.expect(
    `${UMBRAL} personajes distintos en 404 NO apagan los skins de la sesión (un 4xx habla de la petición, no del backend)`,
    ap404 === 0,
    `apagones=${ap404} · ${(await registro(ctx)).replace(/\s+/g, " ").slice(0, 260)}`,
  );

  // ── C · el fusible rearmado vuelve a contar desde CERO ───────────────────
  plan.status = 500;
  await pestañaLimpia(ctx);
  await cargarFixture(ctx, FIXTURE);
  await ctx.expectEspera(
    `con ${UMBRAL} personajes en 5xx el juego apaga los skins de la sesión y lo dice`,
    true,
    () => (/skins IA desactivados para la sesión/.test(
      document.getElementById("error-log")?.textContent ?? "") ? true : null),
    { ms: 90_000 },
  );
  const apOff = await apagones(ctx);
  ctx.expect("…y lo dice UNA sola vez", apOff === 1, `apagones=${apOff}`);
  await ctx.shot("88-C-la-sesion-se-apaga");

  // ── D · el mando para deshacerlo, medido sin ponerlo rojo ────────────────
  // El aviso dice que los skins están apagados; el único mando que los vuelve a
  // encender —y que rearma el fusible— es el chip de gráficos. Se mide si el
  // click del jugador LLEGA. Va como `⚠ HALLAZGO` y no como `expect` porque es
  // pre-existente (#483, capas del HUD) y no lo trajo esta pieza: ocultar el
  // registro para pulsarlo sería medir un juego que nadie tiene delante.
  const alcance = await alcanceDelChip(ctx);
  ctx.log(`alcance del chip con el apagón en pantalla: ${JSON.stringify(alcance)}`);
  if (alcance.golpea !== "BUTTON#gfx-chip") {
    ctx.log(
      `⚠ HALLAZGO (#483, capas del HUD): el click del jugador NO llega al chip — cae en ` +
        `${alcance.golpea}; el registro de errores mide ${alcance.registroAlto}px con ` +
        `${alcance.entradas} entradas y el chip está en y=${alcance.chipY}. El único mando para ` +
        "volver a encender los skins queda tapado por el aviso que dice que están apagados, y " +
        "con él la única forma de REARMAR el fusible por el camino del jugador. Que rearmar " +
        "olvide la cuenta (y no solo el flag) lo mide hoy `test/fusible-de-skins.test.ts`.",
    );
    await ctx.shot("88-D-el-chip-tapado-por-el-aviso");
    return;
  }
  ctx.log("el chip es alcanzable con el apagón en pantalla: el hallazgo #483 ya no reproduce aquí");
  await ctx.shot("88-D-el-chip-alcanzable");
}
