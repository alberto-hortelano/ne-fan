/** El flujo REAL del jugador, empezando donde empieza él: el título.
 *
 *  Este guion existe por el caso de referencia del 2026-08-09: un panel
 *  "siempre visible" que renderizaba bien pero quedaba TAPADO por el
 *  title-screen justo en el flujo donde importaba — y la captura de
 *  verificación lo mostraba tapado, pero se ocultó el overlay para
 *  fotografiar en vez de leerlo como bug. Aquí el título se cierra por su
 *  botón, como haría una persona; nada de display:none. */
export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => {
    const btn = document.getElementById("ts-close");
    return btn ? { hay: true } : null;
  });
  const tapando = await ctx.nefan("status");
  ctx.expect("el título tapa el juego al arrancar (estado 1 del sistema)", tapando.title === true, JSON.stringify(tapando));
  await ctx.shot("titulo");

  // Camino del usuario: el botón de cierre, no ocultar el overlay.
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  await ctx.nefan("loadFixture", "robledo_tile");
  const estado = await ctx.waitFor("la fixture carga", () => {
    const s = window.__nefan.status();
    return s.scene ? s : null;
  });
  ctx.expect("hay escena cargada tras elegir la fixture", estado.scene === true);
  ctx.expect("__nefan.ready() en verde", (await ctx.nefan("ready")) === true);

  // El tile no basta con QUE LLEGUE: tiene que quedar ACTIVO y con sus
  // superficies compuestas. El layout de superficies es lo que el atlas pide
  // al renderer, así que un tile activo sin él se queda en clay gris para
  // siempre y NADIE lo nota (no hay error: simplemente no se pide nada).
  // Es el riesgo del orden install/activar, y por eso se afirma aquí.
  const mundo = await ctx.waitFor(
    "el mundo 3D instala el tile de la fixture",
    () => {
      const f = window.__nefan.fps();
      return f && f.ready && f.activeTile ? f : null;
    },
    20_000,
  );
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
