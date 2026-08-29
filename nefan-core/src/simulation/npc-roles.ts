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

/** Los roles que vive el sistema AMBIENTAL: gente de fondo que deambula,
 *  saluda, huye o interviene, pero que NUNCA es un combatiente del sim.
 *  `Record<AmbientRole, …>` sobre los presets obliga a que la tabla los cubra
 *  exactamente. Orden = el histórico del enum del contrato (minimiza el diff
 *  de gen:contract). */
export const AMBIENT_ROLES = ["peasant", "guard", "villager", "merchant"] as const;
export type AmbientRole = (typeof AMBIENT_ROLES)[number];

/** Los roles que declaran HOSTILIDAD. Un NPC con uno de estos no lo mueve la
 *  vida ambiental: lo mueve la IA de combate del sim, y sus números —vida,
 *  arma, personalidad— los deriva el core (`combatForHostileRole`), no el
 *  modelo. El motor declara la INTENCIÓN; el balance es reproducible.
 *
 *  Es UN valor y no una lista de oficios («bandido», «lobo», «cultista»)
 *  por la misma razón que `role` no es el oficio en el lado ambiental: lo
 *  que se ve —quién es y qué aspecto tiene— va en `name` y `description`. */
export const HOSTILE_ROLES = ["hostile"] as const;
export type HostileRole = (typeof HOSTILE_ROLES)[number];

/** Vocabulario COMPLETO de roles — FUENTE ÚNICA. El zod del SoT
 *  (SpawnEntityConsequence.role), el enum copiado de `generate_scene.json`, el
 *  espejo Python y la prosa de narrative-mcp derivan de esta lista. */
export const NPC_ROLES = [...AMBIENT_ROLES, ...HOSTILE_ROLES] as const;
export type NpcRole = (typeof NPC_ROLES)[number];

/** ¿Declara este `role` hostilidad? Lo preguntan las tres fronteras que no
 *  pueden equivocarse: `formatDToWorld` y `dispatchConsequences` (para
 *  producir el bloque `combat`) y `npcSync` (para NO meter al combatiente en
 *  la vida ambiental, que mutaría su posición en paralelo con el sim). */
export function isHostileRole(role: unknown): role is HostileRole {
  return typeof role === "string" && (HOSTILE_ROLES as readonly string[]).includes(role);
}

/** Velocidades por debajo del jugador (walk 1.9 / sprint 3.8 en
 *  combat_config) para que los NPC se lean como fondo, no como amenaza.
 *
 *  `Record<AmbientRole, …>` y no `Record<NpcRole, …>` a propósito: el sistema
 *  ambiental no puede servir a un hostil ni por accidente, y eso lo dice el
 *  COMPILADOR — escribir aquí una entrada `hostile` no compila, y `npcSync`
 *  tampoco podría pedirla. */
export const NPC_ROLE_PRESETS: Record<AmbientRole, NpcRoleParams> = {
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
  let preset = (NPC_ROLE_PRESETS as Record<string, NpcRoleParams>)[role];
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
