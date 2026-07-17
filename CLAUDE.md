# Never Ending Fantasy — Guia de desarrollo

RPG de **mundo abierto generativo** con motor Godot 4.6+ y cliente 2D HTML. El motor narrativo (Claude vía MCP) crea escenas open-world con `generate_scene` y va añadiendo entidades (NPCs, edificios, objetos) dinámicamente a medida que la historia avanza. Si en una conversación el jugador dice "quiero ir a la forja a comprar un arma", el motor narrativo genera una forja, instancia un herrero, etc. Assets IA (texturas PBR, modelos GLB), personajes Mixamo 3D, combate cuerpo a cuerpo real-time. La escena viaja en UN formato compartido: el motor produce Format D, el bridge lo normaliza a world scene (`formatDToWorld`) y ambos clientes (2D y 3D) pintan esa misma forma. Los JSON de `data/rooms/` son fixtures de test en formato world scene (menú F12).

**Juegos = mundos.** Un juego es `nefan-core/data/games/{id}/`: `game.json` (título, descripción, `style_id` por defecto, `world_brief` ~1.2k chars) + `world.md` (documento completo del mundo en 10 secciones: identidad, geografía, historia, pueblos, facciones, magia, vida cotidiana, semillas de conflicto, el jugador, registro) + `plugins/`. NO hay historia predefinida ni beats scripted: la historia la improvisa el motor narrativo dentro del mundo. Juegos base: `alta_fantasia` (Miravanda), `cuentos_oscuros` (Valdesombra), `toledo_1200` (histórico). Un **estilo** es `data/styles/{id}/`: `style.json` (`style_token`, cover, refs) + imágenes de referencia por ZONA de mundo abierto (settlement/farmland/forest/wetland/desert/snow/fortress/interior/underground + 3 de personaje; cada una es una escena completa con transiciones, ver `data/styles/README.md`) que ai_server pasa a Meshy según la zona que pinte (`style_tag` de la escena afinado por el bioma del tile, `styleCategoryForTile`). El estilo se elige en el título y queda CONGELADO en el save. El jugador puede crear su mundo (borrador → kind MCP `develop_world` → `data/games/user_*`) y subir su estilo (imágenes → `/styles/upload` → confirmación de coste → `/styles/{id}/complete` genera las categorías que falten; CLI equivalente: `python ai_server/tools/build_style_pack.py`). Schemas en `nefan-core/src/games/loader.ts` (fuente de verdad).

## Arrancar el juego

```bash
# Launcher interactivo (recomendado):
./start.sh
```

Sin argumentos, presenta un menú con presets que respetan dependencias entre servicios y, cuando se necesita el motor narrativo, pausan para que abras Claude Code en otra terminal:

| Preset | Servicios | Cuándo |
|--------|-----------|--------|
| 1 · Play | bridge + narrative-mcp + ai_server + Godot + HTML + pausa Claude Code | Sesión narrativa completa |
| 2 · Story 2D | bridge + narrative-mcp + ai_server + HTML + pausa Claude Code (sin Godot) | Testear historia/NPCs/mapas/diálogo con gráficos mínimos (cliente 2D) |
| 3 · Automated tests | bridge + Godot headless (xvfb) | `python3 godot/tools/movement_test.py` y similares |
| 4 · HTML 2D iteration | bridge + HTML | Iterar UI/renderer 2D sin Godot ni IA |
| 5 · Godot offline | sólo Godot | Tests visuales rápidos con fallback rooms |
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

El juego arranca sin ai_server ni bridge — texturas no se generan y el combate queda deshabilitado (los ataques animan pero no aplican daño; la lógica vive en nefan-core). Sin bridge es un modo visual/dev: movimiento, animaciones y las fixtures del menú F12 (el arranque offline carga `robledo_village`). Para combate y narrativa usar los presets 1–3.

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
    plugins/               Plugins declarativos: tipos zod, hash, DSL, loader, dispatcher
    dev/                   Initial scene cache (bootstrap replay)
  bridge/
    ws-server.ts           WebSocket bridge para Godot (:9877)
  data/
    combat_config.json     Config compartida (symlink desde godot/data/)
    rooms/                 Fixtures de test en formato world scene (dev/, stress/, robledo_village.json del dump)
    scenes/                Escenas Format D de ejemplo/fixture (robledo_village, zorder_test) — fuente del dump
    games/{id}/            Juego = mundo: game.json + world.md + plugins/ (user_* = subidos)
    plugins/               Plugins shipped comunes a TODOS los juegos (economy); un plugins/ local con mismo name lo pisa
    styles/{id}/           Estilo: style.json + imágenes de referencia por categoría
  test/                    ~245 tests (combat, animation, simulation, narrativa, plugins)

godot/                    Proyecto Godot 4.6+ (Forward+, 1920x1080)
  scripts/
    main.gd               Orquestador: carga escenas open-world, gestiona spawns dinámicos, motor narrativo
    autoloads/
      game_store.gd        Estado centralizado, dispatch/on/snapshot
      narrative_state.gd   Estado canónico de la sesión: world+player+entities+dialogue, save multi-slot
      service_settings.gd  Toggles de servicios opcionales (panel del title screen)
      ai_client.gd         HTTP a ai_server:8765
      remote_control.gd    TCP :9876 para testing automatizado
      logic_bridge.gd      WebSocket client a nefan-core bridge (:9877)
      session_recorder.gd  Snapshots periodicos para replay (F10)
      session_player.gd    Reproduce grabaciones (F11)
      texture_cache.gd     Texturas PBR, cachea en disco
    room/
      scene_builder.gd     World scene normalizada -> geometria (suelo en world_rect, __player_start, fail-loud ante Format D crudo)
      object_spawner.gd    JSON -> objetos + NPCs + debug capsules (consume texture_hash/model_hash, shape|mesh, color)
      light_placer.gd      lighting{} de fixtures -> luces; default sol direccional
    combat/
      combat_animator.gd   AnimationTree + StateMachine, Hips XZ lock, skin
      combat_animation_sync.gd  Estado -> animacion (Souls-Like pattern)
      combatant.gd         HP, estado, senales (display-only, logica en nefan-core)
      combat_manager.gd    Registry de combatientes (logica en nefan-core)
      player_combat_input.gd  Seleccion tipo ataque (1-5)
      combat_hud.gd        Barra superior: HP + selector ataque
      combat_data.gd       Carga combat_config.json
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
| `/generate_texture` | POST | Textura PBR seamless (albedo+normal), ~1s |
| `/generate_model` | POST | Modelo GLB desde prompt (Meshy o TripoSG) |
| `/generate_skin` | POST | Skin de personaje (PNG, ~10s) |
| `/analyze_weapon` | POST | Vision IA para orientar armas (vía MCP bridge) |
| `/develop_world` | POST | Desarrolla el borrador de mundo de un jugador (kind MCP develop_world) |
| `/styles/upload` | POST | Sube un estilo de usuario (JSON base64) y reporta categorías faltantes + coste |
| `/styles/{id}/complete` | POST | Genera las categorías que faltan (requiere confirm=true — gasta créditos) |
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
| **LaMa** (big-lama, TorchScript) | Placa de fondo: elimina los objetos altos de la imagen de escena y continúa el suelo (fade de occluders revela lo de debajo), <1s/tile | plate_inpainter.py |
| **rembg** (u2net) | Quitar fondo de referencias de modelo | model_generator.py |

VRAM: ~3 GB pico (fp16). Todo secuencial con GPU lock (sin concurrencia CUDA).

## MCP bridge — Como funciona la narrativa

**Sesión canónica única (Godot y HTML, mismo protocolo)**: la sesión vive en el bridge (`NarrativeState` TS + plugins). Godot habla con él por `logic_bridge` con `start_session`/`resume_session`/`save_session`/`dialogue_choice`/`interact_entity`; el mirror GD (`narrative_state.gd`) se hidrata del `SessionData` con `bridge_authoritative = true` (su `save()` queda bloqueado — **un solo escritor** de `saves/{id}/state.json`, el bridge, que además snapshotea pos/HP del sim al guardar y resiembra el sim al reanudar). Sin bridge, Godot degrada a sesión local offline (sin plugins ni motor narrativo).

**Generación de escena inicial open-world**:
1. Godot envía `start_session` al bridge (`logic_bridge`); el bridge crea la sesión, activa plugins shipped y hace POST `/generate_scene` a ai_server (`AiClient.generateScene` en nefan-core)
2. ai_server envía request vía WebSocket a narrative-mcp (:3737), añadiendo `available_assets` (lista del manifest) y `session` info
3. Claude Code (en otra terminal) llama `narrative_listen()` → recibe el world_state
4. Claude genera la escena JSON completa, opcionalmente referenciando assets cacheados por hash → llama `narrative_respond(scene_json)`
5. ai_server la devuelve al bridge, que la registra en su NarrativeState (Format D crudo), la **normaliza con `formatDToWorld`** y la difunde como `narrative_event` (effect `spawn_entity` con `data.scene` = world scene; el resume normaliza igual vía `sessionDataForClient`)
6. Godot (señal `narrative_scene`) construye la escena con `scene_builder` + `object_spawner` (que respeta `texture_hash`/`model_hash` para reuso); el player spawnea en `__player_start`

**Identidad de mundo en el contexto**: `world.description` (el brief) viaja en CADA turno vía `serializeForLlm`; el `world.md` completo solo en el bootstrap (`world_document`) y bajo demanda con la tool MCP `world_doc_get` (→ `GET /world_doc` del State API). Las restricciones de motor (cámara top-down fija, SOLO personajes humanoides, sin beats, `style_tag` por escena) viven en `WORLD_RULES` (narrative-mcp/server.ts) con espejo en `narrative_schemas.py`.

**Reactividad narrativa (diálogo → spawn dinámico)**:
1. El jugador pulsa `E` sobre un NPC (→ `interact_entity`), elige opción `1/2/3` o pulsa `T` y escribe respuesta libre (→ `dialogue_choice`)
2. El bridge registra el evento en su NarrativeState y llama `reportPlayerChoice` → POST `/report_player_choice` en ai_server
3. ai_server envía `narrative_event` por MCP con el contexto compacto del NarrativeState
4. Claude responde con `consequences: [story_update | spawn_entity | schedule_event | plugin_event]`
5. El bridge aplica las consequences (dispatchConsequences + tick de plugins), guarda, y difunde `narrative_event` con los effects
6. Godot los materializa vía señales (`narrative_dialogue`/`narrative_spawn`/`narrative_story_delta`…); el espejo GD solo refleja en memoria

El usuario tiene cuenta Claude Max — preferir MCP bridge sobre API key directa.

## Proyección oblicua 2D y plan de tile (map_ground + volumes)

El cliente 2D renderiza el mundo por tiles en UNA única proyección
**oblicua**: el suelo queda sin proyectar (vista == mundo, rejilla cuadrada) y
la altura se dibuja con cizalla — `pt(u,v,h) = [u + h·KX, v − h·KY]` con
`OBLIQUE_KX = −0.35`, `OBLIQUE_KY = 1` (`blueprint/projection.ts`). Los
volúmenes muestran su **cara sur iluminada y su cara este en sombra** (look
"3/4"/oblicua militar); con KX=0 sería la cenital pura, y ambos tratamientos
pueden mezclarse porque colisión y baselines salen de la huella declarada,
nunca de los píxeles. (Sustituye a las dos perspectivas topdown/isometric de
antes: ya no hay selector, ni `world.perspective` en el save, ni refs `_iso`
en los style packs; los saves viejos con el campo lo conservan en el JSON pero
nadie lo lee.)

**El motor narrativo NO dibuja la proyección.** Cada tile declara un plan
semántico y el **compositor determinista** (`nefan-core/src/scene/blueprint/`)
lo proyecta:

- `map_ground`: SVG plano del suelo (viewBox "0 0 128 128", capas
  `g#ground`+`g#water`, `g#deck` opcional) — celdas de mundo SIN proyectar,
  libertad artística total; se incrusta identidad (sin transform).
- `volumes`: todo lo que tiene altura, tipado — `building` (con `roof`,
  `walls`, `doors`, `cutaway:true` para edificios enterables), `wall`,
  `tower`, `gate` (vano transitable), `tree`, `bush`, `rock`, `fountain`,
  `prop`. Huella en celdas + altura; `label` en español guía al clasificador.
  Sin volumes explícitos, el compositor los deriva del esquema
  (`vegetation_zones` → árboles, `structures` → cutaway).
- `composeBlueprint(plan, tileKey)` → SVG proyectado (orden del pintor
  `v + u/512` — el desempate en u ordena los solapes de la cizalla —,
  voladizo norte + oeste, viewBox `-12 -32 140 160`) + `elements` (bbox
  proyectado + baseline + huella por volumen). **Determinista byte a byte**
  (SeededRng; `COMPOSER_VERSION` — v8 — en la clave de caché de imagen): el
  resume hace cache-hit. OJO: cambiar cualquier byte de salida invalida la
  caché de imágenes Meshy de TODOS los saves (regeneración al revisitar).

**Consecuencias en el pipeline** (cliente 2D):
- Colisión = agua del `map_ground` (raster sin proyectar) ∪ huellas
  analíticas (`volumeCollisionGrid`) — espacio de MUNDO; NUNCA de píxeles
  proyectados.
- La imagen de Meshy se **enmascara con el alpha del blueprint** antes de
  instalarse (los voladizos norte/oeste recortan lo del vecino); los tiles se
  pintan por profundidad (`ty·4096 + tx`), así los voladizos pisan a vecinos
  ya pintados.
- El renderer trabaja en **espacio de vista** (`renderer/projection.ts`,
  `VIEW_PROJECTION` único): vista == mundo en el suelo; los prismas
  vectoriales (`view-prism.ts`) desplazan la tapa `(+h·shearX, −h)` — espejo
  exacto del compositor. Simulación e input no cambian.
- `expected_elements` del análisis salen del compositor; los segmentos
  casados toman baseline/colisión de su huella declarada; los no casados
  (añadidos del modelo de imagen) aportan una franja en su línea de suelo.
- El retoque de visión (`blueprint_review`) corrige `{map_ground, volumes}`
  (documentos COMPLETOS) y se persiste con `map_plan_update`.

Godot (cliente 3D) no participa: la proyección solo afecta al mundo 2D.

## Plugins declarativos (next.md §7 — F1–F8 completas)

Sistemas de juego completos (comercio, reputación…) como **manifests JSON puros** que un intérprete en `nefan-core/src/plugins/` ejecuta — sin código generado. Spec completa y amendments en `next.md` §7.

- **Manifest** (`PluginManifestSchema`, zod estricto): `slice` (estado propio + schema), `reads`/`writes` (paths externos legibles/escribibles), `events_consumed` (`when` predicado → `do` efectos), `events_produced`, `projections` (slice inicial desde el estado), `derived_views`, `fixtures` (replay determinista que valida el manifest antes de activarlo). `plugin_id = sha256(canonical_json(manifest sin origin/id))`.
- **DSL** (`src/plugins/dsl/`): paths dot-notation con `{interpolación}`, `[i]`, `[*]`; predicados eq/neq/gt/…/all/any/not; efectos set/inc/dec/mul/push/pull/remove/emit_event (secuenciales); expresiones string con aritmética y min/max/clamp/len/concat/coalesce; `random(seed_path, lo, hi)` determinista (sha256+SeededRng). Regla path-vs-literal: raíz ∈ {event, slice, world, player, entities, plugins, _, entity, acc} ⇒ path; si no, literal (`'…'` o `{$lit}` fuerzan literal).
- **Shipped plugins**: comunes a todos los juegos en `nefan-core/data/plugins/*.json` (p. ej. `economy`); específicos de un juego en `nefan-core/data/games/{gameId}/plugins/*.json` (p. ej. `commerce`). Un manifest local con el mismo `name` que uno común lo reemplaza para ese juego. Se validan y activan en `start_session` (projections → slice inicial); en resume se casan por id contra el save — manifest borrado ⇒ resume abortado fail-loud; hash distinto ⇒ migración F7 si sube de versión con cadena `migrate`, si no abortado.
- **Runtime**: el LLM emite `{type: "plugin_event", plugin_id, event_type, payload}`; el dispatcher (`src/plugins/dispatcher.ts`) es transaccional (working copies, commit sólo si todo el tick es válido), multi-consumer en orden alfabético de id, `emit_event` derivados con límite 16/tick, whitelist dura de escrituras externas (`player.gold|health|level|inventory`, `entities[i].data.*`). El hot loop de input (combate/movimiento) NO pasa por plugins.
- **Génesis por IA (F5)**: tools MCP `plugin_register` (manifest JSON → `POST /plugins/register` del state API → `registerRuntimePlugin`: zod + hash + validación estática + replay de fixtures, **al menos una obligatoria** en runtime) y `plugin_list` (`GET /plugins`). El manifest queda embebido en el save (`PluginRecord.manifest`) y el resume lo rebindea sin archivo en disco.
- **Visibilidad para el motor narrativo (F6)**: `serializeForLlm()` añade un bloque `plugins: [{id, name, version, views}]` con las `derived_views` de cada plugin activo evaluadas (resumen, no el slice entero); una vista que lance se marca `{_error}` sin tumbar el turno. La tool MCP `plugin_inspect(plugin_id, view?)` (→ `GET /plugins/{id}/inspect?view=`) da el detalle: con `view` la derived_view concreta, sin `view` el slice completo + `available_views`. Lógica pura en `src/plugins/views.ts` (`buildPluginLlmViews`/`inspectPlugin`); resuelve el manifest del `activePlugins` del bridge (shipped) o del embebido en el `PluginRecord` (IA).
- **Evolución / migración (F7)**: en resume, si el manifest del FS sube de `version` (mismo `name`, hash distinto), `bindPluginsForResume` ejecuta la cadena `migrate[v]` (`runMigrationStep`, **slice-only**: escribir fuera de slice o emitir eventos lanza) para convertir el slice del save al shape nuevo, en vez de abortar. Las fixtures de la versión nueva ya las valida `loadGamePluginManifests` al cargar. Fail-loud ante hueco en la cadena, degradación (FS < save) o cambio sin bump de versión. El record migrado adopta id/version/slice nuevos preservando `name`/`origin`; el siguiente resume casa por id (idempotente). La guarda slice-only se duplica en `validateManifestStatic`. Evolución en runtime (vía `plugin_register` con versión mayor) aún pendiente.
- **Commerce shipped (F8)**: plugin de ejemplo real en `nefan-core/data/games/toledo_1200/plugins/commerce.json`. El bridge lo carga/activa en `start_session`. El motor narrativo lo conduce con `plugin_event`: `market_open {market_id, name, stock}` registra un mercado en runtime (los mercaderes spawnean tras la génesis; las `projections` sólo siembran los presentes al iniciar); `trade_offered {market_id, item_id, price}` descuenta stock+oro, añade al inventario y emite `trade_completed` (no-op si falta stock u oro). Es el patrón a replicar para otros sistemas (reputación, crafting…). End-to-end en `test/plugin-commerce.test.ts`.
- **Mirror GD** (`godot/scripts/autoloads/narrative_state.gd`): lee schema 1..3 y escribe v3 preservando en `_extra_fields` los campos que no modela (`world_map`, `plugins`) — un save del bridge sobrevive intacto a F5/F9 desde Godot. Los plugins viven en la sesión del bridge (`start_session`/`resume_session`).
- **Pendiente** (único, opcional): evolución en runtime vía `plugin_register` (versión mayor que reemplace al plugin vigente con su `migrate`); hoy la migración sólo opera en resume.

## Sistemas intercambiables (systems registry)

Distintos de los plugins declarativos: **módulos TS de hot loop** con varias implementaciones tras una interfaz, registrados en un `createSystemRegistry` (`nefan-core/src/systems/registry.ts`). Regla común: id ausente → default (la implementación actual); id desconocido → error con la lista de disponibles (fail-loud).

- **Combate** (`nefan-core/src/combat/registry.ts`): interfaz `CombatSystem` (catálogo `attacks`, `normalizeAttack`, `windUpTime`, `addPendingImpact`, `resolve`) inyectada en `GameSimulation`; la orquestación y la state machine de `combatant.ts` son compartidas, así el protocolo del bridge no cambia entre implementaciones. Implementaciones: `standard` (envuelve CombatManager/resolver, fórmula completa) y `basic` (un solo ataque "strike", daño fijo 15 a ≤2 m, sin armas ni matriz). Selección: `game.json` → `systems: {combat: "basic"}` (schema en `games/loader.ts`), validada y CONGELADA en el save (`world.combat_system`) en `start_session`; el resume la restaura (save sin campo = estándar; id retirado = resume abortado). `load_room` sin sesión vuelve al estándar (los fixtures asumen ese catálogo). Juego dev de prueba: `data/games/dev_combate_basico`.
- **Cliente 2D**: el HUD de ataques se genera desde el catálogo del sistema de la sesión (`applySessionCombatSystem` en main.ts) — con `basic` hay un solo botón "1:Golpe" y las teclas 1..N se remapean.
- **Input del cliente 2D** (`nefan-html/src/input/registry.ts`): interfaz `InputProvider` (estado continuo + one-shots consumibles + `setAttackBindings`/`selectAttack`). Implementaciones: `keyboard` (default) y `scripted` (driver programático para bench E2E, expuesto como `window.__nefan.inputDriver`). Selección por query param `?input=` (capacidad del cliente, no del mundo). Las teclas dev (G/X/B/N/R-review) viven en `DevToolsInput`, fijo y fuera del provider.
- **Candidatos futuros** (mismo patrón): PlayerController (prerequisito para touch/gamepad), EnemyAI (`systems.enemy_ai`), Renderer 2D, transporte narrativo. CollisionSystem y el pipeline de imagen ya son inyectables vía `*Deps`; formalizar registro sólo si aparece una 2ª implementación.

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

## Formatos de escena (canónicos, compartidos por 2D y 3D)

Hay exactamente DOS formatos, y la conversión entre ellos vive en nefan-core:

**1. Format D** — lo que produce el motor narrativo (`generate_scene`): rejilla 2D (`size{cols,rows,meters_per_cell}` + `terrain[]` strings + `terrain_legend`) con `entities[]` (`kind`, `cell:[col,row]`, `footprint:[w,h]`, `glyph`, `shape?`, `texture_hash?`), y en tiles v3 `tile{tx,ty}` + `biome` + `map_ground`/`volumes`. Contrato en `nefan-core/data/contract/tools/generate_scene.json`; validador en `src/scene/scene-validate.ts`. Es lo que se PERSISTE (saves, `scenes_loaded`, `serializeForLlm`).

**2. World scene** — el contrato de render que consumen AMBOS clientes: la salida de `formatDToWorld` (`nefan-core/src/scene/scene-normalize.ts`). El bridge normaliza en el wire (`broadcastScene` y el resume vía `sessionDataForClient`); el cliente HTML también la genera en local para fixtures. Forma:

```json
{
  "scene_id": "robledo_village",
  "scene_description": "El pueblo de Robledo...",
  "dimensions": { "width": 120, "depth": 80, "height": 3 },
  "world_rect": { "minX": -60, "minZ": -40, "maxX": 60, "maxZ": 40 },
  "terrain": { "color": [0.18, 0.22, 0.14] },
  "terrain_grid": { "grid": ["..."], "legend": {}, "solid_chars": ["W", "w"] },
  "objects": [
    { "id": "tavern", "shape": "box", "position": [-2, 0, -2], "scale": [8, 1, 4],
      "category": "building", "texture_hash": "b8c2...opcional", "description": "Taberna" }
  ],
  "npcs": [ { "id": "barkeep", "name": "Tabernero", "position": [0, 0, -2] } ],
  "__player_start": { "x": -57, "z": -1 },
  "ambient_event": "..."
}
```

Posiciones y escalas en METROS (anclaje por BASE: `position.y` es la base del objeto). En Godot la construye `scene_builder.gd` (suelo centrado en `world_rect`, default de sol direccional); en HTML el renderer 2D. Godot NUNCA porta la conversión celdas→metros — si le llega un Format D sin normalizar hace push_error (fail-loud).

**Fixtures de test** (`nefan-core/data/rooms/{dev,stress}/*.json`): world scenes escritas a mano — admiten además `lighting{ambient,lights[]}` (si falta, default), `mesh` (alias de `shape`, catálogo box/sphere/capsule/cylinder/cone/plane/torus), `color:[r,g,b]` por objeto (placeholder pre-textura), `terrain.texture_prompt`/`tiling`, y `combat{health,weapon_id,personality}` en objects para spawnear combatientes. `data/rooms/robledo_village.json` se genera con `npm run dump-scene` desde la escena Format D compartida con el 2D (se commitea; es el arranque offline del 3D).

**Reuse de assets**: cualquier `texture_prompt`/`model_prompt` admite un hermano `texture_hash`/`model_hash`. Si Claude lo proporciona (copiándolo de `available_assets`), Godot carga del cache local sin regenerar.

**Spawn dinámico**: vía consequences `spawn_entity` que devuelve `react_to_player` (señal `narrative_spawn` en Godot, `materializeSpawn` en HTML). Las entidades se materializan en el mundo en runtime sin recargar la escena.

Categorias: item (amarillo), prop (gris), building (marron), creature (rojo), terrain (verde), decor (gris apagado).

**Altura**: cada entity admite `h` opcional en METROS (el footprint sigue en celdas); sin él, `formatDToWorld` aplica `KIND_DEFAULT_HEIGHT` (building 2.5, tree 4, prop 1, item/decor 0.5) y emite `scale.y` real. El 3D la construye tal cual; el 2D la extruye como prisma (`view-prism.ts` + `drawSceneBox`: caras orientadas a cámara, tapa a `−h·verticalScale`) y las cajas altas (>1.2 m) ocluyen al player vía depth-sort con fade. La colisión NUNCA usa la altura (solo huella XZ).

## Convenciones de codigo

- GDScript 4.6+ con tipado estricto (Variant inference = error)
- Variables que acceden propiedades de Node generico: usar tipo explicito (`var x: float = node.health`, NO `:=`)
- class_name en scripts de combat, pero usar preload() en vez de class_name para referencias cruzadas
- Autoloads: GameStore, NarrativeState, AIClient, TextureCache, RemoteControl, LogicBridge, SessionRecorder, SessionPlayer
- Scripts nuevos que referencian otros: `const FooRef = preload("res://scripts/path/foo.gd")`
- Descripciones de objetos y NPC en espanol
- Unidades en metros

### Errores y logging (fail-loud uniforme)

Nunca `catch { /* ignore */ }`, nunca `return null` silencioso, nunca `return []` cuando hubo un error. Cada capa tiene un canal:

- **GDScript**: `push_error(...)` para invariantes rotos (frame mal formado, autoload ausente). `push_warning(...)` para degradación esperable (servicio opcional caído). `print(...)` sólo para trazas informativas que no son errores. Para preconditions duras de un lookup, usar `NodeAccess.must_get_node(root, path, "ctx")` (push_error + retorna null) en vez de `get_node_or_null` desnudo.
- **TS/HTML**: `errors.push("source", msg, err)` (`nefan-html/src/ui/error-log.ts`) en cualquier `catch` recuperable. Lanzar de nuevo si el caller necesita decidir. Devolver `Result<T,E>` (discriminated union `{ok:true,...} | {ok:false,error}`) cuando "vacío" y "error" son indistinguibles si se colapsan.
- **TS/bridge**: cualquier `.catch()` sobre una promise que el cliente está esperando debe broadcastear `narrative_status: error` además de loguear — patrón en `nefan-core/bridge/handlers/dialogue.ts` (`dialogue_choice`).
- **Python/FastAPI**: `raise HTTPException(status_code=..., detail=...)`, **nunca** `return {"error": ...}` con 200 OK. Pydantic `BaseModel` por endpoint para que campos ausentes salgan como 422 estructurado. Modelo de referencia: `/report_player_choice` en `ai_server/main.py`.

Listeners en autoloads compartidos: nodos transitorios usan `SignalLifecycle.auto_disconnect(self, autoload.signal, callback)` para que la subscripción muera con el nodo. Autoload→autoload se documenta en línea (`# OK: autoload, vida == app`).

## Decisiones de diseno importantes

- **Modo de juego canónico: open-world generativo.** El motor narrativo crea una escena base con `generate_scene` y va añadiendo entidades en runtime sin recargar (NPCs, edificios, objetos) según las elecciones del jugador.
- **Un solo formato de escena para ambos clientes.** El motor produce Format D; el bridge lo normaliza a world scene con `formatDToWorld` (nefan-core) antes de emitir, y 2D y 3D pintan esa misma forma. Nada exclusivo de un cliente en el schema de escena; Godot no proyecta celdas (fail-loud ante Format D crudo).
- **NarrativeState como save canónico, con el bridge como único escritor** — todo el playthrough vive en `saves/{session_id}/state.json` (multi-slot, schema versionado). Con bridge conectado, la sesión es la del bridge (plugins incluidos): el mirror GD se hidrata en memoria (`bridge_authoritative`) y su `save()` está bloqueado; pos/HP se snapshotean en `save_session` y el resume restaura posición, HP y entities. Offline, el mirror GD guarda en local. El runtime volátil (player.pos, hp vivo, enemies) vive en `GameStore` y se escribe solo vía `dispatch()`.
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
- **Proyección oblicua 2D única** (suelo cenital sin proyectar + cizalla en la altura: cara sur iluminada, cara este en sombra) — sustituyó a la doble perspectiva topdown/isometric; el LLM declara planes semánticos (`map_ground`+`volumes`) y el compositor de nefan-core proyecta. Colisión desde huellas, nunca desde píxeles pintados.

## Hardware

RTX 3060 12GB, Linux (Ubuntu, kernel 6.8), Ryzen 7 5800X. Godot 4.6.1 con `gl_compatibility`.
