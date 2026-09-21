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

# Tanda W — «La magnitud se decide en un módulo medido y se mide con el reloj que es» (#682 + #679)

## Los issues

- **#682**: la parte pura de `ctx.expectMagnitud` vive en `qa/run.mjs`, que ningún test importa
  (llama a `main()` al cargar). Cuatro asertos se sabotean en verde (H-6 pata redundante de la
  razón, H-7 `razonesRojas` calculado y tirado, H-8 fail-loud sin candado, H-9 `if (!ok)`
  invertible). Arreglo: sacarla a `qa/lib/` con test, como se hizo con `veredictoDeGuion`.
  Aviso: el candado de #609 lee el AST de `run.mjs` para el cable `magnitudes: ctx.magnitudes`;
  al mover la lógica tiene que seguir mirando el sitio correcto.
- **#679**: `medirVelocidad` del guion 93 divide camino de SIMULACIÓN por timestamps de `rAF`
  (PARED); a `--factor 40` da 0,38-0,63 de lo esperado. Conducirla al reloj de sim (`relojDeSim`,
  `waitFor {sim:N}`). Aviso: el 93 es el ÚNICO sujeto de la categoría `comportamiento` de
  `qa/bajo-carga.mjs`; si se cura sin más, esa rama se queda sin sujeto vivo (#639).

## Criterios de aceptación

1. La lógica pura de `expectMagnitud` vive en `qa/lib/*.mjs`, importada por `run.mjs`, con test
   propio en el que los cuatro sabotajes (H-6..H-9) salen ROJOS. `banco-medido.json` la ve.
2. El candado del cable de #609 sigue teniendo sujeto vivo tras el movimiento (probado en negativo).
3. `medirVelocidad` mide con el reloj de simulación como denominador; se demuestra con el
   reproductor (`qa/bajo-carga.mjs` a `--factor 40`) que la velocidad medida ya no cae con la carga.
4. La rama `comportamiento` del clasificador de `bajo-carga.mjs` tiene sujeto vivo declarado, o se
   retira con su motivo escrito. No se deja un candado sin sujeto.
5. Guion 93 aislado y en par, tres corridas de cada.

## Fuera de alcance

- #545 en general; solo este sitio.
- H-7 puede quedar como «imprimir la razón», no rediseñar el veredicto.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

#682 es OBSOLETO (expectMagnitud es hoy expectTasa, candada en carga-sintetica.test.ts:741-799 por la PR #685 del mismo día; H-6/H-7 viven en qa/lib/carga.mjs, que sí tiene test). La tanda queda como UNA tarea: curar el 93 con Δpos/Δsim y retirar el mismo día lo que se queda sin sujeto (la rama comportamiento entera, con grep a cero). Criterio 4 pierde su primera opción. Sustituye lo que nombra:


```
## Los issues (corregido tras la crítica)
- #679 es LA tarea. #682 se CIERRA con la evidencia de critica.md: H-8 y H-9 tienen candado desde la PR
  #685 (`carga-sintetica.test.ts:741-799`, ejecuta el cuerpo real de `expectTasa`); H-6 y H-7 viven en
  `qa/lib/carga.mjs`, que sí se importa, y son de la rama `comportamiento`, que se retira aquí.

## Criterios de aceptación
1. `medirVelocidad` mide `camino / Δsim`, con `sim` leído de `window.__nefan.reloj()` en el MISMO
   callback en que se lee `pos`. Sin tocar `rumboLibre` (padrón de sondas: 3 apariciones, tanda X).
2. `node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 3`: el 93 sale `igual-verde` con la carga
   REAL (exit 0 del reproductor); antes de la cura, `se-rompio` en la misma máquina, para tener el par.
3. Se retira ENTERA la maquinaria sin sujeto: `expectTasa`, el getter `tasas`, `defineProperty`, el
   cable (`tasas:` en filas y volcado), `tasaQueCae`, la rama `comportamiento` y su frase, sus tests
   (`carga-sintetica.test.ts` desde :503) y la prosa (`bajo-carga.mjs:70-81`, `README.md:170,386-394`).
   `grep -rn "expectTasa\|comportamiento\|tasaQueCae" qa nefan-core/test` → 0. El clasificador vuelve a
   DOS firmas y su docblock lo dice; no se inventa otro sujeto para la tercera.
4. Un negativo del punto 1: con el denominador de pared restaurado, el 93 a ×40 vuelve a rojo.
5. Guion 93 aislado y en par, tres corridas de cada.

## Fuera de alcance
- Sacar nada a `qa/lib/`: no queda parte pura que extraer.
- H-7: muere con la rama.
```

Bloque reescrito por el crítico (criterios y fuera de alcance nuevos, SUSTITUYEN a los originales):

### Criterios de aceptación
1. `medirVelocidad` mide `camino / Δsim`, con `sim` leído de `window.__nefan.reloj()` en el MISMO
   callback en que se lee `pos`. Sin tocar `rumboLibre` (padrón de sondas: 3 apariciones, tanda X).
2. `node qa/bajo-carga.mjs 93 --factor 40 --repeticiones 3`: el 93 sale `igual-verde` con la carga
   REAL (exit 0 del reproductor); antes de la cura, `se-rompio` en la misma máquina, para tener el par.
3. Se retira ENTERA la maquinaria sin sujeto: `expectTasa`, el getter `tasas`, `defineProperty`, el
   cable (`tasas:` en filas y volcado), `tasaQueCae`, la rama `comportamiento` y su frase, sus tests
   (`carga-sintetica.test.ts` desde :503) y la prosa (`bajo-carga.mjs:70-81`, `README.md:170,386-394`).
   `grep -rn "expectTasa\|comportamiento\|tasaQueCae" qa nefan-core/test` → 0. El clasificador vuelve a
   DOS firmas y su docblock lo dice; no se inventa otro sujeto para la tercera.
4. Un negativo del punto 1: con el denominador de pared restaurado, el 93 a ×40 vuelve a rojo.
5. Guion 93 aislado y en par, tres corridas de cada.

### Fuera de alcance
- Sacar nada a `qa/lib/`: no queda parte pura que extraer.
- H-7: muere con la rama.
```

## Decisión del coordinador tras el plan (2026-09-18)
Opción A adoptada. Las cuatro preguntas del plan §1, decididas: (1) criterio 3 = el grep por TÉRMINO de categoría del plan, no la palabra suelta; (2) la evidencia del criterio 2 es la fila `93 … se-rompio` antes y `igual-verde` después con «la carga fue REAL», no el exit code; (3) «en par» = `node qa/run.mjs 92 93`; (4) SÍ se añade el candado de reaparición en `campos-retirados-no-vuelven` de arch-rules.json. Offset propio: 700.
