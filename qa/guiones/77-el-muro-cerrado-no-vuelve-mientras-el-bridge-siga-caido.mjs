/** El muro «sin bridge» que el jugador CERRÓ no vuelve con los reintentos del socket (#469).
 *
 *  Escrito por QA al validar el corte 1 de #358 (2026-09-06), que saca el muro
 *  de `main.ts` a `ui/muro-de-carga.ts` y mueve #469 tal cual. El issue dice que
 *  en `html-fixtures` «cada ~5 s el reintento del socket vuelve a levantar el
 *  muro que el jugador ya cerró», y pide que `fixtures-sin-bridge.mjs` afirme
 *  que no reaparece. Nadie lo medía: la QA de T13 que lo abrió lo vio a ojo.
 *
 *  MEDIDO antes de escribirlo (sonda con `MutationObserver` sobre el muro,
 *  bloque 500, 2026-09-06): sin bridge el arranque pinta DOS muros con causas
 *  distintas —el aviso del socket a los ~180 ms («Sin conexión con la partida»,
 *  `onerror` de bridge-client) y el de `bootstrap` a los ~5.100 ms («No se pudo
 *  arrancar la partida», el timeout de `createGameClient`)—, y quien cierra el
 *  primero ve aparecer el segundo cinco segundos después: eso es lo que parece
 *  «reaparecer cada ~5 s». Cerrado el segundo, 12 reintentos del socket (≈ 60 s)
 *  no volvieron a levantarlo ni una vez: `ErrorLog` colapsa el aviso por
 *  (fuente, titular, mensaje) desde #423, y el reintento repite el texto.
 *
 *  Lo que se afirma, por ESTADO y no por reloj: se cierra el muro de bootstrap y
 *  se espera a que el socket haya reintentado CUATRO veces más —cada reintento
 *  deja una entrada `bridge` en `#error-log`, que sí crece aunque el aviso se
 *  colapse— vigilando el muro en cada sondeo. Un muro que reaparece se queda
 *  puesto hasta que alguien lo cierre, así que el sondeo no puede perdérselo.
 *
 *  Cómo se llega sin bridge dentro de la batería (que SÍ tiene bridge): se
 *  apunta el socket de la página a un host y un puerto donde no hay nadie con
 *  `?bridge=`, la misma técnica de la segunda pasada de `fixtures-sin-bridge.mjs`
 *  (`127.0.0.2`, puerto del bridge + 3). No se toca ningún proceso.
 *
 *  PROBADO EN NEGATIVO (2026-09-06): con la dedupe de `ErrorLog.avisa` anulada
 *  (`if (this.yaAvisados.has(clave)) return;` comentado), el muro vuelve a
 *  pintarse en el PRIMER reintento y este guion se pone ROJO en su aserto de
 *  reaparición («reapareció tras 1 reintento(s)») y, por arrastre, en el del
 *  recuento —la vigilia corta en cuanto el muro asoma—; los dos asertos de
 *  arriba (botones y cierre) siguen verdes. Restaurado después.
 *
 *  Cero créditos: sin socket no hay partida, y no se le pide nada al motor.
 */
export const sinMotor =
  "apunta el socket de la página a un host y puerto sin nadie (`?bridge=`, como fixtures-sin-bridge); " +
  "sin bridge no hay partida ninguna y no se le pide nada al motor";

const HOST_MOVIDO = "127.0.0.2";

/** El muro tal y como lo ve quien juega (mismo lector que el 20 y el 71): un
 *  botón se ve si OCUPA SITIO, no por su atributo `hidden`. */
const leerMuro = (ctx) =>
  ctx.page.evaluate(() => {
    const l = document.getElementById("narrative-loader");
    const volver = document.getElementById("narrative-loader-back");
    const cerrar = document.getElementById("narrative-loader-dismiss");
    return {
      visible: Boolean(l?.classList.contains("visible")),
      enError: Boolean(l?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
      volverVisible: Boolean(volver) && volver.offsetParent !== null,
      cerrarVisible: Boolean(cerrar) && cerrar.offsetParent !== null,
    };
  });

/** Cuántas entradas de la fuente `bridge` hay en el registro: una por intento
 *  del socket (`onerror` hace `errors.push` aunque el aviso al jugador se
 *  colapse). Es el reloj del socket leído del propio cliente. */
const reintentosDelSocket = () =>
  [...document.querySelectorAll(".error-log__entry .error-log__source")].filter((e) =>
    /^bridge$/.test((e.textContent ?? "").trim()),
  ).length;

export default async function (ctx) {
  // ── 1 · el socket, a donde no hay nadie ────────────────────────────────
  const gateway = await ctx.page.evaluate(() => window.__nefan.servicios()["game-gateway"]);
  const puertoMuerto = Number(new URL(gateway).port) + 3;
  const url = new URL(ctx.page.url());
  url.searchParams.set("bridge", `ws://${HOST_MOVIDO}:${puertoMuerto}`);
  ctx.log(`socket movido a ${url.searchParams.get("bridge")} (el real era ${gateway})`);
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin bridge", () => Boolean(window.__nefan));

  // ── 2 · los dos muros del arranque sin bridge, en su orden ──────────────
  await ctx.waitFor(
    "el aviso del socket llega al muro (#306)",
    () =>
      (document.getElementById("narrative-loader-title")?.textContent ?? "").includes(
        "Sin conexión con la partida",
      )
        ? true
        : null,
    8_000,
  );
  await ctx.waitFor(
    "el muro de bootstrap (el timeout de createGameClient)",
    () =>
      document.getElementById("narrative-loader")?.classList.contains("error") === true &&
      (document.getElementById("narrative-loader-title")?.textContent ?? "").includes(
        "No se pudo arrancar la partida",
      )
        ? true
        : null,
    20_000,
  );
  const puesto = await leerMuro(ctx);
  ctx.log(`muro de bootstrap: ${JSON.stringify(puesto)}`);
  ctx.expect(
    "el muro del arranque sin bridge ofrece «Cerrar» y no «Volver al título» (detrás queda el visor de fixtures)",
    puesto.cerrarVisible && !puesto.volverVisible,
    JSON.stringify(puesto),
  );

  // ── 3 · el jugador lo cierra ────────────────────────────────────────────
  await ctx.page.evaluate(() => document.getElementById("narrative-loader-dismiss")?.click());
  const cerrado = await leerMuro(ctx);
  ctx.expect("«Cerrar» cierra el muro", cerrado.visible === false, JSON.stringify(cerrado));
  const reintentosAlCerrar = await ctx.page.evaluate(reintentosDelSocket);

  // ── 4 · el socket sigue reintentando y el muro NO vuelve ────────────────
  //
  // Por ESTADO: cuatro entradas `bridge` más en el registro. El muro se mira en
  // cada sondeo y, si asoma, la espera termina ahí con la prueba en la mano.
  const vigilia = await ctx.waitFor(
    "el socket reintenta 4 veces más (lo cuenta el registro) mientras se vigila el muro",
    (n0) => {
      const l = document.getElementById("narrative-loader");
      const n =
        [...document.querySelectorAll(".error-log__entry .error-log__source")].filter((e) =>
          /^bridge$/.test((e.textContent ?? "").trim()),
        ).length - n0;
      if (l?.classList.contains("visible")) {
        return {
          reaparecio: true,
          reintentos: n,
          titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
        };
      }
      return n >= 4 ? { reaparecio: false, reintentos: n } : null;
    },
    60_000,
    reintentosAlCerrar,
  );
  ctx.log(`tras cerrar: ${JSON.stringify(vigilia)}`);
  ctx.expect(
    "#469: el muro que el jugador cerró NO vuelve con los reintentos del socket",
    vigilia.reaparecio === false,
    vigilia.reaparecio
      ? `reapareció tras ${vigilia.reintentos} reintento(s): «${vigilia.titulo}»`
      : `${vigilia.reintentos} reintentos sin muro`,
  );
  ctx.expect(
    "…y el registro sí apunta cada reintento: se colapsa el AVISO, no la verdad",
    vigilia.reintentos >= 4,
    `${vigilia.reintentos} entradas bridge nuevas`,
  );
  await ctx.shot("469-muro-cerrado-tras-los-reintentos");
}
