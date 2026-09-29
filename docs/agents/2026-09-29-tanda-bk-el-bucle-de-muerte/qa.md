# QA — Tanda BK, pieza C2 de #613: el muerto no se levanta al reaparecer

Verificado sobre `feature/tanda-bk` @ `2cce0add`, en el worktree `/home/al/code/ne-fan-tanda-bk`, el 2026-09-29.
Banco: `node qa/run.mjs` con el preset `e2e-sin-creditos` en el bloque de puertos +100 (cero créditos).

## Criterio de aceptación (literal)

Sale de `requisitos.md` (alcance decidido tras la crítica): «morir no resucita a los enemigos que ya matamos. La
decisión del usuario del 2026-08-31 dice "el muerto lo está para siempre", y la simulación tiene que respetarla
igual que el save». Criterio de la crítica: «matar un enemigo, morir contra otro, pulsar R → el primero sigue
`alive:false` en el `state_update` y no ataca».

«Para siempre» es un requisito absoluto. Lo he desplegado en estos estados: mismo tile; tras cambiar de tile;
morir y reaparecer en otro tile; tras reanudar; reanudar y después morir y reaparecer; el muerto como último
combatiente del mapa; varios muertos; todos muertos; y dos respawns seguidos.

## Tabla

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Matas al bandido, el Secuaz te mata, pulsas R y el bandido sigue `alive:false` a 0 PV, sin volver en 3 s de sim (flujo real desde el título) | ✅ | Guion 240: 3 corridas en verde (`✔ NO ocurre: tras reaparecer, el bandido que mataste NO vuelve a estar vivo … 20 sondeo(s)`). Sin la guarda se pone rojo (ver «En negativo») |
| El muerto no ataca tras reaparecer | ✅ | En el sim: unitario del ingeniero (188 ticks sin eventos de `a`) y mi scratch, 300 ticks. En juego, el registro del cliente solo trae golpes del Secuaz después del «Respawned!» (capturas de 240 y 241) |
| Se ve tumbado, no de pie | ✅ con reserva | Con `SKIN_SPRITE_MODEL=y_bot`, la captura `241-…-02-b1-mirando-al-bandido-caido.png` (corrida `2026-09-29T11-50-53-793Z-408561`) muestra al bandido en el suelo, a 2,7 m, después de reaparecer. Reserva: con el skin por defecto del banco el muerto se pinta DE PIE (hallazgo 3) |
| Tras cruzar de tile | ✅ | Guion 241, bloque 2 (`tile_0_0 → tile_1_0`): `bandido_1 → {"alive":false,"hp":0,"barra":"0"}` |
| Morir y reaparecer en OTRO tile | ✅ | Guion 241, bloque 2: el Secuaz te sigue, te mata en `tile_1_0`, R, y el bandido sigue `alive:false`/0 |
| Tras reanudar | ✅ | Guion 241, bloque 3: el bandido no está en `enemies()` ni tiene barra (`{"enLista":false,…,"barra":null}`) |
| Reanudar, morir y reaparecer | ✅ (no discrimina) | Guion 241, bloque 3, en verde. Sin la guarda sigue verde, porque tras reanudar el muerto ya no está en el sim: lo cubre el save |
| El muerto es el ÚLTIMO combatiente del mapa (orden de inserción) | ✅ (solo en el sim) | Scratch `adv.test.ts` con el vivo insertado antes y el muerto después: sigue `dead`/0 y el vivo se cura (C1). En rojo sin la guarda. En el juego no se pudo montar: con el bandido vivo, él y el Secuaz te matan a los dos (1 corrida ⊘) |
| Varios muertos a la vez | ✅ (solo en el sim) | Scratch: tres muertos y un vivo intercalados, todos matados por `tick`. Los tres siguen `dead` y el vivo sube a 60. En rojo sin la guarda. El motor falso solo manda un hostil |
| Todos muertos, R, y dos respawns seguidos | ✅ | Scratch: los dos siguen `dead`/0 tras dos `respawn()` y 300 ticks. Juego (241, bloque 4): muerto el Secuaz no queda ningún vivo, R en pie no hace nada, y tras un segundo resume no vuelve ninguno de los dos |
| C1 no cambia (el vivo herido se cura) | ✅ | Unitario del ingeniero; scratch (`vivo.health === 60`); juego: el Secuaz a 60 tras cada R |
| Unitarios + borde del bridge | ✅ | `npx tsx --test test/simulation.test.ts test/bridge-session.test.ts test/narrative-state.test.ts` → 128/128 |
| El guion nuevo pasa los candados del banco | ✅ | `un-salto-del-guion-se-observa`, `un-numero-un-guion`, `el-banco-declara-el-modo-de-gasto`, `el-lint-del-banco…` y `un-solo-barrido-del-banco` → 84/84 |

### En negativo (hecho por QA, no copiado del informe)

Comenté `if (c.health <= 0) continue;` en `nefan-core/src/simulation/game-loop.ts`, corrí y restauré desde una
copia. Después `git diff` sobre `src/` sale vacío.

- `node qa/run.mjs 240 241` → `0 en verde · 2 en rojo`:
  - 240: `✘ NO ocurre: … — ocurrió · último valor {"alive":true,"hp":60}`.
  - 241: rojo en los bloques 1 y 2 (mismo tile, tras cruzar, y morir y reaparecer en otro tile), todos con `{"alive":true,"hp":60,"barra":"60"}`.
- Scratch del sim → `fail 3` de 3.

Los bloques 3 y 4 del 241 siguen verdes sin la guarda. Lo dice su cabecera: son candados de las puertas vecinas
(el save y el filtro de R en el cliente), no de este arreglo.

## Guion nuevo

`qa/guiones/241-el-muerto-no-se-levanta-tras-viajar-ni-reanudar.mjs`, en el rango reservado. Salió en verde 4 de 5
corridas. El rojo cayó en el bloque 3: no llegaba a 1,6 m del Secuaz tras reanudar, con un edificio en medio. Lo
corregí acercándome a 6 m, dentro del radio de enganche de 10 m, y la corrida siguiente de 240+241 salió `2 en verde`.
No está commiteado.

## Hallazgos

**Bloqueantes: ninguno.**

**Importantes**

1. **«R · reaparecer» no se va nunca después de la primera muerte** (preexistente, fuera del alcance, pero en el
   flujo exacto de esta tanda). Pasos: `./start.sh --preset e2e-sin-creditos`, partida nueva de `alta_fantasia`,
   dejarse matar y pulsar R. Con el jugador de pie (100, 85, 72 o 43 PV en distintas corridas), la barra de acciones
   sigue mostrando «R reaparecer». Lo ven todas las capturas posteriores a una muerte, y el 241 lo registra
   como `⚠ HALLAZGO` en los bloques 1 y 3. El jugador esperaba que el botón se fuera al volver a estar vivo.
   - Evidencia de la causa: el registro solo trae UN «Respawned!» (el de `main.ts:537`). El de
     `eco-del-combate.ts:123` no sale nunca, así que el `player_respawned` no llega al eco y `#vivo` se queda en `false`.
   - Hipótesis, no medida: `game-client.ts:213` guarda un solo `pendingFrame`. El `state_update` del respawn y el del
     tick del mismo frame llegan juntos y el segundo pisa al primero con sus eventos. Si es así, se pierden también
     otros eventos de combate cuando llegan dos updates por frame.
   - Pulsar R en pie no hace nada, porque `handleRespawnRequest` filtra por la vida. Lo que queda es un botón que miente.

**Menores**

2. **El registro de combate nombra por id interno a los enemigos que pone el motor**: `narr_npc_1790682666_0 killed!`
   y `… hit: -19.4 HP`. Preexistente, y ya anotado en la QA de 2026-08-29 y en el guion 42. Lo cito porque sale al
   matar al Secuaz en el bloque 4.
3. **En el banco, el cadáver se pinta DE PIE.** El skin falso (`SKIN_SPRITE_MODEL=paladin`) solo tiene `idle`, y el
   fake lo reutiliza para `death` (`labs/narrative/fake-ai-server.ts:131`). Con las capturas por defecto, un enemigo
   muerto no se distingue de uno vivo salvo por la barra y el rótulo. No es un defecto del juego, pero cualquier QA
   visual de «no se levanta» con el banco por defecto mira un cadáver en pie. La receta es `SKIN_SPRITE_MODEL=y_bot`,
   que ya está en la cabecera del 241.
4. **El rótulo «Secuaz» flota muy por encima del cuerpo** cuando está a melé: en las capturas b1 el rótulo va a
   y≈245 px y la cabeza a y≈455–590 px. Preexistente y ajeno a C2. Lo anoto para la pasada de UI.

**Fuera del alcance, observado tal como describe #613**: al pulsar R reapareces donde caíste, con el Secuaz a un
paso, enganchado y a 60. Recibes golpes en el primer segundo (en una corrida volviste a 72 PV) y en las capturas se
sigue viendo «Player hit» después de «Respawned!». Es el bucle A, B y C1, que sigue abierto. La PR no debe venderse
como arreglo del bucle, y su cuerpo no lo hace.

## Workarounds usados

- `setYaw` para encarar al cadáver antes de las capturas. Equivale a mover el ratón, así que no afecta al usuario.
- `SKIN_SPRITE_MODEL=y_bot` en dos corridas, para ver la pose de muerte. Es un límite del banco, no del juego (hallazgo 3).
- Varios muertos y el muerto en último lugar del mapa se probaron en el sim con un script de scratch, no en el juego:
  el motor falso solo manda un hostil de spawn. Un motor real puede mandar varios, así que en el juego queda sin probar.
- Nada se ocultó ni se forzó en el estado. Todas las muertes, del jugador y de los enemigos, se produjeron por
  combate real (`herirHasta` con input del jugador, o quedarse quieto).

## No probado

- Varios muertos, o el muerto como último del mapa, con un motor narrativo real y varios hostiles en el juego. Solo
  se probó en el sim; la lógica no depende de cuántos haya.
- Si el `state_update` que pisa al del respawn es la causa del hallazgo 1. Queda como hipótesis.
- Imagen IA real y créditos: no aplica, porque el arreglo es de simulación.

## Veredicto

**Apto con reservas.** C2 se cumple en el flujo real y en todos los estados probados, y el guion 240 y el nuevo 241
se ponen rojos sin la guarda. La reserva no es de esta pieza: después de la primera muerte, «R · reaparecer» se
queda en pantalla para siempre (hallazgo 1, preexistente). Merece un issue propio.
