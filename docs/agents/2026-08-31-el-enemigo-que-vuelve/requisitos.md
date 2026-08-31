# Requisitos — El enemigo que vuelve (#326)

## Petición del usuario (literal)

La petición de fondo de la serie es:

> «Vamos a seguir priorizando reducir el numero de issues»

Sobre la hoja de ruta aprobada tras el triaje del 2026-08-30, el usuario arrancó esta tanda con:

> «continua con la tanda 5, la mutacion se esta ejecutando en github, tardara horas»

La tanda 5 de esa hoja de ruta es: **#326 — el resume vuelve a registrar al combatiente en el
sim**. La segunda mitad de la frase es una **restricción operativa**, no parte del sujeto: hay
una corrida de mutación autorizada en marcha, así que **nadie pide otra ni la espera**; el
trabajo se cierra sin ella (ver «Restricciones»).

## El problema real (una frase)

Un enemigo creado en runtime por la consequence `spawn_entity` **desaparece entero al reanudar
la partida** —no se pinta, no existe para el sim— porque la única vía de alta de combatientes
nace del Format D de la escena, y un spawn de runtime no aterriza en ninguna escena.

## Fuentes de verdad

```bash
gh api repos/alberto-hortelano/ne-fan/issues/326 --jq '.body'
gh api repos/alberto-hortelano/ne-fan/issues/326/comments --jq '.[].body'
```

El issue lo escribió QA jugando, validando #323. Su comentario del 30-08 (auditoría) trae el
**aviso central de esta tanda**: la vía obvia ya se probó y se retiró midiendo.

## Medido HOY sobre `e67f53c` (por el coordinador, antes de la crítica)

### La cadena de alta de un combatiente

1. `formatDToWorld` emite `npcs[].combat` para los NPC con `role:"hostile"` de la escena
   (`combatForHostileRole`, `src/combat/hostiles.ts` — **única** fuente del bloque).
2. El cliente lo materializa: vía (a) `main.ts:1035-1050` (npcs de la escena) y vía (b)
   `materializeSpawn` (`main.ts:2611-2650`, effect en vuelo). Las dos pasan por
   `enemigoDesdeCombat` y las dos llaman a `gameClient.addEnemies` → `add_combatants`.
3. `handleAddCombatants` (`bridge/handlers/simulation.ts:189-230`) da de alta en el sim y
   proyecta al store **por concatenación**.

### Lo que pasa al reanudar

- `reseedSimForSession` (`bridge/handlers/session.ts:245-270`) hace `sim.reset()` y **solo
  re-registra al player** (con HP y posición del `NarrativeState`, que sí viajan vivos por
  `bindPlayerRuntime` ← `world-claim.ts:70`).
- `npcSync` (`bridge/context.ts:499-523`) **sí rehidrata desde el ledger**: recorre
  `narrative.entities`, filtra por escena activa + vecindario y da de alta en la vida
  ambiental… **excluyendo explícitamente a los hostiles** (`isHostileRole`, `:516`) con motivo
  escrito y medido: `NpcBehaviorSystem` muta `record.position` cada tick y a un combatiente lo
  mueve la IA de combate — dos dueños de la misma posición. Es decir: **el patrón «rehidratar
  desde el ledger al reanudar» ya existe en el bridge**, y el hostil está deliberadamente fuera
  de ESE canal.
- El cliente **no lee `state.entities` para el mundo**: el único lector de todo `nefan-html` es
  `ui/history-browser.ts:129`, el libro de historia — o sea, tras reanudar el jugador puede
  **leer** al enemigo que el mundo ya no tiene. Corolario: lo que se pierde no es solo el
  combatiente, es toda entity de runtime… **y no de forma simétrica** (crítica): `npcSync` SÍ
  rehidrata al npc pacífico de runtime y el bridge lo emite en `state_update.npcs`, pero el
  cliente lo tira mudo en el `continue` de `main.ts:2112-2114` — el pacífico no desaparece,
  **medio existe**: anda e invisible. Objeto y edificio sí desaparecen enteros, y nunca
  estuvieron en la colisión del servidor (`sim-collision.ts:71-104` deriva del `scene_data`).
- El bloque `combat` sí está en el `EntityRecord` (`consequence-handler.ts:110-119`) con su
  justificación ya corregida en el código: «el ledger es lo que LEE EL MOTOR… NO devuelve el
  enemigo al reanudar… Escribirlo aquí es la mitad que hace falta».

### El HP vivo de un enemigo no lo persiste nadie

`SessionData` (`src/narrative/types.ts:163-190`) no tiene campo de enemigos; lo único que hay es
`entities[].data`, donde `combat.health` es el valor **inicial** derivado (`HOSTILE_HEALTH = 60`),
no el vivo. `bindPlayerRuntime` ata al sim **solo al player**.

**El criterio de cierre del issue compara contra algo que no existe** (medido y EJERCIDO por el
crítico, `critica.md` §premisa): el enemigo de la escena **no** vuelve con su vida —
`combatForHostileRole` devuelve `HOSTILE_HEALTH = 60` constante (`hostiles.ts:31,54-66`),
`formatDToWorld` lo emite en `npcs[].combat` y el cliente lo pasa verbatim a `add_combatants`;
`bootstrapTile()` → `formatDToWorld` da `bandido_1 {"health":60,…}`. La verificación de #323 que
el issue cita era **cruzar de tile dentro de la misma sesión** (guion 42, sujeto declarado).

Y va más lejos: **el muerto que resucita ya pasa hoy**. `enemy_died` solo toca el store volátil
(`reducers.ts:70-73`) y `recordEntityDespawned` (`narrative-state.ts:643-649`) **no tiene un solo
llamante de producción**. QA de #323 ya lo midió jugando («`bandido_1` —matado dos veces— vuelve
`alive:true, hp:60`», `docs/agents/2026-08-29-que-el-jugador-pueda-pelear/qa.md:201-209`) y el
plan de esa tanda lo dejó en backlog (`plan.md:71`) sin abrir issue.

**Lo que esto le hace al tamaño**: «vuelve» y «vuelve como lo dejaste» **no son dos tamaños**.
Toda rehidratación desde el ledger resucita a los muertos, porque en el ledger no hay muerte;
impedirlo exige persistir runtime del enemigo, y `hp: 0` ES esa persistencia. Por eso los
criterios 1, 2 y 3 se funden en uno: a medias, el enemigo del motor se queda muerto mientras el
de la escena resucita.

### El aviso: la vía muerta

`bridge/context.ts:334-352` documenta, con las dos razones medidas, por qué se retiró
`state-projection.ts` (proyección `NarrativeState.entities` → `GameStore.enemies` que
**reemplazaba** la lista entera en cada broadcast): (1) nunca tuvo productor —filtraba por
`type === "enemy"`, que ningún camino produce—, y (2) estando muerta rompía el combate al
cambiar de tile. Cualquier diseño que se parezca a eso debe explicar por qué no reincide.

## Criterios de aceptación (deben nacer ROJOS)

Los redacta el coordinador; el crítico puede reencuadrarlos y el arquitecto refinarlos, pero
ninguno se da por cumplido sin una comprobación que se haya visto en rojo antes.

1. **El estado de combate sobrevive al resume, para las DOS procedencias** (escena inicial y
   spawn de runtime): el enemigo de runtime **vuelve** —se pinta y el sim lo tiene como
   combatiente, se le puede pegar y responde—, el herido **vuelve herido** y el muerto **no
   vuelve**. Es un solo criterio y no tres: persistir la vida no es trabajo extra, es lo que
   impide que rehidratar resucite. Rojo hoy contra `main` por las dos puntas: el de runtime no
   vuelve (I-3 de #323), y el de la escena, matado (`#hp-text-bandido_1` a 0) y reanudado,
   vuelve `alive:true, hp:60`.
2. *(fundido en el 1)*
3. *(fundido en el 1)*
4. **La vía revertida no vuelve.** El candado **ya existe** —`qa/guiones/42-…mjs`, probado en
   negativo (devolver el `dispatch("enemies_projected", {enemies: []})` lo pone rojo por dos
   asertos)—; esta tanda lo **extiende al resume** en vez de escribir uno nuevo.
5. **La clase entera de entities de runtime**, no solo el hostil: npc pacífico, objeto y
   edificio vuelven al reanudar. Lo pide el coste (el cliente ya tiene constructor único para
   las tres, `materializeSpawn`; el bridge ya tiene el discriminador `spawn_reason`) y lo pide
   el estado de hoy: el pacífico ya está medio existiendo, y dejarlo así es un defecto vivo
   sobre este mismo resume.
6. **Fail-loud por capa** (CLAUDE.md § Errores): nada de `catch` mudo ni de rehidratar «lo que
   se pueda» en silencio; si al reanudar una entity no se puede registrar, se dice por el canal
   de su capa. Hueco concreto ya localizado: el `continue` mudo de `main.ts:2114`, cuya
   justificación escrita («un tile aún no cargado») hoy tapa un defecto — un id que el bridge
   nombra y el cliente no tiene no puede seguir cayéndose sin decir nada.
7. **Candado ejecutable**: guion en `qa/guiones/` que recorra el flujo real desde el arranque
   (spawn → herir → guardar → reanudar → comprobar), **sin gastar créditos**, probado en rojo
   contra `main`. Si algo del sujeto es puro, además unit test en `nefan-core`.
8. **Sin deuda nueva**: `npm run verify` verde, `npm run deuda` sin crecer, y si el módulo
   tocado tiene batería de mutación, sus supervivientes nuevos se justifican o se matan **con
   la medida local** (`npm run mutacion -- local <id>`) si cabe en el tope.

## Restricciones

- **Cero créditos.** Todo el bench por `e2e-sin-creditos` / fake-ai-server. Ninguna llamada a
  Imagen IA ni al motor real.
- **Hay una corrida de mutación autorizada en vuelo** (Actions, horas): NO se pide otra, NO se
  espera, y no se toca `mutacion-huella.json` fuera de lo que exija el trabajo. Si un módulo
  nuevo entra en `mutation-targets.json`, su medida queda **pedida** con motivo escrito, como en
  la tanda 4.
- **No matar servidores ajenos.** Hay otros agentes en la máquina: `NEFAN_PORT_OFFSET` libre,
  `./start.sh --parar` como mucho, nunca `pkill`.
- **Pre-producción**: cero compatibilidad hacia atrás. Un save que no encaje falla ruidoso; no
  se añaden ramas para saves viejos.
- **El cliente solo pinta**: la lógica de quién es combatiente vive en core/bridge.

## Lo que NO entra

- Rediseñar la economía de combate (#325, #298): son decisiones de diseño del usuario, pendientes.
  En particular **no se toca `respawn()`** (§2 de #325), que es el mismo defecto en otro evento.
- Meter hostiles en la vida ambiental (`NpcBehaviorSystem`): tiene motivo medido en contra
  (`context.ts:509-516`). Un hostil rehidratado va al sim, no a la vida ambiental.
- **Sellar el spawn en el `scene_data` persistido**: es lo que se hizo con `exits` y causó #179.
- Re-difundir la escena activa al reanudar (repaga el atlas — medida de #179).
- Tocar el contrato del motor narrativo salvo que el arquitecto demuestre que es la única vía.

## Preguntas abiertas (resueltas con el visto bueno del usuario)

- **#325 · ¿el muerto lo está para siempre en el save?** Con la muerte persistida y sin curación
  de enemigos, el mundo **se vacía de enemigos sin vuelta atrás** (repoblarlo es cosa del motor
  narrativo, que sí puede seguir spawneando). Esta tanda no crea ese defecto —hoy los muertos
  resucitan al reanudar, que es el exploit opuesto— pero **hace permanente** la respuesta que se
  elija. La decisión es del usuario y va aquí abajo, en § Decisión.

## Decisión (visto bueno del usuario, 2026-08-31, tras la crítica)

Preguntado con las medidas de la crítica delante, el usuario eligió:

1. **Alcance: estado de combate + clase entera.** Persistir existir / vida / muerte para las dos
   procedencias (escena inicial y spawn de runtime), y que vuelvan también npc pacífico, objeto
   y edificio. Queda dentro, por tanto, el resucitado que #323 dejó en backlog sin issue y el
   npc pacífico que hoy anda invisible.
2. **El muerto lo está para siempre.** La muerte se persiste en el save: matar tiene
   consecuencia y reanudar deja de resucitar. Se acepta con el coste delante — sin curación ni
   reaparición el mundo se va vaciando de enemigos, y **repoblarlo es cosa del motor
   narrativo**, que sigue pudiendo spawnear. Esto **resuelve la §2 de #325** en la dirección
   «muerte permanente»; el resto de #325 (curación, respawn del jugador) sigue siendo suyo y no
   se toca aquí.

## Aviso de medida (dato, no bloqueo)

`#340` deja `src/narrative/**` fuera de la mutación y `bridge/**` sin medir: si la lógica de esta
tanda aterriza ahí, la cláusula de mutación del criterio 8 **no comprobará nada**. Que el
ingeniero lo diga en su informe en vez de apuntarse un verde vacío.
