/** EL CABLE DISTINGUE EL RECHAZO DEL INTAKE DE LO DEMÁS QUE LE LLEGA (#694,
 *  QA de la tanda AQ).
 *
 *  El 171 mide la mitad que el issue nombra: un frame rechazado por el intake
 *  LANZA ya. Este guion mide las tres cosas que la implementación afirma y que
 *  el 171 no toca, contra el bridge REAL y no contra el socket falso de
 *  `nefan-core/test/cable-de-qa.test.ts`:
 *
 *   **1 · Un error DIFUNDIDO de otro `kind` NO corta la espera.** Nueve de los
 *   quince clientes migrados mandan `start_session`/`resume_session`, que
 *   SUSCRIBEN el socket (`bridge/handlers/session.ts`): les llegan las
 *   difusiones de la partida, entre ellas `narrative_status/error` de `kind:
 *   "tile"`. Si el helper las tomase por rechazo, un guion cuyo tile vecino
 *   falla vería «el bridge RECHAZÓ el frame» sobre un `start_session` que el
 *   bridge aceptó. Receta: motor falso en `mode:"error"` (`POST /dev/tiles`,
 *   #516; el bootstrap está exento en el fake, así que la partida nace); un
 *   cable `start_session` que espera un tipo que NUNCA llega (techo 6 s) y
 *   queda suscrito; cuando el motor falso ha servido el bootstrap de esa
 *   partida (`/generate_scene` en `/dev/counters`; `aisla` lleva `mundo`
 *   porque con el snapshot pasivo del bridge la segunda partida del juego no
 *   se lo pediría) —que el bridge encola DESPUÉS de suscribir, así que es la
 *   prueba de que el cable ya oye—, OTRO cable pide el tile (1,0) por `porElCable`,
 *   el fake lo tira y el bridge difunde el error de `kind:"tile"`. Se afirma
 *   que ese error llegó a un cable abierto (si no, el bloque no mide nada), y
 *   que el cable suscrito AGOTÓ su techo (≥ 6 s) y lanzó por techo con el
 *   `(tile)` en la posdata «de paso llegaron otros errores» — no como
 *   desenlace «RECHAZÓ el frame (protocolo)».
 *
 *   **2 · La marca `__qaCable` se ve en el momento del `send`.** La migración
 *   del 85 depende de que el espía de `window.WebSocket.prototype.send` vea
 *   `this.__qaCable` en el frame del helper; la marca se pone DESPUÉS del
 *   `new`, así que lo que hay que medir es que esté puesta cuando sale el
 *   frame. Un espía con la misma forma que el del 85 apunta `{marca, type}` de
 *   cada `send` y se afirma que el `list_sessions` del helper salió marcado.
 *
 *   **3 · Un «no» del HANDLER no es un rechazo del intake.** `resume_session`
 *   de una partida que no existe pasa el contrato y el handler contesta
 *   `session_started` con `ok:false` y su motivo (`router.ts`,
 *   `respuestaAlFalloDeHandler`). El helper lo DEVUELVE —quien llama decide—
 *   y no lanza; y lo devuelve en menos de 2 s, no al techo.
 *
 *  EN NEGATIVO (medido al escribirlo, revertido por md5): con `"tile"` en
 *  `RECHAZOS_QUE_PARAN` de `qa/lib/cable.mjs` (y sin `"protocolo"`, que es el
 *  negativo del 171 en la misma corrida), el bloque 1 sale ROJO: el cable
 *  suscrito lanza en cuanto llega el `tile` y `porElCable` lo CIERRA, así que
 *  la espera «el error de kind tile llegó a un cable abierto» ya no encuentra
 *  ningún cable suscrito abierto y expira con ✘ ERROR; los bloques 2 y 3
 *  siguen verdes. El 171, en esa misma corrida, rojo en «lanza YA» y
 *  «nombrando» de B y C.
 *
 *  Cero créditos: motor falso; `mode:"error"` se restaura en `finally` y
 *  `aisla` deja el fake como al arrancar para el siguiente. */
import { porElCable, preguntarPorElCable } from "../lib/cable.mjs";
import { URLS } from "../lib/stack.mjs";
import { MS_DEL_TILE } from "../lib/tile-episodio.mjs";

export const aisla = ["saves", "mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Techo del cable suscrito del bloque 1: lo bastante largo para que el error
 *  del tile llegue DURANTE la espera, lo bastante corto para no confundirse
 *  con un cuelgue. */
const TECHO_SUSCRITO_MS = 6_000;
const MS_INMEDIATO = 2_000;
/* Las dos esperas del bloque 1 tienen por sujeto al bridge generando (o
 * fallando) un tile, así que presupuestan `MS_DEL_TILE` (#677) y están en
 * `data/contract/esperas-de-tile.json` (QA de #694, H3). */

/** Cómo se conforma el motor falso ante un tile (#516). Devuelve la vigente. */
async function conductaDeTiles(ctx, cambio) {
  const res = await fetch(`${URLS.fake_ai}/dev/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambio),
  });
  if (!res.ok) throw new Error(`POST /dev/tiles HTTP ${res.status}: ${await res.text()}`);
  const vigente = await res.json();
  ctx.log(`motor falso ante un tile: ${JSON.stringify(vigente)}`);
  return vigente;
}

/** Cuántas escenas (tiles) ha GENERADO el motor falso hasta ahora: la cuenta
 *  de `/generate_scene` en `/dev/counters`. Por eso `aisla` lleva `mundo`: con
 *  el snapshot pasivo del bridge, la segunda partida de un juego arranca sin
 *  pedirle el bootstrap al motor, y esta cuenta no se movería. */
async function escenasGeneradas() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`GET /dev/counters HTTP ${res.status}`);
  return (await res.json()).gasto?.rutas?.["/generate_scene"] ?? 0;
}

/** Corre el helper y devuelve cómo acabó y cuánto tardó, sin tragarse nada. */
async function pregunta(ctx, mensaje, opciones) {
  const t0 = Date.now();
  try {
    const frame = await preguntarPorElCable(ctx, mensaje, opciones);
    return { frame, error: null, ms: Date.now() - t0 };
  } catch (e) {
    return { frame: null, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

async function bloqueUnErrorDifundidoNoCorta(ctx) {
  const antes = await conductaDeTiles(ctx, {});
  try {
    await conductaDeTiles(ctx, { mode: "error" });
    const escenasAntes = await escenasGeneradas();

    // El cable SUSCRITO: un `start_session` que espera un tipo que nunca llega.
    const suscrito = pregunta(
      ctx,
      { type: "start_session", requestId: "qa-172-suscrito", gameId: GAME_ID },
      { respuesta: "sessions_listed", techoMs: TECHO_SUSCRITO_MS },
    );
    // El bridge encola el bootstrap DESPUÉS de suscribir: cuando el fake lo ha
    // servido, el cable ya oye las difusiones.
    const bootstrap = await ctx.waitFor(
      "el motor falso sirvió el bootstrap de la partida del cable suscrito",
      async ([url, n]) => {
        const r = await fetch(`${url}/dev/counters`);
        if (!r.ok) throw new Error(`GET /dev/counters HTTP ${r.status}`);
        const escenas = (await r.json()).gasto?.rutas?.["/generate_scene"] ?? 0;
        return escenas > n ? { escenas } : null;
      },
      MS_DEL_TILE,
      [URLS.fake_ai, escenasAntes],
    );
    ctx.log(`bootstrap servido: /generate_scene ${escenasAntes} → ${bootstrap.escenas}`);

    // OTRO cable pide el tile (1,0): el fake lo tira y el bridge lo difunde.
    const { resultado: llego, rechazos: delQuePide } = await porElCable(
      ctx,
      { type: "request_tile", tx: 1, ty: 0, reason: "blocking" },
      (id) =>
        ctx.waitFor(
          "el error de kind tile llegó a un cable abierto de la página",
          (propio) => {
            // Los cables abiertos que NO son el que pide: el suscrito.
            const otros = Object.entries(window.__qaCables?.abiertos ?? {}).filter(([k]) => k !== propio);
            const conTile = otros.filter(([, c]) => c.rechazos.some((r) => r.kind === "tile")).map(([k]) => k);
            return conTile.length ? { conTile, abiertos: otros.length } : null;
          },
          MS_DEL_TILE,
          id,
        ),
    );
    ctx.log(`el error del tile llegó a ${JSON.stringify(llego)} · el cable que lo pidió vio: ${JSON.stringify(delQuePide)}`);
    ctx.expect(
      "1 · el error difundido de kind `tile` LLEGÓ a un cable suscrito distinto del que pidió (sin esto el bloque no mide nada)",
      Array.isArray(llego?.conTile) && llego.conTile.length === 1 && llego.abiertos === 1,
      JSON.stringify(llego),
    );

    const r = await suscrito;
    ctx.log(`  · cable suscrito: ${r.error === null ? "devolvió" : "lanzó"} en ${r.ms} ms — ${r.error ?? JSON.stringify(r.frame)}`);
    ctx.expect("1 · el cable suscrito lanzó (nunca iba a llegar `sessions_listed`)", r.error !== null, JSON.stringify(r.frame)?.slice(0, 200));
    ctx.expect(
      `1 · y AGOTÓ su techo (≥ ${TECHO_SUSCRITO_MS} ms): el error de otro kind no lo cortó`,
      r.ms >= TECHO_SUSCRITO_MS && r.error !== null && r.error.includes(`sin respuesta ni rechazo en ${TECHO_SUSCRITO_MS / 1000} s`),
      `${r.ms} ms — ${r.error ?? ""}`,
    );
    ctx.expect(
      "1 · el `(tile)` va en la posdata «de paso llegaron otros errores», no como desenlace",
      r.error !== null &&
        r.error.includes("de paso llegaron otros errores:") &&
        r.error.includes("(tile)") &&
        !r.error.includes("esperando `sessions_listed`: el bridge RECHAZÓ"),
      r.error ?? "",
    );
  } finally {
    await conductaDeTiles(ctx, { mode: antes.mode });
  }
}

async function bloqueLaMarcaSeVeAlMandar(ctx) {
  await ctx.page.evaluate(() => {
    const send = WebSocket.prototype.send;
    window.__qa172 = { enviados: [], restaura: () => (WebSocket.prototype.send = send) };
    WebSocket.prototype.send = function (data) {
      let type;
      try {
        type = JSON.parse(String(data)).type ?? null;
      } catch {
        type = "ilegible";
      }
      window.__qa172.enviados.push({ marca: this.__qaCable ?? null, type });
      return send.call(this, data);
    };
  });
  try {
    const r = await pregunta(ctx, { type: "list_sessions", requestId: "qa-172-marca" }, { respuesta: "sessions_listed" });
    const enviados = await ctx.page.evaluate(() => window.__qa172.enviados);
    ctx.log(`  · el espía vio ${enviados.length} send(s): ${JSON.stringify(enviados)}`);
    const delHelper = enviados.filter((e) => e.type === "list_sessions");
    ctx.expect("2 · el `list_sessions` del helper devolvió su `sessions_listed`", r.error === null && r.frame?.type === "sessions_listed", r.error ?? "");
    ctx.expect(
      "2 · el espía de `send` vio UN `list_sessions`, y salió con la marca `__qaCable` puesta",
      delHelper.length === 1 && /^cable-\d+$/.test(String(delHelper[0].marca)),
      JSON.stringify(delHelper),
    );
  } finally {
    await ctx.page.evaluate(() => {
      window.__qa172.restaura();
      delete window.__qa172;
    });
  }
}

async function bloqueUnNoDelHandlerSeDevuelve(ctx) {
  const r = await pregunta(
    ctx,
    { type: "resume_session", requestId: "qa-172-no-existe", sessionId: "qa-172-partida-que-no-existe" },
    { respuesta: "session_started", techoMs: 10_000 },
  );
  ctx.log(`  · resume de una partida inexistente: ${r.error === null ? "devolvió" : "lanzó"} en ${r.ms} ms — ${r.error ?? JSON.stringify(r.frame)?.slice(0, 200)}`);
  ctx.expect(
    "3 · el helper DEVUELVE el `session_started` con `ok:false` y su motivo, no lanza: el «no» es del handler, no del intake",
    r.error === null && r.frame?.type === "session_started" && r.frame?.ok === false && typeof r.frame?.error === "string" && r.frame.error.length > 0,
    r.error ?? JSON.stringify(r.frame)?.slice(0, 200),
  );
  ctx.expect(`3 · y llega YA (< ${MS_INMEDIATO} ms), no al techo`, r.ms < MS_INMEDIATO, `${r.ms} ms`);
}

export default async function (ctx) {
  await bloqueLaMarcaSeVeAlMandar(ctx);
  await bloqueUnNoDelHandlerSeDevuelve(ctx);
  await bloqueUnErrorDifundidoNoCorta(ctx);
}
