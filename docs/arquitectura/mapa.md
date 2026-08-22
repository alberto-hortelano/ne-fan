# Mapa del repositorio

Qué vive en cada carpeta y qué proceso la usa. Consúltalo cuando no sepas dónde encaja un cambio.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

## Arquitectura

Plan de división en microservicios: `docs/microservices/README.md` (servicios, fronteras, fases F0–F6). Los contratos tipados de TODOS los servicios (endpoints WS/HTTP, incluidos los del ai_server Python) viven en `nefan-core/src/contracts/` — fuente de verdad del wire entre procesos.

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
  services/
    asset-store/           Microservicio S6 (:8767): blobs content-addressed +
                           manifest SQLite (F2) + styles binarios; ai_server
                           proxya /cache|/assets para Godot
  data/
    combat_config.json     Config compartida (symlink desde godot/data/)
    rooms/                 Fixtures de test en formato world scene (dev/, stress/, robledo_tile.json del dump)
    scenes/                Escenas Format D de ejemplo/fixture (robledo_tile, zorder_test) — fuente del dump
    games/{id}/            Juego = mundo: game.json + world.md + plugins/ (user_* = subidos)
    plugins/               Plugins shipped comunes a TODOS los juegos (economy); un plugins/ local con mismo name lo pisa
    styles/{id}/           Estilo: style.json + imágenes de referencia por categoría
  test/                    85 ficheros de test (combat, simulation, escena, narrativa,
                           plugins, contrato del modelo, fronteras arquitectónicas)

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

nefan-html/               Cliente web en PRIMERA PERSONA (three.js/WebGL)
  src/
    main.ts                Game loop, importa nefan-core directamente
    renderer/              fps-gl (three: el único contexto WebGL de la pestaña),
                           fps-renderer (fachada + import dinámico), sprite-renderer,
                           character-sprites, types
    scene/                 fps-atlas: pipeline de imagen del atlas de superficies
    world/                 Modelo de mundo del cliente: tile-store, frontier
    ui/                    Capa DOM in-game + pantalla de título (ver ui.md)
    net/                   bridge-client / narrative-client (WS al bridge)
    input/                 Providers: keyboard (default) y scripted (bench)

ai_server/                Python FastAPI — 3 procesos: main.py (narrativa :8765),
                          gpu_worker_main.py (:8766), remote_gen_main.py (:8768)
narrative-mcp/            Node.js MCP bridge

labs/                     Benches de experimentación (ver labs/README.md)
  common/                  Helpers compartidos: env (claves), fal (fal_call con
                           caché+gasto), images (data URIs, raster), sam (SAM2
                           cacheado), fidelity_score, report, capture.sh
  serve.sh                 Servidor estático de labs/ entero en :8912 (sin caché)
  skinning/                Skinning AI sobre sprites Mixamo (run.py --preset;
                           generador interactivo FastAPI en :8911)
  style/                   Referencias de estilo y fidelidad de layout (gen.py,
                           fidelity.py)
  fps/                     Bench de la vista de juego: dump_spec, escenas, capturas,
                           comparativa contra Godot (decidido: three)
  authoring/               Generadores declarativos de scatter (run 003 → scatter.ts)
  narrative/               Motor narrativo sin gráficos: game-emulator, fake-ai-server,
                           replay-server, check-scene.ts (tooling de E2E)
```
