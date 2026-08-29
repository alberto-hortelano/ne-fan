/** #312, la mitad que el filtro pudo romper y ningún guion vigilaba: que la
 *  barra de PRE-GENERACIÓN DE MUNDO del título siga viva después de haber
 *  jugado.
 *
 *  POR QUÉ EXISTE. #312 puso un embudo que reparte `narrative_status` por
 *  sello, y el sello NO dice quién pidió el trabajo: lo estampa el transporte
 *  con «la sesión que el bridge tiene activa al emitir» (`bridge/ws-server.ts`,
 *  y hay issue abierto por ello). Después de jugar, el cliente vuelve al título
 *  con sesión `""` mientras el bridge sigue con la partida cargada, así que la
 *  pre-generación llega SIEMPRE con sello ajeno. Por eso `destinoDeStatus`
 *  manda `kind:"game_gen"` al título SIN mirar el sello — y esa regla es la
 *  única cosa entre el arreglo de #312 y una tarjeta girando para siempre.
 *
 *  El plan de la tanda la nombró como su riesgo número 1 y el test de core
 *  afirma la REGLA (`destinoDeStatus` no pregunta el sello). Lo que no había
 *  era nadie que lo ejerciera en el juego real, que es donde el sello lo pone
 *  el bridge de verdad y no la tabla de un test.
 *
 *  DOS MEDIDAS, y las dos hacen falta:
 *   · el camino REAL — se juega, se vuelve al título y se pre-genera el mundo:
 *     la barra tiene que llegar a `ready`;
 *   · el caso EXTREMO, determinista — se entrega a mano un `game_gen` con un
 *     sello inequívocamente ajeno, y la línea del título tiene que pintarlo.
 *     Sin esto, si en el banco el bridge soltara la sesión al desconectarse el
 *     cliente, el sello llegaría vacío, el reparto lo daría por propio y el
 *     verde no diría nada del caso que el issue teme.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { comenzar, nuevaPartida, recargarAlTitulo, regenerarMundo } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

/** Un sello que no puede ser el de nadie vivo. */
const OTRO_ARRANQUE = "sesion-de-otro-arranque-1234";

/** Espía los `narrative_status` que ENTRAN, con su sello, sin tocar el
 *  cliente: se envuelve el constructor de WebSocket y se añade un segundo
 *  oyente (`addEventListener`), que convive con el `onmessage` que asigna
 *  `bridge-client.ts`. Se instala antes de que cargue la app y sobrevive a las
 *  navegaciones. */
async function espiarLosStatus(ctx) {
  await ctx.page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__qaStatus = [];
    window.__qaSockets = [];
    const Envuelto = function (...args) {
      const sock = new Original(...args);
      window.__qaSockets.push(sock);
      sock.addEventListener("message", (ev) => {
        try {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type === "narrative_status") {
            window.__qaStatus.push({ kind: m.kind, phase: m.phase, sessionId: m.sessionId ?? null });
          }
        } catch {
          /* un frame que no es JSON no es cosa de este espía */
        }
      });
      return sock;
    };
    Envuelto.prototype = Original.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Envuelto[k] = Original[k];
    window.WebSocket = Envuelto;
  });
}

export default async function (ctx) {
  await espiarLosStatus(ctx);
  await recargarAlTitulo(ctx);

  // ── 1 · Se juega: el bridge se queda con una partida cargada ────────────
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const partida = await comenzar(ctx);
  ctx.log(`se jugó la partida ${partida.sessionId}`);

  // Volver al título recargando es el camino que tiene el jugador (el botón
  // «Volver al título» del overlay solo aparece cuando no hay mundo). El
  // cliente queda en sesión "" y el bridge sigue con la suya.
  await recargarAlTitulo(ctx);
  const sesionDelCliente = await ctx.page.evaluate(() => window.__nefan.sesion().sessionId);
  ctx.expect(
    "tras volver al título el cliente NO tiene partida (es el estado del riesgo)",
    sesionDelCliente === "",
    `sesión del cliente: "${sesionDelCliente}"`,
  );

  // ── 2 · El caso extremo, determinista ───────────────────────────────────
  // Se abre el selector de mundos (ahí vive `#ts-gen-progress`) y se entrega
  // un `game_gen` con sello ajeno por donde entra el del bridge.
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click('[data-game-id="alta_fantasia"]');
  // El div existe vacío y sin alto hasta que hay progreso: se espera a que
  // esté EN EL DOM, no a que se vea.
  await ctx.page.waitForSelector("#ts-gen-progress", { state: "attached", timeout: 30_000 });

  const inyectado = await ctx.page.evaluate((sello) => {
    const vivos = (window.__qaSockets ?? []).filter(
      (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
    );
    if (vivos.length === 0) throw new Error("ningún socket del bridge donde entregar");
    const linea = () => document.getElementById("ts-gen-progress");
    const antes = { texto: linea()?.textContent ?? "", fase: linea()?.dataset.genPhase ?? null };
    vivos[vivos.length - 1].onmessage({
      data: JSON.stringify({
        type: "narrative_status",
        sessionId: sello,
        phase: "generating",
        kind: "game_gen",
        message: "PRE-GENERACION DE OTRO ARRANQUE",
      }),
    });
    return {
      antes,
      despues: { texto: linea()?.textContent ?? "", fase: linea()?.dataset.genPhase ?? null },
      descartados: window.__nefan.descartados(),
    };
  }, OTRO_ARRANQUE);
  ctx.log(`game_gen con sello ajeno: ${JSON.stringify(inyectado)}`);
  ctx.expect(
    "un `game_gen` con sello AJENO llega igual a la barra del título (#312, la rama que no se puede quitar)",
    inyectado.despues.texto.includes("PRE-GENERACION DE OTRO ARRANQUE") &&
      inyectado.despues.fase === "generating",
    JSON.stringify(inyectado),
  );
  ctx.expect(
    "…y no se contó como descartado: la pre-generación no es de nadie y por eso no se filtra",
    inyectado.descartados.status === 0,
    JSON.stringify(inyectado.descartados),
  );
  await ctx.page.click("#ts-back");

  // ── 3 · El camino real: pre-generar el mundo después de haber jugado ────
  // `regenerarMundo` afirma por su cuenta que la barra llega a `ready` y sin
  // fallos parciales. Lo que este guion añade es el ESTADO en el que se hace:
  // con el bridge todavía cargado con la partida de arriba.
  await regenerarMundo(ctx, "alta_fantasia");

  const vistos = await ctx.page.evaluate(() => window.__qaStatus.filter((s) => s.kind === "game_gen"));
  const sellos = [...new Set(vistos.map((s) => s.sessionId))];
  ctx.log(`game_gen reales vistos: ${vistos.length} · sellos: ${JSON.stringify(sellos)}`);
  ctx.expect(
    "llegaron `game_gen` de verdad por el cable (si no, el bloque 3 no midió el reparto)",
    vistos.length > 0,
    `${vistos.length} frames`,
  );
  ctx.expect(
    "…y la pre-generación terminó con la barra en `ready`, no girando para siempre",
    vistos.some((s) => s.phase === "ready"),
    JSON.stringify(vistos.map((s) => s.phase)),
  );
  await ctx.shot("la-pre-generacion-tras-haber-jugado");
}
