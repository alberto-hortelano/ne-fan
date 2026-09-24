# QA — tanda AY: el lint del banco completo y el reloj muerto del 07 (#744 #745 #734)

Verificado el 2026-09-24 sobre el worktree `/home/al/code/ne-fan-tanda-ay` (rama `feature/tanda-ay`, diff sin commitear: 47 ficheros + 4 nuevos), con Node v26.10.0 y ESLint 10.6.0 de `nefan-core/node_modules`. Cero créditos: lo único que arrancó un stack fue el guion 07 con el preset `e2e-sin-creditos` (motor falso; el gasto sale en los contadores del fake, no en ninguna API).

No hay nada observable por el jugador: los tres issues son deuda del banco y del padrón. Por eso no hay guion de juego nuevo; lo mecánico ya lo cubren el 175/176 (ampliados) y el 186/187 (nuevos), y los he puesto en rojo a mano uno a uno (sección «Negativos»).

## Criterios (los del crítico, aceptados en `requisitos.md`)

| # | Criterio | Veredicto | Evidencia |
|---|----------|-----------|-----------|
| 1a | #734: el 07 sin `Date.now()`, los dos `push` guardan solo `body` | ✅ cumple | Diff `07:57,59`: `peticiones.push({ body: … })`. Ningún lector usa `.t` (`grep -nE "\.t\b"` en el 07 → solo comentarios) |
| 1b | Entrada del 07 fuera de `relojes-de-pared.json`; censo del test en «29 en 10» sin `"07"` | ✅ cumple | Diff del padrón (−5 líneas, la entrada entera). `node --import tsx --test test/el-reloj-de-pared-tiene-padron.test.ts` → `✔ el censo de hoy: 29 relojes en 10 guiones…`, 28/28 pass |
| 1c | Negativo: `Date.now()` de vuelta en el 07 pone `npm test` en rojo | ✅ cumple | N4: `fail 5`, con el mensaje `qa/guiones/07-npc-clave-del-skin.mjs: 1 relojes de pared contra 0 declarados (57:Date.now)` |
| 1d | El 07 sigue verde en el flujo real | ✅ cumple | `node qa/run.mjs 07` (preset `e2e-sin-creditos`, bloque de puertos propio): 26 asertos ✔, `gasto {"/generate_scene":9,"/generate_surface_atlas":1,"/skin_sprite_sheet":6}` contra el fake, rc=0 |
| 2a | #744: `npm run lint` (→ `verify` y CI) lintea los 14 `.js/.mjs` de `labs/` con `no-unused-vars` y `^_` | ✅ cumple | `package.json:31` `lint = eslint … && npm run lint:qa && npm run lint:labs`; `verify` (`:54`) corre `npm run lint`; `ci.yml:53,114,136` `npm run lint`. `npm run lint:labs` rc=0 en 0,45 s. Censo: `git ls-files labs` = 14, `find labs` (sin `node_modules`) = 14, los mismos 14; ningún `runs/` commiteado con JS; ningún `node_modules` bajo `labs/` |
| 2b | Los 3 hallazgos de `escena.js` clasificados y resueltos sin cambio de conducta | ✅ cumple | `texStone()` única llamada `:606` sin argumento y el cuerpo con el color escrito a mano; `boat()` tres llamadas `:760-762`, ninguna pasa `name`; `cm` solo tenía efecto. Diff de 6 líneas |
| 2c | Siembra: un import muerto en `labs/` pone el lint en ROJO nombrando fichero y regla | ✅ cumple | N3 (repetido bien, ver Workarounds): `npm run lint` entero → `labs/fps/lib.mjs 1:26 error 'muerto193' is defined but never used … no-unused-vars`, rc=1. Guion 186 (a, a-js) verde |
| 2d | Censo en el árbol real: lintados == `.js/.mjs` de `labs/` (análogo del 176 A) | ✅ cumple | Guion 187: `labs/: 14 .js/.mjs/.cjs · lintados: 14`, regla efectiva en las 7 carpetas, sale 0 |
| 2e | El 176 A y el test de paridad de ignores siguen midiendo SOLO `qa/` | ✅ cumple | `eslint.qa.config.js` no cambia ni `files` ni `ignores` (solo reglas y cabecera). 176 A: `banco: 244 .mjs · lintados: 244`. `el-lint-del-banco-salta-lo-que-el-banco-salta.test.ts` 2/2 pass |
| 3a | #745: `no-useless-assignment` y `preserve-caught-error` en `error` sobre `qa/**/*.mjs`, 0 hallazgos en HEAD | ✅ cumple | Config `:39-40`. `npm run lint:qa` rc=0 en 2,1 s. 176 D comprueba las tres reglas en la config EFECTIVA de `qa`, `qa/guiones`, `qa/lib` |
| 3b | Los 3 `throw` con `{ cause }` y correctos | ✅ cumple | `carga.mjs:168` `{ cause: e }` (el binding es `e`), `stack.mjs:41` y `run.mjs:1296` `{ cause: err }`: los tres usan el binding de SU `catch`, dentro del `new Error(msg, opts)` correcto |
| 3c | Siembra por regla en el guion de lint del banco: roja + control a 0 | ✅ cumple | 175 (f) `let x = null` → rojo `no-useless-assignment`; control `let x;` → 0. 175 (g) `throw` sin causa → rojo `preserve-caught-error`; control con `{ cause: err }` → 0. Y en el árbol real: N1 (`179:156:9 no-useless-assignment`, rc=1), N2 (`stack.mjs:41:5 preserve-caught-error`, rc=1) |
| 3d | Los 43 `let x = … → let x;` no cambian conducta | ✅ cumple | Revisados los 43 (sección siguiente). Ninguna inicialización tenía efecto secundario (literales o un identificador), y en todos la lectura posterior está detrás de una escritura incondicional |
| 3e | El U+200B de `dos-corridas.mjs:10` no se toca | ✅ cumple | `sed -n 10p qa/dos-corridas.mjs \| grep -cP '\x{200B}'` → 1; el fichero no está en el diff |
| 4 | Rastros al día: 175 «LO QUE NO MIDE», cabecera de la config, `porque` del 07, READMEs | ✅ cumple | Diff de 175, 176, `eslint.qa.config.js`, `qa/README.md`, `labs/README.md`. Barrido de prosa vieja (`UNA regla`, `no los mira ningún eslint`, `14 ficheros`, `sin ningún lint`) fuera de `docs/agents/`: 0 ocupantes |
| 5 | Guiones nuevos solo en 186-189, `sinMotor`/`sinNavegador`, cero créditos | ✅ cumple | 186 y 187, ambos con las dos declaraciones; `node qa/run.mjs --sin-navegador 175 176 186 187` → `4 en verde · 0 en rojo`, «0 guiones tocaron alguna puerta». CI corre la clase headless entera (`ci.yml:462`), así que entran solos |
| — | `npm test` completo | ✅ cumple | `tests 3479 · pass 3479 · fail 0` |

## Pasada adversarial (lo que pidió el coordinador)

### ¿Algún `let x = …` → `let x;` cambió la conducta? — No. Los 43, por familia

La regla es conservadora justo donde hacía falta: en `no-useless-assignment.js:233` ESLint **salta las asignaciones que están DENTRO de un `try`** (nunca las reporta), y lo que se retiró es siempre la inicialización de FUERA. Así que un caso solo se marca si TODO camino desde la declaración hasta una lectura pasa por una escritura. Lo comprobé a mano en los que no son la forma trivial:

- **36 de la forma `let x = v; try { x = JSON.parse(…) } catch { x = w }`** (guiones 110, 114, 115, 121, 123, 149, 155, 156×2, 160, 166, 172, 179, 180×2, 181, 53, 59, 60×2, 70, 74, 85, 88×2, 89, `el-state-api-no-muta-sin-partida`, …): el `catch` reasigna o hace `return`/`route.continue(); return`. Ninguna lectura alcanza el valor inicial.
- **Los 6 `try { x = await … } finally { … }` (56 `muro`, 71 `llego`, 58 `propuesta`, 168 `roto`/`msRoto`, 170 `a`/`msA`, 174 `fin`)**: leí los seis `finally` (`chmodSync`, `keyboard.up`, `conducta(ctx, inicial)`) y ninguno lee la variable; si el `try` lanza, la excepción sube y las lecturas de después no se ejecutan. Correcto.
- **`qa/run.mjs:1452-1454` (dentro del bucle de guiones, `exento`/`sinPagina`/`entornoDelGuion`)**: el `catch` termina en `continue` (`:1494`), así que nada lee tras un fallo; en la iteración siguiente `let` vuelve a declarar. Correcto.
- **`qa/mutacion-reparto-en-lotes.mjs:612` (`anclasRotas`, el único a nivel de MÓDULO, y se imprime)**: la única escritura es `:664 anclasRotas = sueltas.length`, fuera de todo `if`, antes de los lectores `:723,731,742`. Correcto.
- **`qa/guiones/91:167` (`arranco`, cerca de un callback)**: la escritura `:180` va DESPUÉS del `await ctx.absorbe(…)` y antes de la lectura `:198`; no está en el closure. Correcto.
- **`qa/comparar-el-criterio-en-negativo.mjs:56` (`detalle` por desestructuración)**: `({ ok, detalle } = fn())` asigna `undefined` si `fn()` no trae `detalle`, con o sin el `""` inicial: idéntico. Correcto.
- **`qa/parar-clasifica-los-nueve-puertos.mjs:457` (`code = 2`)**: el `try` asigna `code` y el `catch` pone `code = 1`. Correcto.

Sonda P2 (stdin, sin tocar el árbol): la regla sí marca `let x = 0` cuando un closure la escribe y la lectura viene tras otra escritura; no hay ningún caso de los 43 con esa forma, y los leí todos.

### ¿Los `{ cause }` son correctos? — Sí

Los tres pasan el binding de su propio `catch` como segundo argumento de `new Error`. En `carga.mjs` el binding es `e` y el `cause` es `e`; en los otros dos `err`/`err`. El texto del error conserva `e.message`/`err.message` donde ya lo llevaba.

### ¿El lint de `labs/` puede ponerse rojo de verdad en `verify`? — Sí

`verify` = `… && npm run lint && npm test`, y `lint` encadena con `&&`. N3 con el árbol real: un import muerto en `labs/fps/lib.mjs` hace que **`npm run lint` entero** salga rc=1 nombrando `labs/fps/lib.mjs 1:26 … no-unused-vars`. La cadena propaga el rc. Además el 187 canda que no linte cero (14 = 14) y el 186 (e) que `lint` siga encadenando `lint:labs` (N7: quitar el `&& npm run lint:labs` → 186 rojo).

### ¿Cambió el censo de relojes, y está bien? — 31→29, 11→10, y sí

Los dos relojes eran los dos `Date.now()` del 07 (`:57` y `:59`), y solo ésos: el diff del padrón quita una entrada con `relojes: 2`, la lista del test pierde solo `"07"`, y N4 demuestra que el detector sigue viendo el 07 (con uno de vuelta: `1 contra 0 declarados (57:Date.now)`). El `_lo_que_esto_NO_sujeta` del padrón habla de `qa/lib` y de la raíz de `qa/`, que no se tocan.

### Otros ángulos que probé

- **La config hermana estrechada** (`files: labs/fps/**`): 186 (a-js) y 187 (B) rojos (N5). El 187 A queda verde ahí, como dice el ingeniero: ESLint procesa `.js/.mjs/.cjs` por defecto con cero reglas, por eso el B mide la config EFECTIVA por carpeta. Es la lección del 176 D aplicada; correcto.
- **Sin el ignore de `runs/`**: 186 (c) rojo (N6).
- **Config del banco sin las dos reglas**: 175 (f, g) y 176 (D) rojos (N8).
- **`escenografia/runs/` está commiteado a propósito** (`labs/README.md`) y `eslint.labs.config.js` ignora `labs/**/runs/`: hoy no hay JS ahí (0), y si algún día lo hubiera el 187 A saldría rojo con «sin lint: …», que es lo que toca.
- **Tras cada negativo, el árbol volvió al byte** (`md5sum -c` de los 7 ficheros tocados: OK), y `git status` solo lista lo del ingeniero.

## Hallazgos

### Menor — `preserve-caught-error` como está encendida NO ve el `catch` SIN binding que lanza

Sonda P1 (por `--stdin`, sin tocar el árbol): `try { … } catch { throw new Error("…"); }` sale **0** con la config de la tanda. La causa se pierde exactamente igual que en los 3 que se arreglaron, que es la justificación literal de #745 («un `throw` dentro de un `catch` sin `cause` pierde la causa del rojo»). La regla tiene opción para eso (`requireCatchParameter`, `preserve-caught-error.js:154,176`; por defecto `false`). Con ella encendida sobre `qa/` y `labs/` hay **1 ocupante hoy**: `qa/lib/url-del-bench.mjs:25` (`new URL(raw)` que lanza y se relanza sin causa; el mensaje lleva `raw`, así que el daño es pequeño).

- Cómo reproducir: `printf 'export function g(s){ try { return JSON.parse(s); } catch { throw new Error("x"); } }\n' | nefan-core/node_modules/.bin/eslint -c nefan-core/eslint.qa.config.js --stdin --stdin-filename qa/x.mjs` → rc=0.
- Qué esperaba: o la opción encendida (y el ocupante arreglado), o el límite DECLARADO en la cabecera de `eslint.qa.config.js` y en el «LO QUE NO MIDE» del 175, que hoy dicen «un `throw` dentro de un `catch` sin `{ cause }`» sin matizar. La siembra (g) del 175 usa un `catch (err)`, así que tampoco lo mide.
- No es bloqueante: el issue pedía encender la regla con sus hallazgos clasificados, y eso está hecho.

### Menor — la cabecera de `eslint.qa.config.js` fija «43» como cifra

Dice «salieron 43, TODOS el valor inicial de un `let x = null`»: es la cifra de este HEAD, y varios no eran `null` (`""`, `{}`, `2`, `false`, `ENTORNO_DEL_BANCO`). Es prosa que envejece; la deuda de verdad la miden 175/176. Solo lo apunto.

## Workarounds usados

- **N3 lo sembré mal la primera vez** (`readFileSync as __muerto`): salió VERDE porque `__` casa con la exención `^_`. No es un fallo del lint sino de mi siembra; repetido con `muerto193` → rojo. Lo dejo escrito porque es la trampa exacta en la que caería alguien probando el candado a mano.
- **Hojas de sprites** en `nefan-html/public/sprites` (gitignored, copiadas por el ingeniero desde el checkout principal) para que el runner acepte el 07. Es una precondición conocida del banco (arte pagado fuera del repo), no de esta tanda.
- Ningún overlay ocultado, ningún estado forzado: no hay UI en juego.

## No probado

- **CI real**: sin commit ni PR, el hook `ci-verde` no aplica y no hay run del runner. Lo que sí está medido es que `lint`, `verify` y los tres jobs de `ci.yml` corren `npm run lint`, y que la clase headless de `ci.yml:462` recoge 186/187.
- **`recommended` completo en `labs/`**: el crítico midió 0 hallazgos extra; no lo he vuelto a medir porque no es criterio.

## Veredicto

**Apto.** Los tres issues quedan cerrados como se pidió, cada candado se pone rojo por la causa real, y ninguno de los 46 arreglos mecánicos cambia conducta. Los dos hallazgos son menores y de prosa/cobertura de la regla; el ingeniero decide si enciende `requireCatchParameter` (1 ocupante) o declara el límite.
