/** UN `READY` AJENO NO QUITA EL MURO DEL VIAJE (#742).
 *
 *  Hasta la tanda AV, cualquier `ready` de tile hacía `muro.ocultar()`: un
 *  prefetch que aterrizaba a mitad de viaje —el caso normal al explorar, porque
 *  la cola va de uno en uno y el viaje no expulsa al job que ya corre— soltaba
 *  al jugador del «Viajando...» antes de tiempo, y lo teletransportaba después.
 *  Y si el destino fallaba detrás, su aviso acababa en la línea de mensajes: el
 *  rótulo miraba si había un muro PUESTO, y el prefetch ya lo había quitado.
 *  Desde #742 el bridge marca con `placeId` el `ready` que emite POR el viaje
 *  (`broadcastScene` con `meta.viaje`), y core decide con él la llegada
 *  (`esperasQueTermina`) y si un `ready` quita el muro (`elReadyQuitaElMuro`,
 *  `src/protocol/status-reparto.ts`). Tres bloques:
 *
 *   A · INSTANTÁNEO. Con el viaje esperando, un `request_tile` del tile en el
 *       que está el jugador: ya existe, así que el bridge lo re-difunde en el
 *       momento (`handlers/tile.ts`, sin cola) con un `ready` SIN `placeId`.
 *   B · REALISTA. El prefetch de un tile lejano, pedido ANTES del viaje, está
 *       en vuelo y el viaje espera en la cola detrás de él; el prefetch LLEGA.
 *   Tras cada uno: el ledger sigue abierto (ni `llegado` ni `error`) y el muro
 *   sigue siendo «Viajando...», sin `.error`. Y luego el viaje LLEGA: el muro
 *   se va y el ledger dice `llegado` — el control de que los verdes de arriba
 *   no salen de un viaje que nunca iba a terminar.
 *   C · EL DESTINO FALLA TRAS UN READY AJENO (partida nueva, otro prefetch
 *       lejano): el prefetch llega, el muro sigue en «Viajando...», y el tile
 *       del destino revienta en el motor. El muro dice «No se pudo llegar»
 *       con `.error` —por ser el fallo DEL viaje, no porque quede un muro
 *       puesto— y el ledger se cierra con el error.
 *
 *  EN NEGATIVO (a mano al escribirlo, cifras en `implementacion.md` de la
 *  tanda AV): con el `muro.ocultar()` incondicional de antes en el `case
 *  "ready"` de `main.ts`, A sale ROJO (el muro se va con el `ready` del
 *  `request_tile`).
 *
 *  CÓMO SE SOSTIENE SIN RELOJES: el retardo del motor falso es uno para todos
 *  los tiles y se lee VIVO (`/dev/tiles`), y la conducta (`mode`) se lee al
 *  DESPERTAR. El prefetch duerme `MS_DEL_PREFETCH` y A cabe dentro; cuando el
 *  prefetch llega, el viaje empieza su propio sueño, y en C es ahí cuando se
 *  pide `mode:"error"`: el tile del destino revienta al despertar. El molde es
 *  el del guion 173.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso; su conducta se
 *  cambia en caliente con `POST /dev/tiles` (#516) y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar, regenerarMundo, recargarAlTitulo } from "../lib/sesion.mjs";
import { ViajeRoto, viajarPorSalidas } from "../lib/viaje.mjs";
import { porElCable } from "../lib/cable.mjs";
import { URLS } from "../lib/stack.mjs";

/** Partida virgen y motor falso en su turno 0: este guion le CAMBIA la
 *  conducta, y `/dev/reset` es la red por si el `finally` no llegara. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Cuánto duerme el motor falso cada tile. Tiene que cubrir A entero (un par
 *  de segundos con la máquina tranquila), y en C es el margen para pedir el
 *  fallo antes de que el tile del destino despierte. */
const MS_DEL_PREFETCH = 8_000;
/** Techo de cada espera por condición: un socket local y un motor falso que
 *  habla en milisegundos, salvo el sueño de arriba. */
const TECHO_MS = 20_000;
/** Los tiles LEJANOS de B y de C: nadie los pide por su cuenta. */
const LEJANO_B = { tx: 6, ty: 6 };
const LEJANO_C = { tx: -6, ty: 6 };

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
      linea: document.getElementById("combat-log")?.textContent ?? "",
    };
  });
}

/** Cuándo llegó por última vez el tile `key` según el ledger de tiles del
 *  cliente, o `null`. Es la prueba de que el CLIENTE procesó el `ready`, no
 *  solo de que el bridge lo mandó. */
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

/** Los dos asertos de «el ready ajeno no tocó el viaje». */
function afirmaIntacto(ctx, bloque, f) {
  ctx.log(`${bloque} · ledger=${JSON.stringify(f.viaje)} · muro=«${f.titulo}» visible=${f.muroVisible} error=${f.muroError}`);
  ctx.expect(
    `${bloque} · el ledger del viaje sigue ABIERTO: el ready ajeno no es su llegada`,
    f.viaje !== null && f.viaje.error === null && f.viaje.llegado === null,
    JSON.stringify(f.viaje),
  );
  ctx.expect(
    `${bloque} · el muro sigue siendo «Viajando...»: el ready ajeno no lo quita`,
    f.muroVisible && !f.muroError && f.titulo === "Viajando...",
    `visible=${f.muroVisible} · error=${f.muroError} · título=«${f.titulo}»`,
  );
}

/** Pulsa la salida y espera a que el bridge acuse el viaje con el
 *  «Viajando...» delante. Devuelve `{ desenlace }`, la promesa del desenlace
 *  (nunca rechaza), ENVUELTA: una función `async` que devolviera la promesa a
 *  secas la aplanaría, y el `await` de quien llama esperaría al viaje entero
 *  —medido: A y B salían rojos mirando un viaje ya llegado—. */
async function arrancarElViaje(ctx, destino, desc) {
  const pedidoPrevio = await ctx.page.evaluate(() => window.__nefan.viaje?.pedido ?? null);
  const viaje = viajarPorSalidas(ctx, destino.name, desc).then(
    (llegada) => ({ llegada }),
    (err) => ({ err }),
  );
  await ctx.waitFor(
    "el bridge acusa el viaje y el jugador lee «Viajando...»",
    (previo) => {
      const v = window.__nefan.viaje;
      const t = document.getElementById("narrative-loader-title")?.textContent;
      return v && v.pedido !== previo && v.encolado !== null && t === "Viajando..." ? v : null;
    },
    TECHO_MS,
    pedidoPrevio,
  );
  return { desenlace: viaje };
}

/** A y B sobre un solo viaje, y su llegada. */
async function readysAjenos(ctx, inicial) {
  const salidas = await ctx.nefan("exits");
  ctx.expect("A/B · el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];
  const aqui = await ctx.nefan("currentTile");
  const m = /^tile_(-?\d+)_(-?\d+)$/.exec(aqui ?? "");
  ctx.expect("A · el jugador está en un tile del plano", Boolean(m), String(aqui));
  if (!m) return;
  const keyB = `tile_${LEJANO_B.tx}_${LEJANO_B.ty}`;

  let viaje = null;
  try {
    await conducta(ctx, { delay_ms: MS_DEL_PREFETCH });
    // El prefetch de B va PRIMERO, para que el viaje quede en la cola detrás
    // de él; la espera del cable es el bloque entero, así el socket sigue
    // abierto y lo que el intake rechazara se diría al final.
    const { rechazos } = await porElCable(
      ctx,
      { type: "request_tile", tx: LEJANO_B.tx, ty: LEJANO_B.ty, reason: "prefetch" },
      async () => {
        ({ desenlace: viaje } = await arrancarElViaje(ctx, destino, `el viaje a «${destino.name}» con readys ajenos`));

        // ── A · el tile donde está el jugador, re-difundido al instante ─────
        const antesA = await llegadaDelTile(ctx, aqui);
        ctx.log(`A · ${aqui} llegó por última vez en ${antesA}`);
        await porElCable(ctx, { type: "request_tile", tx: Number(m[1]), ty: Number(m[2]), reason: "prefetch" }, () =>
          esperarReadyDelTile(ctx, `el ready del request_tile de ${aqui} llega al cliente`, aqui, antesA),
        );
        afirmaIntacto(ctx, "A", await foto(ctx));
        await ctx.shot("a-viajando-tras-ready-instantaneo");

        // ── B · el prefetch en vuelo llega antes que el viaje ───────────────
        const epB = await esperarReadyDelTile(ctx, `el prefetch de ${keyB} llega al cliente`, keyB, null);
        ctx.expect(`B · el prefetch de ${keyB} LLEGÓ (no falló)`, !epB?.fallo, JSON.stringify(epB));
        afirmaIntacto(ctx, "B", await foto(ctx));
        await ctx.shot("b-viajando-tras-prefetch");
        // El viaje ya ha empezado su sueño; los que vengan después, sin él.
        await conducta(ctx, { delay_ms: 0 });
      },
    );
    ctx.expect("A/B · el intake no rechazó el prefetch", rechazos.length === 0, JSON.stringify(rechazos));
  } finally {
    await conducta(ctx, inicial);
  }

  // ── Control: el viaje LLEGA y ahora sí se va el muro ──────────────────────
  const fin = await viaje;
  ctx.log(`desenlace: ${fin.err ? `${fin.err.name}: ${fin.err.message}` : JSON.stringify(fin.llegada.ledger)}`);
  ctx.expect(
    "control · el viaje LLEGA tras los dos readys ajenos (ledger con `llegado`)",
    !fin.err && fin.llegada?.estado === "llegado" && fin.llegada.ledger.llegado !== null,
    fin.err ? `${fin.err instanceof ViajeRoto ? "ViajeRoto" : fin.err.name}: ${fin.err.message}` : JSON.stringify(fin.llegada),
  );
  const f = await foto(ctx);
  ctx.expect(
    "control · con la llegada DEL viaje el muro se va",
    !f.muroVisible,
    `visible=${f.muroVisible} · título=«${f.titulo}»`,
  );
  await ctx.shot("llegado");
}

/** C: el destino falla detrás de un ready ajeno. */
async function elDestinoFallaTrasUnReadyAjeno(ctx, inicial) {
  const salidas = await ctx.nefan("exits");
  ctx.expect("C · el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];
  const keyC = `tile_${LEJANO_C.tx}_${LEJANO_C.ty}`;

  let viaje = null;
  try {
    await conducta(ctx, { delay_ms: MS_DEL_PREFETCH });
    const { rechazos } = await porElCable(
      ctx,
      { type: "request_tile", tx: LEJANO_C.tx, ty: LEJANO_C.ty, reason: "prefetch" },
      async () => {
        ({ desenlace: viaje } = await arrancarElViaje(ctx, destino, `el viaje a «${destino.name}» que falla tras un ready ajeno`));
        const ep = await esperarReadyDelTile(ctx, `el prefetch de ${keyC} llega al cliente`, keyC, null);
        // El tile del destino empieza a dormir AHORA y lee la conducta al
        // despertar: se pide el fallo ya.
        await conducta(ctx, { mode: "error" });
        ctx.expect(`C · el prefetch de ${keyC} LLEGÓ (no falló)`, !ep?.fallo, JSON.stringify(ep));
        afirmaIntacto(ctx, "C", await foto(ctx));
      },
    );
    ctx.expect("C · el intake no rechazó el prefetch", rechazos.length === 0, JSON.stringify(rechazos));

    const fin = await viaje;
    ctx.log(`C · desenlace: ${fin.err ? `${fin.err.name}: ${fin.err.message}` : JSON.stringify(fin.llegada)}`);
    ctx.expect(
      "C · el viaje se ROMPE (ViajeRoto): el fallo es del destino",
      fin.err instanceof ViajeRoto,
      fin.err ? `${fin.err.name}: ${fin.err.message}` : `llegó: ${JSON.stringify(fin.llegada)}`,
    );
  } finally {
    await conducta(ctx, inicial);
  }
  const f = await foto(ctx);
  ctx.log(`C · muro=«${f.titulo}» · detalle=«${f.detalle}» · línea=…${f.linea.slice(-200)}`);
  ctx.expect(
    "C · el muro dice «No se pudo llegar» a pantalla completa, con `.error`",
    f.muroVisible && f.muroError && f.titulo === "No se pudo llegar",
    `visible=${f.muroVisible} · error=${f.muroError} · título=«${f.titulo}»`,
  );
  ctx.expect(
    "C · y el motivo nombra el destino EN EL MURO (no solo en la línea de mensajes)",
    f.detalle.includes(`No se pudo llegar a ${destino.name}`),
    `detalle=«${f.detalle}»`,
  );
  await ctx.shot("c-no-se-pudo-llegar");
}

export default async function (ctx) {
  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());
  ctx.log(`conducta inicial del motor falso: ${JSON.stringify(inicial)}`);

  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  await readysAjenos(ctx, inicial);

  // Partida nueva para C: el destino de A/B ya está realizado, y un viaje a un
  // lugar realizado no pasa por el motor, así que no podría fallar en él.
  await recargarAlTitulo(ctx);
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);
  await elDestinoFallaTrasUnReadyAjeno(ctx, inicial);
}
