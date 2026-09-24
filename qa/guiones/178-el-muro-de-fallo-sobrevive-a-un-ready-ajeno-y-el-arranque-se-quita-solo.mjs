/** EL MURO DE FALLO SOBREVIVE A UN `READY` AJENO, Y EL ARRANQUE SE QUITA SOLO
 *  (#742, QA de la tanda AV).
 *
 *  El 177 cubre el «Viajando...» ante readys ajenos y el fallo del destino
 *  detrás de uno. Lo que NO cubre es la otra mitad del criterio 3 de la tanda
 *  («ni un muro de FALLO») y el camino del jugador después del fallo. Tres
 *  bloques, en el orden en que los vive quien juega:
 *
 *   A · ARRANQUE. «Iniciando partida...» se pinta al pulsar «Comenzar» y lo
 *       quita el primer tile, SIN viaje abierto (regla 2 de
 *       `elReadyQuitaElMuro`). El retardo del motor falso no toca al tile de
 *       arranque (`fake-ai-server.ts`, `!gt?.bootstrap`), así que el muro dura
 *       decenas de ms con el snapshot: se observa con un `MutationObserver`
 *       puesto ANTES de pulsar, y se afirma sobre la secuencia real
 *       (visible con ese título → oculto), no sobre una foto que llegaría
 *       tarde. Sin reloj de pared (#711): lo que importa es el orden.
 *   B · FALLO + READY AJENO. El viaje falla en el motor y el muro dice «No se
 *       pudo llegar». Llega el `ready` instantáneo de un `request_tile` del
 *       tile actual (sin `placeId`). El muro sigue ahí, con `.error` y su
 *       motivo: un `ready` no se lleva un aviso sin leer (regla 1).
 *   C · EL JUGADOR SIGUE. Pulsa «Cerrar», el muro se va, y vuelve a pulsar la
 *       misma salida: ahora el viaje llega y el muro «Viajando...» se va con
 *       SU llegada. Es el control de que tras un fallo el juego no queda en
 *       un estado sin salida.
 *
 *  EN NEGATIVO (a mano, QA de la tanda AV): con `muro.ocultar()` incondicional
 *  en el `case "ready"` de `main.ts`, B sale ROJO (el muro de fallo se va con
 *  el `ready` del `request_tile`).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso; su conducta se
 *  cambia en caliente con `POST /dev/tiles` y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { ViajeRoto, viajarPorSalidas } from "../lib/viaje.mjs";
import { porElCable } from "../lib/cable.mjs";
import { URLS } from "../lib/stack.mjs";

/** Partida virgen y motor falso en su turno 0: este guion le CAMBIA la
 *  conducta, y `/dev/reset` es la red por si el `finally` no llegara. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const TECHO_MS = 20_000;
const TITULOS_DE_ARRANQUE = ["Iniciando partida...", "Generando mundo inicial..."];

/** Cómo se conforma el motor falso ante un tile. Devuelve la conducta vigente. */
async function conducta(ctx, cambio) {
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

/** Lo que el jugador tiene delante y lo que el juego recuerda del viaje. */
function foto(ctx) {
  return ctx.page.evaluate(() => {
    const muro = document.getElementById("narrative-loader");
    return {
      viaje: window.__nefan.viaje,
      muroVisible: Boolean(muro?.classList.contains("visible")),
      muroError: Boolean(muro?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
    };
  });
}

/** Cuándo llegó por última vez el tile `key` según el ledger de tiles del
 *  cliente, o `null`. */
function llegadaDelTile(ctx, key) {
  return ctx.page.evaluate((k) => (window.__nefan.tileEpisodios ?? []).find((e) => e.key === k)?.arrived ?? null, key);
}

/** Espera a que el cliente procese un `ready` NUEVO del tile `key`. */
function esperarReadyDelTile(ctx, desc, key, antes) {
  return ctx.waitFor(
    desc,
    ({ k, previo }) => {
      const e = (window.__nefan.tileEpisodios ?? []).find((x) => x.key === k);
      if (e && e.error) return { fallo: e };
      return e && e.arrived !== null && e.arrived !== previo ? e : null;
    },
    TECHO_MS,
    { k: key, previo: antes },
  );
}

/** Un `ready` ajeno: el `request_tile` del tile en el que está el jugador, que
 *  el bridge re-difunde al instante sin `placeId`. */
async function readyAjenoDelTileActual(ctx, bloque) {
  const aqui = await ctx.nefan("currentTile");
  const m = /^tile_(-?\d+)_(-?\d+)$/.exec(aqui ?? "");
  ctx.expect(`${bloque} · el jugador está en un tile del plano`, Boolean(m), String(aqui));
  if (!m) return false;
  const antes = await llegadaDelTile(ctx, aqui);
  const { rechazos } = await porElCable(
    ctx,
    { type: "request_tile", tx: Number(m[1]), ty: Number(m[2]), reason: "prefetch" },
    () => esperarReadyDelTile(ctx, `${bloque} · el ready del request_tile de ${aqui} llega al cliente`, aqui, antes),
  );
  ctx.expect(`${bloque} · el intake no rechazó el request_tile`, rechazos.length === 0, JSON.stringify(rechazos));
  return true;
}

/** A: el muro del arranque se pinta y lo quita el primer tile. */
async function arranque(ctx) {
  // El observador va ANTES de «Comenzar»: el muro dura decenas de ms.
  await ctx.page.evaluate(() => {
    const el = document.getElementById("narrative-loader");
    const t = document.getElementById("narrative-loader-title");
    window.__qa178 = { eventos: [] };
    let visible = el.classList.contains("visible");
    new MutationObserver(() => {
      const ahora = el.classList.contains("visible");
      if (ahora === visible) return;
      visible = ahora;
      // Sin reloj de pared (#711): lo que se afirma es el ORDEN de las
      // transiciones, y ese lo da el array.
      window.__qa178.eventos.push({
        visible: ahora,
        titulo: t?.textContent ?? "",
        error: el.classList.contains("error"),
      });
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  });
  await comenzar(ctx);
  const eventos = await ctx.page.evaluate(() => window.__qa178.eventos);
  ctx.log(`A · transiciones del muro durante el arranque: ${JSON.stringify(eventos)}`);
  const iPintado = eventos.findIndex((e) => e.visible && TITULOS_DE_ARRANQUE.includes(e.titulo));
  const pintado = iPintado >= 0 ? eventos[iPintado] : null;
  ctx.expect(
    "A · el muro del arranque se PINTÓ («Iniciando partida...» / «Generando mundo inicial...»), sin `.error`",
    Boolean(pintado) && !pintado.error,
    JSON.stringify(eventos),
  );
  const quitado = pintado ? eventos.slice(iPintado + 1).find((e) => !e.visible) : null;
  ctx.expect(
    "A · …y el primer tile lo QUITÓ (sin viaje abierto, el arranque se quita solo)",
    Boolean(quitado),
    JSON.stringify(eventos),
  );
  const f = await foto(ctx);
  ctx.expect(
    "A · con la partida en marcha no hay muro y el ledger de viaje está vacío",
    !f.muroVisible && f.viaje === null,
    `visible=${f.muroVisible} · título=«${f.titulo}» · viaje=${JSON.stringify(f.viaje)}`,
  );
  await ctx.shot("a-partida-en-marcha");
}

/** B y C sobre la misma salida: falla, sobrevive a un ready ajeno, se cierra y
 *  el reintento llega. */
async function falloReadyAjenoYReintento(ctx, inicial) {
  const salidas = await ctx.nefan("exits");
  ctx.expect("B · el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];

  // ── B · el viaje falla en el motor ─────────────────────────────────────────
  let fin;
  try {
    await conducta(ctx, { mode: "error", delay_ms: 0 });
    fin = await viajarPorSalidas(ctx, destino.name, `B · el viaje a «${destino.name}» que el motor no construye`).then(
      (llegada) => ({ llegada }),
      (err) => ({ err }),
    );
  } finally {
    await conducta(ctx, inicial);
  }
  ctx.expect(
    "B · el viaje se ROMPE (ViajeRoto): el motor no construyó el destino",
    fin.err instanceof ViajeRoto,
    fin.err ? `${fin.err.name}: ${fin.err.message}` : `llegó: ${JSON.stringify(fin.llegada)}`,
  );
  let f = await foto(ctx);
  ctx.expect(
    "B · el muro dice «No se pudo llegar» con `.error`",
    f.muroVisible && f.muroError && f.titulo === "No se pudo llegar",
    `visible=${f.muroVisible} · error=${f.muroError} · título=«${f.titulo}»`,
  );
  const detalleDelFallo = f.detalle;

  // ── B · llega un ready ajeno detrás del muro de fallo ──────────────────────
  if (!(await readyAjenoDelTileActual(ctx, "B"))) return;
  f = await foto(ctx);
  ctx.log(`B · tras el ready ajeno: muro=«${f.titulo}» visible=${f.muroVisible} error=${f.muroError} · ledger=${JSON.stringify(f.viaje)}`);
  ctx.expect(
    "B · el muro de FALLO sigue en pantalla: un ready ajeno no se lleva un aviso sin leer",
    f.muroVisible && f.muroError && f.titulo === "No se pudo llegar" && f.detalle === detalleDelFallo,
    `visible=${f.muroVisible} · error=${f.muroError} · título=«${f.titulo}» · detalle=«${f.detalle}»`,
  );
  ctx.expect(
    "B · y el ledger sigue cerrado por el error (el ready ajeno no lo reabre ni lo da por llegado)",
    f.viaje !== null && f.viaje.error !== null && f.viaje.llegado === null,
    JSON.stringify(f.viaje),
  );
  await ctx.shot("b-no-se-pudo-llegar-tras-ready-ajeno");

  // ── C · el jugador cierra el aviso y vuelve a intentarlo ───────────────────
  await ctx.page.click("#narrative-loader-dismiss");
  f = await foto(ctx);
  ctx.expect("C · «Cerrar» quita el muro de fallo", !f.muroVisible, `visible=${f.muroVisible} · título=«${f.titulo}»`);
  await ctx.shot("c-tras-cerrar");

  const reintento = await viajarPorSalidas(ctx, destino.name, `C · el reintento del viaje a «${destino.name}»`).then(
    (llegada) => ({ llegada }),
    (err) => ({ err }),
  );
  ctx.log(`C · desenlace: ${reintento.err ? `${reintento.err.name}: ${reintento.err.message}` : JSON.stringify(reintento.llegada.ledger)}`);
  ctx.expect(
    "C · el reintento LLEGA (ledger con `llegado`)",
    !reintento.err && reintento.llegada?.estado === "llegado" && reintento.llegada.ledger.llegado !== null,
    reintento.err ? `${reintento.err.name}: ${reintento.err.message}` : JSON.stringify(reintento.llegada),
  );
  f = await foto(ctx);
  ctx.expect("C · y con SU llegada el muro se va", !f.muroVisible, `visible=${f.muroVisible} · título=«${f.titulo}»`);
  await ctx.shot("c-llegado-tras-reintento");
}

export default async function (ctx) {
  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());
  ctx.log(`conducta inicial del motor falso: ${JSON.stringify(inicial)}`);

  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await arranque(ctx);
  await falloReadyAjenoYReintento(ctx, inicial);
}
