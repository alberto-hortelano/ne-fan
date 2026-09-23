# QA — tanda AM (#700): una sola función de anclas con `veces === 1`

Rama `feature/tanda-am` (`69b5a9d5` + este commit), worktree `/home/al/code/ne-fan-tanda-am`, base `83ea6046`.
Manda el reencuadre del crítico (`requisitos.md` §final). No se tocó código de producción ni de la tanda;
lo único que añade QA es el guion 164, su fila del README y este informe.

## Criterios (reencuadrados) → veredicto

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1 | UNA sola función de recuento/sustitución en `qa/lib/` con `veces === 1`, usada por los cinco sitios + absorbe `anclasSueltas`; semántica decidida y escrita | ✅ cumple | `qa/lib/anclas.mjs` (`aplicarPares`, `anclasSueltas`, `explicarAnclaSuelta`). Censo: `grep -rnE "split\([a-zA-Z_.]+\)\.length ?- ?1" qa/` → solo el comentario de cabecera de `anclas.mjs` y `guiones/68` (cuenta celdas de un grid JSON, no es un sabotaje); `includes\((busca\|buscar…)` y `\.replace\((buscar\|busca…)` → 0; `replace/replaceAll` con literal en `qa/` → 0. Importadores de `lib/anclas.mjs`: los cinco del plan + `guiones/148` (sexta copia, censada por el ingeniero) + el test. `anclasSueltas` ya no existe en `invariantes-en-negativo.mjs` (grep a cero fuera de `anclas.mjs`). Semántica SECUENCIAL (texto parcheado) con motivo escrito en el comentario de `aplicarPares` |
| 2 | Las anclas de los `rompe` de `reparto` se cuentan en CADA PR, también con `--solo-vigentes` | ✅ cumple | `ci.yml:270` corre `node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes`. Medido en local: limpio → `✔ los 9 patrones aparecen una vez cada uno · Probes con el patrón obsoleto : 0 de 9 · EXIT 0` (10,4 s). Forma 1 (línea duplicada en `mutacion-lotes.ts`) → `✖ PROBE OBSOLETO fusión · fusionar … / mutacion-lotes.ts: aparece 2 veces` · EXIT 1 (3,3 s). Forma 2 (`mutacion-repo.ts`) → `aparece 2 veces` · EXIT 1 (8,7 s). Ausente (`"tope_lote": 1800,` sin espacio en `mutation-targets.json`) → `aparece 0 veces` · EXIT 1 (8,3 s). Ningún «SIN CANDADO» en ninguna. **Guion 164** (abajo) lo deja ejecutable y entra en CI por `node qa/run.mjs --sin-navegador` (`ci.yml:453`) |
| 3 | Negativo unitario de la función: duplicado → obsoleto; ausente → obsoleto; una vez → sustituye | ✅ cumple | `node --import tsx --test test/las-anclas-de-los-candados.test.ts` → 16/16. Probado en negativo (cada sabotaje revertido con `git checkout`): `veces !== 1` → `veces < 1` ⇒ **3 rojos** (duplicado del detector, duplicado de `aplicarPares`, secuencial que crea copia); `trozos.join(poner)` → `actual.replace(buscar, poner)` ⇒ **1 rojo** (`poner` literal con `$&`); `if (!r.ok) sueltas.push` → `if (false)` ⇒ **2 rojos** |
| 4 | La función la importa un test de `nefan-core/test/` (`banco-medido.json`) | ✅ cumple | `qa-lib-tiene-quien-lo-mire.test.ts` 14/14 en verde; con el import del test apuntado a `invariantes-en-negativo.mjs` ⇒ rojo «qa/lib sin quien lo mire: anclas.mjs» (revertido) |
| — | `npm run verify` con el guion 164 en el árbol | ✅ | EXIT 0; `npm test` 3272/3272 |
| — | Guiones headless tocados | ✅ (dos de cuatro corridos por QA) | `contrato-candados-en-negativo.mjs` → «Patrón obsoleto: 0», EXIT 0; `mutacion-candados-en-negativo.mjs` → «NO se enteran: 0», EXIT 0. `cableado` y la completa de `reparto` los corrió el ingeniero (EXIT 0, 687 s); no repetidos por coste |
| — | `bateria-candados-en-negativo.mjs` | ⚠️ no probado | Necesita Chromium por invariante; su tabla pasa en `npm test` y el cambio es el mismo que en `contrato` (que sí corrí). Ver «No probado» |

## Pasada adversarial

**¿La semántica sobre texto parcheado cambia hoy el veredicto de alguna tabla?** No. Script en scratchpad
(`semanticas.mjs`) que carga las tres tablas con pares múltiples y compara «recuento sobre el original»
(la de `anclasSueltas` de antes) con `aplicarPares` (secuencial):

```
bateria:  10 entradas, 14 pares (4 entradas con >1 par) → MISMO veredicto en todas (todas verdes)
contrato: 30 entradas, 33 pares (3 entradas con >1 par) → MISMO veredicto en todas (todas verdes)
g148:     11 entradas, 11 pares (0 entradas con >1 par)  → MISMO veredicto en todas (todas verdes)
```

`cableado`, `mutacion-candados` y `reparto` llaman con UN par por probe: las dos semánticas son la misma
por construcción. El único sitio donde podrían divergir son las 7 entradas con >1 par, y hoy ningún
`poner` crea ni se come el `buscar` siguiente.

**¿Queda alguna copia del recuento?** No (fila 1). El único `split(x).length - 1` que sobrevive en `qa/`
es el del guion 68 sobre el JSON de un grid, que no sustituye nada.

**Riesgo `$` del plan**: `grep -nE '\$[&`'"'"'0-9<]'` sobre los siete ficheros con tabla → vacío.
Ningún `poner` dependía de la interpretación de `String.replace`.

**Bordes de la función** (medidos con `node -e`): `buscar` con caracteres de regex se trata literal
(`split` con string); `buscar` vacío lanza `TypeError` con mensaje propio (testado). Dos bordes sin test
van a hallazgos menores.

**Forma 1 «de verdad» (línea duplicada tal cual)**: además del «PROBE OBSOLETO», salen «Invariantes
vigentes rotos: 6 de 11», porque un `const` duplicado no compila y los vigentes que ejecutan la
herramienta se caen. No es un defecto de la tanda (el pre-vuelo lo dice ANTES y el veredicto lista las dos
causas), pero por eso el guion 164 pone el duplicado en un comentario de bloque: el rojo del pre-vuelo
tiene que verse solo.

## Guion 164 — `qa/guiones/164-el-prevuelo-de-anclas-de-reparto-se-pone-rojo-con-solo-vigentes.mjs`

`sinNavegador` + `sinMotor`; molde del 148 (se niega sobre árbol sucio, toma el turno «rompe-fuentes» que
`reparto` hereda por `NEFAN_QA_TURNO`, restaura y comprueba byte a byte). Afirma la premisa (`ci.yml`
corre `--solo-vigentes`), el limpio (exit 0 + «los N patrones aparecen una vez» + «0 de N») y, por cada
una de las tres formas: exit 1, «PROBE OBSOLETO» con el nombre del probe, fichero + «aparece N veces»,
«1 de N» + motivo del veredicto, y NINGÚN «SIN CANDADO». 19 asertos, ~35 s.

```
node qa/run.mjs --sin-navegador 164 → ✔ 1 en verde · 0 en rojo de 1  (34,9 s)
```

**Probado en negativo** (dos sabotajes de `reparto`, uno por vez, `git checkout` después):
- `anclasRotas > 0 ||` fuera del `roto` ⇒ **6 rojos** («VERDE CON EL PATRÓN DUPLICADO: el pre-vuelo no se enteró» ×3 + resumen ×3).
- `anclasRotas = soloVigentes ? 0 : sueltas.length` (la regresión exacta que #700 teme) ⇒ **los mismos 6 rojos**.

Lo que NO mira: la función (eso es el test unitario), el bucle de `ABIERTOS` de la corrida completa, y
que la línea base de `reparto` venga verde (issue propuesto por el ingeniero).

## Hallazgos

**Menor 1 — una entrada SIN pares sale «ok» en silencio.** `anclasSueltas([{nombre, fichero, pares: []}], …)`
→ `[]` y `aplicarPares("hola", [])` → `{ok:true, texto:"hola"}`. Un candado con cero pares no rompe
nada y su guion daría verde por la razón equivocada — el mismo modo de fallo que el `buscar` vacío, que
sí lanza. Hoy ninguna tabla lo tiene (medido: todas las entradas llevan ≥1 par), así que no es defecto
vivo. Esperado: lanzar como con el `buscar` vacío, o un aserto en el test de la tabla. Repro:
`node -e 'import("./qa/lib/anclas.mjs").then(m=>console.log(m.aplicarPares("x",[])))'`.

**Menor 2 — `texto` indefinido da un `TypeError` opaco.** `aplicarPares(undefined, [["a","b"]])` →
«Cannot read properties of undefined (reading 'split')». Es lo que pasaría en `cableado` o
`mutacion-candados` si un `rompe` apuntara a un fichero que no está en su `Map` de fuentes. NO es
regresión (antes `previo.split` fallaba igual), pero la función nueva es el sitio donde decirlo con
nombre («fichero sin leer»), como hace con el `buscar` vacío.

**Menor 3 — prosa desfasada (fuera de alcance, ya anotada por el ingeniero).** `qa/README.md:1150` dice
«~4 min» para la corrida completa de `reparto`; hoy son ~11 min (687 s medidos por el ingeniero).

**Menor 4 — coste en CI.** El 164 añade ~35 s al paso `node qa/run.mjs --sin-navegador` del job
`candados-headless` (cuatro arranques de `reparto`). Si el paso se vuelve caro, la primera economía es
quitar el «ausente» (la forma que ya cubre el test unitario) y dejar las dos del issue.

Ningún bloqueante ni importante.

## Workarounds usados

- Ninguno para observar la feature: las tres formas se midieron rompiendo el fuente EXACTAMENTE como
  lo haría una PR (duplicar una línea / quitar un espacio) y restaurando con `git checkout`.
- Para la comparación de semánticas se extrajo la tabla de `contrato` a un módulo de scratchpad
  (el guion tiene efectos al cargar). Es análisis, no afecta al usuario.
- El guion 164 pone el duplicado en un comentario de bloque en vez de como línea de código, para que el
  rojo del pre-vuelo no venga acompañado del rojo de compilación. Está justificado en su cabecera y en
  «Pasada adversarial»; el pre-vuelo cuenta texto, así que para él es el mismo duplicado.

## No probado

- `bateria-candados-en-negativo.mjs` ejecutado: una batería de Chromium por invariante; ni el ingeniero
  ni QA lo corrieron. Lo que sí está medido: su tabla en `npm test` con la semántica nueva (verde), el
  mismo cambio en `contrato` corrido en verde, y `node --check`.
- La corrida COMPLETA de `reparto` con el duplicado puesto (12-16 min por forma): el requisito la declara
  no obligatoria y el pre-vuelo la corta en segundos.
- `mutacion-cableado-en-negativo.mjs` (90 s) y la completa limpia de `reparto` (687 s): corridas por el
  ingeniero con EXIT 0, no repetidas por QA por coste.
- La corrida en CI de verdad: hasta que la PR exista no hay runner que lo diga (hook `ci-verde`).

## Solapamientos

Ningún fichero de tanda hermana tocado por QA. El 164 es `.mjs` (lista blanca de `banco-ficheros.ts`,
tanda AL) y usa el molde del 148, así que el detector de saltos (#356, ya en `main`) lo acepta:
`npm test` 3272/3272 con él en el árbol.

## Veredicto

**APTO.** Los cuatro criterios reencuadrados se cumplen con evidencia medida, cada candado nuevo se vio
rojo a propósito, la semántica elegida no cambia ningún veredicto de hoy, y no queda ninguna copia del
recuento. Los cuatro hallazgos son menores y ninguno es un defecto vivo.
