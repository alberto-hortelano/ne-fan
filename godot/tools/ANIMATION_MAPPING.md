# Guia de mapeo de animaciones de ataque

Procedimiento para medir los atributos fisicos de animaciones de ataque y actualizar la tabla de equivalencias.

## Prerequisitos

- Godot corriendo headless: `./start.sh headless`
- Bridge APAGADO (interfiere con load_game): `fuser -k 9877/tcp`
- Puerto 9876 accesible (remote control)

## 1. Registrar animaciones nuevas

Si hay animaciones FBX nuevas sin mapear, registrarlas en 3 archivos:

### combat_animator.gd
```gdscript
# En ANIM_MAP — clave logica → nombre FBX sin extension
"mi_anim": "sword and shield mi animacion",

# En ONE_SHOT_SET
"mi_anim": true,

# En one_shots[] dentro de _setup_animation_tree()
"mi_anim",
```

### combat_animation_sync.gd
```gdscript
# En ONE_SHOT_ANIMS
"mi_anim",
```

### nefan-core/data/combat_config.json
```json
"mi_anim": {
  "duration": 0.0,
  "interruptible": false,
  "loops": false,
  "category": "combat"
}
```
La duracion placeholder (0.0) se actualiza despues de medir.

## 2. Capturar y medir automaticamente

```bash
# Todas las animaciones de ataque
python3 godot/tools/attack_mapping.py

# Solo algunas
python3 godot/tools/attack_mapping.py quick heavy mi_anim

# Sin screenshots (solo datos)
python3 godot/tools/attack_mapping.py --no-screenshots

# Si la sala debug ya esta cargada
python3 godot/tools/attack_mapping.py --no-room
```

El script:
- Fuerza orientacion del player a -Z antes de cada medicion
- Captura screenshots top-down y lateral
- Mide weapon_tip trajectory a 20fps
- Detecta peaks de alcance (candidatos a golpes)
- Genera `/tmp/attack_mapping/intrinsics.json` y `/tmp/attack_mapping/full_data.json`

## 3. Verificar visualmente (IMPRESCINDIBLE)

El detector automatico de peaks es impreciso — confunde wind-ups con golpes. Siempre revisar los screenshots laterales frame a frame:

```
/tmp/attack_mapping/{anim_name}/side_000.png  # inicio
/tmp/attack_mapping/{anim_name}/side_003.png  # wind-up tipico
/tmp/attack_mapping/{anim_name}/side_005.png  # impacto tipico
/tmp/attack_mapping/{anim_name}/side_NNN.png  # recuperacion
```

Para cada animacion, determinar:

| Dato | Como verificar |
|------|---------------|
| **num_hits** | Contar cuantas veces la espada se extiende hacia el enemigo (wind-up NO cuenta) |
| **impact_fraction** | Frame del impacto / frames totales. Ej: impacto en frame 5 de 10 → 0.5 |
| **style** | `wide_slash` (arco >100°), `thrust` (arco <30°), `block_strike`, `kick` |

### Patrones tipicos en screenshots laterales

- **Wind-up**: espada sube o va hacia atras — NO es un golpe
- **Impacto**: espada extendida al maximo hacia adelante/lateral — ES un golpe
- **Recuperacion**: espada vuelve al cuerpo — NO es un golpe
- **Multi-hit**: la espada vuelve al cuerpo y se extiende de nuevo — 2+ golpes

## 4. Actualizar animation_intrinsics.json

Archivo: `nefan-core/data/animation_intrinsics.json` (symlink en `godot/data/`)

```json
{
  "attack_animations": {
    "mi_anim": {
      "fbx_name": "sword and shield mi animacion",
      "duration": 1.5,
      "num_hits": 1,
      "has_steps": false,
      "visual_reach_m": 0.65,
      "visual_sweep_deg": 140.0,
      "max_hips_displacement_m": 0.03,
      "impact_fraction": 0.35,
      "style": "wide_slash"
    }
  }
}
```

Campos:
- `duration`: del output del script (o del response de play_anim)
- `num_hits`: verificado visualmente
- `visual_reach_m`: distancia max del weapon_tip al cuerpo (del script)
- `visual_sweep_deg`: arco total cubierto por el arma (del script, pero verificar coherencia)
- `impact_fraction`: fraccion de la duracion donde ocurre el impacto (verificado visualmente)
- `style`: categorizado visualmente
- `has_steps`: true si el personaje se desplaza significativamente (>0.3m de hips)

## 5. Actualizar duraciones en combat_config.json

Si la duracion real difiere de la que habia, actualizar en `nefan-core/data/combat_config.json` seccion `animations`.

## 6. Verificar

```bash
# Tests TypeScript
cd nefan-core && npm test

# Tests Godot (con Godot corriendo)
python3 godot/tools/movement_test.py idle_state attack_animation
```

## Referencia: sala de test

La sala `root_motion_debug` tiene:
- Suelo con marcas de distancia a 2m y 4m en cruz
- Sin techo (ceiling: null) para vista cenital
- Sin enemigos
- Luz ambient alta

Cargar: `{"cmd":"load_room_path","path":"res://test_rooms/dev/root_motion_debug.json"}`

## Referencia: estilos de animacion

| Estilo | Arco | Ideal para |
|--------|------|-----------|
| `wide_slash` | >100° | Ataques de area, groups, area_radius alto |
| `thrust` | <30° | Ataques precisos, single target, area_radius bajo |
| `block_strike` | variable | Ataques defensivos, damage_reduction > 0 |
| `kick` | ~120° | Ataques sin arma, empujar |
