/** EL MURO DE FALLO NO CONSERVA EL ANILLO DEL SPINNER (#737, menor).
 *
 *  Hasta la tanda AT, `#narrative-loader.error .spinner` paraba la animación y
 *  teñía el anillo del color del fallo: bajo «No se pudo llegar» quedaba un
 *  aro parado que dice «esto aún carga» cuando ya no carga nada (lo anotó la
 *  QA de #693). Desde #737 el anillo no se pinta en NINGÚN muro con `.error`
 *  —fallo in-game, oferta de reintentar y muro de arranque son el mismo
 *  elemento—, y el muro de ESPERA lo conserva girando: sin él, el «Viajando...»
 *  sería un cartel mudo.
 *
 *  Un solo viaje, dos fotos del mismo muro:
 *
 *   ESPERA · con el motor falso dormido (`delay_ms`), el «Viajando...» tiene el
 *            anillo VISIBLE y animado.
 *   FALLO  · el motor falso pasa a `mode:"error"` mientras duerme (lee el modo
 *            vivo al despertar) y el viaje se rompe: el muro es «No se pudo
 *            llegar», con `.error`, SIN anillo y sin reloj huérfano.
 *
 *  Se mide el estilo CALCULADO del anillo, no la clase: la regla vive en
 *  `nefan-html/src/ui/game-ui.css` y un `display` que no sea `none` es el
 *  anillo en pantalla.
 *
 *  LO QUE ESTO NO MIDE: los otros dos muros con `.error`. La oferta de
 *  reintentar la pinta el guion 78 (captura `478-la-oferta-de-entrar`) y el
 *  muro de arranque necesita un `combat_config.json` roto, que no es cosa de
 *  un guion. Los tres comparten selector; la captura de los otros dos es
 *  revisión visual de QA (`docs/agents/2026-09-24-tanda-at-…/qa.md`).
 *
 *  EN NEGATIVO (a mano al escribirlo): devolver la regla vieja
 *  (`animation: none; border-top-color: currentColor`) pone rojo el aserto
 *  «FALLO · sin anillo».
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso; su conducta se
 *  cambia con `POST /dev/tiles` (#516) y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { ViajeRoto, viajarPorSalidas } from "../lib/viaje.mjs";
import { URLS } from "../lib/stack.mjs";

/** Partida virgen y motor falso en su turno 0: este guion le CAMBIA la
 *  conducta, y `/dev/reset` es la red por si el `finally` no llegara. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Cuánto duerme el motor falso ante el tile del viaje: el margen para
 *  fotografiar el «Viajando...» y cambiarle la conducta antes de que conteste. */
const MS_DEL_TILE_LENTO = 4_000;
/** Techo de cada espera por condición: socket local y motor falso. */
const TECHO_MS = 20_000;

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

/** El muro tal como lo pinta el navegador: clases, textos y el estilo
 *  CALCULADO del anillo. */
function foto(ctx) {
  return ctx.page.evaluate(() => {
    const muro = document.getElementById("narrative-loader");
    const spinner = muro?.querySelector(".spinner");
    const estilo = spinner ? getComputedStyle(spinner) : null;
    return {
      visible: Boolean(muro?.classList.contains("visible")),
      error: Boolean(muro?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      elapsed: document.getElementById("narrative-loader-elapsed")?.textContent ?? "",
      anillo: estilo ? { display: estilo.display, animacion: estilo.animationName } : null,
    };
  });
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

  let fin = null;
  try {
    await conducta(ctx, { delay_ms: MS_DEL_TILE_LENTO });
    const pedidoPrevio = await ctx.page.evaluate(() => window.__nefan.viaje?.pedido ?? null);
    const viaje = viajarPorSalidas(ctx, destino.name, `el viaje a «${destino.name}» que se rompe mientras espera`).then(
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

    // ── ESPERA · el «Viajando...» lleva su anillo ───────────────────────────
    const espera = await foto(ctx);
    ctx.log(`ESPERA · ${JSON.stringify(espera)}`);
    ctx.expect(
      "ESPERA · el muro «Viajando...» no es de error y su anillo se pinta y gira",
      espera.visible && !espera.error && espera.titulo === "Viajando..." &&
        espera.anillo !== null && espera.anillo.display !== "none" && espera.anillo.animacion !== "none",
      JSON.stringify(espera),
    );
    await ctx.shot("espera-con-anillo");

    // ── FALLO · el motor revienta al despertar y el muro cambia ────────────
    await conducta(ctx, { mode: "error" });
    fin = await viaje;
  } finally {
    await conducta(ctx, inicial);
  }
  ctx.log(`desenlace: ${fin.err ? `${fin.err.name}: ${fin.err.message}` : JSON.stringify(fin.llegada)}`);
  ctx.expect(
    "FALLO · el viaje se rompe (ViajeRoto): el muro que sigue es el de fallo, no una llegada",
    fin.err instanceof ViajeRoto,
    fin.err ? `${fin.err.name}: ${fin.err.message}` : `llegó: ${JSON.stringify(fin.llegada)}`,
  );
  const fallo = await foto(ctx);
  ctx.log(`FALLO · ${JSON.stringify(fallo)}`);
  ctx.expect(
    "FALLO · el muro es de error y dice «No se pudo llegar»",
    fallo.visible && fallo.error && fallo.titulo === "No se pudo llegar",
    JSON.stringify(fallo),
  );
  ctx.expect(
    "FALLO · sin anillo: el spinner no se pinta bajo el título del fallo",
    fallo.anillo !== null && fallo.anillo.display === "none",
    JSON.stringify(fallo.anillo),
  );
  ctx.expect(
    "FALLO · sin reloj huérfano: el contador de la espera se borra",
    fallo.elapsed === "",
    `elapsed=«${fallo.elapsed}»`,
  );
  await ctx.shot("fallo-sin-anillo");
  // El camino del jugador: «Cerrar», con el puntero (falla si algo lo tapa).
  await ctx.page.click("#narrative-loader-dismiss");
}
