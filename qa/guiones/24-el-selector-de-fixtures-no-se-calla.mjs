/** Que el selector «Room» DIGA que una fixture no cargó (#248).
 *
 *  Antes de #248 el `change` del selector llamaba a `loadSceneFile(value)` —una
 *  `async function`— y soltaba la promesa: sin `void`, sin `.catch`, sin
 *  `paso()`. Si el módulo de la fixture no llegaba, el rechazo se perdía entero
 *  (el cliente no tiene handler de `unhandledrejection`) y el selector era un
 *  **no-op MUDO**: el `<select>` mostraba la fixture nueva, el mundo se quedaba
 *  en la anterior y no había ni una entrada en el registro de errores ni una
 *  línea en el juego. Es el modo de fallo de #181, en el selector que existe
 *  para conducir el preset `html-fixtures`.
 *
 *  `no-floating-promises` (eslint, desde #248) impide que vuelva a ESCRIBIRSE
 *  así, y `html-sin-promesa-muda` (arch-rules) impide la variante con `void`
 *  sin canal. Ninguna de las dos puede ver lo que aquí se afirma: que el fallo
 *  llegue a la PANTALLA. Ese es el hueco que cubre este guion.
 *
 *  Desde #269 mide además QUÉ NOMBRA el mensaje: la etiqueta que la persona
 *  eligió en el desplegable (`zorder_test`) y no la clave del glob con la que
 *  se importa (`@nefan-core/data/scenes/zorder_test.json`). Las dos salen ya
 *  de la misma derivación en core (`etiquetaDeFixture`), así que la opción
 *  pintada y el mensaje de fallo no pueden volver a divergir.
 *
 *  El fallo se inyecta en el BORDE —la petición del JSON de la fixture se
 *  aborta—, no dentro del cliente: es lo que pasa con una fixture ausente,
 *  corrupta o un dev server que se cayó a mitad. Nada se fuerza ni se stubea
 *  del lado del juego, y el `<select>` se conduce por su evento `change` real
 *  (`__nefan.loadFixture` hace `dispatchEvent(new Event("change"))`).
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor =
  "cierra el título y carga fixtures del selector, una de ellas con el JSON " +
  "abortado a propósito";

/** La fixture que se sabotea. La otra (`robledo_tile`) hace de control: si
 *  ninguna de las dos cargara, el verde de este guion no querría decir nada. */
const ROTA = "zorder_test";
const CONTROL = "robledo_tile";

/** Lo que el jugador tiene delante, leído del DOM: el panel de errores y las
 *  líneas del juego. No son píxeles — es el texto que se lee en pantalla, que
 *  es exactamente el sujeto de este guion. */
function loQueDiceLaPantalla() {
  return {
    entradas: [...document.querySelectorAll(".error-log__entry")].map((e) => ({
      fuente: e.querySelector(".error-log__source")?.textContent ?? "",
      msg: e.querySelector(".error-log__msg")?.textContent ?? "",
    })),
    lineas: [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? ""),
  };
}

export default async function (ctx) {
  // --- El flujo del jugador: el título se cierra por su botón ---
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? { hay: true } : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  // --- Control: una fixture que SÍ carga ---
  await ctx.nefan("loadFixture", CONTROL);
  await ctx.waitFor("la fixture de control pinta", () => (window.__nefan.status().scene ? { ok: true } : null));
  ctx.expect("el selector carga una fixture sana (control)", (await ctx.nefan("status")).scene === true);

  // --- El sabotaje, en el borde: el JSON de la otra fixture no llega nunca ---
  await ctx.page.route(`**/scenes/${ROTA}.json*`, (route) => route.abort("failed"));

  const antes = await ctx.page.evaluate(loQueDiceLaPantalla);

  // --- Se conduce el <select> REAL, por su evento `change` ---
  await ctx.nefan("loadFixture", ROTA);

  const dicho = await ctx
    .waitFor(
      "el cliente dice en pantalla que la fixture no cargó",
      (rota) => {
        const entrada = [...document.querySelectorAll(".error-log__entry")]
          .map((e) => ({
            fuente: e.querySelector(".error-log__source")?.textContent ?? "",
            msg: e.querySelector(".error-log__msg")?.textContent ?? "",
          }))
          .find((e) => e.msg.includes(rota) && /no se pudo cargar/i.test(e.msg));
        const linea = [...(document.getElementById("combat-log")?.children ?? [])]
          .map((c) => c.textContent ?? "")
          .find((t) => t.includes(rota) && /no se pudo cargar/i.test(t));
        return entrada && linea ? { entrada, linea } : null;
      },
      10_000,
      ROTA,
    )
    .catch(() => null);

  const ahora = await ctx.page.evaluate(loQueDiceLaPantalla);

  ctx.expect(
    "el fallo de la fixture deja ENTRADA en el registro de errores",
    Boolean(dicho?.entrada),
    `entradas ${antes.entradas.length} → ${ahora.entradas.length}: ${JSON.stringify(ahora.entradas.slice(0, 4))}`,
  );
  ctx.expect(
    "y una LÍNEA en el juego, donde el jugador está mirando",
    Boolean(dicho?.linea),
    `líneas: ${JSON.stringify(ahora.lineas.slice(0, 4))}`,
  );
  if (dicho) {
    ctx.log(`registro: [${dicho.entrada.fuente}] ${dicho.entrada.msg}`);
    ctx.log(`línea del juego: ${dicho.linea}`);
  }
  ctx.expect(
    "el mensaje NOMBRA la fixture que falló (un «algo falló» no sirve para nada)",
    Boolean(dicho?.entrada?.msg.includes(ROTA)) && Boolean(dicho?.linea?.includes(ROTA)),
    JSON.stringify({ entrada: dicho?.entrada?.msg, linea: dicho?.linea }),
  );
  // …y la NOMBRA COMO LA ELIGIÓ LA PERSONA (#269). Hasta esta tanda los dos
  // canales interpolaban el `value` del `<select>`, que es la clave del glob:
  // se eligió «zorder_test» y se leía «no se pudo cargar la fixture
  // @nefan-core/data/scenes/zorder_test.json». La ruta del disco no es asunto
  // de quien juega; el crudo sigue entero en el `detail` de la entrada.
  const rutaEnLoQueSeLee = [dicho?.entrada?.msg ?? "", dicho?.linea ?? ""].filter((t) =>
    /\.json|@nefan-core|scenes\//.test(t),
  );
  ctx.expect(
    "…con la ETIQUETA que se eligió, no con la ruta del glob (#269)",
    rutaEnLoQueSeLee.length === 0,
    JSON.stringify(rutaEnLoQueSeLee),
  );
  // La OTRA mitad del mismo bug, y la que sobrevivió al primer arreglo: decir
  // «no cargó» y dejar la etiqueta apuntando a la fixture que no cargó cambia
  // el fallo mudo por uno que MIENTE. Los dos canales de arriba se van del
  // log en ocho líneas; el desplegable se queda, y es lo primero que se mira
  // para saber qué se está viendo. Nació como hallazgo abierto del QA de #248
  // —medido con `ctx.log` para no envenenar la batería— y se asciende aquí en
  // el mismo commit que lo arregla.
  const etiqueta = await ctx.page.evaluate(() => ({
    select: document.getElementById("room-selector")?.value ?? "",
    mundo: window.__nefan.scene?.scene_id ?? "",
  }));
  ctx.log(`el <select> muestra "${etiqueta.select}" y el mundo está en "${etiqueta.mundo}"`);
  ctx.expect(
    "el <select> vuelve a la fixture que SÍ se está viendo, en vez de quedarse en la que falló",
    etiqueta.select.includes(CONTROL) && !etiqueta.select.includes(ROTA),
    JSON.stringify(etiqueta),
  );
  // El invariante de verdad, y escrito para que PUEDA ponerse rojo: no que
  // cada mitad sea `robledo_tile` por separado —eso seguía verde con el bug
  // dentro, porque el mundo nunca dejó de ser el control— sino que la etiqueta
  // y el mundo nombren LA MISMA escena, sea cual sea. El `mundo` no vacío es
  // guarda contra el `includes("")`, que sería verde siempre.
  ctx.expect(
    "…y el desplegable nombra la MISMA escena que el mundo pinta: la pantalla dice UNA cosa",
    etiqueta.mundo.length > 0 && etiqueta.select.includes(etiqueta.mundo),
    JSON.stringify(etiqueta),
  );
  await ctx.shot("selector-fixture-rota");

  // --- No es un estado sin salida: el selector sigue sirviendo ---
  await ctx.page.unroute(`**/scenes/${ROTA}.json*`);
  await ctx.nefan("loadFixture", CONTROL);
  const recuperado = await ctx
    .waitFor(
      "tras el fallo, el selector vuelve a cargar una fixture",
      () => {
        const f = window.__nefan.fps();
        return window.__nefan.status().scene && f && f.ready && f.activeTile ? f : null;
      },
      20_000,
    )
    .catch(() => null);
  ctx.expect(
    "un fallo de fixture no deja el cliente en un estado sin salida",
    Boolean(recuperado),
    recuperado ? `tile activo: ${recuperado.activeTile}` : "el selector dejó de responder tras el fallo",
  );
}
