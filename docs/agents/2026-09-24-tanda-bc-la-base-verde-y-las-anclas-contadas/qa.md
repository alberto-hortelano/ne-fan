# QA — tanda BC (#722 #723 #717)

Verificado el 2026-09-24 sobre `/home/al/code/ne-fan-tanda-bc` (rama `feature/tanda-bc`, sin commitear), contra los criterios de `requisitos.md`. Cero créditos (el censo de gasto del banco dice «0 guion(es) tocaron alguna puerta»). Ningún proceso ajeno tocado. Todos los sabotajes en negativo restaurados byte a byte (`cmp` y `git status`).

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| **1 · #722** base roja (status ≠ `0`, `null` incluido) → `reparto` sale ≠0 ANTES del primer probe, nombra el checker, no imprime «SIN CANDADO» | ✅ cumple | `env -u NEFAN_PYTHON node qa/run.mjs --sin-navegador 162 164 202` → `3 en verde · 0 en rojo de 3`. El 202: «reparto completo con la base saboteada: exit 1», ✔ «LÍNEA BASE ROJA» con `cableado:1 · candados:null`, ✔ ningún «lo caza:» ni «SIN CANDADO», ✔ «Checkers rojos en la línea base : 2» + motivo, ✔ ficheros byte a byte. **Negativo (mío):** filtro de `baseRota` anulado (`filter(() => false)`) → el 202 se pone rojo en 3 asertos, y la cola de la salida enseña el falso de #722 reproducido («…`fusionar`, así que esa frase no la defiende nadie / Es NUEVO: o se le pone candado…»). `reparto` restaurado (`cmp` OK). `--solo-vigentes` intacto: 164 verde (cuatro arranques, limpio exit 0 + tres formas exit 1) |
| **2 · #723 menor** `aplicarPares(t, [])` lanza, con test; llamadores vivos verdes | ✅ cumple | `las-anclas-de-los-candados.test.ts` pasa (38 tests en los tres ficheros tocados). **Negativo:** `if (false)` en el throw → «✖ una lista de pares VACÍA es un error de la tabla…», `fail 1`. Restaurado. Llamadores vivos: 162/164/202 verdes y `npm test` 3497/3497 |
| **3 · #723 tablas** fuera; el texto de cierre es verdad | ✅ cumple | Comprobado contra `.github/workflows/ci.yml` del worktree: `:279` `reparto --solo-vigentes`, `:299` `mutacion-candados-en-negativo`, `:305` `mutacion-cableado-en-negativo`, `:317` `contrato-candados-en-negativo`, `:462` `node qa/run.mjs --sin-navegador`; el 148 declara `sinNavegador` (`148:71`). «Salen ≠0 con patrón obsoleto»: `candados:378-383` (`fallidos.push` → `exit(ok?0:1)`), `contrato:499`, `cableado:822` + `:865`. El pre-vuelo de anclas de `reparto` está fuera del `if (!soloVigentes)` (`:655` vs `:680`) |
| **4 · #717** una tabla la comen JS y bash con el mismo veredicto; rojo probado quitando el paso de common-dir en cada lado; un guion Python del banco arranca desde ESTE worktree sin `NEFAN_PYTHON`; `start.sh` fuera y nombrado | ✅ cumple | `python-interprete-paridad.test.ts`: 14 casos + sujeto, verde. **Negativos:** JS sin `venvDelPrincipal` → «✖ worktree sin .venv propio…» con `bash: …/principal/.venv/bin/python` vs `js: 'python3'`; bash con `if false; then` → el mismo caso rojo, `bash: 'python3'`. Ambos restaurados. **Este worktree** (sin `.venv`, common-dir `/home/al/code/ne-fan/.git`): `interpretePython(cwd)` → `/home/al/code/ne-fan/.venv/bin/python`; `bash ai_server/lint.sh --interprete` → el mismo. `NEFAN_PYTHON=python3` ahora se acepta en JS. Guion real: `env -u NEFAN_PYTHON node qa/el-ledger-de-gasto-no-lo-escribe-la-suite.mjs` → `VERDE — la suite no puede escribir en el ledger…`, EXIT 0. `start.sh` nombrado en `python.mjs` y en la cabecera del test |
| **5** cero créditos; guiones solo 202-205; `.mjs` nuevos pasan las reglas de AY | ✅ cumple | Solo nace el 202. `eslint -c nefan-core/eslint.qa.config.js --rule no-useless-assignment --rule preserve-caught-error` sobre 202, `python.mjs`, `anclas.mjs`, `reparto` → 1 error, `reparto:612 anclasRotas` (preexistente, hunk de AY). `npm run lint:qa` → 0 |

`npm test` en `nefan-core`: 3497/3497 (padrones de saltos, banco-ficheros, totalidad de headless incluidos).

## Pasada adversarial (las cuatro preguntas del coordinador)

1. **¿`reparto` fabrica «SIN CANDADO» por otra vía?** No encontré ninguna que dé un falso SIN CANDADO: `null` por señal o timeout en la base entra en `baseRota` (probado con SIGKILL); un checker que no arranca (`spawnSync` con `error`) da `status null` → base rota; un nombre de checker que no existe en `CHECKERS` revienta con `TypeError` (fail-loud). Lo que SÍ queda, en la dirección contraria: un checker verde en base que se coma su timeout DURANTE un probe da `null !== "x:0"` y se cuenta como **«lo caza»** (falso verde). Es coherente con el dominio (Stryker cuenta Timeout como muerto) y no es la forma de #722, pero un timeout de 900 s por carga de máquina se leería como candado. Anotado como menor.
2. **¿La paridad cubre el caso de ESTE worktree?** Sí: el test levanta repo+worktree real con `git worktree add`, y además lo medí en vivo desde este árbol (fila 4). Matiz: el lado JS resuelve `git` con el `PATH` del proceso, no con el env hermético del caso (`spawnSync("git")` en `venvDelPrincipal` no recibe `env`), así que «nada de la máquina decide el veredicto» es verdad para bash y no del todo para JS. Hoy no cambia ningún veredicto.
3. **¿Algún consumidor cambia de conducta?** Tres consumidores, los tres en nivel de módulo: `el-ledger` (CI `:326`), `el-npc-cruza` (CI `:260`) —ambos tras `setup-python` `:246`, así que `python3` existe— y `sprites-sin-servicio` (exento del job). Cambio real: sin `python3` en el PATH ahora lanzan al cargar con mensaje, antes reventaban con `ENOENT` al spawnear. Desde el worktree ya no necesitan `NEFAN_PYTHON`. Sin `git` en el PATH, JS lanza («no se pudo lanzar git…») donde bash degrada: divergencia deliberada, documentada y fuera de la tabla.
4. **¿El texto de cierre de #723 es verdad?** Sí, línea a línea (fila 3).

## Hallazgos

Ninguno bloqueante ni importante.

- **Menor · rastro en prosa.** `qa/README.md:984` sigue diciendo que `python.mjs` resuelve «`NEFAN_PYTHON` → `.venv` del árbol → `python3`» y recomienda `NEFAN_PYTHON=../ne-fan/.venv/bin/python` en un worktree pelado: es exactamente lo que #717 hace innecesario. Reproducir: leer la fila del guion `el-ledger`/`sprites-sin-servicio` en el README. Esperado: la regla con el paso del common-dir, sin la variable a mano.
- **Menor · sobreafirmación del test de paridad.** Cabecera de `python-interprete-paridad.test.ts`: «Nada de la máquina decide el veredicto». El lado JS lanza `git` con el `PATH` real del proceso (adversarial 2).
- **Menor · timeout mid-probe = «lo caza».** `reparto:715` `CHECKERS[n]() !== base[n]`: un `null` por timeout durante un probe cuenta como candado. Fuera del alcance de #722; cabe como nota en el issue de seguimiento si se quiere distinguir Timeout de Killed.
- **Menor · README del 164.** La fila del 164 (`qa/README.md:678`) declara «LO QUE NO MIRA: … que la línea base venga verde (issue propuesto…)»: ahora lo mira el 202, que no tiene fila (tampoco la tienen 190-201, así que no es una convención rota).

## Workarounds usados

Ninguno para observar la feature. Los cinco negativos (JS, bash, `anclas`, `reparto`) se hicieron con copia previa y restauración con `cmp`; durante el negativo de `reparto` aparecieron sucios `nefan-core/scripts/mutacion-repo.ts` y los dos guiones saboteados (es el propio `reparto`/202 mutando y restaurando), y al terminar `git status` volvió al diff de la tanda.

## No probado

- La corrida completa de `reparto` con la base VERDE (~12 min): el coordinador pidió no repetirla; me fío del EXIT 0 en 12 min 10 s del ingeniero. El 202 + los negativos cubren la rama nueva.
- `null` por TIMEOUT real de 900 s: se ejerce `null` por SIGKILL (misma firma).
- CI en el runner (verde local no es verde): la PR aún no existe.
- `sprites-sin-servicio.mjs` como consumidor: exento del job y necesita servicios; su cambio es solo el comentario.

## Veredicto

**Apto.** Los cuatro criterios en alcance se cumplen con evidencia propia y los candados nuevos se ponen rojos cuando se les quita lo que dicen vigilar. Los hallazgos son menores (dos rastros de prosa, una sobreafirmación de cabecera y una observación fuera de alcance) y pueden ir en la misma PR.
