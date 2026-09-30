# QA — Tanda BZ: lo que ve el motor

Rama `tanda-bz-lo-que-ve-el-motor`, commit `885f8015`. Validado contra `requisitos.md` (petición + corrección de la premisa + ajustes del coordinador).

## Cómo se probó

Stack REAL en puertos privados (bloque +2700; los puertos del usuario, `3737/8765/8767/9877`, no se tocaron y siguieron arriba al terminar):

- asset-store real (`services/asset-store/server.ts`, `:11467`) sobre una copia del `cache/manifest.sqlite3` del usuario hecha con el API de backup de SQLite en modo solo lectura (WAL incluido: 179 filas `surface`);
- ai_server real (`ai_server/main.py --port 11465`, `NEFAN_LLM_MCP_URL=ws://127.0.0.1:6437`, `NEFAN_SPEND_DIR` temporal);
- narrative-mcp real (`dist/server.js`, recompilado) por stdio con `NARRATIVE_WS_PORT=6437`, conducido por un cliente MCP que hace de motor: llama a `narrative_listen` y vuelca el texto a disco. No responde nunca;
- bridge real (`:12577/:12578`, `NEFAN_SAVES_DIR` temporal) y un cliente WS que manda `start_session` como el juego.

Es el camino entero: `start_session` → bridge → ai_server `_inject_available_assets` → asset-store → narrative-mcp → texto de `narrative_listen`. Los scripts están en el scratchpad de la sesión (`motor.mjs`, `juego.mjs`, `reinicia.sh`) y no se commitean: el cambio no es observable por el jugador y el camino necesita el ai_server real, que `qa/run.mjs` no levanta.

## Criterios

| Criterio | Estado | Evidencia |
|---|---|---|
| El motor ve SOLO superficies de ESTE estilo (acuarela_luminosa) | ✅ | `narrative_listen` real, sesión alta_fantasia/acuarela: 25 descripciones, las 25 `unique` de acuarela que hay en la DB y ninguna de otro estilo (cruzadas contra la copia de la DB). Antes, en esa partida, 28 de las 30 eran de otro estilo |
| El filtro casa con el estilo de la CLAVE (`id:token`), no con el id | ✅ | `GET /assets?style=acuarela_luminosa` (sin token) → 0 filas. Un estilo subido (`user_qa_bz`) con filas sembradas: salen las 2 `unique` de clave exacta; NO salen la fila sin token, la del token viejo ni la `tile` |
| Estilo subido por el usuario | ✅ | Pack `user_qa_bz` con un token hostil (`tinta: "sepia" & ñandú, 50% grano #1 / ?x=y`): la URL va bien codificada (`style=user_qa_bz%3Atinta%3A+%22sepia%22+%26+%C3%B1and%C3%BA…`), HTTP 200, y el motor recibe exactamente `["QA-BZ muro bueno dos","QA-BZ puerta buena uno"]` |
| Estilo con 0 superficies (`anime`) | ✅ con matiz | La petición sale (57.901 B) y **no lleva el campo** `available_assets`: ni lista vacía ni error. No es mentira (no hay nada reusable), pero ver el matiz en M1 |
| Asset-store caído | ✅ fail-soft, no se come la petición | Store parado: la escena llega al motor igual (57.847 B), sin `available_assets`; ai_server avisa en su log `LLM WARNING: asset-store no respondió la librería del motor: [Errno 111] Connection refused`. La generación sigue, que es lo esperado: sin librería el motor describe libre |
| Los tres kinds que llevan librería la reciben filtrada | ✅ | Con el estilo subido: `scene`, `narrative_event` (POST `/report_player_choice`) y `player_death` (POST `/report_player_death`) llegan al motor con las mismas 2 descripciones |
| El prompt deja de prometer «gratis» | ✅ | `scene_instructions.md` y `narrative_event.md` ya no dicen «for free» ni venden el acierto como seguro («likely, not guaranteed»); `world_vocabulary` dice «cache hit only once it has been painted in this game's style». El grep de `for free` sale a cero en los prompts. Leído como motor: ver M2 |
| La clave de caché NO cambia | ✅ | `surface_style_key` da lo mismo que la f-string anterior para los 5 packs, para un id inexistente y para `""` (script contra el `StylePackResolver` real). `surface_cell_context` no está en el diff. Misma guarda en `remote_generation` |
| JSON compacto y assets como `string[]` | ✅ | El texto real empieza por `{"kind":"scene","world_state":{"session_id":…` sin indentación; `available_assets` son strings sueltos |
| El candado de tamaño mide el texto completo y se pone rojo | ✅ con agujeros | `el-texto-de-listen-tiene-techo.test.ts` verde (2/2). En un worktree temporal: un byte más en `world_rules.md` → ✖. Quitar la cláusula de estilo del SQL → ✖ en `asset-store.test.ts`. Agujeros en I1 e I2 |
| Tamaño «holgado» bajo el tope de la tool MCP | ❌ / ⚠️ | El texto ha bajado un 13 % (66.741 → 57.992 B en la petición del candado), pero la **primera petición de cada partida nueva mide 60.481 B** en vivo, y eso solo con 25 descripciones. No sé cuál es el tope real. El coordinador ya aceptó no recortar las instrucciones en esta tanda |
| Ninguna ruta pide `available_assets` sin estilo | ✅ | Solo se inyecta en `generate_scene`, `report_player_choice` y `report_player_death`, y las tres llevan `serializeForLlm` → `world.style_id`. `develop_world` no inyecta (correcto: aún no hay estilo). El fake-ai-server de `labs/` no toca la librería. Sin `style_id` → no hay librería, con aviso (test Python) |
| Tests de ai_server | ✅ | `unittest ai_server.tests.test_available_assets` → 14 OK |

## Hallazgos

### Importante

**I1. El techo no cubre la petición más pesada: la primera de cada partida.** El candado mide un tile (1,0) a mitad de partida (techo `scene` = 57.992 B). Pero la petición de bootstrap lleva además `world_document` (13.385 B; lo añaden `bootstrap-tile.ts:47` y `tile.ts:168`), y en vivo mide **60.481 B** con solo 25 descripciones. Con la ventana llena (30) serían ~61 KB. Es la primera petición que ve el motor en cada juego, y la que más fácil rompe el tope. El `_lo_que_esto_NO_sujeta` del test habla de «un save más grande», pero no dice que el caso normal del arranque ya se pasa del techo.
Reproducir: `start_session` alta_fantasia/acuarela_luminosa → el primer `narrative_listen` mide 60.481 B, más que el techo de 57.992 B de `techo-de-listen.json`.
Esperado: que el candado mida también el kind bootstrap (con `world_document`), o que declare que no lo mide.

**I2. «Holgado» sigue sin demostrarse, y hay indicios de que no lo es.** `tope_mcp` no tiene número. En esta misma sesión, un resultado de herramienta de 32 KB se volcó a fichero, así que el umbral del arnés anda por debajo de los 58-60 KB. No he medido el umbral de las tools MCP y no lo doy por probado, pero el síntoma del playtest («el motor lee desde fichero») probablemente sigue vivo. Ya está declarado y el coordinador lo aceptó: lo apunto para que no se cierre como resuelto.

### Menor

**M1. «Vacío», «store caído» y «sin estilo» llegan al motor igual: sin el campo.** Para el motor da lo mismo, porque en los tres casos describe libre. Pero en `produccion` el store caído significa que todo se repinta y se paga, y eso solo queda en el log de ai_server. Ni el jugador ni el motor lo ven. Un `available_assets: []` explícito para el estilo sin superficies sería más honesto que omitir el campo. Tampoco es bloqueante.

**M2. El prompt, leído como motor.** «reuse its description VERBATIM … on the same kind of face it describes»: la lista son strings sin metadatos, así que el motor no puede saber a qué tipo de cara pertenece cada entrada si no lo adivina por el texto. La frase pide algo que el motor no puede comprobar. El resto se entiende bien y no promete gratis.

**M3. Un 4xx del store se degrada igual que un store caído.** `httpx.HTTPError` también recoge `HTTPStatusError`. Un 400 por divergencia de contrato (un bug de código) acaba como «asset-store no respondió» y la petición sigue sin librería. El informe dice que «un bug de código ya no se traga», y aquí esa clase de bug sí se traga. Hoy no se da en la práctica: el estilo nunca va vacío y el kind es fijo.

**M4. El candado no ata `server.ts` al módulo que mide.** En un worktree temporal cambié la rama de escena de `server.ts` a la composición vieja (`null, 2` y sin `scene`/`world_rules`) y el test del techo siguió **verde** (2/2). Lo caza de rebote el lint de narrative-mcp (`'textoDeEscena' is defined but never used`), pero solo si el bypass es total: envolver o añadir texto en `server.ts` no lo ve nadie. La igualdad byte a byte la comprobó el ingeniero una vez, a mano.

**M5 (fuera de alcance, previo).** El asset-store y el bridge no aplican `NEFAN_PORT_OFFSET` a su propio puerto de escucha (hacen falta `NEFAN_ASSET_STORE_PORT`, `NEFAN_BRIDGE_PORT` y `NEFAN_STATE_HTTP_PORT`). Los dos fallaron con EADDRINUSE contra el stack del usuario en vez de pisarlo, que es lo correcto, pero CLAUDE.md dice que el offset «desplaza el bloque entero». No es de esta tanda.

## Workarounds usados

- **Motor de mentira** (cliente MCP que no responde): sustituye a Claude Code como motor, porque el `:3737` es del usuario. No afecta al jugador: el texto que mido es el que devuelve la tool real.
- **Reiniciar ai_server y el motor entre escenarios**: ai_server se queda bloqueado esperando la respuesta que mi motor nunca da. Es un artefacto de no responder, no un hallazgo.
- **Pack `user_qa_bz` y 5 filas sintéticas en la COPIA de la DB**: simulan un estilo subido sin pasar por `/styles/upload` (que llama a remote-gen). Hubo que poner `subtype='surface'` porque el store se niega a arrancar con filas de kind sin productor, y eso es correcto. Pack borrado al terminar.
- **Diálogo y muerte por POST directo a ai_server** con un contexto sacado de la petición real (sin montar una escena jugable). La forma del contexto es la de `serializeForLlm`, así que esto no afecta a lo que se juzga.

## No probado

- El tope real de la tool MCP en Claude Code (bytes o tokens) y si 58-61 KB lo pasan.
- Una partida con el motor real respondiendo y reusando una descripción, para ver que sale cache-hit en `produccion` (gasta créditos).
- El resume de un save existente por el cable (el código es el mismo `serializeForLlm`).

## Veredicto

**Apto con reservas.** El motor ve solo superficies de la clave de estilo de la partida: probado de punta a punta, también con un estilo subido y un token hostil. Un estilo sin superficies no ofrece nada, y el store caído no se come la petición. El prompt ya no promete gratis y la clave de caché no cambia. Las reservas: el candado de tamaño no cubre la petición de bootstrap, que ya mide 60,5 KB (I1); «holgado» sigue sin demostrarse (I2); y el candado no ata `server.ts` al texto que mide (M4).
