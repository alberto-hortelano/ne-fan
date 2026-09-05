**Veredicto: APTO CON HALLAZGOS** — las tres puertas exigen el `id` en el flujo real y el jugador lo ve; los hallazgos son menores y ninguno es del criterio de cierre.

# QA-B · PR #457 / issue #452 — «El inventario exige `id` en sus tres puertas»

Worktree `/home/al/code/ne-fan-t13-qa-b` · HEAD `4370fd0` · 2026-09-05 · cero créditos (fake-ai-server, `e2e-sin-creditos`, `NEFAN_PORT_OFFSET=700`).

## Criterio de cierre literal del issue

> Candado: un plugin de prueba que escriba `{name:"x"}` → rechazado con motivo; un save sintético con ítem sin `id` → `loadSession` lo dice.

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Plugin de prueba **de disco** (`data/games/toledo_1200/plugins/qa_regalo.json`, juego de bench copiado a `NEFAN_GAMES_DIR` propio) que hace `push {name:"x"}` → rechazado con motivo | ✅ cumple | El plugin carga en génesis (`GET /plugins`: `qa_regalo 1 143e4fc2… developer`). El motor (State API, mismo cable que la tool MCP) siembra un `map_upsert_place` con trigger `player_entered` → `plugin_event qa_regalo_sin_id`; el jugador **camina** hasta la zona (W mantenida, yaw este). Log del bridge: `plugin tick aborted for map_trigger: { code: 'write_invalid', pluginId: '143e4f…', path: 'player.inventory', detail: 'player.inventory[0].id: Required' }`. `GET /entity/player/inventory` → `[]`; slice `{dados:0}` (transaccional); save en disco `inventory: []`. |
| …y qué ve el jugador (`describePluginTickError`) | ✅ cumple | Overlay «**Un sistema del juego falló**» / «**«qa_regalo» intentó dejar en el inventario algo que el juego no reconoce.**», botón «Cerrar» (con mundo detrás, `salida: cerrar`), y la misma frase en el error-log (`narrative`). Sin códigos, rutas ni hash. Captura `qa/capturas/qa-b-452/qa-b-452-z1-overlay-sin-id.png` (manual) y `qa/capturas/<run>/73-…-01-qa73_z1_sin_id.png` (guion). |
| El mismo plugin con `push {id:"x"}` → aterriza | ✅ cumple | Zona 2 (dos eventos `qa_regalo_con_id` en un tick): sin overlay; `inventory: [{"id":"x"},{"id":"x"}]` por State API y en `saves/…/state.json`; slice `{dados:2}`. |
| Save sintético con ítem sin `id` → `loadSession` lo dice | ✅ cumple | Save real de la partida (`schema_version 5`) editado a `player.inventory = [{id:"x"},{name:"x"}]`. `resume_session` por el cable: `ok:false, error: "save_invalido: save \"1788621576-49e0d4\": player.inventory[1].id: Required — pre-producción, sin migraciones (#336): bórralo o empieza partida nueva"`. Un id inexistente sigue siendo `session_not_found` (distinguible). El fichero no se reescribe. |
| …y el jugador lo ve (fail-loud por capa) | ✅ cumple | Pulsar «Reanudar» en la tarjeta del título → `#ts-error`: «**No se pudo reanudar la partida. Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva.**»; `status().scene === false` (no se monta mundo); error-log con el motivo técnico completo. Captura `qa/capturas/qa-b-452/qa-b-452-titulo-save-sin-id.png`. El **listado** del título NO lo dice (ofrece la tarjeta): ver hallazgo 5. Restaurado el fichero, el resume carga (`ok:true`). |
| Tercera puerta: `inventory_add` por State API con `{item:{name:"x"}}` → 400 estructurado | ✅ cumple (sigue) | `POST /entity/player/inventory` → `{"ok":false,"error":"item.id: Required"} [400]`; `{id:""}` → `item.id: String must contain at least 1 character(s)` [400]; `{id:7}` → `item.id: Expected string, received number` [400]; `{item:{}}` → `item.id: Required`; `{}` → `item: Required`. Inventario intacto tras los cinco. |
| Adversarial plugin: `id` vacío · `id` numérico · `set player.inventory` a no-array · `player.inventory[0].id = ""` sobre ítem existente · dos ítems con el mismo `id` | ✅ 4 rechazos con motivo exacto; duplicados **aceptados** (ver hallazgo 3) | Zonas 3–6 del paseo manual, log del bridge: `player.inventory[2].id: String must contain at least 1 character(s)` · `player.inventory[2].id: Expected string, received number` · `player.inventory: Expected array, received string` · `player.inventory[0].id: String must contain at least 1 character(s)`. Los cinco ticks abortados dejan `[{"id":"x"},{"id":"x"}]` y el save igual. Overlay idéntico en cada uno (captura `qa-b-452-z6-overlay-vaciar-id.png`). |
| Adversarial save: `inventory: null` · `"x"` · `[{id:""}]` · `[{id:7}]` · duplicados · sin campo `inventory` · sin bloque `player` · válido | ✅ / ⚠️ | Por el cable: `null` → `player.inventory: Expected array, received null`; `"x"` → `…received string`; `[{id:""}]` → `[0].id: String must contain…`; `[{id:7}]` → `[0].id: Expected string, received number`; duplicados → `ok:true`; sin campo → `ok:true` (default, convención aditiva); **sin bloque `player` → `save_invalido: Cannot read properties of undefined (reading 'inventory')`** (hallazgo 2); `[{id:"x",name:"x"}]` → `ok:true`. |
| Los inventarios de ENTIDADES (`data.inventory`) quedan fuera y la PR no los promete | ✅ cumple | Cuerpo de la PR, comentarios de `request-schemas.ts` («Un ítem del inventario del **jugador**… tres puertas») e `implementacion-1.md` («Los inventarios de las ENTIDADES siguen sin tipar… fuera de #452») lo dicen; `types.ts:24-30` sigue diciéndolo. El State API sí exige `id` también para `POST /entity/{npc}/inventory` (ya antes: mismo `InventoryAddRequestSchema`). |
| `npm run verify` | ✅ verde | `EXIT=0`; `npm test`: **2085/2085** (el informe dice 2097: es la cuenta de `npm run coverage`, ver hallazgo 7). |
| `npm run deuda` 83 = 83 | ✅ | «Deuda medida — 83 items» (fronteras 15). |
| `npm run crap -- --check` | ✅ | «0 por encima del tope 73 · 7 sobre el objetivo 30 · cobertura 89.2 % ≥ 89 % · ✔ dentro de los umbrales». Los 2 rojos de `npm run coverage` (`repo-hygiene.test.ts`) los causó **mi** symlink de sprites (ver workarounds): sin él, 8/8. |
| `npm run afectado -- --rango 3a0f8ef..4370fd0`: nadie mide `dispatcher.ts` / `narrative-state.ts` | ✅ confirmado | Los tres fuentes aparecen solo como «sus baterías lo cargan» en 14 módulos; `test/plugin-dispatcher.test.ts` → «ninguno: no está en la batería de ningún módulo». **No hay issue abierto** todavía (hallazgo 8). |
| El guion 14 (commerce compra de verdad, único plugin vivo que escribe inventario) sigue verde con el gate | ✅ | `node qa/run.mjs 14-plugin` → «1 en verde · 0 en rojo». |
| `PLAYER_WRITABLE` no se rediseña (#361) | ✅ | `grep -rn PLAYER_WRITABLE nefan-core/src` → 2 (declaración + uso), como en `main`. |

## Guion ejecutable

`qa/guiones/73-el-inventario-exige-id-en-sus-tres-puertas.mjs` — **grupo de navegador** (`qa/run.mjs`, preset `e2e-sin-creditos`, corrida local; NO entra en `candados-headless`). `aisla: ["saves"]`. Juega las tres puertas por el camino real: deja el plugin en el disco efímero del juego (`QA_RUN_TMP/games/toledo_1200/plugins/`; contra un stack adoptado cae a `plugin_register`), partida nueva de `toledo_1200`, cuatro zonas sembradas por State API que el jugador pisa andando (sin id / con id ×2 / id vacío / set a string), overlay afirmado con `expectEspera` en los dos signos, inventario y slice por State API; luego título, save corrompido, resume por el cable + tarjeta «Reanudar», restauración.

- Corrida: `node qa/run.mjs 73` → **26 asertos verdes**, `EXIT=0` (`qa/capturas/2026-09-05T15-34-51-039Z-257689/`).
- **Negativo** (anulando a mano `inventarioInvalido` → `return null` y `loadSession` con `&& false`; fuentes restaurados con `git checkout`): **11 rojos** — «zona 1: no aterriza nada — inventario=[{"name":"x"}]», «zona 1: el jugador VE que un sistema falló — no ocurrió en 8000 ms», zonas 3 y 4 ídem, «el resume … contesta save_invalido — {"ok":true}», «el título vuelve con un error visible — timeout». El guion distingue el mundo con puertas del mundo sin ellas.
- Riesgo de numeración: otras QA de la tanda corren en paralelo; si otra rama estrena el `73`, renumerar al mergear.

## Hallazgos

1. **(menor, diseño)** El gate del `id` vive en el TICK, no en el ALTA. `loadManifestsFromDir` y `plugin_register` aceptan un plugin cuyo único efecto es `push {name:"x"}` —incluso con una fixture que lo ejerce con `context.player.inventory: []`—, porque `replayFixture` (`dsl/evaluate.ts:183`) solo compara el slice, no los external writes. Repro: el `qa_regalo.json` de la prueba lleva la fixture `qa_regalo_sin_id`/`after {dados:1}` y carga (`GET /plugins` lo lista, origin developer). Lo que esperaría quien escribe un plugin: enterarse al registrarlo, no cuando el jugador pisa el trigger y se come el overlay. Cumple el criterio literal («rechazado con motivo»); es deuda para el sistema de plugins (`futuro`, junto a #361), no de esta PR.
2. **(menor)** `loadSession` con un save sin bloque `player` lanza `save_invalido: Cannot read properties of undefined (reading 'inventory')` — un `TypeError` como motivo (`narrative-state.ts:562`, `data.player.inventory` sin guardar `data.player`). Antes de la PR ese save cargaba con `DEFAULT_PLAYER` (spread de `undefined`). El jugador lee la frase correcta (la rama `/save_invalido/` de `motivoDeSesionParaElJugador`), pero el log no dice qué falta. Repro: `state.json` válido, `delete d.player`, `resume_session`. Esperado: «`player`: Required» o dejar que caiga al default como antes. Un save sin `player` no lo escribe nadie hoy; sale de la pasada adversarial.
3. **(observación, fuera de #452)** Dos ítems con el mismo `id` entran por las tres puertas (`[{id:"x"},{id:"x"}]` aterriza desde plugin y carga desde save; el State API no comprueba unicidad). `inventory_remove` saca el primero. El issue no lo pide; se anota para cuando se decida si el `id` es único o solo obligatorio.
4. **(observación, preexistente)** `POST /entity/player/inventory` con body que no es JSON → **500** `invalid JSON body`; debería ser 400 (es un error del cliente).
5. **(observación, preexistente, consistente con #334/#336)** El título **lista** la tarjeta del save con ítem sin `id` (`session-storage.list()` no valida contenido) y el jugador solo se entera al pulsar «Reanudar». Es el comportamiento que el guion 46 ya documenta para los demás `save_invalido`; no es regresión.
6. **(observación UX, fuera de alcance)** Cuando un ítem con `id` aterriza (zona 2) el jugador no ve NADA: ni línea en el feed ni HUD de inventario. Un rechazo se ve a pantalla completa; un acierto es invisible.
7. **(menor, informe)** `implementacion-1.md` y el cuerpo de la PR dicen «`npm run verify`: 2097/2097». `npm test` (lo que corre `verify`) cuenta **2085** en este worktree; **2097** es la cuenta de `npm run coverage` (12 tests solo bajo cobertura). El número del informe no es el de `verify`.
8. **(pendiente, no de la PR)** «Mutación: NADIE mide este módulo… va a issue» (plan §9, PR): `gh issue list --search "mutación dispatcher"` no encuentra ninguno abierto. El coordinador debe abrirlo o la deuda se pierde.

## Workarounds usados (y su veredicto)

- **Symlink `nefan-html/public/sprites` → checkout principal.** En este worktree limpio la partida no arranca: «No se pudo empezar la partida. Faltan las hojas de sprites del personaje…» (#255, conocido; arte gitignored). Sin él no hay flujo real que probar. No afecta al jugador con instalación completa. **Efecto colateral medido:** mientras estuvo puesto, `repo-hygiene.test.ts` dio 2 rojos («ningún symlink trackeado apunta a un fichero que ya no existe» y su guardia en negativo) → los 2 fallos de `npm run coverage` son míos, no de la PR (retirado: 8/8 verde). Retirado al terminar; el árbol queda con solo `qa/guiones/73-…` y este fichero.
- **El motor real sustituido por el State API** (`POST /map/place` con triggers `plugin_event`): es el mismo cable que la tool MCP `map_upsert_place`, y `fireMapTriggers` corre el mismo `runPluginTick` que `dialogue.ts`. El fake-ai-server no emite `plugin_event` en `/report_player_choice`, así que el camino «diálogo → consequence → plugin» no se ejerció (ver no probado).
- **Respawn con R**: el tile de bench trae un «Bandido de camino» que mató al jugador durante el paseo (HP 0 en la captura z1). Es lo que haría quien juega; el guion lo hace por `inputDriver.queueRespawn` cuando el State API da HP 0.

## No probado

- El camino **diálogo → `plugin_event`** (el fake no lo emite): el gate es el mismo `dispatchPluginEvents` que cubren `test/plugin-dispatcher.test.ts` (#452) y los map triggers de aquí.
- Nada con motor real ni créditos (por diseño de la tanda).
- `commerce` comprando con el motor real: ya emite `{id, from}`; el guion 14 (compra por trigger) sigue verde con la PR.
- Mutación del módulo: no existe módulo que mida `dispatcher.ts`/`narrative-state.ts` (hallazgo 8).

## Comandos y salidas (resumen)

```
npm run verify                          → EXIT=0 · tests 2085 · pass 2085 · fail 0
npm run coverage && npm run crap -- --check → ✔ dentro de los umbrales (89.2 %, 0 > 73, 7 > 30); 2 rojos de repo-hygiene por MI symlink (sin él 8/8)
npm run deuda                           → Deuda medida — 83 items
npm run afectado -- --rango 3a0f8ef..4370fd0 → 14 módulos «sus baterías lo cargan»; plugin-dispatcher.test.ts en ninguna batería
node qa/run.mjs 73                      → 1 en verde · 0 en rojo (26 ✔)
node qa/run.mjs 73 (puertas anuladas)   → 1 en rojo (11 ✘) — restaurado con git checkout
node qa/run.mjs 14-plugin               → 1 en verde
NEFAN_PORT_OFFSET=700 ./start.sh --parar → ✅ stack cleaned (lo ajeno en :10377/:3500/:19265 enumerado y no tocado)
```

Capturas manuales: `qa/capturas/qa-b-452/` (z1 overlay sin id · z6 overlay `inventory[0].id=""` · título tras reanudar save sin id). Capturas del guion: `qa/capturas/2026-09-05T15-34-51-039Z-257689/`.
