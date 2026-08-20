# Arrancar y probar el juego

Cómo se conduce el juego sin manos y qué hay que comprobar tras un cambio visual. El menú de presets vive en `CLAUDE.md`; esto es lo que viene después.

> Extraído de `CLAUDE.md` para que el prompt base quepa en la zona útil del contexto.
> Es la misma documentación, movida. Si algo de aquí es verificable mecánicamente,
> su sitio es `nefan-core/data/contract/arch-rules.json`, no la prosa.

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

### Comprobación final crítica (definición de hecho)

Una tarea NO está terminada cuando "funciona lo que construí": está terminada cuando se cumple **lo que se pidió**. Antes de cerrar cualquier tarea:

1. **Releer la petición ORIGINAL del usuario** (no el plan propio) y convertirla en criterios de aceptación literales. Un requisito absoluto ("siempre", "en todo momento", "cualquier") obliga a enumerar TODOS los estados del sistema (arranque/título, diálogo, overlays, history browser, offline, fixtures…) y probar el criterio en cada uno.
2. **Verificar en el flujo real del usuario, empezando donde él empieza** (arrancar el juego desde cero), no en un escenario preparado para que la prueba pase.
3. **Regla del workaround:** si durante la verificación hay que ocultar/forzar/stubear algo para ver la feature (un `display:none` a un overlay, estado sintético, saltarse una pantalla), el usuario tendrá ese mismo obstáculo delante — es un HALLAZGO que arreglar o reportar, nunca un paso de la receta de captura.
4. **Pasada adversarial:** el último paso es intentar FALSIFICAR cada criterio ("¿en qué situación NO se cumple?"), no confirmarlo una vez y declararlo hecho.

Caso de referencia (2026-08-09): panel de dev "siempre visible" — renderizaba bien, pero el title-screen lo tapaba justo en el flujo donde más importaba (crear mundo/estilo = gastar créditos). La captura de verificación YA lo mostraba tapado y se ocultó el overlay para fotografiar en vez de leerlo como bug.

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
./start.sh             # → preset 3 "Automated tests" (bridge + Godot headless)
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
