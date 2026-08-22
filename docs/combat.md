# Sistema de Combate Cuerpo a Cuerpo — Especificación Técnica

## Plataforma
- **Implementación:** TypeScript en `nefan-core/src/combat/` — lógica canónica; el cliente solo pinta
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

Los tipos canónicos viven en `nefan-core/src/types.ts`; aquí van comentados campo a campo.
El `id` no es un campo: es la clave del `Record<string, AttackType>` de `combat_config.json`.

```ts
interface AttackType {
  display_name: string;

  // Timing
  wind_up_time: number;          // Segundos desde click hasta impacto (ej: 0.15 - 0.8)

  // Distancia
  optimal_distance: number;      // Distancia ideal al enemigo en el momento del impacto
  distance_tolerance: number;    // Rango de tolerancia alrededor de la distancia óptima

  // Área de efecto
  area_radius: number;           // Radio del área de efecto (más pequeño = más difícil)

  // Daño
  base_damage: number;           // Daño base antes de multiplicadores de calidad

  // Defensa (solo relevante para "defensivo")
  damage_reduction: number;      // Factor de reducción de daño recibido (0.0 - 1.0)
}
```

### Valores iniciales sugeridos (ajustar mediante playtesting)

```json
{
  "attack_types": {
    "quick": {
      "wind_up_time": 0.15,
      "optimal_distance": 1.5,
      "distance_tolerance": 1.0,
      "area_radius": 1.2,
      "base_damage": 15.0,
      "damage_reduction": 0.0
    },
    "heavy": {
      "wind_up_time": 0.7,
      "optimal_distance": 2.0,
      "distance_tolerance": 1.5,
      "area_radius": 2.5,
      "base_damage": 45.0,
      "damage_reduction": 0.0
    },
    "medium": {
      "wind_up_time": 0.4,
      "optimal_distance": 1.8,
      "distance_tolerance": 1.2,
      "area_radius": 1.8,
      "base_damage": 25.0,
      "damage_reduction": 0.0
    },
    "defensive": {
      "wind_up_time": 0.3,
      "optimal_distance": 1.2,
      "distance_tolerance": 1.0,
      "area_radius": 1.5,
      "base_damage": 18.0,
      "damage_reduction": 0.5
    },
    "precise": {
      "wind_up_time": 0.45,
      "optimal_distance": 1.6,
      "distance_tolerance": 0.8,
      "area_radius": 0.7,
      "base_damage": 40.0,
      "damage_reduction": 0.0
    }
  }
}
```

---

## Armas

Las armas aplican modificadores multiplicativos y/o aditivos sobre los parámetros del tipo de ataque.

```ts
interface Weapon {
  display_name: string;

  // Modificadores por tipo de ataque, indexados por id de ataque
  modifiers: Record<string, WeaponModifiers>;

  // Modificador global de wind-up (se aplica a todos los tipos)
  wind_up_modifier: number;      // Multiplicador (1.0 = sin cambio, 0.8 = 20% más rápido)
}
```

```ts
interface WeaponModifiers {
  damage_multiplier?: number;        // 1.0 = sin cambio
  optimal_distance_offset?: number;  // Sumado a la distancia óptima del ataque
  area_radius_multiplier?: number;   // 1.0 = sin cambio
  wind_up_multiplier?: number;       // 1.0 = sin cambio (se multiplica con el global)
}
```

### Ejemplo: espada corta vs martillo de guerra

El `wind_up_modifier` global marca el carácter del arma: la espada es ligera (0.85, todos los ataques un poco más rápidos) y el martillo pesado (1.2, todos más lentos).

```json
{
  "weapons": {
    "short_sword": {
      "wind_up_modifier": 0.85,
      "modifiers": {
        "quick":     { "damage_multiplier": 1.3, "optimal_distance_offset": -0.2, "area_radius_multiplier": 1.0, "wind_up_multiplier": 0.9 },
        "heavy":     { "damage_multiplier": 0.7, "optimal_distance_offset": -0.3, "area_radius_multiplier": 0.8, "wind_up_multiplier": 1.0 },
        "medium":    { "damage_multiplier": 1.1, "optimal_distance_offset": -0.1, "area_radius_multiplier": 1.0, "wind_up_multiplier": 0.95 },
        "defensive": { "damage_multiplier": 1.0, "optimal_distance_offset": -0.2, "area_radius_multiplier": 1.0, "wind_up_multiplier": 0.9 },
        "precise":   { "damage_multiplier": 1.2, "optimal_distance_offset": -0.1, "area_radius_multiplier": 1.1, "wind_up_multiplier": 0.95 }
      }
    },
    "war_hammer": {
      "wind_up_modifier": 1.2,
      "modifiers": {
        "quick":     { "damage_multiplier": 0.8, "optimal_distance_offset": 0.3, "area_radius_multiplier": 1.2, "wind_up_multiplier": 1.2 },
        "heavy":     { "damage_multiplier": 1.4, "optimal_distance_offset": 0.5, "area_radius_multiplier": 1.3, "wind_up_multiplier": 1.0 },
        "medium":    { "damage_multiplier": 1.1, "optimal_distance_offset": 0.2, "area_radius_multiplier": 1.1, "wind_up_multiplier": 1.1 },
        "defensive": { "damage_multiplier": 0.9, "optimal_distance_offset": 0.2, "area_radius_multiplier": 1.1, "wind_up_multiplier": 1.1 },
        "precise":   { "damage_multiplier": 0.7, "optimal_distance_offset": 0.3, "area_radius_multiplier": 0.9, "wind_up_multiplier": 1.15 }
      }
    }
  }
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

```ts
function calculateDistanceFactor(
  actualDistance: number,
  optimalDistance: number,  // Ya modificado por arma
  tolerance: number,
): number {
  const deviation = Math.abs(actualDistance - optimalDistance);
  if (deviation >= tolerance) return 0.0;  // Fuera de rango, el ataque falla
  // 1.0 en distancia perfecta, decrece linealmente hasta 0.0 en el borde
  return 1.0 - deviation / tolerance;
}
```

> NOTA: La función de caída (lineal, cuadrática, etc.) es ajustable. Lineal como punto de partida.

### Factor Precisión (área de efecto)

Mide lo cerca que está el enemigo del centro del área de efecto en el momento del impacto.

```ts
function calculatePrecisionFactor(
  enemyOffsetFromCenter: number,  // Distancia del enemigo al centro del área
  areaRadius: number,             // Ya modificado por arma
): number {
  if (enemyOffsetFromCenter >= areaRadius) return 0.0;  // Fuera del área, no impacta
  return 1.0 - enemyOffsetFromCenter / areaRadius;
}
```

> NOTA: `enemy_offset_from_center` se mide como la distancia perpendicular del enemigo respecto al eje del ataque (en el plano relevante). La implementación exacta depende de si el área es un cono, un cilindro, un hemisferio, etc. Esto queda como decisión de implementación.

### Factor Táctico (ventaja por tipo de ataque)

Modificador basado en la interacción entre el tipo de ataque del atacante y la acción actual del defensor.

```ts
// Matriz de ventajas: tacticalMatrix[mi_ataque][accion_enemigo] -> number
// Valores > 1.0 = ventaja, < 1.0 = desventaja, 1.0 = neutral
const tacticalMatrix: Record<string, Record<string, number>> = {
  quick: {
    quick: 1.0,
    heavy: 1.3,       // Rápido castiga el wind-up largo del fuerte
    medium: 1.0,
    defensive: 0.7,   // Defensivo para ataques rápidos fácilmente
    precise: 1.1,
    moving: 1.0,      // Enemigo solo moviéndose
    idle: 1.1,        // Enemigo quieto
  },
  heavy: {
    quick: 0.8,
    heavy: 1.0,
    medium: 1.1,
    defensive: 1.3,   // Fuerte rompe la defensa
    precise: 1.0,
    moving: 0.9,
    idle: 1.2,
  },
  medium: {
    quick: 1.0,
    heavy: 0.9,
    medium: 1.0,
    defensive: 1.0,
    precise: 1.1,
    moving: 1.0,
    idle: 1.1,
  },
  defensive: {
    quick: 1.2,
    heavy: 0.7,       // Fuerte rompe defensa
    medium: 1.0,
    defensive: 0.8,
    precise: 0.9,
    moving: 0.8,
    idle: 0.9,
  },
  precise: {
    quick: 0.9,
    heavy: 1.0,
    medium: 0.9,
    defensive: 1.1,
    precise: 1.0,
    moving: 0.7,      // Difícil acertar un preciso a un enemigo en movimiento
    idle: 1.3,        // Preciso castiga mucho al que está quieto
  },
};
```

> NOTA: Los valores de la matriz son iniciales y deben ajustarse mediante playtesting. La lógica del sistema debe permitir editar estos valores fácilmente (viven como `tactical_matrix` en el archivo de configuración, no en código).

### Reducción de Daño (Defensivo)

Si el defensor está ejecutando un ataque de tipo **defensivo**, el daño recibido se reduce:

```ts
let finalDamage = attackQuality;  // Resultado de la fórmula de calidad
if (defenderCurrentAttackType === "defensive") {
  const reduction = defenderWeaponModifiedDamageReduction;
  finalDamage *= 1.0 - reduction;
}
```

---

## Fórmula Completa Paso a Paso

```ts
function resolveAttack(
  attacker: Combatant,
  defender: Combatant,
  attackTypeId: string,
  attackType: AttackType,
  weapon: Weapon,
): number {
  const mod = weapon.modifiers[attackTypeId];

  // 1. Parámetros efectivos (ataque + arma)
  const effectiveOptimalDistance = attackType.optimal_distance + mod.optimal_distance_offset;
  const effectiveAreaRadius = attackType.area_radius * mod.area_radius_multiplier;
  const effectiveBaseDamage = attackType.base_damage * mod.damage_multiplier;

  // 2. Medir estado actual en el momento del impacto
  const actualDistance = distance(attacker.position, defender.position);
  const offsetFromCenter = calculateOffsetFromAttackCenter(attacker, defender);
  const defenderAction = getCurrentAction(defender);  // "quick", "heavy", ..., "moving", "idle"

  // 3. Factores de calidad
  const distanceFactor = calculateDistanceFactor(
    actualDistance, effectiveOptimalDistance, attackType.distance_tolerance,
  );
  const precisionFactor = calculatePrecisionFactor(
    offsetFromCenter, effectiveAreaRadius,
  );
  const tacticalFactor = tacticalMatrix[attackTypeId][defenderAction];

  // 4. Calidad del ataque
  let attackQuality = distanceFactor * precisionFactor * tacticalFactor * effectiveBaseDamage;

  // 5. Reducción defensiva del defensor
  if (defenderAction === "defensive") {
    const defAttackType = config.attack_types["defensive"];
    const effectiveReduction = defAttackType.damage_reduction;  // Arma puede modificar esto si se añade
    attackQuality *= 1.0 - effectiveReduction;
  }

  return attackQuality;
}
```

---

## Resolución Simultánea

Cuando dos ataques se resuelven en el mismo frame (o dentro de una ventana de simultaneidad configurable):

```ts
const SIMULTANEOUS_WINDOW = 0.05;  // Segundos de margen para considerar simultáneo

// Ambos ataques se resuelven independientemente.
// Cada combatiente recibe el daño calculado por el ataque del otro.
// No hay "clash" ni cancelación mutua.
```

---

## Estados del Combatiente

Un combatiente puede estar en uno de estos estados en cualquier momento:

```ts
type CombatState =
  | "idle"         // Sin acción
  | "moving"       // Moviéndose sin atacar
  | "winding_up"   // En wind-up de un ataque (el tipo de ataque se conoce)
  | "attacking";   // Frame(s) de impacto
```

Para el cálculo del factor táctico, el `defenderAction` se mapea así:
- `"idle"` → "idle"
- `"moving"` → "moving"
- `"winding_up"` → el tipo de ataque que está preparando (ej: "heavy")
- `"attacking"` → el tipo de ataque que está ejecutando

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

1. **Todos los valores numéricos son placeholder.** El sistema debe diseñarse para que sean fácilmente configurables, desde un archivo JSON/config editable sin recompilar (`nefan-core/data/combat_config.json`).
2. **La forma del área de efecto** (cono, cilindro, esfera) queda como decisión de implementación. La spec solo define que tiene un radio y que la calidad decrece desde el centro.
3. **La función de caída** (lineal, cuadrática, exponencial) para distance_factor y precision_factor debe ser configurable o al menos fácil de cambiar.
4. **El método de selección de ataque** (input) está por definir. Implementar como un sistema desacoplado que pueda conectarse a teclas, UI, o cualquier otro input.
5. **IA de enemigos (PvE):** Los enemigos deben usar el mismo sistema de combate. Su comportamiento (qué ataque eligen, cómo se posicionan) se gestiona por separado, pero deben poder tener "personalidades" de combate configurables (agresivo, defensivo, engañoso, etc.).
6. **Networking (PvP):** La resolución del ataque debe considerar latencia. El cálculo de posiciones en el momento del impacto es crítico. Esto es un problema a resolver en la capa de networking, no en la lógica de combate pura.