# Requisitos — tanda BG: Una fixture no hereda los plugins de la pre-generación, y fuera el homónimo (#368)

## Petición literal del usuario

> «lanzada la mutacion. Sigue cerrando todos los issues que puedas de forma autonoma. El objetivo es reducirlos al minimo» (2026-09-24)

## Decisión del usuario (AskUserQuestion, 2026-09-24)

«#368 … ¿Se levanta el aparcamiento para este arreglo pequeño?» → **«Sí, solo #368 (Recomendado)»**: vaciarPluginsActivos en los dos sitios y renombrar el homónimo; #361 #362 #363 siguen en futuro.

## Triaje previo (2026-09-24)

| 368 | HACEDERO (F9 + renombrar F7) | S | T5 | F9 sigue y está PEOR: `sesion-efimera.ts:79-83` descarta la sesión sin `vaciarPluginsActivos`, y `handleLoadRoom` (`handlers/simulation.ts:174-214`) tampoco los vacía, así que una fixture hereda los plugins de la pre-generación. F7: `getPluginRecord` y `resolvePluginRecord` siguen con nombres homónimos (`narrative-state.ts:919-923`). F6 ya se hizo en #394 |

## El issue, verbatim

> Deuda menor del sistema de plugins: slice_size_hint muerto, dos resolvers homónimos y activePlugins sin purga en load_room
> 
> De la revisión de arquitectura del 2026-09-01 (hallazgos F6, F7, F9). Tres cortes pequeños e independientes; se pueden cerrar por separado citando este issue.
> 
> **F6 — `slice_size_hint` es un campo muerto.** Declarado en `src/plugins/types.ts:191` con comentario «§7.9 — el bridge avisa cuando el slice rebasa 10× este hint». Una sola ocurrencia en el repo: la declaración. Ya admitido en `next.md:301`, pero el schema se lo enseña al LLM como si funcionara. O se implementa el aviso o se retira el campo (pre-producción: retirar entero).
> 
> **F7 — dos resolvers casi homónimos con semántica opuesta.** `resolvePluginRecord` sigue `superseded_ids` y `getPluginRecord` no reenvía a propósito (`narrative-state.ts:794-808`): «identidad del MANIFEST» vs «identidad del SISTEMA», y elegir mal es un bug silencioso. Además las `projections` no se re-ejecutan al migrar (`register.ts:19-20`): una projection añadida en v2 queda muerta para siempre en toda sesión que migre. Renombrar para que el nombre diga la semántica, y decidir/documentar la política de projections en migración.
> 
> **F9 — `activePlugins` sobrevive al load_room.** `handleLoadRoom` (`bridge/handlers/simulation.ts:115-141`) resetea el sim, el sistema de combate y suelta la atadura del save (`world-claim.ts:130`), pero no toca `ctx.activePlugins`: una sesión de fixture conserva los manifests de la partida anterior. (El candado de escritor único va en PR aparte; esto es la purga.)

## Restricciones

- Números de guion RESERVADOS: 210-213. Otras tandas en paralelo: AX atlas, AY lint qa/labs, AZ clientes WS del banco, BA skins/tema UI, BB título, BC bases de mutación y anclas (`qa/mutacion-*`).
- Nunca matar procesos ajenos. Commit y PR solo cuando lo pida el coordinador. Node: `source ~/.nvm/nvm.sh && nvm use node`. Cero créditos.
