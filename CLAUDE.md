# Never Ending Fantasy — Guia de desarrollo

RPG dark fantasy de **mundo abierto generativo** con motor Godot 4.6+. El motor narrativo (Claude vía MCP) crea escenas open-world con `generate_scene` y va añadiendo entidades (NPCs, edificios, objetos) dinámicamente a medida que la historia avanza. Si en una conversación el jugador dice "quiero ir a la forja a comprar un arma", el motor narrativo genera una forja, instancia un herrero, etc. Assets IA (texturas PBR, modelos GLB), personajes Mixamo 3D, combate cuerpo a cuerpo real-time. Las "salas" cerradas (`data/rooms/*.json`, herramienta `generate_room`) son **legacy de tests** — no son la unidad de gameplay canónica.

## Arrancar el juego

```bash
# Launcher interactivo (recomendado):
./start.sh
```

Sin argumentos, presenta un menú con presets que respetan dependencias entre servicios y, cuando se necesita el motor narrativo, pausan para que abras Claude Code en otra terminal:

| Preset | Servicios | Cuándo |
|--------|-----------|--------|
| 1 · Play | bridge + narrative-mcp + ai_server + Godot + HTML + pausa Claude Code | Sesión narrativa completa |
| 2 · Automated tests | bridge + Godot headless (xvfb) | `python3 godot/tools/movement_test.py` y similares |
| 3 · HTML 2D iteration | bridge + HTML | Iterar UI/renderer 2D sin Godot |
| 4 · Godot offline | sólo Godot | Tests visuales rápidos con fallback rooms |
| 5 · Bridge only | sólo nefan-core bridge | Dev de la lógica compartida |
| 6 · ai_server only | sólo Python ai_server | Dev del pipeline de IA |
| 7 · Custom | toggle por servicio | Combinaciones puntuales |
| s · Status | — | Listar puertos arriba/abajo |
| k · Stop | — | Matar todo el stack |

Cosas a tener en cuenta:
- El launcher hace preflight (`.venv`, `node_modules`, binario de Godot, `nc`/`curl`) y aborta con instrucciones si falta algo.
- Cada servicio espera al puerto del anterior (`wait_for_port` real, no `sleep` ciego).
- Ctrl+C mata limpiamente todo lo que el launcher arrancó (`trap EXIT`).
- Si detecta saves antiguos en `~/.local/share/godot/.../Never Ending Fantasy/saves/`, ofrece migrarlos a `$PROJECT_DIR/saves/`.

```bash
# Manual (si prefieres arrancar servicios por separado):
cd ~/code/ne-fan
source .venv/bin/activate
python ai_server/main.py                    # AI server :8765 (opcional)
cd nefan-core && npx tsx bridge/ws-server.ts  # Bridge TS :9877 (opcional)
cd narrative-mcp && node dist/server.js     # MCP bridge :3737 (opcional)
~/Downloads/Godot_v4.6.1-stable_linux.x86_64 --path godot --rendering-method gl_compatibility
cd nefan-html && npm run dev                # HTML 2D :3000 (opcional)
```

El juego arranca sin ai_server ni bridge — texturas no se generan y el combate usa lógica local de Godot.

## Controles in-game

| Tecla | Accion |
|-------|--------|
| WASD | Movimiento |
| Shift | Sprint |
| Espacio | Salto |
| Raton | Camara (3a persona) |
| E | Interactuar con objeto/NPC |
| 1-5 | Seleccionar tipo ataque (quick/heavy/medium/defensive/precise) |
| LMB | Ejecutar ataque |
| F1/F2/F3 | Cargar escenarios de test legacy (crypt/tavern/corridor — solo para devtest) |
| H | Toggle History Browser (timeline navegable de la sesión narrativa) |
| F5 | Guardar partida |
| F9 | Cargar partida |
| Esc | Soltar/capturar raton |

## Remote Control (testing automatizado)

TCP en puerto **9876**. Enviar JSON por linea:

```bash
echo '{"cmd":"status"}' | nc -q 1 localhost 9876
echo '{"cmd":"screenshot","path":"/tmp/screen.png"}' | nc -q 1 localhost 9876
echo '{"cmd":"key","action":"move_forward","duration":1.0}' | nc -q 1 localhost 9876
echo '{"cmd":"attack","type":"quick"}' | nc -q 1 localhost 9876
echo '{"cmd":"mouse","dx":100,"dy":-30}' | nc -q 1 localhost 9876
echo '{"cmd":"teleport","x":2,"y":1,"z":-3}' | nc -q 1 localhost 9876
echo '{"cmd":"look_at","yaw":45,"pitch":-0.2}' | nc -q 1 localhost 9876
echo '{"cmd":"load_room","index":0}' | nc -q 1 localhost 9876
echo '{"cmd":"camera_detach","x":5,"y":1.2,"z":0,"yaw":90,"pitch":-0.1}' | nc -q 1 localhost 9876
echo '{"cmd":"camera_attach"}' | nc -q 1 localhost 9876
echo '{"cmd":"play_anim","name":"kick"}' | nc -q 1 localhost 9876
echo '{"cmd":"respawn"}' | nc -q 1 localhost 9876
echo '{"cmd":"save"}' | nc -q 1 localhost 9876
```

El comando `status` devuelve: player_pos, camera_yaw/pitch, fps, room, combat_hp, combat_state, combat_weapon, anim_state, anim_name, anim_interruptible, ray_hit.

## Testing visual automatizado

**IMPORTANTE:** Cada vez que se modifique algo visual (animaciones, movimiento, cámara, colisiones), ejecutar los tests automatizados y verificar los screenshots.

### Principios de testing visual

1. **Los tests deben simular el input real del jugador.** Usar `{"cmd":"attack","type":"quick"}` (pasa por `sync.attack()`) en vez de `{"cmd":"play_anim","name":"quick"}` (va directo al animator). El camino debe ser idéntico al del click del jugador.

2. **Los tests deben capturar screenshots durante la acción**, no solo antes y después. Una animación puede verse perfecta al inicio y al final pero separar modelo de cápsula a mitad de ejecución.

3. **La cámara debe estar fija durante los tests** (detached). Si la cámara sigue al player, no se puede ver si el modelo se separa de la cápsula. Usar `camera_detach` para posicionar la cámara en un punto fijo y `camera_attach` para restaurar.

4. **Verificar SIEMPRE los screenshots generados.** Los tests reportan PASS/FAIL para métricas numéricas (desplazamiento, estado de animación) pero la verificación visual de los screenshots es esencial para detectar problemas como pies deslizando, modelo separado de cápsula, orientación incorrecta.

5. **La escena de test debe tener referencia visual.** Usar `root_motion_debug` que tiene marcadores de distancia en el suelo (cruz a 2m y 4m). La cápsula verde semi-visible es esencial para comparar posición del body vs modelo.

### Scripts de test

```bash
# Tests de movimiento — ejecutar tras cualquier cambio visual
python3 godot/tools/movement_test.py

# Tests de animación individual — screenshots multi-ángulo
python3 godot/tools/anim_debug.py medium --angles side

# Test específico
python3 godot/tools/movement_test.py capsule_sync attack_root_motion
```

### Qué verifica cada test

| Test | Qué verifica | Screenshots |
|------|-------------|-------------|
| `idle_state` | Animación idle al arrancar | — |
| `walk_forward` | WASD mueve al player (~3.8m en 2s) | — |
| `run_sprint` | Sprint más rápido que walk (~7.6m en 2s) | — |
| `attack_animation` | Ataque se reproduce y vuelve a idle | during/after |
| `attack_root_motion` | Body se desplaza (o no) durante ataque | 8 frames |
| `capsule_sync` | Modelo y cápsula alineados durante walk | 10 frames |
| `walk_sequence` | Caminar adelante/izquierda/atrás | 7 frames |
| `sprint_sequence` | Sprint con screenshots periódicos | 12 frames |
| `attack_walk` | Ataque interrumpe caminar | 5 frames |
| `jump_sequence` | Salto mantiene momentum | 6 frames |

### Modo headless (sin ventana)

**IMPORTANTE:** Siempre arrancar Godot con `xvfb-run` para no bloquear la pantalla del usuario. Nunca usar `DISPLAY=:0`.

```bash
./start.sh             # → preset 2 "Automated tests" (bridge + Godot headless)
# O manualmente:
xvfb-run -a -s "-screen 0 1920x1080x24" ~/Downloads/Godot_v4.6.1-stable_linux.x86_64 --path godot --rendering-method gl_compatibility
# Luego ejecutar tests normalmente
python3 godot/tools/movement_test.py
```

### Mapeo de animaciones de ataque

Para medir atributos fisicos de animaciones (alcance, arco, velocidad) y actualizar la tabla de equivalencias, seguir la guia en [`godot/tools/ANIMATION_MAPPING.md`](godot/tools/ANIMATION_MAPPING.md). Resumen rapido:

1. Registrar animacion en ANIM_MAP, ONE_SHOT_SET, combat_config.json
2. `python3 godot/tools/attack_mapping.py mi_anim` — captura + medicion automatica
3. Verificar screenshots laterales frame a frame (el detector confunde wind-ups con golpes)
4. Actualizar `nefan-core/data/animation_intrinsics.json` con datos corregidos

### Lecciones aprendidas sobre animaciones Mixamo

- **Hips XZ drift:** Las animaciones Mixamo mueven el bone Hips en XZ (root motion). Si se deja sin tratar, el modelo se desplaza del body. Solución: lockear Hips XZ al primer keyframe en animaciones de locomotion (walk/run). Ataques/idle no se lockean si su drift es ~0.
- **Animaciones estáticas vs con pasos:** Usar animaciones SIN pasos hacia adelante para ataques (attack(4), slash, slash(5), slash(3)). Las que tienen pasos (attack, attack(2)) causan sliding de pies al lockear el Hips.
- **AnimationTree > AnimationPlayer directo:** Usar AnimationNodeStateMachine con `travel()` para transiciones suaves y `start()` para interrupciones. El AnimationTree auto-retorna a idle con `SWITCH_MODE_AT_END`.
- **Sin root motion, sin `top_level`, sin `set_bone_pose_position`.** Todo el movimiento via velocity del CharacterBody3D. Las animaciones son puramente visuales. Patrón del [Souls-Like Controller](https://github.com/catprisbrey/Third-Person-Controller--SoulsLIke-Godot4).
- **CollisionShape sigue al modelo durante ataques:** El CollisionShape3D se mueve en XZ para seguir la posición del Hips bone durante animaciones no interruptibles. Vuelve a rest cuando la animación termina.

## Arquitectura

```
nefan-core/               TypeScript — logica de juego compartida (Godot + HTML)
  src/
    combat/                Resolver, state machines, manager, enemy AI
    store/                 GameStore (dispatch/subscribe/snapshot)
    animation/             AnimationController, transitions, state config
    simulation/            GameSimulation tick loop
    protocol/              Mensajes frontend ↔ logica
    dev/                   Room registry, dev state
  bridge/
    ws-server.ts           WebSocket bridge para Godot (:9877)
  data/
    combat_config.json     Config compartida (symlink desde godot/data/)
    rooms/                 Escenarios JSON (incluye open_world_test.json y rooms legacy de tests)
  test/                    39 tests (combat, animation, simulation)

godot/                    Proyecto Godot 4.6+ (Forward+, 1920x1080)
  scripts/
    main.gd               Orquestador: carga escenas open-world, gestiona spawns dinámicos, motor narrativo
    autoloads/
      game_store.gd        Estado centralizado, dispatch/on/snapshot
      game_state.gd        Estado mundo/jugador (legacy, wrapper sobre NarrativeState)
      narrative_state.gd   Estado canónico de la sesión: world+player+entities+dialogue, save multi-slot
      service_settings.gd  Toggles de servicios opcionales (panel del title screen)
      ai_client.gd         HTTP a ai_server:8765
      remote_control.gd    TCP :9876 para testing automatizado
      logic_bridge.gd      WebSocket client a nefan-core bridge (:9877)
      session_recorder.gd  Snapshots periodicos para replay (F10)
      session_player.gd    Reproduce grabaciones (F11)
      texture_cache.gd     Texturas PBR, cachea en disco
    room/                  (legacy: builders para escenas y rooms, ambos pasan por aquí)
      room_builder.gd      JSON -> geometria (rooms cerradas legacy y scenes open-world)
      object_spawner.gd    JSON -> objetos + NPCs + debug capsules (consume texture_hash/model_hash)
      light_placer.gd      JSON -> luces
      exit_builder.gd      Area3D triggers
    combat/
      combat_animator.gd   AnimationTree + StateMachine, Hips XZ lock, skin
      combat_animation_sync.gd  Estado -> animacion (Souls-Like pattern)
      combatant.gd         HP, estado, senales (display-only, logica en nefan-core)
      combat_manager.gd    Registry de combatientes (logica en nefan-core)
      player_combat_input.gd  Seleccion tipo ataque (1-5)
      combat_hud.gd        Barra superior: HP + selector ataque
      combat_data.gd       Carga combat_config.json
      combat_resolver.gd   (vacio, logica en nefan-core)
      enemy_combat_ai.gd   Datos personalidad (logica en nefan-core)
    player/
      player_controller.gd WASD + sprint + jump + attack (Souls-Like pattern)
      camera_controller.gd Camara independiente, follow con lerp + SpringArm3D
      interaction_ray.gd   RayCast3D para examinar objetos
    ai_assets/
      texture_loader.gd    Aplica PBR (albedo + normal)
      model_loader.gd      Carga GLB
    npc/
      npc_animator.gd      Carga modelo Mixamo + animaciones ambient para NPCs
      npc_model_registry.gd  Diccionario character_type → path FBX
    ui/
      game_hud.gd          Info escena, prompts, panel texto, fade
      dev_menu.gd          Menu desarrollo (F12): lista escenarios + selector animaciones
      title_screen.gd      Selector de juego + saves multi-slot + panel servicios
      dialogue_ui.gd       Diálogo con opciones [1][2][3] + LineEdit para texto libre [T]
      history_browser.gd   Timeline navegable de la sesión narrativa (tecla H)
  data/
    combat_config.json     Tipos ataque, armas, animaciones, velocidades
  test_rooms/              Symlinks a nefan-core/data/rooms/
  tools/
    movement_test.py       Tests automatizados de movimiento + screenshots
    anim_debug.py          Captura multi-angulo de animaciones

nefan-html/               Cliente 2D top-down (Canvas)
  src/
    main.ts                Game loop, importa nefan-core directamente
    renderer/              Canvas 2D rendering
    input/                 Keyboard + mouse handler

ai_server/                Python FastAPI en puerto 8765
narrative-mcp/            Node.js MCP bridge

skinning_lab/             Bench reusable de skinning AI sobre sprites Mixamo
  run.py                   CLI principal — --preset, --preview-only, --list-presets
  serve.sh                 HTTP server local en :8911 para navegar runs
  presets/*.json           Configs reutilizables (anim, frames, variants, models)
  runs/                    (gitignored) cada run = subdir self-contained con index.html
  README.md                Workflow + cómo añadir un proveedor nuevo
```

## skinning_lab — pruebas de IA sobre sprites

Bench permanente para evaluar APIs de skinning (Meshy, fal.ai, video models, etc.) sobre los sprite sheets generados por el renderer Godot. Vive en el repo porque la tecnologia avanza rapido y hace falta repetir pruebas. Ver `skinning_lab/README.md` para detalles. Hallazgos consolidados:
- **V1 single** y **V2 anchor** dan deriva inaceptable.
- **V3 rolling** funciona con base limpia (Y Bot), caro pero viable.
- **V4 atlas (≤10 frames en 5×2)** es lo mejor: 1 llamada, consistencia perfecta dentro del atlas. **NO escala** a >10 frames — el modelo colapsa a la misma pose.
- **Locomotion (walk/run)** requiere Hips XZ lock o el personaje sale del cell. Implementado en `sprite_sheet_renderer.gd:_lock_hips_xz_if_locomotion()`.

## AI server — Endpoints

| Endpoint | Metodo | Que hace |
|----------|--------|----------|
| `/health` | GET | Estado: ready/loading, pipeline texturas |
| `/backend_status` | GET | Estado de meshy_3d, ai_vision (consumido por panel del title screen) |
| `/generate_scene` | POST | **Canónico** — LLM genera escena open-world (terreno, vegetación, edificios, objetos) |
| `/generate_room` | POST | Legacy — LLM genera sala cerrada (solo para tests F1/F2/F3) |
| `/generate_texture` | POST | Textura PBR seamless (albedo+normal), ~1s |
| `/generate_model` | POST | Modelo GLB desde prompt (Meshy o TripoSG) |
| `/generate_skin` | POST | Skin de personaje (PNG, ~10s) |
| `/analyze_weapon` | POST | Vision IA para orientar armas (vía MCP bridge) |
| `/notify_session` | POST | Godot informa de inicio/reanudación de sesión narrativa |
| `/report_player_choice` | POST | Godot reporta elección de diálogo → Claude devuelve consequences |
| `/assets` | GET | Listar assets indexados del manifest (con prompt original) |
| `/assets/by_hash/{hash}` | GET | Lookup individual con cache_url |
| `/cache/{type}/{hash}` | GET | Servir asset cacheado (albedo/normal/roughness/model/skin/sprite) |

## Modelos de IA y que hacen

| Modelo | Uso | Donde |
|--------|-----|-------|
| **Claude Sonnet 4.5** | Genera escenas open-world, reacciona a las elecciones del jugador esculpiendo el mundo (spawn dinámico de edificios/NPCs/objetos), orienta armas vía visión | llm_client.py via MCP bridge o API |
| **SD 1.5** + LCM-LoRA + TAESD | Texturas PBR seamless tiling (4 pasos, fp16) | texture_generator.py |
| **SD 1.5** | Imagenes referencia para modelos 3D | model_generator.py |
| **rembg** (u2net) | Quitar fondo de referencias de modelo | model_generator.py |

VRAM: ~3 GB pico (fp16). Todo secuencial con GPU lock (sin concurrencia CUDA).

## MCP bridge — Como funciona la narrativa

**Generación de escena inicial open-world**:
1. Godot pide la escena → `AIClient.generate_room(world_state)` POST a ai_server (`/generate_scene` es la herramienta canónica de Claude)
2. ai_server envía request vía WebSocket a narrative-mcp (:3737), añadiendo `available_assets` (lista del manifest) y `session` info
3. Claude Code (en otra terminal) llama `narrative_listen()` → recibe el world_state
4. Claude genera la escena JSON completa, opcionalmente referenciando assets cacheados por hash → llama `narrative_respond(scene_json)`
5. ai_server recibe respuesta → la valida → la devuelve a Godot
6. Godot construye la escena con `room_builder` + `object_spawner` (que respeta `texture_hash`/`model_hash` para reuso)

**Reactividad narrativa (diálogo → spawn dinámico)**:
1. El jugador elige opción `1/2/3` o pulsa `T` y escribe respuesta libre
2. `dialogue_ui` emite `dialogue_choice_made(idx, free_text)`; `main.gd` lo registra en `NarrativeState` y obtiene `event_id`
3. `AIClient.report_player_choice(event_id, ...)` → POST `/report_player_choice` en ai_server
4. ai_server envía `narrative_event` por MCP con el contexto compacto del NarrativeState
5. Claude responde con `consequences: [story_update | spawn_entity | schedule_event]`
6. `main.gd._on_narrative_consequences` aplica cada una: actualiza `story_so_far`, materializa entidades, registra todo en NarrativeState

El usuario tiene cuenta Claude Max — preferir MCP bridge sobre API key directa.

## Sistema de combate

**Formula:** `calidad = factor_distancia * factor_precision * factor_tactico * base_damage * weapon_mod`

- **factor_distancia:** 1.0 en distancia optima, lineal a 0 en borde de tolerancia
- **factor_precision:** 1.0 en centro del area, lineal a 0 en borde del radio
- **factor_tactico:** Matriz 5x7 (tipo ataque vs accion defensor, valores 0.7-1.3)

**Flujo:** Seleccionar tipo (1-5) → Click (LMB) → Wind-up (no cancelable) → Impacto → Resolucion

**Tipos:** quick (0.15s, 15 dmg), heavy (0.7s, 45 dmg), medium (0.4s, 25 dmg), defensive (0.3s, 18 dmg + 50% reduccion), precise (0.45s, 40 dmg, area minima)

**Armas:** unarmed, short_sword (rapida, +dmg quick), war_hammer (lenta, +dmg heavy). Modifican wind-up, distancia, area, dano.

**IA enemigos:** Personalidad JSON (aggression, preferred_attacks[], reaction_time). Enemigos estaticos en v1.

**Datos:** Todo en `godot/data/combat_config.json` — editable sin recompilar.

## Scene JSON schema (open-world, canónico)

`generate_scene` produce escenas open-world con terreno chunked, vegetación procedural, edificios construidos a partir de objetos, e iluminación. Ejemplo simplificado:

```json
{
  "room_id": "ashwood_clearing",
  "room_description": "Un claro brumoso rodeado de árboles negros...",
  "zone_type": "outdoor",
  "dimensions": { "width": 60, "height": 30, "depth": 60 },
  "terrain": {
    "type": "chunked",
    "texture_prompt": "moss-covered forest floor with twigs, seamless",
    "texture_hash": "a3f1...optional"
  },
  "sky": { "time_of_day": "dusk" },
  "fog": { "enabled": true, "density": 0.012, "color": [0.08, 0.07, 0.10] },
  "vegetation": {
    "grass": { "count": 1500, "radius": 25 },
    "trees": { "count": 12, "ring_inner_radius": 18, "ring_outer_radius": 28 }
  },
  "lighting": {
    "ambient": { "color": [0.15, 0.12, 0.10], "intensity": 0.35 },
    "lights": []
  },
  "objects": [
    {
      "id": "tavern_wall_n", "mesh": "box",
      "position": [0, 1.5, 4], "scale": [8, 3, 0.2],
      "texture_prompt": "weathered planks",
      "texture_hash": "b8c2... (optional, reuse cached)",
      "category": "building",
      "description": "muro norte de la taberna"
    }
  ],
  "ambient_event": "el viento agita las hojas..."
}
```

**Reuse de assets**: cualquier `texture_prompt`/`model_prompt` admite un hermano `texture_hash`/`model_hash`. Si Claude lo proporciona (copiándolo de `available_assets`), Godot carga del cache local sin regenerar.

**Spawn dinámico**: vía `scenario_spawn_npc`/`spawn_objects`/`spawn_enemy` (logic_bridge) o vía consequences `spawn_entity` que devuelve `react_to_player`. Las entidades se materializan en el mundo en runtime sin recargar la escena.

**Legacy room schema**: `data/rooms/*.json` antiguos (crypt, tavern, corridor) usan un schema más simple con `surfaces.floor/ceiling/walls`, `exits` y dimensiones pequeñas. Se cargan con F1/F2/F3 sólo para tests visuales — no son la unidad de gameplay.

Meshes: box, sphere, capsule, cylinder, cone, plane, torus. Categorias: item (amarillo), prop (gris), building (marron), creature (rojo), terrain (verde).

## Convenciones de codigo

- GDScript 4.6+ con tipado estricto (Variant inference = error)
- Variables que acceden propiedades de Node generico: usar tipo explicito (`var x: float = node.health`, NO `:=`)
- class_name en scripts de combat, pero usar preload() en vez de class_name para referencias cruzadas
- Autoloads: GameStore, GameState, AIClient, TextureCache, RemoteControl, LogicBridge, SessionRecorder, SessionPlayer
- Scripts nuevos que referencian otros: `const FooRef = preload("res://scripts/path/foo.gd")`
- Descripciones de objetos y NPC en espanol
- Unidades en metros

## Decisiones de diseno importantes

- **Modo de juego canónico: open-world generativo.** El motor narrativo crea una escena base con `generate_scene` y va añadiendo entidades en runtime sin recargar (NPCs, edificios, objetos) según las elecciones del jugador. Las "salas" cerradas son legacy de tests, no la unidad de gameplay.
- **NarrativeState como save canónico** — todo el playthrough vive en `user://saves/{session_id}/state.json` (multi-slot). `GameState` legacy queda como wrapper. Schema versionado.
- **Asset library indexada** — `cache/manifest.json` traquea todo lo generado con su prompt. Claude lo recibe en cada request narrativa y puede reusar por hash.
- **StreamDiffusion descartado** — abandonado, incompatible con CUDA 12.4. Usar diffusers nativo + TAESD + LCM-LoRA.
- **Rendering IA frame-by-frame archivado** — 1.3 FPS en RTX 3060, flickering. Enfoque actual: escenas estáticas con texturas IA y entidades dinámicas.
- **MCP bridge sobre API directa** — usuario tiene Claude Max, no necesita API key.
- **En desarrollo, subir iluminacion ambient** para ver bien objetos y geometria.
- **No borrar archivos de test** sin confirmacion explicita del usuario.
- **Logica en nefan-core, Godot solo visual** — prepararse para cambio de motor. Datos compartidos (escenas, config) en nefan-core, no en godot/.
- **AnimationTree con StateMachine (Souls-Like pattern)** — no usar AnimationPlayer directo. `travel()` para transiciones, `start()` para interrupciones.
- **Sin root motion** — todo el movimiento via velocity del CharacterBody3D. Animaciones puramente visuales. Lockear Hips XZ solo en walk/run.
- **Camara independiente** — no es hija del player. Sigue al body con lerp + SpringArm3D. Player excluido del SpringArm collision.
- **No usar animaciones con pasos para ataques** — causan sliding de pies al lockear Hips. Usar animaciones estáticas (attack(4), slash, slash(5), slash(3)).
- **Tests automatizados tras cada cambio visual** — `python3 godot/tools/movement_test.py`. Verificar screenshots.

## Hardware

RTX 3060 12GB, Linux (Ubuntu, kernel 6.8), Ryzen 7 5800X. Godot 4.6.1 con `gl_compatibility`.
