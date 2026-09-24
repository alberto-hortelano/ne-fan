/** UN VIAJE QUE EL BRIDGE DECLARA ROTO PARA LA ESPERA EN SEGUNDOS (#693).
 *
 *  Once esperas de viaje por el panel «Salidas» tenían cada una su predicado de
 *  llegada, y siete no miraban `window.__nefan.viaje.error`: un viaje roto
 *  quemaba el cortafuegos del tile entero (`MS_DEL_TILE`, 90 s) y salía rojo
 *  por expiración, sin el nombre de la causa. Desde #693 son UNA función,
 *  `viajarPorSalidas` (`qa/lib/viaje.mjs`), y esto mide que PARA por estado:
 *
 *   A · con el motor falso en `mode:"error"` (el tile del destino revienta con
 *       HTTP 500 y el bridge difunde el `narrative_status` de error que termina
 *       el viaje), la espera lanza `ViajeRoto` en ≤ `TECHO_MS`, y el mensaje
 *       NOMBRA la causa: «el bridge abortó el viaje» + lo que el bridge dijo
 *       (que nombra el destino; el texto crudo del motor NO llega al cliente:
 *       el bridge lo traduce a una frase para el jugador).
 *   M · LO QUE TIENE DELANTE EL JUGADOR tras el roto: el muro «No se pudo
 *       llegar» tapa el panel, y `pulsarSalida` se NIEGA a atravesarlo:
 *       lanza `SalidaTapada` nombrando `#narrative-loader`, al instante y sin
 *       pedir el viaje (el `pedido` del ledger no se mueve). Antes pulsaba con
 *       `element.click()` y el control de abajo viajaba sin que nadie cerrara
 *       el muro (hallazgo 1 de la QA de la tanda AP). Luego se pulsa «Cerrar»
 *       con el puntero, como el jugador.
 *   B · CONTROL: con el motor devuelto a su conducta y el muro cerrado, el
 *       MISMO viaje llega. Sin esto, A pasaría verde también si
 *       `viajarPorSalidas` lanzara siempre, o si el viaje no se pidiera nunca.
 *
 *  EN NEGATIVO (hecho a mano al escribirlo, con el tiempo en implementacion.md
 *  de la tanda AP): quitando la rama `if (v.error)` de `sondaDeViaje`, A tiene
 *  que salir ROJO — la espera ya no para por estado, agota los 90 s, y el
 *  aserto del tiempo lo dice con su cifra.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el motor es el fake-ai-server, y
 *  su conducta ante un tile se cambia en caliente con `POST /dev/tiles` (#516,
 *  molde del guion 109) y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { SalidaTapada, ViajeRoto, pulsarSalida, viajarPorSalidas } from "../lib/viaje.mjs";
import { URLS } from "../lib/stack.mjs";

/** Partida virgen y motor falso en su turno 0: este guion le CAMBIA la
 *  conducta, y `/dev/reset` es la red por si el `finally` no llegara. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Cuánto puede tardar en saberse que el viaje está roto. Con el falso toda
 *  boca de fallo habla en menos de 2 s (cabecera de `MS_DEL_TILE`); 10 s deja
 *  margen a una máquina cargada y sigue a 9× del cortafuegos que se pagaba. */
const TECHO_MS = 10_000;

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

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  const salidas = await ctx.nefan("exits");
  ctx.expect("el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];

  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());
  ctx.log(`conducta inicial del motor falso: ${JSON.stringify(inicial)}`);

  // ── A · El viaje roto para en segundos y nombra la causa ────────────────
  let roto;
  let msRoto;
  try {
    await conducta(ctx, { mode: "error" });
    const t0 = Date.now();
    roto = await viajarPorSalidas(ctx, destino.name, `el viaje a «${destino.name}» con el motor fallando`).then(
      (llegada) => ({ llegada }),
      (err) => ({ err }),
    );
    msRoto = Date.now() - t0;
  } finally {
    await conducta(ctx, inicial);
  }
  ctx.log(`A · desenlace en ${msRoto} ms: ${roto.err ? `${roto.err.name}: ${roto.err.message}` : JSON.stringify(roto.llegada)}`);
  ctx.expect(
    "A · con el motor fallando, el viaje NO llega: la espera lanza ViajeRoto",
    roto.err instanceof ViajeRoto,
    roto.err ? `${roto.err.name}: ${roto.err.message}` : `llegó: ${JSON.stringify(roto.llegada)}`,
  );
  ctx.expect(
    `A · y lo sabe en ≤ ${TECHO_MS} ms, no al agotar el cortafuegos del tile`,
    msRoto <= TECHO_MS,
    `${msRoto} ms`,
  );
  ctx.expect(
    "A · el rojo NOMBRA la causa: el bridge abortó el viaje, con lo que dijo el bridge del destino",
    (roto.err?.message ?? "").includes(`el bridge abortó el viaje: No se pudo llegar a ${destino.name}`),
    roto.err?.message ?? "(sin error)",
  );
  await ctx.shot("viaje-roto");

  // ── M · El muro tapa el panel, y el clic del banco no lo atraviesa ──────
  const pedidoAntes = await ctx.page.evaluate(() => window.__nefan.viaje?.pedido ?? null);
  const tapado = await pulsarSalida(ctx, destino.name).then(
    (pulsó) => ({ pulsó }),
    (err) => ({ err }),
  );
  const pedidoDespues = await ctx.page.evaluate(() => window.__nefan.viaje?.pedido ?? null);
  ctx.log(`M · pulsar con el muro abierto: ${tapado.err ? `${tapado.err.name}: ${tapado.err.message}` : `pulsó=${tapado.pulsó}`}`);
  ctx.expect(
    "M1 · con el muro «No se pudo llegar» abierto, pulsarSalida lanza SalidaTapada nombrando el muro (#narrative-loader)",
    tapado.err instanceof SalidaTapada && /#narrative-loader\b/.test(tapado.err.message) && /No se pudo llegar/.test(tapado.err.message),
    tapado.err ? `${tapado.err.name}: ${tapado.err.message}` : `pulsó=${tapado.pulsó}`,
  );
  ctx.expect(
    "M2 · y no pidió ningún viaje: el `pedido` del ledger es el del viaje roto",
    pedidoDespues === pedidoAntes,
    `antes=${pedidoAntes} · después=${pedidoDespues}`,
  );
  // El camino del jugador: «Cerrar», con el puntero (falla si algo lo tapa).
  await ctx.page.click("#narrative-loader-dismiss");

  // ── B · CONTROL: el mismo viaje, con el motor sano, llega ───────────────
  const t1 = Date.now();
  const control = await viajarPorSalidas(ctx, destino.name, `el viaje a «${destino.name}» con el motor sano`).then(
    (llegada) => ({ llegada }),
    (err) => ({ err }),
  );
  const msControl = Date.now() - t1;
  ctx.log(`B · desenlace en ${msControl} ms: ${control.err ? control.err.message : control.llegada.tile}`);
  ctx.expect(
    "B · control: con el motor sano y el muro cerrado, el mismo viaje LLEGA (el verde de A no sale de no viajar nunca)",
    Boolean(control.llegada),
    control.err ? control.err.message : control.llegada.tile,
  );
  await ctx.shot("control-llega");
}
