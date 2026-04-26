/** Apply narrative consequences to NarrativeState and emit renderer-agnostic
 * effects. Port of godot/scripts/main.gd:_on_narrative_consequences (lines
 * 1110-1173) plus _apply_spawn_entity_consequence (lines 1176-1222). */
import type { NarrativeState } from "./narrative-state.js";
import type { Consequence, ConsequenceEffect, Vec3Like } from "./types.js";
import { toTuple } from "./types.js";

export type { ConsequenceEffect };

export interface DispatchOptions {
  /** Player position used as the anchor for "near_player" position hints. */
  playerPosition?: Vec3Like;
  /** Player forward vector for hint resolution. */
  playerForward?: Vec3Like;
  /** Optional entity-id generator for testability. Default: timestamp-based. */
  generateEntityId?: (kind: string) => string;
}

export interface DispatchResult {
  effects: ConsequenceEffect[];
  injectedDialogue: boolean;
}

export function dispatchConsequences(
  state: NarrativeState,
  eventId: string,
  consequences: Consequence[],
  opts: DispatchOptions = {},
): DispatchResult {
  const result: DispatchResult = { effects: [], injectedDialogue: false };

  if (consequences.length === 0) {
    result.effects.push({ kind: "ambient_message", message: "💭 El mundo sigue su curso..." });
    return result;
  }

  for (const c of consequences) {
    if (!c || typeof c !== "object") continue;
    switch (c.type) {
      case "dialogue": {
        if (!c.text) break;
        result.effects.push({
          kind: "show_dialogue",
          speaker: c.speaker || "?",
          text: c.text,
          choices: (c.choices as (string | { text: string })[]) ?? [],
        });
        result.injectedDialogue = true;
        break;
      }
      case "story_update": {
        if (c.delta) {
          state.appendStory(c.delta);
          result.effects.push({ kind: "story_delta", delta: c.delta });
        }
        break;
      }
      case "spawn_entity": {
        const kind = (c.entity_kind ?? "object") as "npc" | "object" | "building";
        const description = c.description ?? "an entity";
        const hint = c.position_hint ?? "near_player";
        const pos = resolvePositionHint(hint, opts.playerPosition, opts.playerForward);
        const entityId =
          opts.generateEntityId?.(kind) ?? `narr_${kind}_${Math.floor(Date.now() / 1000)}`;
        const sceneId = state.world.active_scene_id;
        state.recordEntitySpawned(entityId, kind, sceneId, pos, c, "narrative_request", eventId);
        result.effects.push({
          kind: "spawn_entity",
          entityId,
          entityKind: kind,
          description,
          name: typeof c.name === "string" ? c.name : undefined,
          position: pos,
          data: c as Record<string, unknown>,
          eventId,
        });
        break;
      }
      case "schedule_event": {
        result.effects.push({
          kind: "schedule_event",
          description: c.description ?? "",
          trigger: typeof c.trigger === "string" ? c.trigger : undefined,
        });
        break;
      }
    }
    state.recordNarrativeConsequence(eventId, c);
  }

  return result;
}

const HINT_OFFSETS: Record<string, [number, number, number]> = {
  distant_north: [0, 0, -50],
  distant_south: [0, 0, 50],
  distant_east: [50, 0, 0],
  distant_west: [-50, 0, 0],
};

function resolvePositionHint(
  hint: string,
  playerPos: Vec3Like = [0, 0, 0],
  playerForward: Vec3Like = [0, 0, -1],
): [number, number, number] {
  const base = toTuple(playerPos);
  const fwd = toTuple(playerForward);
  if (hint === "near_player") {
    return [base[0] + fwd[0] * 5, base[1] + fwd[1] * 5, base[2] + fwd[2] * 5];
  }
  const off = HINT_OFFSETS[hint];
  if (off) {
    return [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
  }
  return [base[0] + fwd[0] * 10, base[1] + fwd[1] * 10, base[2] + fwd[2] * 10];
}
