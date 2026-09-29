# QA — tanda BL (#618 pieza B + la mitad `npc_arrive` de D, y C = #298)

Worktree `ne-fan-tanda-bl`, rama `feature/tanda-bl`, commit `d8001615`. Node v26.10.0 (`nvm use node`). Cero créditos.

Todo el cambio es del sim del bridge (`npc-behavior.ts`, `npc-director.ts`, una línea de `ws-server.ts`). El cliente no se toca. Por eso el «flujo real» aquí es el mismo que usa el banco para esta familia: el `NpcBehaviorSystem` y el `NpcDirector` montados con el cableado de PRODUCCIÓN (`createSimCollisionProvider` + `createSessionNpcBehavior` + `new NpcDirector(narrative, simCollision)`, como en `ws-server.ts`), leyendo `nefan-core/dist` compilado de HEAD. Como regresión del juego entero corrí además la batería de navegador de NPC con el preset `e2e-sin-creditos`.

Para comparar, compilé el árbol de ANTES (`d0cc2231`) en un worktree temporal del scratchpad y pasé las mismas sondas por los dos.

## Criterios

| Criterio (requisitos.md + decisión del usuario) | Estado | Evidencia |
|---|---|---|
| B · el NPC dentro de un sólido sale aunque esté QUIETO (sin directiva, sin waypoint libre) | ✅ | Guion 250 bloque 1: 28 NPC en los 7 edificios de robledo (geometría del TILE). Salen todos en 0,9–2,7 s y ninguno vuelve a entrar. Bloque 3: un granero de 10 m de runtime cae encima; el quieto sale en 4,6 s. `qa/el-mundo-solido-…` bloque 7: 5,0 s |
| B · … en `hold` | ✅ | Bloque 1: los 7 `hold` salen (1,2–2,3 s) y fuera se quedan quietos (alejamiento 0,00 m). Contra la base: los 7 siguen dentro (rojo) |
| B · … recién llegado a su meta | ✅ | Bloque 3 (`goto_place` ya llegado y granero encima: 3,3 s). `el-mundo-solido` bloque 9: 3,4 s |
| B · … en `react` (jugador al lado) | ✅ | Bloque 3: sale en 3,75 s. Contra la base, NUNCA |
| B · tras salir no se queda pegado a la cara | ✅ | Bloque 1: los que no tienen directiva pasean 4,1–5,5 m desde donde salieron |
| B · resume de partida con NPC dentro | ✅ | Bloque 2: save con 3 NPC dentro → `loadSession` en una NarrativeState nueva. Salen los 3 (1,9–2,5 s) y el siguiente resume los trae FUERA. Contra la base, el `hold` no sale nunca y el siguiente resume lo trae dentro |
| B · un sólido que aparece en runtime, varios NPC a la vez | ✅ | Bloque 3: granero sobre quieto + hold + react + llegado. Salen los cuatro y ninguno queda dentro. Contra la base, ninguno sale |
| D½ · `npc_arrive` no deja a nadie dentro | ✅ con reservas | `el-viaje-…` bloque 5: 13 de 13 edificios de robledo/puerto, el NPC cae libre a ≤ 4 m del centro. Bloque 4 del 250: si el NPC ya estaba a ≤ 3 m del centro y dentro de un carro, no salta y el sim lo saca en 2,1 s. **Reserva: H1.** Con el lugar en un tile SIN REALIZAR, el NPC cae en el centro crudo y el sim no lo ve dentro nunca |
| C · el que huye se queda donde paró y no vuelve a la pelea | ✅ para la conducta ambiental / ❌ con `goto_place` | Bloque 5, pelea que SIGUE en (0,0): villager, peasant, merchant, `hold` y `patrol` (4 semillas × 300 s) huyen **1 vez** con 0 ticks en su percepción tras reanudar. Contra la base: 19–20 huidas en 180 s y 29–32 en 300 s con `patrol`. **H2:** con `goto_place` hacia un sitio junto a la pelea, 15 huidas en 180 s. **H3:** con `wander.radius` 15, re-huye en 4 de 8 semillas |
| El `home` se actualiza tras un salto | ✅ | `el-viaje-…` bloque 5: tras `npc_arrive`, pasea a lo sumo 4,57 m de su llegada en 60 s (paseo del campesino: 5 m). Por lectura, los únicos escritores externos de `record.position` para un NPC ambiental son `arriveNpc` y la escena que redeclara el id (`npc-records.ts:97`). `refreshCombatantsFromRuntime` solo toca hostiles, y `npcSync` los excluye. No hay otro escritor que haga saltar el `home` en falso |
| No regresión en el juego | ✅ | `npm run verify` con el guion 250 ya en el árbol: EXIT 0, 3661 de 3661. `node qa/run.mjs 154 50 07 68` con `e2e-sin-creditos`: 7 de 7 en verde (arrastra 107, 150 y 168), 0 € |
| Guiones de la familia | ✅ | `node qa/el-mundo-solido-tambien-para-el-npc.mjs`: «los nueve bloques en verde». `node qa/el-viaje-no-mete-a-nadie-dentro.mjs`: «el viaje no mete a nadie dentro» |
| Guion de QA nuevo | ✅ | `qa/guiones/250-el-npc-sale-del-solido-y-el-que-huye-no-vuelve.mjs` (`sinNavegador` + `sinMotor`). `node qa/run.mjs --sin-navegador 250` sale verde (1 s). **En negativo**, con `QA_250_CORE=<base>/nefan-core` sobre el dist de `d0cc2231`: **12 rojos** en los bloques 1, 2, 3 y 5 y en A3. Los candados del banco (`un-numero-un-guion`, `un-salto-del-guion-se-observa`, sondas, candados-headless…) pasan 172 de 172, y `npm run lint:qa` sale limpio |

## Hallazgos

### H1 · importante — `npc_arrive` a un lugar de un tile sin realizar envenena la colisión de ese tile para toda la vida del bridge

`createSimCollisionProvider` cachea los colliders por `sceneId` (`bridge/sim-collision.ts:203-208`) y nunca invalida. Si se consulta un tile que todavía no está en `scenes_loaded`, guarda `[]` para siempre. Desde BL, `arriveNpc` consulta `sitioParaAparecer(…, simCollision)` en el tile del destino. En el viaje narrative-paced, lo normal es que el lugar de destino **no esté realizado todavía**. Resultado:

1. El NPC cae en el centro crudo del `anchor.rect`, porque para el proveedor está libre.
2. Cuando el tile se realiza con un edificio ahí, el proveedor de la sesión sigue viendo el tile VACÍO: el NPC está dentro y nadie lo saca. Además, todos los NPC de ese tile atraviesan sus edificios, y `sitioParaAparecer` del jugador (`handlers/scene.ts:138`) puede soltarlo dentro.

Reproducción (guion 250, agujero A3; y `sonda-cache2.mjs`):
- tile (0,0) cargado; lugar «Casa del concejo» con anchor en tile (1,0), que no está cargado;
- `moveNpcToPlace` + `arriveNpc` → `ok:true`, pos (55,5, −9,5);
- se realiza tile (1,0) con robledo;
- el proveedor de la sesión dice `ocupado(55,5, −9,5) = false`, y uno nuevo dice `true`. El sitio de aparición del jugador en ese punto devuelve el centro, que está dentro.

La caché sin invalidar es ANTERIOR a BL. Medido: **también se cruza entre sesiones**. En el mismo proceso, la sesión B ve los edificios del `tile_0_0` de la sesión A (`ocupado = true` sobre un campo vacío). BL no la crea, pero le abre una puerta nueva y muy frecuente. Lo que esperaba el jugador: el NPC que llega a la casa aparece en la puerta, y el pueblo de ese tile es sólido para todos. Contra la base, A3 sale «cerrado»: esa consulta temprana no existía.

### H2 · importante (decisión) — el NPC con `goto_place` hacia la pelea sigue volviendo a ella

Con la directiva `goto_place` hacia un lugar a 2 u 8 m de la pelea, y la pelea en curso: **15 huidas en 180 s** (antes de BL, 24). El arreglo mueve `home`, pero ese NPC no pasea alrededor de `home`: `decide` re-deriva el `goto` y lo lleva otra vez a su meta, que está dentro de la percepción. El criterio literal («huye UNA vez y no vuelve a entrar en su radio de percepción») no se cumple para él. La elección del usuario, «se queda donde paró», tampoco. #298 hablaba del micro-wander, así que puede que esto quede fuera de la letra del issue, pero el jugador ve exactamente el mismo síntoma. Se reproduce con el agujero A1 del guion 250. Hace falta que el usuario decida si el recado manda sobre el miedo.

### H3 · menor — con `wander.radius` grande la huida se corta antes de su meta

`distanciaDeHuida = percepción + 4 + radioDePaseo`. Pero `updateDanger` cierra la huida a los `COMBAT_CLEAR_SECONDS = 4` s de salir de la percepción. En la práctica el NPC para a `percepción + 4 s × run_speed` (villager: 24 m) y nunca llega a la meta si esta es mayor. Con `wander.radius` 15 (meta 31 m) para a 24 m, su paseo llega a 9 m de la pelea y **re-huye en 4 de 8 semillas × 600 s** (1–2 veces extra en 10 min; antes de BL eran ~57 por semilla). Pasa lo mismo con `behavior.wander_radius` grande. Con los presets y con `patrol` el margen alcanza (patrol del villager: justo 24 − 12 = 12, sin re-huidas en 4 × 600 s). Es el riesgo que el plan dejaba en §8 sin medir. La geometría que promete la docstring de `distanciaDeHuida` («el paseo entero queda fuera por geometría») no se cumple para radios de paseo > 4 × run_speed − 4. Se reproduce con el agujero A2 del guion 250.

### H4 · menor — el `hold` que sale se queda pegado a la fachada

El `hold` sale y se queda a 0,00 m del punto de salida, con el hombro contra la pared (bloque 1). Es la decisión del plan («`hold` = no pasees»), pero de cara al jugador un NPC plantado mirando a la pared puede leerse raro. Lo apunto por si importa. No lo pude ver en pantalla (ver «No probado»).

## Workarounds usados

- **El flujo del NPC se condujo sin navegador**, con el sim y el director de `dist` montados como en `ws-server.ts`. No afecta al usuario, porque es el mismo código y el mismo cableado que corre en el bridge. Es la vía que ya usan `el-mundo-solido` y `el-viaje` para esta familia. Lo que NO cubre es lo que no probé en pantalla (abajo).
- **Posiciones y sólidos sembrados** con `recordEntitySpawned` / `recordSceneLoaded` / `worldMap.upsertPlace`, las mismas puertas que usan el motor y el consequence-handler. No se forzó ningún estado interno del runtime.
- **Pelea sintética**: un `attack_started` de `bandit` en (0,0) en cada tick, igual que los unitarios. Es la forma más dura de «una pelea que sigue en el mismo sitio».
- Para la batería de navegador enlacé `qa/node_modules` al del checkout principal y copié `nefan-html/public/sprites` (arte ignorado). Ya quité el enlace, y también el worktree temporal de la base.

## No probado

- **En pantalla**: no vi un NPC saliendo de un edificio ni huyendo en el cliente. El preset `e2e-sin-creditos` no trae ni pelea ni NPC metidos en sólidos, y provocarlos en el navegador exige el motor. La crítica visual (hacia dónde mira el que sale, si la animación de andar se lee) queda **sin hacer**.
- **H1 en el flujo real** (motor → MCP `npc_arrive` → tile realizado después): medido con el cableado de producción, no con el motor y el bridge en pie. Lo mismo vale para el cruce entre sesiones.
- **Mutación**: `npc-director` está pendiente (150 > tope local) y `npc-behavior.ts` sigue en `sin_mutar`, así que las conductas nuevas solo las sujetan los tests, los sabotajes del ingeniero y este guion.
- **Radios de directiva enormes que saquen al que huye del vecindario 3×3**: no medido, igual que en el plan.

## Veredicto

**Apto con reservas.** Lo que se pidió se cumple en todos los estados que visité: sale el quieto, el `hold`, el `react` y el llegado; también varios a la vez, tras un resume y bajo un sólido de runtime. `npc_arrive` deja libres los 13 edificios de las fixtures, el que huye sin directiva se queda donde paró y el `home` se adopta tras el salto. Todo ello se pone rojo contra el árbol de antes. Las reservas son H1, que hay que cerrar o abrir como issue antes de fusionar porque BL le abre la puerta de uso normal, y H2, que es una decisión del usuario.
