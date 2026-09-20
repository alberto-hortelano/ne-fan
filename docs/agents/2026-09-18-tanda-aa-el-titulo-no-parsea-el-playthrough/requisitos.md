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

# Tanda AA — «Listar partidas no parsea el playthrough» (#224, con #430 al lado)

## El issue

#224, re-medido el 09-17: `FsSessionStorage.list()` (`src/narrative/session-storage.ts:166-199`) hace
`read(name)` por cada save, en serie, parseando el `state.json` ENTERO para ocho campos. Con 202 saves
sintéticos (27 MB) 149,7 ms; el desglose dice I/O 17,6 ms y `JSON.parse` ~82 ms: paralelizar no arregla
nada (medido). El arreglo tiene que EVITAR parsear el playthrough. Y `GET /sessions/asset_refs`
(`bridge/state-http/session-routes.ts:33-38`) hace `list()` + `read()` de cada save: parsea dos veces, y
es la keep-list de la poda del asset-store. Historial: el crítico del 08-23 descartó el índice aparte
como «segunda fuente de verdad frente a "el bridge es el único escritor"» y señaló que el problema real
es que `saves/` no tiene techo.

#430 dice que `session-storage.ts` y `narrative-state.ts` están fuera de la mutación por el coste de su
batería, que con `tap-runner` ya no es el que era; la decisión (a) entrar / (b) aparcar con número es del
usuario y queda APUNTADA. Esta tanda NO la toma; pero si toca `session-storage.ts`, deja el terreno para (a).

## Criterios de aceptación

1. Listar partidas no parsea el documento entero de cada save. La forma la decide el arquitecto
   (cabecera por save escrita por el escritor único en la misma transacción de `save()`, o parseo
   parcial), respetando «el bridge es el único escritor» y sin segunda fuente de verdad que pueda
   divergir del save (si hay cabecera, se deriva del save y se puede reconstruir; un test lo demuestra).
2. Medida antes/después con los 202 saves sintéticos del comentario del 09-17 (o equivalentes),
   en el informe.
3. `GET /sessions/asset_refs` deja de parsear dos veces cada save.
4. Pre-producción: no hay migración de saves viejos.
5. `npm run verify` verde; los tests de `session-storage` que cambian de sentido se pasan o se borran
   declarándolo.

## Fuera de alcance

- El techo de `saves/` (poda): se apunta como pregunta al usuario si el crítico confirma que sigue
  siendo el problema de fondo.
- Decidir #430.
