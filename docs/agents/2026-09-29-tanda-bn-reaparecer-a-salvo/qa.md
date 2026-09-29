# QA — Tanda BN: reaparecer a salvo, el enemigo te suelta, curar por `player_healed` (#613 A+B+D)

Worktree `/home/al/code/ne-fan-tanda-bn`, rama `feature/tanda-bn`, commit `bc372d64`. Todo en el preset `e2e-sin-creditos` (`node qa/run.mjs`, cero créditos, `gasto` del censo solo del fake). Node 26 (`nvm use node`).

## Revisión del código reconstruido

- **`game-loop.ts`** (`git diff origin/main...HEAD`): solo están los trozos del plan. Son `casas`, `puntoSeguro` (sembrado en `addCombatant("player")` y limpiado en `removeCombatant`/`reset`), el paso 7 al FINAL de `tick` (una desviación documentada y medida), `respawn()` sin argumento que devuelve `{events, punto}`, `soltar()` sobre todas las IA, `curarAlJugador` y `algunoEnganchado`. La guarda de BK (`if (c.health <= 0) continue;`) sigue en su sitio. No se ha perdido nada de `main`: el resto de `tick`, `findNearestTarget` y `getCombatants` son idénticos. No sobra nada.
- **`narrative-state.ts`**: exactamente las 4 líneas de `serializeForLlm()` → `refreshPlayerFromRuntime()`.
- **`game-client.ts`**: se corresponde con el informe. Los cambios son `esperandoReaparicion` (se pone en `respawn()`, se limpia al ENTREGAR el frame, en `loadRoom` y en `olvidarElUltimoFrame`), `acumularFrame` y el re-export de `FrameResult`.
- `npm run verify` en nefan-core: 3681/3681. `npm test` en nefan-html: 76/76. Los dos se corrieron después de añadir mis guiones.

## Criterios

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Mueres y reapareces lejos del que te mató, sin que te vuelva a enganchar: bandido de la escena | ✅ | 260 ✔: «cayó en (8.63,1.50) · reapareció en (2.43,2.80)», a más de 10 m de su sitio. Durante 3 s ni se mueve ni pega |
| …el mismo, **muriendo dos veces seguidas** y con UNA sola pulsación de R | ✅ | 262 ✔: el mismo punto las dos veces, (2.43,2.80). El negativo (quitar `ai.soltar()`) lo pone rojo en «ni se mueve», en las dos muertes |
| …**muriendo nada más cambiar de tile** (ida y vuelta por «Salidas») | ✅ | 268 ✔: reapareció a (2.57,−1.77), fuera del radio, y el tile activo sigue siendo `tile_0_0`. Negativo (apuntar el punto sin mirar `algunoEnganchado`): rojo, «reapareció en el cadáver, 8.98 m» |
| …cuando **el motor pone al hostil a tu lado** (`spawn_entity`, el Secuaz del bench) | ❌ | 264 ✘ en dos corridas: «cayó en (5.22,−11.72) · reapareció en (5.22,−11.72)», a 4.82 m del sitio del Secuaz. «Player hit −0.7 HP» justo después de «Respawned!» (captura). Ver H1 |
| El enemigo vuelve a su sitio | ✅ | 260 y 262 ✔ «vivo y de vuelta en su sitio» (tolerancia 0,25 m) |
| Una poción del motor cura, con tope | ✅ en la misma sesión | 261 ✔ «87 → 97 → 100, y otra más no pasa de 100». Una corrida salió ⊘ porque el jugador acabó la pelea a 100/100: es la precondición del banco, no un fallo |
| …**tras reanudar** la partida herido | ❌ | 266 ✘: la poción, de 79/100, no sube nada. Control: dando al jugador `maxHealth` 100 al reanudar (sabotaje temporal en `session.ts`, restaurado con `cmp`) sale verde, 68 → 78. Ver H2 |
| El botón «R» desaparece | ✅ | 260 y 262 ✔ en las dos muertes. 268 ✔ |
| …y aparece cuando estás muerto **tras reanudar** | ❌ | 267 ✘ «vuelve muerto: se ofrece R» no ocurre. HUD 0/100 sin botón. Ver H3 |
| Resume (muerte sin guardar) | ✅ | 263 ✔: el save no tiene la muerte, así que reanudas vivo en el último guardado, fuera del radio. Negativo (guardar también la muerte del jugador): rojo |
| Resume con la muerte GUARDADA (un muerto que viaja por «Salidas» guarda con 0 PV) | ❌ | 267 ✘: reanudas muerto, R «reaparece» (log «Respawned!», bridge «player respawned en…») y la vida sigue a **0/100**. La partida queda inservible. Ver H3 |
| El bridge no contesta al `respawn` | ✅ mecánico, con reservas de juicio | 265 ✔: con el cable tirando el `respawn`, en 3 s el jugador sigue muerto, «R» sigue ofrecido y el cliente manda **0 inputs** (342 → 342). Otra R con el cable de vuelta lo levanta a 100 y el input vuelve. Negativo (quitar la pausa de input): rojo, «80 inputs en 3 s» |
| Varios enemigos | ⚠️ no probado en navegador | Sonda del sim (tsx, borrada): dos hostiles a 4 m **se enganchan entre sí** en el primer tick y se pegan. `algunoEnganchado()` queda en `true` y el punto seguro se congela en el alta del jugador. Ver H4 |
| Enemigos sin radio de enganche | ⚠️ no probado en navegador | Ningún hostil de partida nace sin radio (`combatForHostileRole` fija 10 m) y ninguna fixture de `data/scenes/` trae enemigos. En la sonda del sim, el punto seguro queda en el alta del jugador y el enemigo vuelve a engancharse desde su casa |

## Hallazgos

### H1 — BLOQUEANTE: el hostil que el motor pone a tu lado te vuelve a enganchar al reaparecer (`qa/guiones/264`)

**Pasos** (`node qa/run.mjs 264`):
1. Nueva partida en `alta_fantasia` y matar al bandido.
2. Hablar con el tabernero dos turnos: el motor falso hace `spawn_entity` del Secuaz a 4,8 m del jugador.
3. Quedarse quieto hasta morir y pulsar R.

**Resultado:** reapareces en el MISMO punto donde caíste, a 4,82 m de la «casa» del Secuaz. Te engancha y te pega en menos de 3 s.

**Causa:** el último tick «fuera de combate» es el anterior a la aparición del Secuaz, así que coincide con tu posición de entonces. La «casa» del Secuaz es donde apareció, dentro de tu radio. `soltar()` suelta, pero el siguiente tick te vuelve a enganchar.

**Qué esperaba el jugador:** que morir rompiera el bucle. Es la frase que abre la crítica («vuelves al mismo sitio, contra el mismo enemigo, que sigue enganchado»). En un open-world donde el motor crea hostiles en caliente, este es el caso normal, no un borde. El plan solo contemplaba este riesgo para el radio infinito de las fixtures.

**Decisión pendiente:** qué es «a salvo» cuando no existe un tick fuera de combate lejos del enemigo. Por ejemplo, exigir distancia mayor que el radio de toda casa viva, o recurrir a `__player_start` del tile. Es probable que tenga que decidirlo el usuario.

### H2 — IMPORTANTE: tras reanudar, la poción no cura (`qa/guiones/266`)

**Pasos:**
1. Herirse matando al bandido (su muerte guarda la partida).
2. Recargar y reanudar: el HUD dice 79/100.
3. Beber `UNA POCION`: la vida se queda en 79.

**Causa:** `reseedSimForSession` (`bridge/handlers/session.ts:274`) crea al jugador con `createCombatant("player", hp, …)` sin `maxHealth`, así que el máximo toma la vida guardada. `curarAlJugador` topa en ese máximo. Además, `estadoDelJugador` pinta `max_hp || 100` desde el store, de modo que el HUD dice /100 y el sim dice /79.

La raíz ya estaba en `main`, pero pieza D la convierte en visible: es la ÚNICA curación del juego, y reanudar herido es lo habitual. La misma causa hace que R tras reanudar herido te levante con la vida guardada y no con 100.

### H3 — IMPORTANTE: un muerto guardado no se puede levantar (`qa/guiones/267`)

**Pasos:**
1. Morir.
2. Muerto, pulsar «→ Molino del bench» en Salidas. El viaje funciona y guarda con 0 PV.
3. Reanudar.

**Resultado:**
- (a) No aparece el botón «R · reaparecer»: `eco.jugadorVivo` no se entera de que está muerto, porque no llega ningún `died`.
- (b) Pulsar R de todas formas da el log «Respawned!» con **0/100**: `maxHealth` vale 0 por la misma causa que H2.

La partida queda inservible (captura `267-…-03-levantado-tras-reanudar.png`). Con el control de `maxHealth`=100, (b) pasa a verde y (a) sigue en rojo, así que son dos defectos. Que un muerto pueda viajar, andar y ver «hablar con Vecino» es anterior a esta tanda; aquí es la puerta a H3.

### H4 — IMPORTANTE: con dos hostiles cerca, el punto seguro se congela

`findNearestTarget` elige a cualquier combatiente vivo. Dos hostiles a menos de 10 m se enganchan entre sí, y `algunoEnganchado()` no mira a quién. En la sonda del sim, con dos bandidos a 4 m:
- se pegan desde t=1,25 s;
- b2 muere;
- b1 va a por el jugador con `engaged` ya en true, desde cualquier distancia;
- el jugador reaparece en su **alta** (z=30) y no en el último paso fuera de combate.

En partida eso es el punto de inicio o de reanudación, que puede estar en otro tile. Ya estaba en `main` (el ingeniero lo nombra en «Qué NO queda cubierto»), pero ahora decide dónde reapareces. El motor puede poner «una banda» de hostiles juntos. No lo he llevado a un guion: el bench no tiene dos hostiles a la vez sin matar antes al primero.

### H5 — MENOR: respawn sin respuesta, silencio

En 265 el jugador pulsa R y no ve nada: ni «reapareciendo…» ni otro cambio. Sale solo si se le ocurre volver a pulsar. Con `canDrive` en falso (otra pestaña con el mundo) cada R se ignora en silencio y se queda así para siempre, sin input. El log del bridge lo dice; el jugador no.

### H6 — MENOR: el HUD enseña 100 PV justo después de reanudar

Durante los primeros frames tras reanudar, el HUD muestra 100 PV aunque vuelvas muerto: es el frame por defecto de `olvidarElUltimoFrame`, hasta que llega el primero del bridge. Lo medí en 263 (la primera versión leyó «100 PV» a un muerto). Ya estaba en `main`.

### H7 — MENOR: el bridge acepta un `respawn` con el jugador vivo

`handleRespawn` no comprueba que el jugador esté muerto. Un `respawn` con el jugador vivo cura a tope y devuelve a todos a casa. El cliente lo impide (`handleRespawnRequest`), pero con «solo cura el motor» es una curación fuera del contrato. En el banco, el 260 manda R en cada sondeo sin que se note.

### H8 — MENOR (banco): la precondición del 261 falla a veces

Una corrida del 261 salió ⊘: el jugador acabó la pelea a 100/100. Es una precondición frágil, no un fallo del juego.

## Crítica visual (capturas de 260, 264, 265 y 267)

- Al morir, el sprite del bandido se come la pantalla entera: está pegado a la cámara. Ya pasaba antes y no es de la tanda, pero la imagen de la derrota es un bulto negro.
- Tras reaparecer (260), la cámara queda entre dos fachadas en una calle estrecha, con el bandido a lo lejos y centrado. Se lee bien. Hay una mancha oscura en primer plano: la sombra del propio jugador.
- El registro dice «Respawned!» también cuando la vida se queda a 0 (H3). El texto contradice a la barra.

## Workarounds usados

- **265, espía sobre `WebSocket.prototype.send` que tira los `respawn`.** Es el hecho que se estudia (la respuesta no llega), no un atajo hacia la función. No afecta al jugador.
- **263, 266 y 267, esperar 1 s de mundo tras reanudar antes de leer el HUD.** Tapa H6, que está reportado.
- **Sabotajes temporales para los negativos**, todos restaurados byte a byte (`cmp`) y con `git status` limpio en `nefan-core`/`nefan-html`:
  - `game-loop.ts`: sin `soltar()`, y el punto sin `algunoEnganchado`;
  - `game-client.ts`: sin pausa de input;
  - `simulation.ts`: guardar también la muerte del jugador;
  - `session.ts`: `maxHealth` 100 como control.
- **Una sesión manual con Playwright** sobre un stack `--keep` (bloque +100), con el sabotaje de guardado ya cargado, para ver el `state_update` de respuesta: `player_respawned hp:0`, `reaparicion` = el cadáver. Se paró con `./start.sh --parar`, que solo toca este worktree.

## Guiones nuevos (`qa/guiones/`)

| Guion | Salida hoy | Negativo |
|---|---|---|
| `262-morir-dos-veces-seguidas-sigue-a-salvo` | ✔ | sin `soltar()` → ✘ en las dos muertes |
| `263-reanudar-muerto-no-te-devuelve-al-bucle` | ✔ | guardar la muerte del jugador → ✘ |
| `264-el-hostil-que-el-motor-pone-al-lado-tambien-te-suelta` | **✘ (H1)** | — (el rojo ES el hallazgo) |
| `265-el-respawn-sin-respuesta-tiene-salida` | ✔ | sin pausa de input → ✘ «80 inputs en 3 s» |
| `266-la-pocion-cura-tambien-tras-reanudar` | **✘ (H2)** | control `maxHealth` 100 → ✔ |
| `267-reanudar-tras-guardar-muerto-te-deja-levantarte` | **✘ (H3)** | control `maxHealth` 100 → solo queda el ✘ del botón |
| `268-morir-nada-mas-cambiar-de-tile-sigue-a-salvo` | ✔ | punto sin `algunoEnganchado` → ✘ |

Corrida final conjunta (260–268): 5 ✔ y 4 ✘. Los rojos son 264, 266, 267 y una versión anterior del 268, que afirmaba de más («lejos del cadáver» cuando el paseo se para justo dentro del radio). Esa afirmación está corregida y el 268 vuelve a salir verde en solitario.

## No probado

- Varios enemigos y enemigos sin radio en el juego real: solo sonda del sim (H4).
- Bridge sin jugador y `canDrive` en falso con dos pestañas: solo lo he simulado tirando el mensaje en el cliente.
- Curación por un **trigger de mapa**: solo la cubre el unitario `bridge-map.test.ts`.
- Mutación de `enemy-ai`, `consequence-handler`, `world-map-schema` y `narrative-state`: queda pedida por el ingeniero.

## Veredicto

**No apto.** Lo que se probó en el escenario del bench funciona: el bandido de la escena, morir dos veces, el cambio de tile, la poción en la misma sesión y el botón R. El código reconstruido está íntegro. Pero el criterio central, «reapareces sin que te vuelva a enganchar», falla en el caso más propio de este juego: el hostil que el motor materializa a tu lado (H1). La curación, que ahora es la única del juego, no funciona tras reanudar (H2). Y un muerto guardado deja la partida inservible (H3). H1 necesita una decisión de diseño; H2 y H3 comparten una causa (el `maxHealth` del reseed) y un arreglo acotado.
