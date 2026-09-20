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

# Tanda AC — «`scripts/mutacion.ts` troceado por sujeto» (#605)

## El issue

#605: `nefan-core/scripts/mutacion.ts` son 1.692 líneas y diez verbos; `scripts/` está fuera de
mutación y de CRAP, así que su deuda medida es cero por construcción. Lo sujetan solo los ejecutables
`qa/mutacion-*-en-negativo.mjs`. Candidato: un módulo por sujeto (descarga y sello, delta y atribución,
reparto en lotes, cola), dejando en `mutacion.ts` la tabla `VERBOS` y el enrutado — el patrón de #358 y
#346.

## Criterios de aceptación

1. `mutacion.ts` se queda con `VERBOS` y el enrutado; cada sujeto vive en su módulo bajo
   `scripts/mutacion/` (o donde diga el arquitecto), sin duplicar el lector de la huella ni los tipos.
2. Los diez verbos se comportan IGUAL: los `qa/mutacion-*-en-negativo.mjs` en verde antes y después, y
   una comparación de salida byte a byte de `pendiente`, `lotes` y `comparar` (en seco) sobre el mismo
   árbol antes y después del corte.
3. Cero cambios de conducta colados con el corte: si aparece un defecto, se apunta y se arregla en PR
   aparte.
4. Decidido y escrito: ¿entran los módulos nuevos en alguna medida (typecheck ya; ¿CRAP? ¿un test
   unitario del delta?)? Si no entran, el motivo en `mutation-targets.json`/`quality-thresholds.json`.

## Fuera de alcance

- Cambiar la política de mutación o los verbos.

## Correcciones del crítico (VIGENTE, 2026-09-18), aceptadas por el coordinador

El corte va por CIERRE de llamadas, no por verbo (un fichero por verbo duplicaría). Orden de fusión: AC se fusiona DESPUÉS de repartir la corrida que pide la tanda T, o su PR lo declara. Correcciones:


```

- Cifras de hoy: 1.760 líneas (no 1.692). El veredicto de adopción NO vive aquí: está en
  `mutacion-huella.ts` (`veredictoDeCorrida`) y `mutacion-comparar.ts` (`comparaEnSeco`, #581).
- Criterio 1, matiz: el corte es por CIERRE DE LLAMADAS, no por verbo. `comparar` son 39 líneas
  propias sobre un cierre de 356 compartido con `repartir`; `traer`/`fusionar`/`manifiesto` comparten
  el sello y la lectura de informes. Un fichero por verbo duplicaría eso y queda PROHIBIDO.
- Criterio 2, añadir: los 16 `rompe` de `qa/mutacion-cableado-en-negativo.mjs` (14) y
  `qa/mutacion-reparto-en-lotes.mjs` (2) casan por TEXTO EXACTO contra `MUT`: se cambia la ruta del
  triple y el mapa `fuentes`, y el cuerpo movido queda byte a byte. Medido lo tocado: 3× cada uno,
  aislado y en par. Y `test/afectado.test.ts:1297` (`GUIONES`) tiene que censar TODOS los ficheros
  nuevos que hagan `git diff --name-only`, no solo el que quede en el sitio de hoy.
- Criterio 4, ya decidido por el árbol: los trozos entran en typecheck (`tsconfig.scripts.json`
  `scripts/**/*.ts`), lint y las reglas de `arch-rules.json` que globan `nefan-core/scripts/**/*.ts`
  SOLOS; y en el instrumento de medida por grafo (`instrumentoDeMedida`). No entran en CRAP ni en
  mutación por DEFINICIÓN del perímetro (src/ · bridge/ · services/), no por exención: no hay nada
  que escribir en `mutation-targets.json` ni en `quality-thresholds.json`. Un test unitario del
  delta ya existe (`candados-en-negativo` sobre la huella); no se añade otro.
- Orden de fusión: DESPUÉS de repartir la corrida que pide la tanda T, o se declara en la PR que
  #605 saldrá co-candidato de todo superviviente nuevo de esa corrida (diff de instrumento ⇒ todos).
- Al cerrar el issue: decir que no mueve ningún número y que el beneficio es de lectura.
```


## Decisión del coordinador tras el plan (2026-09-18)
Opción A adoptada (plana con prefijo, seis módulos + `mutacion.ts` con VERBOS y main). Los tres hallazgos del plan (poner sustitutos sin añadir imports, byte a byte con `vieja-mutacion.ts` sobre el mismo árbol con los 15 juegos de argumentos, GUIONES derivado del instrumento) son obligatorios. Los informes de `reports/mutation` y `reports/mutation-base` se copian desde el checkout principal (solo lectura). No hace falta stack.
