/**
 * Reporter de `node --test`: el `spec` de siempre, más una regla que el runner
 * no cumple — **una suite que falla pone rojo el código de salida** (#697).
 *
 * El hecho, medido en Node v24.11.1 (y en 24.11.1–24.14.1 con los binarios
 * oficiales; Node lo arregla en v24.15.0, que ya sale con 1): si el CUERPO de un `describe` lanza (un
 * `JSON.parse` de un contrato roto, un `readFileSync` de un fichero que falta,
 * un helper importado que valida y lanza…), la suite desaparece del resumen
 * (`ℹ tests 0 · fail 0`) y el proceso sale con **0**. Pasa igual con
 * `--experimental-test-coverage` y con `--test-isolation=none`. El mismo `throw`
 * en un `it`, en un `before` o a nivel de módulo sí sale con 1.
 *
 * El runner SÍ avisa: emite `test:fail` con `details.type === "suite"`. Lo que
 * no hace es contarlo. Aquí se cuenta: `process.exitCode = 1` en ese evento.
 * Es el mecanismo, no una lista de sitios: cubre cualquier `describe`, lance por
 * lo que lance y lo lea como lo lea — un censo por nombres de llamada no vería
 * los que lanzan vía helper, que el 2026-09-23 eran la mayoría.
 *
 * Va COMPUESTO con `spec` (los eventos se reenvían a un `spec` propio) y no
 * como un reporter más: con tres reporters en `npm run coverage` (`spec`,
 * `lcov` y este) Node avisa `MaxListenersExceededWarning` en stderr.
 *
 * Lo usan las tres entradas al runner: `scripts.test` y `scripts.coverage` de
 * `package.json` (candadas por `una-suite-que-falla-pone-rojo.test.ts`) y el
 * `corre()` de `qa/contrato-candados-en-negativo.mjs` (candado por su propio
 * invariante de fixture). Se pasa con `./` delante: sin él Node lo busca como
 * paquete.
 *
 * Se retira cuando TODA máquina que corra la suite tenga Node ≥ 24.15 (hoy la
 * de desarrollo tiene 24.11.1 y `engines` dice `>=24`; CI coge la última 24 y
 * ahí ya es redundante, aunque inofensivo). El test hermano mide la línea de
 * `scripts.test` SIN este reporter y dice, con la versión, si en ese Node sobra.
 */
import { Readable } from "node:stream";
import { spec, type TestEvent } from "node:test/reporters";

/** Lo que imprime por cada suite rota, además de lo que diga `spec`. El arnés de
 *  sabotajes busca este prefijo para nombrar lo roto. */
export const PREFIJO_SUITE_ROTA = "✖ suite que falla:";

function fallaPorSusHijos(error: Error): boolean {
  return "failureType" in error && error.failureType === "subtestsFailed";
}

export default async function* laSuiteQueFallaPoneRojo(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string | Buffer, void> {
  const rotas: string[] = [];
  async function* vigila(): AsyncGenerator<TestEvent, void> {
    for await (const ev of source) {
      if (ev.type === "test:fail" && ev.data.details.type === "suite") {
        process.exitCode = 1;
        // Una suite cuyo único fallo es un hijo rojo ya la cuenta el hijo; se
        // nombra solo la que falla por SÍ MISMA (su cuerpo, un hook…).
        if (!fallaPorSusHijos(ev.data.details.error)) rotas.push(`${PREFIJO_SUITE_ROTA} ${ev.data.name} (${ev.data.file ?? "¿fichero?"})`);
      }
      yield ev;
    }
  }
  yield* Readable.from(vigila()).pipe(new spec()) as AsyncIterable<string | Buffer>;
  for (const r of rotas) yield `${r}\n`;
}
