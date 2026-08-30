# #187 VIGENTE · #300 REENCUADRADA · #301 REENCUADRADA — y los tres no son una tanda

Medido sobre `8150595`; árbol limpio antes y después (`git status` = solo este directorio).

## El problema real, uno por issue

- **#300** — nada ata el cuerpo que el motor DECLARA al que el sim MUEVE. Pero la divergencia va
  **al revés** del enunciado: el 100 % de los NPC declara `[1,1]` (radio 0,25 m) y el sim los mueve
  a 0,5 — el doble, no la mitad.
- **#187** — `volumeFootprintCells(gate)` devuelve el negativo de su masa; no rompe nada porque
  casi nadie la llama, y por eso es una trampa para el próximo que la llame.
- **#301** — hay un expander vivo para una primitiva que el contrato no admite y que nadie emite.

## La premisa, afirmación por afirmación

| # | Afirmación | Verificación de HOY |
|---|---|---|
|300| `grep footprint src/simulation/` y `bridge/` = 0 | **CIERTO** (0 y 0) |
|300| «el sim SÍ tiene el dato a mano» (`requisitos.md:43`) | **FALSO.** `npcBehaviorExtras` (`src/narrative/npc-records.ts:166-175`) copia `role`/`description`/`style_ref`/`behavior` y **tira el footprint**. Ejecutado el camino real: un NPC `footprint:[8,8]` llega al sim como `EntityRecord{data:{name,role,description}}`. `:65` lo lee para CENTRAR y lo descarta |
|300| «el cliente lo pinta 16 veces mayor» | **FALSO.** `formatDToWorld` no emite footprint para npcs (`scene-normalize.ts:196-207`) y `fps-gl.ts:1408` pinta TODO personaje como billboard fijo de `FRAME_WORLD_M = 2.4` m (`:50`). `grep footprint nefan-html/src/` → 1 acierto, y es un comentario sobre objetos |
|300| «3 sitios de `npc-behavior.ts`» | **2.** `:661` (`blocksMove`) y `:713` (`blocksCircle`) son colisión; `:493` es `GOAL_REACHED + NPC_RADIUS_M`, un umbral de proximidad |
|300| qué footprints existen hoy | **TODOS `[1,1]`**: 4 tiles de juego, 3 fixtures de `data/scenes/`, 6 de contrato. Ni uno distinto |
|300| derivar el radio del footprint no rompe nada | **ROMPE 19 TESTS.** Puesto `NPC_RADIUS_M = 0.25` (= `[1,1]`) y corrida la batería: `1626 pass / 19 fail` — `doors[].w: 2 celdas`, `gate.w: 2 celdas`, `floodFill con cuerpo · la puerta de 1 m`, `MIN_SEP_TREE`, `EmittedSceneSchema — un vano más estrecho que el cuerpo mayor no llega al collider`, 4 del golden. `MIN_VANO_CELDAS` cae 3→2: **la puerta de 1 m que cerró #289 vuelve a ser legal en el zod** |
|300| ¿puede ENCERRAR a alguien? | **SÍ, con nombre.** `migrations.ts:53-58` escala el footprint por el remuestreo (`mpc 2 → ×4`). La fixture commiteada `test/fixtures/saves-v3/v3_aldea/state.json` (npc `[1,1]`, `mpc 2`) migra a **`[4,4]`** → 5 celdas libres exigidas en una aldea de 12×8. Es la ÚNICA fuente del repo de footprints ≠ `[1,1]` |
|187| huella y colisión de `gate` disjuntas | **CIERTO**, reproducido: `[56,58.5,8,3]`, **36 sólidas, 0 dentro** |
|187| **la clave del atlas no cambia** (medida de hace 7 días) | **RE-MEDIDA HOY, sigue en CERO.** Parcheada la rama `gate` a delegar en `volumeFootprint`: `LAYOUT KEY f6c106bf108da9d808c35654` antes y después; invariante 0/36 → 36/36. Y es **estructural**: el cierre de imports de `blueprint/greybox.ts` son 18 ficheros y `volume-metrics` **no está**. Único consumidor vivo: `fps-ambience.ts:65,96`. **Coste de arte: 0** |
|187| el canario congelado funciona | **CIERTO**: con el parche, `[deuda] la PUERTA incumple el invariante` se pone rojo (`0 !== 36`) |
|**301**| «un único artefacto commiteado» | **NI UNO NI DOS: CERO.** `git check-ignore -v` → `.gitignore:81: nefan-core/data/games/*/world/`; `git ls-files nefan-core/data/games/` solo devuelve `game.json`, `world.md`, `plugins/`. **CI nunca los ve.** Ya estaba corregido en la cola: el cuerpo de #302 lo dice literalmente desde el 27-ago, el mismo día que se abrió #301 |
|301| ¿la `room` es redundante también en `colonia_aster`? | **SÍ, medido.** `deriveVolumesFromSchema` con y sin `structures` sobre los dos `tile.json` reales: volúmenes derivados **byte a byte idénticos** en ambos, `representedBy` idéntico, cero volúmenes que solo existan por la `room`. Las dos llevan el mismo `building taberna rect [52,48,24,16] cutaway:true`. Borrar la primitiva **no borra geometría que nadie repone** |
|301| 331 líneas, CRAP 64 | **CIERTO** los dos (`npm run deuda`: sigue el peor de `src/scene`; 2.º `formatDToWorld`, 54) |
|301| «13 `it()` sin sujeto» ≈196 líneas | **21 `it()` tocan `structures`** (medido por cuerpo de bloque, 9 ficheros). Solo parte pierde el sujeto; el resto la tiene de FIXTURE, y `CLAUDE.md` prohíbe dejarlos vivos con datos de un formato muerto: **migrar fixtures es trabajo que el issue no cuenta** |
|301| «355 líneas del golden, 14 de 35 casos» | **38 casos, no 35.** Ejecutado: borrar la `room` mueve **12**; sustituirla por el cutaway equivalente mueve **15** |
|301| producción ≈211 líneas | **≈136 medidas**: 73 (rama de `scene-expand.ts`) + 24 (`structureDoors`, `scene-validate.ts:634-657`) + 22 (`derive.ts:135-156`) + 13 (`RoomStructure`/`RoomDoor`) + 4 sueltas |
|301| se puede borrar `expandScenePrimitives` | **NO.** `hasUnexpandedPrimitives:63` («un tile SIEMPRE se expande») y `migrations.ts:63` la necesitan. Muere la rama, no la función |

## El día después

- **#300 no cambia un píxel hoy**: todo footprint es `[1,1]` y el cliente no lo lee ni para colisión ni para tamaño. Su valor es entero futuro, es el más caro de los tres y el único con riesgo de encierro. Eso cambia su prioridad.
- **#301 rompe la coartada del `.passthrough()`**: `scene-schema.ts:20-24` justifica que la escena no sea `.strict()` citando «`__expanded`, `structures` y `place_anchors` en los snapshots». Queda medio falso.
- **Queda un token huérfano**: `structures` en `arch-rules.json:242` y su prueba en negativo en `architecture.test.ts:392`. Hay que DECIDIR si se queda como candado de reaparición; si se queda, el `why` de `:236` ya no describe una primitiva viva.
- **Lo que nadie borrará**: los dos `tile.json` locales seguirán con su `room` para siempre (nadie los revalida, el passthrough la tolera). Sujeto de **#302** — anotarlo allí, no arreglarlo aquí.
- **Lo arbitrario dentro de un mes**: `NPC_RADIUS_M = 0,5` no es un cuerpo, es un **margen de seguridad deliberado** (`terrain-collision.ts:30-34`); «el sim deriva el radio del footprint» lo borra sin que se note.

## Conflictos

1. **#301 y #300 mueven el MISMO golden** (`checkNpcBodies:523` y las costuras `:908` derivan de `BODY_RADIUS_M`). La restricción del §6 —«#301 va sola y primero para no mezclar dos revisiones a mano del mismo golden»— **se aplica igual a #300**, y el requisito no lo dice. Orden obligado: **#301 → #187 → #300**, tres commits.
2. **#300 contra #289 (cerrado)**: derivar el radio a secas reabre la puerta de 1 m que #289 cerró (19 tests). Con un **suelo** (`max(NPC_RADIUS_M, derivado)`), `[1,1]` no se mueve y **#300 no toca el golden** — al contrario de lo que dice su comentario del 28-ago.
3. **#301 contra #302**: #302 ya corrigió por escrito la premisa que #301 repite. No es contradicción de trabajo: es un cuerpo caducado que hay que corregir antes de empezar.
4. **#264** no es el mismo arreglo (tope de CANTIDAD de prims, no de huella). Fuera, confirmado.

## Coste contra valor

- **#187 · hacer.** ~6 de producción, ~15 de test que se borran, arte 0 re-medido hoy, canario ya escrito y probado en rojo. El más barato de la cola y sin decisiones abiertas.
- **#301 · hacer, con el alcance corregido.** Producción ~136 muerta de verdad, pero el precio son los **15 casos de golden** y la migración de fixtures de ~21 `it()`. Tres de esos 15 (`char-de-terreno-sin-declarar`, `dos-chars-sin-declarar`, `cuatro-pasadas-fallando-a-la-vez`) rompen por algo que el issue no prevé: prueban la pasada de chars **usando el `floor_char:"o"` de la `room`**, sin equivalente en un cutaway — hay que **rediseñarlos**, no revisarles el valor. Cero líneas de datos commiteados: los tiles no son trabajo.
- **#300 · no hacer la salida 1 en esta tanda.** «No hacer nada» es defendible: hoy no cambia nada para quien juega, cuesta ~100-150 prod + ~120 test + fontanería nueva por `EntityRecord.data` (visible en el save) + golden, y **añade** el riesgo de encierro de `migrations.ts`. La **salida 2** (tope al footprint de una entity móvil) hace el estado malo **inexpresable** por ~5 prod + ~15 test y sin golden — el patrón que esta casa ya prefiere (`feedback_garantia_en_el_tipo.md`). Si la 2 entra, **la 1 se queda sin sujeto**. Lo que NO debe hacerse: cerrar el requisito con «la 1 no es opcional» sin haber medido esto.

## Los nueve criterios del §5: cinco no pueden nacer rojos

1. **Mitad.** La primera sí; «una `[1,1]` sí pasa por donde pasaba» **no puede ponerse roja jamás** (encoger un cuerpo nunca bloquea). **Sustituir por** «un NPC `[1,1]` sigue exigiendo 3 celdas libres, no 2» — ese sí, medido en 19 tests.
2. **NO**: un docblock no es ejecutable. **Sustituir por** un test o regla de `arch-rules` que prohíba `NPC_RADIUS_M` como constante en `npc-behavior.ts:661,713`. Rojo hoy, trivialmente.
3. **SÍ**, ejecutado: quitado el `.filter` → `pass 40 / fail 1`.
4. **NO, y no es criterio: es precondición ya medida** (clave idéntica). Un ingeniero no puede ponerla roja, solo repetir la medida. Va al §3.
5. **SÍ** (6 ficheros, ~35 líneas), pero el trozo de `data/games/*/world/*.json` **CI no lo puede verificar**: está gitignorado. Recortar el criterio a `src/` + `bridge/`.
6. **SÍ en su mitad mecánica**: 15 de 38 casos rojos. La revisión a mano es proceso, no criterio.
7. **SÍ**: CRAP 64 confirmado hoy. Ojo, la función SOBREVIVE: el objetivo es «baja», no «desaparece».
8. **NO**: gate de no-regresión, verde por definición. Correcto tenerlo, incorrecto llamarlo criterio.
9. **NO**: proceso.

## Qué le cambiaría a `requisitos.md` (para pegar tal cual)

- **§3, «#300 · el sim SÍ tiene el dato a mano»** → «**FALSO**: `npcBehaviorExtras` (`npc-records.ts:166-175`) descarta el footprint; el sim recibe un `EntityRecord` sin él. Hay que llevarlo hasta `NpcRuntime`, y eso es visible en el save.»
- **§3, «#301 · son DOS»** → «**Son CERO.** `nefan-core/data/games/*/world/` está en `.gitignore:81` (`git check-ignore` lo confirma): caché local regenerable, CI no los ve, tocarlos no es entregable. Ya lo dejó escrito #302 el 27-ago.»
- **§3, añadir tres filas**: el 100 % de los footprints es `[1,1]` (el arreglo no cambia nada observable hoy) · derivar el radio a secas rompe 19 tests y reabre la puerta de 1 m de #289 · la única fuente de footprints ≠ `[1,1]` es `migrations.ts:53-58`, que los escala ×4 desde un save v3.
- **§4, #300** → cambiar «la 1 no es opcional» por «**la 2 va primero**; si el tope entra, la 1 se queda sin sujeto y se decide entonces, con la medida delante».
- **§4, #301** → quitar «los **dos** tiles commiteados»; añadir «decidir qué pasa con el token `structures` de `arch-rules.json:242` + `architecture.test.ts:392` y con la mitad caducada del comentario de `scene-schema.ts:20-24`».
- **§5** → aplicar las sustituciones de los criterios 1, 2, 4, 5 y 8.
- **§6** → «cada uno en su commit, en el orden **#301 → #187 → #300**: #301 y #300 mueven el mismo golden».
- **§7, añadir** → «#302 ya corrigió la premisa de los snapshots; releerlo antes de empezar #301».
