/** NpcDirector — high-level NPC movement for the open-world path.
 *
 * NPCs in the open world are EntityRecords in NarrativeState. Their place
 * association lives in `EntityRecord.data`:
 *  - current_place_id : the world-map place the NPC is currently in
 *  - in_transit       : set while travelling between places
 *  - directive        : a standing high-level order (patrol / defend / ...)
 *
 * Travel is narrative-paced: moveNpcToPlace marks the NPC in_transit, and the
 * narrative engine declares arrival via arriveNpc (no game clock). The legacy
 * ScenarioRunner / NpcController (game.json beats) is untouched.
 */
import type { NarrativeState } from "../narrative/narrative-state.js";
import type { EntityRecord } from "../narrative/types.js";

export interface NpcTransit {
  /** Destination place id. */
  to: string;
  /** Origin place id ("" if the NPC had no recorded place). */
  from: string;
  /** ISO timestamp the NPC departed. */
  departed_at: string;
}

/** A standing high-level order. `type` is open-ended so verbs like patrol /
 *  defend / attack slot in without a schema change; only the data is stored
 *  here — executing the verb is a separate concern. */
export interface NpcDirective {
  type: string;
  target_place_id?: string;
  [key: string]: unknown;
}

export interface NpcPlaceInfo {
  npc_id: string;
  current_place_id: string | null;
  in_transit: NpcTransit | null;
  directive: NpcDirective | null;
}

export interface NpcDirectorResult {
  ok: boolean;
  error?: string;
  info?: NpcPlaceInfo;
  note?: string;
}

function readTransit(npc: EntityRecord): NpcTransit | null {
  const t = npc.data.in_transit;
  if (t && typeof t === "object" && typeof (t as NpcTransit).to === "string") {
    return t as NpcTransit;
  }
  return null;
}

function readDirective(npc: EntityRecord): NpcDirective | null {
  const d = npc.data.directive;
  if (d && typeof d === "object" && typeof (d as NpcDirective).type === "string") {
    return d as NpcDirective;
  }
  return null;
}

function placeInfo(npc: EntityRecord): NpcPlaceInfo {
  const cur = npc.data.current_place_id;
  return {
    npc_id: npc.id,
    current_place_id: typeof cur === "string" ? cur : null,
    in_transit: readTransit(npc),
    directive: readDirective(npc),
  };
}

export class NpcDirector {
  constructor(private state: NarrativeState) {}

  /** Command an NPC to travel to a place. Marks it in_transit; arrival is
   *  declared later by the narrative engine via arriveNpc. */
  moveNpcToPlace(npcId: string, placeId: string): NpcDirectorResult {
    const npc = this.state.getEntity(npcId);
    if (!npc) return { ok: false, error: `npc "${npcId}" not found` };
    if (!this.state.worldMap.get(placeId)) {
      return { ok: false, error: `place "${placeId}" not found` };
    }
    const current = typeof npc.data.current_place_id === "string" ? npc.data.current_place_id : "";
    if (current === placeId && !readTransit(npc)) {
      return { ok: true, info: placeInfo(npc), note: "npc already at place" };
    }
    npc.data.in_transit = {
      to: placeId,
      from: current,
      departed_at: new Date().toISOString(),
    } satisfies NpcTransit;
    this.state.markDirty();
    return { ok: true, info: placeInfo(npc) };
  }

  /** Declare that an in-transit NPC has arrived at its destination. */
  arriveNpc(npcId: string): NpcDirectorResult {
    const npc = this.state.getEntity(npcId);
    if (!npc) return { ok: false, error: `npc "${npcId}" not found` };
    const transit = readTransit(npc);
    if (!transit) return { ok: false, error: `npc "${npcId}" is not in transit` };
    npc.data.current_place_id = transit.to;
    npc.data.in_transit = null;
    this.state.markDirty();
    return { ok: true, info: placeInfo(npc) };
  }

  /** Set (or clear, with null) a standing directive for an NPC. */
  setDirective(npcId: string, directive: NpcDirective | null): NpcDirectorResult {
    const npc = this.state.getEntity(npcId);
    if (!npc) return { ok: false, error: `npc "${npcId}" not found` };
    npc.data.directive = directive;
    this.state.markDirty();
    return { ok: true, info: placeInfo(npc) };
  }

  getNpcPlace(npcId: string): NpcPlaceInfo | null {
    const npc = this.state.getEntity(npcId);
    return npc ? placeInfo(npc) : null;
  }

  /** Entities currently settled at a place (not in transit). */
  getNpcsAtPlace(placeId: string): NpcPlaceInfo[] {
    return this.state.entities
      .filter((e) => e.data.current_place_id === placeId && !readTransit(e))
      .map(placeInfo);
  }

  getNpcsInTransit(): NpcPlaceInfo[] {
    return this.state.entities
      .filter((e) => readTransit(e) !== null)
      .map(placeInfo);
  }
}
