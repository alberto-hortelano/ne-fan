/** La sonda mínima sobre una página del juego: `nefan` y `waitFor`, los dos
 *  verbos con los que se conduce y se espera POR ESTADO.
 *
 *  Vivían dentro de `makeCtx` (qa/run.mjs) y los scripts sueltos que no corren
 *  bajo el runner —`fixtures-sin-bridge.mjs`, `captura-de-fixture.mjs`,
 *  `presupuesto-de-volumenes.mjs`— tenían cada uno su copia de la espera, con
 *  relojes ya divergidos (150/200 ms) y sin el último valor en el timeout. La
 *  extracción es la que permite que `cargarFixture(ctx, …)` (qa/lib/fixtures)
 *  sirva también fuera del runner (#332): exige `ctx.{page, nefan, waitFor}`,
 *  y eso es exactamente lo que devuelve `ctxDeSonda(page)`.
 *
 *  `makeCtx` DELEGA aquí: una implementación, todos los consumidores. Los
 *  cuerpos se movieron VERBATIM — cambiarles el reloj o los mensajes es
 *  cambiar el timing de la batería entera. */

/** El subconjunto de `ctx` que no necesita runner: para scripts con page
 *  cruda de Playwright. */
export function ctxDeSonda(page) {
  return {
    page,
    log: (msg) => console.log(`    ${msg}`),

    /** Llama a window.__nefan.<path>(...args), o lo lee si no es función. */
    async nefan(path, ...fnArgs) {
      return page.evaluate(
        ([p, a]) => {
          const hook = window.__nefan;
          if (!hook) throw new Error("window.__nefan no existe (¿build de producción?)");
          const keys = p.split(".");
          const owner = keys.slice(0, -1).reduce((o, k) => (o == null ? o : o[k]), hook);
          const target = keys.length === 1 ? hook[p] : owner?.[keys[keys.length - 1]];
          if (target === undefined) throw new Error(`__nefan.${p} no existe`);
          return typeof target === "function" ? target.apply(keys.length === 1 ? hook : owner, a) : target;
        },
        [path, fnArgs],
      );
    },

    /** Espera a que `probeFn` (evaluada en la página) devuelva algo truthy.
     *  `arg` viaja serializado a la página: los guiones comparan contra
     *  valores que midieron antes, sin ensuciar `window` con globales. */
    async waitFor(desc, probeFn, timeoutMs = 30_000, arg = undefined) {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeoutMs) {
        last = await page.evaluate(probeFn, arg).catch((e) => ({ __err: String(e) }));
        if (last && !last.__err) return last;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`timeout esperando: ${desc} (último valor: ${JSON.stringify(last)})`);
    },
  };
}
