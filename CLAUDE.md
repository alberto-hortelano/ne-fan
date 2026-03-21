# Never Ending Fantasy — Guia de desarrollo

RPG dark fantasy con motor Godot 4.6+. Salas 3D generadas desde JSON, assets IA (texturas PBR, modelos GLB, sprites NPC), narrativa LLM via MCP bridge. Combate cuerpo a cuerpo real-time.

## Arrancar el juego

```bash
# 1. AI server (texturas, modelos, sprites, narrativa)
cd ~/code/ne-fan
source .venv/bin/activate
python ai_server/main.py  # puerto 8765

# 2. Godot (sin editor, directo al juego)
~/Downloads/Godot_v4.6.1-stable_linux.x86_64 --path ~/code/ne-fan/godot --rendering-method gl_compatibility

# 3. MCP narrative bridge (automático via .mcp.json, o manual)
cd narrative-mcp && npm run build && node dist/server.js  # puerto 3737 (WebSocket)
```

El juego arranca sin ai_server — solo no generará texturas/modelos/sprites/salas nuevas.

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
echo '{"cmd":"key","action":"attack_execute"}' | nc -q 1 localhost 9876
echo '{"cmd":"mouse","dx":100,"dy":-30}' | nc -q 1 localhost 9876
echo '{"cmd":"teleport","x":2,"y":1,"z":-3}' | nc -q 1 localhost 9876
echo '{"cmd":"look_at","yaw":45,"pitch":-0.2}' | nc -q 1 localhost 9876
echo '{"cmd":"load_room","index":0}' | nc -q 1 localhost 9876
echo '{"cmd":"save"}' | nc -q 1 localhost 9876
```

El comando `status` devuelve: player_pos, camera_yaw/pitch, fps, room, combat_hp, combat_state, combat_weapon, ray_hit.

## Arquitectura

```
godot/                    Proyecto Godot 4.6+ (Forward+, 1920x1080)
  scripts/
    main.gd               Orquestador: carga salas, inicia combate, conecta HUD
    autoloads/
      game_state.gd        Estado mundo/jugador, serialize para LLM, save/load
      ai_client.gd         HTTP a ai_server:8765, genera salas via LLM
      remote_control.gd    TCP :9876 para testing
      texture_cache.gd     Pide texturas, cachea en disco
      sprite_cache.gd      Pide sprites NPC, cachea en disco
    room/
      room_builder.gd      JSON -> geometria (paredes, suelo, techo, exits)
      object_spawner.gd    JSON -> objetos + NPCs (mesh por categoria)
      light_placer.gd      JSON -> luces + ambiente
      exit_builder.gd      Area3D triggers para transiciones
    combat/
      combat_data.gd       Carga combat_config.json, merge ataque+arma
      combat_resolver.gd   Matematicas puras: distancia, precision, factor tactico
      combatant.gd         Componente: HP, estado, wind-up timer, senales
      combat_manager.gd    Orquestador: cola de impactos, resolucion simultanea
      player_combat_input.gd  Teclas 1-5 + LMB
      enemy_combat_ai.gd   IA: aggression, preferred_attacks, reaction_time
      combat_hud.gd        Barras HP, selector ataque, numeros flotantes
    player/
      player_controller.gd WASD + mouse look + sprint + jump
      interaction_ray.gd   RayCast3D para examinar objetos
    ai_assets/
      texture_loader.gd    Aplica PBR a superficies (albedo + normal)
      model_loader.gd      Carga GLB, reemplaza primitivas
      sprite_loader.gd     Billboard sprites para NPCs
    ui/
      game_hud.gd          Info sala, prompts interaccion, panel texto, fade, crosshair
  data/
    combat_config.json     Tipos ataque, armas, matriz tactica (editable sin recompilar)
  test_rooms/
    crypt_001.json         Cripta con cofre, pilares, esqueleto enemigo, NPC Elric
    tavern_001.json        Taberna con mesas, chimenea, NPC Greta
    corridor_001.json      Pasillo estrecho

ai_server/                Python FastAPI en puerto 8765
  main.py                 Endpoints HTTP
  llm_client.py           Claude via MCP bridge (ws://127.0.0.1:3737) o API directa
  narrative_schemas.py    Tool definitions + validacion de salas
  texture_generator.py    SD 1.5 + LCM-LoRA + TAESD (seamless tiling, ~1s/textura)
  model_generator.py      SD 1.5 ref -> rembg -> GLB
  sprite_generator.py     SD 1.5 -> rembg -> RGBA PNG
  asset_cache.py          Cache disco por SHA256(prompt)

narrative-mcp/            Node.js MCP bridge
  server.ts               MCP server (stdio) — tools: narrative_listen, narrative_respond
  ws-bridge.ts            WebSocket :3737 — conecta ai_server con Claude Code

Config/
  ai_server_config.json   Modelo LLM, puerto, resolucion texturas, cache paths
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
- Autoloads: GameState, AIClient, TextureCache, SpriteCache, RemoteControl
- Scripts nuevos que referencian otros: `const FooRef = preload("res://scripts/path/foo.gd")`
- Descripciones de objetos y NPC en espanol
- Unidades en metros

## Decisiones de diseno importantes

- **StreamDiffusion descartado** — abandonado, incompatible con CUDA 12.4. Usar diffusers nativo + TAESD + LCM-LoRA.
- **Rendering IA frame-by-frame archivado** — 1.3 FPS en RTX 3060, flickering. Enfoque actual: salas estaticas con texturas IA.
- **MCP bridge sobre API directa** — usuario tiene Claude Max, no necesita API key.
- **En desarrollo, subir iluminacion ambient** para ver bien objetos y geometria.
- **No borrar archivos de test** sin confirmacion explicita del usuario.

## Hardware

RTX 3060 12GB, Linux (Ubuntu, kernel 6.8), Ryzen 7 5800X. Godot 4.6.1 con `gl_compatibility`.
