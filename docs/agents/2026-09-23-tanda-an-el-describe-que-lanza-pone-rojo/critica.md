**REENCUADRADA** — el fallo es del CÓDIGO DE SALIDA del runner, no de cuatro sitios; la lista del issue se ha quedado corta y el candado que propone no ve justo a los que faltan.

## El problema real, en una frase

Cuando el cuerpo de CUALQUIER `describe` lanza, `npm test` (y `npm run coverage`, que es lo que corre CI) sale con 0: la suite desaparece sin contar, y un contrato roto —o cualquier fichero que falte— deja el build en verde.

La solución que se propone (mover N llamadas a módulo + prohibir una lista de nombres) ataca los ejemplos, no el mecanismo.

## La premisa, afirmación por afirmación

| Afirmación del issue | Verificación (hoy, `main` = `83ea6046`, Node v24.11.1) |
|---|---|
| `describe` que lanza → exit 0, `tests 0 · fail 0` | **Cierto.** Fichero de 2 líneas: `ℹ tests 0 · fail 0`, EXIT=0; igual con `--import tsx` sobre `.ts`, y con varios ficheros y `--test-concurrency=4`. |
| El mismo `throw` en `before` sí propaga | **Cierto.** `before(() => JSON.parse("{roto"))` → EXIT=1. |
| Nadie recoge el `✖` | **Falso en parte, y es lo que más importa**: el runner SÍ emite el fallo. TAP imprime `not ok 1 - s` con `type: 'suite'`, y un reporter recibe `test:fail` con `details.type === "suite"`. Lo que no lo cuenta es el resumen y el exit code. El mecanismo es observable sin censar ningún fichero. |
| `contract-prompts.test.ts:189` y `:262` | **Vivos**, tal cual (`JSON.parse(readFileSync(generate_scene.json))` en el cuerpo). |
| `scene-schema.test.ts:44` | **Menor de lo dicho**: en el cuerpo solo hay `readdirSync(SCENES)` (`:44`); el `JSON.parse` está dentro del `it` (`:47`). Solo lanza si falta el directorio. |
| `el-banco-declara-el-modo-de-gasto.test.ts:107` | Vivo, pero lee **guiones** (`readdirSync`+`readFileSync`), no un contrato. |
| «cuatro sitios» | **Más, y crecen**: el censo del issue es de `a25d8c2f` (09-18). Recensado hoy por el ÁRBOL (parser de TS, 171 ficheros, sentencias directas de un `describe` fuera de `it`/`before*`/funciones anidadas): además de los cuatro, lanzan por E/S o por parse: |
| | · `el-cortafuegos-del-tile-tiene-dueno.test.ts:295` — `EsperasDeTileSchema.parse(JSON.parse(readFileSync(CONTRATO)))`. **Un contrato, parse literal, nacido DESPUÉS del issue** (PR #708, 2026-09-22). |
| | · `contract-fixtures.test.ts:128` — `loadFixtures(kind)`: las fixtures de CONTRATO, vía helper. |
| | · `deuda.test.ts:24` — `checkArchitecture(archConfig, loadArchFiles())`: lee el árbol del repo. |
| | · `ui-theme.test.ts:141` — `listStyles(REAL_STYLES)`: lee y valida los style packs. |
| | · `afectado.test.ts:921` y `:1332` — `leerPlan()`; `un-numero-un-guion.test.ts:75` — `readdirSync`; `qa-lib-tiene-quien-lo-mire.test.ts:274` y `el-cortafuegos…:296` — `ficherosDelBanco`. |
| Los dos de la tanda AE se subieron a módulo | Cierto: `espera-de-fotogramas-con-dueno.test.ts:329` y `esperas-que-conducen.test.ts:405` solo trabajan sobre `contrato` ya parseado. |

Consecuencia: el censo por nombres (`parse`/`safeParse`/`JSON.parse`/`readFileSync`) cazaría 4-5 de ~12. Los que se escapan van por **helper** (`loadFixtures`, `listStyles`, `leerPlan`, `checkArchitecture`), que es exactamente lo que el punto 3 del issue propone «declarar como no cubierto». Declarar como agujero la MAYORÍA del censo no es un candado: es el caso «censo ciego a la escritura» (memoria del proyecto) con el agujero escrito en el padrón.

## El día después

- **Para quien juega**: nada directo. Es deuda declarada de la red de seguridad: hoy un `generate_scene.json`, un `esperas-de-tile` o una fixture de contrato rotos pasan CI. Vale la pena.
- **Si se hace como está escrito** (mover sitios + prohibir nombres): quedan vivos los sitios por helper, y el siguiente test que escriba alguien con un helper nuevo vuelve a abrir el agujero en verde. El candado dirá «ninguna llamada que lance en un describe» y comprobará «ninguna de estas cuatro grafías» — lo que el candado DICE no es lo que comprueba.
- **Si el candado va al mecanismo** (una suite que falla pone rojo el exit code), los cuatro movimientos pasan a ser higiene opcional, no el arreglo, y no hace falta padrón `_lo_que_esto_NO_sujeta` de helpers: el agujero por helper deja de existir. Lo que sí habría que declarar entonces es lo que el mecanismo no vea (si hay alguno), medido.
- **Puertas que se cierran**: el `npm test` de `verify`, el `npm run coverage` de CI (`ci.yml:69`, el job `nefan-core` NO corre `npm test`) y el `spawnSync("node", ["--import","tsx","--test",…])` de `qa/contrato-candados-en-negativo.mjs:381` son tres entradas al mismo runner. Arreglar una sola deja las otras dos saliendo con 0; en particular, el arnés de sabotajes tiene hoy la misma ceguera que el issue denuncia.
- **Lo que parecerá arbitrario en un mes**: una lista de cuatro nombres prohibidos en un `describe` sin que nada impida `const x = cargar()`.

## Conflictos

- **#704 (tanda en paralelo, un solo barrido del banco)**: toca los barridos locales de `qa/`. Dos de los sitios del recenso son eso: `el-cortafuegos-del-tile-tiene-dueno.test.ts:288-296` (su propio `ficherosDelBanco`) y `qa-lib-tiene-quien-lo-mire.test.ts:274`. Si AN los mueve a módulo y #704 los sustituye por el barrido único, conflicto textual seguro. Recomendación: AN **no** mueve esos dos (si el candado va al exit code, no hace falta); si los mueve, lo deja escrito para que el coordinador ordene el merge.
- **`nefan-core/package.json`**: si el arreglo toca los scripts `test`/`coverage`, es fichero compartido con cualquier otra tanda que toque scripts (#709 es Python, en principio no). Avisar al coordinador.
- `CLAUDE.md` / `arch-rules.json`: sin contradicción. Encaja con «candado, no prosa» y con «un verde que no puede ponerse rojo».
- «Relacionado: #639» en el issue: #639 (cerrado) es el ENOENT del guion 141, no un verde imposible. Referencia errónea, sin consecuencia.

## Coste contra valor

Barato (un mecanismo + sus negativos, o unas decenas de líneas movidas) y el valor es alto: es el tipo de verde que no puede ponerse rojo, en la puerta que vigila los contratos del modelo. Sin hacerlo, el próximo contrato roto dentro de un `describe` —y el censo muestra que se siguen escribiendo, #708 metió uno hace un día— pasa CI. «No hacer nada» no es aceptable. Pero hacerlo **solo** como está escrito paga el trabajo y deja la mitad del agujero abierto, con un padrón que lo declara.

## Qué le cambiaría a `requisitos.md` (pegar tal cual sustituyendo los criterios 1-3)

> 1. **El mecanismo, no los sitios.** Medido el 2026-09-23 (Node v24.11.1): un `throw` en el cuerpo de un `describe` deja `tests 0 · fail 0` y EXIT=0, pero el runner SÍ emite el fallo (`not ok … type: 'suite'` en TAP, evento `test:fail` con `details.type === "suite"`). El arreglo es que **cualquier suite que falle ponga rojo** las TRES entradas al runner: `npm test` (verify), `npm run coverage` (lo que corre el job `nefan-core` de CI) y el `spawnSync(node --test …)` de `qa/contrato-candados-en-negativo.mjs`. El candado cubre todo `describe`, incluidos los que lanzan vía helper importado.
> 2. **Probado en negativo**: un sabotaje que rompe un contrato leído en el cuerpo de un `describe` (p. ej. `generate_scene.json`, leído en `contract-prompts.test.ts:189`) y exige rojo por cada una de las tres entradas; y otro por HELPER (p. ej. una fixture que rompa `loadFixtures` en `contract-fixtures.test.ts:128`), que es lo que un censo por nombres no vería.
> 3. **Sitios**: el recenso por árbol de hoy (4 del issue + `el-cortafuegos-del-tile-tiene-dueno.test.ts:295`, `contract-fixtures.test.ts:128`, `deuda.test.ts:24`, `ui-theme.test.ts:141`, `afectado.test.ts:921/1332`, `un-numero-un-guion.test.ts:75`, `qa-lib-tiene-quien-lo-mire.test.ts:274`) queda en el documento. Moverlos a módulo/`before` es opcional una vez cumplido (1); **no** se tocan `el-cortafuegos…:288-296` ni `qa-lib-tiene-quien-lo-mire.test.ts:274`, que son del barrido que unifica #704 en paralelo.
> 4. `_lo_que_esto_NO_sujeta`: solo si el mecanismo deja algo fuera, medido con un `it` — no la lista de helpers, que con (1) deja de ser un agujero.
> 5. Si (1) resultara inviable en alguna de las tres entradas, se dice cuál y por qué, medido, y SOLO entonces se cae al candado por árbol del issue, declarando los helpers del recenso como su agujero con su cifra.

(El criterio 4 original —verify verde, conteo de tests que no baja— se conserva. Línea base medida hoy sobre `83ea6046` con reporter TAP: **3264 tests, 564 suites, 0 `not ok`** — ninguna suite lanza en silencio ahora mismo, así que el arreglo del mecanismo no debería nacer rojo; si lo hace, es un hallazgo, no una regresión.)
