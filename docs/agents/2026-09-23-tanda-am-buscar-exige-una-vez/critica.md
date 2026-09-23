**REENCUADRADA** — el problema es real, pero el alcance es mayor (cinco copias del recuento, no dos) y el criterio 3 no se puede cumplir tal como está: la búsqueda de `reparto-en-lotes` no corre en CI.

## El problema real en una frase

Un `rompe` de `qa/mutacion-reparto-en-lotes.mjs` cuyo patrón deja de estar exactamente una vez en su fichero sigue sin avisar: cae sobre la primera copia, y el guion da un veredicto (verde o un hallazgo inventado) sobre algo que no ha probado.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación |
|---|---|
| `reparto-en-lotes` hace `includes` + `replace` sin `veces === 1` | **Cierto.** `qa/mutacion-reparto-en-lotes.mjs:657` (`!texto.includes(busca)`) y `:667` (`texto.replace(busca, pone)`) |
| `cableado` exige `veces === 1` y dice «patrón obsoleto» | **Cierto.** `qa/mutacion-cableado-en-negativo.mjs:822-826` |
| «Hoy sus dos patrones aparecen una vez» | **Se queda corto**: hay **nueve** `rompe` en `ABIERTOS` (`:383-487`), no dos. Los he contado hoy contra `83ea6046`: los nueve aparecen 1 vez. No hay ningún defecto vivo, igual que dice el issue |
| Forma 1 (ruidosa), medida con `exit=1` | **Cierto y documentado**: `docs/agents/2026-09-18-tanda-ac-mutacion-ts-troceado/qa.md:93-107` (línea base `cableado:1` → «SIN CANDADO» falso sobre `fusionar`) |
| Forma 2 (silenciosa) | Plausible y no medida. `segundosDe` tiene `checkers: ["bateria","cableado"]` (`:427`), no solo `bateria` como dice el issue; el mecanismo es el mismo |
| `las-anclas-de-los-candados.test.ts` no cubre estos `.mjs` | **Cierto.** Solo importa la tabla de `qa/lib/invariantes-en-negativo.mjs` |

**Lo que el issue no dice y cambia el alcance** (criterio 4 del requisito, ya censado):
el mismo recuento `split(buscar).length - 1` + «patrón obsoleto» está copiado **cinco** veces:
`qa/bateria-candados-en-negativo.mjs:158`, `qa/contrato-candados-en-negativo.mjs:465`,
`qa/mutacion-candados-en-negativo.mjs:372`, `qa/mutacion-cableado-en-negativo.mjs:822`, y
**ya existe en `qa/lib/`**: `anclasSueltas` (`qa/lib/invariantes-en-negativo.mjs:248-259`),
importada por un test. `reparto-en-lotes` es el único que no lo tiene. El resto de `.replace(` de
`qa/*.mjs` son regex sobre rutas o texto de salida, no roturas de código (lo he mirado fichero por fichero).
Hay además una diferencia de semántica entre las copias: `bateria` y `contrato` cuentan sobre el texto
**ya parcheado** por los pares anteriores; `anclasSueltas` cuenta sobre el **original**, y lo dice
de forma deliberada (`:241-247`). Una función única tiene que elegir, y esa elección le toca al arquitecto.

**Criterio 3 tal como está escrito, falso por construcción:** CI corre
`node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes` (`.github/workflows/ci.yml:270`), y
`--solo-vigentes` se salta el bloque `ABIERTOS` entero (`:648`). La búsqueda que arregla este issue
solo corre en la corrida local completa (~4-16 min, `qa/README.md:1150`, `qa.md:20`), es decir,
cuando alguien paga lo caro. Es la misma enfermedad que #486 curó para la batería: el recuento
barato vivía dentro de la corrida cara y por eso casi nunca se hacía
(`qa/lib/invariantes-en-negativo.mjs:1-13`). Si el `veces === 1` se pone solo dentro del bucle,
el ancla podrida se sigue descubriendo el día que alguien corre los 16 minutos, y no en la PR que la pudrió.

## El día después

- Quien juega no nota nada. Es deuda declarada del banco, así que es legítima.
- Si se hace tal como está escrita (una función nueva para dos guiones), `qa/lib/` acaba con **dos**
  funciones de recuento (la nueva y `anclasSueltas`) y tres guiones con la copia en línea. Dentro de
  un mes, «una sola función» será mentira.
- La forma 1 solo se arregla a medias. La causa de fondo es que `reparto` **no exige una línea base
  verde**: imprime la base (`:651`) y compara contra ella aunque venga con `cableado:1`. Un checker
  rojo en la base deja ciego a ese checker para todos los probes. Con `veces === 1` este caso concreto
  pasa a decir «patrón obsoleto», pero cualquier otra causa que ponga `cableado` rojo en limpio seguirá
  fabricando «SIN CANDADO» falsos. Eso es otro defecto y se anota aparte (abajo).

## Conflictos

- **#704** (un solo barrido del banco, otra tanda en paralelo): los dos tocan la frontera `qa/lib` ↔
  `nefan-core/test/`. Si esta tanda crea un módulo nuevo en `qa/lib/`, lo registra
  `test/qa-lib-tiene-quien-lo-mire.test.ts` / `banco-medido.json`. Solapamiento de ficheros probable
  (`nefan-core/test/banco-ficheros.ts`), pero ninguna contradicción. Hay que fusionar con cuidado.
- Ninguna contradicción con `arch-rules.json`: la dirección test → banco es la regla
  (`el-banco-no-entra-en-produccion`).
- Ningún otro issue abierto toca anclas ni `buscar` (`gh issue list`, 2026-09-23).

## Coste contra valor

Es barato y el valor es real pero pequeño: hoy no hay ningún defecto vivo. Si no se hiciera nunca,
el día que un patrón se duplique, la corrida local de 16 min daría un diagnóstico falso (ya medido
una vez). El valor sube bastante si el recuento corre en cada PR, que es lo que protege de verdad.
Medir la forma 1 o la 2 contra el guion entero cuesta ~12-16 min cada una. El requisito ya permite
la versión unitaria, y es la que hay que pedir.

## Qué le cambiaría a `requisitos.md` (para pegar)

> **Criterios de aceptación (reencuadrados por el crítico)**
>
> 1. UNA sola función de recuento/sustitución en `qa/lib/` que exige `veces === 1`. La usan los CINCO
>    sitios que hoy cuentan o deberían contar: `mutacion-reparto-en-lotes.mjs`,
>    `mutacion-cableado-en-negativo.mjs`, `mutacion-candados-en-negativo.mjs`,
>    `contrato-candados-en-negativo.mjs`, `bateria-candados-en-negativo.mjs`, y absorbe o sustituye
>    `anclasSueltas` de `qa/lib/invariantes-en-negativo.mjs` (no puede acabar habiendo dos). Si se
>    cuenta sobre el original o sobre el texto ya parcheado, se decide y se escribe.
> 2. Las anclas de los `rompe` de `mutacion-reparto-en-lotes.mjs` se cuentan en CADA PR (`npm test`
>    o `candados-headless`), no solo en la corrida local completa: hoy CI la corre con
>    `--solo-vigentes`, que no llega al bucle de `ABIERTOS`.
> 3. Negativo de las dos formas del issue en la versión UNITARIA de la función (duplicado → «patrón
>    obsoleto»; ausente → «patrón obsoleto»; una vez → sustituye). La corrida entera de `reparto` con
>    el duplicado (~12-16 min) no es obligatoria. Si se hace, se dice el coste.
> 4. La función la importa un test de `nefan-core/test/` (regla de `banco-medido.json`).
>
> **Fuera de alcance, con propuesta de issue:** «`mutacion-reparto-en-lotes.mjs` no exige una línea
> base verde (`:648-651`): un checker rojo sobre el árbol limpio deja ciego a ese checker para todos
> los probes y fabrica hallazgos "SIN CANDADO" falsos. La forma 1 de #700 es un caso de esto.»
