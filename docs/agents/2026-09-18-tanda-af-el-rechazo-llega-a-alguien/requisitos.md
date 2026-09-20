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

# Tanda AF — «Un rechazo del bridge llega a alguien» (#678)

## El issue

#678: el bridge rechaza un frame por UNICAST al socket que lo mandó (`bridge/ws-server.ts:287-292`); los
clientes del banco que abren un socket, mandan y cierran en el mismo tick pierden el rechazo y salen
VERDES. #656 lo arregló para dos guiones (`pedirYEsperarTile`). Queda: (1) CENSAR por el árbol los
clientes WS del banco que cierran sin esperar (el 63 conserva su copia de `pedirTile` con
`reason: "prefetch"`); (2) decidir y ESCRIBIR qué es correcto para cada uno (hay «dispara y olvida»
legítimos); (3) si algún rechazo tiene que llegar aunque el socket se haya ido, es decisión del bridge.

## Criterios de aceptación

1. Censo por el árbol (no por nombre) de los sitios en `qa/` que abren un WS al bridge y lo cierran sin
   esperar respuesta, con la decisión escrita por sitio: espera el rechazo / dispara-y-olvida declarado.
2. Los que deban esperar usan el helper con dueño (`pedirYEsperarTile` o el que toque) y se demuestra
   con el negativo de #656 (`reason: "nope"` → rojo nombrando el rechazo).
3. Los «dispara y olvida» quedan declarados en un sitio candado (contrato + test), no como efecto de
   cómo se escribió el helper; probado en negativo (un cliente nuevo que cierre sin esperar y sin
   declararlo pone el candado rojo).
4. Si el arquitecto decide que el bridge debe hacer algo con un rechazo a socket cerrado, va como
   propuesta con medida, no se implementa en esta tanda sin apuntarlo al usuario.
5. Guiones tocados aislados y en par, tres corridas.

## Fuera de alcance

- #677 (presupuesto de la espera), tanda V.

## Reencuadre del crítico (REENCUADRADA, 2026-09-18), aceptado por el coordinador

Aceptado sin consultar: la premisa «salen verdes» es falsa hoy (se pierde el NOMBRE de la causa, no el color) y el alcance real son dos sitios (63:89 y 60:524). Sustituye lo que nombra:


**Corrección de premisa.** Ningún cliente del banco sale VERDE hoy por un rechazo perdido: el 63 declara ⊘ (espera el tile en el save) y el 60 sale ✘ (espera «tile listo» en el HUD). El defecto es que la CAUSA no se nombra, y es latente: `reason: "prefetch"` pasa el contrato. El censo por árbol da **2** sitios que cierran sin esperar (63:89 y 60:524), no uno.

**Criterio 2 (sustituye al actual)**: los dos sitios que cierran sin esperar quedan con su decisión escrita EN EL SITIO; si se decide que deben oír el rechazo, se demuestra en negativo con `reason: "nope"` → ⊘/✘ que NOMBRA el rechazo. No se les impone `pedirYEsperarTile`: no esperan el tile en el ledger del cliente, y esa función la está reescribiendo la tanda V.

**Criterio 3 (matiz)**: «un sitio candado» no prejuzga un padrón JSON; vale igual —y se prefiere— hacer inexpresable el cliente sin declarar (una puerta en `qa/lib`, constructor vedado en `qa/guiones/**`), probado en negativo con un guion nuevo que abra su socket a mano.

**Criterio 4 (cerrado aquí)**: el bridge no cambia. `escribir` (`ws-server.ts:91-95`) calla ante un socket no abierto por diseño y el hecho ya está en stderr (311). Se apunta la decisión y no se implementa nada.

**Añadir a «Fuera de alcance» o abrir issue**: los 15 sitios que esperan UNA respuesta concreta se cuelgan mudos ante un rechazo de intake (el bridge no cierra el socket). No es «verde», es «rojo sin causa»; se decide si el candado elegido los cubre o se abre issue con la lista.

**Orden con la tanda V**: AF no toca el cuerpo de `pedirYEsperarTile` ni `MS_DEL_TILE`; si toca `qa/lib/sesion.mjs`, V fusiona primero.

Decisiones del coordinador: (1) ORDEN: V fusiona primero; AF no toca MS_DEL_TILE ni los presupuestos ni pasa 63/60 por pedirYEsperarTile; si AF toca sesion.mjs, rebasa sobre V. (2) Criterio 4 cerrado: el bridge no cambia. (3) Los 15 que «esperan una respuesta» y se cuelgan mudos ante un rechazo de intake: issue nuevo que abre el coordinador, fuera de esta tanda. (4) Criterio 3: la garantía en el tipo (puerta en qa/lib, constructor vedado en qa/guiones/**) vale igual que un padrón; lo decide el arquitecto.

## Decisión del coordinador tras el plan (2026-09-18)
Opción B adoptada (helper `qa/lib/cable.mjs` + padrón por árbol). UNA restricción: la tanda X está editando AHORA `test/la-consulta-de-movimiento-tiene-dueno.test.ts`; AF NO lo toca. `test/helpers-del-banco.ts` nace nuevo con su propia copia del visitante y la unificación de las dos copias queda como issue del coordinador tras la fusión. Offset de esta tanda para stacks propios: 300.
