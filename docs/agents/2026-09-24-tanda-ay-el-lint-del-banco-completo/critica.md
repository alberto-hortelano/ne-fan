**#734 VIGENTE · #744 VIGENTE (menor de lo que parece) · #745 REENCUADRADA** (cifras al alza y justificación falsa; el trabajo sigue valiendo)

Medido el 2026-09-24 sobre `f25da654`, con el eslint 10 de `nefan-core/node_modules` y `@eslint/js` `recommended` (`no-undef` apagado), sin tocar el árbol.

## El problema real, en una frase

El lint del banco y de los benches cubre una regla sobre una parte del código: lo demás (14 `.js/.mjs` de `labs/`, dos reglas baratas en `qa/`) acumula hallazgos sin que nadie los vea, y crecen cada día (#757 añadió 5 esta tarde). #734 es aparte: una entrada muerta en un padrón.

## La premisa, afirmación por afirmación

**#734**
- «`t: Date.now()` en `07-npc-clave-del-skin.mjs:57,59`» — **cierto**, las dos líneas exactas.
- «Ningún aserto usa `t`» — **cierto**: los únicos lectores de `peticiones` son `:112-119` (`.length`, `.map(p => p.body)`) y `:161` (`.slice(corte).map(p => p.body)`).
- «Baja el padrón en 2 y deja 07 fuera» — **cierto**: `relojes-de-pared.json` declara 07 con `relojes: 2`, y su propio `porque` ya lo llama «sello muerto, candidato a retirarse».
- **Falta en el issue**: `test/el-reloj-de-pared-tiene-padron.test.ts:155-172` fija el censo («31 relojes en 11 guiones», lista con `"07"`); pasa a 29 en 10. `architecture.test.ts:1349` usa la RUTA del 07 con texto sintético: no depende del fichero, no se toca.

**#744**
- «14 ficheros `.js/.mjs` en `labs/` sin lint» — **cierto**: 14, todos rastreados (en el checkout principal también 14, cero no rastreados). `tsconfig.labs.json` incluye `.ts` y UN `.mjs` (`replay-catalog.mjs`) con `checkJs: false`: tampoco lo lintea.
- «Medir antes de encender» — medido: **3 hallazgos de `no-unused-vars`, los tres en `labs/authoring/three/escena.js`** (`:84` parámetro `base` por defecto nunca leído, `:503` `cm` sin usar, `:512` `name` desestructurado sin usar). Los otros 13 salen limpios. Con `recommended` completo en `labs/`, nada más.
- Los tres son código de un bench cerrado (`labs/authoring/INFORME.md`); ninguno es un aserto perdido.

**#745**
- «42 hallazgos: 38 + 3 + 1» — **desfasado a las 5 horas**: hoy **47 = 43 `no-useless-assignment` + 3 `preserve-caught-error` + 1 `no-irregular-whitespace`**, en 38 ficheros. Los nuevos vienen de #757 (guiones 179, 180×2, 181 y otro de los que retocó).
- «Una asignación que nadie lee puede ser el resultado de una espera que se descarta (familia #356)» — **falso hoy, 0 de 43**. Comprobado uno a uno por script: los 43 son la línea `let x = <valor>` cuyo valor inicial se sobrescribe dentro de un `try` antes de leerse (`let body = null; try { body = JSON.parse(...) }`, `let tipo = ""`, `let code = 2`…). Ninguno descarta un resultado. La regla vale como **prevención** (una segunda escritura que pisa a la primera sin leerla), no por lo que hay dentro hoy.
- «Un `throw` en un `catch` sin `cause` pierde la causa» — **cierto, los 3 son reales**: `qa/run.mjs:1295` (`cargarChromium`), `qa/lib/stack.mjs:41`, `qa/lib/carga.mjs:167`. Dos meten `err.message` en el texto, pero ninguno lleva `{ cause }`.
- «1 `no-irregular-whitespace`» — es **deliberado**: `qa/dos-corridas.mjs:10` lleva un U+200B en `qa/.tmp/*​/saves` dentro de un comentario de bloque, para que `*/` no lo cierre. Ni se «limpia» borrando el carácter (rompe el fichero) ni forma parte de lo que el issue pide encender. Solo se toca si se enciende la regla, y entonces se reescribe el comentario.
- «`no-undef` se queda fuera» — sigue siendo correcto; no lo discuto.

## El día después

- Para quien juega: **nada**. Las tres son deuda declarada del banco; está bien que no cambie nada.
- Se vuelve más difícil escribir `let x = null; try { x = … }`: los guiones nuevos lo escribirán `let x;`. Es la única fricción, y es cosmética.
- Rastros que habrá que barrer (si no, mienten): el bloque «LO QUE NO MIDE» del guion 175 (nombra justo estas dos reglas y los 14 de `labs/`), la cabecera de `eslint.qa.config.js` («Por qué solo esa regla») y el `porque` del 07 en el padrón.
- Candados que dependen de la forma actual: el guion **176 (A)** exige que `lint:qa` devuelva EXACTAMENTE tantos ficheros como `.mjs` hay bajo `qa/`, y `el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts` exige que los ignores sean los `SALTOS_DEL_BANCO`. Meter `labs/` en esa misma pasada o en esa misma config rompe los dos, o los deja midiendo otra cosa. Cómo resolverlo es cosa del arquitecto. Lo que no se puede hacer es aflojar esos dos candados para que quepa `labs/`.

## Conflictos

- **Tanda AZ (#738/#739, `qa/lib/cable.mjs`, `clientes-ws-del-banco.json`)**: `cable.mjs` tiene **0 hallazgos**. Solape textual en dos ficheros del padrón de AZ: `qa/run.mjs` (4: `:1295`, `:1452-1454`) y `qa/el-state-api-no-muta-sin-partida.mjs:163`. Los cambios de #745 no mueven líneas (`= null` se va dentro de la misma línea), así que el conflicto de merge es pequeño. Pero **el gemelo de #739 nacerá bajo las reglas nuevas si AY entra antes**. No hace falta un orden: quien entre segundo rebasa y vuelve a pasar `npm run lint`.
- **Cualquier tanda que toque guiones**: el día que #745 se puso, #757 añadió 5. La cifra buena es la de HEAD **tras el rebase**, no la de este documento.
- #720, #723, #727 y #725 no se solapan. Nada de `arch-rules.json` ni de CLAUDE.md choca con esto.

## Coste contra valor

- #734: dos líneas, una entrada de padrón y una cifra de test. Si no se hace, el padrón sigue declarando un reloj que no mide nada, contra su propio `porque`. Hacerlo.
- #744: 3 arreglos en un fichero, más el encendido. Barato. El valor es preventivo: los 11 `.mjs` vivos (el motor falso emulado, el replay-server, los dumps de `fps`) son los que pueden pudrirse. Hacerlo.
- #745: 46 ediciones mecánicas en 38 ficheros, cero cambio de conducta: si el `catch` no reasignara y se leyera después, eslint no lo marcaría, así que todo lo marcado es escritura muerta demostrada. `preserve-caught-error` es lo que más vale por línea. No hacerlo nunca cuesta poco, pero la cifra crece unas 5 al día y cada día sale más caro. Hacerlo, sin vender los 43 como asertos perdidos.

## Criterios de aceptación

1. **#734**: `07` sin `Date.now()` (los dos `push` guardan solo `body`). La entrada del 07 fuera de `relojes-de-pared.json`, y el censo de `el-reloj-de-pared-tiene-padron.test.ts` en «29 en 10» sin `"07"`. Negativo: volver a meter un `Date.now()` en el 07 pone `npm test` en rojo (entrada no declarada).
2. **#744**: `npm run lint` (y por tanto `verify` y CI) lintea los 14 `.js/.mjs` de `labs/` con `no-unused-vars` y la exención `^_`. Los 3 hallazgos de `escena.js`, clasificados y resueltos. Una siembra demuestra que un import muerto en `labs/` pone el lint en ROJO nombrando fichero y regla. Un censo en el árbol real cuenta tantos ficheros de `labs/` lintados como `.js/.mjs` tiene `labs/` (el análogo del 176 A). El 176 A y el test de paridad de ignores siguen midiendo SOLO `qa/`.
3. **#745**: `no-useless-assignment` y `preserve-caught-error` en `error` sobre `qa/**/*.mjs`, y **0 hallazgos en HEAD tras el rebase**. Los 3 `throw` con `{ cause }`. Una siembra por regla en el guion de lint del banco: una ROJA, y un control que da 0 (el `let x;` sin inicializar, el `throw … { cause }`). El U+200B de `dos-corridas.mjs` no se toca salvo que se encienda `no-irregular-whitespace`.
4. Los rastros de «El día después» al día: 175 «LO QUE NO MIDE», la cabecera de la config y el `porque` del 07.
5. Guiones nuevos solo en 186-189, sin navegador (`sinMotor`/`sinNavegador` declarados, como el 175). Cero créditos. No hay nada observable por el jugador, así que no hay guion de juego.

## Qué le cambiaría a `requisitos.md`

> **#745 — corrección del crítico.** Hoy son **47**, no 42: 43 `no-useless-assignment`, 3 `preserve-caught-error` y 1 `no-irregular-whitespace`. #757 añadió 5 el mismo día. Los 43 son, sin excepción, el valor inicial de un `let x = …` que un `try` sobrescribe antes de leerlo: **ninguno es una espera descartada**, y la regla se enciende como prevención. El `no-irregular-whitespace` de `qa/dos-corridas.mjs:10` es un U+200B puesto a propósito para que `*/` no cierre el comentario: no entra en esta tanda. La cifra que vale es la de HEAD tras el rebase.
>
> **#744 — medido.** Con `no-unused-vars` salen 3 hallazgos, todos en `labs/authoring/three/escena.js` (`:84`, `:503`, `:512`); los otros 13 ficheros están limpios. El guion 176 (A) y `el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts` miden SOLO `qa/`, y así tienen que seguir.
>
> **#734.** Además del padrón, cambia el censo de `test/el-reloj-de-pared-tiene-padron.test.ts:155` (31→29 relojes, 11→10 guiones).
