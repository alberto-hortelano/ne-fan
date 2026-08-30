# Requisitos — La huella declarada (#301 #187 #300)

> **v2, tras la crítica.** El crítico tumbó **dos afirmaciones mías** del §3 (marcadas ⚠️ abajo)
> y corrigió el alcance de los tres issues. El usuario decidió después la salida de #300. Esta
> versión es la que vale; la v1 queda en el historial de git, que es donde debe quedar un error
> medido — no borrado.

## 1 · La petición, literal

Intención permanente del usuario, repetida a lo largo del día:

> «Vamos a seguir priorizando reducir el numero de issues»

Y para esta tanda:

> «Perfecto, pasamos a la siguiente»

Elegida por el usuario entre cuatro tandas medidas, con esta descripción delante:

> **La huella declarada (Recomendado).** #300 + #187 + #301. Un solo tema: lo que una entity
> DECLARA ocupar y lo que el juego HONRA son cosas distintas. #300 es el agujero real (el sim
> mueve toda criatura como un círculo de 0,5 m, ignora footprint: un bicho de 4 m cruza un vano
> de 1 m mientras el cliente lo pinta 16 veces mayor). #187 es la puerta cuya huella declarada y
> colisión son disjuntas — arreglo elegido y coste de arte medido en CERO (clave del atlas
> idéntica). #301 borra la ruta `structures`, fuera del contrato y con el peor CRAP de
> src/scene. Todo medido, cero decisiones pendientes tuyas.

Y, puesta delante la crítica, la decisión sobre #300 — **«Tope en el contrato (Recomendado)»**:

> Salida 2 sola: el zod le pone tope al footprint de una entity móvil, y lo declarable deja de
> poder divergir de lo simulable. ~5 líneas de producción + ~15 de test, sin tocar el golden, sin
> fontanería en el save. Hace el estado malo INEXPRESABLE en vez de añadir otro test — el patrón
> que esta casa ya prefiere. Si entra, la salida 1 se queda sin sujeto y #300 se cierra
> diciéndolo con la medida delante.

**Nota de honestidad para el que lea esto en un mes:** la descripción de la tanda que el usuario
eligió contiene DOS afirmaciones falsas, heredadas del cuerpo de #300 y no medidas por mí antes
de ofrecerlas — «un bicho de 4 m cruza un vano de 1 m» y «el cliente lo pinta 16 veces mayor».
Las dos las tumbó el crítico (§3). La elección del usuario sigue siendo válida porque la decisión
que tomó DESPUÉS ya tenía la crítica delante.

## 2 · El hilo que une a los tres

**Algo declara una huella y otro alguien decide qué ocupa de verdad.** En #300 el motor declara
`footprint` y el simulador no lo lee jamás; en #187 la huella publicada de una puerta y las
celdas que bloquean son conjuntos disjuntos; en #301 hay una primitiva que declara estructuras
fuera del contrato y sobrevive por un `.passthrough()`. Los tres son el mismo fallo con tres
caras: **la declaración y la aplicación no están atadas por nada.**

## 3 · Lo medido, y lo que hubo que corregir

Todo verificado el 2026-08-30 sobre `8150595`. Las filas ⚠️ son afirmaciones **mías** de la v1
que el crítico midió y resultaron falsas.

| Afirmación | Estado |
|---|---|
| #300 · `grep footprint src/simulation/` y `bridge/` = 0 | **CIERTO** (0 y 0) |
| ⚠️ #300 · «el sim SÍ tiene el dato a mano» | **FALSO.** `npcBehaviorExtras` (`src/narrative/npc-records.ts:166-175`) copia `role`/`description`/`style_ref`/`behavior` y **tira el footprint**. Recorrido el camino real: un NPC `[8,8]` llega al sim como `EntityRecord{data:{name,role,description}}`. Llevarlo hasta `NpcRuntime` es fontanería nueva, visible en el save |
| #300 · «el cliente lo pinta 16 veces mayor» (del issue) | **FALSO.** `formatDToWorld` no emite footprint para npcs (`scene-normalize.ts:196-207`); `fps-gl.ts:1408` pinta TODO personaje como billboard fijo de 2,4 m |
| #300 · qué footprints existen hoy | **TODOS `[1,1]`** — 4 tiles de juego, 3 fixtures de `data/scenes/`, 6 de contrato. Ni uno distinto |
| #300 · la divergencia va AL REVÉS del enunciado | Declaran `[1,1]` = radio **0,25 m** y el sim los mueve a **0,5**. Y ese 0,5 no es un cuerpo: es un **margen de seguridad deliberado** (`terrain-collision.ts:30-34`) |
| #300 · derivar el radio a secas | **ROMPE 19 TESTS** (`1626 pass / 19 fail` con `NPC_RADIUS_M = 0.25`). `MIN_VANO_CELDAS` cae 3→2: **la puerta de 1 m que cerró #289 vuelve a ser legal en el zod** |
| #300 · ¿puede ENCERRAR a un NPC? | **SÍ.** `migrations.ts:53-58` escala el footprint ×4 al remuestrear; la fixture `test/fixtures/saves-v3/v3_aldea/state.json` migra su NPC a `[4,4]` → 5 celdas libres en una aldea de 12×8. Única fuente del repo de footprints ≠ `[1,1]` |
| #187 · huella y colisión disjuntas | **CIERTO**, reproducido: `[56,58.5,8,3]` → **36 sólidas, 0 dentro** |
| #187 · **precondición, no criterio: el arte no se repaga** | **RE-MEDIDO HOY: coste 0.** Clave del atlas `f6c106bf108da9d808c35654` idéntica antes y después de parchear la rama `gate`; invariante 0/36 → 36/36. Estructural: `volume-metrics` **no está** en el cierre de imports de `blueprint/greybox.ts` (18 ficheros). Único consumidor vivo: `fps-ambience.ts:65,96` |
| #187 · el canario congelado funciona | **CIERTO**: con el parche, `[deuda] la PUERTA incumple el invariante` se pone rojo (`0 !== 36`) |
| ⚠️ #301 · «son DOS tiles commiteados» | **SON CERO.** `nefan-core/data/games/*/world/` está en `.gitignore:81` (`git check-ignore` lo confirma): caché local regenerable que el CI no ve. Tocarlos **no es entregable**. Ya lo dejó escrito **#302** el 27-ago, el mismo día que se abrió #301 |
| #301 · ¿la `room` es redundante en las dos? | **SÍ, medido**: `deriveVolumesFromSchema` con y sin `structures` da volúmenes **byte a byte idénticos** en `alta_fantasia` y en `colonia_aster`. Las dos llevan el mismo `building taberna rect [52,48,24,16] cutaway:true` |
| #301 · «13 `it()`», «≈211 prod», «14 de 35 golden» | **21 `it()`** en 9 ficheros · **≈136 prod** medidas · **38 casos de golden, no 35**, de los que se mueven **15** |
| #301 · ¿se borra `expandScenePrimitives`? | **NO**: `hasUnexpandedPrimitives:63` y `migrations.ts:63` la necesitan. Muere la RAMA, sobrevive la función. CRAP 64 confirmado hoy (el peor de `src/scene`) |

## 4 · Qué hay que entregar, en este orden

**#301 primero y en su propio commit — borrar la ruta `structures` entera.** Producción (~136
líneas: rama de `scene-expand.ts`, `structureDoors` en `scene-validate.ts:634-657`,
`derive.ts:135-156`, los tipos `RoomStructure`/`RoomDoor`), los tests que se quedan sin sujeto, y
las fixtures que la usan como DATO — que `CLAUDE.md` prohíbe dejar vivas alimentando un test de
un formato muerto: o se migran, o el test se borra declarando qué cobertura se pierde. El golden
se revisa **a mano**; regenerarlo lo prohíbe su propia cabecera.

**#187 después — la huella de `gate` declara las jambas.** Arreglo A: delegar en
`volumeFootprint`. Se borran **las dos** piezas de la deuda: el test congelado y el
`.filter((t) => t !== "gate")`. Con solo una, `gate` se queda sin cubrir y el verde no comprueba
nada.

**#300 al final — SOLO la salida 2: tope al `footprint` de una entity móvil.** Decisión del
usuario con la crítica delante. El estado malo se vuelve **inexpresable** en el zod en vez de
vigilado por un test más. La salida 1 (que el sim derive su radio) **no entra**: hoy no cambia un
píxel, cuesta fontanería en el save, rompe 19 tests y añade el riesgo de encierro de
`migrations.ts`. Al cerrar #300 hay que **escribir esa medida en el issue**, no solo el veredicto.

## 5 · Criterios de aceptación

De los nueve de la v1, el crítico demostró que **cinco no podían nacer rojos**. Estos son los que
quedan, ya sustituidos, y cada uno con cómo se pone rojo HOY:

| # | Criterio | Nace rojo porque… |
|---|---|---|
| 1 | El zod **rechaza** una entity móvil con un `footprint` por encima del tope, y sigue aceptando `[1,1]` | Hoy el contrato dice `minimum: 1` y **ningún máximo**: `[8,8]` entra sin queja |
| 2 | El tope **no es un número mágico**: sale de la misma fuente que el cuerpo que el sim honra, y hay candado que se pone rojo si los dos divergen | Hoy no hay tope ninguno que atar |
| 3 | `test/volume-metrics.test.ts` ya no excluye `gate`: el invariante se comprueba para los **once** tipos | Medido: quitar el `.filter` hoy da `pass 40 / fail 1` |
| 4 | `grep -rn "structures"` en `src/` y `bridge/` = **0** | Hoy son 6 ficheros. *(Recortado: `data/games/*/world/*.json` está gitignorado y el CI no puede verificarlo)* |
| 5 | El golden se revisa a mano: los **15 casos** que se mueven quedan explicados uno a uno en `implementacion.md`, y los **tres** que prueban la pasada de chars con el `floor_char:"o"` de la `room` se **rediseñan** — no se les revisa el valor, porque no tienen equivalente en un cutaway | Medido: hoy 15 de 38 se ponen rojos |
| 6 | `expandScenePrimitives` **baja** de CRAP 64 en `npm run deuda` — la función sobrevive, muere su rama | CRAP 64 confirmado hoy |

**Puertas de no-regresión** (no son criterios: son verdes por definición y aun así obligatorias):
batería 43/43, `npm run verify`, deuda sin crecer, el juego arranca y se juega.

## 6 · Decisiones abiertas para el arquitecto

1. **El token huérfano.** `structures` aparece en el patrón de `arch-rules.json:242` (regla
   `cliente-no-convierte-celdas-a-metros`) y en su prueba en negativo de
   `architecture.test.ts:392`. ¿Se queda como candado de reaparición? Si se queda, el `why` de
   `:236` describe una primitiva que ya no existe y hay que reescribirlo.
2. **La coartada del `.passthrough()`.** `scene-schema.ts:20-24` justifica que la escena no sea
   `.strict()` citando «`__expanded`, `structures` y `place_anchors`». Al irse `structures` queda
   medio falso.
3. **Dónde vive el tope de #300** y de qué se deriva, sabiendo que `NPC_RADIUS_M = 0,5` es margen
   de seguridad y no un cuerpo.

## 7 · Restricciones

- **Cada issue en su propio commit, en el orden #301 → #187 → #300.** #301 y #300 mueven el mismo
  golden y no pueden mezclar dos revisiones a mano en un solo diff.
- **Cero créditos.** Nada de esto necesita generar una imagen. Si algo lo pidiera, es un hallazgo.
- **No matar procesos ajenos.** Hay otras instancias de Claude en la máquina. Nunca `pkill`, ni
  matar por puerto lo que no arrancó uno mismo. Usar `NEFAN_PORT_OFFSET`.
- **Pre-producción: cero compatibilidad.** `structures` se borra ENTERA el mismo día, con sus
  tests. Nada se conserva por ser antiguo.

## 8 · Lo que NO es de esta tanda

- **Los dos `tile.json` locales seguirán con su `room` para siempre** — nadie los revalida y el
  passthrough la tolera. Eso es material de **#302**: se anota allí, no se arregla aquí.
- **#302** ya corrigió por escrito la premisa de los snapshots que #301 repite: releerlo antes de
  empezar.
- **#289** está cerrado; esta tanda no lo revisa, y el arreglo de #300 **no puede reabrir** su
  puerta de 1 m.
- **#264** (tope de CANTIDAD de prims) no es el mismo arreglo. Confirmado fuera.
