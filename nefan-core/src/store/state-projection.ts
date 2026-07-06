/** Pure projection from NarrativeState.entities (canonical narrative ledger)
 *  to GameStore.enemies (display/combat runtime view).
 *
 *  Why a projection: NarrativeState is the source of truth for "who exists in
 *  the world and where" — it survives save/resume, feeds the LLM context,
 *  and persists across scene reloads. GameStore.enemies is the per-tick view
 *  the HUD/renderer consumes. Centralizing the projection here keeps the
 *  audit invariant (entities ⇒ enemies) in one place. */
import type { EntityRecord } from "../narrative/types.js";
import type { EnemyState } from "../types.js";

export interface ProjectEnemiesOptions {
  /** Restrict the projection to one scene. Pass undefined or "" to include
   *  every enemy entity regardless of scene_id. */
  sceneId?: string;
  /** HP to fall back to when an entity has no `data.health` / `data.combat.health`. */
  defaultHp?: number;
  /** Weapon id to fall back to when neither `data.weapon_id` nor
   *  `data.combat.weapon_id` are set. */
  defaultWeapon?: string;
}

/** Return the projected enemy list for a given set of entities. Only entries
 *  with `type === "enemy"` are projected; NPCs and props are filtered out.
 *
 *  The function reads HP/weapon from two conventions in `entity.data`:
 *    - top-level: `{health, max_health, weapon_id}` (legacy)
 *    - nested:    `{combat: {health, weapon_id}}` (spawn_entity consequences)
 *  Both are accepted so callers don't have to reshape their data before
 *  registering the entity. */
export function projectEnemiesFromEntities(
  entities: EntityRecord[],
  options: ProjectEnemiesOptions = {},
): EnemyState[] {
  const sceneId = options.sceneId ?? "";
  const defaultHp = options.defaultHp ?? 80;
  const defaultWeapon = options.defaultWeapon ?? "unarmed";
  const result: EnemyState[] = [];
  for (const e of entities) {
    if (e.type !== "enemy") continue;
    if (sceneId !== "" && e.scene_id !== sceneId) continue;
    const data = e.data ?? {};
    const combat = isRecord(data.combat) ? data.combat : undefined;

    const hp = pickNumber(data.health, combat?.health, defaultHp);
    const maxHp = pickNumber(data.max_health, combat?.max_health, hp);
    const weapon = pickString(data.weapon_id, combat?.weapon_id, defaultWeapon);

    result.push({
      id: e.id,
      pos: [e.position[0], e.position[1], e.position[2]],
      hp,
      max_hp: maxHp,
      weapon_id: weapon,
      combat_state: "idle",
      alive: hp > 0,
    });
  }
  return result;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickNumber(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return 0;
}

function pickString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c !== "") return c;
  }
  return "";
}
