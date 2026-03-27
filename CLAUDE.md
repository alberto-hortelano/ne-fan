# Never Ending Fantasy — Guia de desarrollo

RPG dark fantasy con motor Godot 4.6+. Salas 3D generadas desde JSON, assets IA (texturas PBR, modelos GLB, sprites NPC), narrativa LLM via MCP bridge. Combate cuerpo a cuerpo real-time.

## Arrancar el juego

```bash
# Forma rápida (script):
./start.sh godot      # Solo Godot
./start.sh bridge     # Solo bridge TS (nefan-core :9877)
./start.sh html       # Solo cliente HTML 2D (:3000)
./start.sh headless   # Godot sin ventana (xvfb-run, para tests)
./start.sh all        # Todo: bridge + Godot + HTML

# Manual:
cd ~/code/ne-fan
source .venv/bin/activate
python ai_server/main.py                    # AI server :8765 (opcional)
cd nefan-core && npm run dev                # Bridge TS :9877 (opcional)
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
| F1/F2/F3 | Cargar test room (crypt/tavern/corridor) |
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

5. **La sala de test debe tener referencia visual.** Usar `root_motion_debug` que tiene marcadores de distancia en el suelo (cruz a 2m y 4m). La cápsula verde semi-visible es esencial para comparar posición del body vs modelo.

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

```bash
./start.sh headless    # Godot via xvfb-run, sin ventana visible
# Luego ejecutar tests normalmente
python3 godot/tools/movement_test.py
```

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
    rooms/                 Todas las salas JSON (godot tiene symlinks)
  test/                    39 tests (combat, animation, simulation)

godot/                    Proyecto Godot 4.6+ (Forward+, 1920x1080)
  scripts/
    main.gd               Orquestador: carga salas, inicia combate, conecta HUD
    autoloads/
      game_store.gd        Estado centralizado, dispatch/on/snapshot
      game_state.gd        Estado mundo/jugador (legacy, migrar a GameStore)
      ai_client.gd         HTTP a ai_server:8765
      remote_control.gd    TCP :9876 para testing automatizado
      logic_bridge.gd      WebSocket client a nefan-core bridge (:9877)
      session_recorder.gd  Snapshots periodicos para replay (F10)
      session_player.gd    Reproduce grabaciones (F11)
      texture_cache.gd     Texturas PBR, cachea en disco
      sprite_cache.gd      Sprites NPC, cachea en disco
    room/
      room_builder.gd      JSON -> geometria
      object_spawner.gd    JSON -> objetos + NPCs + debug capsules
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
      sprite_loader.gd     Billboard sprites
    ui/
      game_hud.gd          Info sala, prompts, panel texto, fade
      dev_menu.gd          Menu desarrollo (F12): lista salas + selector animaciones
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
```

## AI server — Endpoints

| Endpoint | Metodo | Que hace |
|----------|--------|----------|
| `/health` | GET | Estado: ready/loading, pipeline texturas |
| `/generate_room` | POST | LLM genera sala completa desde world_state |
| `/generate_texture` | POST | Textura PBR seamless (albedo+normal), ~1s |
| `/generate_model` | POST | Modelo GLB desde prompt |
| `/generate_sprite` | POST | Sprite RGBA (NPC portrait) |
| `/cache/{type}/{hash}` | GET | Servir asset cacheado (albedo/normal/roughness/model/sprite) |

## Modelos de IA y que hacen

| Modelo | Uso | Donde |
|--------|-----|-------|
| **Claude Sonnet 4.5** | Genera salas JSON completas (narrativa + geometria + iluminacion) | llm_client.py via MCP bridge o API |
| **SD 1.5** + LCM-LoRA + TAESD | Texturas PBR seamless tiling (4 pasos, fp16) | texture_generator.py |
| **SD 1.5** | Imagenes referencia para modelos 3D y sprites NPC | model_generator.py, sprite_generator.py |
| **rembg** (u2net) | Quitar fondo de sprites y referencias de modelo | model_generator.py, sprite_generator.py |

VRAM: ~3 GB pico (fp16). Todo secuencial con GPU lock (sin concurrencia CUDA).

## MCP bridge — Como funciona la narrativa

1. Godot sale por un exit → `AIClient.generate_room(world_state)` POST a ai_server
2. ai_server envia request via WebSocket a narrative-mcp (:3737)
3. Claude Code (en otra terminal) llama `narrative_listen()` → recibe el world_state
4. Claude genera sala JSON completa → llama `narrative_respond(room_json)`
5. ai_server recibe respuesta → la valida → la devuelve a Godot
6. Godot construye la sala con room_builder

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

## Room JSON schema

```json
{
  "room_id": "crypt_001",
  "room_description": "...",
  "dimensions": { "width": 12.0, "height": 4.0, "depth": 10.0 },
  "surfaces": {
    "floor": { "texture_prompt": "...", "tiling": [2, 2] },
    "ceiling": { "texture_prompt": "...", "tiling": [2, 2] },
    "walls": [{ "side": "north", "texture_prompt": "...", "tiling": [3, 1] }]
  },
  "exits": [{ "wall": "north", "offset": 0.0, "size": [2.0, 3.0], "target_hint": "..." }],
  "lighting": {
    "ambient": { "color": [0.05, 0.03, 0.02], "intensity": 0.3 },
    "lights": [{ "type": "point", "position": [0, 3.5, 0], "color": [1.0, 0.7, 0.3], "intensity": 2.0, "range": 8.0 }]
  },
  "objects": [{
    "id": "chest_01", "mesh": "box", "position": [3, 0, 3], "scale": [0.6, 0.4, 0.5],
    "category": "item", "description": "...", "interactive": true,
    "combat": { "health": 60, "weapon_id": "short_sword", "personality": { "aggression": 0.7, "preferred_attacks": ["quick"], "reaction_time": 0.6 } }
  }],
  "npcs": [{ "id": "npc_01", "name": "Elric", "sprite_prompt": "...", "dialogue_hint": "..." }],
  "ambient_event": "..."
}
```

Meshes: box, sphere, capsule, cylinder, cone, plane, torus. Categorias: item (amarillo), prop (gris), building (marron), creature (rojo), terrain (verde).

## Convenciones de codigo

- GDScript 4.6+ con tipado estricto (Variant inference = error)
- Variables que acceden propiedades de Node generico: usar tipo explicito (`var x: float = node.health`, NO `:=`)
- class_name en scripts de combat, pero usar preload() en vez de class_name para referencias cruzadas
- Autoloads: GameStore, GameState, AIClient, TextureCache, SpriteCache, RemoteControl, LogicBridge, SessionRecorder, SessionPlayer
- Scripts nuevos que referencian otros: `const FooRef = preload("res://scripts/path/foo.gd")`
- Descripciones de objetos y NPC en espanol
- Unidades en metros

## Decisiones de diseno importantes

- **StreamDiffusion descartado** — abandonado, incompatible con CUDA 12.4. Usar diffusers nativo + TAESD + LCM-LoRA.
- **Rendering IA frame-by-frame archivado** — 1.3 FPS en RTX 3060, flickering. Enfoque actual: salas estaticas con texturas IA.
- **MCP bridge sobre API directa** — usuario tiene Claude Max, no necesita API key.
- **En desarrollo, subir iluminacion ambient** para ver bien objetos y geometria.
- **No borrar archivos de test** sin confirmacion explicita del usuario.
- **Logica en nefan-core, Godot solo visual** — prepararse para cambio de motor. Datos compartidos (rooms, config) en nefan-core, no en godot/.
- **AnimationTree con StateMachine (Souls-Like pattern)** — no usar AnimationPlayer directo. `travel()` para transiciones, `start()` para interrupciones.
- **Sin root motion** — todo el movimiento via velocity del CharacterBody3D. Animaciones puramente visuales. Lockear Hips XZ solo en walk/run.
- **Camara independiente** — no es hija del player. Sigue al body con lerp + SpringArm3D. Player excluyido del SpringArm collision.
- **No usar animaciones con pasos para ataques** — causan sliding de pies al lockear Hips. Usar animaciones estáticas (attack(4), slash, slash(5), slash(3)).
- **Tests automatizados tras cada cambio visual** — `python3 godot/tools/movement_test.py`. Verificar screenshots.

## Hardware

RTX 3060 12GB, Linux (Ubuntu, kernel 6.8), Ryzen 7 5800X. Godot 4.6.1 con `gl_compatibility`.
