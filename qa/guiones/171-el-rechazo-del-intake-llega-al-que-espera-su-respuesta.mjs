/** El rechazo del intake llega AL QUE ESPERA SU RESPUESTA, y llega ya (#694).
 *
 *  POR QUÉ EXISTE. Quince clientes del banco abrían su propio socket, mandaban
 *  un frame y esperaban UN tipo de respuesta tirando lo demás por tipo. Cuando
 *  el frame no pasa el contrato, el bridge lo rechaza por UNICAST como
 *  `narrative_status` con `phase:"error"` y `kind:"protocolo"`
 *  (`nefan-core/bridge/ws-server.ts`) y NO cierra el socket: el rechazo llegaba,
 *  no era el tipo esperado, se tiraba, y el `evaluate` se colgaba hasta el
 *  presupuesto del guion — rojo, pero MUDO. Desde #694 los quince pasan por
 *  `preguntarPorElCable` (`qa/lib/cable.mjs`), que trata ese rechazo como
 *  desenlace. Esto lo ejerce contra el bridge REAL, que es lo que el test del
 *  socket falso (`nefan-core/test/cable-de-qa.test.ts`) no puede afirmar.
 *
 *  TRES BLOQUES, en el título y sin abrir partida:
 *
 *   **A · control.** `list_sessions` → `sessions_listed` con su `requestId`:
 *   el helper devuelve el frame. Sin esto, un helper que lanzase SIEMPRE haría
 *   verdes los dos de abajo.
 *   **B · un frame con respuesta tipada que el intake rechaza.** El mismo
 *   `"nope"` de los negativos del 60 y el 63, puesto en `renderMode` de un
 *   `set_render_mode` —la forma real de los quince: un frame que SÍ tiene
 *   respuesta (`render_mode_set`) y que no la va a tener—. Tiene que LANZAR en
 *   menos de `MS_INMEDIATO`, nombrando el rechazo (`protocolo`) y lo que se
 *   esperaba.
 *   **C · el literal del issue**: `request_tile` con `reason:"nope"`. Ese frame
 *   no tiene respuesta tipada en el protocolo, así que se le pide una
 *   cualquiera (`render_mode_set`): lo que se mide es que el rechazo gane a la
 *   espera, sea cual sea el tipo que se esperaba.
 *
 *  El techo del helper se pone aquí a `TECHO_MS` (10 s, no los 30 de defecto):
 *  si el rechazo dejara de parar la espera, el ✘ diría «sin respuesta ni
 *  rechazo en 10 s» —el síntoma viejo, con su cifra— y los asertos de tiempo
 *  saldrían rojos con el número al lado.
 *
 *  EN NEGATIVO (medido al escribirlo, revertido — ver `implementacion.md` de la
 *  tanda AQ): quitando `"protocolo"` de `RECHAZOS_QUE_PARAN` en
 *  `qa/lib/cable.mjs`, B y C salen rojos por tiempo (≈10 s, «sin respuesta ni
 *  rechazo en 10 s · de paso llegaron otros errores: …(protocolo)…») y A sigue
 *  verde.
 *
 *  Cero créditos: `list_sessions` lee el disco del bridge y los otros dos
 *  frames mueren en el intake; nadie habla con el motor.
 */
import { preguntarPorElCable } from "../lib/cable.mjs";

export const sinMotor =
  "manda por el cable del bridge un list_sessions y dos frames que el intake rechaza; ninguno llega a " +
  "un handler que hable con el motor";

/** Lo que se considera «inmediato»: el rechazo viaja por un socket local. El
 *  síntoma viejo era el presupuesto entero del guion. */
const MS_INMEDIATO = 2_000;
/** El techo que se le da al helper: lo bastante corto para que el negativo lo
 *  enseñe en segundos, lo bastante largo para no confundirse con el rechazo. */
const TECHO_MS = 10_000;

/** Corre `preguntarPorElCable` y devuelve cómo acabó y cuánto tardó, sin
 *  tragarse nada: el error viaja entero en `error`. */
async function pregunta(ctx, mensaje, respuesta) {
  const t0 = Date.now();
  try {
    const frame = await preguntarPorElCable(ctx, mensaje, { respuesta, techoMs: TECHO_MS });
    return { frame, error: null, ms: Date.now() - t0 };
  } catch (e) {
    return { frame: null, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

/** Los tres asertos de un rechazo: lanzó, pronto, y nombrando al culpable. */
function afirmaRechazo(ctx, bloque, r, esperaba) {
  ctx.log(`  · ${bloque}: ${r.error === null ? "NO lanzó" : "lanzó"} en ${r.ms} ms — ${r.error ?? JSON.stringify(r.frame)}`);
  ctx.expect(`${bloque} · el helper LANZA: el rechazo es un desenlace, no algo que tirar`, r.error !== null, JSON.stringify(r.frame)?.slice(0, 200));
  ctx.expect(
    `${bloque} · y lanza YA (< ${MS_INMEDIATO} ms), no al agotar el techo`,
    r.ms < MS_INMEDIATO,
    `${r.ms} ms — ${r.error ?? ""}`,
  );
  ctx.expect(
    `${bloque} · nombrando el rechazo del intake (protocolo) y lo que se esperaba`,
    r.error !== null && /RECHAZÓ el frame \(protocolo\)/.test(r.error) && r.error.includes(`esperando \`${esperaba}\``),
    r.error ?? "",
  );
}

export default async function (ctx) {
  // ── A · control: con un frame bueno, el helper devuelve SU respuesta ──────
  const a = await pregunta(ctx, { type: "list_sessions", requestId: "qa-171-lista" }, "sessions_listed");
  ctx.log(`  · A: ${a.error === null ? "devolvió" : "lanzó"} en ${a.ms} ms`);
  ctx.expect(
    "A · control: `list_sessions` devuelve su `sessions_listed`, con su `requestId` y la lista",
    a.error === null &&
      a.frame?.type === "sessions_listed" &&
      a.frame?.requestId === "qa-171-lista" &&
      Array.isArray(a.frame?.sessions),
    a.error ?? JSON.stringify(a.frame).slice(0, 200),
  );

  // ── B · un frame CON respuesta tipada que el intake rechaza ───────────────
  const b = await pregunta(
    ctx,
    { type: "set_render_mode", requestId: "qa-171-nope", sessionId: "qa-171", facet: "scenes", renderMode: "nope" },
    "render_mode_set",
  );
  afirmaRechazo(ctx, "B", b, "render_mode_set");

  // ── C · el literal del issue: `reason: "nope"` ────────────────────────────
  const c = await pregunta(
    ctx,
    { type: "request_tile", requestId: "qa-171-tile", tx: 1, ty: 0, reason: "nope" },
    "render_mode_set",
  );
  afirmaRechazo(ctx, "C", c, "render_mode_set");
}
