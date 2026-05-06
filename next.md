# Siguiente fase:

## Estado actual:

### Generación de historia (narrativa)
- **MCP Bridge** (`narrative-mcp/`) - Funcional. Expone `narrative_listen` y `narrative_respond` para que Claude genere salas completas en JSON.
- **LLM Client** (`ai_server/llm_client.py`) - Dual-mode: MCP bridge (primario) + API directa como fallback.

### Generación de mapa (salas 3D)
- **Room Builder** (`godot/scripts/room/`) - Funcional. JSON → geometría 3D completa.
- **24 salas JSON** ya creadas (3 de juego, 6 de estilo, 8 de stress test, 6 dev).
- **AI Texture Generator** - SD 1.5 + LCM-LoRA, texturas PBR seamless en ~1s.
- **AI Model Generator** - TripoSG → GLB, con 17 modelos ya cacheados.

### Generación procedural de mapa
- **Terreno infinito** (`terrain_generator.gd`) - Heightmap con FastNoiseLite (Simplex + FBM, 4 octavas), genera mesh + HeightMapShape3D para física.
- **Chunk Manager** (`chunk_manager.gd`) - Streaming de chunks de 32m, radio de carga ±2 chunks (5×5 grid), actualiza cada 0.5s según posición del jugador.
- **Vegetación procedural** (`vegetation_spawner.gd`) - Hierba (MultiMesh, ~1500-2000), arbustos (30-40), árboles (anillos a 15-28m). Seeded RNG determinístico por chunk.
- **Zonas outdoor** - Salas con `zone_type: "outdoor"` activan terreno chunked + vegetación. Ejemplos funcionales: `open_world_test.json`, `forest_clearing_001.json`.

### Personajes 3D (todos Mixamo)
- **NPCs ambient** - 6 modelos Mixamo (peasant_female, peasant_male, knight, mage, rogue, soldier) con 14 animaciones compartidas (idle, sitting, talking, drinking, praying, waving, leaning, wounded, lying, arms_crossed, salute...).
- **Enemigos** - 3 modelos Mixamo existentes (mutant, skeletonzombie, warrok) + Paladin con combat animations.
- **Skin Generator** - Variantes de skin sobre el atlas UV del Paladin (img2img).
- **NpcAnimator** (`npc_animator.gd`) - Carga modelo + animaciones ambient, AnimationTree simplificado.
- **NpcModelRegistry** (`npc_model_registry.gd`) - Diccionario character_type → path FBX.

### Motor de juego
- **Combate** - Implementado completo en TypeScript (nefan-core), Godot solo renderiza.
- **Animation Controller** - State machine con transiciones, patrón Souls-Like.
- **Enemy AI** - Con personalidad configurable, 9 combinaciones de dificultad.
- **Remote Control** - Puerto 9876 para testing automatizado.

### Infraestructura
- `./start.sh` (interactivo) — preset "Play" arranca todo el stack.
- Tests automatizados con `movement_test.py`.

### Resumen

| Herramienta | Estado |
|---|---|
| Terreno procedural infinito | Completo |
| Vegetación procedural | Completo |
| Generación de salas indoor (LLM) | Completo |
| Generación de zonas outdoor | Completo |
| Texturas PBR (SD 1.5) | Completo |
| Modelos 3D (TripoSG → GLB) | Completo |
| NPCs 3D Mixamo (6 modelos + 14 anims) | Completo |
| Skins de personaje | Completo |
| Combate (nefan-core TS) | Completo |
| Narrativa MCP bridge | Completo |
| Testing automatizado | Completo |

### Falta para jugar
- **Loop de juego** - Salir de sala → generar siguiente → world state → progresión.
- **World state persistente** - Estado del mundo que alimenta al LLM para coherencia narrativa.
- **Enemigos activos** - La IA de combate está lista pero no hay enemigos spawneados que ataquen.
- **Inventario/progresión** - No hay sistema de loot ni progresión del jugador.

