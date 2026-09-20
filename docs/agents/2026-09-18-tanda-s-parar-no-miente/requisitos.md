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

# Tanda S — «`--parar` no miente con ningún offset» (#684)

(La cabecera de arriba es común a las 14 tandas del día; lo específico empieza aquí.)

## El issue

#684, `bug`: `start.sh --parar` con `NEFAN_PORT_OFFSET >= 1000` barre siempre los bloques 0-900 y
dice «(nada que parar aquí)» con el stack en pie. Cuerpo entero: `gh issue view 684`. La aritmética
está verificada por el coordinador de ayer (`ALL_PORTS` ya viene desplazado, `base - PORT_OFFSET + off`
recorre 0..900 pase lo que pase). Coordenadas que da y hay que re-verificar: `start.sh:1405-1407`.

## Criterios de aceptación

1. `NEFAN_PORT_OFFSET=<n> ./start.sh --parar` encuentra y para lo que es de ESTE árbol para
   CUALQUIER offset que el launcher acepte arrancar, incluidos 1000, 1400 y 1800. El conjunto de
   puertos no se adivina por bucle fijo: o se deriva de lo que el catálogo admite, o —mejor, como
   pide el issue— la parada por árbol no depende del offset (ya resuelve el dueño por `/proc/<pid>/cwd`
   y por argumentos).
2. Sigue sin tocar nada ajeno: lo que no se demuestra de este árbol se enumera y se deja. Los
   candados de propiedad existentes (#393, #424, #428) siguen verdes.
3. Cuando no hay nada que parar, lo dice; cuando lo hay y no puede, FALLA en voz alta. Nunca
   afirma «nada» habiendo algo.
4. **Candado**: un test que arranque algo de este árbol en un bloque alto (≥ 1000) y compruebe que
   `--parar` lo ve y lo para. Se demuestra en negativo (con el bucle de hoy, el test sale rojo).
   Si es headless, entra en `candados-headless` el mismo día.
5. CLAUDE.md §«Arrancar el juego» y `docs/agents/README.md` dejan de decir «diez bloques» si deja de
   ser verdad.

## Fuera de alcance

- `--parar-todo`, que sigue existiendo bajo bandera y no cambia.
- Que ai_server/remote-gen/narrative-mcp/sprite-forge honren el offset (decisión vieja, no se toca).

## Preguntas abiertas (con la suposición tomada)

- ¿Tiene el catálogo un tope de offset? Suposición: no hay tope escrito; el arreglo no debe
  depender de uno.

## Correcciones del crítico (VIGENTE, 2026-09-18), aceptadas por el coordinador

- Pregunta abierta corregida: el tope SÍ está escrito: `start.sh:35` acepta `NEFAN_PORT_OFFSET` de 0 a 40000. El arreglo no puede mirar menos bloques de los que la subida acepta arrancar, y no copia el 40000 a un segundo sitio.
- Criterio 1, decisión del coordinador: el SUJETO de `--parar` sigue siendo «puertos del catálogo de este árbol». NO se amplía a cualquier puerto de este árbol (game-emulator :9899, replay-server, vite suelto). El bug está en el filtro de candidatos (`:1404-1408`), no en la propiedad (`worktree_de_pids`), y ahí se arregla.
- Criterio 4, reescrito: candado = se demuestra que `--parar` para un stack propio en un bloque ≥ 1000. Primero se comprueba si `qa/parar-clasifica-los-nueve-puertos.mjs` con `NEFAN_PORT_OFFSET=1000` ya sale rojo sobre el `start.sh` de hoy: si es así, el candado es ese guion en bloque alto (su cabecera deja de decir «diez bloques»), no un fichero nuevo. Si ejecuta `./start.sh --parar` sobre puertos reales queda EXENTO de `candados-headless` con el motivo de sus hermanos (`candados-headless.json:25-31`) y se dice; solo entra en CI una parte cuyo sujeto no sean los puertos de la máquina.
- Criterio 5, ampliado: «diez bloques» / «90 puertos» a cero también en la prosa de `start.sh` (164, 266, 1396, 1400-1403, 1475, 1481) y de los dos candados de `qa/`. NO se toca el `0..900` de `qa/run.mjs:274-295` (elección de bloque del banco) ni el de `parar-clasifica…:270` (dónde plantar un ajeno): no son el bug.

## Decisión del coordinador tras el plan (2026-09-18)

Se adopta la **opción C** del plan con la desviación declarada: el offset admisible es **múltiplo de 100 en 0..40000**, con UN predicado (`offset_admisible`) usado por la subida y por el filtro de candidatos, y apretado igual en las tres implementaciones que ya tienen candado de paridad. Todos los offsets del repo son múltiplos de 100, así que no rompe a nadie y mantiene el sujeto «catálogo de este árbol». Offset asignado a esta tanda para su propio stack: **100**; el señuelo del bloque 10 va en un bloque libre ≥ 1000 (si con las tandas en marcha no hay ninguno libre, se dice y no se afirma la medida).
