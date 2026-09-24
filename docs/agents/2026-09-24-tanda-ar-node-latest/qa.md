# QA — tanda AR: Node a la última, sin fijar versión, y fuera el reporter de #697

Petición literal: «Sube node a latest, mientras estemos en desarrollo no fijamos version.»

Probado en el worktree `/home/al/code/ne-fan-tanda-ar` (rama `feature/tanda-ar`, sin commitear), con
`source ~/.nvm/nvm.sh && nvm use node` → **v26.10.0 / npm 11.19.1**, y los negativos con
`nvm use 24.14.1`. Cero créditos: nada de esta tanda abre partida ni habla con un motor. No se mató
ningún proceso: la batería headless de otro worktree (`ne-fan-tanda-au`, pid 211985) tenía el turno
de candados y se esperó a que acabara.

## Criterios → evidencia

| Criterio | Veredicto | Evidencia |
|---|---|---|
| 1a. CI corre con la ÚLTIMA versión de Node, sin número | ✅ cumple | `grep -n node-version .github/workflows/*.yml`: 7 sitios, los 7 `latest` (ci.yml ×4, mutation.yml ×3); ningún `node-version: 2x` queda. README de `actions/setup-node` (main, v7.0.0 es el último tag), líneas 150-154: «Latest release: `*` or `latest`/`current`/`node`» y «`current`/`latest`/`node` always resolve to the latest dist version» (a diferencia de `*`, que depende de `check-latest` y la caché del runner). Hoy `nodejs.org/dist/index.json[0]` = `v26.10.0` (2026-09-21), la misma que corre en local |
| 1b. …y se MIDE en el log del runner la versión que resolvió | ⚠️ no probado | No hay PR ni corrida de CI sobre este árbol. Lo tiene que leer el coordinador en el paso «Setup Node» del primer job de la PR |
| 2. `engines`: nada de fijar versión; a lo sumo un suelo justificado y medido | ✅ cumple (con una reserva menor) | `nefan-core/package.json` → `">=24.15"`. Es suelo, no versión fijada, y casa con «no fijamos versión»: CI y local van a la última, el suelo solo dice desde dónde vale el candado de #697. El motivo es real y lo he medido yo, no copiado: `node --test` sobre un `describe` cuyo cuerpo lanza sale **EXIT 0 en v24.14.1** y **EXIT 1 en v26.10.0** (fixture de dos líneas en el scratchpad). **Reserva**: el número `24.15` no lo mide ninguna herramienta (ver H-2); `nefan-html`, `narrative-mcp` y `qa` no declaran `engines` (ya antes tampoco) |
| 3a. Fuera el reporter y todo lo que existía solo por Node < 24.15 (`grep` a cero) | ✅ cumple | `grep -rn 'la-suite-que-falla-pone-rojo\|PREFIJO_SUITE_ROTA\|suite que falla:\|test-reporter=\./'` fuera de `docs/agents/` y `node_modules`: **0 líneas**. `test/la-suite-que-falla-pone-rojo.ts` borrado (staged). `scripts.test` sin reporter; `scripts.coverage` con `--test-reporter=spec`. El `skip`/`diagnostic` por versión del unitario y la «mitad 2» del guion 165 no existen. Los comentarios que decían «v24.11.1… `npm test` queda VERDE» (dos tests de esperas, arnés de contrato, fixture `describe-que-pasa`) dicen hoy lo que pasa hoy |
| 3b. El fallo de fondo sigue candado por el propio Node: `npm test`, `coverage` y el arnés ponen rojo una suite cuyo `describe` lanza | ✅ cumple | Unitario `una-suite-que-falla-pone-rojo.test.ts` con Node 26: 4/4 ✔ (`npm test` y `coverage` sobre la fixture que lanza → EXIT ≠ 0 y `✖ un describe cuyo cuerpo lanza`; la misma forma sin throw → EXIT 0 y sin `DeprecationWarning|ExperimentalWarning|MaxListeners`). Guion 165 con Node 26: `node qa/run.mjs --sin-navegador 165-una` → ✔, seis formas «EXIT 1 (ℹ fail 0)» y los dos controles. Arnés: `node qa/contrato-candados-en-negativo.mjs "suite que lanza"` con Node 26 → «Candados probados en negativo: 2 · Nacen rojos al romperlos: 2 · NO se enteran: 0», EXIT 0, árbol limpio después |
| 3c. Los negativos SIGUEN pudiendo ponerse rojos sin el reporter (pasada adversarial) | ✅ cumple | **Por versión** (`nvm use 24.14.1`): unitario → `✖ npm test: un describe cuyo cuerpo lanza…` y `✖ npm run coverage: …`, `ℹ fail 2`, los dos «pasa» verdes; guion 165 → ✘ en las seis formas «Node v24.14.1 · EXIT 0 · fail 0», ✔ los dos controles; arnés → «🟢 VERDE suite que lanza · una fixture de contrato rota… ROMPERLO NO CAMBIA NADA» + «✖ hay candados que no comprueban nada», EXIT 1. **Por sabotaje de la línea con Node 26**: `scripts.test` + `" \|\| true"` → el unitario da `✖ npm test: un describe cuyo cuerpo lanza sale ≠ 0 y se nombra`, `ℹ fail 1`, y solo ése (el de `coverage` sigue verde porque es otra línea). `package.json` restaurado por copia, md5 `b9e78924` antes y después |
| 3d. Si un negativo deja de tener sentido, se borra y se dice qué cobertura se pierde | ✅ cumple | La «mitad 2» del 165 (padrón de 13 entradas al runner: con reporter / agujero) se borró; `implementacion.md` declara lo perdido (el censo de invocaciones de `--test`) y la fila del README lo deja en «LO QUE NO MIRA». Lo que ese padrón protegía, quién decide por el resumen y no por `status`, sigue sin candado: ver H-1 |
| 4. Otros sitios que existían solo por un Node viejo; lo que Node 26 rompa se arregla aquí | ✅ cumple (con dos restos menores) | `tsx` 4.21 → 4.23.15 en `nefan-core` y `nefan-html` (`npm ls tsx` → 4.23.15 / esbuild 0.28.2, sin `invalid`). `npm run verify` con Node 26: **DEP0205: 0, DeprecationWarning: 0, ExperimentalWarning: 0** en todo el log (el ingeniero midió 177 antes). `nefan-html`: `npm test` → 41/41, EXIT 0, sin avisos. Restos: el lock de `nefan-core` conserva `>=24` en el paquete raíz (H-3) y `tsconfig.tests.json` sigue diciendo «unificarlo cuando Node 24 sea el suelo declarado» (H-4) |
| 5a. `npm run verify` verde en local con Node 26 | ✅ cumple | `npm run verify` en `nefan-core`, Node v26.10.0: **EXIT 0, 1m04s, `ℹ tests 3407 · pass 3407 · fail 0 · skipped 0`** (antes de la tanda había 1 skipped: la rama por versión) |
| 5b. Los 12 guiones headless de CI (`node qa/run.mjs --sin-navegador`) con Node 26 | ✅ cumple | Ver «Batería headless» abajo |
| 5c. CI verde en la PR | ⚠️ no probado | Sin PR. Verde local NO es verde (CLAUDE.md): el runner además resolverá `latest` por su cuenta |

### Batería headless

`node qa/run.mjs --sin-navegador` con Node v26.10.0 (tras esperar al turno de candados de `ne-fan-tanda-au`): **12 en verde · 0 en rojo de 12**, EXIT 0, 1m32s; el 165 entre ellos (146, 148, 151, 152, 158, 159, 162, 163, 164, 165 y los dos de menor número). Árbol limpio al terminar: `git status` solo con los 14 ficheros de la tanda y `docs/agents/`.

## Hallazgos

**H-1 (importante, fuera del alcance de la tanda pero destapado por ella) — el hueco `ℹ fail 0` es real y tiene lectores.** Medido con un fichero de dos líneas: en Node 26, un `describe` cuyo cuerpo lanza imprime `✖ cuerpo que lanza`, `ℹ tests 0`, `ℹ fail 0` y sale con **EXIT 1**; en 24.14.1, lo mismo con EXIT 0. O sea que Node lo arregló en el código de salida y NO en el resumen. Quién lee el resumen hoy (`grep 'ℹ (fail|tests)'` sobre `qa/`):
- `qa/mutacion-candados-en-negativo.mjs:326` — `corre()` devuelve `fallos` (de `ℹ fail N`) y `rotos`, y **no devuelve `status`**. Un candado de esa batería cuyo `describe` reviente al romper una fuente saldría «ROMPERLO NO CAMBIA NADA» o, peor, la base pasaría por sana. Es exactamente la forma que el arnés de contrato tenía antes de #697.
- Guiones 148, 151, 152 y 163 — leen `ℹ tests N` como `total`. Deciden por «rojo EXACTAMENTE el aserto nombrado», así que una suite que desaparece entera se vería como `total` distinto solo si alguien lo compara; no lo he medido.
- El tap-runner de Stryker **no** está ciego: con `--test --test-isolation=none --test-reporter=tap` la suite que lanza emite `not ok 1 - cuerpo que lanza` tanto en 24.14.1 (EXIT 0) como en 26 (EXIT 1), y `tap-parser` decide por las líneas `ok`/`not ok`. Queda como observación, no como hallazgo.

Antes, este agujero estaba ESCRITO en el padrón de la mitad 2 del 165 (8 «agujeros conocidos» con su fila, y rojo si uno se cerraba sin subirlo). Hoy vive solo en prosa (`implementacion.md`, cabecera del 165, fila del README). Reproducción: `printf 'import {describe,it} from "node:test";\ndescribe("x",()=>{JSON.parse("{roto");it("y",()=>{});});\n' > lanza.mjs && node --test lanza.mjs; echo $?`. Lo que esperaba el usuario: que retirar el reporter no dejara ningún consumidor del runner peor que antes; el arnés de mutación está igual de ciego que estaba, pero ahora sin fila que lo recuerde. Candidato a issue.

**H-2 (menor) — el número `24.15` de `engines` no lo mide nada.** `engine-strict` no está puesto (sin `.npmrc`), así que npm solo avisa. El «candado del suelo» es que el unitario y el 165 salen rojos con un Node < 24.15 en el PATH, y eso es verdad (probado arriba). Pero con CI en `latest` nadie corre jamás un Node viejo, así que bajar `engines` a `>=24` (o quitarlo) queda verde en todas partes: ningún test lee `engines`. Es aceptable en desarrollo (es lo que pidió el usuario), pero el comentario de `ci.yml` («lo canda `test/una-suite-que-falla-pone-rojo.test.ts`, que sale rojo en un Node más viejo») promete un candado del SUELO y lo que hay es un candado del MECANISMO que solo dispara si alguien trae un Node viejo por su cuenta.

**H-3 (menor) — el lock de `nefan-core` conserva el suelo viejo.** `nefan-core/package-lock.json` `packages[""].engines.node` = `">=24"` mientras `package.json` dice `>=24.15`. `npm ci` no lo toca (por eso el ingeniero no lo vio), pero `npm install --package-lock-only` en una copia lo reescribe a `>=24.15`: es un diff de una línea que aparecerá en la siguiente PR de quien haga `npm install`. Es un rastro de `>=24` que el `grep` del criterio 3 no buscaba.

**H-4 (menor, preexistente) — `nefan-core/tsconfig.tests.json:10`** sigue diciendo «unificarlo cuando Node 24 sea el suelo declarado va al backlog», y Node 24 ya era el suelo antes de la tanda y lo es más ahora. Cae dentro de «otros sitios que existían por un Node viejo» (criterio 4) aunque nadie lo pidió explícitamente.

**H-5 (menor) — el guion 165 conserva un nombre que ya no describe lo que hace** (`…cada-entrada-al-runner`: ya no censa entradas). El ingeniero lo declara; lo anoto porque `qa/README.md` es lo que alguien lee para elegir un guion.

**H-6 (observación, no es del código) — el shell de los agentes arranca con Node 24.11.1 en el PATH** aunque `nvm alias default` sea `node` (→ 26.10.0). Es herencia del entorno del proceso padre, no del repo: cualquier hook o agente que corra `npm test` sin `nvm use` lo hará con un Node **por debajo del suelo** y verá el rojo del unitario. Los hooks de `.claude/hooks/` no corren node (solo `gh`), así que hoy no muerde.

## Workarounds usados

- **`nvm use node`** antes de cada comando: el shell heredaba 24.11.1. Afecta solo al entorno de los agentes (H-6), no al jugador ni a CI.
- **Esperar al turno de candados** de otro worktree (pid 211985) antes de correr la batería headless: la regla del turno es del banco y es correcta; no es un obstáculo del usuario.
- **Sabotaje de `scripts.test` con `|| true`** para el negativo bajo Node 26, restaurado por copia (md5 igual antes y después). No es un paso de receta, es la prueba de que el aserto puede ponerse rojo sin cambiar de Node.
- `npm install --package-lock-only` para H-3 se hizo en una **copia** en el scratchpad, nunca en el árbol.

## No probado

- La versión que `setup-node` resuelve en el runner (criterio 1b) y CI verde (5c): no hay PR.
- Si `npm ci` en el runner, con npm 11 y los postinstall bloqueados por defecto, deja esbuild/tsx operativos igual que en local. En local sí (`npm ls` limpio, `verify` verde).
- La corrida de mutación bajo Node 26 (`mutation.yml`): solo la medida en pequeño del tap-runner (`not ok` en las dos versiones).
- El gasto de créditos: no aplica, nada de la tanda toca un servicio.

## Veredicto

**Apto con reservas.** Lo pedido está: CI a `latest` sin número (alias verificado en el README de `setup-node`), `engines` como suelo y no como versión, el reporter fuera con `grep` a cero, y el candado de #697 sigue en pie por el propio Node y sigue pudiéndose poner rojo (por versión y por sabotaje). `verify` y la batería headless verdes con Node 26 y cero avisos. Las reservas son H-1 (el agujero del resumen pasa de tener padrón a tener prosa; `mutacion-candados-en-negativo.mjs` decide por `ℹ fail` sin `status`) y H-3 (el lock aún dice `>=24`); ninguna bloquea la fusión, pero H-1 merece issue y H-3 son diez segundos de `npm install --package-lock-only`.

## Vuelta 2 — H-1…H-4, el guion 164 y el padrón nuevo

Mismo worktree, Node v26.10.0 (`nvm use node`). Cada sabotaje se hizo uno por vez, restaurado por
copia y comprobado con `git diff --stat` / `diff` a cero contra la versión del ingeniero; el árbol
queda con los 22 ficheros de la tanda más `quien-lee-el-resumen-del-runner.test.ts` y `docs/agents/`.

| Qué | Veredicto | Evidencia |
|---|---|---|
| H-1 · `qa/mutacion-candados-en-negativo.mjs` decide también por `status` | ✅ cerrado | Diff: `corre()` devuelve `status`; base sana = `fallos === 0 && status === 0`; rojo = `fallos > 0 \|\| status !== 0`. **Negativo**: un `describe` que lanza añadido al final de `test/mutacion-huella.test.ts` → «Base (nada roto): 0 fallo(s), EXIT 1 ✖ — la batería YA está roja», EXIT 1 (antes de la vuelta esa base pasaba por sana). Restaurado, y la corrida limpia → «Base: verde ✔ … NO se enteran: 0 … ✔ todos los candados comprueban lo que dicen», EXIT 0 |
| H-1 · guiones 148, 151, 152, 163 | ✅ cerrado | Los cuatro llevan `if (r.status !== 0 && rojos.length === 0) rojos.push("EXIT n sin ningún aserto rojo nombrado (¿un describe que lanza?)")`. **Negativo** (151): un `describe` que lanza añadido a `test/un-numero-un-guion.test.ts` → `✘ el candado viene VERDE de partida… — ya está rojo: EXIT 1 sin ningún aserto rojo nombrado (¿un describe que lanza?)`, EXIT 1. Restaurado |
| H-1 · padrón `test/quien-lee-el-resumen-del-runner.test.ts` | ✅ cumple, probado en negativo | Positivo: 4/4 ✔. **(c)** `qa/lib/zz-lector-qa.mjs` con `/^ℹ fail (\d+)$/` → `✖ todo lector del resumen está en el padrón` nombrando `qa/lib/zz-lector-qa.mjs:1`, solo ése. **(b)** el 151 con el trozo del EXIT sustituido por `if (false)` → `✖ cada lector contiene el trozo…: falta «if (r.status !== 0 && rojos.length === 0) rojos.push(»`, solo ése. Su lectura de `scripts/` está declarada en `recorridos-de-test.json` (el barrido único la exigía). **Agujero declarado y medido**: un lector escrito `/^ℹ fail \d+$/` (sin paréntesis de captura) es INVISIBLE al censo (4/4 verdes con él en `qa/lib/`): `LEE_EL_RESUMEN` exige `ℹ fail (`; la cabecera lo dice («censo por GRAFÍA»), así que es reserva, no hallazgo |
| H-2 · comentario de `ci.yml` | ✅ cerrado | Ya no promete un candado del suelo: «Es documentación, no un candado: npm solo avisa y aquí nunca corre un Node viejo. Lo que sí se pone rojo en un Node < 24.15 es el MECANISMO… y solo en la máquina de quien lo traiga». Es exactamente lo medido en la vuelta 1 |
| H-3 · lock con `>=24` | ✅ cerrado | `nefan-core/package-lock.json` `packages[""].engines.node` = `">=24.15"`. `nefan-html` no declara `engines` ni en `package.json` ni en el lock (ya antes tampoco) |
| H-4 · `tsconfig.tests.json` | ✅ cerrado | El comentario dice hoy «Node ≥ 24.15 (el suelo de `engines`)» y que el build en ES2022 lo decide el cliente del navegador, no un suelo de Node |
| Guion 164 bajo Node 26 | ✅ cumple, probado en negativo | `node qa/run.mjs --sin-navegador 164-el` → ✔, EXIT 0. `mutacion-reparto-en-lotes.mjs --solo-vigentes` con `NODE_OPTIONS=--require aviso.cjs` (un `DeprecationWarning` con el PID de cada proceso) → los 4 vigentes ✔, incluido «dos corridas del mismo plan dan EL MISMO reparto», EXIT 0. **Negativo**: el invariante devuelto a comparar `r.salida` (stdout+stderr) con el mismo aviso → `✖ reparto · dos corridas del mismo plan dan EL MISMO reparto` + «hay una regresión», EXIT 1. Restaurado (`diff` igual) |
| `npm run verify` | ✅ | EXIT 0, 1m01s, `ℹ tests 3411 · pass 3411 · fail 0 · skipped 0`, 0 líneas con «Warning» |
| Batería headless | ✅ con la precondición conocida | El 163 se niega sobre este árbol: «el padrón que este guion reescribe viene limpio… hay cambios sin commitear» (`recorridos-de-test.json` lo toca la tanda). Es su precondición, no un rojo de la tanda; el ingeniero lo corrió en un clon con la tanda commiteada (1 de 1). Los otros 11 salieron verdes en la vuelta 1 y los tocados (151, 164, 165) se han vuelto a correr aquí |

**Reservas que quedan (ninguna bloquea):**
- El censo del padrón es por grafía y exige `ℹ fail (`/`ℹ tests (`: un lector sin grupo de captura no tiene fila y no se entera. Está escrito en la cabecera del test.
- Sin PR sigue sin medirse la versión que resuelve `setup-node latest` en el runner ni CI verde.
- H-5 (nombre del 165) y H-6 (Node 24.11.1 heredado en el shell de los agentes) siguen como estaban; no se pidieron.

### Veredicto final

**Apto.** Los cuatro hallazgos están cerrados y cada cierre se ha puesto rojo a mano: el arnés de mutación y el 151 detectan una base rota por un `describe` que lanza, el padrón nuevo caza un lector sin fila y un lector sin el trozo del EXIT, y el 164 vuelve a rojo si compara stderr. `verify` 3411/3411 sin avisos bajo Node 26. Pendiente solo lo que no existe sin PR: la versión resuelta en el runner y el CI verde.
