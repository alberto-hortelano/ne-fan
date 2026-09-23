**REENCUADRADA (ajuste menor)**: el problema es real y el alcance es correcto. Pero la segunda forma de N2 está mal escrita en el issue, y con esa letra se arreglaría el argumento equivocado. Además, el punto (12) ya promete en su título algo que N3 demuestra que no mide.

## El problema real, en una frase

El padrón `_lo_que_esto_NO_sujeta` dice «cada punto medido». Hay tres formas de falso verde que ni se miden ni se declaran, así que el padrón promete más de lo que el detector cumple. La tarea ataca eso: cerrarlas o declararlas con un `it`. Eso es la solución adecuada. No hay que inventar nada nuevo.

## La premisa, afirmación por afirmación

- **N1: el asertador tautológico o condicional excusa la rama.** Cierto. `esObservador` delega en `llamaAsertador`, y este en `esAsertador` (`nefan-core/test/saltos-del-guion.ts:334-341`). `esAsertador` solo pregunta si el cuerpo *contiene* un `expect`/`expectEspera` (`AFIRMA.has`). No aplica `esTautologia` (que sí aplica el `expect` directo, en `:365-367`) ni mira si el aserto está bajo un `if`.
- **N2a: `!!true` pasa.** Cierto. `esTautologia` (`:163-176`) solo acepta `!` delante de un literal falso (`esLiteralFalso`, `:137`). En `!!true`, el operando de `!` es `!true`, que no es literal, así que devuelve `false` y cuenta como observador.
- **N2b: `expectEspera("x", () => true)` pasa.** **Mal descrita.** En el detector, un `expectEspera` es siempre observador (`:364`), así que la forma pasa. Pero en el banco esa forma exacta **no es un falso verde**. La firma es `expectEspera(desc, debeOcurrir, probeFn, opciones)` (`qa/run.mjs:1106`), así que la flecha cae en `debeOcurrir` y `probeFn` llega `undefined`. Entonces `page.evaluate(undefined)` rompe la sonda (`qa/lib/sonda.mjs:474`) y el guion sale ✘ con «NO SE MIDIÓ» (`qa/run.mjs:1162-1169`). La tautología real vive en el **tercer** argumento, y además depende de la **polaridad**: `expectEspera(d, true, () => true)` y `expectEspera(d, false, () => false)` salen siempre ✔. Si alguien cerrara N2 leyendo el issue al pie de la letra, miraría el 2.º argumento como predicado y el candado no se enteraría de la forma que de verdad escapa.
- **N3: un IIFE con `ctx` renombrado no lo ve ni la medida del punto (1).** Cierto. La medida `{helpers: true}` solo entra en una función si contiene un identificador de `m.ctxs` (`saltos-del-guion.ts:648`). `m.ctxs` nace como `{"ctx"}` (`:280`) y solo crece con declaraciones (`aliasDeCtx`, `:225`). Un parámetro `c` no entra. Además, el `it` «LÍMITE MEDIDO (12)» (`test/un-salto-del-guion-se-observa.test.ts:496`) dice en su título «**o con otro nombre de parámetro** no se sigue», pero sus dos casos (`:497-501`) son el objeto y la reasignación. Ninguno usa un parámetro renombrado, y el texto de (12) en el JSON tampoco lo nombra. El candado ya DICE N3 y no lo comprueba.
- **«Ninguna tiene ocupantes hoy».** Cierto en lo que se puede buscar por texto. No hay `!!true` ni `expect(…, true)` en `qa/guiones/*.mjs` ni en `qa/lib/*.mjs` (los `!!c1`/`!!rumbo` del guion 14 son variables). No hay ningún `expectEspera(…, true|false, () => true|false)`. Los únicos `=> true)` son `.then(() => true)` (guiones 27 y 29), fuera de un `expectEspera`. N1 no lo he medido por el árbol. Esa búsqueda la tiene que repetir quien implemente.
- **«QA sugiere los puntos 9, 11 y 1».** Es razonable, con el matiz de arriba: N3 casa tanto con (1) como con (12).

## El día después

- Para quien juega no cambia nada. Es deuda declarada del banco: un padrón que dice «cada punto medido» tiene que serlo de verdad.
- **Qué se vuelve más difícil.** Hay que distinguir dos cosas. Cerrar en el detector la parte **tautológica** de N1 y N2 es barato y no tiene víctimas: nadie escribe `ctx.expect(x, true)` para observar algo. Cerrar la parte **condicional** de N1 («el asertador afirma bajo un `if`») es otra cosa. Hay 23 `ctx.expect` repartidos en ocho `qa/lib/*.mjs`, y varios helpers afirman dentro de ramas (p. ej. `qa/lib/combate.mjs:86`). Si «asertador» pasa a exigir un aserto incondicional, pueden pasar a rojo saltos que hoy salen observados, de los 217 que midió QA. Eso también empujaría a reescribir helpers honestos para contentar al detector.
- Lo que parecerá arbitrario dentro de un mes es que (12) siga diciendo «otro nombre de parámetro» sin un caso que lo mida.

## Conflictos

- **#704 (tanda hermana, un solo barrido del banco).** Toca `test/helpers-del-banco.ts`, de donde `saltos-del-guion.ts:73` importa `arbolDelBanco`, `cuerpoPrincipal`, `recorre` y `recorreSinAnidadas`. Esta tarea no debería tocar `helpers-del-banco.ts` ni `banco-ficheros.ts`. Si lo necesitara, es conflicto seguro de merge con #704. Riesgo de merge bajo si se queda en `saltos-del-guion.ts`, el test y el JSON.
- No he visto contradicción con `CLAUDE.md` ni con `arch-rules.json`. La fila de CLAUDE.md (`:40`) no enumera los 12 puntos, así que no hay que tocarla salvo que cambie el ámbito.
- N4 queda fuera y así debe seguir. Es el lado laxo (`esAsertoLaxo`, `:350`), que es otra función.

## Coste contra valor

Es barato en cualquiera de las dos salidas, con cero ocupantes y sin navegador. Si no se hace nunca, el padrón mentiría en tres puntos y en un título, que es justo lo que este repo ha aprendido a no tolerar («lo que el candado dice no es lo que comprueba»). Vale la pena. **Lo que NO debería hacerse**:
- Cerrar la variante condicional de N1 en el detector sin medir antes cuántos de los 217 saltos observados cambian de estado. Si cambia alguno, la salida honesta es declararla (criterio 4).
- Tratar el 2.º argumento de `expectEspera` como predicado.
- Crear un punto (13) para N3 cuando (12) ya lo nombra en su título.

## Qué le cambiaría a `requisitos.md` (para pegar al final de «Criterios de aceptación»)

```
5. N2 se entiende con la firma real, `expectEspera(desc, debeOcurrir, probeFn, …)` (qa/run.mjs:1106). La forma del issue, `expectEspera("x", () => true)`, NO es un falso verde en el banco: la sonda sale rota y el guion ✘ «NO SE MIDIÓ». Lo que escapa es el predicado tautológico en el TERCER argumento con la polaridad que lo hace inocuo: `(d, true, () => true)` y `(d, false, () => false)`. El negativo (o la medida) usa esas formas, no la del issue.
6. N1 tiene dos mitades que se deciden por separado: el asertador TAUTOLÓGICO (solo `expect(…, true)` o equivalentes de `esTautologia`) y el asertador CONDICIONAL (afirma bajo un `if`). La segunda no se cierra en el detector sin enumerar antes qué saltos del banco real cambian de estado. Si cambia alguno, se declara en vez de cerrarse.
7. El `it` «LÍMITE MEDIDO (12)» ya dice «o con otro nombre de parámetro» sin un caso que lo mida: o se añade el caso (el IIFE `(async (c) => {…})(ctx)` de N3), o se quita la frase del título. N3 va a (1) o a (12), no a un punto nuevo.
8. No se tocan `test/helpers-del-banco.ts` ni `test/banco-ficheros.ts` (los reescribe #704 en la tanda hermana).
```
