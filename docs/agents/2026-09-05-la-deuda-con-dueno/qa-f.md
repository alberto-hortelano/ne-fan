# QA-F · PR #460 (#405) — `tile` obligatorio en las dos poblaciones; muere la rama «centrada en el origen»

**VEREDICTO: APTO CON HALLAZGOS** (ninguno bloqueante; tres rastros menores atribuibles a la PR y dos observaciones ajenas a ella).

Worktree `/home/al/code/ne-fan-t13-qa-f` · HEAD `2f8b3d1` (rama `t13/tile-obligatorio`) · base `3a0f8ef` · `NEFAN_PORT_OFFSET=500` · cero créditos (`e2e-sin-creditos` y `html-fixtures`; el guardarraíl del banco confirmó `fake:true` en cliente y bridge en cada corrida). 2026-09-05.

## Criterios de cierre (literal del issue, reencuadrado por la crítica)

| Criterio | Veredicto | Evidencia |
|---|---|---|
| `tile` obligatorio en `ExpandedSceneSchema` | ✅ | `scene-schema.ts:194` `tile: TileCoordSchema` en `sceneBaseShape` (la forma base de las DOS poblaciones), `required_error` nombra `generate_tile` (`:182`). El `superRefine` de la emitida ya no lo exige aparte. Test nuevo `scene-schema.test.ts` «ExpandedSceneSchema — tile obligatorio también en lo que se CARGA»: con `tile` pasa, sin él el primer issue es `["tile"]`. Y por el camino del jugador: guion 73 paso 3 (escena del save sin `tile` → `save_invalido` nombrando `tile`) |
| `tile` obligatorio en `WorldScene` | ✅ | `scene-normalize.ts:77` `tile: TileCoord;` (sin `?`). `cd nefan-html && npx tsc --noEmit` → rc=0 con `tile-store.ts` `tx/ty: number` |
| Ningún test construye una escena sin `tile` | ✅ (con matiz) | `helpers.ts:84-97` y `makeFormatD` construyen por `expandScenePrimitives({tile:{0,0},…})`. Barrido: de los ficheros de test que mencionan `scene_id`/`entities:` y no contienen `tile`, los 5 restantes (`ai-client`, `plugins-dsl`, `plugins-views`, `world-map`, `speaker-resolve`) no construyen escenas Format D (usan `current_scene_id`, `entities: []` del mundo o un `scene_id` en un speaker). Las únicas escenas sin `tile` que quedan son **negativas** (`scene-fixtures.test.ts:100` `aldea_suelta`, `state-http-server.test.ts:298`, Python `suelta_scene`), que afirman el rechazo — es lo correcto |
| `grep -rnE "legacy\|centrada en el origen"` sobre `src/scene`, `bridge/sim-collision.ts`, `nefan-html/src/world` → solo `greybox/surfaces.ts` | ✅ | Salida exacta: `greybox/surfaces.ts:42` y `:278` (`hero`/`desc`, otro sujeto). Nada más |
| Camino `loadRoom` sin grid del cliente fuera | ✅ | `grep -rn isGridTile nefan-core nefan-html/src` → 0. `carga-de-tile.ts` y `tile-store.ts` sin rama «no es grid» (diff −70/−49 líneas). Adversarial: `addTileRaw` de la fixture real sin `tile` → rechaza «una escena necesita `tile` {tx,ty}…» y la escena que había sigue puesta (`qa/fixtures-las-tres-se-caminan.mjs`, paso 5) |

## Lo que pidió el coordinador, punto por punto

### 1 · Greps de rastros
- `tile?` en `nefan-core/src`, `bridge`, `nefan-html/src`: quedan **dos** tipos opcionales: `protocol/messages.ts:442` `tile?: {tx,ty}` en `narrative_status` (legítimo: el status de `kind:"scene"`/`plugin` no lleva tile) y **`nefan-html/src/ui/style-apply.ts:111` `tile?: unknown` en `SnapshotScene`, que ya no lee nadie** (la PR quitó su único lector, `if (scene.tile === undefined) continue`; `grep "\.tile\b" style-apply.ts` → 0). Hallazgo H-1.
- `isGridTile` → 0. `change_scene` → 0 fuera de `docs/agents`. «saves sin migrar», «migración v3», `hasAnyTile` → 0 fuera de `docs/`.
- «centrad»: solo geometría viva (`tile.ts:4,59,70` «tile (0,0) centrado en el origen»; `greybox/common.ts:17`, `volume-prims.ts`, UI). Ninguna «escena centrada».
- «legacy» amplio: 20 apariciones fuera del alcance del criterio, todas de otros sujetos (`render_mode` "", `edges` sin link, `remote-gen`, sesión de fixtures…) **salvo `npc-records.ts:4,76-101`**, ver H-2.
- Prosa: `CLAUDE.md:199` ya dice «una escena sin `tile` la rechazan el zod, su espejo Python y `validateScene`». `docs/arquitectura/*.md`: 0 menciones de tile opcional/escena suelta/legacy accesible. `narrative-mcp/*.ts`, `prompts/*.md`: 0. `TravelPanel` solo aparece como el panel de salidas vivo (`ui_systems.md:18`, `messages.ts:231`), no como «legacy accesible por TravelPanel». `tools/generate_scene.json` declara `tile` con `required: ["tx","ty"]`.

### 2 · Tests: ¿coordenadas exactas o degeneradas?
`git diff 3a0f8ef -- nefan-core/test/scene-normalize.test.ts`: **todas las aserciones reescritas son `deepEqual` a valores exactos** — taberna `[-30, 0, -31]` escala `[2, 2.5, 1]`, barkeep `[-30.25, 0, -30.75]`, jugador `{x:-29.25, z:-29.25}`, `dimensions {64,64,3}`, `world_rect {-32,-32,32,32}`; y los tres tiles nuevos (0,0)/(1,0)/(−2,3) con rect y `origin` exactos. Ninguna `ok(x > 0)`. Cero aserciones perdidas: la de «biome no declarado no viaja» se sustituyó por `equal(wire.biome, "grass")` (más fuerte, no más débil). El `break` 98 de `scene-normalize` no lo pude medir (313 mutantes > `tope_local` 120): **no probado**, pedido en la PR.

Muertos y declarados (comprobados en el diff): `sim-collision` «sin tile → sin colisión», `scene-expand` rama `sinTile` (ahora «lanza»), `tile.test` «legacy conservan el rect centrado», `mundo-persistido` `legacy: {}`, `scene-normalize` «biome no declarado». `bridge-map` «sin tile bajo el jugador» reencuadrado a «sin escena activa» con comentario que lo dice.

### 3 · Jugabilidad real desde el arranque (offset 500)
- **`html-fixtures`** — `qa/fixtures-sin-bridge.mjs` → `✔ html-fixtures pinta sin backend` (frames 11→102, tile `tile_0_0`, 6 billboards, el muro cita el socket efectivo `ws://127.0.0.1:10377` y el movido `127.0.0.2:10380`). **Guion nuevo `qa/fixtures-las-tres-se-caminan.mjs`** (grupo: corrida LOCAL, conduce `start.sh` + Chromium; misma casilla que `fixtures-sin-bridge`), las TRES fixtures: `robledo_tile` (24 objetos · 5 npcs · anduvo (−1.75,10.25)→(−1.75,9.63) · centro de `casa_concejo` colisiona · spawn libre), `puerto_tile` (16 · 4 · anduvo · `lonja` colisiona), `zorder_test` (0 objetos · 14 npcs · anduvo; colisión contra edificio **⊘ no medible**: la fixture es solo NPCs, declarado). Las tres con `scene.tile {0,0}` y `world_rect [−32, 32)²`. **Negativo**: con `window.__nefan.probeCollide = () => false` desde la página → `✘ robledo_tile: el centro de casa_concejo NO colisiona`, `✘ puerto_tile: … lonja …`; restaurado por copia.
- **`e2e-sin-creditos`** — `NEFAN_PORT_OFFSET=500 node qa/run.mjs …`: **16 guiones en verde, 0 en rojo**, en tres corridas: `01 46 58 60 63 64 65 68` (8/8), `02 05 24 44` (4/4), `08 09 17 48` (4/4). Cubren tiles que vuelven (58), resume que pinta el tile del jugador (60), posición fuera del mundo (63), enlaces al panel (64), salidas en los bordes (65), la escena servida = el tipo (68: `addTileRaw(__nefan.scene)` sigue rechazando nombrando lo que falta), colisión desde huella (02), terreno desde `ground` y tile nuevo explorado (05), viaje ida y vuelta (08/09: llegada `tile_2_0` con `source:"engine"`, vuelta `tile_0_0` con `source:"cache"` — el `ready` siempre-`tile` es lo que alimenta ese ledger) y guardar/reanudar (17/48).
- **Muro «sin bridge» que reaparece a los ~5 s en `html-fixtures`**: confirmado en mis tres capturas `qa/capturas/las-tres-*.png` (todas con el muro encima aunque se descartó al arrancar). **Ajeno a la PR**: `nefan-html/src/net/bridge-client.ts` (`scheduleRetry`, `:206`; «el reintento cada 5 s», `:146`) no está en el diff (`git diff 3a0f8ef --stat -- nefan-html` → solo `main.ts`, `style-apply.ts`, `world/{carga-de-tile,collision,tile-store}.ts`), y el diff de `main.ts` no toca loader ni `onAviso` (la única línea con «muro» es un comentario reindentado). Ver O-1.

### 4 · Saves
**Guion nuevo `qa/guiones/73-un-save-con-el-tile-cambiado-no-carga.mjs`** (grupo: batería de NAVEGADOR, `node qa/run.mjs 73`), verde 14/14: registro sin `tile` → `save_invalido: save "…": scenes_loaded["tile_0_0"].tile falta — pre-producción, sin migraciones (#336)…`; registro con `tile {3,-2}` distinto de su escena `{0,0}` → `save_invalido` nombrando los dos valores; escena sin `tile` → `save_invalido` nombrando `tile`; el fichero tocado no se reescribe; **el jugador**, al pulsar «Reanudar», vuelve al título y lee: «No se pudo reanudar la partida. Esa partida guardada ya no vale para esta versión del juego: bórrala o empieza una nueva.» (captura `qa/capturas/2026-09-05T15-36-03-643Z-259604/73-…-titulo-tras-reanudar-save-con-tile-cambiado.png`); restaurado el fichero, el resume carga. **Negativo**: con `if (declarado?.tx !== t.tx || …)` neutralizado (`false && …`) en `narrative-state.ts:527` → 4 rojos (`{"ok":true}` en el tile cambiado; en el registro sin tile el bridge revienta con `Cannot read properties of undefined (reading 'tx')` en vez de rechazar; el título no vuelve con error) — el guion distingue. Fuente restaurada por copia (`git diff --stat` limpio).

### 5 · El motor
- Python: `NEFAN_SPEND_DIR=$(mktemp -d) python -m unittest discover -s ai_server/tests` → **Ran 236 tests · OK** (sin `NEFAN_SPEND_DIR` la suite se niega a arrancar por el ledger de gasto — correcto, es el candado del banco). Espejo `narrative_schemas.py:675-679`: sin tile → `ValueError("una escena necesita \`tile\` {tx,ty}: es la única variante de Format D (mundo continuo, pídela con generate_tile)")`, texto idéntico al `required_error` del zod y al de `tileCoordDe`.
- Zod: `scene-schema.test.ts` «issue `["tile"]` nombrando `generate_tile`». HTTP: `state-http-server.test.ts:296-301` `/scene/validate` de la suelta → `ok:false` con un error que incluye `` `tile` ``.
- **Desviación 1 (`tileContextFor` conserva la guarda)**: razonable, **no es la rama legacy con otro nombre**. Devuelve `undefined` de CONTEXTO (no una escena) cuando el payload del modelo aún sin validar no trae tile; `validateScene` rechaza esa misma escena a continuación con el mensaje que lee el modelo. Hacerla lanzar convertiría el pre-flight en un 500 mudo para el motor. El único rastro que era legacy allí (`hasAnyTile`) murió: `bootstrap = scenes_loaded vacío`, con los dos estados testeados.

### 6 · Ready siempre `kind:"tile"`
Productores de `phase:"ready"` en el bridge: `context.ts:346` (`kind:"tile"`) y `ws-server.ts:225` (`kind:"plugin"`). El enum `kind` de `narrative_status` conserva `"scene"` **con productores** (viaje: `handlers/scene.ts` generating/error, `router.ts:258` error, `ws-server.ts:186` progress): ningún valor sin productor. Lo que sí queda es un **lector sin productor en el cliente**: `main.ts:1893` `case "ready": hideLoader()` dentro de `if (status.kind === "scene")` — nadie emite ya `scene`+`ready`. Inofensivo (H-3).

### 7 · Métricas y tamaños
- `cd nefan-core && npm run verify` → rc=0, `tests 2099 · pass 2099 · fail 0`.
- `npm run coverage` → 2099/2099; `npm run crap -- --check` → «1234 funciones · cobertura 89.2% · Tope CRAP ≤ 73: 0 por encima · Objetivo ≤ 30: 7 por encima · ✔ dentro de los umbrales».
- `npm run deuda` (tras coverage) → **83 items** (15 fronteras + 11 CRAP + 57 supervivientes). Sin coverage previo imprime «PARCIAL — 72», que no es una regresión sino la fuente de complejidad sin medir.
- `cd nefan-html && npx tsc --noEmit` → rc=0. `wc -l`: `main.ts` **2374**, `style-apply.ts` **532**, `title-screen.ts` 1732 = exactamente `client-file-size.json` (2374 / 532 / 1732).
- `git status` limpio salvo mis dos guiones sin trackear.

## Hallazgos

**H-1 · menor (de esta PR) — `SnapshotScene.tile?: unknown` sin lector.** `nefan-html/src/ui/style-apply.ts:111`. La PR quitó el `if (scene.tile === undefined) continue` pero dejó el campo opcional en el tipo privado; hoy no lo lee nadie (`grep "\.tile\b" style-apply.ts` → 0). Es exactamente el «tipo opcional residual» que el coordinador pidió buscar. Repro: `grep -n "tile?" nefan-html/src/ui/style-apply.ts`. Esperaba: o el campo desaparece del tipo, o pasa a `tile: {tx,ty}` obligatorio si el snapshot lo garantiza (lo garantiza: `ExpandedSceneSchema` lo exige al cargar).

**H-2 · menor (preexistente, candidato a issue, NO de esta PR) — `registerSceneNpcs` conserva un lector de `npcs[]` con `position` que es inalcanzable.** `nefan-core/src/narrative/npc-records.ts:76-101` («Legacy scenes: npcs[] with {id, name, position}»). Confirmado sin productor: `sceneBaseShape` no declara `npcs` y los dos schemas son `.strict()` (`scene-schema.ts:139,340`), y el único llamante es `recordSceneLoaded` (`narrative-state.ts:708`), que va detrás del gate `ExpandedSceneSchema`. Una escena con `npcs` en la raíz no puede llegar a esa función. Son 26 líneas muertas más la prosa `:4` y `:152` («Format D o legacy»). Esperaba: fuera del alcance del issue #405 (no es la rama centrada), así que va a issue propio, como propone el informe del ingeniero.

**H-3 · menor (de esta PR) — lector `kind:"scene"` + `phase:"ready"` sin productor en el cliente.** `nefan-html/src/main.ts:1880-1897`: el `switch` del `kind:"scene"` conserva `case "ready": hideLoader()`, y desde esta PR el `ready` es siempre `kind:"tile"`. La PR dice «`scene` sigue vivo para el viaje», y es cierto para `generating`/`progress`/`error`; el `ready` de `scene` es rama muerta. Inofensivo para el jugador (el loader lo cierra el `ready` del tile, guiones 08/09 verdes). Esperaba que la rama se quitara con el cambio de productor, o un comentario que diga por qué se queda.

**O-1 · observación ajena (preexistente en `main`) — en `html-fixtures` el muro «No se pudo arrancar la partida» reaparece cada ~5 s.** `bridge-client.ts` reintenta el socket (`scheduleRetry`) y cada fallo del `bootstrap` vuelve a pintar el muro sobre el visor; quien itera renderer/UI con las fixtures tiene que cerrarlo una y otra vez. Repro: `./start.sh --preset html-fixtures`, abrir el cliente, «Cerrar» el muro, cargar una fixture del selector, esperar 5 s. Las tres capturas `qa/capturas/las-tres-*.png` lo muestran. Ningún issue abierto lo nombra (`gh issue list --search muro` → solo #425, que es el título). Candidato a issue; no bloquea esta PR (el preset sirve para lo que promete: pinta, se camina, colisiona).

**O-2 · observación ajena (fixtures del banco) — spawns pegados a geometría.** Guion 08: al llegar al molino el jugador aparece con la fachada (placeholder ajedrezado) ocupando toda la pantalla (`08-…-02-destino-anclado.png`); guion 48: reanuda dentro de un volumen oscuro con los rótulos de NPC flotando (`48-…-02-mundo-reanudado.png`). Son las escenas del motor falso, no del PR; se anota porque es lo que ve un jugador del bench.

## Workarounds usados
- Ninguno sobre el flujo del jugador: título → «Nueva partida»/«Reanudar» → mundo, fixtures por el selector «Room», viaje por «Salidas». El muro sin bridge se descarta **una vez con su botón** «Cerrar» (lo que haría el jugador), no con `display:none`.
- Los guiones leen estado por `window.__nefan` (`probeCollide`, `inputDriver`, `addTileRaw`, `state`, `scene`): es el banco estándar de `qa/`, no un atajo de la feature. `?input=scripted&raf=timer` en la URL es lo que exige el headless (mismo criterio que `run.mjs`).
- Las dos pruebas en negativo mutaron fuente a mano (`narrative-state.ts:527`; monkeypatch de `probeCollide` en el guion) y se restauraron por copia; `git status` lo confirma.

## No probado
- **Mutación** de `scene-normalize` (313 mutantes, `break` 98, 4 vivos) y `contrato-escena` (290): fuera de `tope_local`, pedidas en la PR. Si la batería reescrita afloja, lo dirá esa corrida; por inspección del diff no perdió precisión.
- **Motor real** (Claude por MCP): el pre-flight sin `tile` se probó por el zod, el espejo Python y `/scene/validate` con `unittest`/`node:test`, no con una respuesta viva del modelo. Cero créditos por decisión.
- **`main` directamente** para O-1: atribuido por diff (los ficheros del reintento y del loader no cambian), no por arrancar `main`.

## Ficheros de esta QA
- `docs/agents/2026-09-05-la-deuda-con-dueno/qa-f.md` (este).
- `qa/guiones/73-un-save-con-el-tile-cambiado-no-carga.mjs` — batería de navegador (`node qa/run.mjs 73`), `aisla: ["saves"]`.
- `qa/fixtures-las-tres-se-caminan.mjs` — corrida local con `start.sh` + Chromium sobre `html-fixtures` (`NEFAN_PORT_OFFSET=<n> node qa/fixtures-las-tres-se-caminan.mjs`), misma casilla de `qa/README.md` que `fixtures-sin-bridge.mjs`.
- Capturas: `qa/capturas/las-tres-{robledo_tile,puerto_tile,zorder_test}.png`, `qa/capturas/sin-bridge-0{1,2,3}-*.png`, `qa/capturas/2026-09-05T15-3{4,6,8,9}-*/`.

`./start.sh --parar` (offset 500) → «nada que parar aquí»; `ss -ltn` → bloque 500 libre.
