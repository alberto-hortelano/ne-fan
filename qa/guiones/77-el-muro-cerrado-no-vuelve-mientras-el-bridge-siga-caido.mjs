/** Sin bridge el jugador ve UN muro, que no cambia de texto por debajo, y el que
 *  CERRÓ no vuelve con los reintentos del socket (#469).
 *
 *  Escrito por QA al validar el corte 1 de #358 (2026-09-06), que saca el muro
 *  de `main.ts` a `ui/muro-de-carga.ts`. Lo que midió entonces (sonda con
 *  `MutationObserver` sobre el muro, bloque 500): el aviso del socket a los
 *  ~180 ms («Sin conexión con la partida», `onerror` de bridge-client) y, a los
 *  ~5.100 ms, el timeout de `createGameClient` pintando OTRO muro con otro
 *  titular y un detalle en inglés; quien cerraba el primero veía el segundo
 *  cinco segundos después, y eso era lo que el issue llamaba «reaparecer». Con
 *  el segundo cerrado, 12 reintentos (≈ 60 s) no volvían a levantarlo:
 *  `ErrorLog` colapsa el aviso por (fuente, titular, mensaje) desde #423.
 *
 *  #469 abolió el segundo muro: el timeout del bootstrap entra al canal de
 *  avisos con el MISMO trío que el `onerror` del socket (`DETALLE_SIN_PARTIDA`)
 *  y la dedupe hace que para el jugador no exista. Por eso el paso 2 afirma
 *  que, cuando el bootstrap ya ha fallado (por ESTADO: la entrada `session`
 *  «bootstrap failed» del registro), el muro sigue siendo el mismo —igual
 *  titular, igual detalle— y que ni el titular ni el detalle han cambiado ni
 *  una vez por debajo desde el aviso (un `MutationObserver` cuenta los
 *  cambios de texto; comparar antes/después se perdería un ida-y-vuelta).
 *
 *  Y lo de siempre, por ESTADO y no por reloj: se cierra ese único muro y se
 *  espera a que el socket haya reintentado CUATRO veces más —cada reintento
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
 *  recuento —la vigilia corta en cuanto el muro asoma—; los asertos de arriba
 *  siguen verdes. Y el paso 2, con `detalleAlJugador` quitado del `push` del
 *  timeout de `createGameClient`: el detalle cambia por debajo al fallar el
 *  bootstrap y salen ROJOS «el muro sigue siendo el mismo» y «ni una vez por
 *  debajo». Restaurado después.
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

  // ── 2 · UN muro por la causa «sin bridge», y no cambia por debajo ───────
  const alAvisar = await ctx.waitFor(
    "el aviso del socket llega al muro (#306)",
    () => {
      const l = document.getElementById("narrative-loader");
      const titulo = document.getElementById("narrative-loader-title")?.textContent ?? "";
      if (!l?.classList.contains("error") || !titulo.includes("Sin conexión con la partida")) return null;
      // Desde aquí se cuentan los cambios de TEXTO del titular y del detalle:
      // un segundo muro por la misma causa se vería como un cambio, aunque
      // volviera al texto de antes.
      const cambios = [];
      const mira = (id) => {
        const el = document.getElementById(id);
        new MutationObserver(() => cambios.push(`${id}=${el?.textContent ?? ""}`)).observe(el, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      };
      mira("narrative-loader-title");
      mira("narrative-loader-detail");
      window.__qa77 = { cambios };
      return { titulo, detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "" };
    },
    8_000,
  );
  ctx.log(`al avisar: ${JSON.stringify(alAvisar)}`);
  // El bootstrap ha fallado cuando lo dice el REGISTRO (`bootstrap failed`,
  // fuente `session`, el `catch` de `main.ts`), no cuando pasan 5 s de reloj.
  await ctx.waitFor(
    "el bootstrap agota su timeout (la entrada «bootstrap failed» del registro)",
    () =>
      [...document.querySelectorAll(".error-log__entry")].some(
        (e) =>
          (e.querySelector(".error-log__source")?.textContent ?? "").trim() === "session" &&
          (e.querySelector(".error-log__msg")?.textContent ?? "").includes("bootstrap failed"),
      )
        ? true
        : null,
    20_000,
  );
  const puesto = await leerMuro(ctx);
  const cambios = await ctx.page.evaluate(() => window.__qa77.cambios);
  ctx.log(`tras el timeout del bootstrap: ${JSON.stringify(puesto)} · cambios de texto: ${JSON.stringify(cambios)}`);
  ctx.expect(
    "#469: tras el timeout del bootstrap el muro sigue siendo el MISMO (un muro por causa: igual titular, igual detalle)",
    puesto.visible &&
      puesto.enError &&
      puesto.titulo === alAvisar.titulo &&
      puesto.detalle === alAvisar.detalle,
    `antes ${JSON.stringify(alAvisar)} · después ${JSON.stringify({ titulo: puesto.titulo, detalle: puesto.detalle })}`,
  );
  ctx.expect(
    "…y ni el titular ni el detalle cambiaron ni una vez por debajo",
    cambios.length === 0,
    `${cambios.length} cambio(s): ${JSON.stringify(cambios)}`,
  );
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
