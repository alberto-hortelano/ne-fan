# Crítica — Tanda Z, «`registerSceneNpcs` tiene sujeto» (#431, absorbe #468)

**Veredicto: REENCUADRADA.** El problema es real y pequeño; la tarea lo describe con una premisa que caducó el 16-09 (#621) y con dos criterios que hoy no se pueden cumplir tal como están escritos (uno pide una medida local que `permisoLocal` rechaza por diseño; otro mide una grafía que obliga a renombrar una variable sana).

## El problema real, en una frase

`npc-records.ts` está fuera de la medida de mutación con un motivo que ya no es verdad, y arrastra 27 líneas muertas que son TODA la cobertura que le falta a la peor función de la casa.

## La premisa, afirmación por afirmación

| Afirmación de `requisitos.md` / #431 | Verificación |
|---|---|
| CRAP 68,5 (cx 44, cob 77 %) | **Cierto hoy.** `npm run crap` (1,4 s, lee `coverage/lcov.info` del 16-09 17:03) → `68.5 44 77% registerSceneNpcs · npc-records.ts:14`; tope 73, 0 por encima. El lcov es posterior a #621 (16:42) y desde entonces no cambió ni `npc-records.ts` ni `narrative-state.test.ts` (solo `tile.ts` en 78b01dcf). El cuerpo del issue (59/48/83 %) es de otra medida; los requisitos ya traen la de hoy |
| «Ningún test tiene `npc-records.ts` por sujeto; la cobertura viene de rebote» | **Falso desde 59a3d765 (#621).** `test/narrative-state.test.ts:5` importa `registerSceneNpcs` DIRECTAMENTE y `:15-63` es un `describe("registro directo de NPCs Format D")` con dos `it`: 10 rechazos con `deepEqual(s.entities, antes)`, filtro solo-npc, extras (`role/description/style_ref/behavior`), footprint 2×2, y re-registro que conserva posición y actualiza nombre. Además `test/narrative-tiles.test.ts:116-124` asierta la PURGA («viejo» desaparece, «aldeana» sigue una), `:127-166` el MOVER por `firstRegistration` (Nogala: `scene_id`, posición en metros globales, `inventory` conservado, re-broadcast no teletransporta) y `:168-187` el aviso de gemelo — todo por la puerta real, `recordSceneLoaded` |
| «`testsQueImportan` da 0» (motivo 3 del `porque` de `serialize-llm`, `mutation-targets.json:990`) | **Caducado**: `importsResueltos` es de imports directos (`scripts/mutation-plan.ts:521-528`) y hoy `narrative-state.test.ts` importa el fichero. El motivo escrito ya no describe el árbol |
| El bloque legacy `npcs[]` sigue ahí e inalcanzable | **Cierto.** `npc-records.ts:76-102`. `recordSceneLoaded` (`narrative-state.ts:766`) pasa `ExpandedSceneSchema.safeParse` `.strict()` (`scene-schema.ts:359`) ANTES de llamar (`:801`), y es el único llamante de producción; `grep npcs scene-schema.ts` → solo comentarios. Y el lcov lo confirma: **las líneas sin cubrir del fichero son 1-6 (docblock) y 79-102 — exactamente el bloque muerto**. Todo lo vivo está cubierto |
| Excluido con `!ruta` en `mutation-targets.json` | Cierto: `:983`, módulo `serialize-llm`, junto a `narrative-state.ts`, `session-storage.ts` y `types.ts`; 0 apariciones en `mutacion-huella.json` |
| «Si el módulo cabe en `tope_local`, medido en local» | **Imposible para un módulo nuevo**: `permisoLocal rechaza el coste desconocido` (`scripts/mutacion.ts:1410`, `mutation-plan.ts:43-49`); precedentes `salida-del-solido` (17-09) y `dueno-del-sim` (hoy). Nace con `break: "sin medir"` y su primera medida es corrida autorizada |
| Criterio «`grep -n "npcs"` → 0 fuera de entities» | **Mide grafía, no el bloque**: `npc-records.ts:31` es `const npcs: Array<…>` (el acumulador vivo) y `:108`, `:113` lo usan. Cumplirlo literal obliga a renombrar una variable sana o a declararlo incumplido con el bloque ya borrado |

## El día después

- **Para quien juega: nada.** Deuda declarada de medida; se dice.
- Borrar 76-102 deja la función con cobertura 100 % de sus líneas vivas → CRAP = cx ≈ 28 (se van ~16 condiciones del bloque). **El criterio 4 se cumple con el criterio 2 solo**; trocear no hace falta para el número.
- Lo que hay que barrer y nadie barrerá si no consta: el docblock `npc-records.ts:3-5` («parsing dual … escenas legacy (npcs[] con position)») y `:152` («Format D o legacy»); el motivo (3) del `porque` de `serialize-llm` («LAS CUATRO EXCLUSIONES» pasan a tres); la nota `crap` de `quality-thresholds.json` que nombra a #431 como «el sujeto que falta».
- Lo que se vuelve arbitrario en un mes: un `test/npc-records.test.ts` que REPITA registro/purga/mover cuando ya viven en dos ficheros. Tres copias del mismo aserto son tres sitios que envejecen.
- `mundo-persistido.ts:103-110, 313` apoyan un candado en que `registerSceneNpcs` mete a TODO npc en el ledger: la política no se toca, sigue cierto.

## Conflictos

- **Solapamiento textual con la tanda AA (#224/#430)**: las dos editan el mismo valor JSON, el `porque` de `serialize-llm` (`mutation-targets.json:990`, exclusiones 2 y 3 en un solo string). Quien fusione segundo rebasa a mano ese string; no hay orden mejor, solo avisarlo. AA no toca `npc-records.ts` ni sus tests.
- Tanda AC (#605) trocea `scripts/mutacion.ts`; esta tanda no toca `scripts/`. Su criterio 4 puede añadir entradas a `mutation-targets.json` en otra región: roce de merge, no de fondo.
- #430 no bloquea: la batería del módulo nuevo es `narrative-state.test.ts` + `narrative-tiles.test.ts` (la primera por import directo, obligatoria por `test/mutation-config.test.ts:462-478`; la segunda porque alcanza el fichero por cierre y es la que ejerce purga y mover). Con `tap-runner` cada mutante paga solo los ficheros que lo cubren.
- Sin contradicción con `arch-rules.json` ni con el `git log` reciente.

## Coste contra valor

Coste: borrar 27 líneas, una entrada de módulo, tres barridos de prosa, pedir una corrida. Una tarde corta. Valor: la peor función de la casa deja de serlo por la vía honesta (menos código, no más test), el margen del tope 73 pasa de 4,5 a ~45 puntos, y un fichero del núcleo narrativo entra en la medida que hoy tiene un motivo falso escrito. **No hacer nada** deja un motivo caducado en un contrato que presume de motivos verificados y un bloque muerto que #468 ya cerró «a cargo de #431»: barato de hacer, incómodo de no hacer.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

**Sustituir «El issue» por:** #431 cita CRAP 59 y «ningún test lo importa»; hoy es 68,5 (medido, lcov 16-09 posterior a #621) y `test/narrative-state.test.ts:5` lo importa directamente con dos `it` de registro y reemplazo; `test/narrative-tiles.test.ts:116-187` asierta purga, mover (Nogala) y aviso de gemelo por `recordSceneLoaded`. Lo que falta no es el sujeto: es la MEDIDA (excluido con motivo caducado) y el bloque muerto `npc-records.ts:76-102`, que es exactamente el 23 % sin cubrir de la función.

**Criterios de aceptación (sustituyen a los cuatro):**
1. Bloque «Legacy scenes: `npcs[]`» (`npc-records.ts:76-102`) borrado, y la prosa con él: `grep -n "sceneData.npcs\|legacy\|Legacy" src/narrative/npc-records.ts` → 0. (No se renombra el acumulador `npcs` de `:31`: el criterio anterior lo confundía con el bloque.)
2. `npc-records.ts` sale del `!ruta` de `serialize-llm` y entra en módulo propio de `mutation-targets.json` con batería derivada del árbol: `narrative-state.test.ts` (import directo; lo exige `mutation-config.test.ts`) y `narrative-tiles.test.ts` (alcanza por cierre y es quien ejerce purga y mover). `break: "sin medir"`. El motivo (3) del `porque` de `serialize-llm` se borra y la cuenta «cuatro exclusiones» pasa a tres. `npm run ejercicio` demuestra invocación.
3. La primera medida se PIDE (`npm run mutacion -- pendiente` la lista) y no se espera: `local` se niega por coste desconocido. No se escribe ningún test nuevo por decreto: los asertos nuevos, si hacen falta, salen de los supervivientes que traiga la corrida, con su dueño. Mover el `describe` de `narrative-state.test.ts:15-63` a un `test/npc-records.test.ts` es una MUDANZA (misma cobertura, batería de `narrative-state.ts` una pizca más ligera para #430) y se decide en el plan, no aquí.
4. `npm run crap`: `registerSceneNpcs` por debajo de 68,5 sin que ninguna otra suba sobre su tope; se espera ≈ cx tras el borrado (cobertura 100 % de lo vivo). Trocear la función es decisión del arquitecto, no requisito.
5. Barrido: la nota `crap` de `quality-thresholds.json` deja de nombrar a #431 como «el sujeto que falta» y dice la medida nueva.

**Añadir a «Fuera de alcance»:** repetir en un fichero nuevo los asertos de registro/purga/mover que ya viven en `narrative-state.test.ts` y `narrative-tiles.test.ts`.

**Preguntas abiertas (suposición tomada):** ninguna que bloquee. Aviso para el coordinador: AA y Z editan el mismo string `porque` de `serialize-llm`; el segundo en fusionar rebasa a mano.
