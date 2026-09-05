# QA — PR-3 · #357 «quién mide `qa/`» (PR #454, `t11/quien-mide-qa` = `760cebd` sobre `268b80f`)

Fecha 2026-09-05 · worktree desprendido `/home/al/code/ne-fan-t11-qa3` · `NEFAN_PORT_OFFSET=900` ·
`NEFAN_PYTHON=/home/al/code/ne-fan/.venv/bin/python` (este árbol no tiene `.venv`) · cero créditos ·
nada matado que no fuera mío (los `kill -INT` van por PID a hijos que arranqué yo).

Validado contra la **decisión ejecutada** de `requisitos.md` («Decisión del usuario», punto 2: el CI
corre los candados headless) y las cuatro piezas: (1) test → banco con candado, (2) totalidad de
`qa/lib`, (3) CI corre los headless, (4) los candados rojos en `main` vuelven a poder ponerse rojos
por lo que miden.

## Criterios → veredicto

| # | Criterio (de la decisión) | Veredicto | Evidencia |
|---|---|---|---|
| 1a | `npm run verify` verde | ✅ | `ℹ tests 2081 · pass 2081 · fail 0`, exit 0, 25 s reales. Árbol limpio después |
| 1b | `npm run coverage && npm run crap -- --check` dentro de umbrales, `qa/lib` fuera de `MEDIDOS` | ✅ | `Tope CRAP ≤ 73 — 0 por encima · Objetivo ≤ 30 — 7 por encima · Cobertura mínima 89% — ahora 89.2% · ✔`. El lcov trae **5** `SF:../qa/lib/*.mjs` (esperas, presets-clasifica, python, stack, veredictos) y `crap-score.ts:174` los descarta porque `MEDIDOS = ["src/","bridge/","services/"]` compara con `startsWith` sobre la ruta `../qa/…` |
| 2a | Regla `el-banco-no-entra-en-produccion`: import de `qa/lib` desde producción → rojo con el id | ✅ | Ficheros REALES (no el `it` sintético), uno a uno y restaurados: `nefan-core/src/x.ts`, `bridge/x.ts` (import dinámico literal), `services/asset-store/x.ts`, `scripts/x.ts`, `nefan-html/src/x.ts`, `narrative-mcp/x.ts` → `architecture.test.ts` **73 pass · 1 fail**, `✖ [error] el-banco-no-entra-en-produccion` en los seis |
| 2b | …y desde `test/` y `labs/` → verde | ✅ | `nefan-core/test/x.test.ts` y `labs/x.ts` con el mismo import → **74 pass · 0 fail** |
| 2c | …también con la forma `import(join(…, "qa", "lib", …))` | ❌ | `nefan-core/src/x.ts` con `await import(join(process.cwd(), "..", "qa", "lib", "stack.mjs"))` → **74 pass · 0 fail**. Es la forma que usan los cinco tests que importan el banco (hallazgo H3) |
| 3a | Totalidad: `touch qa/lib/nuevo.mjs` → rojo con nombre | ✅ | `qa-lib-tiene-quien-lo-mire`: 7 pass · 1 fail · «qa/lib sin quien lo mire: nuevo.mjs. O un test … lo importa …, o entra en banco-medido.json» |
| 3b | Exención caducada → rojo | ✅ | `import(join(repoRoot,"qa","lib","sesion.mjs"))` añadido a `veredictos.test.ts` → 1 fail: «sesion.mjs está exento y lo importa veredictos.test.ts: quita la exención» |
| 3c | `fichero` inexistente en `banco-medido.json` → rojo | ✅ | `navegador.mjs` → `navegador-viejo.mjs`: **2 fail** (fichero inexistente + `navegador.mjs` huérfano) |
| 3d | Mención en string NO cuenta | ✅ | `const _m = "ver qa/lib/saves.mjs y join(repoRoot, \"qa\", \"lib\", \"saves.mjs\")"` en un test → 8/8 verde |
| 3e | `porque` corto → rojo; `qa/` en `mutation-targets.json` → rojo | ✅ | «difícil de probar» → 1 fail («encogimiento de hombros»); `"../qa/lib/veredictos.mjs"` en `tests` del primer módulo → 1 fail |
| 3f | `qa/lib/python.mjs` (PR-2) sale medido por su test | ✅ | Detector real sobre `test/`: `python.mjs ← qa-lib-python.test.ts`; no está en `banco-medido.json`. Hoy 5 medidos + 7 exentos |
| 3g | El verde de la totalidad depende de que exista el test real de cada módulo medido | ❌ | Con `veredictos.test.ts`, `esperas-de-qa.test.ts` y `presets-clasifica.test.ts` **movidos fuera de `test/`**, la totalidad sigue **8 pass · 0 fail**: `qa-lib-tiene-quien-lo-mire.test.ts` se cuenta A SÍ MISMO como importador de `esperas`, `presets-clasifica` y `veredictos` (sus fixtures sintéticas del `it` «cuenta las tres formas» tienen forma de import). Hallazgo H1 |
| 3h | Los 7 `porque` de los exentos son verdad | ⚠️ 6 sí, 1 miente a medias | Leídos los 7 módulos: `sesion` (page.click/evaluate ×20), `saves` (fs + `page.evaluate`), `puertos` (`net.connect`, `ss`, `/proc`), `combate` (`page.evaluate` + teclado), `sonda` (`page.evaluate`), `fixtures` (`page.evaluate/route`), `navegador` (`chromium.launch`): todos conducen navegador/socket/disco, como dicen. Pero el de **`puertos.mjs`** afirma «Lo ejercen los guiones headless que corren en CI (`fake-enruta-por-pathname`, …)» y `fake-enruta` **no corre en CI** por decisión de esta misma PR (H6) |
| 4a | Job `candados-headless`: los 7 corren en CI, exit 0, con el `python3` del runner, sin `SIN MEDIR` | ✅ | `gh pr checks 454` → `candados-headless pass 3m6s` (run 33965689556, job 101305300482). Log: los 7 pasos `Run node qa/…` presentes, **0** líneas `##[error]`/`exit code`; `setup-python` → `CPython 3.11.16` en `/opt/hostedtoolcache`; `el-npc-cruza` 21 ✔ «puertos: bridge :9877, state :9878 (offset 0)»; `reparto` 0 de 9 rotos; `selector` 8 puertas/38 datos; `candados` 44/44; `cableado` 13/13; `contrato` 14/14; `ledger` VERDE. La única aparición de «sin medir» en el log es el texto de un candado («una fecha ilegible cuenta como sin medir»), no un veredicto |
| 4b | Los 7 en el MISMO orden y misma shell en local → verdes; `git status --porcelain` vacío | ✅ / ⚠️ | 2,0 · 6,0 · 2,0 · 34,0 · 25,0 · 3,0 · 44,0 s = **116 s**, exit 0 ×7; `git status --porcelain` limpio. PERO queda `nefan-core/reports/{lotes-ensayo,plan-corrida.json}` (gitignored, lo deja `cableado`; H7) |
| 4c | `kill -INT` a mitad: ¿restauran? ¿lo nota el siguiente paso? | ❌ (local) | Ninguno de los cuatro tiene manejador de señal; el `finally` **no corre** con SIGINT (exit 130). Detalle en H2 |
| 5a | Siembra de `reparto`: DOS módulos, «solos» ≠ «juntos» | ✅ | `conReloj.slice(0, 2)` (hoy `scene-normalize`, `combat-resolver`), afirma `sin.length === 2 && every(modulos.length === 1) && ids === sembrados` |
| 5b | El invariante sembrado se pone rojo si `empaqueta` agrupa | ✅ | `mutacion-huella.ts:692-694` sustituido por la versión que junta los sin-medida en UN lote → `--solo-vigentes`: `✖ reparto · lo que nadie cronometró va SOLO, uno por lote · rotos 1 de 9 · exit 1`. Restaurado. La batería también lo caza sola: `mutacion-huella.test.ts` **122 pass · 2 fail** con la misma rotura |
| 5c | La siembra restaura la huella también con `kill -INT` | ❌ | `kill -INT` a los 4,6 s (dentro de la ventana `writeFileSync(HUELLA)` → `planDeHoy()`): `M nefan-core/data/contract/mutacion-huella.json`, **5 filas sin `segundos`**. H2 |
| 5d | `--solo-vigentes`: qué excluye y si tiene sentido | ✅ con nota | Excluye los 7 `ABIERTOS` (probes que spawnean `bateria`/`candados`/`cableado` como checkers) y las 2 `CONDUCTAS_ABIERTAS`. En CI tiene sentido: sus checkers son los propios candados que ya corren como pasos (~4 min duplicados). Consecuencia: los ABIERTOS **sin `deuda`** solo se ven en la corrida completa local — resultado en F, abajo |
| 6 | ¿Algún camino por el que un fallo de `qa/lib` ponga rojo `verify` sin un test que lo importe a propósito? | ✅ (respuesta: solo el deliberado) | `npm test` = `test/*.test.ts`; `lint` = `eslint src bridge services test scripts` (sin `qa`); typecheck no toca `qa/`. El lcov sí carga `qa/lib` pero `MEDIDOS` lo filtra (1b). El ÚNICO camino es `architecture.test.ts` escaneando `qa/**/*.mjs` para reglas de texto/puertos (`arch-rules.json:512,576,657`), que es anterior y deliberado |
| 7 | Prosa: fila `CLAUDE.md`, `qa/README.md` «Lo que corre el CI» (7 y por qué no el 8.º), cabeceras | ✅ / ⚠️ | `CLAUDE.md:38` fila nueva nombra job + `banco-medido.json` + regla. README: tabla «Dentro» con **7** filas y tiempos; «Fuera» explica `fake-enruta` (arte generado gitignored → 500 en clon limpio). `grep -rn "el CI no corre\|CI no toca\|8 candados\|ocho candados"` en `nefan-core/test qa docs/arquitectura CLAUDE.md` → solo `architecture.test.ts:1119` («el CI no corre prettier», verdadero y ajeno) y `qa/README.md:43` («Hasta T11 … no tocaba», histórico y verdadero). En `requisitos.md:132,162` quedan las frases del borrador, que el propio documento supersede con la «Decisión del usuario». Lo que SÍ miente: README:48 «los que solo leen antes que los que escriben» cuando el 2.º paso (`reparto`) escribe (H5); `reparto:308` «hoy son 17 de 41» (H4) |
| 8 | Regla del workaround | — | Ningún apaño para que algo pase. Lo único no estándar: `NEFAN_PYTHON` porque el worktree no tiene `.venv` — es la palanca que PR-2 creó para eso, y el CI la prueba sin ella (cae a `python3`) |

## Hallazgos

### H1 · IMPORTANTE — La totalidad se satisface a sí misma para tres módulos

**Qué pasa.** `test/qa-lib-tiene-quien-lo-mire.test.ts` recorre TODOS los `test/*.test.ts`, incluido él
mismo, y su `it` «cuenta las tres formas de importar» contiene, como strings, `import(join(repoRoot, "qa",
"lib", "esperas.mjs"))`, `from "../../qa/lib/veredictos.mjs"` e `import("../../qa/lib/presets-clasifica.mjs")`.
El detector es textual, así que esas tres líneas cuentan como importaciones reales. Resultado: `esperas.mjs`,
`presets-clasifica.mjs` y `veredictos.mjs` figuran como «medidos» aunque su test real desaparezca.

**Reproducción.**
```
mv nefan-core/test/veredictos.test.ts nefan-core/test/esperas-de-qa.test.ts nefan-core/test/presets-clasifica.test.ts /tmp/
cd nefan-core && node --import tsx --test test/qa-lib-tiene-quien-lo-mire.test.ts   # → ℹ pass 8 · fail 0
```
Volcado del detector sobre `test/`: `esperas.mjs ← esperas-de-qa.test.ts, qa-lib-tiene-quien-lo-mire.test.ts` ·
`presets-clasifica.mjs ← presets-clasifica.test.ts, qa-lib-tiene-quien-lo-mire.test.ts` ·
`veredictos.mjs ← qa-lib-tiene-quien-lo-mire.test.ts, veredictos.test.ts` · y hasta `x.mjs ← qa-lib-tiene-quien-lo-mire.test.ts`
(la cabecera del fichero).

**Qué esperaba el usuario.** «Todo `qa/lib/*.mjs` importado por algún test o eximido con motivo» —y que borrar
el test que lo mide se note. Hoy, para 3 de los 5 medidos, no se nota. Es exactamente la clase que el propio
test dice cerrar («contar menciones convertiría cualquier comentario en cobertura»). El arreglo es del
ingeniero (excluir el propio fichero del barrido, o mover las fixtures sintéticas a un sitio que no case);
señalo además que la mención con forma de import en un string también cuenta si va en comillas simples o
template literal (mi prueba 3d no casó solo porque las comillas iban escapadas con `\"`).

### H2 · IMPORTANTE (solo local; en CI no propaga) — Un Ctrl+C deja fuente y huella ROTOS y el siguiente candado corre encima en verde

Ninguno de `mutacion-reparto-en-lotes`, `mutacion-candados-en-negativo`, `mutacion-cableado-en-negativo`
ni `contrato-candados-en-negativo` tiene `process.on("SIGINT"|"SIGTERM")`; Node muere sin ejecutar el
`finally`. Medido con `node qa/<x> & sleep N; kill -INT $!`:

| Candado | kill a | exit | Deja sucio | ¿Lo nota el siguiente paso del job? |
|---|---|---|---|---|
| `mutacion-candados-en-negativo` | 12 s | 130 | `M scripts/mutacion-huella.ts` (1 línea mutada: **producción rota**) | `cableado ancla` → **exit 0**; `contrato-` → **exit 0 «✔ todos los candados …»**. Ninguno mira ese fichero |
| `contrato-candados-en-negativo` | 1,5 s | 130 | `M src/contract/model-io/scene-schema.ts` (**producción rota**) | El siguiente `contrato-` sí: `exit 2 ✖ hay cambios sin commitear en los ficheros que este guion reescribe`. El `ledger` (paso posterior) no mira nada |
| `mutacion-reparto-en-lotes --solo-vigentes` | 4,6 s | 130 | `M data/contract/mutacion-huella.json` con **5 filas sin `segundos`** (la siembra a medias) + `nefan-core/reports/` | El siguiente `reparto` sale **rojo 1 de 9** pero culpando al planificador («hay una regresión en lo que ya funcionaba») y **no restaura**: toma la huella sucia como «original». `cableado "lleva TODO"` → **exit 0** sobre la huella sucia. La huella sigue sucia al final |
| `mutacion-cableado-en-negativo` | 8 s | 130 | `M scripts/mutacion.ts` (**producción rota**) + `nefan-core/reports/` | — |

**Por qué importa aunque el CI esté a salvo.** En el runner un paso solo muere por timeout del job, y entonces
no corre ningún paso más: no hay propagación. En local es distinto: el usuario corta con Ctrl+C (es lo que
QA de PR-2 encontró en `el-npc-cruza`, y allí el ingeniero puso manejadores de señal —el patrón ya está en
este mismo job), se queda con un `scripts/mutacion*.ts` mutado o una huella COMMITEABLE con relojes borrados,
y el comentario del job («los que solo leen antes que los que escriben … `contrato-` que se niega sobre
ficheros sucios detrás») da una seguridad que no existe: `contrato-` solo guarda SUS cuatro ficheros. La
afirmación de `implementacion-3.md` «restaura la huella en `finally`» es verdad para excepciones y falsa
para señales. Tres de los cuatro guiones preexisten a esta PR; el que sí es de esta PR (la siembra en
`reparto` y en `cableado`) es el que añade una escritura nueva sobre un fichero **commiteado**.

### H3 · MENOR — La regla de arquitectura no ve la forma de import que usa el propio repo

`imports.forbid` mira especificadores literales. `nefan-core/src/x.ts` con
`await import(join(process.cwd(), "..", "qa", "lib", "stack.mjs"))` pasa `architecture.test.ts` 74/74. Es la
forma canónica de los cinco tests que importan el banco (copiar-pegar de un test a un script es plausible).
Un `text.pattern` complementario (`"qa",\s*"lib"`) sobre los mismos `files` lo cerraría; lo decide el
ingeniero. Las reglas hermanas tienen el mismo límite, así que es una carencia de clase, no de esta regla.

### H4 · MENOR — Prosa caducada en el mismo fichero que la PR corrige

`qa/mutacion-reparto-en-lotes.mjs:308` (ABIERTO «los módulos SIN MEDIDA se agrupan en un solo lote»):
`"hoy son 17 de 41. Ningún test de la batería llama a empaqueta con MÁS DE UNO sin medida"`. La PR quitó el
«(hoy son 17)» del vigente vecino y dejó este. Y además ya no es cierto que nadie lo cace: la propia batería
(`mutacion-huella.test.ts` 122/2 con `empaqueta` roto) y el vigente sembrado lo cazan (ver F).

### H5 · MENOR — «Los que solo leen antes que los que escriben» no describe el orden real

`qa/README.md:48` y el comentario del job: el 2.º paso, `mutacion-reparto-en-lotes`, **escribe** (aparta
`reports/` entero, reescribe la huella en la siembra) — la propia tabla de README lo dice en su fila
(«escribe y restaura la huella y `reports/`»). El único que «solo lee» es `el-selector`, que va 3.º.

### H6 · MENOR — Una exención cita como «corre en CI» un guion que esta PR dejó fuera

`banco-medido.json` → `puertos.mjs.porque`: «Lo ejercen los guiones headless que corren en CI
(`fake-enruta-por-pathname`, `el-npc-cruza-ai-server-…`)». `fake-enruta-por-pathname` está en la tabla «Fuera»
del README por decisión de esta misma PR. El motivo de la exención sigue siendo válido (socket real contra el
kernel); la frase no.

### H7 · MENOR — Residuo en `nefan-core/reports/` tras una corrida limpia

Tras los 7 pasos en orden, `nefan-core/reports/lotes-ensayo/` y `reports/plan-corrida.json` quedan en el
árbol (gitignored: `git status` limpio). Los deja `mutacion-cableado-en-negativo` (`rmSync(dir)` al ENTRAR
en cada `mira`, nunca al salir; solo aparta/restaura `reports/mutation`). Inofensivo en CI; en local, un
`reports/` que no existía aparece. Preexistente a la PR.

### Observaciones sin hallazgo

- `el-ledger-…:352` lleva la ruta personal `/home/al/code/ne-fan/cache/spend` en un aviso «H2 parece
  cerrado» que también se imprime en el runner. Fuera del diff de esta PR (es de #392); lo anoto porque
  QA de PR-2 ya cobró una ruta personal en el mismo fichero.
- `esperas.mjs:96-97` («se prueba en `esperas-de-qa.test.ts`, que sí corre en el CI — la batería de `qa/`
  no») sigue siendo verdad tal cual está escrita.
- La segunda corrida de `reparto` sobre una huella sucia (H2) sale roja con un diagnóstico equivocado
  («regresión en lo que ya funcionaba»): un `git status --porcelain` de la huella al arrancar —como hace
  `contrato-`— lo convertiría en «te dejaron la huella sucia», que es lo que un jugador de este banco
  necesita leer.

## F · La corrida COMPLETA de `reparto` (sin `--solo-vigentes`, lo que el CI no ve)

`node qa/mutacion-reparto-en-lotes.mjs` → **exit 0 en 3 m 51 s**: 9/9 vigentes ✔; ABIERTOS: los dos sin
`deuda` («los módulos SIN MEDIDA se agrupan en un solo lote» y «`fusionar` deja de verificar el SELLO») salen
✔ **cazados** (línea base `bateria:0 · candados:0 · cableado:0`, y la firma cambia al romper); 5 ⏳ con dueño
(#436 ×3, #437 ×2); las 2 conductas abiertas ✔. `Hallazgos NUEVOS sin candado: 0 · Declaraciones que mienten: 0`.
Conclusión para 5d: `--solo-vigentes` en CI no esconde hoy ningún rojo; lo que esconde es ~3,7 min de
checkers que ya corren como pasos propios. Lo que sí queda fuera del CI para siempre con ese flag es la
detección de una **declaración de deuda que mienta** (#436/#437 cerrados sin quitar el `deuda:`): eso solo
lo verá quien corra la completa en local, y hay que decirlo en el README junto al flag.

## Workarounds usados

- `NEFAN_PYTHON=/home/al/code/ne-fan/.venv/bin/python`: el worktree no tiene `.venv`. No afecta al usuario:
  su checkout lo tiene y el runner cae a `python3` (comprobado en el log: 3.11.16 del `hostedtoolcache`).
- `NEFAN_PORT_OFFSET=900` para no pisar a otros agentes; `el-npc-cruza` lo honró (`bridge :10777`).
- Borré `nefan-core/reports/` (gitignored) entre mis propias corridas para que cada prueba de interrupción
  partiera del mismo estado; no es código ni material de sesión.

## No probado

- El runner con un candado que **falle** de verdad (todos salieron 0): que el rojo tenga nombre de paso es
  lo que da la estructura «un `run` por ejecutable», no algo que haya visto en rojo en GitHub.
- `fake-enruta-por-pathname` en clon limpio: no lo repetí; la explicación (arte generado gitignored) casa con
  `.gitignore:53`, pero no lo he visto 500 con mis ojos.
- El reloj del job bajo carga del runner (3 m 6 s hoy con `timeout-minutes: 20`).

## Veredicto: **apto con reservas**

Las cuatro piezas de la decisión están hechas y se ven en rojo por lo que miden: la regla salta en los seis
árboles y calla en `test/`/`labs/`; la totalidad enrojece con módulo nuevo, exención caducada, fichero
inexistente, motivo corto y `qa/` en mutación; el job corrió los 7 en CI con el Python del runner sin ningún
`SIN MEDIR`; `reparto` y `cableado` siembran su población y vuelven a distinguir «solos» de «juntos» (rojo al
romper `empaqueta`). `verify` 2081/2081, CRAP 89,2 % sin mover, `qa/lib` fuera de `MEDIDOS` comprobado.

Las reservas son dos, y la primera es de fondo: **H1** — la totalidad se cumple a sí misma para tres de los
cinco módulos medidos (borrar sus tests reales no la pone roja), que es el verde-que-no-comprueba contra el
que la tanda entera se escribió; y **H2** — la siembra nueva escribe sobre un fichero commiteado sin
manejador de señal, así que un Ctrl+C local deja la huella con relojes borrados y los candados siguientes
corren verdes encima (el CI no lo sufre; el usuario en su terminal sí, y el patrón del arreglo ya está en
`el-npc-cruza`). Ninguna de las dos exige rehacer la decisión; las dos son del ingeniero y las dos se ven
en rojo con los comandos de arriba. H3–H7 son prosa y bordes.
