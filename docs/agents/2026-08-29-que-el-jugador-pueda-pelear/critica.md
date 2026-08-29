# Crítica — #323 **REENCUADRADA** · #322 **VIGENTE** (con una corrección a su criterio de cierre)

La premisa es **cierta** y no la he leído: la he ejecutado. Pero el circuito que dibuja #323 está mal
en dos sitios que cambian el diseño, y las «dos verdades» entre las que manda elegir son **el mismo
fósil visto dos veces**.

## 1 · El problema real, en una frase

Este juego tiene combate y **nunca ha tenido con quién**: en seis meses ningún enemigo ha perdido un
punto de vida fuera de un test unitario. No es «falta un valor en un enum»: es que **ninguna de las
tres capas que se prometen combate entre sí tiene productor**, y las tres descienden de un formato
borrado en julio.

## 2 · La premisa, ejecutada

**Playtest real** — `qa/run.mjs`, preset `e2e-sin-creditos`, guion de usar y tirar ya borrado.
Guardarraíl: cliente y bridge declararon `fake:true`; gasto = 4 llamadas al motor falso, **0 €**.

- Partida real de `alta_fantasia` con el tile del motor: **0 barras de enemigo**, 0 frames
  `add_combatants`, 4 `state_update` con **0 enemigos**. Atacar con el catálogo de la sesión no dañó
  nada y el `combat-log` no trajo una sola línea de daño.
- Tile añadido con un NPC hostil declarado **como el contrato permite** (`kind:"npc"`, `role:"guard"`,
  descripción hostil): **0 enemigos**.
- Tile con una entity que trae bloque `combat`, saltándose el gate a propósito: **0 enemigos**, 0
  `add_combatants`.

**Probe del código de producción** (tsx): `dispatchConsequences` con el `spawn_entity` más hostil
que el tool admite deja entities `type:"npc"` y `projectEnemiesFromEntities` → **0** (con un `combat`
de contrabando, igual); `EmittedSceneSchema` **RECHAZA** las tres formas de declarar algo hostil
(`combat`, `kind:"creature"`, `kind:"enemy"`) y acepta el control; `formatDToWorld` con `combat` en
la entity emite `objects[]` y `npcs[]` **sin `combat`**.

**Confirmado, con dos correcciones que el issue necesita:**

1. **`bridge/context.ts:305` NO es la única vía a `GameStore.enemies`.** Hay tres: `context.ts:303`,
   `handlers/simulation.ts:143` (`load_room`) y `:220` (`add_combatants`).
2. **Y no es la que importa.** `getEnemyStates` (`context.ts:493-509`) exige *además*
   `sim.getCombatant(id)`, y la proyección narrativa **no añade combatientes al sim**: sólo
   `load_room` y `add_combatants` llaman a `sim.addCombatant`. Aunque `projectEnemiesFromEntities`
   aceptara algo, no habría con quién pelear. El corte real está antes y en otro sitio:
   **`formatDToWorld` nunca emite `combat`**, así que el lector del cliente
   (`nefan-html/src/main.ts:955-1008`) es rama muerta.

**Y la arqueología deshace la pregunta de diseño.** El bloque `combat` fue diseño **una sola vez**,
en `cb8dcf6` (2026-05-19), como shape de `SpawnEnemyAction` del **ScenarioRunner** — el comentario lo
decía: *«(scenario spawn shape)»*. `fd8ef5c` (PR #54, 2026-07-06) **borró ese productor y en el mismo
diff reetiquetó el comentario a «(spawn_entity consequences)»** sin comprobar que `spawn_entity`
supiera emitirlo. `ui_systems.md:54` se escribió el 2026-08-01 (PR #103), **un mes después**,
copiando el comentario ya corrompido; el lector del cliente es otro fósil, de `data/rooms/*.json`,
muertas en PR #209. La «media implementación» de la primera salida **es un fósil con la etiqueta
cambiada**, y no inclina la balanza a ningún lado.

## 3 · ¿Ha peleado alguien alguna vez? Casi

Un solo rastro: `labs/narrative/runs/2026-07-10_22-05-00/events.ndjson` (gitignored) — un
`add_combatants` con `bandido_1` y **11 `attack_landed`, los once del bandido al jugador**. El enemigo
se quedó en `hp:200` de principio a fin; el jugador no atacó ni una vez. Cero `enemy_damaged`, cero
`enemy_died`. En `saves/` (7) y `archivo/saves/` (180), ninguna entity `type:"enemy"` ni bloque
`combat`; en 225 capturas, ninguna con enemigo. **Nadie ha herido nunca a nada.** Y dos guiones lo
dicen por escrito: `qa/guiones/22:297` («sin enemigos en la fixture no hay a quién dar») y
`qa/guiones/17:399` («no hay quien pegue en el tile del bench»).

## 4 · El día después

- **Para quien juega**: por primera vez hay algo contra lo que pelear. Es el issue de más valor de la
  cola y no hay debate.
- **Lo que se vuelve más difícil**: **#300** (el sim ignora `footprint`: toda criatura se mueve como
  un círculo de 0,5 m) y **#298** (el NPC que huye vuelve a la pelea cada 10 s) pasan de latentes a
  visibles el mismo día — describen conducta que **sólo existe si hay combate**.
- **Lo que despierta**: `npc-behavior.ts:328-337` (`flees_from_combat`/`intervenes_in_combat`) y los
  `appendAmbient` de `simulation.ts:73-84`, que no se han ejecutado nunca en partida.
- **Lo que habría que borrar y nadie borrará**: si gana la vía viva, `src/store/state-projection.ts` y
  `test/state-projection.test.ts` sobran enteros. Dejarlos deja **dos vías a `enemies` con una sola
  viva** — justo lo que parecerá arbitrario dentro de un mes.

## 5 · Conflictos

- **Con `e8c7484` (PR #324), de ayer**: `EntitySchema` es `.strict()` con **exactamente 12 campos**,
  con argumento medido («censadas las 95 entities … cero claves fuera de las 12»). Declarar algo
  hostil toca un candado de un día: vale, pero **como campo 13 declarado**, nunca aflojando el
  `.strict()`, y actualizando su `errorMap`.
- **Con una fixture commiteada**: `data/contract/fixtures/reaction/invalid/spawn_kind_invalido.json`
  **exige que `entity_kind:"creature"` sea RECHAZADO**, y `qa/guiones/40:130` afirma lo mismo. Si el
  enum crece, las dos se invierten. Trabajo que hay que ver antes, no obstáculo.
- **#322 no estorba, pero la familia es más floja que el enunciado**: su arreglo es prosa de un
  fichero y no comparte una línea con #323. Mantenerlo por barato, no justificarlo por familia.

**Coste contra valor**: la vía viva está entera y ya funcionó una vez en julio — falta un productor,
no un sistema. No hacerlo nunca deja la matriz 5×7, las tres armas y la IA por personalidad como
museo: mantenidas, medidas por mutación y jamás ejercidas. **Hacerlo.**

## 6 · Los seis criterios del §4: uno nace verde y otro nombra la razón equivocada

- **1** — descargado por esta crítica; no repetirlo, lo que queda es el 3. **2 y 3** — rojos de
  verdad; el 3 es el que aguanta la tanda. **5** — rojo de verdad (`:9-10` la forma, `:33` la
  prohibición, `:154-155` y `:159` la checklist). **7** — verde y se queda verde: mi corrida gastó 4
  llamadas, todas al motor falso, con las dos vías declarando `fake:true`.
- **4 — NACE VERDE.** `test/combat-systems.test.ts:189` («player can kill the enemy») ya afirma
  `enemy.health === 0` tras atacar: tal como está escrito, se cumple sin tocar nada.
- **6 — la razón es falsa.** El guardia (`test/contract-prompts.test.ts:240`) no ve `combat` por dos
  motivos, y el issue nombra el menor: (a) `TOKEN` exige un `_`, sí — pero (b) sólo comprueba que el
  token **exista** en el corpus, y `combat` existe a espuertas (`src/combat/`, `combat_config.json`).
  Arreglar el snake_case **no lo cazaría**; ni a `size`/`terrain` de #322.

## 7 · Qué le cambiaría a `requisitos.md` (para pegar)

- **§2, el circuito** → *«Hay tres dispatchers de `enemies_projected` (`context.ts:303`,
  `simulation.ts:143`, `:220`), y la vía narrativa es la única que NO añade combatiente al sim —
  `getEnemyStates` exige `sim.getCombatant`, así que un enemigo que sólo esté en `GameStore.enemies`
  no existe para el combate. La vía VIVA es world scene → `objects[].combat` → cliente →
  `add_combatants`, entera salvo que `formatDToWorld` nunca emite `combat`.»*
- **§3/#323, el dilema** → *«Las dos "verdades" son el mismo fósil del ScenarioRunner (`cb8dcf6`),
  cuyo productor borró `fd8ef5c` reetiquetando el comentario. Ninguna es evidencia de diseño: se
  elige por dónde está la vía viva, y es la del cliente.»*
- **§4, criterio 4** → «…lo comprueba **un guion del banco desde el arranque**, no un test unitario:
  `test/combat-systems.test.ts:189` ya lo afirma y no ha cazado nada». **Criterio 6** → «El guardia
  débil de #203 **no puede** cazar esta clase: no comprueba que el prompt se HONRE, sólo que el token
  exista — y `combat`, `size` y `terrain` existen».
- **§5** → la batería es de **39** guiones, no 40 (la numeración llega a 40 porque falta el 04):
  tercera vez que ese número sale mal. **§6** → «No es arreglar #298 ni #300, pero los dos se harán
  visibles el día que haya enemigos: van al informe de QA, no al diff». **§2** → `kind:"creature"` no
  es que «no aparezca»: está **activamente rechazado** por el enum, por `spawn_kind_invalido.json` y
  por `qa/guiones/40:130`.
