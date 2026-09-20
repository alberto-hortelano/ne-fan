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

# Tanda Y — «Dentro de DOS geometrías a la vez también se sale» (#643)

## El issue

#643: hay una sola regla de paso (penetración no creciente) pero dos fuentes que la calculan por
separado —suelo (terreno + plan, `salida-del-solido.ts`) y cajas sueltas (`cajaBloquea`/`aabbBloquea`)—
y nadie resuelve estar dentro de las dos. Medido: `porDondeSalirDeAqui` contesta `{de:"tile"}` y ese
rumbo lo frena la caja; 2 de 36 rumbos libres. Arreglo propuesto: penetración sobre la UNIÓN. Lo que NO
vale, medido en tanda E: «celda a celda» literal sobre cajas encierra (0 de 8 rumbos de una caja 12×12).
Es la única conducta que la tanda G ESTRENÓ y que ningún test toca. Tanda I (#643+#648) estaba
prevista el 17; verificar en `git log` y en `docs/agents/2026-09-17-nadie-esta-dentro-de-dos-cosas/`
qué se hizo ya de esto, porque el issue sigue abierto.

## Criterios de aceptación

1. Con el cuerpo dentro de la geometría del tile Y de una caja de runtime, se sale: ≥ 1 rumbo libre
   en la misma configuración que hoy da 2 de 36 con el rumbo propuesto frenado, y el rumbo que
   devuelve `porDondeSalirDeAqui` NO lo frena ninguna otra fuente. Medido con el mismo instrumento
   del issue (el censo de puntos sin salida de las fixtures, que fue 3.117 → 0 en G).
2. La regla es una y las fuentes se combinan (unión), de forma que el empujón contradictorio sea
   inexpresable; el docblock de `cajaBloquea` deja de admitirlo.
3. Test unitario en nefan-core con la configuración doble; módulo de mutación medido en local si cabe
   (`salida-del-solido` no tiene base: ver si `local` lo acepta ahora que hay una medida; si no, se pide).
4. Ningún punto que hoy sale deja de salir (el censo de las tres fixtures sigue en 0) y la
   batería de guiones de la tanda G (los de «encerrado», 144 y vecinos) sigue verde.

## Fuera de alcance

- Que el NPC rodee (#618) o el destino del NPC (#646).
