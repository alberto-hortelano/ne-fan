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

# Tanda AD — «Cada dueño cuenta su propio arte pendiente» (#492)

## El issue

#492, re-medido el 09-17: `DevMenu` ya tiene 3 deps y vive en `ui/dev-menu.ts`; lo que no salió es
`listFakeItems` (`nefan-html/src/main.ts:797-840`, 43 líneas, seis colaboradores: aspecto,
characterSprites, fpsAtlasController, fpsRenderer, mundo, tileStore). Arreglo: que cada dueño exponga
`pendientes()` y `listFakeItems` se reduzca a juntar listas ya hechas y salga de `main.ts`. Aviso vivo:
`main.ts` está en su tope de líneas sin holgura (1379/1379 ayer; re-medir).

## Criterios de aceptación

1. `listFakeItems` fuera de `main.ts`; cada dueño (controlador del atlas, gestor de sprites, y los que
   decida el arquitecto) expone su propio conteo de arte pendiente, y `main.ts` solo compone.
2. El menú de desarrollo se comporta igual: mismos items, misma generación con el fake-ai-server
   (preset `e2e-sin-creditos`), comprobado desde el arranque.
3. `main.ts` baja de líneas y el tope de `arch-rules.json` baja con él (la dirección permitida).
4. Candado `la-logica-de-juego-no-vuelve-al-cliente` y arquitectura verdes; cero conversión
   celdas→metros nueva.

## Fuera de alcance

- Rediseñar el menú de desarrollo.

## Correcciones del crítico (VIGENTE, 2026-09-18), aceptadas por el coordinador


**Medido el 2026-09-18 sobre `a25d8c2f`:** `listFakeItems` está en `main.ts:798-840` (43 líneas); el bloque
del menú que sale entero es `:795-859` (docblocks + `generateFakeItem` + `new DevMenu`, 65 líneas). Toca
**siete** colaboradores: aspecto · characterSprites · fpsAtlasController · fpsRenderer · mundo · **spriteRenderer**
(miniatura y_bot, `:823`) · tileStore. `main.ts` mide **1381** y su excepción dice 1381.

**Criterio 3 corregido:** el tope vive en `nefan-core/data/contract/client-file-size.json:7`, no en
`arch-rules.json`, y `test/client-file-size.test.ts:113` exige la cifra EXACTA de `wc -l`: se actualiza en el
mismo commit o el test está rojo. Se reescribe el `porque` (`:8`) para que deje de nombrar al menú dev como
inventario de 8 colaboradores que se queda en la raíz, y se retira el docblock de `main.ts:851-853` que decía
que el menú vive en la raíz «porque es la única que lo ve todo».

**Criterio 1 matizado:** ningún dueño solo sabe hoy lo que cuenta `listFakeItems`. Skins: el gestor no anota
prompts en maqueta ni con el fusible saltado (`character-sprites.ts:236-237`), y una partida nueva nace en
maqueta; los prompts vivos los tienen `mundo.personajes` y `aspecto`. Atlas: «texturado» lo sabe el GL
(`fpsRenderer.debugState()`), los tiles `tileStore`, y el controlador solo `running`. El arquitecto decide el
reparto; el criterio es que **la lista sea idéntica a la de hoy en maqueta, en imagen y con un skin fallido**.

**Criterio 2 matizado:** no existe guion que conduzca `#dev-menu` (grep en `qa/` = 0). Hace falta uno nuevo
sobre `e2e-sin-creditos` que compare la lista antes/después en los tres estados de arriba; número al fusionar
(#680). `character-sprites.ts` está en 437/450: si el método nuevo lo pasa del tope, no se sube el tope.

## Decisión del coordinador tras el plan (2026-09-18)
Opción B adoptada tal cual; `inFlight` del atlas sigue leyendo `running` (lista idéntica; el cambio va a issue). Offset propio para stacks: 600.
