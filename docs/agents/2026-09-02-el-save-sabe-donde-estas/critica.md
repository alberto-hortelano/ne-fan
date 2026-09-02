# VIGENTE (#395, #179) · REENCUADRADA (#382: la vara cambia y deja de depender de #377)

Medido sobre `6d3d7ac`. Los tres problemas son reales; lo que caduca son las premisas de dos cuerpos.

## El problema real, en una frase

- **#395**: cambiar de tile NO es un evento de guardado — el bridge solo escribe cuando otra cosa escribe.
- **#382**: la posición VIVA del ledger sale al cable sin que nadie mire si cae en algún sitio donde exista mundo.
- **#179**: `exits` es un derivado del mapa horneado en `scene_data` con un único invalidador (la difusión).

## Premisa, afirmación por afirmación

**#395**
- «`recordSceneLoaded` guarda antes del `ready`+`spawn`» — **cierta solo en una de dos ramas**. Viajar por «Salidas» manda `player_entered_place` (`nefan-html/src/net/bridge-client.ts:329`) → `handlePlayerEnteredPlace` (`bridge/handlers/scene.ts:20`). Si el place ya está realizado: `difundirPlaceRealizado` → `recordSceneLoaded(sceneId, scene)` (activa) → `save()` (`scene.ts:105-106`) → después el `ready` con `spawn`. Ese save lleva `active`=destino y `position`=origen (el sim aún no ha recibido un `input`).
- «15 s después el save sigue en el origen, también `active_scene_id`» — **cierta, y es la otra rama**: en el banco el Molino NO está realizado (`labs/narrative/fake-ai-server.ts:184-198` solo crea place+link), así que va por `runPlaceTravel` → `generateTileScene` → `recordSceneLoaded(key, expanded, [], {activate:false})` + `save()` (`bridge/handlers/tile.ts:156-157`): save con origen en los dos campos. Tras el spawn, `activateByPosition` (`tile.ts:327-332`) llama a `setActiveTile`, que pone `active_scene_id` y `dirty=true` (`src/narrative/narrative-state.ts:213-221`) **y no guarda**. Y `dirty` no tiene lector en producción: `isDirty()` solo lo llama `test/narrative-state.test.ts`. El place del destino tampoco guarda: `fireMapTriggers` sale sin escribir si no disparó nada (`bridge/context.ts:441`).
- «No hay autosave por tiempo» — **cierta**: cero `setInterval`/`setTimeout` en `bridge/**`. Todo `save()` es por evento (16 sitios). El «15 s» del QA es el `maxMs` por defecto de `esperarEnElSave` (`qa/lib/saves.mjs:139`): no midió un autosave tardío, midió que **no hubo ninguno**.
- «`/scene/asset_refs` fuerza el save» — **cierta y generalizable**: `appendSceneAssetRefs` devuelve `mutated(...)` (`bridge/state-http/scene-routes.ts:58-59`) y todo `mutated` dispara `onMutation` → `narrative.save()` (`bridge/ws-server.ts:178-180`). Lo mismo hacen `map/place`, `map/link`, `map/trigger`. Por eso el guion 60 «cura» el save posteando un place (`60-…mjs:223-235`): es el mismo efecto secundario que el issue denuncia, usado a propósito. Con mapping local (`fps_atlas:*`, `fps-atlas.ts:277`) no hay POST, y el juego real con Imagen IA solo se salva cuando el atlas tiene algo que registrar.
- Cliente al reanudar: la **posición** manda (`main.ts:2277-2286`: `savedPos` → `underResume` → `setActiveClientTile`); `active_scene_id` solo ordena los tiles (#390). Un save con `active`=destino y `position`=origen reanuda en el origen igual. El arreglo tiene que fijar los dos, y «por construcción» significa: el guardado lo dispara el hecho «el jugador ha cambiado de tile», que hoy solo conoce `setActiveTile`, no una escritura ajena.

**#382**
- `npcsFueraDelRect` mide `POSICION_DECLARADA ?? position` contra el rect de SU tile (`src/session/mundo-persistido.ts:321-345`); único llamante `nefan-html/src/world/carga-de-tile.ts:339` con `rect` del tile. `escenaConCombateVivo` pone la viva en `position` y aparta la declarada (`:259-263`). **Cierto**: nadie mira la viva.
- «La mitigación barata está bloqueada por #377» — **falsa como bloqueo**: solo lo es la vara «a más de N tiles de SU rect». La vía (a) —unión de rects de TODOS los tiles de `scenes_loaded`— no la toca el combate. `scenes_loaded` nunca se poda (`narrative-state.ts:324/509/609`, sin `delete`): la unión es el mundo entero conocido. El bridge la tiene al servir (`bridge/wire-scene.ts:99-111`, `sessionDataForClient` recorre `data.scenes_loaded`) y el cliente la tiene ENTERA antes del primer `addTile` (`main.ts:2241-2247`, `res.state.scenes_loaded`), así que el falso positivo «los tiles se añaden en orden» que el issue temía no aplica si la unión sale del save y no de `tileStore`.
- Falsos rojos de (a), medidos: un ambiental no sale de su `home` (`npc-behavior.ts:225`) salvo `goto_place` hasta 128 m (`:96`) hacia `resolvePlaceTarget`, que resuelve por `place.anchor` sin exigir tile (`src/world-map/place-target.ts:18-19`); `runPlaceTravel` fija el anchor ANTES de generar y no lo borra si falla (`scene.ts:164`) → un NPC puede andar hacia un tile que no existe. Un hostil `engaged` (`enemy-ai.ts:87`) puede cruzar una esquina cóncava del mundo explorado. Los dos casos son raros, **y en los dos el NPC está literalmente donde no hay suelo**: el aviso sería verdadero, no falso. La coordenada del repro `[168.25,0,168.25]` cae en `tile_3_3` (rect 160..224): fuera de toda unión en una partida nueva → lo caza.
- Vía (b) (validar al escribir en `refreshCombatantsFromRuntime`/`npc-behavior`): **no cumple A2** — el repro es un save editado con números finitos que el sim nunca escribió; solo cazaría NaN del sim. Y roza `src/simulation`, que el usuario ha puesto en baja prioridad. Descartarla.
- Repro sigue siendo save editado + Reanudar: el resume sirve las escenas por `sessionDataForClient` → `alWire` (`wire-scene.ts:107-109`). Cierto.

**#179**
- `addLink` = `worldMap.addLink` + `markDirty` + `mutated` (`bridge/state-http/map-routes.ts:42-52`): **persiste** (vía `onMutation`) y **no difunde** (cero `broadcast|exits|onProgress` en el fichero). Cierto con matiz: el link SÍ llega al save; lo que no se recalcula es `exits`.
- `enrichSceneWithExits` definida en `context.ts:244`, único llamante `context.ts:329` dentro de `broadcastScene`; muta `scene` in place (mismo objeto de `scenes_loaded`, `:243`) y `bootstrap-tile.ts:117-118` lo persiste a propósito. `sessionDataForClient` **no re-enriquece**: `alWire` = `formatDToWorld` + combate (`wire-scene.ts:78-80`). Reanudar no cura el panel. **Cierto**.
- «El cliente fija `currentExits` en `main.ts:1099-1100`» — **caducada**: hoy es `carga-de-tile.ts:140-148` (`entry.scene.exits` → `mundo.activarTile` → `travelPanel.setExits`), fichero de 379 líneas bajo tope 450; `main.ts` (2321, congelado en `client-file-size.json`) solo conecta `travelPanel.onTravel` (`:1649`). El cambio de cliente NO necesita líneas en `main.ts`; el despacho del wire vive en `bridge-client.ts:153-156`.
- Protocolo: **no existe** mensaje de solo-salidas (`src/protocol/messages.ts`: 30 tipos, ninguno); `SceneExit` en `:204`. El molde `onProgress` existe: opción en `state-http/context.ts:46`, cableada en `ws-server.ts:181-188`, usada por `narrativeProgress` (`session-routes.ts:57`). Hermano `map_upsert_place` **confirmado**: el `name` se resuelve al difundir (`context.ts:253`) y la tool MCP se llama así. `map_add_trigger`/`npc_move_to_place` no afectan.

## El día después

- #395: un `save()` más en el hot loop, gateado por cambio de TILE (no de celda): una escritura por 64 m. `handleInput` ya `await`ea `activateByPosition`. Hace innecesario el «cura» del guion 60 y desmiente la frase «cualquier save lleva la posición fresca» como garantía: la frescura viaja, pero el save hay que provocarlo.
- #382: un segundo checker en `mundo-persistido` con una vara distinta (unión) al lado del de conversión (rect propio). Riesgo de que alguien «unifique» los dos y afloje el de conversión — el guion 55 lo canda.
- #179: nace un mensaje pequeño y una segunda vía de `exits` (difusión + actualización). Lo que habría que borrar y nadie borrará: la persistencia de `exits` en `scene_data` (`bootstrap-tile.ts:117`). Si se recalcula al servir, ese sello sobra y `wire-scene.ts:16-17` ya lo llama error.

## Conflictos

- **#377** (`futuro`): fuera; (a) no lo necesita. Anotar allí que el aviso de #382 puede encender con un hostil en el vacío.
- **#358** (`main.ts` congelado): #179 debe entrar por `carga-de-tile.ts`/`mundo-del-cliente.ts`/`bridge-client.ts`. Sin conflicto si se respeta.
- **#378** (`WorldScene` sin tipo, T7): el mensaje nuevo lleva `SceneExit[]`, no toca `WorldScene`. Sin conflicto.
- **#390** (cerrado, `937c16d`): base de #395; el guion 60 es suyo y esta tanda le quita la muleta. Coordinado.
- Sin solapamiento con la cola abierta (54 issues revisados por título).

## Coste contra valor

- #395: barato (un save gateado + guion), valor alto: es el único de los tres que ve un jugador jugando bien. No hacerlo = perder el viaje al cerrar.
- #382: medio (checker + canal + test + guion), valor medio: exige save corrupto, pero cierra el mismo silencio que abrió la serie. No hacerlo = NPC borrado sin aviso.
- #179: medio-alto (mensaje nuevo, dos capas, resume), valor alto con motor real: el diálogo promete un destino que el panel no ofrece. No hacerlo = la única vía de viaje miente.
- Mutación: `mundo-persistido` no tiene informe en `reports/mutation/` (solo apuntado y blueprint-*) → coste desconocido; `npm run mutacion -- pendiente` lo dice. `world-map`/`status-labels` (100/160) si se tocan.

## Qué cambiar en `requisitos.md` (pegar tal cual)

- En **#395**, sustituir la primera fila de la tabla por: «Dos ramas. Place realizado: `scene.ts:105-106` guarda antes del `ready`+`spawn` (active=destino, pos=origen). Place sin realizar (el banco): `tile.ts:156-157` guarda con `activate:false` y después NADIE guarda: `setActiveTile` (`narrative-state.ts:213-221`) marca `dirty` sin lector; `fireMapTriggers` (`context.ts:441`) no escribe sin triggers. No hay autosave por tiempo. Criterio: el hecho «el jugador ha cambiado de tile» dispara el save.»
- En **#395**, añadir: «El "15 s" es el `maxMs` de `esperarEnElSave`; A1 debe esperar el save por PREDICADO (active=destino ∧ pos ∈ rect), no por tiempo».
- En **#382**, sustituir la fila de la mitigación por: «Vara: la posición viva de cada NPC de `scenes_loaded` se contrasta con la UNIÓN de rects de todos los tiles del save (nunca podado), disponible en el bridge (`wire-scene.ts:99-111`) y en el cliente antes del primer `addTile` (`main.ts:2241-2247`). No depende de #377. Rojos residuales conocidos y VERDADEROS: hostil `engaged` en esquina cóncava; `goto_place` hacia un `anchor` de viaje fallido (`scene.ts:164`, `place-target.ts:18`). Vía (b) descartada: no caza el repro.»
- En **#382 A2**, negativo concreto: «save sin tocar con la posición de `barkeep` movida a mano DENTRO del rect de otro tile cargado → «— sin errores —»».
- En **#179**, sustituir «`main.ts:1099-1100`» por «`carga-de-tile.ts:140-148` (`travelPanel.setExits`); `main.ts` no suma líneas». Añadir: «`addLink` SÍ persiste (`mutated` → `onMutation` → `save`); lo que falta es recalcular/difundir `exits`. Al reanudar, `sessionDataForClient` (`wire-scene.ts:107`) no re-enriquece: A3 exige que sí, o que las `exits` dejen de sellarse en `scene_data`».
- **Fuera** añadir: «`src/simulation/npc-behavior.ts` (movimiento = plugin, baja prioridad)».
