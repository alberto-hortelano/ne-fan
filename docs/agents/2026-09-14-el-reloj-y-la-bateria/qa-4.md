# QA 4 · PR-2 de la segunda mitad de la tanda D — #597, los 26 que `tap-runner` no sabía leer

Validado en `/home/al/code/ne-fan-qa597`, detached en `00da06e5`, contra la petición original de
`requisitos.md` (#443 cerrado en «no se adopta» por 26 mutantes; #597 los devuelve a `Killed`).
Cero créditos, cero servicios arrancados, ningún proceso ajeno tocado. Todas las medidas de mutación
a concurrencia 2 y de una en una.

**`uptime` alrededor de la sesión:** antes `12:48 load 1,33 / 1,75 / 1,91` · pico durante el dry run
de los 58 `2,20 / 1,93 / 2,18` sobre 16 núcleos · después `13:18 load 0,48 / 1,40 / 1,96`.

**VEREDICTO: APTO CON HALLAZGOS.** Los cuatro criterios del paso 0 se reproducen exactos, los 26
mutantes vuelven a `Killed` (los **26 verificados por mí**, no 5), los candados nuevos se ven rojos
en las dos direcciones y el árbol está verde. Los hallazgos son **de justificación y de evidencia,
no de mecanismo**: ninguno cambia lo que la rama mide, y ninguno bloquea pedir la corrida.

---

## 1 · Criterios de aceptación

Criterios tomados de `requisitos.md` §1 (#597) y del contrato numérico que el propio plan fijó en
§4.2, más los que se derivan de la petición del usuario («si un solo score se mueve fichero a
fichero, no se adopta»).

| # | Criterio | Veredicto | Evidencia que medí YO |
|---|---|---|---|
| 1 | `contrato-sprite-forge` → `{Killed 56, Survived 6, NoCoverage 1}`, total **63**, score 88,89 % ≥ break 87 | ✅ cumple | `npm run mutacion -- local contrato-sprite-forge` → `# killed 56 · # timeout 0 · # survived 6 · # no cov 1 · # errors 0`; `score 88.89 ≥ break 87`; `63 mutantes · 7 vivos · 9s` |
| 2 | Cero `RuntimeError`, y los 5 nominales `Killed` **por huella** | ✅ cumple | `# errors 0`. Los cinco, por fichero:línea:columna+mutador+reemplazo: `97:61 StringLiteral→""`, `99:13 ObjectLiteral→{}`, `100:26 BooleanLiteral→false`, `106:12 ObjectLiteral→{}`, `106:33 BooleanLiteral→true` — **los cinco `base=Killed ahora=Killed`** |
| 3 | La cobertura sigue viva: `NoCoverage` = **1**, ni 0 ni decenas | ✅ cumple | `NoCoverage` = 1, y es `153:42-153:88 StringLiteral => "``"`. Además, evidencia **más fuerte que la del informe**: `coveredBy` poblado — distribución base `{0: 63}` (sin cobertura) contra ahora `{1: 62, 0: 1}`; y `Ran 0.98 tests per mutant` (con cobertura muerta sería 1.00) |
| 4 | Mismas huellas, 1 solo cambio `Survived → NoCoverage`, **0 nuevos y 0 resueltos** | ✅ cumple | Comparación mutante a mutante con huella de 7 campos: `mismas huellas: True`, `base {Killed 56, Survived 7}` → `ahora {Killed 56, Survived 6, NoCoverage 1}`, **CAMBIOS: 1**, y es el documentado |
| 5 | Los otros 21 de los 26, medidos y `Killed` | ✅ cumple | **Los 21 reproducidos por mí** con `mutate` acotado al rango: `blueprint-suelo` 6/6 · `state-http-dispatch` 1/1 · `blueprint-volumenes` 12/12 · `blueprint-derive` 2/2. **26 de 26 verificados** |
| 6 | Acotar el rango no perturba el estado del mutante | ✅ cumple | Control propio en `blueprint-plan`: entero 38 mutantes vs acotado a `plan-collision.ts:44-52` (2 mutantes) → **0 discrepancias de estado y 0 de `coveredBy`**. Y en los 4 módulos acotados, **69 mutantes comparados** contra la base `command` (26 · 4 · 17 · 22) con **0 cambios de estado** |
| 7 | El candado nuevo exige que el tope de heap **aplique**, no que esté escrito | ✅ cumple | Medido por mí con `--max-old-space-size=16` sobre un test que pide ~320 MB: sin `--test` exit **134**; `--test` a secas exit **0** (el tope es un no-op); `--test --test-isolation=none` exit **134**; `--test-isolation=process` exit **0**. El aserto usa `correEnElMismoProceso`, que rechaza los dos casos malos |
| 8 | El candado se ve rojo con `--test` a secas | ✅ cumple | `node --import tsx --test … test/mutation-config.test.ts` con `node_args` sin `--test-isolation=none` → `# pass 27 · # fail 4`; control `# pass 31 · # fail 0` |
| 9 | Y en la otra dirección: sin `--test` (como se perdieron los 26) | ✅ cumple | `# pass 30 · # fail 1`. Probé además `--test-isolation=process` (fail 4), sin `--max-old-space-size` (fail 1) y sin `--test-reporter=tap` (fail 1). **Seis negativos, seis rojos, control verde** |
| 10 | `blueprint-derive` NO se midió forzando el tope; `tope_local` sin tocar | ✅ cumple | `tope_local` sigue en **120**; `blueprint-derive` (484) no aparece en «Medibles aquí» de `mutacion -- pendiente`. El sustituto con `Timeout` es `arch-cierre` |
| 11 | `arch-cierre`: los 3 `Timeout` siguen `Timeout`, `cambios: 0` | ✅ cumple | `# killed 45 · # timeout 3 · # survived 0`, score 100 ≥ break 100. Huella completa: base 48 = ahora 48, **CAMBIOS: 0** |
| 12 | Dry run de los 58 módulos: 0 MAL, «Ran N tests» con N = batería | ✅ cumple | `npx tsx scripts/paso-b-tap.ts --modulos` → `=== 58 módulos, 0 MAL ===`, 2 m 21 s |
| 13 | Los 100 ficheros de batería reportan TAP con las flags nuevas | ✅ cumple | `npx tsx scripts/paso-b-tap.ts` → `=== 100 ficheros, 0 MAL ===` |
| 14 | `npm run verify` verde, 2722 tests | ✅ cumple | `tests 2722 · pass 2722 · fail 0 · suites 481` (build + 3 typechecks + lint + test) |
| 15 | Deuda sin items nuevos; CRAP dentro del tope | ✅ cumple | `CRAP ≤ 73 — 0 por encima`, `cobertura 95.93 % ≥ 95 %`. Deuda **86** = 11 fronteras + **11 CRAP** + 64 supervivientes, todos `ya estaban` (el informe dice 75 porque corrió sin la fuente de CRAP: 75 + 11 = 86). El diff **no toca ni un `src/`, `bridge/`, `services/` ni `nefan-html/`** |
| 16 | Los candados headless de mutación siguen verdes | ✅ cumple | `mutacion-candados-en-negativo` · `mutacion-cableado-en-negativo` · `mutacion-reparto-en-lotes --solo-vigentes` · `mutacion-la-septima-en-los-dos-sentidos` → los cuatro exit 0 |
| 17 | `afectado` fuerza la corrida COMPLETA | ✅ cumple | `npm run afectado -- --desde origin/main` → `TODOS`, por `node_args`, `package-lock.json`, `stryker.config.json` y los `scripts/` del instrumento |
| 18 | La precondición de la comparación: las huellas siguen casando | ✅ cumple (con nota) | 90 de 91 blobs de `mutacion-huella.json` casan con el árbol. El que no (`src/protocol/status-labels.ts`) **no existe** desde #433 y ningún módulo lo muta: entrada rancia **preexistente en `main`**, no de esta rama |
| 19 | `coverageAnalysis: "perTest"` es lo que produce el filtrado | ❌ **NO cumple** | Medido: con `tap-runner`, `off` y `perTest` dan **el mismo resultado, el mismo reloj y el mismo filtrado**. Ver H-1 |
| 20 | El score idéntico en los 58 | ⚠️ no probado | Solo lo dice la corrida autorizada. Por diseño: es el paso 1 de #443 |
| 21 | Los 144 `Timeout` de la base | ⚠️ no probado (y la muestra engaña) | 4 observados quietos, pero **3 de los 4 en un módulo donde el mecanismo no puede actuar**. Ver H-2 |

---

## 2 · Hallazgos

### H-1 · IMPORTANTE — `coverageAnalysis` es INERTE con `tap-runner`, y el candado que lo guarda publica una causalidad falsa

**Qué pasa.** Con `testRunner: "tap"`, poner `coverageAnalysis` en `"off"` o en `"perTest"` produce
**exactamente el mismo resultado**: la cobertura se recoge igual, el filtrado por mutante funciona
igual y el reloj es el mismo. El ahorro **no viene del ajuste**: viene del runner.

**Reproducción** (desde `/home/al/code/ne-fan-qa597/nefan-core`, cambiando solo `coverageAnalysis`
en `stryker.config.json` y restaurando después):

| `coverageAnalysis` | `blueprint-plan` (batería de 3) | `contrato-sprite-forge` |
|---|---|---|
| `"perTest"` | `Ran 0.97 tests per mutant` · **10 s** · `{Killed 37, Timeout 1}` | `{Killed 56, Survived 6, NoCoverage 1}` |
| `"off"` | `Ran 0.97 tests per mutant` · **10 s** · `{Killed 37, Timeout 1}` | `{Killed 56, Survived 6, NoCoverage 1}` |

El informe generado con `off` lo confirma: `config.coverageAnalysis: "off"`, `config.testRunner:
"tap"`, y sin embargo `coveredBy` poblado (`{1: 62, 0: 1}`) y `NoCoverage: 1`. Si `off` apagara de
verdad el filtrado, `blueprint-plan` habría corrido sus 3 ficheros por mutante y tardado lo que el
brazo `command` (~23 s).

**El mecanismo, leído en las fuentes instaladas:**

- `tap-test-runner.js` · `dryRun(options)` **nunca lee `options.coverageAnalysis`**; devuelve
  siempre `mutantCoverage: totalCoverage`.
- `core/dist/src/mutants/test-coverage.js:24` · `get hasCoverage() { return !!this.#staticCoverage; }`
  — depende de **lo que reportó el runner**, no del ajuste. El comentario de Stryker al lado
  (`// If there was coverage information (coverageAnalysis not "off")`) es justamente la suposición
  que aquí no se cumple.
- El instrumenter no menciona `coverageAnalysis` en ningún sitio: instrumenta la cobertura siempre.

**Por qué importa, y por qué es el patrón que la tanda persigue.** El candado
`coverageAnalysis no puede prometer un filtrado que el runner tira a la basura` es un buen candado
mal justificado: **puede ponerse rojo, pero ponerse rojo no protege nada** — el valor que exige no
cambia ninguna medida. Y su docblock afirma lo contrario, con las palabras de una medida:

> «#443 accionó la palanca de verdad: con `testRunner: "tap"` el valor que NO hace nada es el otro.»

Medido: con `tap` **ninguno de los dos hace nada**. La misma afirmación viaja en dos sitios más:
`stryker.config.json` `_comment` («con `"off"` se vuelve a pagar la batería entera») y el docblock
del candado («sin `"perTest"` cada mutante vuelve a ejecutar la batería entera y se tira el único
motivo por el que se cambió de runner»). Las tres son falsas, y son de las que se congelan como
documentación verdadera: dentro de un mes, quien quiera medir «cuánto aporta `perTest`» medirá cero
y no sabrá si rompió algo.

**Y hay una consecuencia que sí puede morder.** #599 infiere «base con `coverageAnalysis: "off"` ⟹
no podía expresar `NoCoverage` ⟹ la séptima condición se abstiene». Esa inferencia es cierta para el
runner `command` (la base `34872537438`) y **falsa para `tap` + `off`**, que sí emite `NoCoverage` —
lo acabo de medir. `coberturaDelInforme` (`scripts/mutacion-comparar.ts:141`) lee **solo**
`config.coverageAnalysis`, teniendo `config.testRunner` en el mismo objeto. Hoy lo tapa el candado
de H-1; o sea que el valor real de ese candado es proteger la inferencia de #599, que **no es la
razón que da**. Si algún día se mide una base con `tap` + `off`, la séptima se abstendría sobre un
informe que sí midió: un «no se pudo mirar» sobre algo que sí se miró.

**No bloquea la corrida:** la rama mide lo mismo con el valor que trae. Es deuda de verdad escrita,
no de instrumento.

---

### H-2 · IMPORTANTE — la evidencia sobre los `Timeout` es 1 muestra informativa, no 4; y hay un mecanismo que nadie ha nombrado

El informe declara: «de los 144 `Timeout` de la base he visto quedarse quietos **4**: los 3 de
`arch-cierre` y el 1 de `blueprint-plan`». Los verifiqué: son ciertos (`arch-cierre` base 48 = ahora
48, `cambios: 0`, los 3 `Timeout` siguen `Timeout` por huella). **Pero 3 de los 4 vienen del único
sitio donde nada podía moverse.**

**El mecanismo, leído en `core/dist/src/mutants/mutant-test-planner.js:124`:**

```
const timeout = timeoutFactor * netTime + timeoutMS + this.timeOverheadMS;
```

- sin cobertura (runner `command`) → `netTime = this.timeSpentAllTests`, **la batería entera**, para
  todos los mutantes (`:101-106`, rama «No coverage information exists»);
- con el filtrado de `tap-runner` → `netTime` = solo los ficheros que cubren al mutante.

O sea: **el presupuesto de reloj por mutante se encoge en la misma proporción que la batería.** Ése
es el motivo concreto por el que un `Timeout` puede moverse, y no aparece en ningún documento de la
tanda (que habla de «un runner que cambia la forma del proceso»).

Cruzando los 144 `Timeout` de la base con el tamaño de batería de su módulo:

| módulo | `Timeout` | batería | presupuesto por mutante |
|---|---|---|---|
| `plugins-dsl` | 42 | 2 | se encoge ~2× |
| `blueprint-huella` | 22 | 6 | se encoge ~6× |
| `blueprint-derive` | 19 | 5 | se encoge ~5× |
| `world-map` | 14 | 8 | se encoge ~8× |
| `scene-validate` | 12 | 4 | se encoge ~4× |
| `blueprint-fps-detalle` | 10 | 2 | se encoge ~2× |
| `blueprint-scatter` | 7 | **1** | **idéntico** |
| `greybox-volumenes` | 6 | 5 | se encoge ~5× |
| `blueprint-suelo` | 5 | 7 | se encoge ~7× |
| `arch-cierre` | **3** | **1** | **idéntico** |
| `ai-client` | 2 | **1** | **idéntico** |
| `blueprint-plan` | **1** | 3 | se encoge ~3× |
| `tile-edges` | 1 | 2 | se encoge ~2× |

**12 de los 144 están en módulos de batería 1, donde `netTime` no baja y el presupuesto es el mismo
por construcción.** Los 3 observados de `arch-cierre` son de ésos. La muestra informativa real es
**1** (`blueprint-plan`), y los **132 que sí ven encogerse el presupuesto están sin observar**, con
la exposición concentrada en `blueprint-huella` (22 · ~6×) y `world-map` (14 · ~8×).

**Dirección del daño (y es la buena).** Verifiqué en `scripts/mutacion-huella.ts:731` que el bloque
del reloj **no se resta del veredicto**: `vivo → T` alimenta `resueltos` y `T → vivo` alimenta
`nuevos`, y las dos tumban la adopción. Y un `RuntimeError` saca al mutante de `medidosDeFichero`
(`:162`), encoge el `total` y deja el fichero **incomparable**, que es condición dura. Así que los
140 `Timeout` sin observar **solo pueden producir un NO falso, nunca un SÍ falso**.

**Qué pido que se haga con esto:** no arreglarlo — decirlo antes de gastar el runner. Si la corrida
vuelve con `resueltos > 0` concentrados en el bloque del reloj, eso **no** es «el runner mide otra
cosa»: es el presupuesto de `timeoutMS` reescalado, y el bloque aparte ya lo sabe nombrar. Leerlo
como un veredicto del runner costaría el cierre de #443 por segunda vez y por el motivo equivocado.

---

### H-3 · MENOR — el docblock del candado nuevo dice «en silencio», y la mitad de la cobertura es ruidosísima

`test/mutation-config.test.ts`, docblock de «`--test` está, y solo es admisible acompañado de
`--test-isolation=none`»:

> «Las dos cosas se apagan EN SILENCIO — la corrida sigue saliendo verde, midiendo menos y sin
> cortafuegos de memoria.»

**Medido, quitando `--test-isolation=none` de `node_args` y corriendo el módulo de verdad:**

```
$ npm run mutacion -- local contrato-sprite-forge      # con --test A SECAS
 sprite-forge.ts |   0.00 |    0.00 |   0 killed | 0 timeout | 0 survived | 63 no cov | 0 errors
ERROR MutationTestReportHelper Final mutation score 0.00 under breaking threshold 87, exit code 1
║ ✗   contrato-sprite-forge     63 mutantes ·   63 vivos · score   0.0% (break 87) · 2s
```

La cobertura no se apaga en silencio: se va al pid del hijo, el padre lee **cero**, los 63 mutantes
salen `NoCoverage` y el módulo cae a **0,00 % contra un suelo de 87**. Comprobé que **los 58 módulos
tienen `break` numérico ≥ 31** (ninguno `SIN_MEDIR`, ninguno ≤ 10), así que ese rojo es universal, no
una casualidad de este módulo. **La mitad silenciosa es solo el tope de heap** — que es real,
grave, y lo medí yo (criterio 7).

Por qué lo reporto siendo una frase: es una justificación escrita después y no medida, dentro del
docblock de un candado, en la PR cuyo tema es «candados que se cumplen sin haber mirado». Es
exactamente el patrón de `feedback_justificacion_no_verificada`. El candado es correcto; su razón
está a medias.

---

### H-4 · MENOR — el dry run no puede probar lo que se le atribuye

El informe concluye del dry run de los 58: «"Ran N tests" con N = tamaño de la batería […] **La
granularidad de `failedTests` no ha cambiado**». Leyendo `tap-test-runner.js`, `run()` empuja **un
`testResult` por FICHERO** del filtro, así que `N = |batería|` está garantizado estructuralmente
mientras los ficheros corran: el chequeo detecta un fichero caído o un bail, **no** un cambio de
granularidad del TAP.

La conclusión resulta ser **cierta** — la comprobé directamente sobre
`test/contract-sprite-forge.test.ts`: sin `--test` y con `--test --test-isolation=none` el TAP sale
igual (`ok 1 - …` / `1..1`) — pero la prueba que la sostiene no es la que se cita. Efecto colateral
bueno y no anotado: con `--test` desaparecen las líneas de ruido previas a la cabecera TAP que la
vuelta 1 listaba (`world-snapshot` pasa de 10 a 0), porque el reporter las recoge como diagnóstico.

---

### H-5 · MENOR (preexistente, no de esta rama) — la puerta general del score `NaN` sigue abierta, y me la encontré sola

Con un `mutate` que no selecciona ningún mutante, Stryker imprime `n/a`, `Ran NaN tests per mutant`,
deja informe vacío y **sale 0**:

```
All files |    n/a |     n/a |        0 |         0 |          0 |        0 |        0 |
INFO MutationTestExecutor Done in 2 seconds.
```

Me salió al acotar mal un rango de `blueprint-derive`, sin buscarlo. Es el hallazgo que el ingeniero
ya dejó reportado en la vuelta 1 («merece issue») y que la crítica asigna a **#596**; su puerta
concreta (`--test-reporter=tap`) sí está candada en esta rama. Lo dejo anotado porque sigue vivo y
porque es el mismo hueco por el que 26 muertes salieron del denominador sin que el suelo de 87 las
cazara (51/58 = 87,9 % ≥ 87).

---

## 3 · Lo que apreté a propósito, y qué contestó

**«El `NoCoverage = 1` ¿es un testigo de verdad o una coincidencia?»** Es un testigo de verdad, y
además **no está solo**: tres señales independientes dicen lo mismo en ese informe —`NoCoverage` = 1,
`Ran 0.98 tests per mutant` (sería 1.00 con la cobertura muerta) y `coveredBy` poblado en 62 de 63
(la base `command` trae `{0: 63}`, ninguno).

**«¿Qué pasaría si `perTest` se apagara? ¿Lo vería alguien, o solo ese 1?»** Contestado con
medidas, y las dos respuestas importan:

- Si se apaga **el ajuste** (`coverageAnalysis: "off"`): **no pasa nada, y nadie lo vería** — porque
  el ajuste es inerte (H-1). Es la vía silenciosa de verdad, y no la cubre ningún candado ejecutable.
- Si se apaga **la recogida** (la vía realista: la cobertura acaba en un pid que nadie lee): lo ve
  todo el mundo. Los mutantes salen `NoCoverage`, `NoCoverage` es VIVO para `esVivo`, el score cae a
  0,00 y el módulo rompe su suelo (H-3). Y si la cobertura mintiera *de menos* (un mutante cubierto
  reportado como no cubierto), el mutante saldría vivo y `comparar` lo vería como **nuevo**. Las
  tres formas de fallo apuntan al lado seguro: rechazan la adopción, no la regalan.

**«¿Medir un mutante acotado al rango es la misma medida que la corrida completa?»** Sí para el
estado, y lo probé en vez de razonarlo: en `blueprint-plan` medí el módulo entero (38) y luego
acotado a 2 mutantes, y salieron **idénticos en estado y en `coveredBy`**. El motivo es que acotar
`mutate` no toca el dry run —la batería es la misma— así que la cobertura y el `netTime` son los
mismos. **La única salvedad es la que dice H-2**: acotar mide con menos carga en la máquina, así que
es ciego a los estados que decide el reloj. Como ninguno de los 26 es un `Timeout` (los 26 mueren al
importar), la salvedad no los toca. **Método válido para este uso.**

**«El candado viejo del heap, ¿exige ahora que APLIQUE?»** Sí, y lo medí yo con mi propio fixture
(`--max-old-space-size=16` contra ~320 MB pedidos):

| flags | exit | qué demuestra |
|---|---|---|
| `-r hook --max-old-space-size=16 --import tsx --test-reporter=tap` | **134** «Reached heap limit» | el tope aplica |
| `… --test --test-reporter=tap` | **0** | el tope es un **no-op** — y peor, el test reporta `ok 1`: el mutante desbocado saldría **vivo** |
| `… --test --test-isolation=none --test-reporter=tap` | **134** | vuelve a aplicar |
| `… --test --test-isolation=process --test-reporter=tap` | **0** | el mismo agujero pedido en voz alta — y `correEnElMismoProceso` lo rechaza |
| `… --max-old-space-size=1024 --test --test-isolation=none …` | 0 (control) | el fixture no muere por su cuenta |

El aserto nuevo (`correEnElMismoProceso(plan.node_args)`) rechaza las dos filas malas. **Es un
modelo del comportamiento de Node, no una ejecución de Node** —la medida vive en el comentario— pero
se pone rojo en los cuatro casos que importan y eso lo comprobé uno a uno. Es una mejora real sobre
«la flag está escrita».

**«¿Hay otro verde que no pueda ponerse rojo?»** Sí: H-1. Es el más caro de los cuatro, porque está
en el instrumento con el que esta casa mide todo lo demás y porque su razón escrita es una medida
que nadie hizo.

---

## 4 · Workarounds usados durante la prueba

| Workaround | Por qué | ¿Afecta al usuario? |
|---|---|---|
| Aparté/restauré `data/contract/mutation-targets.json` y `stryker.config.json` para los seis negativos y para el A/B de `coverageAnalysis` | No hay forma de ejercer un candado sin romper su sujeto | **No.** Restaurado y verificado con `git status` limpio tras cada tanda |
| Escribí un arnés propio de rango acotado en el scratchpad (`acotado.mjs`) | El del ingeniero **no está en el árbol**: los 21 acotados no son reproducibles desde esta rama. Ver nota abajo | **No** para el jugador; **sí para quien repita la medida**: lo anoto |
| Instalé `narrative-mcp/node_modules` (`npm ci`) | Mi árbol venía sin ellas y `typecheck:tests`/`contract-fixtures.test.ts` fallaban por `Cannot find module '@nefan/core'` | **No.** Es un hueco del montaje de MI worktree: `main` y el árbol del ingeniero sí las tienen. Sin ellas `verify` da 2637/1; con ellas, **2722/0** |
| Fixture propio que pide ~320 MB, no ~3 GB | Misma demostración con 1/10 de la RAM: si el tope de 16 MB aplicara, 320 MB ya no caben | **No** |

**Nota sobre el arnés de los 21.** El informe dice «`mutate` acotado al rango de cada mutante»; ese
arnés no está commiteado y `permisoLocal` rechaza el camino obvio (`mutate.ts` mira el coste del
módulo entero en la huella). O sea: **la evidencia de 21 de los 26 no es reproducible desde la
rama**. No lo cuento como fallo —los reproduje yo por mi cuenta y salen— pero si esa medida hay que
repetirla (p. ej. si la corrida vuelve rara), hoy hay que reinventar el instrumento. Los dos arneses
que sí se conservan (`paso-b-tap.ts`, `paso-c-ab.ts`) no hacen esto.

---

## 5 · No probado, y por qué

- **Que ningún score se mueva en los 58 módulos.** Solo lo dice la corrida autorizada; es el paso 1
  de #443 por diseño y `requisitos.md` §2 dice explícitamente que no bloquea cerrar la tanda.
- **140 de los 144 `Timeout`** (H-2). `blueprint-derive`, `blueprint-huella`, `plugins-dsl`,
  `world-map` y `scene-validate` no caben en `tope_local` y **no subí el tope**.
- **La cobertura `perTest` con mutantes reales en los 53 módulos restantes.** La vi viva en
  `contrato-sprite-forge`, `arch-cierre`, `blueprint-plan` y los 4 acotados. En los otros, solo el
  dry run. Modo de fallo del lado seguro (§3).
- **`scene-validate`** (836 mutantes, el módulo que decide el reloj de la corrida): no cabe en local.
- **`npm run mutacion -- comparar`** de punta a punta: necesita `reports/mutation` de una corrida
  `tap` real, que es justo lo que no existe todavía.
- **`npm run verify` no corre Python ni `ruff`**, y la rama no toca Python.

**No hay guion en `qa/guiones/`, y es a propósito.** Esa carpeta es la batería de navegador; esta PR
no tiene una sola superficie observable por el jugador (el diff no toca `nefan-html/`, `src/`,
`bridge/` ni `services/`). Lo mecánico de aquí pertenece a `qa/mutacion-*-en-negativo.mjs`, que se
ejecutan en `candados-headless` y **son del ingeniero**, no míos. Dejo nombrados los dos invariantes
que hoy no tienen quien los cace, con el caso exacto que cada uno debe rechazar:

1. **«el filtrado por cobertura está VIVO, no solo declarado».** Caso a rechazar: un informe de
   módulo con `coveredBy` vacío en todos sus mutantes (o `Ran 1.00 tests per mutant` con batería > 1).
   Hoy nada lo mira: el único testigo es un `NoCoverage` suelto en un documento.
2. **«lo que `coverageAnalysis` significa depende del RUNNER, y la base lo sabe decir».** Caso a
   rechazar: una base con `testRunner: "tap"` y `coverageAnalysis: "off"` tratada como incapaz de
   expresar `NoCoverage` (H-1, último párrafo). El dato para distinguirlo (`config.testRunner`) ya
   viaja en cada informe y nadie lo lee.

---

## 6 · Veredicto

**APTO CON HALLAZGOS.**

Lo que se pidió está hecho y medido: los **26 mutantes vuelven a `Killed` — los 26, verificados por
mí**, 5 por el camino real de `npm run mutacion -- local` y 21 acotados a su rango, con **cero
`RuntimeError`**, **mismas huellas** y **un solo cambio de estado** en todo lo que comparé (el
`Survived → NoCoverage` documentado, que es el que `perTest` sabe separar y `command` no podía
expresar). El candado nuevo se ve rojo en las seis roturas que le probé y verde en el control; el
tope de heap pasa de estar escrito a **aplicar**, y eso lo medí con mi propio fixture. `verify`
2722/0, deuda sin items nuevos, `afectado` = `TODOS`, árbol limpio y `reports/mutation-base/`
intacto (59 ficheros).

Los tres hallazgos que cuentan **no tocan el mecanismo**: H-1 es una causalidad falsa escrita en tres
sitios alrededor de un ajuste que no hace nada; H-2 es una muestra que parece cuatro veces mayor de
lo que es, con un mecanismo concreto sin nombrar; H-3 y H-4 son justificaciones que van por delante
de lo medido. Ninguno cambia un solo estado de mutante y ninguno puede convertir un NO en un SÍ.

**La rama está lista para que se pida la corrida completa.** Con dos cosas dichas antes de gastarla:
que un `NO SE ADOPTA` por `resueltos`/`nuevos` concentrados en el bloque del reloj hay que leerlo
como el presupuesto de `timeoutMS` reescalado (H-2) y no como un veredicto contra el runner; y que
`coverageAnalysis` no es la palanca que la prosa dice que es (H-1), así que el ahorro que vuelva hay
que atribuírselo a `tap-runner`, no al ajuste.
