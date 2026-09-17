# Crítica — Tanda L «La mutación no miente sobre lo que mide»

| Issue | Veredicto | En una línea |
|---|---|---|
| **#596** | **REENCUADRADA (MAYOR)** | No son «0 mutantes»: hay **22 módulos de 61** donde el break no puede disparar pase lo que pase |
| **#598** | **REENCUADRADA — se parte en tres** | Su premisa central es **falsa**: el candado no necesita corrida. Censo entero = **44 s**, y hay **un** infractor |
| **#604** | **VIGENTE** | Premisa exacta campo a campo; el motivo escrito se queda corto, y de él cuelga 598b |
| **#605** | **EN CONFLICTO (orden)** | El último y en su PR: trocear **no lo mide**, y 12 de 18 candados lo parchean por texto |
| **#462** | **REENCUADRADA** + decide el usuario | Media premisa nació falsa; el resto **no cabe en local**: corrida autorizada |
| **#514** | **VIGENTE, y CABE** | Ni partir la carpeta ni ampliar el perímetro: la puerta ya existe. **99–201 mutantes**, misma corrida que #462 |

Medido en `/home/al/code/ne-fan-l-mutacion` sobre `81735f13`. Cero créditos, ningún servicio arrancado.

## #596 · El break es un COCIENTE, y una muerte perdida sale de los dos lados

**Premisa cierta y viva.** `veredictoDeCorrida` (`scripts/mutacion-huella.ts:1240`) solo pregunta si el módulo **dejó informe**. Y `mutate.ts` ya calcula el hecho y lo tira: `total = vivos + detectados` deja fuera los `RuntimeError` (`mutation-plan.ts:1165`), la tabla imprime «SIN INFORME — la corrida no dejó medida» (`mutate.ts:283`) y el veredicto es `ok: r.status === 0` (`mutate.ts:134`), que no mira `total`. La puerta concreta de #597 sí está cerrada (`test/mutation-config.test.ts:562`).

**Lo que el issue no ve, y es mayor.** El suelo compara `(K−k)/(T−k)`: una muerte que pasa a `RuntimeError` sale del numerador **y** del denominador. Calculado sobre la huella commiteada, muertes que un módulo puede perder **sin que su suelo se entere**: `blueprint-volumenes` **12** (la cifra de los requisitos cuadra), `contrato-sprite-forge` **9**, `plugins-dsl` **8**, y **60 de los 61 módulos toleran ≥ 1**. El extremo no es `plugins-dsl`: son los **22 módulos con CERO supervivientes** (878 mutantes, de `state-http-dispatch` con 122 a `reaparicion` con 2), donde `K/K = 100 %` para **cualquier** número de muertes perdidas, incluida la pérdida TOTAL. `blueprint-plan` —el módulo del issue— es uno de los 22: el `NaN` era el final de una rampa.

**Una frase de los requisitos se cae**: «`plugins-dsl` pierde tres muertes y el score no se mueve ni una centésima» es **falso** — 956/1362 = 70,19 % → 953/1359 = 70,13 %, se mueve **6,6 centésimas**. Lo que no se mueve es el **entero** del break (70), y por eso caben 8.

**Segunda defensa que el issue no cita**: `deltaDeFichero` declara **incomparable** un fichero con el mismo blob y distinto total (`mutacion-huella.ts:354`) — el delta SÍ ve encoger el denominador, pero no es puerta: solo se sale ≠ 0 si `!veredicto.completa` (`mutacion.ts:1481`) y `repartir` escribe la huella igual, con el total ya encogido, que es la base de la comparación siguiente. **El día después**: `ok = status === 0 && total > 0` mata el `NaN` hoy; la rampa exige que el sujeto sea «el denominador encogió sin que cambiara el fuente», que ya se sabe calcular y hoy solo se imprime.

## #598 · Su premisa central es falsa, y lo caro no es lo que el issue cree

**«Con una corrida que reporte `NoCoverage` se puede candar; sin ella, no» — FALSO, medido.** La pregunta (¿ejerce la batería lo que muta?) la contesta `node --test --experimental-test-coverage` por batería: censo COMPLETO corrido aquí, **104 ficheros de test y 93 ficheros mutados en 44 s** (0,42 s cada uno). Salen **dos candidatos y un infractor**:

- `src/world-map/place-target.ts` con SU batería (módulo `world-map`, 8 tests): **3 de 39 líneas**, y las tres son la 7 (en blanco) y los dos `import` (9 y 10). El cuerpo **no lo ejecuta nadie de su batería**: son sus 35/35 `NoCoverage`, exactos.
- `src/simulation/reaparicion.ts` (5/45) es **falso positivo**: 45 líneas con su única función en la 43 — el artefacto de denominador de lcov que cerró #525.
- Los demás del top-10 del issue sí los ejerce su batería: `ai-client.ts` **156/190**, `scatter.ts` **497/537**. Su deuda es de RAMA, no de ejecución.

**El remedio de `place-target` no son 35 tests**: con la batería de `npc-director` —el módulo de su único consumidor en `src/`, excluido a mano del glob de `world-map`— sube a **25 de 39**. Está ejercido; está en el módulo equivocado. Es una línea de contrato. **El agujero con su nombre**: `test/mutation-config.test.ts:353` exige que la batería pueda **CARGAR** lo que muta, y cargar no es ejercer — **3 de los 8 tests lo importan y ninguno lo llama**.

**Se parte en tres**: **598a** candado «la batería EJERCE lo que muta» + reasignar `place-target` (entra); **598b** que la huella y `deuda` distingan `NoCoverage` de `Survived` (**es #604**, no se dobla); **598c** los tests de los 1.122 (programa, otra clase de deuda, fuera). **El día después de 598a**: `npc-director` pasa de 115 a ~150 mutantes y **sale del conjunto medible en local** (tope 120) — el `_comment` del contrato ya avisa de que está a 2 del tope.

## #604 · Vigente, y el motivo escrito se queda corto

**Verificada campo a campo**: `MedidaDeFichero` (`mutacion-huella.ts:200-240`) guarda `sha · run · fecha · blob · total · vivos · nuevos · resueltos · base · duenos · segundos`, ni `Timeout` ni `NoCoverage`; `timeoutsDeFichero` (`:126`) y `sinEjercerDeFichero` (`:146`) existen y solo los consume `comparar` leyendo `reports/`, que `traer` vacía. **Lo que subvalora**: lo presenta como peaje de comparar instrumentos, que pasó una vez. Lo que se paga en **cada corrida ordinaria** es que `esVivo` colapsa `Survived` y `NoCoverage` (`mutation-plan.ts:1152`): un superviviente que pasa a «no lo ejerce nadie» es invisible al delta. Peaje con número: **1.122 hashes en 43 ficheros contra 94 cuentas** si se guarda el censo, y el consumidor que hoy necesita el dato solo necesita contar.

## #605 · Real, pero su «por qué ahora» no se sostiene

1.692 líneas y diez verbos: **cierto** (1.693 hoy). «Ninguna herramienta lo mide»: **cierto** — CRAP mide `src/`, `bridge/` y `services/` (`crap-score.ts:42`) y el perímetro sale de `core-puro-sin-node`, que no nombra `scripts/`. **Pero trocear no lo mide**: cinco ficheros de 340 líneas en `scripts/` siguen igual de sin medir. Lo que mide es extraer la DECISIÓN a un módulo puro con batería, que es lo que ya es `mutacion-huella.ts`… **de 2.220 líneas**, más grande que el fichero que el issue quiere partir. Lo que queda en `mutacion.ts` es cáscara: **27 % comentario**, 8 `spawnSync`, 55 `console.*`, 7 exports de los que los tests importan dos. **El conflicto con número**: `qa/mutacion-cableado-en-negativo.mjs` —el único candado que lo sujeta— parchea **12 de sus 18 invariantes** por texto exacto dentro de `scripts/mutacion.ts`, así que el troceo reescribe en la misma PR la red que lo sujeta. Y #604 escribe en `repartir`, y la versión completa de #596 en `manifiesto`.

## #462 · Media premisa nació falsa; el resto lo decide el usuario

«`dispatcher.ts` no está en el `mutate` de ningún módulo»: **cierto hoy**. «(+ `dsl/evaluate.ts`)»: **falso, y ya lo era al abrirse el issue** — `src/plugins/dsl/*.ts` entró el **2026-08-23** (`14ea7e2c`), trece días antes, y `evaluate.ts` está en la huella con **68 mutantes y 14 vivos**. `narrative-state.ts` es #430 y no se dobla: bien. **Coste**: 251 líneas de código × la densidad medida de los 93 ficheros de la huella (p25 0,73 · mediana 1,04 · p75 1,48) = **183–371 mutantes**, mediana 262; tope local 120 y **solo 9 de los 93 ficheros** tienen densidad que cupiera → **no cabe en local, hace falta corrida autorizada**. **Alcance**: `src/plugins/**` no está en `core-puro-sin-node` y `directorios_completos` solo trae `src/plugins/dsl`, así que un módulo suelto es la puerta estrecha y la que cierra la clase es el directorio, con **7 ficheros más (1.321 líneas)** detrás. De paso: el `porque` de `src/plugins/dsl` afirma que está «dentro del perímetro que declara `core-puro-sin-node`» y **ninguna regla de `arch-rules.json` nombra `plugins`**.

## #514 · Vigente entero, y las dos opciones del issue son las caras

Verificado: `core-puro-sin-node` no nombra `src/games`, `grep -c src/games mutation-targets.json` = **0**, y el cliente importa los tres. **Pero la disyuntiva del issue es falsa**: `directorios_completos` es la puerta que ya existe para esto —`src/narrative` la usa con `session-storage.ts` importando `node:fs`, y su `porque` dice que es «la única puerta al perímetro que no exige mentir sobre la pureza»—. Medido, `src/games/` son **4 ficheros puros** (`style-refs`, `style-categories`, `ui-theme`, `style-application-schema`; los `node:` de los dos primeros están **en un comentario**) y **4 impuros** (`loader`, `style-application`, `vocabulary`, `world-snapshot`): ampliar `core-puro-sin-node` a `src/games/**` lo pone **rojo por cuatro**, y partir la carpeta mueve ficheros que el cliente importa por seis rutas. **Coste**: 136 líneas de código → **99–201 mutantes** (mediana 142). **La batería ya existe**: `test/style-refs.test.ts` (que importa `style-refs` **y** `style-categories`) está ya en la de `contrato-escena`, y `test/ui-theme.test.ts` existe y **no está en ninguna** — un test cuyo sujeto no mide nadie. Los importadores DIRECTOS son 3, 2 y 2 (`testsQueImportan` resuelve imports directos, `mutation-plan.ts:709`), así que las exclusiones con motivo son pocas y nombrables.

## Conflictos, orden y coste

1. **#462 y #514 son el MISMO gesto** (un fichero que la totalidad no ve porque su carpeta no está en el perímetro) y los dos necesitan **primera medida**. Por separado son **dos corridas autorizadas**; juntas, una: **282–572 mutantes** sobre los 13.285 de la completa, que hoy son ~20 min con `tap-runner`.
2. **#605 el último**, en su propia PR, después de #604 y #596: trocear mientras otros dos escriben dentro es cómo se pierden cambios.
3. **598b no existe aparte de #604**: si se abren los dos, uno se cierra como duplicado.
4. Ninguno choca con la tanda J (`qa/guiones`, `qa/lib`) ni con la K (`nefan-html`).
5. **Valor**: 598a y la mitad barata de #596 son horas y cierran dos verdes que no comprueban nada; #604 es el dato del que cuelga 598b; #462+#514 son JSON más una corrida que autoriza el usuario. **#605 es el único cuyo «no hacerlo» no cuesta nada**: no cambia ninguna medida y pone en riesgo a los otros tres.

## Qué cambiarle a `requisitos.md`, frase a frase

- **Línea 17**: «Un módulo que pierde muertes no lo nota su suelo: el break es un cociente y un `RuntimeError` sale de los dos lados. **22 de 61 módulos (878 mutantes) tienen cero supervivientes** y ahí el break no puede disparar pase lo que pase — el `NaN` es su caso límite».
- **Líneas 23-26**: sustituir el párrafo. `blueprint-volumenes` **12** se confirma; retirar «el score no se mueve ni una centésima» (se mueve 6,6: 70,19 → 70,13; lo que no se mueve es el entero del break); «SEIS módulos» se queda corto: **60 de 61** toleran ≥ 1 y **22** toleran la pérdida total.
- **Línea 18**: «**Un fichero mutado que su batería carga y no ejerce**: `place-target.ts`, 3 de 39 líneas, y las tres son un blanco y dos `import`. El candado exige CARGAR (`test/mutation-config.test.ts:353`), no ejercer. **El censo entero cuesta 44 s** con `--experimental-test-coverage`; no hace falta una corrida».
- **Punto 2 (líneas 33-36)**: «#598 se parte en **598a** (candado + reasignar `place-target`, entra), **598b** (= #604, no se dobla) y **598c** (los 1.122, fuera de la tanda)».
- **Punto 4 (líneas 39-41)**: «#462 entra **con #514**: mismo gesto y una sola corrida autorizada (282–572 mutantes). La mitad de `evaluate.ts` ya estaba medida desde el 2026-08-23».
- **Punto 1 (líneas 30-32)**: fijar el orden — **#605 el último y en su propia PR**, con criterio de cierre explícito: reescribir los **12 de 18** invariantes de `qa/mutacion-cableado-en-negativo.mjs` que parchean `scripts/mutacion.ts` por texto exacto.
- **Añadir #514 a la tabla**: «la puerta es `directorios_completos`, como `src/narrative`; ampliar `core-puro-sin-node` a `src/games/**` lo pone rojo por cuatro ficheros impuros».
- **Añadir a las restricciones**: no dar por medido `npc-director` después de moverle `place-target` — pasa de 115 a ~150 mutantes y sale del conjunto local.
