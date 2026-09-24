# QA — tanda AU: eslint mira `qa/`, ruff mira `labs/` (#733 #718)

Worktree `/home/al/code/ne-fan-tanda-au` (`feature/tanda-au`, sin commitear), base `main` 57addf93, **sin rebasar sobre AR** (C5 pendiente, orden del coordinador). Node v26.10.0 (nvm), ruff 0.15.20 del `.venv` del checkout principal. Cero créditos: nada de lo aquí corrido abre motor ni servicios de imagen (el único navegador que se abrió fue el de `fixtures-sin-bridge`, preset `html-fixtures`, sin backend).

Guion nuevo de QA: **`qa/guiones/176-el-lint-recorre-el-banco-y-los-benches-de-verdad.mjs`** (headless, fila en `qa/README.md`). Mide en el ÁRBOL REAL lo que el 175 y el 162 miden en un espejo o una copia, y cierra el hueco del hallazgo 1.

## Criterios (los reescritos tras la crítica)

| # | Criterio | Veredicto | Evidencia |
|---|---|---|---|
| 1a | `npm run lint` mira `qa/**/*.mjs` con solo `no-unused-vars` (`^_` exento) | ✅ | `eslint -c nefan-core/eslint.qa.config.js qa --format json` desde la raíz: **233 ficheros, 0 errores** (234 con el 176). `--print-config qa/lib/carga.mjs` → `no-unused-vars: [2, {…, argsIgnorePattern:"^_", varsIgnorePattern:"^_"}]` y ninguna otra regla. Guion 175 (b) y (c) en verde: `_x` → 0, `window`/`process` sin declarar → 0 |
| 1b | …y por tanto `verify` y CI lo heredan, y **se pone rojo de verdad** | ✅ local / ⚠️ CI no corrido | Siembra en el árbol real `qa/lib/zz-qa-au.mjs` con import muerto → `npm run lint` rc=1 nombrando fichero y regla; helper sin llamar en `qa/guiones/` → rc=1. **`npm run verify` entero con la siembra → rc=1 a los 15,4 s** (tras `lint:py`, build y typechecks, antes de `npm test`), con `qa/guiones/zz-qa-au-verify.mjs … no-unused-vars` en la salida. CI: el job `nefan-core` corre `npm run lint` con `working-directory: nefan-core` sobre un checkout completo (`actions/checkout@v7`, sin sparse), así que `cd .. && eslint …` alcanza `qa/`; el 175 (e) canda el texto. **No hay PR aún, así que el runner no lo ha corrido** |
| 1c | Los 18 hallazgos, cada uno clasificado antes de tocarlo; ninguno borrado sin su línea | ✅ | Reproducidos en `main` 57addf93 con la config nueva: **18 errores en 13 ficheros**, la misma cifra. Los 18 tienen su fila en `implementacion.md`. Contrastados uno a uno contra el guion vivo (ver «¿Alguno era un aserto prometido?») |
| 2a | `lint.sh` pasa ruff sobre `labs/`; el `F841` de `gen.py:246` limpio | ✅ | `lint.sh:60` → `ruff check ai_server labs`; `git diff labs/fps/gen.py` borra solo `tex_dir`; `bash ai_server/lint.sh` rc=0. `ruff check --show-files labs` lista los **12** `.py` rastreados de `labs/` (con `labs/fps/gen.py`) |
| 2b | Reglas de `labs/` decididas y ESCRITAS (`labs/ruff.toml`, `E4,E7,E9,F`) | ✅ | `labs/ruff.toml` existe con cabecera del porqué. `ruff check --show-settings labs/fps/gen.py` → `Settings path: …/labs/ruff.toml`, reglas habilitadas empiezan en `E401`, 0 reglas `UP`; `ai_server/main.py` → 91 menciones de `pyupgrade`. 162 siembra 5 (UP032 en `labs/` → 0) en verde |
| 2c | El guion 162 invertido (E741 en `labs/` → rojo) y la prosa contraria barrida | ✅ | 162: 25 asertos en verde, siembras 3 y 4 exigen rc≠0 con `E741`/`F841`. **Negativo**: `lint.sh` devuelto a `ruff check ai_server` → rojo SOLO «E741 en labs/» y «F841 en labs/» (restaurado byte a byte). `grep` de «no se extiende a labs / NO se amplía a labs / solo pasa compileall» en `.md .sh .yml .mjs .ts .json` fuera de `docs/agents/`: **0 resultados** (queda solo la historia «Hasta la tanda AU…», que es correcta) |
| 3a | Probado en negativo por los dos lados | ✅ | Además de lo de arriba: `labs/zz_qa_au.py` con F841 → `npm run lint:py` rc=1; `labs/fps/zz_qa_au.py` (anidado) → rc=1. 175 con `lint:qa = "true"` → rojo (a) y el texto; 175 con `files: ["qa/**/*.nunca"]` (lintá cero) → rojo (a). Unitario de paridad: 2/2 en verde |
| 3b | Lo que el lint nuevo NO mira, enumerado (mínimo `labs/**/*.{js,mjs}`) | ✅ | Cabeceras de `eslint.qa.config.js`, 175 y fila del README; `implementacion.md` «Qué NO queda cubierto» + 3 issues redactados |
| 4 | Coste de `lint` y `verify` medido antes/después; sin encarecer apreciablemente el bucle | ✅ | Medido por QA, mismas condiciones, secuencial: `npm run lint` **main 4,19 · 4,32 · 4,39 s → worktree 5,40 · 5,56 · 5,77 s (+1,24 s de mediana)** = el `lint:qa` a solas (1,27 · 1,30 · 1,32 s). `lint.sh` 0,11 s (main) vs 0,06 s (AU). `npm run verify`: **main 61,7 s · worktree 58,8 s** — el +1,3 s real queda dentro del ruido de la máquina. Presupuesto del plan (≤1,5 s en `lint`): cumplido |
| 5 | Rebasar sobre AR y volver a medir | ⚠️ no probado | La rama seguía sobre 57addf93 al validar. Chocaron de número con la tanda AT (#747), que ocupó el 173 y el 174: tras rebasar sobre b0cd7edd se renumeraron a 175 y 176 (esta QA ya los cita con el número nuevo); los tiempos y los hallazgos se repitieron tras el rebase (ver `implementacion.md`) |

### Las cuatro preguntas del coordinador

- **¿El lint de `qa/` se pone rojo de verdad en `verify` y en CI?** En `verify` sí, demostrado con siembra real (rc=1 a los 15 s, antes de los tests). En CI, por el texto del yml y por el 175 (e); el runner no lo ha corrido porque no hay PR.
- **¿Alguno de los 18 era un aserto prometido?** No. Contrastados contra el guion vivo: `128 caminoLibreAntes` nunca se llamó en ninguna versión (`git log -S`: solo el `+function` de 7c19abc3) y la cabecera dice «se sondea y no se anda a propósito», la travesía (`:343-348`) afirma punto a punto tolerando lo ya sólido; `128 HUECO_DEL_SPAWN_M` no tiene promesa de «5 m» ni `near_player` en el guion; `89 delWire`: el bloque 1 lee `ultimoOriginal` en línea (`:248`); `93 posicion/vida`: en línea en `:412-425`, afirmado en `:537`; `52 colorDelAviso`: color leído en `:92` y afirmado en `:197`; `12 sel/est`: `revisar()` afirma dentro (dos `ctx.expect`) y su retorno solo lo usa «subir estilo»; `41 barkeep`: el `waitFor` es el aserto y el paseo usa `"barkeep"` literal; `18 esperarTituloListo`: el aserto vive en el 19 (`19:161,235`); `05 celdaAMundo`: el guion lee `terrain_grid` en línea; `163 existsSync`: 0 usos; `152 p` y `la-puerta x,z`: firmas deliberadas. Los 11 ficheros tocados importan (`default` es función) y `la-puerta-de-la-reaparicion.mjs` corre verde. El único cabo real lo declara el propio ingeniero (89 bloque 4, issue redactado): no es un aserto perdido, es una espera que se cumple al instante.
- **¿`--headed` recableado funciona?** Sí, en el flujo real: `node qa/fixtures-sin-bridge.mjs --headed` con `DISPLAY=:0` arrancó `./start.sh --preset html-fixtures` solo (:3000 estaba libre), Playwright lanzó `/opt/google/chrome/chrome …` **sin `--headless`** (sondeado con `ps` a los 919 ms), el guion dijo «webgl: (headed: la pila del escritorio)», acabó `✔ html-fixtures pinta sin backend` rc=0 y dejó :3000 libre. Confirmado en git que 1f4e99db (#267) quitó `headless: !HEADED` al pasar a `abrirNavegador(chromium)`.
- **¿Cambió el coste de `verify`?** +1,24 s en `lint` (= `lint:qa`), nada en `lint.sh`; `verify` entero no se mueve fuera del ruido (61,7 s main vs 58,8 s AU).

## Hallazgos

### Importante

**1. El 175 no ve que la regla deje de aplicarse a parte del banco.** En flat config, un fichero que no casa con ningún `files` se procesa con **cero reglas y sale verde**: medido con `files: ["qa/guiones/**/*.mjs"]` en `eslint.qa.config.js`, `npm run lint` sigue en verde, `--print-config qa/lib/carga.mjs` da `rules: {}` y **el guion 175 sale 1 en verde · 0 en rojo** porque su siembra (a) va en `qa/guiones/`. Con eso, `qa/lib/` (24 ficheros) y `qa/*.mjs` —incluido `qa/bajo-carga.mjs`, el fichero que motivó #733— se quedan sin lint sin que nada lo diga. Pasos: cambiar el glob de `files`, `cd nefan-core && npm run lint` (verde), `node qa/run.mjs --sin-navegador 175` (verde). Lo que se esperaba: que la batería lo dijera. **Lo cubre el 176 (D)**: pregunta a ESLint por la config efectiva de un fichero por carpeta del censo y exige la regla en `error` con `^_`; con ese sabotaje sale rojo nombrando `qa/bajo-carga.mjs` y `qa/lib/anclas.mjs`. Si el coordinador prefiere que viva en el 175, es sembrar también en `qa/` raíz y en `qa/lib/`, pero la pregunta correcta es la de `--print-config`, no la de «¿está en la lista?».

### Menor

**2. Guion 89, bloque 4: la espera «vuelven a llegar frames sin reescribir» se cumple sin esperar.** Lo detectó el ingeniero al clasificar `delWire` y lo deja como issue redactado; confirmado leyendo `89:354-359` (`ultimoOriginal ? true : null`, puesto desde el bloque 1). No es de esta tanda ni un verde falso; que se abra el issue.

**3. Nada en `qa/README.md` fuera de las filas 175/176 dice que el banco pasa por `no-unused-vars`.** Quien escriba un guion nuevo se enterará al primer `npm run lint`, con un mensaje claro, así que no bloquea; pero la sección general del README que describe qué sujeta al banco (`EXTENSIONES_DEL_BANCO`, saltos, banco medido) no menciona el lint. Una línea bastaría.

## Workarounds usados

Ninguno sobre el producto. Los sabotajes (config, `package.json`, `lint.sh`, siembras en `qa/` y `labs/`) se hicieron uno por vez, con copia previa y `diff` byte a byte tras restaurar; `git status` no muestra restos. El sondeo de `ps` para `--headed` es un observador externo, no cambia el flujo.

Un sabotaje que **no** se puso rojo y está bien que no: un `labs/pyproject.toml` con `[tool.ruff] extend` al de `ai_server/` no cambia la config resuelta, porque `ruff.toml` tiene precedencia sobre `pyproject.toml` en el mismo directorio. El negativo válido para C del 176 es un `labs/fps/ruff.toml` (más cercano), que sí lo pone rojo.

## No probado

- **CI en el runner** (jobs `nefan-core`, `ai-server`, `candados-headless`): no hay PR. Lo que lo sujeta hoy es el texto del yml (checkout completo, `npm ci` en `nefan-core` para el symlink del 175, `pip install -r ai_server/requirements-dev.txt` para el 162 y el 176) y el hook `ci-verde.sh` cuando la haya.
- **C5**: rebase sobre AR y re-medida.
- La batería de navegador de los 8 guiones tocados (05, 12, 128, 152→headless sí, 18, 41, 52, 89, 93): solo importados, no conducidos. El cambio en cada uno es quitar bindings/imports que ESLint demuestra sin uso.
- El guion 164 en rojo con Node 26 (DEP0205): conocido, de la tanda AR, no reproducido aquí adrede.

## Resultados de la batería (rellenados al final)

- `npm run verify` en el worktree (con el 175 y el unitario, antes del 176): rc=0, 3411 tests, 3410 pass, 1 skipped, 58,8 s.
- `npm test` tras añadir el 176 (padrones de guiones: saltos sin observar, relojes de pared, un número un guion, totalidad headless, filas del README): **rc=0, 3411 tests, 3410 pass, 1 skipped**; `npm run lint` rc=0 (234 ficheros del banco, el 176 incluido).
- Clase headless entera (`node qa/run.mjs --sin-navegador`, lo que corre `candados-headless`): **13 en verde · 1 en rojo de 14**, 78 s. El rojo es el **164** (DEP0205 con Node 26), conocido y de la tanda AR. 162, 175 y 176 en verde dentro de la clase.
- Aviso de método, para quien repita esto: la clase headless y `npm test` **no se pueden correr a la vez sobre el mismo árbol**. El 163 siembra `.ts` en `nefan-core/test/` del árbol real y los restaura; un `npm test` concurrente vio uno de esos ficheros a medias (`✖ la-consulta-de-movimiento-tiene-dueno` y un `ENOENT …zz-sabotaje-qa-704-promises-named.ts` en el lint). Repetido en solitario: verde. No es un hallazgo de la tanda.

## Veredicto

**Apto con reservas.** Los dos issues están cerrados como se reescribieron: el lint se pone rojo de verdad en `verify` por los dos lados, los 18 hallazgos están clasificados y ninguno era un aserto perdido, `--headed` vuelve a funcionar, `labs/` tiene reglas escritas y el 162 dice hoy la verdad. Las reservas: (1) el hallazgo 1 —el 175 no detecta que la regla deje de aplicarse a `qa/lib/` y a `qa/*.mjs`; lo cubre el 176 de QA, que hay que aceptar o trasladar al 175—, (2) C5 sin hacer, y (3) CI sin correr en el runner.
