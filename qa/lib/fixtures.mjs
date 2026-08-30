/** Cargar una fixture del selector «Room» y SABER que se cargó, más la
 *  compuerta que permite demostrarlo.
 *
 *  POR QUÉ EXISTE (#308). `window.__nefan.loadFixture` era *fire-and-forget*:
 *  ponía el `value` del `<select>`, despachaba `change` y devolvía `undefined`;
 *  el import perezoso del JSON resolvía después. Los dos guiones que cargaban
 *  una SEGUNDA fixture sin recargar página (22 y 23) tenían cada uno su copia
 *  de la espera, y la del 22 esperaba dos condiciones que la fixture ANTERIOR
 *  ya satisfacía —`status().scene` (que solo anula `resetWorld`) y
 *  `fps().activeTile` (`tile_0_0` en las dos: ambas son `tile{0,0}`)—, así que
 *  volvía en 3 ms con el puerto todavía puesto. Lo caro no era el rojo: era el
 *  VERDE. La corrida del 2026-08-30 sobre `711c1f7` salió en verde diciendo
 *  «suelo del puerto: 57 calcos» y «suelo de robledo: 57 calcos» — midió el
 *  puerto dos veces y afirmó tres cosas sobre campo abierto.
 *
 *  Hoy `loadFixture` devuelve su promesa, así que la pregunta «¿qué escena hay
 *  puesta?» tiene respuesta ANTES de medir nada. Por eso aquí se AFIRMA en vez
 *  de esperar: un `waitFor` sobre el `scene_id` volvería a esconder la
 *  regresión (esperaría a que llegue y seguiría en verde), mientras que una
 *  afirmación detrás de la promesa se pone roja el día que alguien devuelva el
 *  hook a `undefined`, y el rojo NOMBRA la escena que había.
 *
 *  VIVE EN `qa/lib` y no en un guion por lo que dice el `why` de
 *  `qa-guiones-sin-espera-por-reloj`: la regla mira `qa/guiones/**` y exime
 *  `qa/lib` justo para esto — el cortafuegos de la compuerta es un temporizador,
 *  y no es la condición de avance (como el `maxMs` de `holdUntil`) sino la red
 *  que impide que una compuerta olvidada cuelgue la batería entera.
 */

/** Carga una fixture del selector y devuelve la foto del renderer con ella
 *  puesta.
 *
 *  Dos hechos DISTINTOS, y por eso dos pasos:
 *
 *  1. **QUÉ escena hay puesta** — lo garantiza la promesa de `loadFixture`, y
 *     aquí se AFIRMA. Si no es la pedida, se lanza nombrando las dos: todo lo
 *     que se midiera a partir de ahí sería de otra escena.
 *  2. **Que esté PINTADA** — eso la promesa no lo dice. Medido: al resolver la
 *     carga del primer tile, `fps().ready` es `false` y `fps().suelo` es
 *     `null`; en el segundo ya vienen puestos. Ese sí es un `waitFor`.
 *
 *  Devuelve la foto entera de `fps()` (trae `suelo`, `activeTile`, `ready`):
 *  los dos guiones que lo usan miran campos distintos.
 */
export async function cargarFixture(ctx, fixture, { timeoutMs = 20_000 } = {}) {
  await ctx.nefan("loadFixture", fixture);
  const puesta = await ctx.page.evaluate(() => window.__nefan.scene?.scene_id ?? null);
  if (puesta !== fixture) {
    throw new Error(
      `se pidió la fixture «${fixture}» y el mundo se quedó en «${puesta}»: la carga no había ` +
        `llegado cuando loadFixture dijo que sí (#308). Todo lo que se midiera a partir de aquí ` +
        `sería de OTRA escena.`,
    );
  }
  return ctx.waitFor(
    `el mundo 3D instala el tile de ${fixture}`,
    (f) => {
      const g = window.__nefan.fps();
      return g && g.ready && g.activeTile && g.suelo && window.__nefan.scene?.scene_id === f ? g : null;
    },
    timeoutMs,
    fixture,
  );
}

/** Retiene el JSON de una fixture en el borde de la red y devuelve con qué
 *  soltarlo.
 *
 *  Es el negativo DETERMINISTA de #308, y es determinista porque es CAUSAL: con
 *  la respuesta retenida el módulo *no puede* haber llegado, así que un
 *  `loadFixture` que diga «hecho» miente siempre, no dos de cada cuatro veces.
 *  Repetir la batería no vale como negativo: el 22 salió 6 de 6 verde en
 *  solitario el mismo día en que la sonda lo ponía rojo 2 de 4.
 *
 *  El mecanismo no es nuevo: el guion 24 (`:68`) ya intercepta este mismo
 *  patrón para ABORTAR el JSON. Aquí solo cambia `abort` por «retener».
 *
 *  OJO: intercepta la PRIMERA carga de ese módulo en esa página. La segunda
 *  `import()` la sirve el registro de módulos ESM sin tocar la red, así que
 *  retener una fixture ya cargada no retiene nada — y el recuento que devuelve
 *  `soltar()` lo dice.
 *
 *  @param cortafuegosMs  red contra el deadlock, NO la condición de avance:
 *    `run.mjs` no pone timeout alrededor del cuerpo de un guion, así que una
 *    compuerta que nadie suelta colgaría la batería entera sin imprimir nada.
 */
export async function retenerFixture(ctx, fixture, { cortafuegosMs = 60_000 } = {}) {
  const patron = `**/scenes/${fixture}.json*`;
  let abrir;
  const puerta = new Promise((r) => {
    abrir = r;
  });
  let porCortafuegos = false;
  const alarma = setTimeout(() => {
    porCortafuegos = true;
    abrir();
  }, cortafuegosMs);

  let interceptadas = 0;
  const fallos = [];
  const enVuelo = [];
  const manejador = async (route) => {
    interceptadas++;
    const servida = puerta
      .then(() => route.continue())
      .catch((e) => {
        // La página puede haberse ido mientras la petición estaba retenida.
        // No se traga: se acumula y lo cuenta `soltar()`.
        fallos.push(String(e));
      });
    enVuelo.push(servida);
    await servida;
  };
  await ctx.page.route(patron, manejador);

  return {
    patron,
    /** Suelta la respuesta y deja de interceptar. Idempotente. Devuelve qué
     *  pasó de verdad: cuántas peticiones retuvo y si tuvo que soltarlas el
     *  cortafuegos (lo segundo es un fallo del guion, no del juego). */
    async soltar() {
      clearTimeout(alarma);
      abrir();
      await Promise.all(enVuelo);
      await ctx.page.unroute(patron, manejador).catch((e) => fallos.push(String(e)));
      return { interceptadas, porCortafuegos, fallos };
    },
  };
}
