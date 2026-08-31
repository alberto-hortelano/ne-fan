# QA — El enemigo que vuelve (#326)

Rama `fix/enemigo-que-vuelve` (`fca3661`) sobre `main` (`e67f53c`). Todo medido el **2026-08-31**
en el bench `e2e-sin-creditos` (`node qa/run.mjs`, que levanta `./start.sh --preset e2e-sin-creditos`),
**cero créditos**: el guardarraíl declaró `fake:true` por las dos vías en cada corrida y las capturas
llevan `gasto sesión 0,00 € · total 0,00 €`. Ni una llamada a Imagen IA ni al motor real, y **no se
pidió ni se esperó ninguna corrida de mutación** (hay una autorizada en vuelo).

Se validó contra `requisitos.md` —la cita del usuario y su § Decisión—, no contra el plan.

## Cómo se midió

| Instrumento | Qué aporta |
|---|---|
| `qa/guiones/42`, `48` (de la tanda) | corridos tal cual, 3 y 1 veces |
| `qa/guiones/49-el-mundo-de-runtime-aguanta-dos-resumes.mjs` **(nuevo, QA)** | dos resumes seguidos sin segunda puerta + el MUERTO de runtime end-to-end + mide el hallazgo H-4 |
| `qa/guiones/50-el-npc-que-el-cliente-no-tiene-se-dice.mjs` **(nuevo, QA)** | el criterio 6 (el `continue` mudo de `main.ts`), que no tenía candado ninguno |
| 4 sondeos temporales (borrados al cerrar) | herido de la ESCENA tras reanudar · muerte al disco en el acto · save sin `max_health` · bridge caído · viaje de ida y vuelta |
| `npm test` de `nefan-core` con piezas retiradas a mano | reproducción de los rojos declarados y caza de verdes vacíos |
| Capturas de `qa/capturas/<corrida>/` | crítica visual |

## Criterios de aceptación

Los criterios 2 y 3 están fundidos en el 1 por decisión del propio `requisitos.md`; se desglosa en
subfilas porque son afirmaciones distintas y no todas tienen la misma evidencia.

| # | Criterio (literal de `requisitos.md`) | | Evidencia |
|---|---|---|---|
| 1a | el de runtime **vuelve** — se pinta | ✅ | guion 48 (`Secuaz`, `Nogala`, `Cofre de la posada`, `Forja de Robledo` tras reanudar) y guion 49 tras DOS resumes |
| 1b | …**y el sim lo tiene como combatiente, se le puede pegar y responde** | ✅ | guion 48: `Secuaz queda en 38 PV` → reanudar → `hp 37,66` → `✔ …y el enemigo que vuelve es alguien a quien PEGAR: el sim lo tiene y su vida baja otra vez`. Y responde: el registro del juego alterna `narr_npc_… hit: -7.7 HP` con `Player hit: -16.3 HP` (captura `48-01`) |
| 1c | el herido **vuelve herido**, procedencia RUNTIME, con su denominador | ✅ | guion 48: `hp 37,66 / maxHp 60`; la barra no sale llena |
| 1d | el herido **vuelve herido**, procedencia ESCENA, con su denominador | ✅ | sondeo QA: `bandido_1` herido a 32 PV → reanudar → `{"hp":31.27,"maxHp":60}`, HUD `32`. Unitario `bridge-session.test.ts` «resume: la escena sale al wire con la vida VIVA» |
| 1e | el muerto **no vuelve**, procedencia ESCENA | ✅ | guion 42 bloque 3, 3/3 corridas: `tras reanudar: {"enemigos":[],"barra":null,"nombres":["Vida"]}` con el tabernero en escena como precondición |
| 1f | el muerto **no vuelve**, procedencia RUNTIME | ✅ | guion 49 bloque 3 (**nuevo**): matar al `Secuaz` → reanudar → no está ni él ni su barra, y Nogala/forja sí |
| 1g | (implícito) la muerte llega al disco sin cerrar nada | ✅ | sondeo QA leyendo `state.json` en el instante siguiente a la muerte: `bandido_1 → {"health":0,"max_health":60}` |
| 4 | **la vía revertida no vuelve** (guion 42 extendido al resume) | ⚠️ | los dos asertos que candan la vía revertida (bloque 1: «el bridge SIGUE nombrando al enemigo tras el tile nuevo» y «se le puede volver a herir») están VERDES. Pero **el guion 42 entero está ROJO en la rama** por otro aserto suyo: ver H-1 |
| 5 | **la clase entera de entities de runtime** vuelve al reanudar | ✅ | guiones 48 y 49: npc hostil + npc pacífico + objeto + edificio, y el pacífico **se mueve** (canal `state_update.npcs`). Matiz medido en H-4: fuera del resume, objeto y edificio se pierden al re-emitir el tile |
| 6 | **fail-loud por capa**, incluido el `continue` mudo de `main.ts` | ⚠️ | el hueco nombrado en el criterio está tapado y **funciona**: guion 50 (nuevo) lo ejerce y lee `scene … el bridge mueve al NPC "…" y el cliente no lo tiene en escena: anda invisible`, una sola vez. Pero el bridge **sí** se traga en silencio un bloque roto y su fallback resucita al muerto: H-2 |
| 7 | **candado ejecutable** desde el arranque, cero créditos, probado en rojo | ⚠️ | 48 y 49 y 50 lo cumplen (rojos reproducidos por mí, ver «Rojos verificados»). El 42 **no está verde en la rama**, así que el candado que el criterio dice extender no cierra |
| 8 | **sin deuda nueva**: `npm run verify` verde, `deuda` sin crecer, mutación pedida | ⚠️ | `npm run verify` VERDE medido por mí (`tests 1704 · pass 1704 · fail 0`, más build, los dos typechecks y lint), y `tsc --noEmit` + `eslint src` de `nefan-html` limpios. `npm run deuda` contra `main` **no lo re-medí** (ver «No probado»). La mutación está correctamente PEDIDA: `npm run mutacion -- local mundo-persistido` y `… local hostiles` se niegan por falta de medida previa, y `mutacion-huella.json` no se tocó |

### Las tres decisiones del usuario, por separado

| Decisión (§ Decisión de `requisitos.md`) | | Evidencia |
|---|---|---|
| El estado de combate sobrevive al resume para las DOS procedencias | ✅ | filas 1a–1f |
| Vuelve la CLASE ENTERA (hostil, pacífico, objeto, edificio) | ✅ | guiones 48 y 49 |
| **La muerte es permanente en el save. Reanudar deja de resucitar** | ✅ | 1e, 1f, 1g + unitario «LA MUERTE ES ABSORBENTE». Con una excepción alcanzable solo con un save previo a la tanda: H-2 |

## Rojos verificados por mí (no me creí la tabla del informe)

Reproducidos quitando la pieza, mirando el rojo y restaurando (`git status` limpio después):

| Pieza retirada | Qué se puso rojo |
|---|---|
| `this.refreshCombatantsFromRuntime();` de `save()` | `narrative-state.test.ts`: los 2 casos nuevos · `bridge-session.test.ts`: «matar a un enemigo llega AL DISCO» |
| `estado.health <= 0` → `< 0` en `escenaConCombateVivo` | `mundo-persistido.test.ts`: «al MUERTO se le quita del npcs[]» — `el muerto no vuelve; el vecino pacífico sí` |
| `max_health: HOSTILE_HEALTH` de `combatForHostileRole` | `hostiles.test.ts`: «un rol hostil trae vida, arma y personalidad completas» |
| `for (const spawn of spawns) materializeSpawn(spawn)` del resume | **guion 49** bloque 1: tras el segundo resume solo quedan `bandido_1` y el tabernero |
| el guardado al morir de `handleInput` | **guion 49** bloque 3: el `Secuaz` muerto vuelve `hp 60 / maxHp 60` con su barra |
| el `continue` mudo restaurado en `main.ts` | **guion 50**: el panel no dice nada del personaje que el bridge está moviendo |

Y **un negativo que NO sirve**, contado porque cuesta descubrirlo dos veces: quitar el filtro de
muertos de `spawnsDeRuntime` deja los guiones verdes. El muerto sí sale de ahí, pero el cliente lo
rechaza en su segunda puerta (`enemigoDesdeCombat` exige `health > 0`); lo único que cambia es que
el registro de errores se llena de un descarte que no es un fallo. Ese filtro lo mide el unitario,
no los guiones — está anotado en la cabecera del guion 49 para que nadie lo vuelva a intentar.

## Hallazgos

### H-1 · BLOQUEANTE — la tanda deja el guion 42 en ROJO, y el informe lo declara verde

`implementacion.md` §3 dice: «**42** · `1 en verde · 0 en rojo de 1`, incluido el bloque 3». No es
reproducible. Medido **3 de 3 corridas** limpias en la rama:

```
ledger: barkeep [5.26,0,-12.17] → [5.29,0,-12.05] · bandido_1 [10.98,0,1.19] → [17.95,0,0.80]
✘ el registro del hostil no lo mueve nadie mientras el del mercader sí se mueve
```

Y **1 de 1 corrida en `main`**, el mismo guion, verde:

```
ledger: barkeep [5.85,0,-11.03] → [5.85,0,-10.86] · bandido_1 [12.25,0,0.75] → [12.25,0,0.75]
✔ el registro del hostil no lo mueve nadie mientras el del mercader sí se mueve
```

**Causa**: `refreshCombatantsFromRuntime` escribe `rec.position = toTuple(c.position)` de **todo**
combatiente en cada `save()`. El aserto del 42 es el reverso medido de «un hostil no entra en la
vida ambiental» (#323): decía que al registro del hostil no lo mueve **nadie**. Ahora lo mueve el
save. El plan lo anticipa sin verlo («la posición sale gratis», §3 opción A), pero nadie tocó el
guion, así que el candado que esta tanda dice *extender* se queda roto.

No es un defecto de comportamiento evidente —la posición que se escribe es la autoritativa del sim,
y para el spawn de runtime es justo lo que hace que vuelva donde estaba—, pero es una decisión que
hay que tomar explícitamente y dejar escrita en el guion, no descubrir en la siguiente tanda.

**Reproducción**: `git checkout fix/enemigo-que-vuelve && node qa/run.mjs 42`.
**Criterio que incumple**: 7 («candado ejecutable… probado en rojo») y 4 («esta tanda lo extiende
en vez de escribir uno nuevo»); y el hábito del repo: `qa/run.mjs` es uno de los candados
ejecutables de CLAUDE.md.

### H-2 · IMPORTANTE — un `data.combat` sin `max_health` NO se rechaza en voz alta por la vía de la escena: **resucita al muerto, en silencio**

`plan.md` §5 e `implementacion.md` §5 afirman: «un `data.combat` sin `max_health` lo rechaza
`enemigoDesdeCombat` **en voz alta**». Eso solo es cierto para la procedencia de RUNTIME. Medido:

- **Runtime** — el jugador ve en el registro de errores
  `session · entity "narr_npc_…": combat.max_health inválido (undefined) — sin denominador la barra
  de vida miente — no vuelve al mundo`. Correcto en el canal, aunque en jerga (H-7).
- **Escena** — `estadosDeCombate` (`wire-scene.ts`) descarta el bloque roto con un `console.warn`
  **del proceso del bridge** y sirve la escena SIN overlay, o sea con el bloque DERIVADO. Como el
  bloque derivado siempre está entero, el cliente no rechaza nada: el enemigo que el jugador había
  **matado** vuelve `alive:true, hp 60 / maxHp 60`, con su barra llena, y en pantalla no hay ni una
  línea. Es exactamente el defecto que la tanda existe para matar, reintroducido por el peor
  fallback posible.

**Reproducción** (medida así, el 2026-08-31): partida nueva → matar a `bandido_1` → recargar al
título → en `state.json` borrar `max_health` de los `data.combat` → «Reanudar». Resultado:

```
mundo tras reanudar: {"enemigos":[{"id":"bandido_1","hp":60,"maxHp":60,"alive":true}], …}
panel de errores: ["Errores (1)", "session … entity \"narr_npc_…\": combat.max_health inválido …"]
```

**Qué esperaba el usuario**: que un save que no vale se rechace en voz alta (es lo que #334/#336
montaron con `save_invalido`) o, como mínimo, que el fallback NO sea «resucita y cúralo». Hoy el
gate del save no mira `data.combat`, y el fallback elegido es el peor de los dos posibles: el
seguro sería tratar el bloque ilegible como *sin datos vivos* → dejar al enemigo fuera y decirlo, o
rechazar el save entero.

**Criterio que incumple**: 6 («si al reanudar una entity no se puede registrar, se dice por el canal
de su capa» — un `console.warn` del servidor no es el canal de algo que el jugador ve; el patrón
del repo para el bridge es `narrative_status: error`). Atenuante real: solo es alcanzable con un
save anterior a la tanda o corrompido a mano, y «pre-producción: los saves viejos no importan».
Por eso es importante y no bloqueante — pero entonces lo que sobra es la frase del informe que
dice que se rechaza en voz alta.

### H-3 · IMPORTANTE — la mitad de `max_health` que va al SIM no la comprueba nada

Quité el cableado en **las dos** puertas (`handleAddCombatants` y `handleLoadRoom` dejan de pasar
`enemy.maxHealth` a `createCombatant`, que vuelve a colapsar `maxHealth = health`) y corrí la
batería entera de `nefan-core`:

```
ℹ tests 1704 · pass 1704 · fail 0
```

Verde. Y los guiones tampoco lo verían: 48 y 49 afirman `maxHp` de la **Entity del cliente**, que
sale de `enemigoDesdeCombat`, no del sim. O sea que la mitad del cambio que el propio plan justifica
por el comportamiento —`enemy-ai.ts:116` se retira por debajo del **30 % de `maxHealth`**, y
`game-loop.ts:237` cura a `c.maxHealth` en el respawn— **entra en verde con la pieza quitada**. El
zod exige el campo, pero nadie comprueba que se use.

Es exactamente el tipo de verde que la tanda 4 aprendió a cazar, y aquí quedó uno. Un aserto de
tres líneas en `bridge-tile.test.ts` (`sim.getCombatant("lobo_1").maxHealth === 60` sobre el
`add_combatants` que ese test ya manda) lo cierra.

**Criterio que incumple**: 7 (todo lo nuevo con candado) y el espíritu del 8.

### H-4 · IMPORTANTE (preexistente, confirmado) — un objeto o edificio de runtime desaparece al re-emitir su tile

El ingeniero lo reporta como fuera de alcance. **Confirmado jugando**, y por un camino más común
que el que él describe: no hace falta re-entrar por el borde, basta el panel «Salidas».

**Reproducción desde el arranque**: partida nueva en `alta_fantasia` → hablar con el tabernero
(turnos 2 y 3 del motor: aparecen `Secuaz`, `Nogala`, `Cofre de la posada` y `Forja de Robledo`) →
en el panel «Salidas» viajar a «Molino del bench» → volver a Robledo por la salida de vuelta.
Resultado medido (guion 49, tres corridas, y un sondeo aparte):

```
⚠ HALLAZGO re-emisión del tile: {"cofre":false,"forja":false,"pacifico":true,"hostil":true}
  objetos ahora ["hito del tile (1,0)","casa del leñador"]
```

El cofre y la forja se han ido; el pacífico y el hostil siguen. **Causa**: `addTile` purga
`objectEntities` por **rect** (`!ids.has(o.id) && !inRect(o.pos)`), mientras NPCs y enemigos se
purgan por `tileKey` —y un spawn de runtime no tiene `tileKey`, así que sobrevive—. El objeto no
tiene esa salvaguarda.

**¿Incumple el criterio 5?** Literalmente **no**: el criterio dice «vuelven **al reanudar**», y el
resume lo repara — medido en la misma corrida, tras el tercer resume el cofre y la forja vuelven
del ledger. Pero rompe la misma promesa («lo que el motor puso delante sigue ahí») en un estado que
el jugador alcanza mucho antes que un resume, y con el agravante de que el mundo se cura solo al
reanudar, que es un comportamiento imposible de explicar. **Merece issue** y va MEDIDO en el guion
49 con la marca `⚠ HALLAZGO` (convención del guion 24) para que no se pierda.

### H-5 · MENOR — el edificio de runtime aparece ENCIMA del jugador, y el cofre dentro del edificio

Los tres spawns del turno 3 caen en el MISMO punto: `resolvePositionHint("near_player")` devuelve
`jugador + forward * 5` sin desplazar por ordinal, así que `Cofre de la posada` y `Forja de Robledo`
comparten coordenada exacta (`{"x":6.05,"z":-4.46}` los dos, guion 48). Al reanudar, el jugador
vuelve a su posición guardada y se encuentra la cara pegada a una caja marrón de 4×4×2,5 m que
ocupa media pantalla, con el cofre invisible dentro. Las capturas de la tanda —que son la evidencia
visual del trabajo— enseñan justo eso.

No lo introduce esta tanda (el `position_hint` es viejo), pero sí lo estrena el turno 3 nuevo del
motor falso, y un motor real que spawnee dos cosas en un turno hará lo mismo. Se sale con el
`stuck` de `collidesAt` (no se queda atrapado), así que es feo, no bloqueante.

### H-6 · MENOR — el enemigo de la ESCENA vuelve a su celda de spawn; el de RUNTIME vuelve donde estaba

Medido dos veces: en el guion 48, `bandido_1` estaba en (8,01 · 0,70) y reanuda en
**(12,25 · 0,75)**, su celda del Format D; en el sondeo del herido, el mismo `bandido_1` a 32 PV
reanuda también en (12,25 · 0,75). El `Secuaz` de runtime, en cambio, reanuda en su posición
exacta. La vida viaja para los dos, la posición solo para uno.
Ningún criterio la pide, y para el jugador el efecto es que el enemigo al que estaba esquivando
reaparece en la otra punta del pueblo. Vale la pena decidirlo, no heredarlo.

### H-7 · MENOR — lo que el jugador lee cuando algo falla es jerga

`entity "narr_npc_1788201390_0": combat.max_health inválido (undefined) — sin denominador la barra
de vida miente — no vuelve al mundo`. El canal es el correcto y el mensaje es exacto para quien
programa; para quien juega, «combat.max_health inválido (undefined)» no significa nada. Es la misma
familia del hallazgo abierto del QA de #334 («el TEXTO que lee el jugador» cae al genérico).

### H-8 · MENOR — el resume anuncia los spawns como si acabaran de pasar

Tras reanudar, el registro dice, en este orden:
`El mundo vuelve con 4 cosa(s) que puso el motor` · `✨ edificio: Forja de Robledo` ·
`✨ objeto: Cofre de la posada` · `✨ Nogala aparece` · `⚔ Secuaz ataca`.

La primera línea es honesta; las cuatro siguientes las escribe `materializeSpawn`, que no sabe que
está rehidratando, y le cuentan al jugador que un enemigo *acaba de atacar* y que una posadera
*acaba de aparecer* cuando lo que pasó es que volvió a su partida. Cuesta una línea (pasarle a
`materializeSpawn` si es un resume) y quita ruido de un momento que ya es confuso.

### H-9 · MENOR — dos asertos nuevos que no pueden ponerse rojos

- `qa/guiones/48`, «…y el cliente TIENE su cuerpo en escena: no anda invisible» →
  `Boolean(vuelto.npc)`, y tres líneas antes hay un `if (!vuelto) return`. Es una tautología: nunca
  puede fallar. Lo que dice de verdad ya lo dice el aserto de arriba.
- `qa/guiones/42` bloque 3, los dos asertos de duplicados corren sobre `enemigos: []` y
  `nombres: ["Vida"]` — listas vacías por construcción (el sujeto del bloque es que no vuelva
  nadie). No pueden fallar sin que falle antes el aserto anterior.

Ninguno hace daño; los dos ocupan sitio de un candado que sí mediría algo. (En el guion 50 que
dejo, el aserto de dedupe nació con el mismo defecto —`<= 1` es verde también con cero entradas— y
lo cambié a `=== 1` antes de darlo por bueno.)

### H-10 · MENOR — el `console.warn` de `refreshCombatantsFromRuntime` (desviación 5 del informe)

«Un combatiente sin registro en el ledger» sale por `console.warn` del proceso del bridge y no lo
ejerce ningún test. Es el mismo canal que H-2 y la misma objeción, con mucho menos daño: aquí lo que
se pierde es la vida de alguien que el motor no puso.

## Estados del sistema recorridos

| Estado | Resultado |
|---|---|
| Arranque desde el título, partida nueva, camino normal | ✅ el flujo entero del criterio 1 se juega sin tocar nada raro |
| **Reanudar dos veces seguidas** | ✅ sin duplicados: ids de enemigos, npcs y objetos únicos, y ninguna barra repetida (guion 49). Los cuatro siguen ahí |
| **Reanudar tres veces** (49 hace un tercero tras matar) | ✅ igual |
| **Matar y cerrar de golpe** | ✅ la muerte está en el `state.json` en el instante siguiente (`{"health":0,"max_health":60}`) porque `handleInput` guarda en el tick de la muerte, en el bridge: cerrar la pestaña llega tarde para deshacerla |
| **Reanudar con el bridge caído** | ✅ (sin cambios respecto a `main`, y sin partida a medias) el título ni siquiera llega a pintarse: el cliente cae a modo fixtures con 0 tarjetas de «Reanudar» y el registro dice `bridge did not connect within 5000ms`. No hay forma de reanudar a medias porque no hay forma de reanudar. El mensaje está en inglés y nombra un puerto — mismo H-7 |
| **Save sin `max_health`** | ❌ H-2 |
| Viaje por «Salidas» y vuelta (re-emisión del tile) | ❌ H-4 para objeto y edificio; ✅ para npc pacífico y hostil |
| Cambio de tile andando, con enemigo herido | ✅ guion 42 bloques 1 y 2 (el candado de la vía revertida sigue vivo) |
| Diálogo abierto durante el spawn | ✅ el cliente suprime el ataque con el panel abierto; se cierra y se pelea |
| Muerto + `R` (respawn) | ⚠️ **no probado**, declarado por el ingeniero y confirmado leyendo: `game-loop.ts:237` cura a TODOS los combatientes, el muerto reaparece VIVO en pantalla hasta el siguiente resume. El save no se deshace (muerte absorbente, candado en `narrative-state.test.ts`). Es §2 de #325 y está fuera de alcance |

## Workarounds usados

| Workaround | Veredicto |
|---|---|
| `?input=scripted` + `window.__nefan` para conducir | **No es un hallazgo**: es la vía del banco desde siempre; las entradas van por el mismo driver que el teclado y los asertos leen el HUD y las listas del juego, no píxeles |
| Editar `state.json` en disco para fabricar un save sin `max_health` y para romper el `combat` de la entity pacífica | **No es un hallazgo, y es el precedente del guion 46**: el sabotaje va en el DISCO y se entra por «Reanudar» desde la tarjeta del título, o sea por el camino del jugador. Es la única manera de alcanzar dos estados que el jugador sí puede tener (un save de antes de la tanda, un fichero a medio escribir) |
| Forzar un guardado con `POST /map/place` (State API) para que la herida viaje | **Hallazgo menor, ya declarado por el ingeniero** (desviación 2): pegarle a alguien no guarda la partida. Es la misma garantía que la posición del jugador desde #245 y el jugador no lo nota mientras haya diálogo, pero significa que **la herida del último tramo se pierde** si cierras justo después de pelear. Sin issue |
| Matar el proceso del bridge de MI corrida (comprobando `/proc/<pid>/cwd`) | **No es un hallazgo**: era el sujeto de la prueba. Ningún proceso ajeno tocado en toda la validación |

## No probado

- **`npm run deuda` contra `main`.** No re-medí la comparación de colas (exige `coverage` en las dos
  ramas). Sí verifiqué `npm run verify` verde en la rama y que `mutacion-huella.json` no está tocado.
- **La mutación de lo que importa**: confirmado que el aviso del ingeniero es exacto —
  `mutation-targets.json` no tiene **ni un** módulo sobre `src/narrative/**`, y de `bridge/**` solo
  `state-http-dispatch`, ajeno a esta tanda. `npm run mutacion -- local mundo-persistido` y
  `… local hostiles` se niegan los dos por falta de medida previa. La cláusula del criterio 8 no
  comprueba nada del grueso, y el informe lo dice sin adornos: **eso está bien hecho**.
- **`respawn()` con un muerto guardado** (ver tabla de estados): leído, no jugado. Fuera de alcance.
- **Gasto real de créditos**: por construcción no hubo ninguno; nada que probar.
- **Partida larga / mundo vaciándose de enemigos**: el coste que el usuario aceptó no se puede
  observar en una sesión de bench.

## Crítica visual

- Las capturas del criterio funcionan: tras reanudar y **no** volver el muerto, el HUD queda con
  una sola barra («Vida») y el pueblo entero se pinta — la ausencia se lee de un vistazo, que era
  lo que había que conseguir.
- Lo que no funciona es el encuadre del mundo de runtime (H-5): en `48-01`, `48-02` y `49-01` la
  mitad izquierda de la pantalla es una caja marrón plana sin sombra propia ni detalle, a menos de
  dos metros de la cámara, con las etiquetas «Forja de Robledo», «Secuaz» y «Nogala» apiladas en
  una columna de 120 px. No se distingue qué es cada cosa ni dónde acaba el edificio; el cofre
  simplemente no existe en pantalla. Un jugador que reanuda ahí no sabe si el juego se ha roto.
- El número de la barra de un enemigo (`60`) se dibuja **fuera** del panel translúcido del HUD,
  sobre el mundo: en `48-01` queda gris oscuro sobre marrón oscuro y es ilegible. La barra del
  jugador sí cae dentro. Es preexistente, pero esta tanda va justo de que ese número deje de mentir
  — y de poco sirve si no se lee.
- Coherencia de luz y escala: el greybox del bench no admite juicio de dirección de arte (materiales
  de tablero de ajedrez, el atlas es el falso). No lo evalúo.

## Guiones que dejo

- `qa/guiones/49-el-mundo-de-runtime-aguanta-dos-resumes.mjs` — dos resumes sin segunda puerta, el
  muerto de RUNTIME que no vuelve (procedencia que ningún guion recorría andando), y H-4 medido con
  `⚠ HALLAZGO`. Probado en negativo por dos piezas distintas.
- `qa/guiones/50-el-npc-que-el-cliente-no-tiene-se-dice.mjs` — el criterio 6, que no tenía candado
  ninguno (`nefan-html` no tiene tests). Probado en negativo devolviendo el `continue` mudo.

Los dos declaran `aisla = ["saves", "fake-ai"]` y no declaran `sinMotor`: pasan por el guardarraíl
de cero créditos como todos.

## Veredicto

**No apto** — por H-1, y solo por H-1.

El trabajo del sujeto está hecho y está bien hecho: los tres desenlaces que la tanda existía para
impedir (el de runtime que no vuelve, el herido que vuelve entero, el muerto que resucita) están
cerrados para las dos procedencias, con candados que se ponen rojos de verdad, y el informe del
ingeniero es honesto justo donde era fácil no serlo (la mutación que no mide nada, el verde de
`updated_at` que cazó él mismo). Pero la tanda **deja roja la batería de QA** —3 de 3 corridas,
verde en `main`— y el informe la declara verde: eso es lo único que no se puede cerrar así, porque
el siguiente que corra `node qa/run.mjs` no sabrá si ese rojo es suyo o de aquí.

Para pasar a **apto**: decidir qué hacer con el aserto del guion 42 —lo natural es actualizarlo a
lo que ahora es cierto («al registro del hostil no lo mueve la VIDA AMBIENTAL», que es lo que
protegía), no dejar de escribir la posición— y volver a correr el 42 hasta verlo verde. H-2 y H-3
son baratos y deberían ir en la misma vuelta: H-3 es un aserto de tres líneas, y H-2 es elegir un
fallback que no resucite. H-4, H-5 y H-6 son issues, no correcciones de esta tanda.
