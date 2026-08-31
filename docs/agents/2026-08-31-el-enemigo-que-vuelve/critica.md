# Crítica — El enemigo que vuelve (#326)

**Veredicto: REENCUADRADA** — el defecto es real, pero el issue compara contra un comportamiento que
no existe y el documento parte en tres tamaños un trabajo que es **uno solo**. Corrijo en las dos
direcciones: es MAYOR de lo que dice el issue (el muerto que resucita ya pasa hoy, y con el enemigo
de la escena) y MENOR de lo que pide el criterio 4 (ese candado existe y nació rojo).

## El problema real, en una frase

El estado de combate de un enemigo —**existir** incluido— vive solo en la memoria del sim y al
reanudar se resiembra desde la escena persistida: el spawn de runtime no está ahí y desaparece, y
lo que sí está renace con la vida del contrato, no con la que le dejaste.

## La premisa, verificada (todo medido por mí sobre `e67f53c`)

| Afirmación | Verificación |
|---|---|
| El resume no re-registra al combatiente de runtime | ✔ `session.ts:245-271` resiembra con `sim.reset()` + solo `player`; en el cliente el resume solo recorre `scenes_loaded` (`main.ts:2947-2962`). El spawn nunca aterriza en un `scene_data` (`consequence-handler.ts:111-117`) |
| **«El de la escena vuelve con la vida que le dejaste»** | ✘ **FALSO, y es el hallazgo central.** `combatForHostileRole` devuelve `HOSTILE_HEALTH = 60` constante (`hostiles.ts:31,54-66`), `formatDToWorld` lo emite en `npcs[].combat` (`scene-normalize.ts:190-200`) y el cliente lo pasa verbatim a `add_combatants` (`main.ts:1040-1062` → `simulation.ts:198-218`). **Ejercido**: `bootstrapTile()` → `formatDToWorld` da `bandido_1 {"health":60,…}`. Nada persiste HP de enemigo: `SessionData` (`types.ts:163-190`) no tiene campo y `bindPlayerRuntime` ata solo al player (`world-claim.ts:61-75`) |
| La verificación de #323 que cita el issue fue cruzar de tile | ✔ `qa/guiones/42-…mjs:1-46`: su sujeto declarado es el cambio de tile **dentro de la sesión** |
| «El muerto que resucita lo introduce un arreglo apresurado» | ✘ **Ya pasa hoy.** `enemy_died` solo toca el store volátil (`reducers.ts:70-73`); nada escribe la muerte en el ledger (`recordEntityDespawned`, `narrative-state.ts:643-649`, **sin un solo llamante de producción**). QA de #323 lo midió jugando: «`bandido_1` —al que había matado dos veces— vuelve `alive:true, hp:60`» (`…/que-el-jugador-pueda-pelear/qa.md:201-209`); el plan de esa tanda lo dejó en backlog (`plan.md:71`) y nunca se abrió issue |
| El cliente no lee `state.entities` | ✔ y más preciso: hay UN lector en todo `nefan-html`, `ui/history-browser.ts:129` — el libro de historia. Tras reanudar, el jugador puede LEER ahí al enemigo que el mundo ya no tiene |
| La pérdida cubre toda entity de runtime | ✔ en el cliente, pero **no es simétrica**: `npcSync` (`context.ts:499-523`) SÍ rehidrata al npc pacífico de runtime y el bridge lo emite en `state_update.npcs`; el cliente lo tira sin decir nada (`main.ts:2112-2114`). El pacífico no desaparece: **medio existe**, andando e invisible. Objeto y edificio sí desaparecen enteros, y nunca estuvieron en la colisión del servidor (`sim-collision.ts:71-104` deriva del `scene_data`, no de `entities`) |

**Lo que esto le hace al tamaño**: «vuelve» y «vuelve como lo dejaste» **no son dos tamaños**. Toda
rehidratación desde el ledger resucita a los muertos, porque ahí no hay muerte; impedirlo exige
persistir runtime del enemigo, y `hp: 0` ES esa persistencia. Los criterios 1, 2 y 3 son **una sola
pieza**: a medias, el enemigo del motor se queda muerto y el de la escena resucita.

## Las opciones: cuál está muerta, cuál no ve el issue

- **Opción 1 (rehidratar desde `entities`) — VIVA**, con discriminador ya persistido: `spawn_reason`
  tiene dos productores y dos valores, `scene_init` (`npc-records.ts:151-158`) y `narrative_request`
  (`consequence-handler.ts:116`); y `add_combatants` ya dedupe (`simulation.ts:199`).
- **Opción 2 (bridge único poblador) — VIVA, pero no resuelve esto sola**: retirar `add_combatants`
  no le dice al cliente **qué pintar**. **Muerta por medida** es solo la proyección
  `entities → GameStore.enemies` que REEMPLAZABA la lista (`context.ts:334-352`); dar de alta, no.
- **Tercera vía, VIVA y que el issue no ve**: el bridge ya enriquece la world scene con estado de
  sesión antes del wire (`enrichSceneWithExits`, `context.ts:244-263`) y el cliente ya tiene UNA
  puerta para las tres clases (`materializeSpawn`, `main.ts:2611-2680`). Medida **contra una de sus
  formas**: sellar el spawn en el `scene_data` es lo que se hizo con `exits`, y causó #179.
- **Alcance: la clase entera**, por coste: el cliente ya tiene constructor único para las tres y el
  bridge el discriminador; hacer solo al hostil aplaza trabajo sobre este mismo resume, no lo evita.

## El día después

- **Para quien juega**: hoy basta reanudar para borrar lo que el motor puso delante.
- **Más difícil**: el ledger deja de ser append-only puro, y el candado
  `la-atadura-del-save-vive-con-el-dueno-del-mundo` obliga a atarlo en `world-claim.ts`.
- **Nadie lo borrará**: la barra de un muerto no se retira nunca (`main.ts:1160-1189`; `enemy_died`
  no la toca — I-4 de #323, sin issue). Persistir la muerte la hace sobrevivir al resume.
- **Se puede tirar**: el `continue` mudo de `main.ts:2114` pierde su justificación escrita («un tile
  aún no cargado»): hoy tapa un defecto. Es el hueco del criterio 6.

## Conflictos

- **#325 (economía, decisión del usuario PENDIENTE)**: no bloquea, **pero hay que preguntar**. Su §2
  y el criterio 3 son el mismo defecto en dos eventos (`respawn()` vs resume), y con la muerte
  persistida y sin curación (#325 §1) el mundo **se vacía de enemigos sin vuelta atrás**: esta tanda
  no lo crea, lo hace permanente. Pregunta: *¿el muerto lo está para siempre en el save?*
- **#179**: mismo agujero estructural (el resume no re-enriquece), con su «cómo no arreglarlo» ya
  medido: re-difundir la escena activa repaga el atlas y vuelve a pasar por `addEnemies`.
- **#323 (`c146395`)**: sin contradicción. Su exclusión de hostiles en `npcSync` (`context.ts:509-516`)
  tiene motivo medido y **no se toca**: un hostil rehidratado va al sim, no a la vida ambiental.
- **#337** cerrado y sin relación; **#261** solo pide que el guion espere por estado; **#340** deja
  `src/narrative/**` fuera de la mutación y `bridge/**` sin medir: la cláusula de mutación del
  criterio 8 no comprobará nada si la lógica aterriza ahí. Datos, no bloqueos.

## Coste contra valor

Vale lo que cuesta. No hacer nada deja rota una promesa del bucle central —el motor pone un enemigo
delante y reanudar lo borra, o peor lo resucita—, y no es especulativo: el ledger ya lleva `combat`
y `spawn_reason`, el cliente tiene la puerta y el bridge ya rehidrata la mitad pacífica.

## Los criterios: cuáles nacen rojos de verdad

| # | Veredicto |
|---|---|
| 1 y 2 | **Rojos de verdad hoy** (medido en vivo, I-3 de #323). El escape del 2 («declarar qué parte cumple») **sobra**: no es trabajo mayor, es el mismo que el 3 — quitar la salida |
| 3 | **Verde-que-no-comprueba-nada tal como está** (el de runtime no vuelve, luego no puede resucitar). Se pone rojo HOY contra `main` con el enemigo de la ESCENA: matar a `bandido_1` (`#hp-text-bandido_1` a 0), reanudar, y afirmar que no vuelve a `enemies()` ni tiene barra |
| 4 | **Ya cumplido, no necesita candado nuevo**: `qa/guiones/42-…mjs` lo canda por fuera y está probado en negativo (devolver el `dispatch("enemies_projected", {enemies:[]})` lo pone rojo por dos asertos). Lo que falta es extenderlo al resume |
| 5 | No es rojo, es decisión. Se vuelve rojo si la decisión es «vuelven las tres»: spawnear npc pacífico + edificio, reanudar, afirmar que se pintan |
| 6 | Rojo posible y concreto: un `combat` roto debe salir por `errors.push` (ya lo hace `enemigoDesdeCombat`), y un id que el bridge nombra y el cliente no tiene no puede seguir cayendo en el `continue` mudo de `main.ts:2114` |
| 7 y 8 | Correctos como están |

## Qué le cambiaría a `requisitos.md` (redactado para pegar)

1. **§ Medido, sustituir la nota del criterio de cierre**: «Medido y ejercido: el enemigo de la
   escena NO vuelve con su vida —`HOSTILE_HEALTH = 60` constante, nadie persiste HP de enemigo— y si
   lo mataste vuelve VIVO (`qa.md:201-209` de #323; `plan.md:71`). El issue compara contra algo que
   no existe.»
2. **Fundir los criterios 1, 2 y 3**: «El estado de combate sobrevive al resume: el de runtime
   vuelve, el herido vuelve herido y el muerto no vuelve — para las DOS procedencias. Persistir la
   vida no es trabajo extra: sin ella, rehidratar resucita.» Añadir al 3 la receta roja de hoy con
   `bandido_1`; rebajar el 4 a «el candado ya existe (guion 42), esta tanda lo EXTIENDE al resume».
3. **Criterio 5**: cubrir la clase entera, con el dato de que el npc pacífico de runtime **hoy medio
   existe** (vivo en `npcSync`, invisible en el cliente).
4. **§ Lo que NO entra**: no se toca `respawn()` (#325) ni `exits` (#179), y no se sella el spawn en
   el `scene_data` persistido. **§ Preguntas abiertas (nueva)**: la de #325 para el visto bueno del
   usuario, y el aviso de que `src/narrative` y `bridge` no los mide la mutación (#340).
