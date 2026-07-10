/** Parámetros de comportamiento ambiental por rol de NPC.
 *
 *  El motor narrativo asigna `data.role` al spawnear (spawn_entity) y puede
 *  afinar valores concretos vía `data.behavior` (overrides parciales). Rol
 *  desconocido → warning una vez y preset `villager` (el LLM puede inventar
 *  roles; degradación esperable, no fail). */

export interface NpcRoleParams {
  role: string;
  /** Radio del micro-wander alrededor del punto de spawn (m). */
  wander_radius: number;
  walk_speed: number;
  run_speed: number;
  /** Distancia a la que el NPC se para y encara al jugador (m). */
  greet_radius: number;
  /** Distancia a la que el NPC percibe una pelea (m). */
  perception_radius: number;
  flees_from_combat: boolean;
  intervenes_in_combat: boolean;
  /** Hueco v2 (facciones): los guardias aún no entran al combate real —
   *  findNearestTarget no distingue bandos y atacarían al jugador. */
  joins_combat: false;
}

/** Velocidades por debajo del jugador (walk 1.9 / sprint 3.8 en
 *  combat_config) para que los NPC se lean como fondo, no como amenaza. */
export const NPC_ROLE_PRESETS: Record<string, NpcRoleParams> = {
  villager: {
    role: "villager",
    wander_radius: 6,
    walk_speed: 1.2,
    run_speed: 3.0,
    greet_radius: 2.5,
    perception_radius: 12,
    flees_from_combat: true,
    intervenes_in_combat: false,
    joins_combat: false,
  },
  peasant: {
    role: "peasant",
    wander_radius: 5,
    walk_speed: 1.1,
    run_speed: 3.2,
    greet_radius: 2.5,
    perception_radius: 14,
    flees_from_combat: true,
    intervenes_in_combat: false,
    joins_combat: false,
  },
  guard: {
    role: "guard",
    wander_radius: 4,
    walk_speed: 1.3,
    run_speed: 3.4,
    greet_radius: 2.5,
    perception_radius: 16,
    flees_from_combat: false,
    intervenes_in_combat: true,
    joins_combat: false,
  },
  merchant: {
    role: "merchant",
    wander_radius: 3,
    walk_speed: 1.0,
    run_speed: 2.8,
    greet_radius: 3.0,
    perception_radius: 12,
    flees_from_combat: true,
    intervenes_in_combat: false,
    joins_combat: false,
  },
};

const warnedRoles = new Set<string>();

const NUMERIC_KEYS = [
  "wander_radius", "walk_speed", "run_speed", "greet_radius", "perception_radius",
] as const;
const BOOLEAN_KEYS = ["flees_from_combat", "intervenes_in_combat"] as const;

/** Resuelve los parámetros de comportamiento desde `EntityRecord.data`:
 *  preset de `data.role` (default villager) + overrides de `data.behavior`. */
export function resolveRoleParams(data: Record<string, unknown>): NpcRoleParams {
  const role = typeof data.role === "string" && data.role ? data.role : "villager";
  let preset = NPC_ROLE_PRESETS[role];
  if (!preset) {
    if (!warnedRoles.has(role)) {
      warnedRoles.add(role);
      console.warn(
        `[npc-roles] rol desconocido "${role}" — usando preset villager ` +
        `(disponibles: ${Object.keys(NPC_ROLE_PRESETS).join(", ")})`,
      );
    }
    preset = { ...NPC_ROLE_PRESETS.villager, role };
  }
  const params: NpcRoleParams = { ...preset };

  const behavior = data.behavior;
  if (behavior && typeof behavior === "object") {
    const b = behavior as Record<string, unknown>;
    for (const key of NUMERIC_KEYS) {
      const v = b[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) params[key] = v;
      else if (v !== undefined) {
        console.warn(`[npc-roles] behavior.${key} inválido (${String(v)}) — ignorado`);
      }
    }
    for (const key of BOOLEAN_KEYS) {
      const v = b[key];
      if (typeof v === "boolean") params[key] = v;
      else if (v !== undefined) {
        console.warn(`[npc-roles] behavior.${key} inválido (${String(v)}) — ignorado`);
      }
    }
  }
  return params;
}
