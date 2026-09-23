# Requisitos — tanda AN: un contrato roto dentro de un describe pone rojo npm test (#697)

## Petición literal del usuario

> «Ve cerrando issues de github de forma autonoma con el sistema de agentes ya establecido» (2026-09-23)

El coordinador eligió este issue para la tanda. Sesión AUTÓNOMA: el usuario no está para dar visto bueno a mitad del ciclo; lo que haya que preguntarle se apunta como duda y se sigue con la suposición por defecto cuando no cambia QUÉ se construye.

## El issue, verbatim (cuerpo + comentarios, descargado hoy de GitHub)

### #697

> node --test sale con 0 cuando el cuerpo de un describe LANZA: cuatro sitios parsean un contrato dentro del describe y un JSON roto deja la suite verde
> 
> Encontrado por el ingeniero de la tanda AE (#611, 2026-09-20) porque su cuarto sabotaje salía VERDE cuando debía salir rojo. Medido en un fichero de tres líneas sin nada del repo.
> 
> ## El hecho
> 
> **`node --test` v24.11.1 sale con código 0 cuando el cuerpo de un `describe` lanza.** La suite entera desaparece (`ℹ tests 0 · fail 0`), se imprime un `✖` que ningún contador recoge, y `npm test` queda VERDE. Con el mismo `throw` a nivel de MÓDULO: `fail 1`, `EXIT = 1`.
> 
> Consecuencia: un `parse`/`JSON.parse` de un contrato hecho DENTRO del `describe` no puede poner rojo el build. Un contrato roto tumba la suite que lo vigilaba y el CI pasa.
> 
> ## Sitios vivos (contados uno a uno sobre `main` = `a25d8c2f`, no estimados)
> 
> - `nefan-core/test/contract-prompts.test.ts:189` y `:262` (`JSON.parse` de `generate_scene.json` en el cuerpo del describe: un tool con JSON roto deja la suite verde)
> - `nefan-core/test/scene-schema.test.ts:44`
> - `nefan-core/test/el-banco-declara-el-modo-de-gasto.test.ts:107`
> 
> Los dos de la tanda AE (`esperas-que-conducen.test.ts`, `espera-de-fotogramas-con-dueno.test.ts`) se subieron a módulo en su PR; el sabotaje pasó de verde a rojo con solo moverlos.
> 
> ## Lo que hay que hacer
> 
> 1. Subir esos cuatro `parse` a nivel de módulo (o a un `before` que falle en voz alta, verificando primero que `before` sí propaga el fallo en esta versión de Node).
> 2. **Candarlo**: un test que afirme que ningún `describe` de `test/*.test.ts` tiene, en su cuerpo directo (fuera de `it`/`before`), una llamada a `parse`/`safeParse`/`JSON.parse`/`readFileSync` — por el ÁRBOL, no por grep — o, mejor, un candado que demuestre que la suite se pone roja cuando un contrato está roto (sabotaje de un JSON en `qa/contrato-candados-en-negativo.mjs`, que ya existe para esto).
> 3. Declarar lo que NO cubre (un `describe` que lea el contrato vía helper importado).
> 
> Relacionado: #611 (donde apareció), #639 (un verde que no puede ponerse rojo).

## Criterios de aceptación

1. Los sitios vivos que parsean un contrato en el cuerpo directo de un `describe` se re-censan HOY por el árbol (la lista del issue es de `a25d8c2f`) y dejan de poder tumbar la suite en verde (a módulo, o a `before` tras verificar que `before` propaga en Node 24).
2. Candado: o un test por el ÁRBOL que prohíbe llamadas que pueden lanzar (parse/safeParse/JSON.parse/readFileSync…) en el cuerpo directo de un `describe`, o —preferible si es viable— un sabotaje en `qa/contrato-candados-en-negativo.mjs` que rompe un contrato y exige `npm test` rojo. Probado en negativo en ambos casos.
3. `_lo_que_esto_NO_sujeta` medido (p. ej. un describe que lee el contrato vía helper importado).
4. `npm test` / `verify` verdes; el conteo de tests no BAJA (subir los parse a módulo no debe hacer desaparecer suites).

## Contexto del coordinador

- Worktree: `/home/al/code/ne-fan-tanda-an`, rama `feature/tanda-an`, nacida de `main` = `83ea6046`. Todo el trabajo va en ese árbol, nunca en `/home/al/code/ne-fan`.
- Hay OTRAS cinco tandas en paralelo en worktrees hermanos (`ne-fan-tanda-{ah,ai,ak,al,am,an}`): #716 detector de saltos, #714 resume con tiles en clay, #709 ruff local, #704 un solo barrido del banco, #700 buscar con veces===1, #697 describe que lanza. Si esta tanda toca un fichero que otra también tocará con probabilidad (p. ej. `nefan-core/test/banco-ficheros.ts`, `package.json`, `ci.yml`), dilo en tu documento.
- Si hay que levantar un stack (qa/run.mjs), NUNCA matar procesos ajenos; `qa/run.mjs` elige bloque libre solo.
- Nada de gasto de créditos de imagen: preset `e2e-sin-creditos` / motor falso.
- Mutación: `npm run mutacion -- local <id>` si cabe en el tope; si no, se pide y no se espera.
- Commits intermedios en la rama (hubo límites de sesión que mataron agentes con trabajo sin commitear).

## Fuera de alcance

- Lo que el propio issue declara fuera.
- Issues vecinos que aparezcan: se ANOTAN (propuesta de issue nuevo en el documento), no se arreglan.

## Reencuadre del crítico, aceptado por el coordinador (2026-09-23, sesión autónoma)

Lo que sigue PREVALECE sobre los criterios de arriba. No tocar los barridos del banco que unifica la tanda AL (#704): el-cortafuegos…:288-296 y qa-lib-tiene-quien-lo-mire.test.ts:274.


> 1. **El mecanismo, no los sitios.** Medido el 2026-09-23 (Node v24.11.1): un `throw` en el cuerpo de un `describe` deja `tests 0 · fail 0` y EXIT=0, pero el runner SÍ emite el fallo (`not ok … type: 'suite'` en TAP, evento `test:fail` con `details.type === "suite"`). El arreglo es que **cualquier suite que falle ponga rojo** las TRES entradas al runner: `npm test` (verify), `npm run coverage` (lo que corre el job `nefan-core` de CI) y el `spawnSync(node --test …)` de `qa/contrato-candados-en-negativo.mjs`. El candado cubre todo `describe`, incluidos los que lanzan vía helper importado.
> 2. **Probado en negativo**: un sabotaje que rompe un contrato leído en el cuerpo de un `describe` (p. ej. `generate_scene.json`, leído en `contract-prompts.test.ts:189`) y exige rojo por cada una de las tres entradas; y otro por HELPER (p. ej. una fixture que rompa `loadFixtures` en `contract-fixtures.test.ts:128`), que es lo que un censo por nombres no vería.
> 3. **Sitios**: el recenso por árbol de hoy (4 del issue + `el-cortafuegos-del-tile-tiene-dueno.test.ts:295`, `contract-fixtures.test.ts:128`, `deuda.test.ts:24`, `ui-theme.test.ts:141`, `afectado.test.ts:921/1332`, `un-numero-un-guion.test.ts:75`, `qa-lib-tiene-quien-lo-mire.test.ts:274`) queda en el documento. Moverlos a módulo/`before` es opcional una vez cumplido (1); **no** se tocan `el-cortafuegos…:288-296` ni `qa-lib-tiene-quien-lo-mire.test.ts:274`, que son del barrido que unifica #704 en paralelo.
> 4. `_lo_que_esto_NO_sujeta`: solo si el mecanismo deja algo fuera, medido con un `it` — no la lista de helpers, que con (1) deja de ser un agujero.
> 5. Si (1) resultara inviable en alguna de las tres entradas, se dice cuál y por qué, medido, y SOLO entonces se cae al candado por árbol del issue, declarando los helpers del recenso como su agujero con su cifra.

(El criterio 4 original —verify verde, conteo de tests que no baja— se conserva. Línea base medida hoy sobre `83ea6046` con reporter TAP: **3264 tests, 564 suites, 0 `not ok`** — ninguna suite lanza en silencio ahora mismo, así que el arreglo del mecanismo no debería nacer rojo; si lo hace, es un hallazgo, no una regresión.)
