/** EL RELOJ DE SIM SOLO PUEDE CONTAR LO QUE EL MUNDO SIMULA (#545).
 *
 *  ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *  #545 dio al banco un reloj de simulación para dejar de presupuestar en
 *  milisegundos de pared el progreso de un juego que no corre por pared. El
 *  mecanismo entero descansa en UNA premisa, escrita en `qa/lib/sonda.mjs` y en
 *  `qa/README.md`: que `__nefan.reloj().sim` son *segundos de mundo*, y que por
 *  eso una espera que los agota puede AFIRMAR «el mundo corrió sus N segundos y
 *  no ocurrió», mientras que una que no los agota solo puede declarar ⊘.
 *
 *  El reloj se alimenta en `nefan-html/src/main.ts` con el delta topado del
 *  `gameLoop`, y se alimenta ARRIBA DEL TODO: antes del `if (!gameClient)` y muy
 *  por encima del `titleScreen.isVisible ? gameClient.idle() : gameClient.tick(delta, …)`,
 *  cuyo propio comentario dice «ahí no hay jugador que simular». O sea, hay
 *  estados en los que el contador sube y el mundo NO avanza — y en ellos la
 *  asimetría se invierte: en vez de declarar ⊘, la espera AFIRMA un negativo
 *  sobre un mundo que nunca corrió. Es el defecto que #545 vino a matar, un
 *  escalón más arriba.
 *
 *  ── QUÉ AFIRMA, y las tres direcciones ────────────────────────────────────
 *
 *   A · **CON EL TÍTULO DELANTE EL RELOJ NO CUENTA.** Es el estado 1 del
 *       sistema, el que ve cualquiera que arranca el juego, y el único en el
 *       que se sabe con certeza que `tick(delta)` no se llama. Se mide la razón
 *       sim/pared sobre una ventana que cierra la propia página: aquí el reloj
 *       de pared NO es la condición de parada de nada, es el patrón contra el
 *       que se compara el otro reloj — que es justo para lo que sirve.
 *   B · **Y POR ESO, CON EL TÍTULO DELANTE, UNA ESPERA DE SIM DECLARA ⊘.** La
 *       misma cosa dicha donde se paga: si el contador sube, `waitFor({sim:N})`
 *       se agota y afirma «no ocurrió» sobre un mundo parado.
 *   C · **CON EL MUNDO CORRIENDO, EL RELOJ SIGUE A LA PARED** (control
 *       positivo: sin esto, un reloj muerto pasaría A y B), y **CON EL LOOP
 *       PARADO, UNA ESPERA DE SIM DECLARA ⊘ DE VERDAD** — el mecanismo de #545
 *       ejercido de punta a punta sobre la página real, que es lo que la
 *       batería de `test/sonda-de-qa.test.ts` no puede probar porque allí el
 *       navegador es un doble.
 *
 *  ── CÓMO SE LLEGA A CADA ESTADO, sin tocar el cliente ─────────────────────
 *  A y B: no haciendo nada — el título está delante al arrancar, que es donde
 *  empieza el jugador. C: cerrando el título por su verbo y, para el último
 *  tramo, quitándole a la PÁGINA su `requestAnimationFrame` (el loop se
 *  reprograma con él cuando la pestaña es visible, `main.ts:scheduleNextFrame`).
 *  Ni un `display:none`, ni estado sintético, ni una línea del juego cambiada.
 *
 *  ── EL COLOR DE HOY ───────────────────────────────────────────────────────
 *  A y B salen ROJOS con `feature/reloj-de-sim` puesto: medido el 2026-09-15,
 *  el reloj avanza 7,65 s en 8 s de pared con el título cubriendo la pantalla
 *  (razón 0,956) y un `waitFor({sim:4})` de ahí termina diciendo «el mundo
 *  avanzó los 4 s de simulación pedidos … y no ocurrió». C sale VERDE. Este
 *  guion es la reproducción ejecutable de ese hallazgo: se pone verde cuando el
 *  reloj deje de contar los frames en los que el mundo no se simula, y no antes.
 *
 *  Cero créditos: no le pide NADA al motor.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion mide el reloj del
 *  cliente sobre el título y sobre el loop; nunca arranca partida ni pide tile. */
export const sinMotor = "mide el reloj de sim del cliente sobre el título y sobre el game loop; nunca arranca partida";

import { relojDeSimNoAvanzoEn } from "../lib/esperas.mjs";

/** La ventana sobre la que se compara un reloj con el otro. No es un `sleep`
 *  (`qa-guiones-sin-espera-por-reloj` lo prohíbe, y con razón): la ventana la
 *  cierra la PÁGINA con su propio `performance.now()` —el mismo reloj que usa
 *  el `gameLoop` para calcular su delta— y el guion espera POR ESE ESTADO. El
 *  sujeto es la RAZÓN entre los dos relojes, no que pase el tiempo. */
const VENTANA_MS = 6_000;

/** Cuánto sim se le tolera a un estado en el que el mundo NO se simula. No es
 *  cero para no cazar el frame que quepa entre la lectura y el cambio de
 *  estado; es lo bastante pequeño como para que 6 s de pared no quepan. */
const TOLERANCIA_SIM_S = 0.5;

/** La condición que no se cumple jamás: el material con el que se mira qué hace
 *  una espera al agotarse. */
const NUNCA = () => null;

/** Cuánto sim y cuántos frames del loop pasan en una ventana de pared.
 *
 *  La base viaja como `arg` (no se ensucia `window`) y la ventana la cierra la
 *  propia página comparando su `performance.now()` contra esa base: el guion
 *  espera por el ESTADO «la ventana ya está completa», no por un reloj suyo. */
async function razonSimPared(ctx, etiqueta) {
  const base = await ctx.page.evaluate(() => ({ ...window.__nefan.reloj(), t: performance.now() }));
  const v = await ctx.waitFor(
    `se completa la ventana de medida de ${VENTANA_MS} ms (${etiqueta})`,
    (b) => {
      const r = window.__nefan.reloj();
      const t = performance.now();
      if (t - b.t < b.ventana) return null;
      return { sim: r.sim - b.sim, frames: r.frames - b.frames, pared: (t - b.t) / 1000 };
    },
    VENTANA_MS + 15_000,
    { ...base, ventana: VENTANA_MS },
  );
  return { ...v, razon: v.sim / v.pared };
}

/** Qué hace una espera de sim en el estado en el que está la página AHORA:
 *  `"⊘"` si declaró que no pudo medir, `"afirmó"` si se agotó el presupuesto de
 *  sim y terminó diciendo «no ocurrió», o el nombre de lo que saliera. */
async function veredictoDeUnaEsperaDeSim(ctx, sim, ms) {
  try {
    const r = await ctx.absorbe(
      `esta espera es su PROPIO sujeto: lo que el guion mide es con qué VEREDICTO termina ` +
        `(⊘ o afirmación), y eso se afirma tres líneas más abajo con ctx.expect`,
      () => ctx.waitFor("una condición que no se cumple jamás", NUNCA, { sim, ms }),
    );
    return r === null ? "afirmó" : "se cumplió (imposible)";
  } catch (err) {
    return relojDeSimNoAvanzoEn(err) ? "⊘" : `otro (${err?.name}: ${String(err?.message).slice(0, 90)})`;
  }
}

export default async function (ctx) {
  // ── Estado 1 · el título cubre la pantalla ──────────────────────────────
  const arranque = await ctx.waitFor("el cliente publica su reloj de sim y el título tapa el juego", () => {
    const st = window.__nefan?.status?.();
    const r = window.__nefan?.reloj;
    if (!st || st.title !== true || typeof r !== "function") return null;
    return { title: st.title, reloj: r() };
  });
  ctx.expect(
    "el cliente publica `__nefan.reloj()` con `{sim, frames}` (sin eso no hay nada que medir)",
    typeof arranque.reloj?.sim === "number" && typeof arranque.reloj?.frames === "number",
    JSON.stringify(arranque.reloj),
  );

  // A · con el título delante el mundo NO se simula (`gameClient.idle()`), así
  //     que el reloj de sim no puede contar esos segundos.
  const conTitulo = await razonSimPared(ctx, "título delante");
  ctx.log(`con el título delante: ${conTitulo.sim.toFixed(2)} s de sim y ${conTitulo.frames} frames en ${conTitulo.pared.toFixed(2)} s de pared (razón ${conTitulo.razon.toFixed(3)})`);
  ctx.expect(
    "A · con el TÍTULO delante el reloj de sim NO avanza: ahí el loop llama a `idle()`, no a `tick(delta)`",
    conTitulo.sim < TOLERANCIA_SIM_S,
    `avanzó ${conTitulo.sim.toFixed(2)} s de sim (${conTitulo.frames} frames) en ${conTitulo.pared.toFixed(2)} s de ` +
      `pared, razón ${conTitulo.razon.toFixed(3)} — el contador sube con el frame, no con el mundo, así que ` +
      `un presupuesto de sim gastado aquí no ha medido NADA del juego`,
  );

  // B · y por eso, aquí, una espera de sim no puede afirmar un negativo.
  const enElTitulo = await veredictoDeUnaEsperaDeSim(ctx, 2, 30_000);
  ctx.expect(
    "B · con el TÍTULO delante, una espera de sim declara ⊘ y NO afirma «no ocurrió»",
    enElTitulo === "⊘",
    `terminó «${enElTitulo}» — afirmar aquí es decir «el mundo corrió sus segundos y no pasó» de un mundo que ` +
      `no corrió ni uno: es el defecto de #545 movido un escalón`,
  );

  // ── Estado 2 · partida en marcha: el control positivo ───────────────────
  await ctx.nefan("closeTitle");
  const enJuego = await ctx.waitFor("el título ya no tapa el juego", () => {
    const st = window.__nefan?.status?.();
    return st && st.title === false ? st : null;
  });
  ctx.log(`título cerrado: ${JSON.stringify(enJuego.title)}`);

  const corriendo = await razonSimPared(ctx, "mundo corriendo");
  ctx.log(`con el mundo corriendo: ${corriendo.sim.toFixed(2)} s de sim y ${corriendo.frames} frames en ${corriendo.pared.toFixed(2)} s de pared (razón ${corriendo.razon.toFixed(3)})`);
  ctx.expect(
    "C1 · con el mundo CORRIENDO el reloj de sim sigue a la pared (control: un reloj muerto pasaría A y B)",
    corriendo.razon > 0.8,
    `razón ${corriendo.razon.toFixed(3)} · ${corriendo.sim.toFixed(2)} s de sim en ${corriendo.pared.toFixed(2)} s de pared`,
  );

  // ── Estado 3 · el loop PARADO: el ⊘ de #545, de punta a punta ───────────
  // Se le quita a la página su `requestAnimationFrame`: `scheduleNextFrame`
  // (`main.ts`) se reprograma con él mientras la pestaña es visible, así que
  // sin él el loop se apaga sin tocar una línea del juego.
  await ctx.page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  const parado = await razonSimPared(ctx, "loop parado");
  ctx.log(`con el loop parado: ${parado.sim.toFixed(2)} s de sim y ${parado.frames} frames en ${parado.pared.toFixed(2)} s de pared`);
  ctx.expect(
    // Un frame, no cero: el callback que ya estaba encolado cuando se quitó el
    // rAF todavía corre. Lo que se afirma es que NO se reprograman más.
    "C2 · sin rAF el game loop se para y el reloj de sim se para con él",
    parado.sim < TOLERANCIA_SIM_S && parado.frames <= 1,
    `avanzó ${parado.sim.toFixed(2)} s de sim y ${parado.frames} frames`,
  );

  const conLoopParado = await veredictoDeUnaEsperaDeSim(ctx, 4, 3_000);
  ctx.expect(
    "C3 · con el MUNDO parado, una espera de sim declara ⊘ (el mecanismo de #545, sobre la página real)",
    conLoopParado === "⊘",
    `terminó «${conLoopParado}»`,
  );
}
