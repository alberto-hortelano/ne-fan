# QA — tanda AN (#697): una suite que lanza pone rojo el runner

Rama `feature/tanda-an` (sha `0539a4d5` al empezar), worktree `/home/al/code/ne-fan-tanda-an`, Node v24.11.1.
Criterios: los del **reencuadre** de `requisitos.md` (prevalece sobre el issue) más el 4 original.
Todo lo mecánico está en `qa/guiones/165-una-suite-que-lanza-pone-rojo-cada-entrada-al-runner.mjs`
(headless, ~2,8 s, entra en `candados-headless` por `ci.yml:455`). Logs en el scratchpad de la sesión (`qa-an/`).

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| R1a `npm test`: una suite que falla → EXIT ≠ 0 | ✅ cumple | E2E con `ground_plan/valid/minimo.json` roto a mano: `npm test` **EXIT=1**, `ℹ tests 3252 · fail 0`, `✖ suite que falla: contrato — fixtures ground_plan … (contract-fixtures.test.ts)`. La línea de `main` (sin reporter) sobre el mismo árbol: **EXIT=0**, `tests 3252 · fail 0` — el agujero del issue, reproducido. Restaurado con `git checkout`, `git status` limpio |
| R1b `npm run coverage` (lo que corre el job `nefan-core`, `ci.yml:71`, cwd `nefan-core`) | ✅ cumple | Mismo sabotaje: `npm run coverage` **EXIT=1** con la suite nombrada. Limpio: EXIT 0, 3270/565, `lcov.info` 812 KB, 0 `MaxListenersExceededWarning`, `crap -- --check` ✔ (96,05 %) |
| R1c `corre()` de `qa/contrato-candados-en-negativo.mjs` | ✅ cumple | `node qa/contrato-candados-en-negativo.mjs "suite que lanza"` → los dos invariantes 🔴, EXIT 0. Completo: **32/32**, `NO se enteran: 0`, EXIT 0 |
| R1 «cualquier `describe`, lance como lance» | ✅ cumple | Guion 165, bloque 1: seis formas por la línea REAL de `scripts.test` — `throw` síncrono, `describe` **async** que rechaza, `throw` de un **string**, anidado dentro de uno verde, hook **`after`** que lanza (no está en el issue; también era verde nativo), `describe` sin `it` — las seis EXIT 1 y nombradas con reporter, EXIT 0 sin él; `--test-isolation=none` + reporter también 1. Controles: suite verde → 0 sin nombrar; `before` que lanza → ≠ 0 con y sin reporter |
| R2 negativo por HELPER (el que un censo por nombres no ve) | ✅ cumple | Invariante `suite que lanza · una fixture de contrato rota, leída solo por un helper…` (`loadFixtures` en `contract-fixtures.test.ts:128`): 🔴 con el arreglo. **NA** (`corre()` sin reporter) → 🟢 VERDE, `NO se enteran: 1`, arnés EXIT 1. **NB** (veredicto viejo `fallos > 0`) → igual. Discrimina |
| R2 negativo de contrato en el cuerpo (`generate_scene.json`) | ✅ cumple (no discrimina, y se dice) | 🔴 con el arreglo, y 🔴 también en NA y NB: lo leen tres `it`. Está por ser el ejemplo del issue; el comentario del arnés lo declara |
| Candados de las entradas de npm, probados en negativo | ✅ cumple | **N1** reporter fuera de `scripts.test` → test nuevo `fail 3` y guion 165 rojo (primer aserto + seis formas). **N2** `coverage` de vuelta a `spec` → `fail 1` y el 165 rojo en «coverage lleva el reporter». **N3** reporter sin `process.exitCode = 1` → `fail 2`; el 165 rojo en las seis formas con `nombrada true` (nombra, no pone rojo). Cada uno restaurado con `git checkout` |
| R3 recenso escrito; no tocar `el-cortafuegos…:288-296` ni `qa-lib-tiene-quien-lo-mire.test.ts:274` (#704) | ✅ cumple | `git diff --stat 83ea6046..HEAD`: ningún fichero de #704 (ni `banco-ficheros.ts`). El recenso está en `critica.md` |
| R4 `_lo_que_esto_NO_sujeta` solo si el mecanismo deja algo fuera | ✅ cumple, con reserva | No hay padrón nuevo, correcto: el mecanismo cubre todo `describe`. Lo que deja fuera son ENTRADAS al runner sin el reporter, y ahí el censo del ingeniero está incompleto (hallazgo 1). El guion 165 las padrona con totalidad |
| R5 (caer al candado por árbol) | — no aplica | R1 viable en las tres entradas, medido |
| `verify` verde, conteo no baja (3264/564) | ✅ cumple | `npm test` 46,7 s: **3270 tests · 565 suites · pass 3270 · fail 0**, 0 `suite que falla`. `typecheck:tests` 0, `lint` 0. Los 4 candados que barren el árbol (`un-numero-un-guion`, `un-salto-del-guion-se-observa`, `el-banco-declara-el-modo-de-gasto`, `candados-headless-totalidad`) 65/65 con el guion 165 ya en el árbol. `build`/`typecheck:scripts`/`typecheck:labs` no se corrieron aparte (no se toca `src/`, `scripts/` ni `labs/`) |
| Coste del bucle interno de `verify` | ✅ cumple | El test nuevo: 6 `it`, 5 subprocesos, **1,15-1,47 s** dentro de una suite de 46 s |
| CI corre de verdad esas líneas | ⚠️ no probado en CI | No hay PR ni rama remota (`gh pr list --head feature/tanda-an` vacío). Comprobado en local que `ci.yml:71` es `npm run coverage` con cwd `nefan-core` (defaults del job) y `:310` el arnés desde la raíz; el reporter se resuelve con `./` desde ese cwd. El guion 165 lee `ci.yml` y exige las dos líneas |
| Caso `NODE_TEST_CONTEXT` heredado | ✅ cumple | Medido: un hijo de `node --test` hereda `NODE_TEST_CONTEXT=child-v8`. Solo lo sufre el test nuevo (spawnea `node --test` desde dentro de otro), y lo borra del env; ningún `test/*.ts` lanza `npm test`, el arnés ni `run.mjs` (grep de `spawn*`/`execFile*`/`execSync`), y el arnés y `run.mjs` corren en CI como procesos raíz. El 165 también lo borra |

## Hallazgos

**Importante — H1. El censo de «otras entradas al runner» de `implementacion.md` omite la que CI corre en cada PR.** `nefan-html/package.json:10` es `node --import tsx --test test/*.test.ts` sin reporter, y el job `nefan-html` de `ci.yml` (~l. 141) corre `npm test` sobre un glob que hoy tiene dos suites con `describe` (`la-maquina-de-animacion-elige-el-clip.test.ts`, `el-arte-pendiente-lo-cuenta-su-dueno.test.ts`); el guion 148 lo relanza además desde `candados-headless`. Reproducido sin tocar el árbol: `cd nefan-html && node --import tsx --test <describe que lanza>` → `tests 0 · fail 0 · EXIT 0`. Está fuera del alcance de las tres entradas del reencuadre, así que no bloquea, pero el informe dice «censadas hoy por grep» y la lista tiene siete sitios, no cinco: faltan también `qa/guiones/151:179` y `152:199` (spawn de `node --test` sin reporter; deciden por los asertos del candado, no por el exit). El issue de backlog redactado debe incluirlos; el guion 165 los deja padronados como AGUJERO CONOCIDO y se pondrá rojo con «YA NO ES UN AGUJERO» cuando alguien los cierre (probado: G3).

**Menor — H2. Regresión de forma en la salida del reporter, no de fondo.** Cuando una suite falla por su cuerpo, `spec` ya imprime `✖ <suite>` con el error en «failing tests», y el reporter añade la línea `✖ suite que falla: …` DESPUÉS del resumen `ℹ …` — lee peor que un `fail 1` porque el contador sigue diciendo `fail 0` a dos líneas de un `✖`. Quien mire solo el resumen (como hacía el arnés) sigue viendo verde; el exit code es lo que manda y eso está bien. Cabría que el reporter también corrigiera el `ℹ fail` que imprime `spec`, pero es diseño, no fallo.

**Menor — H3. `qa/` no tiene lint.** `npx eslint` en `qa/` sale con error de configuración (sin `eslint.config`); ni el guion 165 ni el arnés modificado pasan por ningún linter. No es de esta tanda; se anota.

**Menor — H4. `nefan-core/test/fixtures/` nace con esta tanda** (dos `.ts` que no son test). `typecheck:tests` los tipa y ningún candado del árbol se queja, pero es un directorio nuevo bajo `test/` sin README; si otra tanda mete ahí fixtures de otro tipo, nadie ha dicho qué es.

## Guion dejado: `qa/guiones/165-una-suite-que-lanza-pone-rojo-cada-entrada-al-runner.mjs`

`sinMotor` + `sinNavegador`, fixtures en un `mkdtemp` del sistema (nunca en el árbol), 0 ficheros del repo tocados. Bloque 1: las seis formas mudas + dos controles por la línea real de `scripts.test`. Bloque 2: padrón de las 12 invocaciones de `--test` del árbol (3 con reporter, 7 agujeros conocidos, 2 predicados) con totalidad en las dos direcciones. **Probado en negativo**: N1, N2, N3 (arriba); **G3** reporter añadido a `qa/mutacion-candados-en-negativo.mjs` → «YA NO ES UN AGUJERO»; **G4** un `qa/lib/zz-*.mjs` con `spawnSync("node", [...,"--test",...])` → «sin clasificar» nombrándolo. Fila añadida en `qa/README.md`. Lo que no mira está en su cabecera (`coverage` por formas, la mutación en marcha, si CI corre cada script más allá de leerlo).

## Workarounds usados

- Borrar `NODE_TEST_CONTEXT` al lanzar `node --test` desde el guion 165 y desde mis sondas (`env -u`). Es el mismo que usa el test del ingeniero; no afecta al usuario (ninguna entrada de producción corre anidada, medido arriba).
- Sabotajes en el árbol del worktree (N1-N3, NA, NB, G3, G4, e2e), cada uno restaurado con `git checkout`/`rm` y `git status` comprobado al final: solo quedan `qa/README.md` y el guion 165, que son míos.

## No probado

- La corrida de CI (no hay PR). La línea es la misma; el `./` del reporter depende del cwd, que es el del job.
- `build`, `typecheck:scripts`, `typecheck:labs` (el `verify` entero): no se toca nada que alcancen.
- Mutación: no aplica (nada en `src/`), coincido con el ingeniero.

## Veredicto

**APTO.** El mecanismo hace lo que el reencuadre pide en las tres entradas, con negativos que discriminan (helper) y candados que se ponen rojos al romperlos. H1 es una omisión del censo declarado como fuera de alcance, no del arreglo: va al issue de backlog que el ingeniero ya redactó, con `nefan-html` y los guiones 151/152 añadidos, y queda padronado en el 165.
