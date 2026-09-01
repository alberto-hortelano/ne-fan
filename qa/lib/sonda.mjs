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
 *  cambiar el timing de la batería entera.
 *
 *  Desde #261 `waitFor` ANOTA su expiración en el libro de esperas
 *  (`qa/lib/esperas.mjs`) antes de lanzar. El reloj no se toca y el mensaje
 *  tampoco: lo único nuevo es que la expiración deja rastro, y que el runner
 *  exige que alguien la haya observado antes de dar el guion por verde. */

import { EsperaExpirada, esperaExpiradaEn, libroDeEsperas, sitioDeLlamada } from "./esperas.mjs";

/** El subconjunto de `ctx` que no necesita runner: para scripts con page
 *  cruda de Playwright. */
export function ctxDeSonda(page) {
  /** El libro de esperas de ESTE ctx (#261): toda expiración se anota aquí y
   *  el runner exige, al terminar el guion, que alguien la haya observado. Los
   *  scripts sueltos que usan `ctxDeSonda` sin runner lo llevan igual —cuesta
   *  un Map vacío— y así `absorbe` y el `cause` funcionan también ahí; quien no
   *  lo lee, no paga nada. */
  const esperas = libroDeEsperas();
  return {
    page,
    esperas,
    log: (msg) => console.log(`    ${msg}`),

    /** Consume una expiración DICIENDO dónde vive la medida de verdad: corre
     *  `fn`, y si de ahí sale una `EsperaExpirada` (suya o de su cadena de
     *  causas) la da por observada y devuelve `null`.
     *
     *  El motivo es obligatorio y es una FRASE, no un booleano — mismo
     *  criterio que `exentoDeMotor` y `sinMedir`: hay que escribirlo, se ve en
     *  el diff y dice qué clase de espera es. Un motivo que no nombre dónde se
     *  mide lo que aquí se deja de medir es exactamente la exención callada que
     *  este candado viene a impedir.
     *
     *  Solo absorbe expiraciones: cualquier otro error sigue subiendo. */
    async absorbe(motivo, fn) {
      if (typeof motivo !== "string" || motivo.trim() === "") {
        throw new Error(
          `ctx.absorbe exige el MOTIVO por el que esta expiración es legítima (una frase que diga ` +
            `dónde vive la medida), y llegó ${JSON.stringify(motivo)}.`,
        );
      }
      try {
        return await fn();
      } catch (err) {
        const exp = esperaExpiradaEn(err);
        if (!exp) throw err;
        esperas.resuelve(exp.esperaId, `absorbida: ${motivo}`);
        return null;
      }
    },

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
      // ANOTAR ANTES DE LANZAR (#261): la expiración es un hecho y queda en el
      // libro con su reloj y su sitio. Que la excepción llegue o no a alguien
      // ya no decide si se midió — eso lo decide quién la RESUELVA.
      const id = esperas.anota(desc, timeoutMs, sitioDeLlamada(new Error().stack));
      throw new EsperaExpirada(
        `timeout esperando: ${desc} (último valor: ${JSON.stringify(last)})`,
        id,
        last,
      );
    },
  };
}
