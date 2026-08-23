# El contrato de escena: qué se declara y qué se retira (#173 + #175)

## La petición del usuario, literal

Al abrir la cola:

> «Empieza a resolver los issues en orden, deja las dudas para el final y resuelve todo lo que
> puedas con el flujo de agentes»

Y al reanudarla, fijando cómo se tratan los veredictos de este rol:

> «He reiniciado la sesion, ponte con los siguientes issues, si se modifica uno lo modificas y
> si se descarta simplemente pasa al siguiente y al final revisamos los descartados pero no
> pares la ejecucion de los demas a no ser que tengan dependencias y yo tenga que hacer una
> eleccion de direccion del producto.»

Traducción operativa para ti: **tu veredicto no necesita permiso**. Si dices REENCUADRADA, se
reescribe el issue y se sigue. Si dices OBSOLETA, se cierra y se pasa al siguiente. Solo se
para si tu conclusión obliga a elegir **dirección de producto** — quitarle a quien juega una
capacidad, o escoger entre dos rumbos incompatibles. Di explícitamente si crees que es el caso.

## Por qué los dos issues van al mismo crítico

Comparten superficie y **empujan en direcciones opuestas** sobre el mismo fichero:

- **#173** quiere **declarar** dos campos nuevos (`role`, `description`) en el schema de entity.
- **#175** quiere **retirar** tres campos (`room_id`, `room_description`, `style_tag`) del mismo
  contrato y de `formatDToWorld`.

Dos críticos separados no verían esa tensión. Parte de tu trabajo es decir si son una tanda o
dos, y en qué orden.

## #173 — el contrato de entity no declara `role` ni `description`

Cuerpo íntegro del issue: `gh api repos/alberto-hortelano/ne-fan/issues/173`.

Lo esencial: `CLAUDE.md` afirma que el motor viste a cada NPC, pero `role` y `description` **no
están declarados** en `data/contract/tools/generate_scene.json`, así que
`npcSkinStyleRef(npc) = npc.style_ref ?? styleRoleForNpc(npc.role)` cae **siempre** a
`"commoner"` salvo `style_ref` explícito.

**El issue plantea dos vías y no elige. El código ya eligió: la vía 2 es imposible.** `role` y
`description` están declarados y vivos en el contrato — `data/contract/tools/narrative_react.json:76-97`,
consecuencia `spawn_entity` (`role` con enum `peasant/guard/villager/merchant`, `description`
**required**), consumidos en `nefan-html/src/main.ts:2202-2205`. No son una rama sin alimentar.
**La tarea es la vía 1, y es mayor que «declarar dos campos»:**

1. Declararlos en `data/contract/tools/generate_scene.json` (entity) **y** en
   `data/contract/prompts/scene_instructions.md:22` — el motor lee el prompt, no el JSON.
2. Añadirlos a la **allow-list** de `ai_server/narrative_schemas.py:665-698`: hoy `clean_ent` los
   tira aunque lleguen, exactamente como tiraba `style_ref` antes de su fix.
3. **Un solo vocabulario de `role`**: `NPC_ROLES` (`src/simulation/npc-roles.ts:30`) y el enum de
   `spawn_entity` deben ser el mismo, y `styleRoleForNpc` (`src/games/style-categories.ts:16-27`)
   debe cubrirlo sin ramas inalcanzables — hoy `noble`, `soldier` y `warrior` no existen en él.

**Lo que está en juego no es solo el skin**: sin `role`, `src/simulation/npc-roles.ts:92` da a TODO
NPC de escena el preset `villager` (deambula 6 m, huye del combate) — un guardia declarado no se
queda quieto ni percibe la pelea. Sin `description`, el prompt del skin IA de cada NPC es su nombre
propio («Beltrán»), no su aspecto (`nefan-html/src/main.ts:964`).

Esta era una de las tres «dudas» que se iban a preguntar al usuario. El crítico la ha disuelto:
no había dos vías.

## #175 — retirar los shims `room_id` / `room_description` / `style_tag`

Cuerpo íntegro: `gh api repos/alberto-hortelano/ne-fan/issues/175`. Ojo a la **actualización del
2026-08-22** dentro del propio issue: dos de las cuatro ubicaciones que lista el cuerpo original
(`godot/scripts/main.gd`, `nefan-html/src/renderer/canvas-renderer.ts`) ya no existen.

Verificado y corregido por el crítico en las **dos** direcciones. **Mayor**:
`WorldState.room_id`/`room_data`/`rooms_visited` (`src/types.ts:92-94`) los **escribe**
`src/store/reducers.ts:89-103` y **nadie los lee** fuera de dos tests — no es un alias que
renombrar, es **estado muerto que se borra entero**, junto con `bridge/handlers/simulation.ts:135`.
(El `rooms_visited` de `src/narrative/serialize-llm.ts:66` es **otro** campo —cuenta de
`scenes_loaded`— y no se toca.) **Menor**: de las cuatro «prioridades del legacy» que apuntaba la
versión anterior de este documento solo **una** es real, `bridge/context.ts:267`
(`room_description ?? scene_description`); `tile.ts:123` y `bootstrap-tile.ts:67` son **escrituras**
del mismo valor, no lecturas.

**Aviso**: `style_tag` sigue vivo en `nefan-core/data/games/colonia_aster/world.md:82`, que instruye
al motor a emitir un campo que `ai_server/narrative_schemas.py:534` descarta. Ese fichero está
dentro de los roots del candado `campos-retirados-no-vuelven`, así que se pondrá **rojo el primer
día**. Sitios de grep que el issue no lista: `nefan-html/src/main.ts:773`,
`labs/narrative/check-scene.ts:114`, `src/narrative/migrations.ts:66`.

## Criterios de aceptación de la tanda

- Un NPC declarado como guardia en `generate_scene` **se ve** como guardia y **se comporta** como
  guardia: hoy todos son el mismo aldeano de aspecto y de conducta.
- Un solo vocabulario de `role` entre `generate_scene`, `spawn_entity`, `NPC_ROLES` y
  `styleRoleForNpc`, sin ramas inalcanzables.
- `room_id`, `room_description` y `style_tag` a **grep-a-cero** fuera de tests de historia, y
  anotados en el candado `campos-retirados-no-vuelven` (`data/contract/arch-rules.json`).
- Los tests que fijaban los shims se van con ellos, declarando qué cobertura se pierde.
- **Una tanda, y #175 primero.** Comparten `scene-normalize.ts`, `scene-normalize.test.ts`,
  `narrative_schemas.py` y el módulo de mutación: separadas pagan dos veces el reloj. #175 va antes
  por ser borrado puro —deja el contrato limpio antes de que #173 le añada dos campos— y porque
  toca `arch-rules.json`, que hoy fuerza corrida completa (#230): esa corrida se amortiza en las dos.

## Fuera de alcance

Cualquier otro campo del contrato de escena. El guardia de deriva del contrato es #203 y va
en su propia tanda.

## Veredicto del crítico

**REENCUADRADA (ambos), una sola tanda, #175 primero.** Ver `critica.md`.
**Ninguna decisión de producto pendiente**: nada de esta tanda quita capacidad a quien juega.
