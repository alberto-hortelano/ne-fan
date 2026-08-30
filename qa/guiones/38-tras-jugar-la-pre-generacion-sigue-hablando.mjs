/** #312 y #313: que la barra de PRE-GENERACIÓN DE MUNDO del título hable, que
 *  hable después de haber jugado, y que hable de la tarjeta que le toca.
 *
 *  POR QUÉ EXISTE. #312 puso un embudo que reparte `narrative_status`, y hasta
 *  #313 ese reparto tenía que hacer una EXCEPCIÓN POR KIND: la pre-generación
 *  iba al título sin mirar el sello, porque el sello lo estampaba el transporte
 *  con «la sesión que el bridge tiene activa al emitir» y una pre-generación no
 *  tiene sesión propia. Después de jugar, el cliente vuelve al título con sesión
 *  `""` mientras el bridge sigue con la suya, así que ese mensaje llegaba
 *  SIEMPRE con sello ajeno y filtrarlo dejaba la tarjeta girando para siempre.
 *
 *  #313 quitó la excepción cambiando el mensaje en vez del filtro: la
 *  pre-generación viaja con `gameId` y sin sello (`NarrativeStatusDeJuego`), y
 *  el reparto se hace por QUÉ IDENTIFICADOR trae. Este guion es lo que impide
 *  que ese cambio rompa el caso que #312 arregló, y lo que afirma lo que #313
 *  compró.
 *
 *  TRES MEDIDAS, y las tres hacen falta:
 *   · el camino REAL — se juega, se vuelve al título y se pre-genera el mundo:
 *     la barra tiene que llegar a `ready` (bloque 3);
 *   · el ESTADO del que se juega — que el cliente esté de verdad en sesión `""`
 *     con el bridge cargado, o el bloque 3 mediría un caso fácil (bloque 1);
 *   · el caso A/B, determinista — con el mundo de A generándose y la tarjeta de
 *     B delante, la línea de B NO habla de A, y al volver a A sí (bloque 2).
 *     Es el único síntoma de jugador de #313 y estaba reproducido en dos
 *     clicks: `#ts-gen-progress` decía «Mundo de Miravanda generado» bajo la
 *     tarjeta de Valdesombra. Se ejerce por INYECCIÓN y no generando dos mundos
 *     de verdad porque el síntoma es del reparto y del pintado, no del motor:
 *     así es determinista, instantáneo y no depende de dos jobs en vuelo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { comenzar, nuevaPartida, recargarAlTitulo, regenerarMundo } from "../lib/sesion.mjs";

/** El otro juego: la tarjeta que el jugador tiene delante mientras se genera
 *  el mundo de `alta_fantasia`. */
const JUEGO_B = "cuentos_oscuros";

export const aisla = ["saves", "fake-ai"];

/** Espía los `narrative_status` que ENTRAN, con su direccionamiento, sin tocar
 *  el cliente: se envuelve el constructor de WebSocket y se añade un segundo
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
            window.__qaStatus.push({
              kind: m.kind,
              phase: m.phase,
              sessionId: m.sessionId ?? null,
              gameId: m.gameId ?? null,
            });
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

/** Lo que se lee de la línea de progreso de la tarjeta que está en pantalla.
 *  Se ejecuta DENTRO de la página, así que va como cadena de `evaluate` y no
 *  como función del guion. */
const laLinea = (ctx) =>
  ctx.page.evaluate(() => {
    const linea = document.getElementById("ts-gen-progress");
    return { texto: linea?.textContent ?? "", fase: linea?.dataset.genPhase ?? null };
  });

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

  // ── 2 · El caso A/B, determinista ───────────────────────────────────────
  // Se abre el selector de mundos (ahí vive `#ts-gen-progress`), se deja
  // SELECCIONADA la tarjeta de B y se entrega el progreso del mundo A por donde
  // entra el del bridge.
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click(`[data-game-id="${JUEGO_B}"]`);
  // El div existe vacío y sin alto hasta que hay progreso: se espera a que
  // esté EN EL DOM, no a que se vea.
  await ctx.page.waitForSelector("#ts-gen-progress", { state: "attached", timeout: 30_000 });

  const antes = await laLinea(ctx);
  const descartados = await ctx.page.evaluate(() => {
    const vivos = (window.__qaSockets ?? []).filter(
      (s) => typeof s.onmessage === "function" && s.readyState === WebSocket.OPEN,
    );
    if (vivos.length === 0) throw new Error("ningún socket del bridge donde entregar");
    vivos[vivos.length - 1].onmessage({
      data: JSON.stringify({
        type: "narrative_status",
        phase: "progress",
        kind: "game_gen",
        gameId: "alta_fantasia",
        message: "PRE-GENERACION DE MIRAVANDA",
      }),
    });
    return window.__nefan.descartados();
  });
  const conBDelante = await laLinea(ctx);
  ctx.log(
    `línea con la tarjeta de ${JUEGO_B} delante: antes=${JSON.stringify(antes)} · ` +
      `después=${JSON.stringify(conBDelante)}`,
  );
  ctx.expect(
    `el progreso del mundo A NO se pinta en la tarjeta de ${JUEGO_B} (#313, el único síntoma de jugador)`,
    !conBDelante.texto.includes("PRE-GENERACION DE MIRAVANDA"),
    JSON.stringify(conBDelante),
  );
  ctx.expect(
    "…y no se contó como descartado: la pre-generación no es de nadie y por eso no se filtra",
    descartados.status === 0,
    JSON.stringify(descartados),
  );

  // Y el CONTROL, que es lo que hace que el aserto de arriba no sea un verde
  // vacío: al seleccionar la tarjeta de A, su progreso está ahí. Sin esto,
  // «no se pinta en B» y «no se pinta en ninguna parte» serían el mismo verde.
  await ctx.page.click('[data-game-id="alta_fantasia"]');
  const conADelante = await laLinea(ctx);
  ctx.log(`con la tarjeta de alta_fantasia delante: ${JSON.stringify(conADelante)}`);
  ctx.expect(
    "…y SÍ se pinta al volver a la tarjeta del juego que se está generando",
    conADelante.texto.includes("PRE-GENERACION DE MIRAVANDA") && conADelante.fase === "progress",
    JSON.stringify(conADelante),
  );
  await ctx.page.click("#ts-back");

  // ── 3 · El camino real: pre-generar el mundo después de haber jugado ────
  // `regenerarMundo` afirma por su cuenta que la barra llega a `ready` y sin
  // fallos parciales. Lo que este guion añade es el ESTADO en el que se hace:
  // con el bridge todavía cargado con la partida del bloque 1.
  await regenerarMundo(ctx, "alta_fantasia");

  const vistos = await ctx.page.evaluate(() => window.__qaStatus.filter((s) => s.kind === "game_gen"));
  ctx.log(`game_gen reales vistos: ${vistos.length} · ${JSON.stringify(vistos.slice(0, 3))}`);
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
  // Lo que #313 cambió EN EL CABLE, medido sobre los frames de verdad y no
  // sobre el inyectado: cada uno dice de qué JUEGO es, y ninguno trae sello de
  // sesión — que era el campo cuyo valor no significaba nada aquí.
  ctx.expect(
    "cada `game_gen` real dice de qué juego es, y NINGUNO trae sello de sesión",
    vistos.every((s) => s.gameId === "alta_fantasia" && s.sessionId === null),
    JSON.stringify([...new Set(vistos.map((s) => `${s.gameId}/${s.sessionId}`))]),
  );
  await ctx.shot("la-pre-generacion-tras-haber-jugado");
}
