/** REARMAR EL FUSIBLE DE SKINS DEVUELVE TAMBIÉN A LOS QUE SE SALTÓ (#520).
 *
 *  Cuando el fusible de skins se funde (`FusibleDeSkins`, tres personajes
 *  distintos con error de BACKEND), la sesión deja de pedir arte. Pero en ese
 *  instante la cola de generación ya lleva dentro las anims de los vecinos que
 *  aún no han llegado a pedirse, y esas se SALTAN: no fallaron —el apagón fue
 *  de otros tres—, simplemente no se pidieron.
 *
 *  Ahí estaba el agujero. `rearmarCortacircuitos()` borra a los que FALLARON
 *  (eso lo mide el bloque 4 del guion 51), pero al saltado no lo toca ni tiene
 *  por qué: no está marcado. Y su anim seguía apuntada en `queued` como si se
 *  hubiera pedido, así que los dos caminos de vuelta preguntaban por un apunte
 *  que mentía y ninguno volvía a encolar nada — ni `requestSkin`, que sale
 *  antes para un personaje que ya tiene estado, ni `modelFor`, que solo encola
 *  lo que no está en `queued`. Con `CharacterSpriteManager` como singleton de
 *  MÓDULO, ese vecino se quedaba en maniquí toda la vida de la pestaña: apagar
 *  y encender «Personajes IA» no lo recuperaba, ni volver al título, ni
 *  reanudar. Solo recargar.
 *
 *  ES OTRA POBLACIÓN QUE LA DEL 51, y por eso hace falta otro guion: allí se
 *  mide el que FALLÓ (`failed: true`, al que el rearme olvida a propósito);
 *  aquí el que ni siquiera llegó a pedir. Con el arreglo puesto, los dos
 *  vuelven; sin él, solo el primero — y el segundo se ve exactamente igual que
 *  un vecino que todavía no ha terminado de vestirse.
 *
 *  CÓMO SE LLEGA AL ESTADO sin trucar el cliente: la fixture del pueblo (cinco
 *  vecinos), los skins encendidos por el CHIP como el jugador, y los fallos
 *  inyectados en el BORDE (`page.route`) — 500 a los tres primeros vecinos,
 *  que funden el fusible mientras los otros dos siguen en la cola. Las anims
 *  que el motor falso no tiene se mascaran con 404 (4xx = error de la
 *  PETICIÓN: no gasta evidencia del fusible), como el 53, para que la única
 *  causa del apagón sean los tres 500 que el guion pone.
 *
 *  DE PASO, EL PUNTO 3 DE #510: este guion corre SIN partida (fixtures), que es
 *  donde el aviso del apagón decía «skins IA desactivados para la sesión» y
 *  nombraba algo que el jugador no tiene delante. El fusible es de la PESTAÑA y
 *  se funde igual en los dos sitios; el aviso ya vale en los dos, y aquí se
 *  afirma que no habla de sesión y que no ha perdido nada de lo que sí importa.
 *
 *  WORKAROUND DECLARADO (#483, que la tanda A ha reproducido y medido como
 *  #509): el aviso del apagón crece hasta tapar el chip, que es el único mando
 *  para deshacerlo, así que el click del jugador no llega. El guion SONDEA el
 *  alcance del chip y lo deja escrito con su medida —eso es lo que mide del
 *  hallazgo—, y después aparta esa capa de DEV (`pointer-events`, no el juego)
 *  SIEMPRE, porque el registro sigue creciendo entre la sonda y el click. Quien
 *  vigila el hallazgo es el bloque D del guion 88; aquí se aparta para poder
 *  medir #520, que es otra cosa.
 *
 *  Cero créditos: fixture y motor falso; `aisla` deja su estado virgen.
 */

import { cargarFixture } from "../lib/fixtures.mjs";

export const aisla = ["saves", "fake-ai"];

const FIXTURE = "robledo_tile";
/** El valor que declara `nefan-core/src/session/fusible-de-skins.ts`. Aquí se
 *  escribe para saber a cuántos hay que tumbar; el rango entero lo recorre el 53. */
const UMBRAL = 3;
const APAGADO = /skins IA desactivados/;

const libro = (ctx) => ctx.page.evaluate(() => window.__nefan.skins);
const registro = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");

/** Los botones de la fila «Personajes» del chip de gráficos. */
function segmentoDePersonajes(ctx) {
  return ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /personaje/i })
    .locator(".gfx-seg button");
}

/** ¿Le llega el click del jugador al chip de gráficos, o hay algo encima? Se
 *  pregunta ANTES de pulsar, como el bloque D del 88: un `click` que Playwright
 *  reintenta 30 s no dice quién estorba. */
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

/** APARTA EL REGISTRO DE DEV, y solo si de verdad estorba (#483).
 *
 *  Es un workaround y se declara como tal, con su medida: el aviso que dice
 *  «los skins están apagados» crece hasta tapar el ÚNICO mando para volver a
 *  encenderlos, así que en el juego de verdad ese click no llega. El bloque D
 *  del guion 88 existe para DECLARAR ese hallazgo y no lo esquiva; aquí hay que
 *  apartarlo porque lo que este guion mide es otra cosa (#520) y sin el rearme
 *  no hay nada que medir.
 *
 *  Lo que se toca es el `pointer-events` de una capa de DEV (`dev-ui.css`, «la
 *  UI de desarrollo vive fuera de este árbol»), no el juego: el registro sigue
 *  en pantalla, sigue leyéndose y este guion sigue contando sus entradas. */
async function medirYApartarElRegistro(ctx) {
  const alcance = await alcanceDelChip(ctx);
  const tapado = alcance.golpea !== "BUTTON#gfx-chip";
  if (tapado) {
    ctx.log(
      `⚠ HALLAZGO (#483, reproducido y medido por la tanda A como #509): con el apagón en ` +
        `pantalla el click del jugador NO llega al chip — cae en ${alcance.golpea}; el registro ` +
        `mide ${alcance.registroAlto}px con ${alcance.entradas} entradas y el chip está en ` +
        `y=${alcance.chipY}. El aviso que dice que los skins están apagados tapa el único mando ` +
        "para encenderlos.",
    );
    await ctx.shot("el-registro-de-dev-tapa-el-chip");
  } else {
    ctx.log(`el chip es alcanzable ahora mismo: ${JSON.stringify(alcance)}`);
  }
  // Se aparta SIEMPRE, no solo cuando la sonda lo ve tapado, y es a propósito:
  // el registro sigue creciendo entre la sonda y el click (medido: con el aviso
  // dos líneas más largo, 6 entradas y 746px, la sonda decía «alcanzable» y el
  // click moría 30 s después). Lo que este guion MIDE del hallazgo es la sonda,
  // que queda escrita arriba; lo que no puede es depender de esa suerte para
  // medir #520, que es otra cosa. Lo que se toca es una capa de DEV
  // (`dev-ui.css`: «la UI de desarrollo vive fuera de este árbol»), sigue en
  // pantalla y este guion sigue leyendo su texto.
  await ctx.page.evaluate(() => {
    const el = document.getElementById("error-log");
    if (el) el.style.pointerEvents = "none";
  });
  return tapado;
}

/** Abre el panel del chip si está cerrado. El click sobre el chip es un TOGGLE,
 *  así que «pulsar para abrir» a ciegas lo cierra cuando ya estaba abierto — y
 *  si el navegador trae `nefan.aichar` puesto de un guion anterior (localStorage
 *  sobrevive a la recarga), la fixture ya pide skins sola y nadie lo había
 *  abierto todavía. Medido en la batería del 2026-09-10: el guion salía verde
 *  en solitario y se colgaba 30 s esperando un botón invisible detrás del 53. */
async function abrirElChip(ctx) {
  const abierto = await ctx.page.evaluate(
    () => !(document.getElementById("gfx-panel")?.hidden ?? true),
  );
  if (!abierto) await ctx.page.click("#gfx-chip");
}

/** Enciende los skins IA por el camino del jugador: armar y confirmar. */
async function encenderSkins(ctx) {
  await abrirElChip(ctx);
  const boton = segmentoDePersonajes(ctx).first();
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  if (await boton.isDisabled()) return false;
  await boton.click(); // arma: «¿Confirmar? Gastará créditos»
  await boton.click(); // confirma
  return true;
}

/** El gesto del rearme, que es el mismo del jugador que quiere recuperar a sus
 *  vecinos: Personajes a maqueta y otra vez a imagen. */
async function apagarYEncender(ctx) {
  await abrirElChip(ctx);
  const seg = segmentoDePersonajes(ctx);
  await seg.first().waitFor({ state: "visible", timeout: 10_000 });
  await seg.nth(1).click(); // «maqueta»: apagar no gasta y no pide confirmación
  await seg.first().click(); // arma
  await seg.first().click(); // confirma
}

export default async function (ctx) {
  // Plan de sabotaje MUTABLE: una sola ruta registrada para todo el guion.
  const plan = { victimas: [], servidas: 0, caidas: 0, mascaradas: 0 };
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let cuerpo = {};
    try {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // Un cuerpo que no es JSON: la petición cambió de forma y este guion ya
      // no mide lo que dice. Se deja pasar y que fallen sus asertos.
      await route.continue();
      return;
    }
    const prompt = String(cuerpo.prompt ?? "");
    const anim = String(cuerpo.anim ?? "");
    if (plan.victimas.includes(prompt)) {
      plan.caidas++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "fallo del proveedor para ESTE personaje (simulado por QA)" }),
      });
      return;
    }
    if (anim !== "idle") {
      // 4xx: habla de la PETICIÓN, no del backend — no gasta evidencia del
      // fusible. Sin esta máscara, el motor falso (que solo tiene `idle`)
      // tumbaría a todo el pueblo y el apagón dejaría de ser el que pone el guion.
      plan.mascaradas++;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: `sin hoja para "${anim}" (máscara de QA)` }),
      });
      return;
    }
    plan.servidas++;
    await route.continue();
  });

  // ── 0 · El pueblo, con los skins todavía apagados ────────────────────────
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, FIXTURE);
  const vecinos = await ctx.page.evaluate(() =>
    (window.__nefan.scene?.npcs ?? []).map((n) => n.description ?? n.name ?? n.id),
  );
  ctx.log(`vecinos (${vecinos.length}): ${JSON.stringify(vecinos.map((v) => v.slice(0, 24)))}`);
  if (vecinos.length < UMBRAL + 1) {
    return ctx.sinMedir(
      `la fixture ${FIXTURE} trae ${vecinos.length} vecinos y hacen falta ${UMBRAL + 1}: ` +
        "tres para fundir el fusible y al menos uno al que saltarse",
    );
  }

  // ── 1 · Se funde el fusible con tres, y quedan vecinos SIN pedir ─────────
  plan.victimas = vecinos.slice(0, UMBRAL);
  ctx.log(`víctimas: ${JSON.stringify(plan.victimas.map((v) => v.slice(0, 24)))}`);
  // La fixture se recarga con el plan ya puesto: encender los skins pide el
  // arte de los cinco de golpe, que es lo que llena la cola.
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, FIXTURE);
  const pidiendo = await ctx.page.evaluate(() => window.__nefan.skins.length > 0);
  if (!pidiendo && !(await encenderSkins(ctx))) {
    return ctx.sinMedir("el chip de gráficos no deja encender los skins IA (graphics.ai_skin=false)");
  }

  await ctx.expectEspera(
    `con ${UMBRAL} vecinos en 500 el fusible se funde y el juego lo dice`,
    true,
    () => (/skins IA desactivados/.test(
      document.getElementById("error-log")?.textContent ?? "",
    ) ? { apagado: true } : null),
    { ms: 90_000 },
  );
  const trasElApagon = await libro(ctx);
  ctx.log(
    `libro tras el apagón: ${JSON.stringify(
      trasElApagon.map((s) => ({ q: s.prompt.slice(0, 18), ready: s.ready, failed: s.failed })),
    )} · 500 servidos: ${plan.caidas} · hojas servidas: ${plan.servidas}`,
  );

  // #510-p3 · Y EL AVISO NO HABLA DE UNA SESIÓN QUE NO HAY. Este guion corre en
  // FIXTURES —selector «Room», sin partida—, que es justo donde el texto de
  // antes («skins IA desactivados para la sesión») nombraba algo que el jugador
  // no tiene delante. El fusible es de la PESTAÑA y se funde igual en los dos
  // sitios, así que el aviso tiene que valer en los dos.
  const aviso = (await registro(ctx)).replace(/\s+/g, " ").match(/skins IA desactivados[^|]{0,220}/)?.[0] ?? "";
  ctx.log(`el aviso del apagón, sin partida: «${aviso}»`);
  ctx.expect(
    "sin partida, el aviso del apagón NO habla de «la sesión» (#510-p3): aquí no hay ninguna",
    aviso.length > 0 && !/sesi[oó]n/i.test(aviso),
    JSON.stringify(aviso),
  );
  ctx.expect(
    "…y sigue diciendo lo que importa: cuántos cayeron, el umbral, con qué se pinta y cómo deshacerlo",
    /\d+ personajes distintos/.test(aviso) &&
      /umbral \d+/.test(aviso) &&
      /y_bot/.test(aviso) &&
      /chip de gr[aá]ficos/.test(aviso),
    JSON.stringify(aviso),
  );

  // Los SALTADOS: en el libro (alguien pidió su skin), sin una sola anim lista
  // y SIN marca de fallo. Es la población que el rearme no puede olvidar
  // porque no está marcada, y la que se quedaba en maniquí para siempre.
  const saltados = trasElApagon.filter((s) => !s.failed && s.ready.length === 0);
  ctx.expect(
    "el apagón deja vecinos ENCOLADOS Y SALTADOS: pedidos, sin arte y sin marca de fallo",
    saltados.length > 0,
    JSON.stringify(trasElApagon.map((s) => ({ q: s.prompt.slice(0, 18), ready: s.ready, failed: s.failed }))),
  );
  if (saltados.length === 0) {
    return ctx.sinMedirBloque(
      "sin vecinos saltados no hay nada que rearmar: la cola se vació antes de fundirse el fusible",
    );
  }
  ctx.log(`saltados (${saltados.length}): ${JSON.stringify(saltados.map((s) => s.prompt.slice(0, 24)))}`);
  await ctx.shot("tras-el-apagon-vecinos-saltados");

  // ── 2 · Rearmar los devuelve, y sin recargar ────────────────────────────
  // El gesto es del jugador: el chip de gráficos, Personajes a maqueta y otra
  // vez a imagen — el mismo `aplicar` que dispara el rearme al entrar o
  // reanudar una partida.
  plan.victimas = [];
  await medirYApartarElRegistro(ctx);
  await apagarYEncender(ctx);

  const claves = saltados.map((s) => s.prompt);
  const { ocurrio } = await ctx.expectEspera(
    "tras rearmar, los vecinos que el apagón se SALTÓ vuelven a pedir su skin y lo reciben",
    true,
    (ks) => {
      const l = window.__nefan.skins;
      const vivos = ks.filter((k) => (l.find((s) => s.prompt === k)?.ready.length ?? 0) > 0);
      return vivos.length === ks.length ? { vivos: vivos.length } : null;
    },
    { ms: 90_000, arg: claves },
  );
  const alFinal = await libro(ctx);
  ctx.log(
    `libro tras el rearme: ${JSON.stringify(
      alFinal.map((s) => ({ q: s.prompt.slice(0, 18), ready: s.ready, failed: s.failed })),
    )}`,
  );
  await ctx.shot("tras-el-rearme-vuelven-los-saltados");

  if (ocurrio) {
    ctx.expect(
      "…y el motor falso les sirvió hojas de verdad: no es un verde de contabilidad interna",
      plan.servidas > 0,
      `hojas servidas: ${plan.servidas} · 404 de máscara: ${plan.mascaradas}`,
    );
  }

  // Y vuelven ENTEROS, no solo la anim que se está dibujando. Sin esto el
  // aserto de arriba se conforma con `idle`, que es lo que el vecino quieto
  // tiene delante — y `modelFor` la re-encola solo. Lo que el jugador vería
  // con media recuperación es al vecino echar a andar y volver de golpe a
  // maniquí, porque su `walk` no se pidió nunca. El set automático son las
  // tres (`AUTO_SKIN_ANIMS`).
  const AUTO = ["idle", "walk", "run"];
  const aMedias = claves.filter((k) => {
    const q = alFinal.find((s) => s.prompt === k)?.queued ?? [];
    return !AUTO.every((a) => q.includes(a));
  });
  ctx.expect(
    "y vuelven ENTEROS: el set automático (idle/walk/run) se les vuelve a pedir, no solo la anim que se dibuja",
    aMedias.length === 0,
    JSON.stringify(alFinal.map((s) => ({ q: s.prompt.slice(0, 18), queued: s.queued }))),
  );
  ctx.expect(
    "el registro no anuncia un segundo apagón: rearmar no vuelve a fundir el fusible por su cuenta",
    ((await registro(ctx)).match(new RegExp(APAGADO.source, "g")) ?? []).length === 1,
    JSON.stringify(((await registro(ctx)).match(new RegExp(APAGADO.source, "g")) ?? []).length),
  );
}
