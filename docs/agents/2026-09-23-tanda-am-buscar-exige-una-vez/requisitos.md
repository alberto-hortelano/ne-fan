# Requisitos — tanda AM: el buscar de los guiones en negativo exige una sola aparición (#700)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

El coordinador eligió este issue para la tanda. Sesión AUTÓNOMA: el usuario no está para dar visto bueno a mitad del ciclo; lo que haya que preguntarle se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim (cuerpo + comentarios, descargado hoy de GitHub)

### #700

> El guion de lotes en negativo no exige veces === 1 en su buscar: un patrón duplicado sustituye el primero y calla
> 
> Encontrado por el ingeniero de la tanda AC (#605) al repuntar los `rompe`; QA lo confirmó leyendo `qa/mutacion-reparto-en-lotes.mjs:657-667` (`includes` + `replace`, sin `veces === 1`) y **lo midió con un duplicado sintético**, y el observable NO fue el que QA predijo. Corregido el 2026-09-20 con la medida delante.
> 
> ## El hecho
> 
> `qa/mutacion-cableado-en-negativo.mjs` exige que cada patrón de `rompe` aparezca EXACTAMENTE una vez y declara «patrón obsoleto» si no. Su hermano `qa/mutacion-reparto-en-lotes.mjs` no lo exige: `replace` sustituye la PRIMERA aparición. Hoy sus dos patrones aparecen una sola vez en la familia `mutacion-*.ts` (contado), así que no hay defecto vivo; el corte de #605 multiplica los ficheros donde un patrón puede repetirse.
> 
> ## Las DOS formas, medidas
> 
> 1. **Ruidosa y que apunta al sitio equivocado** (medida, `exit=1`, 12 min): con el patrón duplicado en un fichero que TAMBIÉN rompe `cableado`, éste sí ve `veces ≠ 1` y sale ≠ 0 sobre el árbol «limpio» → la línea base del guion de lotes ya trae `cableado:1` → el probe muta bien pero «nadie se entera» respecto a la base → el guion inventa un **hallazgo NUEVO sin candado** acusando a `fusionar` de haberse quedado sin candado (#420 «reabierto»): diagnóstico falso sobre un invariante sano.
> 2. **Silenciosa** (no medida, y es la que da miedo): un patrón duplicado en un fichero que `cableado` NO rompe, p. ej. `Math.max(...medidos)` en `mutacion-repo.ts`, cuyo único checker es `bateria`. Ahí el `replace` cae en la primera copia, nadie declara obsoleto, y el guion sigue verde por la razón equivocada.
> 
> `las-anclas-de-los-candados.test.ts` no cubre estos `.mjs`.
> 
> ## Lo que hay que hacer
> 
> Unificar el `buscar` de los dos guiones (una sola función en `qa/lib/`, con `veces === 1` y «patrón obsoleto» en los dos) y probarlo en negativo con las DOS formas: el duplicado en un fichero que `cableado` rompe (debe decir «patrón obsoleto», no inventar un hallazgo) y en uno que no (debe decir «patrón obsoleto», no verde).
> 
> Detalle de la medida en `docs/agents/2026-09-18-tanda-ac-mutacion-ts-troceado/qa.md` (hallazgo 4, con el matiz del ingeniero). Relacionado: #605, #572.

## Criterios de aceptación

1. `qa/mutacion-reparto-en-lotes.mjs` y `qa/mutacion-cableado-en-negativo.mjs` usan UNA sola función de búsqueda/sustitución en `qa/lib/` que exige `veces === 1` y declara «patrón obsoleto» si no.
2. Negativo de las DOS formas del issue: patrón duplicado en un fichero que `cableado` rompe → «patrón obsoleto» (no un hallazgo inventado); duplicado en un fichero que `cableado` NO rompe → «patrón obsoleto» (no verde). Medir lo barato; si alguna medida cuesta >10 min, decir el coste y medir la versión unitaria de la función.
3. La función nueva de `qa/lib/` la importa un test (regla `banco-medido.json`) y el job `candados-headless` la cubre.
4. Si otros guiones `qa/*.mjs` hacen el mismo `includes`+`replace` sin exigir unicidad, se censan y se pasan también (o se declara por qué no).

## Contexto del coordinador

- Worktree: `/home/al/code/ne-fan-tanda-am`, rama `feature/tanda-am`, nacida de `main` = `83ea6046`. Todo el trabajo va en ese árbol, nunca en `/home/al/code/ne-fan`.
- Hay OTRAS cinco tandas en paralelo en worktrees hermanos (`ne-fan-tanda-{ah,ai,ak,al,am,an}`): #716 detector de saltos, #714 resume con tiles en clay, #709 ruff local, #704 un solo barrido del banco, #700 buscar con veces===1, #697 describe que lanza. Si esta tanda toca un fichero que otra también tocará con probabilidad (p. ej. `nefan-core/test/banco-ficheros.ts`, `package.json`, `ci.yml`), dilo en tu documento.
- Si hay que levantar un stack (qa/run.mjs), NUNCA matar procesos ajenos; `qa/run.mjs` elige bloque libre solo.
- Nada de gasto de créditos de imagen: preset `e2e-sin-creditos` / motor falso.
- Mutación: `npm run mutacion -- local <id>` si cabe en el tope; si no, se pide y no se espera.
- Commits intermedios en la rama (hubo límites de sesión que mataron agentes con trabajo sin commitear).

## Fuera de alcance

- Lo que el propio issue declara fuera.
- Issues vecinos que aparezcan: se ANOTAN (propuesta de issue nuevo en el documento), no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23, sesión autónoma: no cambia QUÉ se construye)

Lo que sigue (copiado de critica.md) PREVALECE sobre los criterios de arriba donde choquen.


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
