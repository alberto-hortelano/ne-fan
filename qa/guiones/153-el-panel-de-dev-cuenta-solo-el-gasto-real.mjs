/** EL PANEL DE DEV CUENTA SOLO EL GASTO REAL, Y CUANDO NO PUEDE LO DICE (#426, tanda AB).
 *
 *  Desde #426 cada evento del ledger de gasto lleva `procedencia` (`real` |
 *  `fixture`), `GET /dev/status` suma en `total_usd`/`call_count` SOLO los
 *  reales y desglosa las dos procedencias en `por_procedencia`. El panel de
 *  dev del cliente (`ui/dev-status-panel.ts`) es el ÚNICO lector de ese wire
 *  fuera de un test: pinta el total en euros en la línea visible y, en el
 *  tooltip de `#ds-spend`, «Total REAL: $X en N llamadas (fixture: $Y en M)».
 *  Entre el JSON y ese texto hay un `satisfies` en el fake y un tipo TS en el
 *  contrato, y ninguno de los dos mira si el cliente LEE el campo nuevo o si
 *  el texto que enseña es el del wire. Esto lo mira.
 *
 *  Y mira la otra mitad, que es la que se cobró un hallazgo: qué enseña el
 *  panel cuando ai_server CONTESTA y se NIEGA. Hasta la QA de esta tanda, el
 *  `!res.ok` entraba por el mismo `catch` que el fetch fallido, así que un
 *  remote-gen EN PIE devolviendo 500 se anunciaba como «ai_server offline» y
 *  su `detail` —el único texto accionable que el servidor produce a propósito:
 *  el `mv` que archiva un ledger anterior a #426— no llegaba ni al HUD ni al
 *  registro de errores. Se medía a mano; ahora no.
 *
 *  QUÉ AFIRMA:
 *   1. El tooltip llega a decir «Total REAL» con las CUATRO cifras (total,
 *      llamadas, fixture, llamadas de fixture) — o sea, el cliente ha leído
 *      `por_procedencia.fixture` sin reventar.
 *   2. Las cuatro son EXACTAMENTE las que sirve `/dev/status` en la misma URL
 *      que usa la página (`?ai=`, el motor falso): el panel no inventa, copia.
 *   3. La línea visible («total X €») sale de `total_usd` (solo real) por la
 *      tasa `config.usd_eur_rate`, nunca de la suma real + fixture.
 *   4. El panel NO está diciendo «ai_server offline» con el servicio en pie.
 *   5. Con `/dev/status` contestando **500 con `detail`** (interceptado aquí,
 *      sin tocar el fake): el panel dice que ai_server RECHAZA, **no** que está
 *      offline, PINTA el detalle, y la entrada llega al registro de errores con
 *      su fuente. Y al retirar la intercepción se RECUPERA solo: el rechazo no
 *      se queda pegado.
 *
 *  LO QUE NO MIDE, dicho para que nadie lo cuente de más: el motor falso sirve
 *  el gasto A CEROS (`fake-ai-server.ts`, `/dev/status`), así que aquí real y
 *  fixture valen lo mismo y (3) no distingue «solo real» de «todo». Esa
 *  distinción vive en `ai_server/tests/test_spend_tracker.py` (el tracker) y
 *  en el paso 6 de `qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs` (el
 *  camino de producción sin `unittest`), que son quienes la miden con dinero
 *  de mentira encima. El bloque 5 mide que el 500 LLEGA, no que remote-gen lo
 *  emita por el motivo correcto: el `detail` de aquí es texto de atrezo con la
 *  forma del real, y quien afirma el 500 de verdad es
 *  `test_dev_status_sobre_un_ledger_anterior_a_426_es_500_con_el_remedio`.
 *  Tampoco mide el 502 del adaptador ni ninguna otra puerta de ai_server.
 *
 *  Sin partida: el panel se construye al cargar la página y sondea desde el
 *  título, que es donde se lee. CERO CRÉDITOS: `/dev/status` no es una puerta
 *  de gasto y el guion no pide nada más.
 *
 *  EN NEGATIVO (cada sabotaje revertido y comprobado):
 *   · 2026-09-20, al escribirlo: quitando `por_procedencia` al `/dev/status`
 *     del fake, `renderSpend` revienta antes de escribir el tooltip y (1)
 *     expira → ROJO. Cambiando en el cliente el `total_usd` del tooltip por
 *     `por_procedencia.fixture.usd`… sale VERDE, porque con el fake a ceros son
 *     la misma cifra: es el límite de arriba, no un descuido.
 *   · El bloque 5, con el `poll()` de antes del arreglo (el `!res.ok` otra vez
 *     por el camino de «no responde», `marcarCaido()`): el panel vuelve a decir
 *     «ai_server offline» y el guion muere en la PRIMERA espera —
 *     `✘ ERROR: timeout esperando: el panel dice que ai_server RECHAZA
 *     /dev/status (último valor: null)`, `0 en verde · 1 en rojo`, EXIT=1—.
 *     Medido, y se dice así y no «caen los cuatro»: la espera LANZA, o sea que
 *     los otros tres asertos del rechazo no llegan a correrse. Es el hallazgo
 *     H1 de la QA convertido en rojo re-corrible.
 */

export const sinMotor =
  "solo lee el panel de dev del título, que sondea GET /dev/status del motor falso; no arranca partida ni pide nada de pago";

const TOOLTIP = /Total REAL: \$(\d+\.\d{2}) en (\d+) llamadas \(fixture: \$(\d+\.\d{2}) en (\d+)\)/;

/** El `detail` de atrezo del bloque 5: la FORMA del que emite `dev_status` ante
 *  un ledger anterior a #426 (`spend_tracker.LedgerIlegible`), con una marca
 *  que no puede salir de ningún otro sitio de la página. */
const MARCA = "QA153-LEDGER-VIEJO";
const DETALLE_500 =
  `/tmp/${MARCA}/cache/spend/events.jsonl:1 es un evento sin \`procedencia\`: un ledger ` +
  `anterior a #426 no se migra ni se marca, se ARCHIVA como en T9 → ` +
  `mkdir -p /tmp/${MARCA}/archivo/cache/spend && mv /tmp/${MARCA}/cache/spend/events.jsonl ` +
  `/tmp/${MARCA}/archivo/cache/spend/events-sin-procedencia-2026-09-20.jsonl`;

/** Lo que el panel enseña, tal cual lo lee quien mira el HUD. */
const leerElPanel = () => {
  const spend = document.getElementById("ds-spend");
  const config = document.getElementById("ds-config");
  return {
    linea: (spend?.textContent ?? "").trim(),
    tooltip: spend?.title ?? "",
    config: (config?.textContent ?? "").trim(),
    configTooltip: config?.title ?? "",
  };
};

/** Las entradas del registro de errores, como las pinta `ui/error-log.ts`. */
const leerElRegistro = () =>
  [...document.querySelectorAll("#error-log .error-log__entry")].map((e) => ({
    fuente: (e.querySelector(".error-log__source")?.textContent ?? "").trim(),
    msg: (e.querySelector(".error-log__msg")?.textContent ?? "").trim(),
    detalle: (e.querySelector(".error-log__detail")?.textContent ?? "").trim(),
  }));

export default async function (ctx) {
  const ai = new URL(ctx.page.url()).searchParams.get("ai");
  if (!ai) ctx.sinMedir("la página no lleva `?ai=`: no sé a qué /dev/status está sondeando el panel");

  // 1 · el panel ha sondeado y ha pintado el desglose. Espera de PARED: el
  // sujeto es otro proceso (el poll al fake), no el mundo.
  const panel = await ctx.waitFor(
    "el tooltip de #ds-spend dice «Total REAL … (fixture: …)»",
    () => {
      const spend = document.getElementById("ds-spend");
      return spend && /Total REAL/.test(spend.title) ? true : null;
    },
    15_000,
  ).then(() => ctx.page.evaluate(leerElPanel));
  ctx.log(`panel: ${JSON.stringify(panel)}`);

  const m = TOOLTIP.exec(panel.tooltip);
  ctx.expect("1 · el tooltip trae el total REAL y el de fixture, los dos con cifra y recuento", Boolean(m), panel.tooltip);
  ctx.expect("4 · el panel no dice «offline» con el servicio en pie", !/offline/i.test(panel.config), panel.config);
  if (!m) return;

  // 2 · las mismas cuatro cifras que el wire, leído en la MISMA URL que usa la página.
  const res = await fetch(`${ai}/dev/status`);
  ctx.expect("2 · /dev/status contesta 200 en la URL que sondea el panel", res.ok, `HTTP ${res.status}`);
  if (!res.ok) return;
  const st = await res.json();
  const wire = {
    total: st.spend.total_usd.toFixed(2),
    llamadas: String(st.spend.call_count),
    fixture: st.spend.por_procedencia.fixture.usd.toFixed(2),
    llamadasFixture: String(st.spend.por_procedencia.fixture.call_count),
  };
  const pintado = { total: m[1], llamadas: m[2], fixture: m[3], llamadasFixture: m[4] };
  ctx.expect(
    "2 · las cuatro cifras del tooltip son las del wire",
    JSON.stringify(pintado) === JSON.stringify(wire),
    `tooltip=${JSON.stringify(pintado)} wire=${JSON.stringify(wire)}`,
  );

  // 3 · la línea visible sale de total_usd (solo real) por la tasa del wire.
  const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    st.spend.total_usd * st.config.usd_eur_rate,
  );
  const norm = (s) => s.replace(/\s+/g, " ");
  ctx.expect(
    "3 · la línea visible dice el total REAL en euros por la tasa del wire",
    norm(panel.linea).endsWith(norm(`total ${euros}`)),
    `línea=${JSON.stringify(panel.linea)} esperado=…total ${euros}`,
  );

  await ctx.shot("panel-dev-gasto-real");

  // ── 5 · el rechazo con respuesta NO es una caída (H1 de la QA) ───────────
  // Se interviene el WIRE, no el fake: el motor falso no sabe contestar 500 y
  // darle un interruptor para esto sería inventarle una conducta que ningún
  // servicio tiene. `page.route` deja al cliente exactamente delante de lo que
  // le sirve remote-gen con un ledger anterior a #426.
  await ctx.page.route("**/dev/status", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: DETALLE_500 }),
    });
  });
  const rechazo = await ctx
    .waitFor(
      "el panel dice que ai_server RECHAZA /dev/status (no que está caído)",
      () => {
        const c = document.getElementById("ds-config");
        return c && /rechaza/i.test(c.textContent ?? "") ? true : null;
      },
      20_000,
    )
    .then(() => ctx.page.evaluate(leerElPanel));
  ctx.log(`panel con el 500: ${JSON.stringify(rechazo)}`);

  ctx.expect(
    "5 · con el 500, el panel NO dice «offline»: el servicio está en pie y contestando",
    !/offline/i.test(rechazo.config) && /HTTP 500/.test(rechazo.config),
    `config=${JSON.stringify(rechazo.config)}`,
  );
  ctx.expect(
    "5 · …y PINTA el detalle accionable que manda el servidor (el `mv` del archivo)",
    rechazo.configTooltip.includes(MARCA) && /mkdir -p .*archivo\/cache\/spend/.test(rechazo.configTooltip),
    `tooltip=${JSON.stringify(rechazo.configTooltip.slice(0, 160))}`,
  );

  const registro = await ctx.page.evaluate(leerElRegistro);
  const entrada = registro.find((e) => /rechaza GET \/dev\/status/.test(e.msg));
  ctx.expect(
    "5 · …y la entrada llega al REGISTRO DE ERRORES con su fuente y su detalle",
    Boolean(entrada) && entrada.fuente === "config" && entrada.detalle.includes(MARCA),
    JSON.stringify(entrada ?? registro.map((e) => e.msg)),
  );
  await ctx.shot("panel-dev-rechazo-500");

  // …y se recupera solo cuando el servicio vuelve a servir: el rechazo no se
  // queda pegado (sin esto, «lo dice» sería indistinguible de «se rompió»).
  await ctx.page.unroute("**/dev/status");
  const vuelta = await ctx
    .waitFor(
      "el panel vuelve a pintar el gasto cuando /dev/status vuelve a contestar 200",
      () => {
        const c = document.getElementById("ds-config");
        return c && !/rechaza/i.test(c.textContent ?? "") ? true : null;
      },
      20_000,
    )
    .then(() => ctx.page.evaluate(leerElPanel));
  ctx.expect(
    "5 · …y al volver el 200 el panel se recupera solo (ni «rechaza» ni «offline»)",
    !/rechaza|offline/i.test(vuelta.config) && /Total REAL/.test(vuelta.tooltip),
    `config=${JSON.stringify(vuelta.config)}`,
  );
}
