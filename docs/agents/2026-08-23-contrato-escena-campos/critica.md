# REENCUADRADA (ambos) — una sola tanda, y #175 va primero

**#173**: la elección que el issue plantea no existe — la vía 2 es imposible, y el alcance real es
mayor (tres puntos de estrangulamiento, no uno, y la pérdida no es solo el skin). **#175**: problema
real y solución correcta, pero el alcance está mal en las **dos** direcciones: `style_tag` casi
hecho, `room_id` esconde estado muerto que nadie lee. **No hay elección de producto** — nada aquí
quita capacidad a quien juega. No parar.

## El problema real, en una frase

Un NPC nacido de `generate_scene` sale del contrato **desvestido y sin oficio** — mismo skin y mismo
comportamiento para todos (#173); y a su lado el mismo fichero arrastra tres nombres que solo se
copian a sí mismos (#175). Las soluciones propuestas atacan eso, salvo la vía 2 de #173, que ataca
un problema inexistente.

## La premisa, afirmación por afirmación

### #173

| Afirmación del issue | Verificación |
|---|---|
| `role`/`description` no están en `generate_scene.json` | **CIERTO**. Las props de entity son `id, kind, name, cell, footprint, glyph, shape, h, texture_hash, model_hash, attach, style_ref`. Ni `role` ni `description` |
| `formatDToWorld` los propaga «si llegaran»; sin `role`, `npcSkinStyleRef` cae siempre a `commoner` | **CIERTO** — `src/scene/scene-normalize.ts:172-184` y `src/games/style-categories.ts:34-35` (`styleRoleForNpc(undefined)` = `commoner`) |
| Vía 2: `role`/`description` son «código que nadie puede alimentar» | **FALSO, y es el dato que cambia el veredicto**. `role` y `description` **sí** están declarados en el contrato: `data/contract/tools/narrative_react.json:76-97`, consecuencia `spawn_entity` (`role` con enum `peasant/guard/villager/merchant`, `description` **required**). Los consume `nefan-html/src/main.ts:2202-2205`. La rama está viva; retirarla rompería el spawn |

**Lo que el issue no dice y agranda la tarea:**

1. **No es un punto de estrangulamiento, son tres.** Además del tool JSON: `data/contract/prompts/scene_instructions.md:22` documenta `style_ref` y nada más (el motor no lee el JSON, lee esto); y `ai_server/narrative_schemas.py:665-698` construye `clean_ent` con **allow-list** y solo copia `style_ref`, `texture_hash`, `model_hash`, `h`, `attach`. Aunque el motor los emitiera hoy, ai_server los tira. Es el mismo fallo que ya se arregló para `style_ref` (comentario en `narrative_schemas.py:684-689`: «sin whitelist aquí se perdía en silencio»), **repetido en los dos campos vecinos**.
2. **La pérdida no es solo el skin.** `role` alimenta la **vida ambiental**: `src/narrative/npc-records.ts:168` lo mete en `EntityRecord.data`, y `src/simulation/npc-roles.ts:92` resuelve el preset con default `villager`. Sin `role`, **todo NPC de escena es un villager** (wander 6 m, huye del combate) — un guardia declarado no se queda quieto ni percibe la pelea.
3. **`description` es el prompt del skin**, no adorno: `nefan-html/src/main.ts:964` (`npc.description ?? npc.name ?? npc.id`) y `nefan-html/src/ui/style-apply.ts:247`. Sin él, el skin IA de cada NPC se pinta desde su **nombre propio** («Beltrán»), no desde su aspecto.
4. **Dos «fuentes únicas» que no casan.** `styleRoleForNpc` (`style-categories.ts:16-27`) se declara FUENTE ÚNICA y mapea `guard|soldier|warrior→warrior`, `noble→noble`; `NPC_ROLES` (`npc-roles.ts:30`) se declara FUENTE ÚNICA y es `peasant, guard, villager, merchant`. Las ramas `noble` y `soldier|warrior` son **inalcanzables**. Decidir «el vocabulario coherente» es decidir esto, y no está en el enunciado.

### #175

| Afirmación | Verificación |
|---|---|
| `godot/scripts/main.gd` y `canvas-renderer.ts` ya no existen; `scene-normalize.ts` duplica los ids | **CIERTO** los dos (actualización del 2026-08-22 del propio issue; `src/scene/scene-normalize.ts:218-221`) |
| `style_tag` casi a cero | **CASI**. Vivo en un sitio que el issue no lista: **`nefan-core/data/games/colonia_aster/world.md:82`** le dice al motor «Preferir escenas con `style_tag` settlement…» — y `ai_server/narrative_schemas.py:534` lo **descarta**. Es una instrucción viva a un campo muerto, y está dentro de los roots del candado (`nefan-core/data/**/*.md`): añadir `style_tag` a `campos-retirados-no-vuelven` pondrá **rojo ese fichero de juego el primer día**. Correcto, pero hay que ir a por él |
| *(requisitos)* `room_id` es también campo de `WorldState` | **CIERTO y peor**: `src/types.ts:92-94` declara `room_id`/`room_data`/`rooms_visited`; `src/store/reducers.ts:89-103` los **escribe**; y **nadie los lee** fuera de `test/store-immutability.test.ts` y `test/bridge-routing.test.ts`. No es un alias que renombrar: es **estado muerto que se borra entero** (`WorldState` se queda en `region`/`time_of_day`/`atmosphere`). El `rooms_visited` de `serialize-llm.ts:66` es **otro** campo (cuenta de `scenes_loaded` en `NarrativeState`) y no se toca |
| *(requisitos)* el legacy tiene prioridad sobre el moderno | **CIERTO en un sitio, falso en el resto**. Solo `bridge/context.ts:267`: `scene.room_description ?? scene.scene_description`. `context.ts:192` es moderno-primero; `bridge/handlers/tile.ts:123` y `bootstrap-tile.ts:67` son **escrituras** del mismo valor, no lecturas. Hoy es inocuo porque `narrative_schemas.py:457` los iguala; deja de serlo en cuanto se retire uno |

## El día después

- **Para quien juega**: #173 sí cambia el juego — los NPCs de una escena generada dejan de ser todos el mismo aldeano de aspecto y de conducta. #175 **no cambia nada**, y no pasa nada: es deuda declarada.
- **Qué se vuelve más difícil**: nada de #175. De #173, el vocabulario de `role` queda congelado en dos sitios (tool JSON + `NPC_ROLES`) que pueden separarse — justo el riesgo de #203.
- **Qué hay que borrar y nadie borrará**: `WorldState.room_id/room_data/rooms_visited` con sus acciones (`room_changed`/`room_visited` conservan solo su parte de enemigos) y `bridge/handlers/simulation.ts:135`. Si la tanda solo toca `scene-normalize.ts`, esto sobrevive y el grep no llega a cero.
- **Qué se puede tirar de paso**: las ramas inalcanzables de `styleRoleForNpc`, y los tres tests que se autodenominan legacy (`test/scene-normalize.test.ts:294-323, 352-360`).
- **Qué parecerá arbitrario en un mes**: que un NPC declare su oficio con un enum en `generate_scene` y con **otro** en `spawn_entity`. Que sean el mismo enum es media tarea de #173.

## Conflictos

- **Solapamiento (#173 ↔ #175)**: mismo fichero (`scene-normalize.ts`), mismo test (`scene-normalize.test.ts`), mismo módulo de mutación, mismo `narrative_schemas.py`. Separadas pagan **dos veces** el reloj de mutación de `scene-normalize`. Son **una tanda**.
- **Dependencia oculta con #230** (abierto): #175 modifica `arch-rules.json`, y #230 dice que un cambio en ese fichero manda al selector a **corrida completa**. Hecha hoy, #175 no es gratis: cuesta la nocturna entera. Hacerla junto a #173 amortiza esa corrida en las dos.
- **#203** (fuera de alcance, correctamente): #173 es el **tercer** caso de la deriva que #203 existe para cazar (`style_tag` el primero, `style_ref` el segundo). No bloquea, pero sus dos campos son el mejor caso de prueba de #203 cuando llegue.
- **Contra `CLAUDE.md` y el trabajo reciente**: ninguno. La directiva de pre-producción respalda #175 y la línea «el motor elige la ref de cada NPC» respalda #173 vía 1; `14ea7e2` (#229) acaba de entregar `npm run afectado` / `mutate --cambiado`, que es justo lo que abarata esta tanda.

## Coste contra valor

**#173 lo vale y es lo urgente**: hoy el juego pinta y anima todos sus NPCs iguales, y el arreglo son cinco ficheros pequeños (tool JSON, prompt, allow-list de ai_server, enum compartido, tests). No hacerlo nunca significa que la línea de `CLAUDE.md` sobre vestir NPCs es falsa y que `style_ref` a mano es la única vía — lo que el motor no hace por su cuenta.

**#175 no lo vale por sí sola** (cero efecto en el juego, y una corrida completa de mutación de peaje por #230), **pero sí de acompañante**: es borrado puro, evapora sus mutantes, y su ganancia real no es el alias sino el `WorldState` muerto. «No hacer nada» tiene aquí un coste medible: los tres tests que dicen *«el alias legacy apunta al mismo id»* seguirán enseñando que el alias es contrato.

## Qué le cambiaría a `requisitos.md` (redactado para pegarse)

Sustituir la sección **«#173 — el contrato de entity…»** desde «El issue plantea dos vías» por:

> **El issue plantea dos vías y no elige. El código ya eligió: la vía 2 es imposible.** `role` y `description` están declarados y vivos en el contrato — `data/contract/tools/narrative_react.json:76-97`, consecuencia `spawn_entity` (`role` con enum `peasant/guard/villager/merchant`, `description` required), consumidos en `nefan-html/src/main.ts:2202-2205`. No son una rama sin alimentar. **La tarea es la vía 1, y es mayor que «declarar dos campos»:**
> 1. Declararlos en `data/contract/tools/generate_scene.json` (entity) **y** en
>    `data/contract/prompts/scene_instructions.md:22` — el motor lee el prompt, no el JSON.
> 2. Añadirlos a la **allow-list** de `ai_server/narrative_schemas.py:665-698`: hoy `clean_ent` los
>    tira aunque lleguen, exactamente como tiraba `style_ref` antes de su fix.
> 3. **Un solo vocabulario de `role`**: `NPC_ROLES` (`src/simulation/npc-roles.ts:30`) y el enum de
>    `spawn_entity` deben ser el mismo, y `styleRoleForNpc` (`src/games/style-categories.ts:16-27`)
>    debe cubrirlo sin ramas inalcanzables — hoy `noble`, `soldier` y `warrior` no existen en él.
>
> **Lo que está en juego no es solo el skin**: sin `role`, `src/simulation/npc-roles.ts:92` da a
> TODO NPC de escena el preset `villager`; sin `description`, el prompt del skin IA es el nombre
> propio del NPC (`nefan-html/src/main.ts:964`).

Sustituir el párrafo **«Dato que el issue no trae…»** de #175 por:

> Verificado y corregido en las dos direcciones. **Mayor**: `WorldState.room_id`/`room_data`/`rooms_visited` (`src/types.ts:92-94`) los **escribe** `src/store/reducers.ts:89-103` y **nadie los lee** fuera de dos tests — es estado muerto que se borra entero, con `bridge/handlers/simulation.ts:135`. (El `rooms_visited` de `src/narrative/serialize-llm.ts:66` es otro campo y no se toca.) **Menor**: de las cuatro «prioridades del legacy» solo una es real, `bridge/context.ts:267` (`room_description ?? scene_description`); `tile.ts:123` y `bootstrap-tile.ts:67` son escrituras del mismo valor.
> **Aviso**: `style_tag` sigue vivo en `data/games/colonia_aster/world.md:82`, que instruye al motor a emitir un campo que `ai_server/narrative_schemas.py:534` descarta; ese fichero está en los roots del candado y se pondrá rojo el primer día. Sitios de grep no listados: `nefan-html/src/main.ts:773`, `labs/narrative/check-scene.ts:114`, `src/narrative/migrations.ts:66`.

Añadir al final de **«Criterios de aceptación»**:

> - **Una tanda, y #175 primero.** Comparten `scene-normalize.ts`, `scene-normalize.test.ts`, `narrative_schemas.py` y el módulo de mutación: separadas pagan dos veces el reloj. #175 va antes por ser borrado puro — deja el contrato limpio antes de que #173 le añada dos campos — y porque toca `arch-rules.json`, que hoy fuerza corrida completa (#230): esa corrida se amortiza en las dos.
> - Ninguna decisión de producto pendiente: nada de esta tanda quita capacidad a quien juega.
