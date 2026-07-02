# godot/tools — scripts de test contra el Remote Control (:9876)

Todos hablan con el autoload `RemoteControl` (TCP :9876, sólo builds debug).
Arrancar Godot **siempre** con `xvfb-run` (preset 3 de `./start.sh` o manual —
ver CLAUDE.md "Modo headless").

## Estado de cada script

| Script | Estado | Qué hace |
|--------|--------|----------|
| `movement_test.py` | **Vigente** — suite canónica tras cualquier cambio visual | 10 tests de movimiento/animación/combate con screenshots. `status.room` reporta la room runtime de GameStore; `load_room` descarta el title screen para que los screenshots muestren el mundo. |
| `remote.py` | **Vigente** | Cliente CLI genérico: envía cualquier comando JSON al puerto 9876. |
| `anim_debug.py` | Vigente con matices | Capturas multi-ángulo de una animación (`anim_debug.py medium --angles side`). Sigue el flujo de ANIMATION_MAPPING.md. |
| `attack_mapping.py` | **Desalineado** — revisar antes de fiarse | Mide reach/arco/impacto de animaciones para poblar `animation_intrinsics.json`. Escrito cuando la lógica de combate vivía en Godot; hoy los parámetros efectivos vienen precalculados de nefan-core (`combat_effective_params.json`) y el selector de clips (`_select_best_animation`) elige por atributos físicos. Verificar sus medidas frame a frame contra el detector (confunde wind-ups con golpes). |
| `game_test.py` | Desalineado — usa el flujo `load_game` legacy | Ciclo de vida de partida, pausa y combate visual. El arranque canónico hoy es `start_session` vía bridge (open-world), no `load_game`. |
| `visual_stress_test.py` | Legacy de rooms | Estrés del generador de rooms cerradas (`test_rooms/stress/*`). Las rooms son legacy de tests, no la unidad de gameplay. |

## Notas de arquitectura

- **Rooms cerradas = legacy de tests.** `scripts/room/room_builder.gd` (schema
  `surfaces/exits`) sólo lo alimentan los JSON de `test_rooms/` vía F1/F2/F3 o
  el dev menu (F12). El flujo canónico es open-world: `outdoor_builder.gd` +
  `world/chunk_manager.gd` + `world/terrain_generator.gd`.
- `light_placer.gd` y `exit_builder.gd` NO son legacy: los comparten
  `room_builder` (legacy) y `outdoor_builder` (canónico).
- `room_geometry.gd` (transiciones de rooms legacy) se eliminó al quedarse sin
  callers.
- La aserción de animación de ataque valida comportamiento ("reproduce y
  vuelve a idle"), no el nombre del clip: el selector puede elegir cualquier
  clip cuyo reach/arco encaje con los parámetros del ataque.
