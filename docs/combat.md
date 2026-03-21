# Sistema de Combate Cuerpo a Cuerpo — Especificación Técnica

## Plataforma
- **Engine:** Godot (GDScript)
- **Modo:** PvP y PvE

---

## Resumen

El sistema de combate cuerpo a cuerpo resuelve cada ataque calculando una **puntuación de calidad** basada en tres factores simultáneos: timing (distancia al enemigo vs distancia óptima en el momento del impacto), precisión espacial (posición del enemigo dentro del área de efecto), y ventaja táctica (interacción entre el tipo de ataque del jugador y la acción actual del oponente). Las armas modifican todos estos parámetros.

---

## Tipos de Ataque

Existen 5 tipos de ataque. El jugador selecciona un tipo y lo ejecuta con click. El método de selección (teclas, UI, etc.) queda como configurable.

| Tipo | Descripción |
|------|-------------|
| **Rápido** | Bajo wind-up, área pequeña, daño base bajo |
| **Fuerte** | Alto wind-up, área grande, daño base alto |
| **Medio** | Valores equilibrados en todos los parámetros |
| **Defensivo** | Reduce daño recibido, contraataca con daño moderado |
| **Preciso** | Wind-up medio, área muy pequeña, daño alto si conecta bien |

---

## Parámetros por Tipo de Ataque (valores iniciales, ajustables)

Cada tipo de ataque define los siguientes parámetros base. Las armas aplican modificadores sobre estos valores.

```gdscript
# Estructura de datos para un tipo de ataque
class_name AttackType

@export var id: String                    # "quick", "heavy", "medium", "defensive", "precise"
@export var display_name: String

# Timing
@export var wind_up_time: float           # Segundos desde click hasta impacto (ej: 0.15 - 0.8)

# Distancia
@export var optimal_distance: float       # Distancia ideal al enemigo en el momento del impacto
@export var distance_tolerance: float     # Rango de tolerancia alrededor de la distancia óptima

# Área de efecto
@export var area_radius: float            # Radio del área de efecto (más pequeño = más difícil)

# Daño
@export var base_damage: float            # Daño base antes de multiplicadores de calidad

# Defensa (solo relevante para "defensivo")
@export var damage_reduction: float       # Factor de reducción de daño recibido (0.0 - 1.0)
```

### Valores iniciales sugeridos (ajustar mediante playtesting)

```gdscript
var attack_types = {
    "quick": AttackType.new({
        wind_up_time = 0.15,
        optimal_distance = 1.5,
        distance_tolerance = 1.0,
        area_radius = 1.2,
        base_damage = 15.0,
        damage_reduction = 0.0
    }),
    "heavy": AttackType.new({
        wind_up_time = 0.7,
        optimal_distance = 2.0,
        distance_tolerance = 1.5,
        area_radius = 2.5,
        base_damage = 45.0,
        damage_reduction = 0.0
    }),
    "medium": AttackType.new({
        wind_up_time = 0.4,
        optimal_distance = 1.8,
        distance_tolerance = 1.2,
        area_radius = 1.8,
        base_damage = 25.0,
        damage_reduction = 0.0
    }),
    "defensive": AttackType.new({
        wind_up_time = 0.3,
        optimal_distance = 1.2,
        distance_tolerance = 1.0,
        area_radius = 1.5,
        base_damage = 18.0,
        damage_reduction = 0.5
    }),
    "precise": AttackType.new({
        wind_up_time = 0.45,
        optimal_distance = 1.6,
        distance_tolerance = 0.8,
        area_radius = 0.7,
        base_damage = 40.0,
        damage_reduction = 0.0
    }),
}
```

---

## Armas

Las armas aplican modificadores multiplicativos y/o aditivos sobre los parámetros del tipo de ataque.

```gdscript
class_name Weapon

@export var id: String
@export var display_name: String

# Modificadores por tipo de ataque: Dictionary[String, WeaponModifier]
@export var modifiers: Dictionary

# Modificador global de wind-up (se aplica a todos los tipos)
@export var wind_up_modifier: float       # Multiplicador (1.0 = sin cambio, 0.8 = 20% más rápido)
```

```gdscript
class_name WeaponModifier

@export var damage_multiplier: float      # 1.0 = sin cambio
@export var optimal_distance_offset: float # Sumado a la distancia óptima del ataque
@export var area_radius_multiplier: float # 1.0 = sin cambio
@export var wind_up_multiplier: float     # 1.0 = sin cambio (se multiplica con el global)
```

### Ejemplo: espada corta vs martillo de guerra

```gdscript
var weapons = {
    "short_sword": Weapon.new({
        wind_up_modifier = 0.85,  # Arma ligera, todos los ataques un poco más rápidos
        modifiers = {
            "quick":   WeaponModifier.new({ damage_multiplier = 1.3, optimal_distance_offset = -0.2, area_radius_multiplier = 1.0, wind_up_multiplier = 0.9 }),
            "heavy":   WeaponModifier.new({ damage_multiplier = 0.7, optimal_distance_offset = -0.3, area_radius_multiplier = 0.8, wind_up_multiplier = 1.0 }),
            "medium":  WeaponModifier.new({ damage_multiplier = 1.1, optimal_distance_offset = -0.1, area_radius_multiplier = 1.0, wind_up_multiplier = 0.95 }),
            "defensive": WeaponModifier.new({ damage_multiplier = 1.0, optimal_distance_offset = -0.2, area_radius_multiplier = 1.0, wind_up_multiplier = 0.9 }),
            "precise": WeaponModifier.new({ damage_multiplier = 1.2, optimal_distance_offset = -0.1, area_radius_multiplier = 1.1, wind_up_multiplier = 0.95 }),
        }
    }),
    "war_hammer": Weapon.new({
        wind_up_modifier = 1.2,  # Arma pesada, todos los ataques más lentos
        modifiers = {
            "quick":   WeaponModifier.new({ damage_multiplier = 0.8, optimal_distance_offset = 0.3, area_radius_multiplier = 1.2, wind_up_multiplier = 1.2 }),
            "heavy":   WeaponModifier.new({ damage_multiplier = 1.4, optimal_distance_offset = 0.5, area_radius_multiplier = 1.3, wind_up_multiplier = 1.0 }),
            "medium":  WeaponModifier.new({ damage_multiplier = 1.1, optimal_distance_offset = 0.2, area_radius_multiplier = 1.1, wind_up_multiplier = 1.1 }),
            "defensive": WeaponModifier.new({ damage_multiplier = 0.9, optimal_distance_offset = 0.2, area_radius_multiplier = 1.1, wind_up_multiplier = 1.1 }),
            "precise": WeaponModifier.new({ damage_multiplier = 0.7, optimal_distance_offset = 0.3, area_radius_multiplier = 0.9, wind_up_multiplier = 1.15 }),
        }
    }),
}
```

---

## Flujo de un Ataque

1. **Selección:** El jugador selecciona un tipo de ataque (método de input TBD/configurable).
2. **Click:** El jugador hace click para iniciar el ataque. A partir de aquí **no se puede cancelar**.
3. **Wind-up:** Pasa un tiempo antes del impacto. Duración = `attack.wind_up_time * weapon.wind_up_modifier * weapon.modifiers[attack.id].wind_up_multiplier`. Durante el wind-up el jugador puede moverse pero no iniciar otro ataque.
4. **Impacto:** En el momento del impacto se calcula la calidad del ataque y se aplica el daño.
5. **Resolución:** El jugador puede iniciar otro ataque inmediatamente (no hay cooldown más allá del wind-up).

Si dos ataques se resuelven al mismo tiempo, **ambos combatientes reciben daño** según la calidad de cada ataque.

---

## Cálculo de Calidad del Ataque

La calidad final es un valor float >= 0. Se calcula como el producto de tres factores:

```
calidad = factor_distancia * factor_precision * factor_tactico * base_damage * weapon_damage_multiplier
```

### Factor Distancia (timing)

Mide lo cerca que está el enemigo de la distancia óptima en el momento del impacto.

```gdscript
func calculate_distance_factor(
    actual_distance: float,
    optimal_distance: float,  # Ya modificado por arma
    tolerance: float
) -> float:
    var deviation = abs(actual_distance - optimal_distance)
    if deviation >= tolerance:
        return 0.0  # Fuera de rango, el ataque falla
    # 1.0 en distancia perfecta, decrece linealmente hasta 0.0 en el borde
    return 1.0 - (deviation / tolerance)
```

> NOTA: La función de caída (lineal, cuadrática, etc.) es ajustable. Lineal como punto de partida.

### Factor Precisión (área de efecto)

Mide lo cerca que está el enemigo del centro del área de efecto en el momento del impacto.

```gdscript
func calculate_precision_factor(
    enemy_offset_from_center: float,  # Distancia del enemigo al centro del área
    area_radius: float                # Ya modificado por arma
) -> float:
    if enemy_offset_from_center >= area_radius:
        return 0.0  # Fuera del área, no impacta
    return 1.0 - (enemy_offset_from_center / area_radius)
```

> NOTA: `enemy_offset_from_center` se mide como la distancia perpendicular del enemigo respecto al eje del ataque (en el plano relevante). La implementación exacta depende de si el área es un cono, un cilindro, un hemisferio, etc. Esto queda como decisión de implementación.

### Factor Táctico (ventaja por tipo de ataque)

Modificador basado en la interacción entre el tipo de ataque del atacante y la acción actual del defensor.

```gdscript
# Matriz de ventajas: matchup_modifiers[mi_ataque][accion_enemigo] -> float
# Valores > 1.0 = ventaja, < 1.0 = desventaja, 1.0 = neutral
var matchup_modifiers: Dictionary = {
    "quick": {
        "quick": 1.0,
        "heavy": 1.3,       # Rápido castiga el wind-up largo del fuerte
        "medium": 1.0,
        "defensive": 0.7,   # Defensivo para ataques rápidos fácilmente
        "precise": 1.1,
        "moving": 1.0,      # Enemigo solo moviéndose
        "idle": 1.1,        # Enemigo quieto
    },
    "heavy": {
        "quick": 0.8,
        "heavy": 1.0,
        "medium": 1.1,
        "defensive": 1.3,   # Fuerte rompe la defensa
        "precise": 1.0,
        "moving": 0.9,
        "idle": 1.2,
    },
    "medium": {
        "quick": 1.0,
        "heavy": 0.9,
        "medium": 1.0,
        "defensive": 1.0,
        "precise": 1.1,
        "moving": 1.0,
        "idle": 1.1,
    },
    "defensive": {
        "quick": 1.2,
        "heavy": 0.7,       # Fuerte rompe defensa
        "medium": 1.0,
        "defensive": 0.8,
        "precise": 0.9,
        "moving": 0.8,
        "idle": 0.9,
    },
    "precise": {
        "quick": 0.9,
        "heavy": 1.0,
        "medium": 0.9,
        "defensive": 1.1,
        "precise": 1.0,
        "moving": 0.7,      # Difícil acertar un preciso a un enemigo en movimiento
        "idle": 1.3,        # Preciso castiga mucho al que está quieto
    },
}
```

> NOTA: Los valores de la matriz son iniciales y deben ajustarse mediante playtesting. La lógica del sistema debe permitir editar estos valores fácilmente (preferiblemente desde un Resource o archivo de configuración).

### Reducción de Daño (Defensivo)

Si el defensor está ejecutando un ataque de tipo **defensivo**, el daño recibido se reduce:

```gdscript
var final_damage = attack_quality  # Resultado de la fórmula de calidad
if defender_current_attack_type == "defensive":
    var reduction = defender_weapon_modified_damage_reduction
    final_damage *= (1.0 - reduction)
```

---

## Fórmula Completa Paso a Paso

```gdscript
func resolve_attack(
    attacker: Combatant,
    defender: Combatant,
    attack_type: AttackType,
    weapon: Weapon
) -> float:
    var mod = weapon.modifiers[attack_type.id]

    # 1. Parámetros efectivos (ataque + arma)
    var effective_optimal_distance = attack_type.optimal_distance + mod.optimal_distance_offset
    var effective_area_radius = attack_type.area_radius * mod.area_radius_multiplier
    var effective_base_damage = attack_type.base_damage * mod.damage_multiplier

    # 2. Medir estado actual en el momento del impacto
    var actual_distance = attacker.position.distance_to(defender.position)
    var offset_from_center = _calculate_offset_from_attack_center(attacker, defender)
    var defender_action = defender.get_current_action()  # "quick", "heavy", ..., "moving", "idle"

    # 3. Factores de calidad
    var distance_factor = calculate_distance_factor(
        actual_distance, effective_optimal_distance, attack_type.distance_tolerance
    )
    var precision_factor = calculate_precision_factor(
        offset_from_center, effective_area_radius
    )
    var tactical_factor = matchup_modifiers[attack_type.id][defender_action]

    # 4. Calidad del ataque
    var attack_quality = distance_factor * precision_factor * tactical_factor * effective_base_damage

    # 5. Reducción defensiva del defensor
    if defender_action == "defensive":
        var defender_mod = defender.weapon.modifiers["defensive"]
        var def_attack_type = attack_types["defensive"]
        var effective_reduction = def_attack_type.damage_reduction  # Arma puede modificar esto si se añade
        attack_quality *= (1.0 - effective_reduction)

    return attack_quality
```

---

## Resolución Simultánea

Cuando dos ataques se resuelven en el mismo frame (o dentro de una ventana de simultaneidad configurable):

```gdscript
@export var simultaneous_window: float = 0.05  # Segundos de margen para considerar simultáneo

# Ambos ataques se resuelven independientemente.
# Cada combatiente recibe el daño calculado por el ataque del otro.
# No hay "clash" ni cancelación mutua.
```

---

## Estados del Combatiente

Un combatiente puede estar en uno de estos estados en cualquier momento:

```gdscript
enum CombatantState {
    IDLE,           # Sin acción
    MOVING,         # Moviéndose sin atacar
    WINDING_UP,     # En wind-up de un ataque (el tipo de ataque se conoce)
    ATTACKING,      # Frame(s) de impacto
}
```

Para el cálculo del factor táctico, el `defender_action` se mapea así:
- `IDLE` → "idle"
- `MOVING` → "moving"
- `WINDING_UP` → el tipo de ataque que está preparando (ej: "heavy")
- `ATTACKING` → el tipo de ataque que está ejecutando

---

## Feedback al Jugador

- **No hay indicador explícito** del tipo de ataque que el oponente está preparando.
- El jugador debe **inferir** la intención del oponente basándose en:
  - El arma que lleva (sugiere qué tipos de ataque favorecerá)
  - Su movimiento y distancia (acercarse sugiere rápido/preciso, mantener distancia sugiere fuerte)
  - Posibles fintas y engaños del oponente
- Feedback post-ataque (TBD): mostrar la calidad del ataque de alguna forma (número de daño, efecto visual escalado, etc.)

---

## Notas de Implementación

1. **Todos los valores numéricos son placeholder.** El sistema debe diseñarse para que sean fácilmente configurables, idealmente desde Godot Resources (`.tres`) o un archivo JSON/config editable sin recompilar.
2. **La forma del área de efecto** (cono, cilindro, esfera) queda como decisión de implementación. La spec solo define que tiene un radio y que la calidad decrece desde el centro.
3. **La función de caída** (lineal, cuadrática, exponencial) para distance_factor y precision_factor debe ser configurable o al menos fácil de cambiar.
4. **El método de selección de ataque** (input) está por definir. Implementar como un sistema desacoplado que pueda conectarse a teclas, UI, o cualquier otro input.
5. **IA de enemigos (PvE):** Los enemigos deben usar el mismo sistema de combate. Su comportamiento (qué ataque eligen, cómo se posicionan) se gestiona por separado, pero deben poder tener "personalidades" de combate configurables (agresivo, defensivo, engañoso, etc.).
6. **Networking (PvP):** La resolución del ataque debe considerar latencia. El cálculo de posiciones en el momento del impacto es crítico. Esto es un problema a resolver en la capa de networking, no en la lógica de combate pura.