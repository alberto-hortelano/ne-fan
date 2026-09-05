# Crítica — T11 «Lo que se carga se revalida» (2026-09-05, `main` = `27a46fa`)

**#302 REENCUADRADA (menor) · #235 VIGENTE (encuadre corregido) · #357 VIGENTE, decisión propuesta · #231b VIGENTE y ENTRA como PR propia.**
Todo medido hoy sobre `27a46fa`, árbol limpio; donde copio una cifra de un issue lo digo y la remido.

## El problema real, en una frase por issue

| | Problema | La solución que el issue describe ¿lo ataca? |
|---|---|---|
| #302 | Un snapshot que hoy no pasaría el validador se sirve como `ready`. | A medias: la mitad **estructural** ya está cerrada sin tocar la clave; queda solo la **jugabilidad**. |
| #235 | Nada recorre bridge → ai_server **por HTTP** → bridge, que es la junta donde vivió #173. | Sí. Y hay evidencia nueva de que la junta muerde: el motor falso escribió campos retirados en 4 snapshots (abajo). |
| #357 | El instrumento con el que se aceptan tandas no lo comprueba nadie más que su autor. | El issue no propone: pide decidir. Propongo abajo. |
| #231b | `test/` no tipa en CI y la deuda crece cada tanda. | Sí, y el gate encuentra ~14 tests que mienten, no solo higiene. |

## #302 — la premisa, afirmación por afirmación

| Afirmación | Medida hoy |
|---|---|
| «La staleness va solo por `world_doc_hash`» (`world-snapshot.ts:114,171`) | Cierto para la CLAVE, **falso para el efecto**: `loadWorldSnapshot` pasa `scenes` por `ExpandedSceneSchema` `.strict()` (`world-snapshot.ts:48`, desde #324 `e8c7484` 29-08; `.strict()` desde #409 `0b56cb2` 03-09). Un snapshot con campo retirado **lanza** (`:98-103`) y `worldSnapshotStatus` lo devuelve `stale` (`:172-174`). |
| «Un snapshot bajo validador viejo sigue `ready`» | **Falso hoy para lo estructural**: `gameGenerationStatus` de los 4 juegos → `stale`, `stale`, `stale`, `stale` (script propio, `npx tsx`, 2026-09-05). `scripts/gate-snapshots.ts` → **0/20 aceptadas, exit 1** (glyph ×20, `style_ref` de escena ×16, `ambient_event` ×16, `room_id` ×8). |
| «18 de 20 tiles llevan `style_ref` retirada; uno del 28-08» | Población hoy **4 ficheros / 20 escenas** (alta_fantasia 9, colonia_aster 9, cuentos_oscuros 1, toledo_1200 1; `generated_at` 22-08 ×3 y **colonia_aster 2026-08-28T12:03Z**; mtime 03-09 14:40 = el `jq del(terrain_legend)` de #335, no una escritura del juego). `style_ref` en 16/20. |
| «O `dist/` viejo o tercera vía de escritura sin gate» | **Ninguna de las dos.** Escritor único: `writeWorldSnapshot` ← `writeSessionSnapshot` (`bridge/context.ts:146-176`) ← `bootstrap-tile.ts:114` y `game-gen.ts:210`; `grep writeWorldSnapshot` en src/bridge/scripts/labs/qa → 1 llamante. El origen de los datos es el **motor falso**: `labs/narrative/fake-scenes.ts` en `0712349` (commit vigente el 28-08) emitía `style_ref: place ? "settlement" : "forest"` (`:362`), `hito_${tx}_${ty}` con `glyph:"o"` (`:371`) — exactamente lo que hay en los 4 tiles (`barkeep`, `casa_lenador`, `hito_*`). El gate de escritura era `scenes: z.record(z.unknown())` (`world-snapshot.ts:41` en ese commit). Y el bridge **no pasa la respuesta de ai_server por ningún zod**: `ai-client.ts:88-89` devuelve el JSON crudo; `bootstrap-tile.ts:60-80` solo exige `tile`/`biome` y `validateScene`. Los 4 snapshots locales son **residuo de banco**, no del motor real (`qa/run.mjs:231,333` usa `TMP_GAMES`; alguien arrancó `e2e-sin-creditos` a mano sobre `data/games`). |
| «`EmittedSceneSchema`/`ExpandedSceneSchema` ya existen» | Cierto (`scene-schema.ts:328,378`). |
| Trampa «verde vacío en CI» | Cierta y ya honrada: `scene-fixtures.test.ts:145-155` y `gate-snapshots.ts:55-66` (exit 2 con 0 tiles). `world-snapshot.test.ts:138-250` ya prueba rechazos con **artefacto sintético** escrito sin gate (`aDisco`). |

**Lo que queda vivo**: `replayWorldSnapshot` (`session.ts:510-519`) **no llama a `validateScene`**; los únicos llamantes son `bootstrap-tile.ts:80`, `tile.ts:146`, `scene-routes.ts:50` — todos en generación. `scene-validate.ts` se endureció **5 veces** desde el 22-08 (`4e0cb58`, `695edeb`, `3f6feab`, `8673042`, `4a4f4e7`). Un snapshot que pasa el `.strict()` pero cuyo NPC no cabe en el flood-fill de hoy se replayea `ready`. **Reencuadre**: no «meter el validador en la clave» (una solución entre varias; el arquitecto decide), sino «lo que se carga pasa por el validador de jugabilidad o no se sirve». Criterio en rojo: con el patrón `aDisco` de `world-snapshot.test.ts`, un snapshot **estructuralmente válido** con un NPC en celda sólida no puede llegar a `replay`; quitar la comprobación pone el test rojo.
**Día después**: el título ya enseña `stale` ×4 (`messages.ts:524`); regenerar cuesta minutos de motor, cero imagen. Los 4 tiles locales son basura de banco: borrarlos es lo honesto (`gate-snapshots.ts` lo dice), pero es material de sesión → pedir permiso.

## #235 — premisa y lo que existe

| Afirmación | Medida hoy |
|---|---|
| «El guion 40 ejecuta `validate_scene_response`» | Cierto: `40-…mjs:188-202` lanza `python3` contra `ai_server.narrative_schemas` y `tsx` contra `EmittedSceneSchema`, 30 casos en memoria, `sinMotor` (`:88`). Tres ejes; la igualdad estricta la descartó **para bloques declarativos** (`:11-49`), no para campos: el eje 1 exige veredicto idéntico en `role`, `description`, claves de entity (`:127-140`). |
| «`contrato-candados-en-negativo.mjs` corre las fixtures Python en negativo» | Cierto: 6 inversiones sobre `narrative_schemas.py` con `python3 -m unittest ai_server.tests.test_contract_fixtures` (`:136-191`); escribe en el árbol y se niega si está sucio (`:37-38`). |
| «Nada atraviesa ai_server por HTTP» | Cierto: `start.sh:419-421` pone `NEFAN_AI_SERVER` al fake; `grep TestClient ai_server/tests` → solo `/dev/status` y sprite-forge; ningún test toca `/generate_scene`. |
| «Falta un LLM falso para ai_server» | Cierto: `llm_client.py` tiene **dos** backends, MCP ws `:3737` (necesita terminal de Claude Code) y `ANTHROPIC_API_KEY` (`:92-110`). Sin variable `NEFAN_LLM_*` ni modo falso (`grep environ ai_server/*.py`). Lo que SÍ existe sin diseñar nada: el SDK `anthropic` 0.94 del `.venv` honra **`ANTHROPIC_BASE_URL`** (`_client.py:101,341`) y `_generate_scene_via_api` (`llm_client.py:455-493`) solo necesita un `tool_use` llamado `generate_scene`; y narrative-mcp es MCP por **stdio** (`server.ts:5`), así que un cliente MCP guionizado puede hacer de motor. ai_server arranca con fastapi+uvicorn+PIL+httpx (`main.py:18-42`); CI instala fastapi/pillow/httpx pero **no uvicorn** (`ci.yml:127`) — en CI la forma compatible es en proceso (`TestClient`). |
| «`clean_ent` es un dict local» | Cierto; irrelevante si la prueba va por HTTP. |

El criterio del issue **es alcanzable sin igualdad de salida**: es una aserción de eje 1 (dos campos sobreviven), no de igualdad. Rojo: quitar `role` de `ENTITY_FIELDS` en `narrative_schemas.py` → el NPC llega al cliente sin `role`. **No hacer**: replantear la asimetría del guion 40; comparar salidas saneadas; un preset nuevo si basta un guion headless (entra entonces en el subconjunto de CI de #357).

## #357 — la decisión que propongo

Medido: `qa/guiones/` **70**, ejecutables sueltos **23**, `qa/lib/` **11 módulos / 1.956 líneas** (`wc -l`); `ci.yml` y `mutation.yml` → **0** menciones de `qa/`. Importan `qa/lib` desde `nefan-core/test/`: **3** por `await import(join(repoRoot,"qa","lib",…))` (`esperas-de-qa:35`, `veredictos:21`, `presets-clasifica:47`) + `port-offset-paridad:54` (`offsetActual` de `stack.mjs`); `architecture.test.ts:890` es un string de fixture, no un import (la cifra «5» de `requisitos.md` es 4). El lcov trae 4 `SF:` de `qa/lib` pero `crap-score.ts:32` filtra `MEDIDOS = src/, bridge/, services/`: el banco no entra en el suelo.

1. **Dirección: test → banco, como hoy.** «El núcleo dependiendo del banco para medirse» es una frase: `src/` no importa `qa/`; lo hace `test/`, y un test puede importar lo que quiera. Se formaliza, no se invierte. **No** meter `qa/lib` en `mutation-targets.json` (perímetro = `core-puro-sin-node`; `.mjs` con `node:*`; el reloj ya rebosa: `scene-validate` 2510 s sobre `tope_lote` 1800, `npm run mutacion -- lotes` hoy) ni en `MEDIDOS` del CRAP (movería el suelo 89 % con margen 0,2, #388).
2. **Totalidad: sí, barata.** 4 de 11 módulos tienen test en core (esperas 291, veredictos 40, presets-clasifica 86, stack 111 líneas); los otros 7 conducen navegador/stack (sesion 533, saves 189, puertos 184, combate 153, sonda 138, fixtures 129, navegador 102) → exención escrita. Candado: un test que lista `qa/lib/*.mjs` y exige «importado por algún test o eximido con motivo» (el patrón `sin_mutar`). Rojo: añadir `qa/lib/nuevo.mjs`.
3. **CI corre el subconjunto headless.** 15 de 23 ejecutables no abren navegador (`grep puppeteer|chrome|CDP` = 0); de ellos 8 no levantan servicios: `bateria-`, `contrato-`, `esperas-`, `mutacion-candados-`, `mutacion-cableado-`, `mutacion-reparto-en-lotes` (**6,5 s**), `el-ledger-…` (**45 s**, spawnea unittest), `el-selector-ve-…`. De los 70 guiones, 19 declaran `sinMotor` pero solo 2 son headless de verdad (39, 40). **Prueba de que hace falta**: `node qa/mutacion-reparto-en-lotes.mjs --solo-vigentes` está **ROJO en `main` hoy** («lo que nadie cronometró va SOLO, uno por lote (hoy son 17)» — 1 de 9 invariantes vigentes roto). Nació el 04-09 (#438); hoy el planificador empaqueta 7 lotes sin ninguno «sin cronometrar»: la población que el candado daba por fija cambió con #440/#445 y nadie lo vio, porque nadie lo corre. Causa no investigada (no es mi trabajo); sí lo es decir que un candado en negativo **también envejece**, y por eso (2) sin (3) no basta.
Nota de honestidad resultante: «CI corre los candados headless de `qa/`; los 70 guiones de navegador siguen siendo corrida local».

## #231b — medido y clasificado

`ls test/*.test.ts` = **120**; `tsc --noEmit` con las flags de `tsconfig.json` (target ES2022, Node16, strict…) → **102 errores en 28 ficheros** (`requisitos.md` dice 96: es con `--lib ES2023`, que da 96 hoy). Serie: 59 → 66 → 75 → 77 → 89 → **102**. Por clase (contados a mano sobre la lista):

| Clase | n | Ejemplo | Lectura |
|---|---|---|---|
| `lib` (`findLast` + `any` derivado) | 6 | `bridge-map:289` | una línea de config |
| Unión discriminada sin estrechar | 16 | `NarrativeStatusMessage.spawn` ×13, `Rotulo.titulo` ×3 (`status-rotulo.ts:58` es unión a propósito) | higiene; el test acierta en runtime |
| Casts `Record<string,unknown>` sobre tipos que T7 acaba de dar al wire (#378) | 17 | `scene-normalize:160-475`, `NpcEnElWire` | higiene mecánica |
| Fixtures de volúmenes sin tipo (tuplas) | 17 | `fps-ambience` 7, `volume-metrics` 10 | higiene |
| Dobles/fixtures incompletos frente al contrato | ~25 | `NarrativeWorldState` parcial ×3, `EnemyPersonality` ×2, ctx de `vocabulary` ×2, `helpers.ts:149` | higiene, pero alguno tapa un campo obligatorio nuevo |
| Entradas adversariales mal tipadas | ~7 | `mundo-persistido:358` (`position:["x",0,2]`), `null` como string | higiene (`as unknown as`) |
| **Tests que mienten o usan formato muerto** | **~14** | `sessionStorage.write` ×8 (`bridge-session`): la interfaz **no tiene `write` a propósito** (`session-storage.ts:8-17`, #279) y el test entra por la puerta prohibida · `worldSnapshotPath(gamesDir, GAME, "tile")` ×2 (`game-gen:133,177`): el 3.er argumento es la **rama retirada** en v2 · dobles que devuelven `Promise<void>` donde el contrato es `SceneGenOutcome` ×2 (`bridge-tile:340`, `game-gen:267`) · `doors:[{side:"south"}]` (`volume-metrics:70`): `side` murió con #301, la puerta es `{at,edge,w}` · `player.inventory` inferido `never[]` (`narrative-state:209`): agujero de tipo en **src** | el gate encuentra trabajo |

Veredicto: **86 % higiene, 14 % tests que mienten**; es «higiene con premio», no lo contrario. **Entra en T11 como PR propia y primera**: es independiente, crece ~+3/día, y si aterriza antes, las otras tres PR de la tanda nacen con el gate. **No a T12**: nada de #359 (API pública del core hacia el cliente) la necesita ni la toca; T12 queda con #359 solo.

## Conflictos

- **T12 (#359 + #231)**: solo de cartera — #231 sale de T12. Sin solapamiento de código (#359 es `src/index.ts` + 36 imports de `nefan-html`).
- **#241** (harness del cliente): la decisión (1)-(2) de #357 es el **precedente** que #241 heredará (test → banco, totalidad por exención). Decirlo en el cierre, no hacerlo aquí.
- **#388**: suelo 89 %, ruido 0,1 — por eso `qa/lib` NO entra en `MEDIDOS`. Las PR de #302/#235 solo añaden tests: sin riesgo.
- **#358/#346**: cero contacto (cliente). #231b toca solo `nefan-core/test/`.
- **«La mutación no frena»**: ninguna PR añade módulo al núcleo puro (`world-snapshot.ts` importa `node:fs`; ai_server es Python; `qa/lib` es `.mjs`). #231b toca 28 baterías → `afectado` seleccionará muchos módulos; ningún `break` cambia. Coste en mutantes nuevos: **0**.
- **#405** (plan: «va a T11 o a programa») no está en `requisitos.md`: queda fuera, sin conflicto.

## Coste contra valor · orden · qué NO hacer

| PR | Contenido | Coste | Si no se hiciera nunca |
|---|---|---|---|
| **0** #231b | `tsconfig.tests.json` + paso CI/verify; arreglar 102 (sin `as any`/baseline); cabecera de `tsconfig.scripts.json` | 28 ficheros, mecánico salvo 14 | la deuda sigue a +3/día y 8 tests seguirán entrando por una puerta que #279 cerró |
| **1** #302 | jugabilidad en la carga + test con artefacto sintético; barrido de prosa | pequeño | un snapshot con NPC atascado se replayea; síntoma «huida rota» (#262) |
| **2** #235 | corrida headless bridge → ai_server HTTP → bridge sin créditos; negativo quitando `role` | medio (stub del modelo o cliente MCP: decide el arquitecto) | la junta de #173 sigue sin testigo; el episodio del fake demuestra que muerde |
| **3** #357 | candado de totalidad `qa/lib`; job CI «candados headless» (incluye el guion de PR-2); atender el rojo de `mutacion-reparto-en-lotes` | pequeño-medio | los candados envejecen sin que nadie lo vea (ya pasa) |

0 ∥ 1 ∥ 2 en paralelo; 3 detrás de 2. **No**: igualdad estricta de salida saneada; `qa/lib` en mutación o CRAP; subir `tope_lote`; un test que recorra `data/games/*/world` (verde vacío); regenerar los 4 tiles con el motor real como parte de la tanda; baseline de errores en `test/`.

## El día después — prosa que quedaría citando lo retirado

`tsconfig.scripts.json:11-13` («tanda del bosque», caducó en #288) · `world-snapshot.ts:47` («rechaza los 20 tiles del árbol») y `scene-fixtures.test.ts:149,154` («20 de 20», «los 20»: hoy son 4/20 y son basura de banco) · `docs/arquitectura/ia-servicios.md:121` («invalidado por `world_doc_hash`»: incompleto desde #324, y más si entra la jugabilidad) · `esperas-de-qa.test.ts:4-11`, `veredictos.test.ts:11`, `presets-clasifica.test.ts:14` («el CI no corre `qa/`»: falso el día que corra los candados) · `CLAUDE.md` tabla «Lo que ya NO se comprueba leyendo» gana una fila · cuerpo de #302 (`vocabulary.ts:67,93`, «20 tiles») → texto de cierre. `grep` a cero de «20 tiles|los 20|tanda del bosque» en esos ficheros al cerrar.

## Qué le cambiaría a `requisitos.md` (pegar tal cual)

- **#302 / Vivo**: sustituir el párrafo por: «La carga del snapshot (`replayWorldSnapshot`, `session.ts:510-519`) no pasa por `validateScene`; lo estructural ya lo rechaza `ExpandedSceneSchema .strict()` en `loadWorldSnapshot` (#324, #409) y los 4 tiles locales miden `stale` hoy. El «tile del 28-08» lo escribió el bridge alimentado por el motor falso (`fake-scenes.ts` en `0712349`) con el gate de escritura en `z.unknown()`: no hay tercera vía. Los 4 tiles son residuo de banco.»
- **#302 / Criterio**: «Un snapshot que pasa el schema pero no `validateScene` (artefacto sintético, patrón `aDisco` de `world-snapshot.test.ts`) no se sirve como `ready`; quitar la comprobación pone el test rojo. Pedir permiso para borrar los 4 tiles locales.»
- **#235 / Criterio**: añadir «headless y en proceso si va a CI (CI no instala uvicorn); el rojo es quitar `role` de `ENTITY_FIELDS`».
- **#357**: sustituir las tres preguntas por la decisión de arriba (1)-(3) y añadir «`mutacion-reparto-en-lotes.mjs` está rojo en `main` el 05-09: atenderlo en la PR».
- **#231b**: «Entra como PR-0. 102 errores / 28 ficheros con las flags del build; 14 son tests que mienten (`write` ×8, rama retirada ×2, dobles `void` ×2, `side`, `never[]`).» Corregir «5 tests importan `qa/lib`» → 4.

## Resumen de una pantalla

- **#302 REENCUADRADA (menor)**: lo estructural está hecho y medido (4/4 `stale`, 0/20); queda que la carga pase por `validateScene`. El misterio del 28-08 está resuelto: motor falso + gate `z.unknown()`, escritor único.
- **#235 VIGENTE**: sin LLM falso para ai_server; existen `ANTHROPIC_BASE_URL` y el MCP por stdio como palancas; el criterio es de campo, no de igualdad.
- **#357 VIGENTE — decisión**: test → banco (formalizado), totalidad de `qa/lib` por test-o-exención, CI corre los 8 candados headless (~1 min salvo el ledger, 45 s). Evidencia: un candado de ayer está rojo en `main` y nadie lo sabía.
- **#231b ENTRA** como PR-0 independiente; T12 se queda con #359.
- **Necesita visto bueno del usuario**: (a) #231b dentro de T11 y fuera de T12; (b) que CI empiece a correr candados de `qa/` (cambia la nota de honestidad y `CLAUDE.md`); (c) borrar los 4 `tile.json` locales (material de sesión, aunque sea basura de banco); (d) aceptar el reencuadre de #302 a «jugabilidad en la carga» en vez de «validador en la clave».
