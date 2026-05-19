# Auditoría del repo — propuestas de mejora

Auditoría enfocada en **modularidad/legibilidad, gestión de errores, gestión de estado y código muerto**. Cubre `nefan-core`, `narrative-mcp`, `ai_server`, `godot/` y `nefan-html`. Para código sospechoso de estar muerto, sólo se enumera con evidencia — ninguna propuesta destructiva.

Encaja con la línea reciente del repo (commits `narrative engine: strict fail-loud mode`, `remove silent fallbacks`, `fold ai_server config…`): la dirección correcta ya está fijada; aquí se identifican los rincones que todavía no han recibido el mismo tratamiento.

---

## 0. TL;DR

1. **Tres stores de estado** conviven (`GameState` GD, `NarrativeState` TS+GD, `GameStore` TS+GD) y la frontera entre ellos no es clara — varias rutas de Godot siguen escribiendo directamente en `GameState` legacy.
2. **Ruta legacy `generate_room` viva**: `godot/scripts/main.gd:668` la usa, con fallback silencioso a `_load_room_from_file(0)` (`main.gd:684-689`) — el opuesto exacto del modo fail-loud que el resto del stack ya adoptó.
3. **`bridge-client.ts:116-118`** ignora silenciosamente errores de parseo WS, pese a que el repo ya tiene `ErrorLog` ("nunca fallback silencioso", `nefan-html/src/ui/error-log.ts:1-11`).
4. **`session_recorder.gd:15`** conecta `GameStore.state_changed` sin desconectar en `_exit_tree`/`tree_exiting`. Sólo es un autoload (no leak real), pero marca un patrón: no hay convención de desuscripción para listeners GD.
5. **`reducers.ts:6-112`** mutan in-place; el contrato Redux-like (`(state, action) => state'`) no se cumple — riesgo bajo hoy pero rompe `snapshot()`+`restore()` si se introduce serialización selectiva.
6. **Reducer `room_changed` (`reducers.ts:84-88`)** machaca `state.enemies = payload.enemies ?? []`: cualquier `room_changed` sin `enemies` vacía la lista. `NarrativeState.entities` y `GameStore.state.enemies` no se sincronizan.
7. **Endpoints FastAPI sin Pydantic** (`ai_server/main.py:229,241,253,265,307,425,463,815`): `await request.json()` directo y `body.get(...)` con casts manuales. `report_player_choice:815` ya pasó al modo fail-loud — replicarlo en el resto.
8. **`generate_room`/`populate_room` legacy** vivos en `ai_server/main.py:229-250` y `ai-client.ts:91-103`. Decisión pendiente: retirar el call site de Godot y eliminar, o aceptar y documentar el dual-stack.
9. **`combat_resolver.gd` (4 líneas) y `enemy_combat_ai.gd` (17 líneas)** son scripts esqueleto cuya lógica vive en `nefan-core`. Sin call sites de instanciación encontrados — candidatos a borrar.
10. **`getRoomsByCategory()` y `createDevState()`** (`nefan-core/src/index.ts:13,15`) exportados al barrel pero sin call sites externos — candidatos a borrar de la API pública.
11. **`archive/ai-graphics-prototype/`** entero — declarado descartado en CLAUDE.md, no importado por nadie vivo.
12. **`ai_server/test_narrative.py`** — test legacy aislado, evaluar si el escenario que cubre sigue vivo.
13. **`schema_version` migration v1→v2** (`narrative-state.ts:102-104`) buena, pero no revalida hashes del `asset_index_snapshot` — un save de v1 con assets borrados se reanuda sin detectar la inconsistencia.
14. **Convención de logging incoherente** entre `print`, `push_error`, `console.warn`/`error` y `errors.push(...)`. Falta canal único hacia `ErrorLog` para el lado HTML/TS.
15. **`AiClient.reportPlayerChoice` (`ai-client.ts:120,124`)** devuelve `[]` en error (silencio) en vez de propagar — el bridge no distingue "no hay consecuencias" de "el LLM falló".
16. **Visión a medio plazo (§7)**: arquitectura de estado **extensible por plugins declarativos**. Genesis dual (developer o motor narrativo vía MCP), manifest determinista (hash estable cross-sesión), multi-consumer permitido. Encaja con la consolidación en curso de `NarrativeState` como fuente canónica.

---

## 1. Gestión de estado

### 1.1 Mapa actual de fuentes de verdad

| Pieza de estado | Dueño canónico (deseado) | Dueños reales hoy | Notas |
|---|---|---|---|
| Player position runtime | `GameStore` (proyección de input) | `GameStore.state.player.pos` (`game-store.ts:21`) **y** `NarrativeState.player.position` (`narrative-state.ts:40`) | Dos formatos distintos: tupla `[x,y,z]` vs `position: [x,y,z]`. Sincronización manual vía `updatePlayerPosition()` (`narrative-state.ts:343`). |
| Player HP | `Combatant` (Godot) ↔ `GameStore.state.player.hp` | `Combatant.health`, `GameStore.state.player.hp`, `NarrativeState.player.health` (`narrative-state.ts:37`) | Tres copias. El bridge sólo mantiene dos (`ws-server.ts:280` lee de `sim.getCombatant("player")`). |
| Lista de enemigos en escena | `GameStore.state.enemies` | `GameStore.state.enemies` (`reducers.ts:87`) **y** `sim.combatants` (en `GameSimulation`) **y** entradas en `NarrativeState.entities` (`narrative-state.ts:54`) | Tres listas, todas semánticas distintas: combat runtime vs combat lógica vs narrativa. |
| Mundo / `room_id` | `NarrativeState` (canónico) | `GameStore.state.world.room_id` (`reducers.ts:85`), `GameState.current_room_id` (`game_state.gd:27`), `NarrativeState.world.active_scene_id` (`narrative-state.ts:31`), `WorldMap.active_place_id` (`narrative-state.ts:150`) | Cuatro IDs paralelos. `recordSceneLoaded` actualiza tres (`narrative-state.ts:144-150`); el cuarto (`GameState.current_room_id`) lo escribe `mark_room_visited` desde la ruta legacy de salas (`game_state.gd:84-91`). |
| Story / dialogue history | `NarrativeState` | `NarrativeState.story_so_far`, `NarrativeState.dialogue_history` | Único dueño. Bien. |
| Asset manifest | `ai_server/asset_cache.py` (`AssetManifest`) | `AssetManifest` Python + snapshot en `NarrativeState.asset_index_snapshot` | El snapshot se persiste en saves pero nunca se revalida en `loadSession` (`narrative-state.ts:101`). |
| World map (places + links) | `WorldMapManager` dentro de `NarrativeState` | `narrative-state.ts:57` único dueño TS. Migrado en `migrateWorldMapFromV1` (`narrative-state.ts:440-459`). | Bien. |

**Conclusión**: la "fuente de verdad" canónica anunciada (`NarrativeState`) coexiste con dos legacy (`GameState`, fragmentos de `GameStore.world`). El proyecto está a mitad de migración.

### 1.2 Duplicación `GameState` ⇄ `NarrativeState`

`godot/scripts/autoloads/game_state.gd:1-163` mantiene un modelo paralelo completo: `region`, `time_of_day`, `atmosphere`, `style_token`, `player_level`, `player_class`, `player_health`, `player_gold`, `inventory_summary`, `active_quests`, `story_so_far`, `visited_rooms`, `current_room_id`, `player_model_id`, `player_skin_path`. Persiste por su cuenta a `user://save.json` (`game_state.gd:94-148`), separado del `state.json` multi-slot.

CLAUDE.md afirma que `GameState` es "wrapper legacy" sobre `NarrativeState` — **no lo es**: es un store paralelo con su propio save. La ruta legacy lo lee/escribe directamente:
- `main.gd:647-668`: `GameState.current_room_id`, `GameState.visited_rooms`, `GameState.serialize_world_state(...)`, `AIClient.generate_room(world_state)`.
- `main.gd:678`: `GameState.visited_rooms[cache_key] = room_data` después de generar.

**Propuesta** (decisión pendiente del usuario):
- **Opción A — Cortar la duplicación**: eliminar la ruta `GameState.serialize_world_state` + `AIClient.generate_room` y hacer que la entrada por `_on_exit_entered` use el bridge `player_entered_place` que ya está bien integrado en `ws-server.ts:663-746`. Hacer `GameState` un *thin getter* que delegue a `NarrativeState` (lo que CLAUDE.md ya afirma erróneamente).
- **Opción B — Documentar el dual-stack**: si se quiere mantener la ruta de "salas cerradas" para F1/F2/F3, aislar `GameState` en un módulo `dev_only/` y marcar explícitamente que no es producción.

### 1.3 Acoplamiento `GameStore.enemies` ⇄ `NarrativeState.entities`

`reducers.ts:84-88` (case `room_changed`):
```
state.enemies = (payload.enemies as EnemyState[]) ?? [];
```
Cualquier dispatch de `room_changed` sin `enemies` los borra. `NarrativeState.entities` (donde viven NPCs spawneados por `registerSceneNpcs` — `narrative-state.ts:160-234`) nunca cruza ese boundary: los NPCs declarados en la escena no aparecen como combatientes ni como entidades en `GameStore`.

**Propuesta**: cuando una nueva escena se materialice en el bridge (`recordSceneLoaded`), proyectar la lista resultante de NPCs combatientes al `GameStore` en un solo dispatch — y dejar de pasar `enemies` por `room_changed` desde dos sitios distintos. Hacer la proyección un módulo `state-projection.ts` con tests.

### 1.4 Reducer no inmutable

`reducers.ts:6-124` muta `state` en sitio. Funciona porque `GameStore.snapshot()` (`game-store.ts:90-92`) usa `structuredClone` antes de exponerlo, pero rompe expectativas y bloquea optimizaciones triviales (memoización por identidad). Si en algún momento se quiere persistir snapshots cada N events sin clonar el árbol entero, la mutación in-place lo prohíbe.

**Propuesta**: dejar el patrón mutable (el coste de migrar es real, las ganancias prácticas hoy son pocas) pero añadir test que enforce la invariante "todo `dispatch` produce un objeto sin alias compartidos con el payload" — basta `Object.freeze` en modo dev. Es 30 líneas y blinda el contrato.

### 1.5 Listeners GD sin disconnect

`session_recorder.gd:15` conecta `GameStore.state_changed` en `_ready()`. Como es un autoload, no muere — no es leak real. Pero el patrón se repite en otros nodos de vida finita: el repo tiene ~23 archivos `.gd` con `connect(...)`, y la búsqueda `state_changed.*disconnect` devuelve 0 resultados.

**Propuesta**:
- Convención de equipo: cualquier nodo no-autoload que conecte a una señal de un autoload **debe** desconectar en `tree_exiting`. Helper de una línea: `func _exit_tree(): GameStore.state_changed.disconnect(_on_state_changed)`.
- Auditar de una pasada los conectores que viven en nodos transitorios (NPCs spawneados, UI temporal). No requiere refactor masivo, sólo grep + parche por archivo.

### 1.6 Save/load: integridad de assets no validada

`narrative-state.ts:84-109` (`loadSession`) acepta `data.asset_index_snapshot` tal cual (`narrative-state.ts:101`) y no comprueba si esos hashes siguen existiendo en el `AssetManifest` del `ai_server`. Si el cache se borra entre sesiones, el siguiente `recordSceneLoaded` arrastra `asset_refs` muertos.

**Propuesta**: al cargar, hacer un `GET /assets/by_hash/{hash}` (ya existe — `ai_server/main.py:879`) por cada `asset_ref` único; los que devuelvan 404 se loguean a `ErrorLog` con severidad warning y se eliminan del snapshot. Mantiene fail-loud sin romper la partida.

### 1.7 Esquema objetivo (a medio plazo)

```
┌─────────────────────────────────────────────────────────────┐
│                       NarrativeState                        │
│  (única fuente de verdad persistente, schema versionado)    │
│                                                             │
│   world, player, scenes_loaded, entities, dialogue,         │
│   world_map, asset_index_snapshot                           │
└──────────────┬───────────────────────────────┬──────────────┘
               │ proyección (read-only)        │ mutaciones vía
               ▼                               │ recordXxx/updateXxx
        ┌──────────────┐                       │
        │  GameStore   │ ←─ inputs runtime ────┤
        │  (player.pos,│   (no se persisten;   │
        │   enemies,   │    derivables)        │
        │   combat)    │                       │
        └──────────────┘                       │
                                               │
        ┌─────────────────────────────┐        │
        │  GameState (Godot legacy)   │ ◀──────┘
        │  → wrapper de lectura sobre │   (escrituras sólo
        │  NarrativeState; no escribe)│    desde el bridge)
        └─────────────────────────────┘
```

Esto está implícito en el diseño actual; el trabajo consiste en cerrar los huecos donde la realidad se desvía (sección 1.2 sobre todo).

---

## 2. Gestión de errores

### 2.1 Catches silenciosos / fallbacks ocultos

| Ubicación | Qué hace | Por qué importa |
|---|---|---|
| `nefan-html/src/net/bridge-client.ts:116-118` | `catch { /* Ignore parse errors */ }` en `ws.onmessage` | El cliente HTML no se entera de frames malformados; rompe la filosofía declarada en `error-log.ts:11`. |
| `godot/scripts/main.gd:684-689` `_on_generation_failed` | `print("Generation failed: …"); _load_room_from_file(0)` | Fallback silencioso a sala hardcoded. Esto es exactamente lo que `report_player_choice` (`ai_server/main.py:815`) ya eliminó: ahora el endpoint lanza 503/422 fail-loud. Coherencia rota. |
| `ai-client.ts:120,124` `reportPlayerChoice` | `if (!res.ok) return []; … catch { console.warn(...); return []; }` | El bridge consume `consequences.length === 0` como "el LLM no quiso hacer nada", indistinguible de "el LLM falló y no lo sabes". |
| `ws-server.ts:582-591` `.catch((err) => …)` en `aiClient.generateScene` | Sólo loguea + broadcast `narrative_status: error`. **OK** — esto sí propaga al cliente. Mantener este patrón. |
| `ws-server.ts:427-429` `.catch((err) => …)` en `scenario.loadGame` | `console.error(...)` y nada más. El cliente que pidió `load_game` queda esperando hasta su propio timeout. |
| `ws-server.ts:735-744` lazy realize `.catch` | Equivalente a 582-591, ya propaga. **OK**. |
| `bridge-client.ts:108-110` `ws.onerror = () => { /* onclose fires later */ }` | Pierde el error original; sólo verás "disconnected". Loguear al menos el evento `Event` para tener algo. |
| `bridge-client.ts:163-179` `request<T>` | Si `!_connected`, lanza `"Bridge not connected"` — bien. Pero `send()` en línea 154-156 es silencioso si no conectado. |
| `logic_bridge.gd:209-212` `_handle_message` | `if msg == null or not msg is Dictionary: return` — silencia frames inválidos. En Godot debería ir a `push_error` con preview del frame. |
| `ai-client.ts:80-81, 95-96` | `body.slice(0, 200)` trunca cuerpos de error. FastAPI suele devolver stack traces útiles >200 chars. Subir a 2000 o no truncar. |
| `ai_server/main.py:413,420` `analyze_weapon` | Devuelve `{"error": "...", "fallback": True}` con 200 OK — el cliente debe leer el campo `error` para detectar fallo. Inconsistente con el 503/422 del resto. |
| `nefan-core/src/narrative/session-storage.ts:26-28, 35-37, 50-52, 59-61` (según hallazgo del agente, sin confirmar in situ) | Catches genéricos que no distinguen "no existe" de "I/O error". Re-verificar antes de tocar. |

### 2.2 Validación en boundaries

| Boundary | Validación | Recomendación |
|---|---|---|
| FastAPI POST endpoints (`ai_server/main.py:229-260, 265-345, 425-515, 537-712, 815-849`) | `await request.json()` + `body.get(...)` manual. Algunos campos obligatorios (`prompt`) se validan; los tipos no. | Pasar a Pydantic `BaseModel` por endpoint. `report_player_choice:815-849` ya hace casting defensivo (`str(...)`) — formalizarlo. |
| WebSocket bridge `ws-server.ts:217-231` | `JSON.parse` con catch que envía error al cliente. **Bien**. | Mantener. |
| MCP tools (`narrative-mcp/server.ts`) | Según hallazgo del agente, throws son capturados y stringificados sin esquema. | Validar con zod los `room_data` recibidos antes de enviarlos al `ai_server`. |
| `NarrativeState.recordSceneLoaded` (`narrative-state.ts:160-234`) | **Excelente**: lanza errores específicos por entrada inválida con índice. Es el modelo a seguir. | Tomar como referencia para los otros boundaries. |
| Godot WS handlers (`logic_bridge.gd:209-289`) | `get_node_or_null()` + acceso directo. Falla silenciosa. | Helper `_must_get_node(path: String) -> Node` que `push_error` y devuelve null + propaga el error al `ErrorLog` HTTP cuando exista. |

### 2.3 Promesas sin propagación al cliente

`ws-server.ts:385-429` (`load_game`): se llama `scenario.loadGame(...).then(...).catch((err) => console.error(...))`. El catch sólo loguea. El cliente WS espera la respuesta hasta su propio timeout sin saber qué pasó. El patrón correcto está en líneas 544-591 (broadcast un `narrative_status` con `phase: "error"` al cliente). **Aplicar el mismo patrón al case `load_game`.**

### 2.4 GDScript: nulls sin chequear

`logic_bridge.gd:235-237`:
```
var room: Node3D = get_tree().current_scene.get_node_or_null("Player")
if room:
    room = room.get_parent()
```
Si no hay nodo `"Player"`, `room` es `null`, el `if room` salta el bloque, pero todo el resto del método (`enemy_node:Node = _find_enemy_node(room, enemy_id)` línea 243) se ejecuta con `room=null`. `_find_enemy_node(null, ...)` puede crashear o devolver `null` silenciosamente.

**Patrón a establecer**: cuando una pre-condición sea obligatoria, `push_error` + `return` temprano. Cuando sea opcional, comentar el porqué.

Otros nulls no chequeados: `logic_bridge.gd:253, 260, 267`. `remote_control.gd` (según hallazgo del agente, sin verificación in situ): líneas 208, 211, 230, 242, 254, 261, 265, 276, 282, 286.

### 2.5 Contrato uniforme de errores propuesto

- **TS/HTML**: todo error capturado pasa por `errors.push(source, msg, err)` (`nefan-html/src/ui/error-log.ts:41-54`). Re-lanzar siempre que sea recuperable, devolver `Result<T,E>` cuando no.
- **TS/bridge**: `.catch()` en cualquier `aiClient.*Async(...)` debe terminar en `broadcastNarrative({type:"narrative_status", phase:"error", ...})` además del `console.warn`. Patrón ya correcto en `ws-server.ts:544-591`; falta en 427-429.
- **GDScript**: nunca `pass`, nunca `return` silencioso ante un `null`/parse-fail. Mínimo `push_error`. Si la condición es de degradación aceptable, comentario `# fallback intencionado: ...`.
- **Python/FastAPI**: replicar el patrón de `report_player_choice:815-849` (`HTTPException` con `status_code` específico y `detail` informativo). Pasar a Pydantic.

---

## 3. Modularidad y legibilidad

### 3.1 Responsabilidades difusas en `godot/scripts/main.gd`

`main.gd` actúa como orquestador, pero mezcla:
- Carga de escenarios open-world (vía bridge, ruta nueva).
- Carga de salas legacy (vía `AIClient.generate_room` directo + `_apply_room` local, ruta vieja, líneas 640-689).
- Gestión de transiciones de UI (`_hud.fade_out/_in`).
- Cache de salas en `GameState.visited_rooms`.

Dos rutas de generación (legacy vs canónica) en el mismo archivo enmascaran qué entradas siguen vivas y cuáles son sólo para F1/F2/F3.

**Propuesta**: extraer la ruta legacy a `main_legacy_rooms.gd` (o a `dev_room_loader.gd`) y dejar `main.gd` con la ruta canónica. Esto enseña al lector qué es producción y qué es testbed sin tocar comportamiento. Borrar nada — sólo separar.

### 3.2 Acoplamiento entre capas

- **`nefan-core` ↔ Godot**: el contrato real (`protocol/messages.ts`) está documentado por tipos. Bien.
- **`nefan-core` ↔ HTML**: `nefan-html/src/net/bridge-client.ts:14` importa con ruta relativa `../../../nefan-core/src/protocol/messages.js`. Funciona pero amarra la estructura de carpetas. Considerar publicar `nefan-core` como paquete local (`file:../nefan-core`) o alias TS `paths`. No urgente.
- **`ai_server` ↔ `narrative-mcp`**: el contrato pasa por WebSocket sin schema central. Los hallazgos del agente sugieren que un error en `room_data` desde MCP llega como string genérico al cliente. Añadir tipos compartidos (JSON Schema en `nefan-core/data/`, generador para Python + TS) si esto crece.

### 3.3 Convención de logging incoherente

Coexisten:
- `print(...)` (Godot, ws-server.ts cuando es informativo).
- `push_error(...)` (Godot, sólo en `session_recorder.gd:101` y pocos más).
- `console.warn/error/log` (TS).
- `errors.push(...)` (HTML, vía `ErrorLog`).

**Propuesta mínima**: una guía de 6 líneas en CLAUDE.md sobre cuándo usar cada uno. Idealmente, todos los `console.error` del bridge se convierten en `errors.push("bridge", ...)` también, una vez exista un canal de telemetría del bridge al HTML (puede ser un broadcast WS extra con `type: "log_event"`).

### 3.4 Tamaños y splits

- `bridge/ws-server.ts` (~810 líneas): mezcla bootstrap del bridge + handlers de N comandos + helpers de broadcast + helper de listGames. Empieza a pedir un split por dominio: `handlers/scene.ts`, `handlers/dialogue.ts`, `handlers/session.ts`. No urgente, pero el archivo está en el umbral donde leerlo cuesta.
- `ai_server/main.py` (~963 líneas): mismo patrón, todos los endpoints en un solo archivo. Router-split de FastAPI sería trivial. Endpoints de diagnóstico `skin_test_controlnet` (625-712) y `skin_test_frame` (715-799) **deberían vivir en un router `/diagnostic/*` separado** (ver §4.2).

### 3.5 Identificadores / formato

- `NarrativePlayerState.position` es `[x,y,z]` (`narrative-state.ts:42`). `GameState.player.pos` es `[x,y,z]` (`game-store.ts:21`). Mismo formato, distinto nombre. Unificar a `position`.
- `GameState.player_health` (GD, float) vs `NarrativeState.player.health` (TS, number) vs `combatant.health` (Godot, float). Mismo concepto, tres nombres consistentes pero tres dueños (ver §1.1).

---

## 4. Código muerto / legacy

**Importante**: sólo listado. Ninguna acción hasta confirmación.

### 4.1 Confirmado obvio (alta confianza)

| Archivo / símbolo | Evidencia |
|---|---|
| `godot/scripts/combat/combat_resolver.gd` (4 líneas) | Marcado "vacío, lógica en nefan-core" en CLAUDE.md. Sólo preload estático en `object_spawner.gd:15`. |
| `godot/scripts/combat/enemy_combat_ai.gd` (17 líneas) | Marcado "datos personalidad, lógica en nefan-core". Mismo perfil que el anterior. |
| `archive/ai-graphics-prototype/` (directorio entero) | Declarado descartado en CLAUDE.md ("StreamDiffusion descartado", "rendering frame-by-frame archivado"). Sin imports vivos. |
| `ai_server/test_narrative.py` | Test aislado contra la lógica vieja de generación de salas. Verificar si ejecutarlo todavía aporta señal. |
| `getRoomsByCategory()` en `nefan-core/src/dev/room-registry.ts:34` | Exportado en `nefan-core/src/index.ts:13` pero `grep` no encuentra call sites fuera de `dist/`. |
| `createDevState()` en `nefan-core/src/dev/dev-state.ts:18` | Idem: export en `index.ts:15`, sin call sites externos. |

### 4.2 Endpoints de diagnóstico nunca llamados por clientes

| Endpoint | Línea | Estado |
|---|---|---|
| `POST /skin_test_controlnet` | `ai_server/main.py:625-712` | Diagnóstico para curl manual durante tuning. El propio docstring lo declara. |
| `POST /skin_test_frame` | `ai_server/main.py:715-799` | Comentario explícito en línea 725: "Not used by any client". |

**Propuesta**: mover a `ai_server/routers/diagnostic.py` y exponer sólo si `CONFIG.dev.expose_diagnostic = true`. No borrarlos — son útiles para iterar parámetros.

### 4.3 Legacy en transición (decisión pendiente)

| Pieza | Estado | Decisión |
|---|---|---|
| `POST /populate_room`, `POST /generate_room` (`ai_server/main.py:229-250`) | Llamados desde `main.gd:668` + `ai-client.ts:91-103`. CLAUDE.md los marca legacy pero hay un call site vivo. | ¿Eliminar el call site de `main.gd` y retirar endpoints, o documentar el dual-stack? |
| `GameState` autoload (`game_state.gd:1-163`) | "Wrapper legacy" según CLAUDE.md, pero es un store paralelo completo con su propio `save_to_disk/load_from_disk`. | Cumplir lo prometido (convertir en wrapper) o renombrar para evitar engaño. |
| `_load_room_from_file(0)` en `main.gd:688` (fallback de `_on_generation_failed`) | Carga la primera sala JSON local cuando el LLM falla. | Incompatible con el modo fail-loud reciente del resto del stack. Eliminar y propagar el error al `ErrorLog` GD. |
| Sistema de F1/F2/F3 + `data/rooms/*.json` (crypt, tavern, corridor) | Sólo para tests visuales. | Mantener pero aislar visualmente: prefix `dev_only/`, mover bindings de F1/F2/F3 a `dev_menu.gd` exclusivamente. |

### 4.4 Posiblemente muerto (verificar antes de borrar)

- `main.gd:_on_generation_failed` (`684-689`): si se elimina la ruta `AIClient.generate_room`, este handler también se va.
- Comandos `remote_control.gd` (no auditado uno a uno aquí): cruzar con los tests Python en `godot/tools/` para confirmar cuáles tienen call sites.
- Funciones exportadas en `nefan-core/src/index.ts`: hacer un `tsc --listFiles` + grep de cada export contra los clientes (Godot vía bridge no cuenta, HTML sí).

---

## 5. Priorización sugerida

| Prioridad | Tarea | Esfuerzo | Impacto |
|---|---|---|---|
| **P0 — quick wins (1-2h cada uno)** | Eliminar fallback silencioso `_load_room_from_file(0)` en `main.gd:684-689` y propagar al `ErrorLog` GD | XS | Alto: coherencia con fail-loud |
| | Sustituir `catch {}` por `errors.push("bridge", ...)` en `bridge-client.ts:116-118` | XS | Medio |
| | `.catch()` con propagación al cliente en `ws-server.ts:427-429` (`load_game`) | XS | Medio |
| | Subir el truncado de 200 → 2000 chars en `ai-client.ts:80,95` | XXS | Bajo, pero ahorra horas debuggeando |
| | Distinguir `[]` (sin consecuencias) de `null`/throw (error) en `ai-client.ts:reportPlayerChoice` | XS | Medio |
| **P1 — a planificar (medio día cada uno)** | Decidir destino de `GameState` (wrapper real vs separar como `dev_only/`) | S | Alto: desambigua arquitectura |
| | Pydantic en endpoints FastAPI principales (`generate_*`, `notify_session`) | S | Alto |
| | Separar diagnostic endpoints a `routers/diagnostic.py` | XS | Bajo |
| | Helper Godot `_must_get_node(path)` + auditar nulls en `logic_bridge.gd` y `remote_control.gd` | S | Medio |
| | Convención de logging + aterrizarla en CLAUDE.md | XS | Medio |
| | Validación de `asset_index_snapshot` en `loadSession` contra `/assets/by_hash/{hash}` | S | Medio |
| | Test de inmutabilidad sobre `reducers.ts` (Object.freeze en dev) | XS | Bajo |
| **P2 — re-arquitectura (>1 día)** | Decidir y eliminar la ruta legacy `generate_room` end-to-end (Godot + ai_server + ai-client.ts) | M | Alto: cierra una bifurcación |
| | Split de `ws-server.ts` en handlers por dominio | M | Medio (legibilidad) |
| | Split de `ai_server/main.py` en routers por dominio | M | Medio (legibilidad) |
| | Proyección `NarrativeState.entities` → `GameStore.enemies` con tests | M | Alto: cierra el último gap de duplicación |

---

## 6. Apéndice — archivos críticos

**Estado**
- `nefan-core/src/store/game-store.ts` (todo el archivo, 100 líneas)
- `nefan-core/src/store/reducers.ts` (todo el archivo, 124 líneas)
- `nefan-core/src/narrative/narrative-state.ts` (84-109 load; 134-234 recordSceneLoaded + registerSceneNpcs; 343-347 updatePlayerPosition; 440-459 migrateV1)
- `godot/scripts/autoloads/game_state.gd` (todo el archivo, 163 líneas)
- `godot/scripts/autoloads/session_recorder.gd:15` (connect sin disconnect)
- `godot/scripts/autoloads/logic_bridge.gd:222-289` (apply_state_update con nulls)

**Errores**
- `nefan-html/src/net/bridge-client.ts:108-119` (onerror + onmessage catch silencioso)
- `nefan-html/src/ui/error-log.ts:1-107` (patrón de referencia)
- `nefan-core/src/narrative/ai-client.ts:74-127` (catches que tragan errores)
- `nefan-core/bridge/ws-server.ts:217-231` (parse con feedback correcto), `:427-429` (catch silencioso), `:544-591`, `:714-744` (catches con broadcast — modelo a seguir)
- `ai_server/main.py:229-250` (legacy sin validación), `:425-515` (skin/sprite con `body.get`), `:815-849` (modelo fail-loud), `:413,420` (analyze_weapon devuelve 200 con error en body)
- `godot/scripts/main.gd:684-689` (fallback silencioso)

**Modularidad**
- `nefan-core/bridge/ws-server.ts` (~810 líneas, candidato a split)
- `ai_server/main.py` (~963 líneas, candidato a split)
- `godot/scripts/main.gd:640-720` (mezcla ruta legacy + actual)

**Dead code**
- `godot/scripts/combat/combat_resolver.gd`
- `godot/scripts/combat/enemy_combat_ai.gd`
- `archive/ai-graphics-prototype/` (directorio)
- `ai_server/test_narrative.py`
- `ai_server/main.py:625-799` (skin_test_*, diagnostic)
- `ai_server/main.py:229-250` (generate_room/populate_room legacy)
- `nefan-core/src/dev/room-registry.ts:34` (getRoomsByCategory)
- `nefan-core/src/dev/dev-state.ts:18` (createDevState)

---

## 7. Arquitectura objetivo: estado extensible por plugins declarativos

**Contexto y motivación.** Ne-fan es open-world generativo: el motor narrativo crea entidades en runtime y, a medida que la partida deriva en una dirección no anticipada (el jugador se centra en comercio, magia, política…), hace falta materializar **sistemas completos** que el motor genérico no cubre. La opción ambiciosa (código TS real generado por el LLM en un sandbox V8/WASM) introduce infraestructura nueva y problemas de seguridad/persistencia. Esta sección describe el camino **declarativo puro**: cada plugin es un manifest JSON que un intérprete del motor en `nefan-core` ejecuta. El LLM (o un developer) describe *qué pasa cuando*, no *cómo*. El precio es expresividad acotada; el premio es sandbox automático, saves deterministas y migración por construcción.

Tres decisiones tomadas para esta propuesta:
- **Genesis dual**: un plugin puede venir de un developer (commit en `nefan-core/data/games/{gameId}/plugins/*.json`) o de la IA en runtime (vía tool MCP `plugin_register`). Mismo formato, mismo registry; sólo cambia la persistencia (los shipped se releen del FS; los runtime viven en `NarrativeState.plugins[]`).
- **Multi-consumer permitido**: dos o más plugins pueden consumir el mismo evento. Orden alfabético por `plugin_id` (determinístico, documentado). Si B necesita ver el resultado de A, B se suscribe a un evento que A emita, no al evento original.
- **Manifest determinista**: `plugin_id = sha256(canonical_json(manifest \ origin))`. Mismo manifest ⇒ mismo id, independientemente de quién o cuándo lo creó. La `version` semántica la asigna el autor; el hash protege contra divergencia accidental.

### 7.1 Anatomía del `PluginManifest`

JSON con los campos siguientes (zod schema vivirá en `nefan-core/src/plugins/types.ts`):

```
id              sha256 del manifest canónico (sin `origin`). Calculado, no escrito a mano.
version         entero. Sube cuando cambia el comportamiento; cada bump requiere `migrate`.
name            nombre humano ("Sistema de comercio").
description     una frase para el LLM (qué ofrece, cuándo activarlo).
origin          { author: "developer" | "narrative_engine",
                  session_id?: string,
                  triggered_by_event?: string,
                  rationale: string }  // metadatos; no participa del hash
slice           { schema: JSONSchema, initial: unknown }
                // shape del slice de estado del plugin, valor inicial vacío
reads           string[]  // paths que el plugin puede leer fuera de su slice
                          // ej. ["player.gold", "entities[].data.inventory"]
events_consumed Array<{ type, when?: Predicate, do: Effect[] }>
events_produced string[]  // tipos de evento que este plugin emite
projections     Array<{ source, rule }>
                // cómo derivar el slice inicial desde el estado pre-existente
                // ej. recorrer entities[] y marcar mercaderes
derived_views   Array<{ name, rule }>
                // proyecciones que `serializeForLlm()` añade al contexto
                // ej. "active_markets" lista mercados con stock > 0
migrate?        Record<fromVersion, Effect[]>
                // reglas para convertir slice viejo al shape de esta versión
fixtures        Array<{ before: SliceSnapshot, event, after: SliceSnapshot }>
                // 2-3 escenarios test que el validador ejecuta antes de activar
```

`origin` se persiste por trazabilidad pero **no entra en el hash**. Esto garantiza que el mismo `commerce v1` generado en sesiones distintas tenga el mismo `id`, y que un developer pueda "adoptar" un plugin emergido en runtime sin que cambie su identidad.

### 7.2 Mini-DSL (techo de expresividad)

Lo que **sí** ofrece:

- **Paths**: dot-notation contra un contexto `{event, slice, world, player, entities, plugins}`. Interpolación con `{}`: `slice.markets.{event.market_id}.stock.{event.item_id}`. Indexación `[i]`, comodín `[*]`.
- **Predicados**: `{op, path, value}` con `op ∈ {eq, neq, gt, gte, lt, lte, in, has, matches}`. Combinables con `{all: [...]}`, `{any: [...]}`, `{not: ...}`.
- **Efectos**: `set | inc | dec | mul | push | pull | remove | emit_event`. `emit_event` toma `{type, payload}`; el dispatcher lo encola con prioridad "side-effect".
- **Expresiones de valor**: literales, paths del contexto, aritmética binaria (`+ - * /`), `min/max/clamp`, `len`, `concat`, `coalesce`.
- **Iteración acotada**: `map/filter/reduce` sólo sobre arrays accesibles por path. Sin loops generales, sin recursión.
- **Aleatoriedad determinista**: `random(seed_path, low, high)` — el seed se deriva del estado, así dos replays del mismo log dan el mismo resultado.

Lo que **no** ofrece (escape hatch al core):

- Definir funciones, llamarse a sí mismo, mantener estado fuera del slice.
- Llamadas HTTP, lectura de FS, acceso a `crypto`/`Date.now()`/`Math.random()` directos.
- Modificar el slice de otro plugin (sólo lectura, vía `reads`).

Si una mecánica supera este techo (ej. pathfinding, simulación física, búsqueda heurística), pertenece al core en `nefan-core/src/simulation/` y el plugin se limita a leer su resultado.

### 7.3 Ciclo de vida de un plugin

**Génesis (developer)**: archivo `nefan-core/data/games/{gameId}/plugins/{name}.json`. Se carga en `start_session` y `resume_session`. El hash se calcula al cargar; si difiere del esperado, error de integridad.

**Génesis (motor narrativo)**: tool MCP `plugin_register(manifest)`. El bridge:
1. Valida con zod el shape del manifest.
2. Calcula el hash, lo asigna como `id`.
3. Ejecuta `fixtures` (replay determinista): cada fixture aplica el evento al `before` y comprueba que el resultado iguale `after`. Falla ⇒ rechaza el plugin con `narrative_status: error`.
4. Ejecuta `projections` sobre el estado actual para poblar el slice inicial.
5. Persiste en `NarrativeState.plugins[id] = {manifest, slice, activated_at}` y emite `plugin_activated`.

**Evolución**: la IA o el developer publican `commerce v2` (manifest distinto ⇒ hash distinto). El runtime detecta el `id` nuevo, ejecuta `migrate[1]` para convertir el slice v1 → v2, sustituye en el registry. El `id` antiguo queda en saves históricos pero no se carga si ya hay v2 vigente.

**Desactivación**: `plugin_unregister(pluginId)` borra el slice y deja constancia en `dialogue_history` (auditable). Los eventos emitidos posteriormente que apunten a ese plugin caen silenciosamente — registrados, no aplicados.

**Lectura**: cualquier código del core o de otro plugin puede leer vía `store.selectPlugin(pluginId, path)`. La escritura sólo ocurre por el dispatcher al aplicar reducers del propio plugin.

### 7.4 Dispatcher: cola serial con prioridades

Tres niveles de prioridad, FIFO dentro de cada nivel:
1. **Input runtime** (combat, movement): no esperan, se aplican y propagan al `GameStore`.
2. **Narrative consequences** (lo que devuelve `report_player_choice`): se aplican en orden de llegada.
3. **Plugin side-effects** (`emit_event` desde un reducer): se encolan al final del tick actual y se procesan después de los dos anteriores.

Para una acción/evento dado: primero la procesa el core (combat resolver, movement, etc.), luego se ofrece a **todos** los plugins cuyo `events_consumed` la incluye. Orden entre plugins: alfabético por `plugin_id` (hash → orden determinístico independiente de cuándo se registró cada uno). Si un plugin `emit_event`, el evento entra en la cola de nivel 3 y será procesado por **todos** los plugins suscritos a él (incluido el emisor, sin protección contra ciclos — el techo del DSL lo evita en la práctica, pero ver §7.9).

**Aislamiento**: cada reducer recibe un proxy con sólo `{event, slice, reads_resolved}`. Cualquier intento de path no declarado en `reads` falla en validación estática (al `plugin_register`, no en runtime).

### 7.5 Determinismo y conflictos

**Determinismo del manifest**:
- Hash = `sha256(canonical_json(manifest \ origin))`. Canonical = claves ordenadas, sin whitespace, números normalizados, arrays preservados en orden.
- Implicación: dos sesiones que reciban el mismo manifest (mismas reglas exactas) comparten id, slice schema, comportamiento. El `origin` (quién lo generó y por qué) se persiste sólo para auditoría.
- Esto habilita un registry global futuro (`nefan-core/data/plugin_registry/{id}.json`) donde los plugins emergidos por la IA se "promocionan" a shipped sin migración.

**Conflictos multi-consumer** (permitidos):
- Plugin A y B ambos consumen `gold_changed`. Ambos ejecutan sus efectos en el mismo tick. El orden entre A y B es alfabético por hash (determinístico).
- Si A escribe a su slice y B necesita verlo, B no debe consumir `gold_changed`: debe consumir un evento que A emita (`a_processed_gold`). Esto deja el grafo de dependencias explícito y trazable.
- Conflictos *intencionados* sobre el mismo path del estado externo (`reads`) están permitidos por construcción: cada plugin sólo escribe en su propio slice; sobre el resto sólo lee.

### 7.6 Persistencia y serialización

```
SessionData {
  ...
  plugins: Array<{
    id: string,             // sha256 del manifest sin origin
    version: number,
    slice: unknown,         // estado vivo, conforma con manifest.slice.schema
    origin: PluginOrigin    // trazabilidad: quién/cuándo/por qué
  }>
}
```

Los manifests de **plugins shipped** no se persisten en el save (se cargan del FS por `id` esperado). Los manifests de **plugins generados por IA** sí se persisten enteros junto al slice — esto es lo que permite cargar saves antiguos en clientes que nunca vieron ese manifest.

`serializeForLlm()` itera `plugins[]` activos y añade un bloque `plugins: {commerce: {summary: ..., active_markets: [...]}}` derivado de `derived_views`. Esto evita inyectar slices enteros (un mercado con 500 ítems es ruido) y deja al LLM elegir qué pedir en detalle vía tool MCP `plugin_inspect(pluginId, view)`.

`SCHEMA_VERSION` (`narrative-state.ts:5`) sube a 3. Migración v2 → v3: añadir `plugins: []` vacío.

### 7.7 Ejemplo: `commerce` v1 paso a paso

Manifest (simplificado):

```json
{
  "name": "Sistema de comercio",
  "description": "Mercados, precios dinámicos, préstamos. Activar cuando el jugador comercia repetidamente.",
  "version": 1,
  "origin": {
    "author": "narrative_engine",
    "session_id": "1736...-3a2f",
    "triggered_by_event": "evt_0042",
    "rationale": "El jugador ha hecho 5 trueques con el herrero; el motor genérico no modela inventarios de NPCs."
  },
  "slice": {
    "schema": { "type": "object", "properties": {
      "markets": { "type": "object" },
      "loans":   { "type": "array" }
    }},
    "initial": { "markets": {}, "loans": [] }
  },
  "reads": ["entities[*].data", "player.gold", "player.inventory"],
  "events_consumed": [
    {
      "type": "trade_offered",
      "when": { "all": [
        { "op": "has", "path": "event.market_id" },
        { "op": "gt",  "path": "slice.markets.{event.market_id}.stock.{event.item_id}", "value": 0 },
        { "op": "gte", "path": "player.gold", "value": "event.price" }
      ]},
      "do": [
        { "op": "dec", "path": "slice.markets.{event.market_id}.stock.{event.item_id}", "value": 1 },
        { "op": "dec", "path": "player.gold", "value": "event.price" },
        { "op": "push", "path": "player.inventory", "value": { "id": "event.item_id", "from": "event.market_id" } },
        { "op": "emit_event", "value": { "type": "trade_completed", "payload": { "market_id": "event.market_id", "item_id": "event.item_id", "price": "event.price" } } }
      ]
    }
  ],
  "events_produced": ["trade_completed", "loan_defaulted"],
  "projections": [
    {
      "source": "entities",
      "rule": {
        "filter": { "op": "eq", "path": "entity.data.role", "value": "merchant" },
        "for_each": {
          "set": "slice.markets.{entity.id}",
          "value": {
            "owner_id": "entity.id",
            "name": "entity.data.name",
            "stock": "entity.data.inventory",
            "prices": {}
          }
        }
      }
    }
  ],
  "derived_views": [
    {
      "name": "active_markets",
      "rule": { "map": "slice.markets[*]", "to": { "id": "_.owner_id", "name": "_.name", "items": "len(_.stock)" } }
    }
  ],
  "fixtures": [
    {
      "before": { "markets": { "blacksmith_01": { "stock": { "iron_sword": 2 } } } },
      "event":  { "type": "trade_offered", "market_id": "blacksmith_01", "item_id": "iron_sword", "price": 50 },
      "context": { "player": { "gold": 100, "inventory": [] } },
      "after":  { "markets": { "blacksmith_01": { "stock": { "iron_sword": 1 } } } }
    }
  ]
}
```

Materialización:
1. La IA registra el manifest vía MCP. El bridge valida shape + fixtures, calcula `id = sha256(...)`, ejecuta `projections` sobre `entities` actuales — el herrero ya conocido se convierte en `markets.blacksmith_01` con stock derivado de su `data.inventory`.
2. La siguiente vez que el jugador elige "comprar la espada", la consecuencia de la IA incluye `{kind: "plugin_event", pluginId: "commerce", type: "trade_offered", payload: {...}}`.
3. El dispatcher pasa el evento al plugin. Predicate `when` se evalúa OK. Efectos: stock -1, gold del jugador -50, inventario +espada, `trade_completed` emitido.
4. Otros plugins suscritos a `trade_completed` (ej. `reputation` v1) lo procesan en el tick siguiente.
5. `serializeForLlm()` añade `plugins.commerce.active_markets` al contexto; la IA puede pedir detalle con `plugin_inspect`.

### 7.8 Fases de implementación

Cada fase es ejecutable de forma independiente y deja el código en estado coherente.

| Fase | Alcance | Esfuerzo |
|---|---|---|
| **F1 — Tipos + registry vacío** | `nefan-core/src/plugins/types.ts` (zod schemas). `NarrativeState.plugins: Plugin[] = []`. `SCHEMA_VERSION = 3` + migración trivial. Sin runtime. | S |
| **F2 — Validador del DSL** | `dsl/evaluate.ts` con predicados, paths, efectos. Tests unitarios sobre fixtures hardcoded. Sin integración aún. | M |
| **F3 — Loader de plugins de developer** | Lectura de `data/games/{gameId}/plugins/*.json` en `start_session`. Validación de hash. Ejecución de `projections` iniciales. | S |
| **F4 — Dispatcher integrado** | Cola serial + prioridades en el bridge. Eventos del core ofrecidos a plugins. Efectos aplicados a slices. Tests end-to-end con un plugin "test_counter" trivial. | M |
| **F5 — Tool MCP `plugin_register`** | Validación, fixtures dry-run, persistencia en `NarrativeState`. Plugin emergido sobrevive `save/load`. | M |
| **F6 — `serializeForLlm` + `plugin_inspect`** | `derived_views` proyectados al contexto. Tool `plugin_inspect(id, view)` para detalle. | S |
| **F7 — Evolución + `migrate`** | Detección v→v+1, replay de fixtures de la nueva versión, ejecución de `migrate`. | M |
| **F8 — Plugin `commerce` real** | Manifest commerce v1 como prueba de concepto end-to-end. Documentar el patrón. | M |

F1+F2 son inversión sin retorno visible para el usuario; a partir de F3 ya hay valor de developer; F5 desbloquea la IA.

### 7.9 Riesgos asumidos / pendientes

- **Ciclos de eventos**: A consume `x` y emite `y`; B consume `y` y emite `x`. Defensa: contador de re-emisiones por tick (límite 16, configurable); al excederlo, el dispatcher aborta el tick con `narrative_status: error` y log del ciclo. Detectable estáticamente en `plugin_register` si los emisores se conocen.
- **Slices grandes en saves**: un plugin mal diseñado puede crecer sin cota (ej. `transactions[]` que acumula todo el histórico). Mitigación: cada manifest declara `slice_size_hint`; el bridge avisa cuando se rebasa 10×.
- **Compatibilidad cross-game**: dos juegos pueden tener `commerce v1` con manifests distintos (hash distinto). Bien — son plugins distintos por construcción. El registry global futuro (§7.5) puede ofrecer un "commerce canónico" que ambos juegos adopten si lo desean.
- **Determinismo de `random(seed_path, ...)`**: el seed debe derivarse de paths estables (no `Date.now()`). Validador rechaza manifests que usen seeds volátiles.
- **Schema evolution del slice**: si el `schema` cambia entre v1 y v2 sin `migrate`, el slice viejo no valida. Hay que enforce `version` bump ⇒ `migrate[v-1]` obligatorio.
- **Genesis del developer vs IA con mismo nombre**: dos plugins distintos con `name: "commerce"` pueden coexistir si sus `id` (hash) difieren. La UI tendrá que distinguirlos por `origin.author`.

### 7.10 Encaje con el resto de la auditoría

Esta arquitectura **presupone** que las brechas de §1 (tres stores paralelos, `GameState` legacy) están cerradas o en cierre. Sin una fuente canónica clara (`NarrativeState`), los plugins no tienen un `slice` estable contra el que proyectar. Por lo tanto:

- §1.2 (decisión sobre `GameState`) es **prerequisito** de F1.
- §1.3 (proyección `entities` ⇄ `enemies`) es **prerequisito** de F3 si algún plugin shipped lee entidades.
- §2 (fail-loud uniforme) es **prerequisito** de F5 — el motor narrativo necesita errores estructurados para entender por qué un manifest fue rechazado.

Es decir: la auditoría P0/P1 no es trabajo paralelo al plugin system — es el saneamiento necesario antes de poder construirlo encima.
