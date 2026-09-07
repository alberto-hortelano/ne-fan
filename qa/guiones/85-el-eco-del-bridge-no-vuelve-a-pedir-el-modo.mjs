/** El eco del bridge NO vuelve a pedir el modo: `render_mode_changed` se aplica
 *  en local y el cable no ve un segundo `set_render_mode`.
 *
 *  Escrito por QA del corte 8 de #358 (2026-09-07). Al salir de `main.ts`, el
 *  cambio de modo de gráficos quedó en `ui/modos-de-graficos.ts` con DOS verbos
 *  que se parecen y no son lo mismo: `cambiarFaceta` (el chip: pide al bridge
 *  con sesión, o escribe `localStorage` sin ella, y luego aplica) y
 *  `aplicarFaceta` (el eco `render_mode_changed`: ya viene decidido y
 *  persistido, así que SOLO se aplica). `plan-8.md` §9 avisó de lo que pasa si
 *  alguien los funde: cada eco pediría OTRO `set_render_mode`, el bridge lo
 *  rechazaría («la partida ya tiene los personajes en modo image») y el
 *  jugador vería un aviso rojo cada vez que toca el chip — o cada vez que OTRO
 *  cliente de su partida lo toca. El ingeniero lo rompió a propósito y los
 *  guiones 51 y 53 siguieron VERDES: ninguno cuenta lo que sale por el socket.
 *
 *  QUÉ SE CUENTA Y DÓNDE. Los frames del socket del juego, DENTRO de la página
 *  (un `addInitScript` envuelve `WebSocket` antes de recargar): los
 *  `set_render_mode` que salen, los `render_mode_set`/`render_mode_changed`
 *  que entran, y cuántos `input` (uno por frame) llevaba el socket cuando llegó
 *  cada eco. Ese último número es el TESTIGO DE ORDEN: `bridge-client.request`
 *  envía el frame de forma síncrona, así que un re-pedido nacido en el handler
 *  del eco estaría en el libro ANTES del siguiente `input`; esperar a que el
 *  socket haya enviado dos `input` más tras el eco es esperar por ESTADO a que
 *  ese hueco esté cerrado, no dormir.
 *
 *  Tres bloques, en una partida real del motor falso:
 *
 *   1 · El CHIP pide UNA vez. Personajes OFF→ON (armar y confirmar): sale
 *       exactamente un `set_render_mode`, vuelve un `render_mode_set ok:true`
 *       y el propio eco `render_mode_changed`; tras el eco sigue habiendo UN
 *       solo pedido, cero rechazos y nada de `graphics-mode` en el registro de
 *       errores. Y el OFF→ON re-pide los skins de lo ya en escena (POST a
 *       `/skin_sprite_sheet` del motor falso, cero créditos).
 *   2 · El eco de OTRO CLIENTE se aplica en local sin pedir nada. Un segundo
 *       socket (desde node, como `borrarSaveComoOtroCliente`) pide personajes →
 *       maqueta; la página recibe el eco, el chip pasa a «Personajes base», y
 *       el libro sigue con UN `set_render_mode`: el que salió del chip en 1.
 *   3 · Lo mismo con la otra faceta: escenarios → maqueta desde el otro
 *       cliente. El registro del juego dice «Gráficos: maqueta 3D…», el chip
 *       «Maqueta 3D», y el cable sigue con un solo pedido.
 *
 *  PROBADO EN NEGATIVO (2026-09-07), un sabotaje por vez y restaurado:
 *   · `aplicarFaceta` → `void cambiarFaceta(facet, mode)` en el módulo (la
 *     fusión que §9 temía): el bloque 1 se pone rojo con DOS `set_render_mode`
 *     y un `render_mode_set ok:false`.
 *   · el handler de `main.ts` ignora el eco (`return`): el bloque 2 expira
 *     esperando el chip en «Personajes base» — el eco de otro cliente ya no
 *     llega al jugador.
 *
 *  Cero créditos: motor falso del runner; la faceta que se enciende es la de
 *  personajes y las hojas las sirve el falso. `aisla: ["saves"]`: la partida
 *  nace con los modos del título, no con los de otro guion.
 */
import { comenzar, esperarRegistro, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";

export const aisla = ["saves"];

const GAME_ID = "alta_fantasia";
/** Cuántos `input` más tiene que haber enviado el socket tras un eco para dar
 *  por cerrado el hueco en el que un re-pedido habría salido. */
const FRAMES_DE_TESTIGO = 2;

/** El libro de frames que la página lleva desde antes de cargar el juego. */
const libro = (ctx) => ctx.page.evaluate(() => window.__qa85);

/** El registro de errores tal y como lo lee el jugador. */
const erroresDelJugador = (ctx) =>
  ctx.page.evaluate(() => document.getElementById("error-log")?.textContent ?? "");

/** Lo que el chip dice de cada faceta (su `title`), o `null` si no está. */
const chip = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("gfx-chip");
    return el ? { hidden: el.hidden, text: el.textContent, title: el.title } : null;
  });

/** Pide un cambio de modo al bridge como OTRO cliente de la partida: un
 *  socket propio, desde node, contra el gateway que la página usa de verdad.
 *  Devuelve el `render_mode_set` con que contesta el bridge. Sin sleep: si el
 *  bridge cierra sin contestar, se rechaza (mismo molde que
 *  `borrarSaveComoOtroCliente`). */
async function otroClientePide(ctx, sessionId, facet, renderMode) {
  const url = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    let contestado = false;
    ws.onerror = () => rej(new Error(`no se pudo abrir ${url} como segundo cliente`));
    ws.onclose = () => {
      if (!contestado) rej(new Error(`${url} se cerró sin contestar al set_render_mode del otro cliente`));
    };
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: "set_render_mode", requestId: "qa-85", sessionId, facet, renderMode }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
      if (m.type !== "render_mode_set" || m.requestId !== "qa-85") return;
      contestado = true;
      ws.close();
      res(m);
    };
  });
}

/** Espera al eco número `n` de la faceta dada Y a que el socket haya enviado
 *  `FRAMES_DE_TESTIGO` inputs más desde que llegó: a partir de ahí, un
 *  re-pedido nacido en ese eco ya estaría en el libro. Devuelve el libro. */
const esperarEcoCerrado = (ctx, desc, facet, n) =>
  esperarRegistro(
    ctx,
    desc,
    "__qa85",
    ([f, k, testigo]) => {
      const l = window.__qa85;
      const ecos = l.recibidos.filter((m) => m.type === "render_mode_changed" && m.facet === f);
      if (ecos.length < k) return null;
      return l.inputs - ecos[k - 1].inputsAlLlegar >= testigo ? l : null;
    },
    60_000,
    [facet, n, FRAMES_DE_TESTIGO],
  );

const pedidos = (l) => l.enviados.filter((m) => m.type === "set_render_mode");
const rechazos = (l) => l.recibidos.filter((m) => m.type === "render_mode_set" && m.ok === false);
const aceptados = (l) => l.recibidos.filter((m) => m.type === "render_mode_set" && m.ok === true);

export default async function (ctx) {
  // ── El libro de frames, puesto ANTES de que el juego abra su socket ──────
  await ctx.page.addInitScript(() => {
    const libro = { enviados: [], recibidos: [], inputs: 0 };
    window.__qa85 = libro;
    const Original = window.WebSocket;
    const send = Original.prototype.send;
    const DE_INTERES = new Set(["set_render_mode", "render_mode_set", "render_mode_changed"]);
    Original.prototype.send = function (data) {
      try {
        const m = JSON.parse(String(data));
        if (m.type === "input") libro.inputs++;
        else if (DE_INTERES.has(m.type)) libro.enviados.push(m);
      } catch (err) {
        // Un frame que no es JSON no es del protocolo del bridge: se deja
        // pasar y se anota, que un libro mudo se ve igual que uno que mide.
        libro.enviados.push({ type: "ilegible", error: String(err).slice(0, 60) });
      }
      return send.call(this, data);
    };
    const Envuelto = function (url, protocols) {
      const ws = protocols === undefined ? new Original(url) : new Original(url, protocols);
      ws.addEventListener("message", (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          if (DE_INTERES.has(m.type)) libro.recibidos.push({ ...m, inputsAlLlegar: libro.inputs });
        } catch (err) {
          libro.recibidos.push({ type: "ilegible", error: String(err).slice(0, 60) });
        }
      });
      return ws;
    };
    Envuelto.prototype = Original.prototype;
    Object.assign(Envuelto, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Envuelto;
  });
  await recargarAlTitulo(ctx);

  /** Cada POST de skin que sale hacia el motor falso (prompt, anim). */
  const posts = [];
  ctx.page.on("request", (req) => {
    if (req.method() !== "POST" || !/\/skin_sprite_sheet(\?|$)/.test(req.url())) return;
    let cuerpo = {};
    try {
      cuerpo = JSON.parse(req.postData() ?? "{}");
    } catch (err) {
      cuerpo = { ilegible: String(err).slice(0, 60) };
    }
    posts.push({ prompt: String(cuerpo.prompt ?? "").slice(0, 40), anim: cuerpo.anim ?? null });
  });

  // Personajes en BASE desde el título: el OFF→ON del bloque 1 es del jugador.
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  const { sessionId } = await comenzar(ctx);
  const facetas = await ctx.nefan("sesion");
  ctx.log(`facetas al entrar: renderMode=${facetas.renderMode} characterMode=${facetas.characterMode}`);
  ctx.expect(
    "precondición: la partida nace con personajes en base (el toggle del título)",
    facetas.characterMode === "vector",
    JSON.stringify(facetas),
  );
  const antes = await libro(ctx);
  ctx.expect(
    "precondición: el libro de frames está en pie y sin un solo set_render_mode al entrar",
    Boolean(antes) && pedidos(antes).length === 0 && antes.inputs > 0,
    JSON.stringify({ pedidos: antes && pedidos(antes).length, inputs: antes?.inputs }),
  );
  const chip0 = await chip(ctx);
  ctx.expect(
    "el chip se ve en partida y dice «Personajes base»",
    chip0 !== null && !chip0.hidden && /personajes: Personajes base/.test(chip0.title),
    JSON.stringify(chip0),
  );

  // ── 1 · El chip pide UNA vez, y el eco de su propio pedido no vuelve a pedir ─
  await ctx.page.click("#gfx-chip");
  const encender = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /personaje/i })
    .locator(".gfx-seg button")
    .first();
  await encender.waitFor({ state: "visible", timeout: 10_000 });
  await encender.click(); // arma: «¿Confirmar? Gastará créditos»
  const armado = await encender.locator(".gfx-label").textContent();
  ctx.expect("encender personajes pide confirmación en dos clicks", /Confirmar/.test(armado ?? ""), armado ?? "");
  await encender.click(); // confirma

  const l1 = await esperarEcoCerrado(
    ctx,
    "llega el eco del propio pedido (render_mode_changed characters) y el socket sigue enviando frames",
    "characters",
    1,
  );
  ctx.log(
    `tras el chip: set_render_mode=${pedidos(l1).length} · render_mode_set ok=${aceptados(l1).length} ` +
      `ko=${rechazos(l1).length} · ecos=${l1.recibidos.filter((m) => m.type === "render_mode_changed").length}`,
  );
  ctx.expect(
    "el chip mandó EXACTAMENTE un set_render_mode (characters → image)",
    pedidos(l1).length === 1 && pedidos(l1)[0].facet === "characters" && pedidos(l1)[0].renderMode === "image",
    JSON.stringify(pedidos(l1)),
  );
  ctx.expect(
    "el bridge lo aceptó una vez y no rechazó nada: el eco NO se re-pidió",
    aceptados(l1).length === 1 && rechazos(l1).length === 0,
    JSON.stringify(l1.recibidos),
  );
  const chip1 = await chip(ctx);
  ctx.expect(
    "el chip dice «Skins IA» tras aplicar el eco",
    chip1 !== null && /personajes: Skins IA/.test(chip1.title),
    JSON.stringify(chip1),
  );
  const skins = await esperarRegistro(
    ctx,
    "el OFF→ON re-pide los skins de lo ya en escena y el motor falso contesta",
    "skins",
    () => {
      const l = window.__nefan.skins;
      return l.some((s) => s.ready.length > 0 || s.failed) ? l : null;
    },
    90_000,
  );
  ctx.log(`libro de skins: ${JSON.stringify(skins.map((s) => ({ p: s.prompt.slice(0, 30), ready: s.ready.length, failed: s.failed })))}`);
  ctx.log(`POST /skin_sprite_sheet: ${posts.length} · ${JSON.stringify(posts.slice(0, 6))}`);
  ctx.expect(
    "…y esos skins salieron por el cable: al menos un POST a /skin_sprite_sheet",
    posts.length > 0,
    `${posts.length} POST`,
  );
  await ctx.shot("chip-personajes-on");

  // ── 2 · El eco de OTRO cliente se aplica en local y no produce ningún pedido ─
  const respuesta2 = await otroClientePide(ctx, sessionId, "characters", "vector");
  ctx.expect(
    "precondición: el bridge aceptó el cambio del otro cliente (personajes → maqueta)",
    respuesta2.ok === true,
    JSON.stringify(respuesta2),
  );
  const l2 = await esperarEcoCerrado(
    ctx,
    "la página recibe el eco del otro cliente (segundo render_mode_changed characters) y sigue enviando frames",
    "characters",
    2,
  );
  const chip2 = await ctx.waitFor(
    "el chip pasa a «Personajes base» por el eco del otro cliente",
    () => {
      const el = document.getElementById("gfx-chip");
      return el && /personajes: Personajes base/.test(el.title) ? { text: el.textContent, title: el.title } : null;
    },
    20_000,
  );
  ctx.log(`chip tras el eco ajeno: ${JSON.stringify(chip2)}`);
  ctx.expect(
    "el eco ajeno NO produjo ningún set_render_mode: el libro sigue con el único del chip",
    pedidos(l2).length === 1,
    JSON.stringify(pedidos(l2)),
  );
  ctx.expect(
    "…ni ningún rechazo del bridge",
    rechazos(l2).length === 0,
    JSON.stringify(rechazos(l2)),
  );

  // ── 3 · La otra faceta por el mismo camino: escenarios → maqueta ─────────
  const respuesta3 = await otroClientePide(ctx, sessionId, "scenes", "vector");
  ctx.expect(
    "precondición: el bridge aceptó el cambio del otro cliente (escenarios → maqueta)",
    respuesta3.ok === true,
    JSON.stringify(respuesta3),
  );
  const l3 = await esperarEcoCerrado(
    ctx,
    "la página recibe el eco de escenarios (render_mode_changed scenes) y sigue enviando frames",
    "scenes",
    1,
  );
  const maqueta = await ctx.waitFor(
    "el registro del juego dice «Gráficos: maqueta 3D…» por el eco ajeno",
    () => document.body.innerText.match(/Gráficos: maqueta 3D[^\n]*/)?.[0] ?? null,
    20_000,
  );
  ctx.log(`registro: ${maqueta}`);
  const chip3 = await chip(ctx);
  ctx.expect(
    "el chip dice «Maqueta 3D» con las dos facetas en maqueta",
    chip3 !== null && /escenarios: Maqueta 3D/.test(chip3.title) && /Maqueta 3D/.test(chip3.text ?? ""),
    JSON.stringify(chip3),
  );
  ctx.expect(
    "tampoco este eco pidió nada: un solo set_render_mode en toda la partida",
    pedidos(l3).length === 1 && rechazos(l3).length === 0,
    JSON.stringify({ pedidos: pedidos(l3), rechazos: rechazos(l3) }),
  );
  const errores = await erroresDelJugador(ctx);
  ctx.expect(
    "el registro de errores no tiene ninguna entrada de graphics-mode (ningún «ya en ese modo»)",
    !/graphics-mode|ya tiene los (personajes|escenarios) en modo/.test(errores),
    errores.replace(/\s+/g, " ").slice(0, 300),
  );
  await ctx.shot("todo-en-maqueta-por-el-otro-cliente");
}
