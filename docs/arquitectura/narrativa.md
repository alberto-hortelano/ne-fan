# El motor narrativo y el MCP bridge

Cómo viaja una escena desde Claude hasta el cliente, y cómo una elección de diálogo se convierte en mundo nuevo.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## MCP bridge — Como funciona la narrativa

**Sesión canónica en el bridge**: la sesión vive ahí (`NarrativeState` TS + plugins) y el cliente habla con él por WebSocket (`net/bridge-client.ts`) con `start_session`/`resume_session`/`save_session`/`dialogue_choice`/`interact_entity`. El cliente no persiste nada: hay **un solo escritor** de `saves/{id}/state.json`, el bridge, que además snapshotea pos/HP del sim al guardar y resiembra el sim al reanudar. Sin bridge no hay sesión — el cliente queda en modo visual/dev sobre las fixtures locales, sin plugins ni motor narrativo.

**Generación de escena inicial open-world**:
1. El cliente envía `start_session` al bridge; el bridge crea la sesión, activa plugins shipped y hace POST `/generate_scene` a ai_server (`AiClient.generateScene` en nefan-core)
2. ai_server envía request vía WebSocket a narrative-mcp (:3737), añadiendo `available_assets` (lista del manifest) y `session` info
3. Claude Code (en otra terminal) llama `narrative_listen()` → recibe el world_state
4. Claude genera la escena JSON completa, opcionalmente referenciando assets cacheados por hash → llama `narrative_respond(scene_json)`
5. ai_server la devuelve al bridge, que la registra en su NarrativeState (Format D crudo), la **normaliza con `formatDToWorld`** y la difunde como `narrative_event` (effect `spawn_entity` con `data.scene` = world scene; el resume normaliza igual vía `sessionDataForClient`)
6. El cliente la recibe por `NarrativeClient` y la monta con `FpsRenderer` (que respeta `texture_hash`/`model_hash` para reuso); el player spawnea en `__player_start`

**Identidad de mundo en el contexto**: `world.description` (el brief) viaja en CADA turno vía `serializeForLlm`; el `world.md` completo solo en el bootstrap (`world_document`) y bajo demanda con la tool MCP `world_doc_get` (→ `GET /world_doc` del State API). Los SISTEMAS DE UI del cliente (diálogo, viaje/salidas, spawns, HUD de combate, modo gráfico, plugins, triggers de mapa) están documentados para el motor en `data/contract/prompts/ui_systems.md`, servido con la tool MCP `ui_doc_get` (→ `GET /ui_doc`: doc + `ui_state` con la configuración ACTIVA de la sesión). Las restricciones de motor (cámara en PRIMERA PERSONA a la altura de los ojos, SOLO personajes humanoides, sin beats, `style_ref` por escena desde `world.style_refs`) viven en `WORLD_RULES` (narrative-mcp/server.ts) con espejo en `narrative_schemas.py`.

**Reactividad narrativa (diálogo → spawn dinámico)**:
1. El jugador pulsa `E` sobre un NPC (→ `interact_entity`), elige opción `1/2/3` o pulsa `T` y escribe respuesta libre (→ `dialogue_choice`)
2. El bridge registra el evento en su NarrativeState y llama `reportPlayerChoice` → POST `/report_player_choice` en ai_server
3. ai_server envía `narrative_event` por MCP con el contexto compacto del NarrativeState
4. Claude responde con `consequences: [story_update | spawn_entity | schedule_event | plugin_event]`
5. El bridge aplica las consequences (dispatchConsequences + tick de plugins), guarda, y difunde `narrative_event` con los effects
6. El cliente los materializa sin recargar la escena (diálogo, `materializeSpawn` para las entidades nuevas, delta de historia…) — solo pinta lo que el bridge ya guardó

El usuario tiene cuenta Claude Max — preferir MCP bridge sobre API key directa.
