/** UN VIAJE ROTO NO SE ABSORBE, NO PARA AL VIAJE SIGUIENTE, Y EL JUGADOR TIENE
 *  UN MURO QUE CERRAR ANTES DE VOLVER A VIAJAR (#693, QA de la tanda AP).
 *
 *  El 168 mide que `viajarPorSalidas` (`qa/lib/viaje.mjs`) para en segundos
 *  con el motor roto y que el mismo viaje llega después. Esto mide las TRES
 *  preguntas que quedaban abiertas al validarlo, en la página real y no sobre
 *  un `window` de mentira:
 *
 *   A · Dentro de `ctx.absorbe` —que es como viajan el 49 y el 60— un viaje que
 *       el bridge declara ROTO no se absorbe: sale `ViajeRoto` (✘ con causa),
 *       no `null` (⊘ mudo). Solo la EXPIRACIÓN es absorbible; eso se prueba
 *       sin navegador en `test/viaje.test.ts` (R4) y se midió a mano en la QA
 *       de la tanda con el guion 60 y la sonda saboteada.
 *   B · El ledger del viaje roto SOBREVIVE en la página, y lo único que impide
 *       que pare al viaje siguiente es comparar `pedido`: la misma sonda
 *       serializada, sobre el mismo `window.__nefan`, devuelve `fallo` con
 *       `pedidoPrevio: null` (el error está ahí: control) y `null` con el
 *       `pedido` del viaje roto (no es de ESTE viaje). Sin la comparación, el
 *       segundo viaje moriría en décimas de segundo con la causa del primero.
 *   C · LO QUE TIENE DELANTE EL JUGADOR tras el viaje roto: el muro de fallo
 *       («No se pudo llegar», `#narrative-loader.error`) tapa el panel
 *       «Salidas» —bajo el punto donde está el botón no hay botón, hay muro— y
 *       hay que pulsar «Cerrar» para recuperarlo. Al escribir esto,
 *       `pulsarSalida` hacía un `element.click()` del DOM, que dispara el
 *       handler AUNQUE el botón esté tapado, y el control B del 168 llegaba sin
 *       cerrar nada (hallazgo 1). Desde la vuelta 2 de la tanda `pulsarSalida`
 *       mira qué hay bajo el centro del botón y lanza `SalidaTapada` si no es
 *       él (lo mide el M del 168); este guion cierra el muro por el camino del
 *       jugador antes de D.
 *   D · Cerrado el muro, el MISMO viaje llega con un ledger NUEVO (`pedido`
 *       distinto, sin `error`), en segundos.
 *
 *  EN NEGATIVO (hecho a mano al escribirlo, con el resultado en el qa.md de la
 *  tanda AP): con `v.pedido === pedidoPrevio` quitado de `sondaDeViaje`, B2 se
 *  pone rojo (la sonda filtrada devuelve `fallo`). D sigue llegando incluso
 *  así, y eso también se aprendió midiendo: el clic abre el ledger nuevo de
 *  forma SÍNCRONA (`travelLedger.pedido` en `onTravel`, antes del primer
 *  sondeo), así que el error del viaje anterior solo puede parar al siguiente
 *  cuando el clic NO abre ledger —sesión inactiva, handler sin atar—, que es
 *  justo el caso que `pasoMuerto` nombra como «el cliente no registró este
 *  viaje» y no como la causa del viaje de antes.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el motor es el fake-ai-server y
 *  su conducta ante un tile se cambia con `POST /dev/tiles` (molde del 109 y
 *  del 168) y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { ViajeRoto, sondaDeViaje, viajarPorSalidas } from "../lib/viaje.mjs";
import { URLS } from "../lib/stack.mjs";

/** Partida virgen y motor falso en su turno 0: este guion le CAMBIA la
 *  conducta, y `/dev/reset` es la red por si el `finally` no llegara. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Lo mismo que en el 168: toda boca de fallo del falso habla en menos de 2 s. */
const TECHO_MS = 10_000;

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

/** Qué hay bajo el punto donde el jugador vería el primer botón del panel
 *  «Salidas»: el botón, el muro o nada. Se LEE el panel con otro selector (no
 *  se pulsa desde aquí: pulsar es de `viajarPorSalidas`). */
const bajoElBoton = () => {
  const muro = document.getElementById("narrative-loader");
  const boton = document.querySelector("#travel-panel button");
  if (!boton) return { muroVisible: false, muroError: false, encima: "sin-boton" };
  const r = boton.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    muroVisible: Boolean(muro && muro.classList.contains("visible")),
    muroError: Boolean(muro && muro.classList.contains("error")),
    titulo: (document.getElementById("narrative-loader-title")?.textContent ?? "").trim(),
    encima: el === boton ? "el-boton" : muro && el && muro.contains(el) ? "el-muro" : (el?.id || el?.className || "otro"),
  };
};

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  const salidas = await ctx.nefan("exits");
  ctx.expect("el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];
  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());

  // ── A · Dentro de `absorbe`, un viaje ROTO no se absorbe ─────────────────
  let a = null;
  let msA = null;
  try {
    await conducta(ctx, { mode: "error" });
    const t0 = Date.now();
    a = await ctx
      .absorbe(
        "solo una EXPIRACIÓN se absorbe aquí, y si ocurre el aserto A1 sale rojo con el tiempo; lo que se mide es que un viaje ROTO sube como ViajeRoto",
        () => viajarPorSalidas(ctx, destino.name, "el viaje con el motor fallando, dentro de absorbe"),
      )
      .then(
        (v) => ({ absorbido: v === null, llegada: v }),
        (err) => ({ err }),
      );
    msA = Date.now() - t0;
  } finally {
    await conducta(ctx, inicial);
  }
  ctx.log(
    `A · desenlace en ${msA} ms: ${a.err ? `${a.err.name}: ${a.err.message}` : a.absorbido ? "ABSORBIDO (null)" : JSON.stringify(a.llegada)}`,
  );
  ctx.expect(
    "A1 · dentro de absorbe, el viaje roto SUBE como ViajeRoto (no lo traga como si fuera una expiración)",
    a.err instanceof ViajeRoto,
    a.err ? `${a.err.name}: ${a.err.message}` : a.absorbido ? `absorbido tras ${msA} ms` : `llegó: ${JSON.stringify(a.llegada)}`,
  );
  ctx.expect(`A2 · y lo hace en ≤ ${TECHO_MS} ms`, msA <= TECHO_MS, `${msA} ms`);
  await ctx.shot("viaje-roto-en-absorbe");
  if (!(a.err instanceof ViajeRoto)) return;

  // ── B · El ledger roto sigue en la página; solo `pedido` lo filtra ───────
  const ledgerA = a.err.ledger;
  const desde = await ctx.nefan("currentTile");
  const sinFiltro = await ctx.page.evaluate(sondaDeViaje, { desde, pedidoPrevio: null });
  const filtrada = await ctx.page.evaluate(sondaDeViaje, { desde, pedidoPrevio: ledgerA.pedido });
  ctx.log(`B · ledger roto: pedido=${ledgerA.pedido} · sonda sin filtro: ${JSON.stringify(sinFiltro)} · filtrada: ${JSON.stringify(filtrada)}`);
  ctx.expect(
    "B1 · CONTROL: el error del viaje roto SIGUE en la página (la sonda sin `pedidoPrevio` lo ve como fallo)",
    sinFiltro?.estado === "fallo" && sinFiltro.ledger?.pedido === ledgerA.pedido,
    JSON.stringify(sinFiltro),
  );
  ctx.expect(
    "B2 · con el `pedido` del viaje roto como previo, la sonda NO para: el error de un viaje anterior no es de este",
    filtrada === null,
    JSON.stringify(filtrada),
  );

  // ── C · Lo que tiene delante el jugador: un muro que cerrar ──────────────
  const conMuro = await ctx.page.evaluate(bajoElBoton);
  ctx.log(`C · tras el viaje roto: ${JSON.stringify(conMuro)}`);
  ctx.expect(
    "C1 · el muro de FALLO está en pantalla («No se pudo llegar») y ofrece «Cerrar»",
    conMuro.muroVisible && conMuro.muroError && /No se pudo llegar/.test(conMuro.titulo),
    JSON.stringify(conMuro),
  );
  ctx.expect(
    "C2 · bajo el punto donde está el botón del panel «Salidas» hay MURO, no botón: el jugador no puede volver a viajar sin cerrarlo",
    conMuro.encima === "el-muro",
    `encima: ${conMuro.encima}`,
  );
  // El camino del jugador: pulsar «Cerrar». Un clic de PUNTERO, no un
  // `element.click()`: si el botón estuviera tapado, esto fallaría, que es
  // justo lo que se quiere saber.
  await ctx.page.click("#narrative-loader-dismiss");
  const sinMuro = await ctx.page.evaluate(bajoElBoton);
  ctx.log(`C · tras «Cerrar»: ${JSON.stringify(sinMuro)}`);
  ctx.expect(
    "C3 · tras «Cerrar», el muro se va y bajo ese punto vuelve a estar el BOTÓN",
    !sinMuro.muroVisible && sinMuro.encima === "el-boton",
    JSON.stringify(sinMuro),
  );
  await ctx.shot("tras-cerrar-el-fallo");

  // ── D · El mismo viaje, con el motor sano, llega con ledger NUEVO ────────
  const t1 = Date.now();
  const d = await viajarPorSalidas(ctx, destino.name, "el mismo viaje con el motor sano, tras cerrar el muro").then(
    (llegada) => ({ llegada }),
    (err) => ({ err }),
  );
  const msD = Date.now() - t1;
  ctx.log(`D · desenlace en ${msD} ms: ${d.err ? `${d.err.name}: ${d.err.message}` : `${d.llegada.tile} · ledger ${JSON.stringify(d.llegada.ledger)}`}`);
  ctx.expect(
    "D1 · el mismo viaje LLEGA (el error del viaje anterior no lo paró)",
    Boolean(d.llegada),
    d.err ? `${d.err.name}: ${d.err.message}` : d.llegada.tile,
  );
  if (!d.llegada) return;
  ctx.expect(
    "D2 · y su ledger es NUEVO: otro `pedido` que el del viaje roto, mismo destino y sin error",
    d.llegada.ledger.pedido !== ledgerA.pedido &&
      d.llegada.ledger.placeId === destino.place_id &&
      d.llegada.ledger.error === null &&
      d.llegada.ledger.spawnAplicado !== null,
    `roto: pedido=${ledgerA.pedido} · llegado: ${JSON.stringify(d.llegada.ledger)}`,
  );
  ctx.expect(`D3 · en ≤ ${TECHO_MS} ms`, msD <= TECHO_MS, `${msD} ms`);
  await ctx.shot("llega-tras-el-roto");
}
