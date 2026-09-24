/** LAS OTRAS PANTALLAS DEL TÍTULO QUE PINTABAN TARDE, encima de la pantalla a
 *  la que el jugador ya se había ido (#731, tanda BB).
 *
 *  El 198 mide el refresco del selector tras una pre-generación. Esto mide
 *  los otros pintados del título que escriben DESPUÉS de un `await`. Todos se
 *  hacen la misma pregunta —«¿sigue siendo esta pantalla la que el jugador
 *  tiene pedida?»—, que vive en un solo sitio: el turno de `title-screen.ts`.
 *
 *   E · EL EDITOR tras el censo de hojas. «Continuar» pide el editor, que
 *       espera a `/sprites/index.json` con el selector todavía pintado. Si el
 *       jugador pulsa «Volver» en esa ventana, el home se pinta y, al llegar el
 *       censo, el editor lo aplastaba.
 *   H1 · EL HOME tras BORRAR una partida. `deleteSession` y después
 *       `pintarHome` directo: si el jugador ya ha pulsado «Nueva partida», el
 *       home se repintaba encima del selector.
 *   H2 · EL HOME tras CAMBIAR EL MODO de un save. Lo mismo con
 *       `setRenderMode`.
 *
 *  Y las VUELTAS AUTOMÁTICAS al selector que siguen a una espera larga, que
 *  arrastraban al jugador de vuelta si ya se había ido (hallazgo 2 de la QA de
 *  la tanda BB):
 *   S · «Subir estilo»: la subida deja «Volver» encendido. El jugador vuelve
 *       al selector y de ahí al home; al terminar la subida (completa, sin refs
 *       que generar) el título lo llevaba otra vez al selector. La respuesta de
 *       `/styles/upload` se escribe EN EL BORDE (`page.route`, receta del 124):
 *       el motor falso no sirve esa ruta, y así no se escribe ningún pack.
 *   P · «Aplicar estilo»: tras el comprobante hay una pausa de 1,2 s y la
 *       vuelta al selector. El jugador se va al home en esa pausa. La pausa se
 *       RETIENE (`relojes` de `retener.mjs`) y se afirma que se retuvo UNA:
 *       si el producto cambia su duración, el guion lo dice en rojo en vez de
 *       medir nada.
 *  «Crear mundo» y «Generar las refs que faltan» apagan su «Volver» mientras
 *  esperan: el jugador no puede irse, y la regla de esas dos la sujeta el
 *  unitario `nefan-html/test/el-turno-de-pantalla-caduca-al-navegar.test.ts`.
 *
 *  Misma mecánica que el 198 (`qa/lib/retener.mjs`): la respuesta se RETIENE
 *  hasta que la pantalla de destino está pintada, se suelta y, antes de
 *  afirmar, se espera a haber VISTO cada petición contestada y entregada al
 *  cliente —o el censo leído—. El orden malo se da siempre y no hay plazos.
 *  Cada bloque afirma además que la petición SALIÓ: sin eso, un cambio que
 *  dejara de pedirla pondría esto verde sin haber corrido la carrera.
 *
 *  Cero créditos: la partida que da las tarjetas del home arranca en maqueta
 *  y con personajes base contra el motor falso; el cambio de modo solo escribe
 *  el campo del save y no arranca nada; la pre-generación y el estilo de P van
 *  contra el motor falso (como el 115), y la subida de S no sale de la página.
 */
import {
  comenzar,
  esperarTituloListo,
  nuevaPartida,
  recargarAlTitulo,
  regenerarMundo,
} from "../lib/sesion.mjs";
import { clonarSaves } from "../lib/saves.mjs";
import {
  contadores,
  instrumentarRetenciones,
  pantallaDelTitulo,
  retener,
  soltarYVerResuelto,
} from "../lib/retener.mjs";

/** `saves` — las tarjetas del home tienen que ser las de ESTE guion.
 *  `mundo` y `fake-ai` — P pre-genera el mundo para poder aplicarle estilo. */
export const aisla = ["saves", "mundo", "fake-ai"];

/** La pausa entre el comprobante de «Aplicar estilo» y su vuelta al selector
 *  (`plan-de-estilo.ts`). */
const PAUSA_DEL_COMPROBANTE_MS = 1200;

/** 1×1 PNG: lo justo para que el zod del cliente deje salir la subida. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const CENSO = "/sprites/index.json";

async function abrirElSelector(ctx) {
  await esperarTituloListo(ctx);
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("#ts-gen", { timeout: 30_000 });
}

/** Resuelto el pintado tardío, ¿sigue delante la pantalla a la que se fue? */
async function afirmarQueSigue(ctx, nombre, destino, cuenta) {
  const final = await pantallaDelTitulo(ctx);
  ctx.log(`${nombre}: ${JSON.stringify(cuenta)} · pantalla final ${final}`);
  await ctx.shot(`${nombre.split(" ")[0].toLowerCase()}-${destino}`);
  ctx.expect(
    `${nombre}: resuelto el pintado tardío, la pantalla sigue siendo ${destino}`,
    final === destino,
    `pantalla final: ${final}`,
  );
  return final;
}

/** «Nueva partida» con la respuesta del home retenida: pulsa, espera al
 *  selector y lo suelta. `peticion`/`respuesta` es el par que se retuvo. */
async function aLaNuevaPartidaYSoltar(ctx, nombre, peticion, respuesta) {
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("#ts-gen", { timeout: 30_000 });
  const cuenta = await soltarYVerResuelto(ctx, { pares: [[peticion, respuesta]] });
  await afirmarQueSigue(ctx, nombre, "selector", cuenta);
}

export default async function (ctx) {
  // «Borrar» abre un `confirm()` que Playwright DESCARTA por defecto: sin esto
  // el guion mediría un borrado que nunca se pidió.
  ctx.page.on("dialog", (d) => void d.accept());
  await ctx.page.addInitScript(instrumentarRetenciones);
  await recargarAlTitulo(ctx);

  // Una partida real, y un clon barato para poder borrar sin quedarse sin
  // tarjeta para el bloque del modo (receta del 52).
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  const { sessionId } = await comenzar(ctx);
  const [paraBorrar] = clonarSaves(sessionId, 1);
  await recargarAlTitulo(ctx);

  // ── E · el editor, tras el censo de hojas ───────────────────────────────
  await abrirElSelector(ctx);
  await retener(ctx, { urls: [CENSO] });
  await ctx.page.click("#ts-continue");
  // El editor espera al censo y el selector sigue pintado: «Volver» es suyo.
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
  const e = await contadores(ctx);
  ctx.expect(
    "E · editor: «Continuar» pidió el censo y está retenido (la carrera existe)",
    e.retenidas === 1,
    JSON.stringify(e),
  );
  const cuentaE = await soltarYVerResuelto(ctx, { urls: { [CENSO]: 1 } });
  await afirmarQueSigue(ctx, "E · editor", "home", cuentaE);
  await recargarAlTitulo(ctx);

  // ── H1 · el home, tras borrar una partida ───────────────────────────────
  await retener(ctx, { tipos: ["session_deleted"] });
  const antesH1 = (await contadores(ctx)).pedidas.delete_session ?? 0;
  await ctx.page.click(`button[data-action=delete][data-session-id="${paraBorrar}"]`);
  const pedidaH1 = await ctx.waitFor(
    "el borrado sale por el cable",
    (antes) => ((window.__qaRet.pedidas.delete_session ?? 0) > antes ? true : null),
    30_000,
    antesH1,
  );
  ctx.expect("H1 · borrar: el delete_session salió y su respuesta está retenida", pedidaH1 === true);
  await aLaNuevaPartidaYSoltar(ctx, "H1 · borrar", "delete_session", "session_deleted");
  await recargarAlTitulo(ctx);

  // ── H2 · el home, tras cambiar el modo de un save ───────────────────────
  // La partida está en maqueta: encender Imagen IA es un armado en DOS clics
  // (el primero pregunta). Se retiene antes del segundo, que es el que pide.
  const badge = `button[data-mode-facet="scenes"][data-session-id="${sessionId}"]`;
  await ctx.page.click(badge);
  await retener(ctx, { tipos: ["render_mode_set"] });
  const antesH2 = (await contadores(ctx)).pedidas.set_render_mode ?? 0;
  await ctx.page.click(badge);
  const pedidaH2 = await ctx.waitFor(
    "el cambio de modo sale por el cable",
    (antes) => ((window.__qaRet.pedidas.set_render_mode ?? 0) > antes ? true : null),
    30_000,
    antesH2,
  );
  ctx.expect("H2 · modo: el set_render_mode salió y su respuesta está retenida", pedidaH2 === true);
  await aLaNuevaPartidaYSoltar(ctx, "H2 · modo", "set_render_mode", "render_mode_set");

  await recargarAlTitulo(ctx);

  // ── S · la vuelta automática tras SUBIR un estilo ──────────────────────
  await ctx.page.route("**/styles/upload", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        style_id: "tanda_bb_199",
        uploaded: ["torre"],
        missing: [],
        estimated_cost_usd: 0,
      }),
    }),
  );
  await abrirElSelector(ctx);
  await ctx.page.click("#ts-upload-style");
  await ctx.page.waitForSelector("#ts-style-name", { timeout: 15_000 });
  await ctx.page.fill("#ts-style-name", "Tinta y pergamino");
  await ctx.page.fill("#ts-style-tags-free", "medieval");
  await ctx.page.setInputFiles("[data-file]", { name: "torre.png", mimeType: "image/png", buffer: PNG_1x1 });
  await ctx.page.fill("[data-desc]", "una torre de piedra al atardecer");
  await retener(ctx, { urls: ["/styles/upload"] });
  await ctx.page.click("#ts-upload");
  const subida = await ctx.waitFor(
    "la subida sale y queda retenida",
    () => (window.__qaRet.fetchRetenidos.length > 0 ? true : null),
    30_000,
  );
  ctx.expect("S · subir estilo: la subida salió y está retenida (la carrera existe)", subida === true);
  // «Volver» de «Subir estilo» lleva al selector; de ahí, «Volver» al home.
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("#ts-gen", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
  const cuentaS = await soltarYVerResuelto(ctx, {
    urls: { "/styles/upload": 1 },
    pares: [["list_games", "games_listed"]],
  });
  await afirmarQueSigue(ctx, "S · subir estilo", "home", cuentaS);
  await ctx.page.unroute("**/styles/upload");
  await recargarAlTitulo(ctx);

  // ── P · la vuelta automática tras APLICAR un estilo ────────────────────
  // `regenerarMundo` deja el título en el home con el mundo pre-generado.
  await regenerarMundo(ctx, "alta_fantasia");
  await abrirElSelector(ctx);
  await ctx.page.click('[data-game-id="alta_fantasia"]');
  await ctx.page.click("#ts-apply-style");
  await ctx.page.waitForSelector("#ts-style-run", { timeout: 60_000 });
  const ejecutable = await ctx.page.evaluate(() => {
    const b = document.getElementById("ts-style-run");
    return b ? { disabled: b.disabled, texto: (b.textContent ?? "").trim() } : null;
  });
  ctx.log(`P · botón de aplicar: ${JSON.stringify(ejecutable)}`);
  if (!ejecutable || ejecutable.disabled) {
    ctx.sinMedirBloque(
      `P · el plan no deja aplicar nada (${JSON.stringify(ejecutable)}): sin comprobante no hay vuelta automática que medir`,
    );
    return;
  }
  await retener(ctx, { relojes: [PAUSA_DEL_COMPROBANTE_MS] });
  await ctx.page.click("#ts-style-run");
  const comprobante = await ctx.waitFor(
    "el estilo se aplica y la vuelta al selector queda en su pausa, retenida",
    () =>
      window.__qaRet.relojRetenidos.length > 0
        ? (document.getElementById("ts-style-progress")?.textContent ?? "").trim()
        : null,
    240_000,
  );
  ctx.log(`P · comprobante: «${comprobante}»`);
  const pausas = (await contadores(ctx)).relojesRetenidos;
  ctx.expect(
    `P · aplicar estilo: hay UNA pausa de ${PAUSA_DEL_COMPROBANTE_MS} ms retenida entre el comprobante y la vuelta`,
    pausas === 1 && /Estilo aplicado/.test(comprobante),
    `pausas ${pausas} · «${comprobante}»`,
  );
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
  const cuentaP = await soltarYVerResuelto(ctx, { pares: [["list_games", "games_listed"]] });
  await afirmarQueSigue(ctx, "P · aplicar estilo", "home", cuentaP);
}
