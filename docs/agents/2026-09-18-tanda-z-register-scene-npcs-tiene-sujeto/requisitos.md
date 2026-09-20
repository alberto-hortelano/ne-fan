## La petición, literal

El usuario, el 2026-09-18 (sesión nueva, `main` = `a25d8c2f`):

> «Mira los issues que hay en github y ve cerrandolos, si tienes alguna duda dejala apuntada para
> mas tarde y trabaja de forma autonoma con la estructura de agentes definida.»

Sigue en pie el mandato del 2026-09-17: «ve cerrando sin parar, si tienes bloqueo en alguno lo
apuntas pero sigue hasta reducir el numero al minimo».

Decisión del coordinador para esta jornada: **ciclo completo con fase de QA** (crítico → arquitecto →
ingeniero → QA), porque QA es quien lleva nueve tandas cazando los candados que cubren menos de lo
que prometen. El usuario no está mirando en tiempo real: las dudas se APUNTAN (en `requisitos.md`,
sección «Preguntas abiertas», con la suposición que se toma) y se sigue.

## Estado medido al abrir

- `main` = `a25d8c2f`, árbol limpio, un solo worktree, máquina en reposo (load 0,2).
- Backlog: **37 abiertos = 25 núcleo + 12 `futuro`**. Esta jornada abre 14 tandas EN PARALELO
  (S…AF) sobre los 19 issues de núcleo no bloqueados; las otras tandas tocan OTROS ficheros, pero
  dos pueden rozarse en `qa/README.md`, en `qa/run.mjs` y en la numeración de guiones (#680: el
  número de guion se elige al fusionar, no al escribir; hasta que la tanda U cande el prefijo
  único, un guion nuevo lleva el número que le toque en `main` EN EL MOMENTO DE FUSIONAR).
- Batería de navegador: NO medida hoy al abrir. Última conocida: 145 verde · 0 rojo · 1 ⊘ de 146
  sobre `900b5b71` (ayer por la mañana); desde entonces entraron los guiones 148 y 149. Quien
  toque `qa/` mide lo que toca, aislado y en par (tres corridas de cada) antes de la completa.
- Las dos últimas corridas de mutación (`35317748262` y `35354800866`) salen COMPLETAS con 0
  nuevos y **dos suelos rotos conocidos** (#675 `npc-director` 75,33 % < 81; #676
  `state-http-dispatch` 99,28 % < 100): el gate de mutación está en rojo por eso y no distingue
  un rojo nuevo. La tanda T los cierra.

## Restricciones de la casa que aplican a TODAS las tandas

- Cero créditos: motor falso, presets `e2e-sin-creditos` y `html-fixtures`. Nada que llame a
  Imagen IA ni al motor real.
- Nunca `--parar-todo`, nunca `pkill`, nunca matar por puerto: hay otros agentes en la máquina.
  Solo `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` desde el propio worktree. **Gotcha vivo (#684)**:
  con offset ≥ 1000 `--parar` MIENTE («nada que parar aquí» con el stack en pie); por eso hoy los
  offsets se reparten entre 100 y 900. Si te toca uno ≥ 1000, para por PID demostrando propiedad
  con `/proc/<pid>/cwd`.
- Ningún umbral se baja, y ninguno se sube para acomodar lo que acaba de crecer.
- Pre-producción: cero compatibilidad hacia atrás. Lo que se retira, se retira entero el mismo
  día (`grep` a cero en prosa, comentarios y docs).
- Un candado nuevo se prueba EN NEGATIVO (se reintroduce el defecto y se ve el rojo) y se declara
  por escrito lo que NO cubre. Un candado headless nuevo entra en `candados-headless` el día que nace.
- El worktree se monta con la receta de `docs/agents/README.md` (los cuatro `npm ci`, el build de
  `nefan-core`, las hojas de sprites). El fichero de salida de una corrida larga lleva el nombre
  del worktree.
- Cada afirmación factual del issue se VERIFICA contra el árbol antes de usarse como requisito:
  los cuerpos citan `fichero:línea` que caducan en horas.
- No se commitea en `main` ni se fusiona nada sin que el coordinador lo pida; el ingeniero trabaja
  en su rama y commitea en ella.

# Tanda Z — «`registerSceneNpcs` tiene sujeto» (#431)

## El issue

#431: `registerSceneNpcs` (`nefan-core/src/narrative/npc-records.ts:14`) es CRAP 68,5
(complejidad 44, cobertura 77 %), el peor de la casa y a 4,5 puntos del tope 73; ningún test tiene
`npc-records.ts` por sujeto (la cobertura viene de rebote desde `narrative-state.test.ts`). Excluido de
la totalidad de mutación con `!ruta`. Absorbe #468: el bloque «Legacy scenes: `npcs[]`» es inalcanzable
(los dos schemas son `.strict()` y ninguno admite `npcs` en raíz); criterio: `grep -n "npcs"` → 0 fuera
de las entities. La tarea es que la función esté PROBADA; bajar el CRAP es consecuencia.

## Criterios de aceptación

1. `test/npc-records.test.ts` que ejerza registro, reemplazo y purga a propósito, con casos que
   se pondrían rojos si la función hiciera otra cosa (no cobertura de paso).
2. El bloque legacy `npcs[]` borrado entero; `grep -n "npcs"` sobre el fichero → 0 fuera de entities.
3. `npc-records.ts` sale de la exclusión `!ruta` y entra en un módulo de `mutation-targets.json`
   medible; si el módulo cabe en `tope_local`, medido en local con sus supervivientes muertos; si no,
   pedido. `npm run ejercicio` demuestra que la batería lo INVOCA.
4. CRAP de la función por debajo del que tiene hoy (68,5), medido con `npm run crap`, sin que
   ninguna otra suba por encima de su tope. Si al trocearla aparece una estructura más clara, se
   hace (la complejidad 44 es síntoma).

## Fuera de alcance

- Tocar `narrative-state.ts` y `session-storage.ts` (#224/#430, tanda AA).

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

Aceptado sin consultar: encoge la tarea (la premisa «sin sujeto» caducó con #621; el bloque legacy es exactamente lo no cubierto). Sustituye lo que nombra:


**Sustituir «El issue» por:** #431 cita CRAP 59 y «ningún test lo importa»; hoy es 68,5 (medido, lcov 16-09 posterior a #621) y `test/narrative-state.test.ts:5` lo importa directamente con dos `it` de registro y reemplazo; `test/narrative-tiles.test.ts:116-187` asierta purga, mover (Nogala) y aviso de gemelo por `recordSceneLoaded`. Lo que falta no es el sujeto: es la MEDIDA (excluido con motivo caducado) y el bloque muerto `npc-records.ts:76-102`, que es exactamente el 23 % sin cubrir de la función.

**Criterios de aceptación (sustituyen a los cuatro):**
1. Bloque «Legacy scenes: `npcs[]`» (`npc-records.ts:76-102`) borrado, y la prosa con él: `grep -n "sceneData.npcs\|legacy\|Legacy" src/narrative/npc-records.ts` → 0. (No se renombra el acumulador `npcs` de `:31`: el criterio anterior lo confundía con el bloque.)
2. `npc-records.ts` sale del `!ruta` de `serialize-llm` y entra en módulo propio de `mutation-targets.json` con batería derivada del árbol: `narrative-state.test.ts` (import directo; lo exige `mutation-config.test.ts`) y `narrative-tiles.test.ts` (alcanza por cierre y es quien ejerce purga y mover). `break: "sin medir"`. El motivo (3) del `porque` de `serialize-llm` se borra y la cuenta «cuatro exclusiones» pasa a tres. `npm run ejercicio` demuestra invocación.
3. La primera medida se PIDE (`npm run mutacion -- pendiente` la lista) y no se espera: `local` se niega por coste desconocido. No se escribe ningún test nuevo por decreto: los asertos nuevos, si hacen falta, salen de los supervivientes que traiga la corrida, con su dueño. Mover el `describe` de `narrative-state.test.ts:15-63` a un `test/npc-records.test.ts` es una MUDANZA (misma cobertura, batería de `narrative-state.ts` una pizca más ligera para #430) y se decide en el plan, no aquí.
4. `npm run crap`: `registerSceneNpcs` por debajo de 68,5 sin que ninguna otra suba sobre su tope; se espera ≈ cx tras el borrado (cobertura 100 % de lo vivo). Trocear la función es decisión del arquitecto, no requisito.
5. Barrido: la nota `crap` de `quality-thresholds.json` deja de nombrar a #431 como «el sujeto que falta» y dice la medida nueva.

**Añadir a «Fuera de alcance»:** repetir en un fichero nuevo los asertos de registro/purga/mover que ya viven en `narrative-state.test.ts` y `narrative-tiles.test.ts`.

**Preguntas abiertas (suposición tomada):** ninguna que bloquee. Aviso para el coordinador: AA y Z editan el mismo string `porque` de `serialize-llm`; el segundo en fusionar rebasa a mano.

Aviso de conflicto: la tanda AA (#224) edita el mismo string JSON (el porque de serialize-llm); quien fusione segundo rebasa a mano.

## Decisión del coordinador tras el plan (2026-09-18)
Opción A adoptada. `crap.max` NO se aprieta en esta PR (issue para después de la fusión de la jornada).
