/** WorldMapManager — mutations and queries over a plain WorldMap object.
 *
 * Holds a reference to the underlying WorldMap (no copy) so callers like
 * NarrativeState can persist the same object directly via JSON.
 */
import {
  HIGH_LEVEL_KINDS,
  WORLD_MAP_SCHEMA_VERSION,
  type Edge,
  type Place,
  type PlaceLink,
  type PlaceKind,
  type PlaceTriggerSpec,
  type WorldMap,
} from "./types.js";
import { oppositeEdge } from "./edges.js";

export interface PlaceUpsert {
  id: string;
  kind: PlaceKind;
  parent_id: string | null;
  name: string;
  description?: string;
  approx_position?: [number, number];
  approx_radius?: number;
  attrs?: Record<string, unknown>;
  realized_scene_id?: string;
  introduced_event_id?: string;
  triggers?: PlaceTriggerSpec[];
  visited?: boolean;
  anchor?: Place["anchor"];
}

export interface LinkSpec {
  from: string;
  to: string;
  kind: PlaceLink["kind"];
  travel_hours?: number;
  description?: string;
  bidirectional?: boolean;
  /** Lado de la escena de `from` donde está la salida (ver PlaceLink.edge). */
  edge?: Edge;
}

export class WorldMapManager {
  constructor(public map: WorldMap) {}

  // ── Construction ──

  /** Build an empty WorldMap with a single root place of kind="world". */
  static createEmpty(rootName: string = "Mundo"): WorldMap {
    const root: Place = {
      id: "world",
      kind: "world",
      parent_id: null,
      name: rootName,
      description: "",
      attrs: {},
      triggers: [],
      visited: false,
    };
    return {
      schema_version: WORLD_MAP_SCHEMA_VERSION,
      places: { [root.id]: root },
      links: [],
      root_id: root.id,
      active_place_id: root.id,
    };
  }

  // ── Mutations ──

  upsertPlace(spec: PlaceUpsert): Place {
    if (spec.parent_id !== null && !this.map.places[spec.parent_id]) {
      throw new Error(`upsertPlace: parent_id "${spec.parent_id}" not found`);
    }
    const existing = this.map.places[spec.id];
    const place: Place = {
      id: spec.id,
      kind: spec.kind,
      parent_id: spec.parent_id,
      name: spec.name,
      description: spec.description ?? existing?.description ?? "",
      approx_position: spec.approx_position ?? existing?.approx_position,
      approx_radius: spec.approx_radius ?? existing?.approx_radius,
      attrs: spec.attrs ?? existing?.attrs ?? {},
      realized_scene_id: spec.realized_scene_id ?? existing?.realized_scene_id,
      triggers: spec.triggers ?? existing?.triggers ?? [],
      introduced_event_id: spec.introduced_event_id ?? existing?.introduced_event_id,
      visited: spec.visited ?? existing?.visited ?? false,
      anchor: spec.anchor ?? existing?.anchor,
    };
    this.map.places[place.id] = place;
    return place;
  }

  removePlace(id: string): boolean {
    if (id === this.map.root_id) {
      throw new Error("removePlace: cannot remove root");
    }
    if (!this.map.places[id]) return false;
    const children = this.getChildren(id);
    if (children.length > 0) {
      throw new Error(
        `removePlace: "${id}" has ${children.length} children; remove them first`,
      );
    }
    delete this.map.places[id];
    this.map.links = this.map.links.filter(
      (link) => link.from !== id && link.to !== id,
    );
    if (this.map.active_place_id === id) {
      this.map.active_place_id = this.map.root_id;
    }
    return true;
  }

  addLink(spec: LinkSpec): PlaceLink {
    if (!this.map.places[spec.from]) {
      throw new Error(`addLink: from "${spec.from}" not found`);
    }
    if (!this.map.places[spec.to]) {
      throw new Error(`addLink: to "${spec.to}" not found`);
    }
    if (spec.from === spec.to) {
      throw new Error("addLink: self-links not allowed");
    }
    const existing = this.findLink(spec.from, spec.to);
    if (existing) {
      existing.kind = spec.kind;
      existing.travel_hours = spec.travel_hours;
      existing.description = spec.description;
      existing.bidirectional = spec.bidirectional ?? existing.bidirectional;
      if (spec.edge) {
        // spec.edge es relativo a spec.from; findLink puede haber encontrado
        // el par almacenado en la orientación INVERSA — sin esta corrección
        // un update invertido corrompería la dirección.
        existing.edge = existing.from === spec.from ? spec.edge : oppositeEdge(spec.edge);
      }
      return existing;
    }
    const link: PlaceLink = {
      from: spec.from,
      to: spec.to,
      kind: spec.kind,
      travel_hours: spec.travel_hours,
      description: spec.description,
      bidirectional: spec.bidirectional ?? true,
      edge: spec.edge,
    };
    this.map.links.push(link);
    return link;
  }

  removeLink(from: string, to: string): boolean {
    const before = this.map.links.length;
    this.map.links = this.map.links.filter(
      (l) => !linkMatches(l, from, to),
    );
    return this.map.links.length < before;
  }

  setActivePlace(id: string): void {
    if (!this.map.places[id]) {
      throw new Error(`setActivePlace: "${id}" not found`);
    }
    this.map.active_place_id = id;
  }

  markVisited(id: string): void {
    const place = this.map.places[id];
    if (!place) return;
    place.visited = true;
  }

  attachRealizedScene(placeId: string, sceneId: string): void {
    const place = this.map.places[placeId];
    if (!place) {
      throw new Error(`attachRealizedScene: place "${placeId}" not found`);
    }
    place.realized_scene_id = sceneId;
  }

  addTrigger(placeId: string, trigger: PlaceTriggerSpec): void {
    const place = this.map.places[placeId];
    if (!place) {
      throw new Error(`addTrigger: place "${placeId}" not found`);
    }
    const idx = place.triggers.findIndex((t) => t.id === trigger.id);
    if (idx >= 0) place.triggers[idx] = trigger;
    else place.triggers.push(trigger);
  }

  // ── Queries ──

  get(id: string): Place | undefined {
    return this.map.places[id];
  }

  getChildren(parentId: string): Place[] {
    return Object.values(this.map.places).filter((p) => p.parent_id === parentId);
  }

  /** Walk up parent chain, returning [self, parent, ..., root]. */
  getAncestors(id: string): Place[] {
    const chain: Place[] = [];
    let cur: Place | undefined = this.map.places[id];
    while (cur) {
      chain.push(cur);
      cur = cur.parent_id ? this.map.places[cur.parent_id] : undefined;
    }
    return chain;
  }

  getByKind(kind: PlaceKind): Place[] {
    return Object.values(this.map.places).filter((p) => p.kind === kind);
  }

  getHighLevel(): Place[] {
    return Object.values(this.map.places).filter((p) => HIGH_LEVEL_KINDS.has(p.kind));
  }

  /** Outgoing links from a place (includes incoming if link is bidirectional). */
  getOutgoingLinks(placeId: string): PlaceLink[] {
    return this.map.links.filter(
      (l) => l.from === placeId || (l.bidirectional && l.to === placeId),
    );
  }

  /** BFS shortest path (by hop count) over the links graph. */
  findPath(fromId: string, toId: string): string[] | null {
    if (fromId === toId) return [fromId];
    if (!this.map.places[fromId] || !this.map.places[toId]) return null;
    const visited = new Set<string>([fromId]);
    const parent = new Map<string, string>();
    const queue: string[] = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const link of this.getOutgoingLinks(cur)) {
        const next = link.from === cur ? link.to : link.from;
        if (visited.has(next)) continue;
        visited.add(next);
        parent.set(next, cur);
        if (next === toId) {
          const path: string[] = [toId];
          let node = toId;
          while (parent.has(node)) {
            node = parent.get(node)!;
            path.unshift(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return null;
  }

  // ── Persistence ──

  serialize(): WorldMap {
    return this.map;
  }

  static fromSerialized(data: WorldMap): WorldMapManager {
    return new WorldMapManager(data);
  }

  private findLink(from: string, to: string): PlaceLink | undefined {
    return this.map.links.find((l) => linkMatches(l, from, to));
  }
}

function linkMatches(link: PlaceLink, from: string, to: string): boolean {
  if (link.from === from && link.to === to) return true;
  if (link.bidirectional && link.from === to && link.to === from) return true;
  return false;
}
