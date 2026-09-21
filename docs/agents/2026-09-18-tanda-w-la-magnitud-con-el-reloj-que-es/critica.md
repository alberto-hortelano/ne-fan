# Crítica — tanda W (#682 + #679)

**Veredicto: REENCUADRADA.** #679 es real y se cura barato; #682 está **OBSOLETO** en la mitad que decía
no tener candado y muere entero con lo que #679 arrastra. Los dos van **juntos, en este orden y como
UNA tarea**: primero el reloj del 93, y lo que se queda sin sujeto ese día se retira ese día. La rama
`comportamiento` no se «sostiene con otro sujeto»: se retira con su motivo. Leído en `main` = `a25d8c2f`.

## El problema real, en una frase

El único aserto de la batería que mide una TASA lo hace con numerador de simulación y denominador de
pared (`qa/guiones/93-…:176-205`), así que bajo carga sale rojo con el juego correcto; todo lo demás
de la tanda —el verbo `expectTasa`, la tercera rama del reproductor, los cuatro H de #682— existe
**alrededor de ese denominador**, y desaparece con él.

## La premisa, afirmación por afirmación

| Afirmación de `requisitos.md` / del issue | Verificación |
|---|---|
| «`ctx.expectMagnitud` vive en `qa/run.mjs`» | Ya no existe con ese nombre: es `expectTasa`, `qa/run.mjs:1259`, con firma `{cantidad, segundosDePared, esperado, tolRel}` (H-4 de la QA de #609). #682 se abrió a las 10:56 y la PR #685 que lo renombró y lo candó se fusionó a las 11:34 del mismo día: el issue describe el árbol de ANTES de la segunda vuelta |
| «H-8 fail-loud sin candado» | **Falso hoy.** `nefan-core/test/carga-sintetica.test.ts:741-799` saca el CUERPO REAL del método del AST de `run.mjs` y lo EJECUTA (`new Function`); `:766-775` exige que la forma vieja LANCE con `/segundosDePared/`. Reproducido en memoria sin tocar el árbol: `if (mal)` → `if (false)` pone ese aserto ROJO (`scratchpad/sabotaje-en-memoria.mjs`) |
| «H-9 `if (!ok)` invertible en verde» | **Falso hoy.** `:794-799` «una tasa que PASA no entra en la lista»: `if (!ok)` → `if (true)` mete la tasa y `deepEqual(b.tasas, [])` sale ROJO (mismo script). La suite tenía 81 tests cuando QA sondeó; hoy son **91**, y los diez son estos. `implementacion-609.md:309` ya avisaba: «que el issue se abra por lo que quede y no por lo que ya está» |
| «H-6 y H-7 cuelgan de la misma raíz (`run.mjs` no importable)» | **Falso**: los dos viven en `qa/lib/carga.mjs`, que SÍ importa el test. H-6 es la pata `razonHundida` de `comparaCorridas` (`:604-611`), y el sondeo de QA la da ROJA al sabotearla («b · la pata de la razón»): es una observación de redundancia, no un aserto sin candado. H-7 es la frase de `frasePorFirma` para `comportamiento` (`:665-680`) que no imprime razón ni cuántas tasas cayeron: cambio de impresión de diez líneas — **y solo tiene sentido si esa rama sigue viva** |
| «Sacarla a `qa/lib/` como `veredictoDeGuion`» | Es una solución a un problema ya resuelto por otra vía (ejecutar el cuerpo desde el árbol). Cambiaría `new Function` por un `import`: cosmética. Y `expectTasa` tiene HOY un solo llamante (`grep -rl expectTasa qa/guiones/` → el 93, `:344/:349/:379`) |
| «El candado de #609 lee el AST para `magnitudes: ctx.magnitudes`» | Es `tasas: ctx.tasas`, y son CUATRO lectores, no uno: cuerpo del verbo (`:741-745`), getter (`:815-820`), ausencia de setter + `defineProperty` (`:836-842`), cable tramo 1 y 2 (`:854-899`). Todos con guardia de sujeto («no está `expectTasa` en qa/run.mjs: el candado no tiene sujeto»): si el nodo desaparece, se ponen rojos solos. El «aviso» del issue se cumple por construcción |
| «`medirVelocidad` divide sim por pared; a ×40 da 0,38-0,63» | **Cierto.** `93:184-204`: muestras `[t, x, z]` con `t` del `rAF`, `seg` = Δt de pared; el mundo avanza `min(Δpared, 0,1)` (`main.ts:563`) |
| «Conducirla al reloj de sim con precisión bastante» | **Sí, y es exacta, no aproximada.** `window.__nefan.reloj()` publica `relojDeSim.lee()` (`nefan-hook.ts:316`) con `sim` = Σ de los MISMOS `delta` que reciben `pasoDelJugador` (`main.ts:609-616`) y `gameClient.tick(relojDeSim.avanza(delta))` (`:665`). El muestreador del guion es un `rAF` registrado después del del loop, así que cada muestra lee `pos` y `sim` post-tick del mismo frame: Δpos/Δsim es la velocidad configurada al flotante. Desaparece de paso el artefacto que justificaba `TOL_REL` («el primer frame arrastra el delta de uno que empezó antes», `93:117-121`) |
| «El 93 es el ÚNICO sujeto de `comportamiento`» | **Cierto y se queda corto**: no es que quede sin sujeto vivo, es que queda **inalcanzable para toda la batería**. Lo dice el propio reproductor: «con la lista de tasas vacía, la rama de `comportamiento` es inalcanzable» (`qa/bajo-carga.mjs:80-81`, `carga.mjs:529-533`) |

## El día después

Con el 93 midiendo `camino / Δsim`, sus cuatro asertos ya **no son «cantidad por segundos de PARED»** y
no pueden llamar honestamente a `expectTasa`: toda la garantía del verbo es que el denominador sea
pared (`run.mjs:1216-1250`, `qa/README.md:170`). Pasarle segundos de sim como `segundosDePared` sería
mentir justo en el tipo que #609 construyó para no mentir. Así que el día después, sin que nadie lo
decida: `ctx.tasas` es `[]` en 146 guiones, y quedan sin sujeto **`expectTasa` + el getter + el cable +
`tasaQueCae` + la rama `comportamiento` + su frase + su párrafo del README (`:386-394`) + unos 35 tests
de `carga-sintetica.test.ts` (`:503` en adelante)**. La casa ya tiene la regla para eso (#639, y
«lo que se retira se retira entero el mismo día»): se borra, no se le busca un inquilino.

**¿Puede tener otro sujeto?** No, por definición de #545: cualquier tasa contra la pared en esta batería
ES un sitio de #545, que es la clase de defecto que `waitFor {sim}` y esta misma cura están extinguiendo.
Y como detector de regresión vale cero: solo dispara si el autor futuro DECLARA la tasa con el verbo, y
quien reintroduce una medida de pared por descuido no lo hace. Mantener el denominador de pared en el 93
para que la rama tenga sujeto sería un candado que existe para sostener a otro candado: la circularidad
que esta casa tiene fichada dos veces (tanda G, tanda H). **No se hace.**

Lo que le parecerá arbitrario a quien lea esto en un mes: que #609 (fusionado HOY) construyera un
reconocedor de tres patas y su garantía en el tipo alrededor de una medida que su propio docblock
declaraba mal medida (`93:181-199`) y cuya cura son diez líneas. Es el patrón «repartir un coste en vez
de no ejecutarlo»; conviene escribirlo en el cierre de #609/#679 para que no se repita.

## Conflictos

- **#682 ↔ #679, dependencia oculta en la dirección contraria a la del enunciado.** Hacer #682 primero
  extrae a `qa/lib/` un verbo al que #679 le quita su único llamante. Orden obligado: #679, y #682 se
  cierra con la evidencia de arriba y sin código.
- **Tanda X (#686)** cuenta `probeCollide` en el 93: 3 apariciones (`sondas-de-movimiento.json:21-23`),
  una en `rumboLibre`. La cura de #679 toca solo `medirVelocidad`: **no tocar `rumboLibre`** y la cifra
  se conserva. Sin choque de ficheros: X no edita el 93.
- **`qa/run.mjs` y `qa/README.md`** los rozan varias tandas (aviso ya en `requisitos.md`): aquí el diff
  de `run.mjs` es una RETIRADA (`:929-931`, `:1194-1289`, `:1299`, filas `:1782/:1807/:1833`, volcado
  `:1911-1924`), fácil de rebasar pero conviene fusionar pronto.
- Con `CLAUDE.md`/`arch-rules.json`: ninguno. `banco-medido.json` no se toca (no nace ningún `qa/lib`).
- El 93 no está congelado en `esperas-que-conducen.json` (solo el 75).

## Coste contra valor

Cura: ~10 líneas en el 93 (leer `__nefan.reloj().sim` junto a `pos` en el mismo `tick`, dividir por
Δsim, y las cuatro llamadas vuelven a `ctx.expect`). Retirada: ~150 líneas repartidas en `run.mjs`,
`carga.mjs`, `bajo-carga.mjs`, `README.md` y ~35 tests. Valor: el único guion de la batería que es rojo
por construcción bajo carga deja de serlo, y el reproductor deja de cargar una categoría cuyo único
trabajo era reconocer ese rojo. «No hacer nada» deja una medida sabida falsa como sujeto de un
reconocedor: es la peor de las tres opciones y no es gratis (cada ×40 del 93 sigue saliendo rojo).

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

```
## Los issues (corregido tras la crítica)
- #679 es LA tarea. #682 se CIERRA con la evidencia de critica.md: H-8 y H-9 tienen candado desde la PR
  #685 (`carga-sintetica.test.ts:741-799`, ejecuta el cuerpo real de `expectTasa`); H-6 y H-7 viven en
  `qa/lib/carga.mjs`, que sí se importa, y son de la rama `comportamiento`, que se retira aquí.

## Criterios de aceptación
1. `medirVelocidad` mide `camino / Δsim`, con `sim` leído de `window.__nefan.reloj()` en el MISMO
   callback en que se lee `pos`. Sin tocar `rumboLibre` (padrón de sondas: 3 apariciones, tanda X).
2. `node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 3`: el 93 sale `igual-verde` con la carga
   REAL (exit 0 del reproductor); antes de la cura, `se-rompio` en la misma máquina, para tener el par.
3. Se retira ENTERA la maquinaria sin sujeto: `expectTasa`, el getter `tasas`, `defineProperty`, el
   cable (`tasas:` en filas y volcado), `tasaQueCae`, la rama `comportamiento` y su frase, sus tests
   (`carga-sintetica.test.ts` desde :503) y la prosa (`bajo-carga.mjs:70-81`, `README.md:170,386-394`).
   `grep -rn "expectTasa\|comportamiento\|tasaQueCae" qa nefan-core/test` → 0. El clasificador vuelve a
   DOS firmas y su docblock lo dice; no se inventa otro sujeto para la tercera.
4. Un negativo del punto 1: con el denominador de pared restaurado, el 93 a ×40 vuelve a rojo.
5. Guion 93 aislado y en par, tres corridas de cada.

## Fuera de alcance
- Sacar nada a `qa/lib/`: no queda parte pura que extraer.
- H-7: muere con la rama.
```
