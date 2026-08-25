# Crítica — «Reanudar te devuelve donde lo dejaste» (#245 · #249)

**#245 → REENCUADRADA · #249 → REENCUADRADA (al alza: hoy es un bug de CRÉDITOS)**

Verificado sobre `main` @ `c007e60`, con la tanda del arranque (#181 #189 #180) ya dentro. Evidencia
en vivo de hoy, 0 €: `node qa/run.mjs 17-la-partida --diag` (`e2e-sin-creditos`), 1/1 en verde,
midiendo `empezó en {x:0.25, z:3.25} · reanudó en {x:0, z:0} · __player_start {x:0.25, z:3.25}`; la
captura `qa/capturas/17-…-03-partida-reanudada.png` sale encerrada en un volumen y sin cielo, y
`…-01-partida-recien-empezada.png` con calle y cielo.

## El problema real, en una frase

**#245**: el bridge escribe `state.json` trece veces por sesión y en ninguna refresca la posición ni
el HP — no que «el cliente no pida guardar». **#249**: de los dos caminos de vuelta al título, uno
rearma el gate del gasto y el otro no.

## La premisa, afirmación por afirmación

| Del issue | Verificación |
|---|---|
| #245 «`save_session` no lo llama nadie» | **CIERTA**. `narrativeClient.save()` (`nefan-html/src/net/narrative-client.ts:139`) sin un solo llamante: `grep "\.save()" nefan-html/src` devuelve esa línea y nada más |
| #245 «el resume cae al origen» | **CIERTA, medida hoy** (arriba). `nefan-html/src/main.ts:2566-2570` pisa la posición con `res.state.player.position` |
| #245 «si el save no trae posición, caer a `__player_start`; son independientes y eso es barato» | **FALSA como está escrita**. El save SIEMPRE trae posición: `DEFAULT_PLAYER.position = [0.0, 1.0, 0.0]` (`nefan-core/src/narrative/narrative-state.ts:73`) — no existe el estado «sin posición» del que caer. Y `current_scene_id` no vale de centinela: lo escriben `setActiveTile` (:137) y `recordSceneLoaded` (:364) sin que nadie guarde. Así que la «mitad barata» o es un centinela nuevo en el save (**cambio de contrato**) o un `if (pos == [0,1,0])` mágico; y hecha la otra mitad, se queda sin sujeto |
| #245 «hay que decidir quién dispara el snapshot» | **REENCUADRE**. Nadie. El bridge ya tiene el dato vivo (`ctx.store.state.player.pos`, refrescado en cada frame de input, `bridge/handlers/simulation.ts:36`) **y** ya escribe el save en trece sitios (`bridge/handlers/{dialogue,tile,scene,bootstrap-tile,session}.ts`, `bridge/context.ts:357,368`, `ws-server.ts:137`). El guion 17 lo mide: «las once escriben el save, una por una». Lo único que no se refresca es `NarrativeState.player.position`, que solo toca `handleSaveSession` (`session.ts:711`) |
| #245 (implícito) «es solo la posición» | **INCOMPLETA, al alza**. `updatePlayerHealth` vive en el mismo y único sitio: **reanudar te devuelve siempre a 100 HP**, y `reseedSimForSession` (`session.ts:259-269`) resiembra el sim con ese 100 |
| #249 «el catch conserva `sessionModesApplied`, el tema y `setSession`» | **CIERTA**. El catch (`main.ts:2573-2585`) hace `hideLoader() + resetWorld() + activeSessionId = null` y nada más; `volverAlTitulo()` (`main.ts:2481-2486`) **sí** pone `sessionModesApplied = false`. La asimetría entre dos caminos al mismo sitio es el bug, y se lee en veinte líneas |
| #249 «no se sabe si deja media sesión pegada» | **SE SABE, y es peor**. Cadena leída entera: `start_session` responde `ok:true` **antes** de generar el tile (comentario de `main.ts:2465`) → el fallo tardío vuelve al título → el bridge termina y difunde el tile → `onNarrativeEvent` no está gateado por sesión (`main.ts:2355`) → `addTile` → `setActiveClientTile` → `fpsAtlasController.onActiveTile` (`main.ts:1054`) → el gate es `sessionModesApplied && scenesGenerationOn()` (`main.ts:244`), los dos rancios → **se paga un atlas con el estilo de la partida que no arrancó y sin sesión a la que cargarlo**. Es el accidente que `main.ts:340` documenta como «visto en vivo 2026-08-14» |
| #249 «`historyBrowser.setSession` es cosmético» | **NO**. `history-browser.ts:78` llama a `resumeSession(_resumeSessionId)` y en el bridge eso **cambia la sesión del singleton**: con un id rancio, abrir el libro de historia hace takeover de otra partida |

## El día después

- Quien juega reanuda donde estaba y con el HP que tenía: el cambio más visible de la cola. Se cierra
  la puerta a «guardar es un acto del jugador» — el save pasa a ser continuo, que es lo que ya era.
- **Hay que borrar `save_session` entero** si el snapshot se muda al guardado del bridge:
  `src/protocol/messages.ts:141`, `message-schema.ts:160`, `bridge/router.ts:82`, el handler,
  `bridge-client.ts:318`, `narrative-client.ts:139`, `replay-server.mjs:101` y los seis casos de
  `bridge-session.test.ts`. Grep a cero, entrada en `campos-retirados-no-vuelven`. **Un
  plan que lo deje vivo «por si acaso» está mal.** Se tiran también los comentarios-disculpa
  (`main.ts:2565`, `qa/guiones/17…:273-282`) y el `ctx.log` del guion 17 pasa a `ctx.expect`.
- Nada queda arbitrario si el snapshot vive en el guardado del bridge; si acaba siendo un temporizador en el cliente, en un mes nadie sabrá por qué está ahí.

## Conflictos

- **«El bosque es uno solo» (#243 #233 #232)**: toca `main.ts` en `composeTilePlan` y el bucle de
  objetos (**~700-1050**); esta tanda, el resume y su catch (**~2450-2600**). Disjuntos: **no hace
  falta secuenciarlas**, solo que la segunda en aterrizar rebase. Único roce: #243 cambia el aspecto
  del tile del bench, así que las capturas del guion 17 se re-hacen.
- **#246** (HUD y error-log por debajo del título) **es el mismo seam que #249 por el otro lado**:
  el HUD se lee porque la partida sigue pintando detrás, que es lo mismo que paga el atlas, y el
  gancho ya existe (`titleScreen.onVisibilityChange`, `main.ts:1995`, ya esconde el chip de
  gráficos). **Recomiendo meterlo aquí**: casi gratis, y sin él queda medio síntoma visible.
- **#250 y #251**: layout de `title-screen.ts`. Ni dependen de esta tanda ni la estorban, y colisionan **entre sí**: hazlos juntos, en otra.
- **«Candados que no pueden ponerse rojos» (#231 #248 #247)**: sin colisión de ficheros, pero el
  endpoint de fallo a petición de `fake-ai-server.mjs` que propone #249 **es material suyo**; pásaselo. Y ojo: `html-sin-promesa-muda` es `warn` y según #248 solo ve el `void` honesto.

## Coste contra valor

**#245** es el mejor cambio por euro de la cola: dato y autoridad de escritura ya están en el mismo
proceso, no hay mensaje nuevo, no hay cadencia que decidir y **el freno explícito no se dispara**
(el save ya se escribe continuamente; nada tira más que hoy). No hacerlo nunca significa que el save
no es un save: es un marcador de mundo generado.

**#249** cuesta poco (simetrizar el retorno al título) y evita gasto real. Hacerlo provocable con el
endpoint cuesta bastante más y **no hace falta para saber qué resetear**: el conjunto se lee en
`applySessionReady` y los cuatro aplicadores. Voto: **extender el reset y hacer inexpresable la
asimetría**, y que el endpoint viaje a la tanda de candados — un test de unidad sobre un booleano no
es el candado: si el estado malo sigue siendo expresable, el verde no dice nada.

## PARA EL USUARIO (no bloquea; la cola sigue)

Hoy **reanudar te cura**: el HP no se persiste nunca, vuelves siempre a 100. Arreglar #245 así hace
que el daño sobreviva al resume — diseño de juego, no bug: si prefieres que reanudar cure (muchos
RPG lo hacen), dilo y el HP se queda fuera. Asumo que **persiste**: lo promete `CLAUDE.md` («el
resume restaura posición, HP y entities») y hoy esa frase es falsa.

## Para pegar tal cual (parche de `requisitos.md` y cuerpo nuevo de los issues)

> **#245 no es un mensaje que falta, es un campo que no se refresca.** El bridge ya escribe
> `state.json` en trece sitios (once veces en la sesión de cinco segundos del guion 17) y ya tiene la
> posición viva en `ctx.store.state.player.pos`, dispatchada en cada frame de input
> (`bridge/handlers/simulation.ts:36`). Lo único que no refresca antes de escribir es
> `NarrativeState.player.position` **y `player.health`**, que solo toca `handleSaveSession` — el
> handler del mensaje que nadie manda. El trabajo es que el guardado del bridge lleve fresco lo que
> ya tiene delante, y **retirar `save_session` entero** (tipo, zod, router, handler, cliente,
> replay-server y sus tests: grep a cero, `campos-retirados-no-vuelven`).
>
> **No hay que elegir cadencia**: ni «al salir», ni «cada N segundos», ni «al cruzar de tile» — los
> tres ya guardan, y el freno explícito no se dispara. **El fallback a `__player_start` se cae del
> alcance**: el save nunca viene sin posición (`DEFAULT_PLAYER.position = [0,1,0]`), no hay estado
> del que caer, y fabricar uno sería un cambio de contrato para tapar un síntoma que la otra mitad
> ya elimina. **Contrato del save: sin cambios** — `player.position` y `player.health` ya existen y
> ya se persisten; cambia su frescura. Ninguna migración, nada que declarar.
>
> **#249 es un bug de créditos, no de estado pegado.** El fallo tardío deja `sessionModesApplied`
> en `true` con el `scenesMode` y el estilo de la partida que no arrancó; el tile que el bridge
> difunde después (`start_session` responde antes de generarlo) entra por `onNarrativeEvent`, que no
> está gateado por sesión, y paga un atlas sin sesión a la que cargarlo. `volverAlTitulo()` ya lo
> evita poniendo el flag a `false`; el catch de `unIntentoDeArrancar` no. El criterio es que **los
> dos caminos de vuelta al título dejen el cliente idéntico**. El endpoint de fallo a petición de
> `fake-ai-server.mjs` NO entra aquí: va con #231/#248/#247. **Y #246 entra en esta tanda**: mismo seam por el otro lado, con el gancho ya puesto (`titleScreen.onVisibilityChange`, `main.ts:1995`).
