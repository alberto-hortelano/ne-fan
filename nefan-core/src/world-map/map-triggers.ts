/** MapTriggerEvaluator — fires the narrative triggers attached to world-map
 *  places when the player crosses place boundaries.
 *
 * Triggers are pre-authored by the narrative engine via map_add_trigger. When
 * the player enters / leaves a place, the bridge asks this evaluator which
 * triggers fired and dispatches their consequences. This is event-driven (no
 * per-frame ticking): the events are place transitions, not positions.
 *
 *  - player_entered : fires every time the player enters the place
 *  - first_visit    : fires once; fired_at is stamped so it never re-fires
 *  - player_left    : fires every time the player leaves the place
 *  - player_near    : NOT evaluated here — place-level proximity has no shared
 *                     coordinate basis (Stage 1: places relate by containment,
 *                     no fixed numeric scale). Entity-level proximity is a
 *                     separate, scene-local concern.
 */
import type { NarrativeState } from "../narrative/narrative-state.js";
import type { PlaceTriggerSpec } from "./types.js";

export class MapTriggerEvaluator {
  constructor(private state: NarrativeState) {}

  /** Triggers that fire when the player enters `placeId`. Stamps fired_at on
   *  first_visit triggers so they don't re-fire. */
  evaluateEnter(placeId: string): PlaceTriggerSpec[] {
    const place = this.state.worldMap.get(placeId);
    if (!place) return [];
    const fired: PlaceTriggerSpec[] = [];
    for (const trigger of place.triggers) {
      if (trigger.when.type === "player_entered") {
        fired.push(trigger);
      } else if (trigger.when.type === "first_visit" && !trigger.fired_at) {
        trigger.fired_at = new Date().toISOString();
        fired.push(trigger);
      }
    }
    if (fired.length > 0) this.state.markDirty();
    return fired;
  }

  /** Triggers that fire when the player leaves `placeId`. */
  evaluateLeave(placeId: string): PlaceTriggerSpec[] {
    const place = this.state.worldMap.get(placeId);
    if (!place) return [];
    return place.triggers.filter((t) => t.when.type === "player_left");
  }
}
