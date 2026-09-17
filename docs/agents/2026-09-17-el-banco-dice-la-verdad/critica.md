# Crítica — Tanda H «El banco dice la verdad sobre sí mismo»

**VEREDICTO DE LA TANDA: REENCUADRADA.** La familia es la correcta y **ningún issue obliga a editar `nefan-core/src/**`** (verificado fichero a fichero): la corrida `35217880491` —`in_progress` sobre `cf2c13f2`, comprobado por API— no corre peligro. Pero dos de los cuatro describen mal su propio defecto, y #633 ofrece tres salidas de las que **dos serían un error**.

| Issue | Veredicto | El problema real, en una frase |
|---|---|---|
| **#633** | **REENCUADRADA** | No es que un exento envejeciera: **el 39 prohíbe un acto que no gasta** |
| **#644** | **REENCUADRADA** | El 91 no controla el ORIGEN de su consulta; no «mueve al sujeto» |
| **#645** | **VIGENTE**, alcance ampliado | La totalidad vive en prosa, y la prosa **ya es falsa** |
| **#639** | **VIGENTE**, es una línea | El 141 no sabe decir «me falta material» ni que no midió nada |
| **#634** | **PREMATURA — no entra** | Su única salida real edita `src/protocol/escena-servida.ts` |
| **#606** | **EN CONFLICTO con el cierre — no entra** | No sale gratis con #645 y obliga a re-correr la batería |

## #633 — la premisa está ROTA, y lleva rota desde que nació el 39

- «el 116 pulsa `#ts-start`/`#ts-continue`» → **a medias**: solo `#ts-continue` (116:107, 116:118). · «y no se trae su motor» → cierto, y **no lo necesita**.
- «los dos botones **que arrancan la partida**» (docblock del 39) → **FALSO**. `#ts-continue` es «Continuar →» del selector (`selector-de-mundo.ts:167`) y su handler hace UNA cosa: `deps.ir({a:"editor"})` (`:344-365`). El que arranca es `#ts-start` (`editor-de-personaje.ts:151`).
- «la lista ha envejecido» → **FALSO**. `git show ff696eea:…/title-screen.ts`: el día que se escribió el 39 (2026-08-29) el handler ya era `renderCharacterEditor(...)`. **Nunca** arrancó partida.
- «abrir el editor gasta» → no: `editor-de-personaje.ts:76` solo hace `fetch("/sprites/index.json")`, el censo local del dev server. **El arreglo no gasta un crédito por ningún camino.**

Censo offline del 39 (sin navegador ni stack, cero créditos): **143 guiones, 35 exentos**. Solo DOS exentos pulsan uno de los dos botones: el **20** (con su motor) y el **116** (solo `#ts-continue`). Y **cinco guiones NO exentos** pulsan solo `#ts-continue` sin motor propio (47, 94, 96, 107, 116), porque ir al editor no gasta.

> Es la lección de la casa **al revés**: primer caso de un candado que **afirma MÁS de lo que sujeta**. Prohíbe un click inocuo. Por eso dos de tus tres salidas son un error: que el 116 «traiga su motor» es ceremonia para un click que no gasta, y sacarlo de los exentos lo mete en el gate de gasto por un recorrido que no toca al motor.

## #644 — real, pero mal descrito en las dos mitades

- «`probeCollide` **arrastra la posición del jugador**» → **FALSO**. `collision.ts:99-105`: `collidesAt` LEE `deps.getPlayerPos()` como origen y no escribe nada; `nefan-hook.ts:125` es passthrough. Hay **dependencia** de un dato vivo, no mutación — así que «restaurar la posición entre muestras» sería un **no-op**.
- «el 134 se defiende con un mirador» → cierto, y su cabecera (134:43-52) ya tiene el porqué general: `collidesAt` es consulta de MOVIMIENTO y contesta siempre «no» por donde uno ya está (#538).
- «lo usan más guiones (81, 134, fixtures-…, …-agua, 144)» → **corregido en LAS DOS direcciones**: 27 ficheros consultan `probeCollide`, **13 no aparcan al jugador** y de esos **6 BARREN**: `91`, `118`, `128`, `14`, `32`, `73`. De los que nombra el issue, **134 y 144 SÍ aparcan** y **81 no barre**. Tanda F tuvo tres compartiendo el punto ciego; aquí son seis, y cinco no tienen issue.

**Alcance (tu pregunta 2)**: una consulta de PUNTO **no existe hoy** en el hook (`:125` y `:257` son el mismo `collidesAt`), pero **construirla no toca `nefan-core/src/**`**: las dos mitades ya están exportadas — `penetracionEnSolido(x,z,radio,suelo)` (`salida-del-solido.ts:183`) y `penetracionEnCaja(p,caja,radio)` (`obstaculos-del-jugador.ts:135`), ambas sin origen.

## #645 — VIGENTE, y mayor de lo que dice

Tus números son exactos: **39 en `qa/*.mjs`, 18 en el job, 21 fuera**. Los 21, clasificados:

- **7 abren navegador** (importan `playwright-core`/`abrirNavegador`): `captura-de-fixture`, `capturar-portadas`, `fixtures-las-tres-se-caminan`, `fixtures-sin-bridge`, `guardarrail-sin-creditos`, `las-fixtures-solo-chocan-con-el-agua`, `presupuesto-de-volumenes`.
- **4 spawnean `qa/run.mjs`** (preset + Chromium): `bajo-carga`, `bateria-…`, `dos-corridas`, `esperas-…`. · **1 es el runner mismo**, que no es un candado: `run.mjs`.
- **9 headless con EXENCIÓN REAL**: `no-mata-lo-ajeno`, `parar-clasifica-los-nueve-puertos`, `presets` (arrancan `start.sh` entero), `sprites-sin-servicio` y `perfil-de-repintado-en-la-clave` (sprite-forge, otro repo), `el-arte-…` y `el-indice-…` (asset-store), `fake-enruta-por-pathname` (arte generado, gitignored), `comparar-el-criterio-en-negativo` (necesita `reports/mutation-base/`).

La prosa del yml solo nombra **4** de esos 9. Y **ya es falsa**: dice «los **tres** que levantan asset-store o sprite-forge» y son **cuatro** — `sprites-sin-servicio.mjs:300` arranca `bin/sprite-forge.mjs serve`. Nadie lo vio: el issue se demuestra a sí mismo. De «los que nadie añadió» quedan **cero** — los 9 tienen motivo real, cinco sin escribir, así que el candado nace prometiendo lo que puede cumplir, que era tu duda. Peaje: `interpretePython` lo usan 3, dos ya en el job.

## #639 — VIGENTE, con un segundo defecto que el issue no ve

`⊘` **ya existe**: `ctx.sinMedir` (`run.mjs:933`) y `ctx.sinMedirBloque` (`:955`). **Nada que decidir sobre `run.mjs`: es una línea en el 141.** Lo que el issue no dice: si `labs/narrative/runs/` existe pero está **VACÍO**, el `for` de `141:14` no entra y el guion sale **VERDE con cero asertos** — `run.mjs` no comprueba en ningún sitio que un guion haya afirmado algo. El arreglo debe cubrir *ausente* **y** *vacío*, o cambia un `ENOENT` honesto por un verde mudo. (Hoy hay **8** grabaciones, no cinco.)

## El día después

- El jugador no ve nada: deuda de instrumento declarada, y está bien que lo sea.
- **Puerta que se cierra**: al estrechar el 39 a `#ts-start`, un exento que en el futuro gastara *desde el editor* deja de estar vigilado por ahí. El residuo es el que el propio 39 ya declara.
- **Lo que nadie borrará**: la frase del docblock del 39 sobre «los dos botones», y las seis categorías en prosa del yml si #645 entra y la prosa se queda. Dos listas divergen: molde de #634.
- **Lo que la tanda NO cubre**: el 39 no abre navegador (solo lee ficheros) pero vive en `qa/guiones/`, fuera del censo de #645 por construcción — y es justo el rojo que nadie corría.

## Conflictos

- **#634**: su (a) edita `src/protocol/escena-servida.ts` (`tile-store.ts:20,99` → `huellaDeEscena`), módulo con suelo 100 — bloqueada por la corrida. Su (b) **no se abarata con #639** y hoy es inexpresable: el 75 declararía ⊘ *después* de fallar, y `run.mjs:1266`/`:1320` lo mantienen ROJO a propósito («un ⊘ es una declaración, no una amnistía»). Su (c) **es el statu quo**: el issue abierto ya ES el sitio donde anotar. Decisión del usuario, después de repartir.
- **#606**: el hecho está confirmado (6 copias de `esperarFrames`, 22 llamadas) y su justificación es HOY más fuerte de lo que dice —`reloj()` ya está en el hook (`nefan-hook.ts:262`) y lo usan 6 guiones y 2 módulos de `qa/lib/`—, pero comparte *molde*, no artefacto: toca `qa/lib/` (ya candado por `banco-medido.json`) **y seis guiones de navegador**, o sea re-correr la batería para probarlo.
- **#643 y #646: tus dos razones son CIERTAS.** #643 nombra `salida-del-solido.ts` y pide unificar la penetración entre fuentes: no hay versión que no edite el módulo que la corrida estrena. #646 declara él mismo depender de #618, aparcado ayer. No las reabro.

## Coste contra valor

**#633**: dos líneas y su negativo; sin él la batería nunca llega a verde y el rojo se aprende a ignorar — lo mejor de la tanda. · **#645**: lo caro no es el candado (el molde está dos veces en la casa), son **las cinco exenciones que hay que escribir**; ahí está el valor. · **#639**: una línea más el caso vacío; sin ella ningún worktree nuevo corre la batería entera. · **#644**: el más caro y el único que puede rebotar; «no hacer nada» es defendible para los otros cinco barridos, pero no para el 91, que hoy da verde y rojo con el mismo código.

## Qué le cambiaría a `requisitos.md`

1. **#633** — las tres salidas → «**La decisión la toma el código**: el 116 es exento legítimo y `#ts-continue` nunca arrancó una partida (`selector-de-mundo.ts:344`; `git show ff696eea`). Se estrecha la regla del 39 a `#ts-start` y **no se toca el 116**. Negativo obligatorio: un guion de pega exento que pulse `#ts-start` sin `NEFAN_AI_SERVER` sale rojo, y otro que pulse solo `#ts-continue`, verde.»
2. **#644** — «arrastra la posición» → «**depende** de la posición viva: `collidesAt` (`collision.ts:99`) no muta nada, así que “restaurar entre muestras” no arreglaría nada». Lista → «**27 consultan `probeCollide`; 13 no aparcan; 6 barren sin controlar el origen: 91, 118, 128, 14, 32, 73**; el 134 y el 144 sí aparcan, el 81 no barre». Añadir que la consulta de punto **no toca `nefan-core/src/**`** y que el mirador del 134 no necesita superficie nueva: lo elige el arquitecto y lo escribe.
3. **#645** — «al menos tres clases» → **7 navegador + 4 que spawnean `run.mjs` + `run.mjs` + 9 con exención real**, de los cuales solo 4 tienen motivo escrito; y «la prosa dice *los tres que levantan asset-store o sprite-forge* y son **cuatro** — `sprites-sin-servicio.mjs:300`».
4. **#639** — al criterio de cierre: «y con `labs/narrative/runs/` **presente pero vacío** también sale `⊘`, no verde: hoy el bucle no entra y el guion no afirma nada».
5. **Retirar #634 y #606**; el punto 2 → «#634 no se abarata con #639 —`ctx.sinMedir` ya existe y `run.mjs:1320` prohíbe el ⊘ como amnistía— y su (a) edita `src/protocol/escena-servida.ts`: **se decide tras repartir la corrida**.»

**Alcance recomendado: #633 (reencuadrado) + #639 + #645, y #644 con su mecanismo corregido.** Si hay que soltar uno, es **#644**: el único cuyo arreglo puede rebotar y cuyo censo real —seis barridos— no cabe en una tanda con otros tres.
