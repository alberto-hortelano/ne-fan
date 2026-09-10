/** El flujo REAL del jugador, empezando donde empieza él: el título.
 *
 *  Este guion existe por el caso de referencia del 2026-08-09: un panel
 *  "siempre visible" que renderizaba bien pero quedaba TAPADO por el
 *  title-screen justo en el flujo donde importaba — y la captura de
 *  verificación lo mostraba tapado, pero se ocultó el overlay para
 *  fotografiar en vez de leerlo como bug. Aquí el título se cierra por su
 *  botón, como haría una persona; nada de display:none. */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor = "cierra el título y carga una fixture del selector; nunca arranca partida";

import { cargarFixture } from "../lib/fixtures.mjs";

export default async function (ctx) {
  // Se espera al ESTADO que se va a afirmar, no al botón (#544). `#ts-close` lo
  // crea `armarChasis` desde el constructor de `TitleScreen`
  // (`ui/titulo/chasis.ts`), pero el overlay nace en `display:none` y no tapa
  // nada hasta `show()`, que llega seis `await` más tarde (`main.ts`: el
  // constructor a la 799, el `show` a la 1266). Entre las dos cosas hay una
  // ventana en la que el botón existe y `status().title` todavía es `false`:
  // afirmarlo ahí era afirmar antes de tiempo, y el guion salía rojo por una
  // carrera y no por un defecto del juego.
  //
  // La foto trae DOS señales independientes de que el título está de verdad
  // arriba —la del hook y la geometría del botón que este guion va a pulsar—,
  // para que el aserto no sea un eco de la espera.
  const tapando = await ctx.waitFor("el título aparece al arrancar y TAPA el juego", () => {
    const st = window.__nefan?.status();
    if (!st || st.title !== true) return null;
    const btn = document.getElementById("ts-close");
    return { ...st, cierrePulsable: Boolean(btn && btn.getBoundingClientRect().width > 0) };
  });
  ctx.expect(
    "el título tapa el juego al arrancar (estado 1 del sistema) y su botón de cierre está en pantalla",
    tapando.title === true && tapando.cierrePulsable === true,
    JSON.stringify(tapando),
  );
  await ctx.shot("titulo");

  // Camino del usuario: el botón de cierre, no ocultar el overlay.
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  // La carga AFIRMA qué escena quedó puesta (#308/#332): la espera propia que
  // había aquí volvería verde con la escena anterior todavía puesta.
  const mundo = await cargarFixture(ctx, "robledo_tile");
  ctx.expect("hay escena cargada tras elegir la fixture", (await ctx.nefan("status")).scene === true);
  ctx.expect("__nefan.ready() en verde", (await ctx.nefan("ready")) === true);

  // El tile no basta con QUE LLEGUE: tiene que quedar ACTIVO y con sus
  // superficies compuestas. El layout de superficies es lo que el atlas pide
  // al renderer, así que un tile activo sin él se queda en clay gris para
  // siempre y NADIE lo nota (no hay error: simplemente no se pide nada).
  // Es el riesgo del orden install/activar, y por eso se afirma aquí, sobre
  // la foto que devuelve `cargarFixture`.
  ctx.log(`fps: activo=${mundo.activeTile} · instalados=${JSON.stringify(mundo.tiles)}`);
  ctx.expect(
    "el tile activo tiene superficies instaladas (si no, clay gris sin pedir atlas jamás)",
    mundo.surfaces.includes(mundo.activeTile),
    `activo=${mundo.activeTile} superficies=${JSON.stringify(mundo.surfaces)}`,
  );
  ctx.expect(
    "y su geometría está montada en la escena three",
    mundo.tiles.includes(mundo.activeTile),
    JSON.stringify(mundo.tiles),
  );
  await ctx.shot("fixture");

  // El game loop corre de verdad en headless (?raf=timer): si el rAF estuviera
  // pausado el jugador no se movería y este guion sería un falso verde.
  const antes = (await ctx.nefan("state")).pos;
  const despues = await ctx.holdUntil(
    "up",
    "el jugador se mueve al mantener 'up'",
    (inicio) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - inicio.x, p.z - inicio.z) > 1 ? p : null;
    },
    10_000,
    antes,
  ).catch((err) => {
    ctx.expect("el jugador se mueve (rAF vivo en headless)", false, err.message);
    return null;
  });
  if (despues) {
    const d = Math.hypot(despues.x - antes.x, despues.z - antes.z);
    ctx.expect("el jugador se desplazó >1 m manteniendo 'up'", d > 1, `${d.toFixed(2)} m`);
  }
  await ctx.shot("movimiento");
}
