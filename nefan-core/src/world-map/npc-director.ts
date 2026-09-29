/** NpcDirector — high-level NPC movement for the open-world path.
 *
 * NPCs in the open world are EntityRecords in NarrativeState. Their place
 * association lives in `EntityRecord.data`:
 *  - current_place_id : the world-map place the NPC is currently in
 *  - in_transit       : set while travelling between places
 *  - directive        : a standing high-level order (patrol / defend / ...)
 *
 * Travel is narrative-paced: moveNpcToPlace marks the NPC in_transit, and the
 * narrative engine declares arrival via arriveNpc (no game clock).
 */
import type { NarrativeState } from "../narrative/narrative-state.js";
import type { EntityRecord } from "../narrative/types.js";
import { resolvePlaceTarget } from "./place-target.js";
import { sitioParaAparecer, type SueloSolido } from "../simulation/salida-del-solido.js";
import { NPC_RADIUS_M } from "../scene/terrain-collision.js";

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
  /** El `suelo` es OBLIGATORIO y no un parámetro con defecto: `arriveNpc`
   *  teletransporta, y sin preguntar al suelo lo dejaba en el centro del
   *  `anchor.rect`, que en un edificio del plan es macizo (#646). Un test o un
   *  llamante nuevo que lo omitiera volvería a ese centro en verde; así no
   *  compila. */
  constructor(private state: NarrativeState, private suelo: SueloSolido) {}

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
    return { ok: true, info: placeInfo(npc) };
  }

  /** Declare that an in-transit NPC has arrived at its destination.
   *
   *  Si el sim no lo trajo andando (sigue a más de 3 m del centro del lugar),
   *  salta al SITIO LIBRE más cercano a ese centro —el mismo `sitioParaAparecer`
   *  que usa el jugador al viajar—, no al centro crudo: el centro de un
   *  edificio del plan es macizo, y ahí el NPC quedaba enterrado (#618, #646).
   *  Si no hay sitio, falla SIN tocar nada: el candidato crudo es justo el
   *  punto del que no se sale. */
  arriveNpc(npcId: string): NpcDirectorResult {
    const npc = this.state.getEntity(npcId);
    if (!npc) return { ok: false, error: `npc "${npcId}" not found` };
    const transit = readTransit(npc);
    if (!transit) return { ok: false, error: `npc "${npcId}" is not in transit` };
    // Se calcula ANTES de mutar: un fallo no puede dejar medio llegado al NPC.
    let salto: { x: number; z: number } | null = null;
    const target = resolvePlaceTarget(this.state, transit.to);
    if (target && Math.hypot(npc.position[0] - target.x, npc.position[2] - target.z) > 3) {
      salto = sitioParaAparecer(target, NPC_RADIUS_M, this.suelo);
      if (!salto) {
        const nombre = this.state.worldMap.get(transit.to)?.name ?? transit.to;
        return { ok: false, error: `no hay sitio libre para "${npcId}" en "${nombre}"` };
      }
    }
    npc.data.current_place_id = transit.to;
    npc.data.in_transit = null;
    if (salto) npc.position = [salto.x, npc.position[1], salto.z];
    return { ok: true, info: placeInfo(npc) };
  }

  /** Set (or clear, with null) a standing directive for an NPC. */
  setDirective(npcId: string, directive: NpcDirective | null): NpcDirectorResult {
    const npc = this.state.getEntity(npcId);
    if (!npc) return { ok: false, error: `npc "${npcId}" not found` };
    npc.data.directive = directive;
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
