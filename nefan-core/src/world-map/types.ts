/** Multi-level world map shared across narrative engine and clients.
 *
 * Three levels collapse into a single Place hierarchy:
 *  - HIGH  : world  > region > settlement | landmark
 *  - MID   : site (children of a settlement)
 *  - LOW   : interior (children of a site, or a scene materialization)
 *
 * Levels relate by containment (parent_id), not by a fixed numeric scale.
 * approx_position is in the parent's local 2D space and is only used for layout.
 */
import type { Consequence } from "../narrative/types.js";

export const WORLD_MAP_SCHEMA_VERSION = 1;

export type PlaceKind =
  | "world"
  | "region"
  | "settlement"
  | "landmark"
  | "site"
  | "interior";

export type LinkKind =
  | "road"
  | "river"
  | "path"
  | "sea_route"
  | "passage"
  | "tunnel"
  | "door";

export type TriggerWhen =
  | { type: "player_entered" }
  | { type: "player_left" }
  | { type: "player_near"; radius: number }
  | { type: "first_visit" };

export interface PlaceTriggerSpec {
  id: string;
  when: TriggerWhen;
  consequences: Consequence[];
  fired_at?: string;
}

export interface Place {
  id: string;
  kind: PlaceKind;
  parent_id: string | null;
  name: string;
  description: string;
  approx_position?: [number, number];
  approx_radius?: number;
  attrs: Record<string, unknown>;
  realized_scene_id?: string;
  triggers: PlaceTriggerSpec[];
  introduced_event_id?: string;
  visited: boolean;
}

export interface PlaceLink {
  from: string;
  to: string;
  kind: LinkKind;
  travel_hours?: number;
  description?: string;
  bidirectional: boolean;
}

export interface WorldMap {
  schema_version: number;
  places: Record<string, Place>;
  links: PlaceLink[];
  root_id: string;
  active_place_id: string;
}

export const HIGH_LEVEL_KINDS: ReadonlySet<PlaceKind> = new Set([
  "region",
  "settlement",
  "landmark",
]);

export const MID_LEVEL_KINDS: ReadonlySet<PlaceKind> = new Set(["site"]);

export const LOW_LEVEL_KINDS: ReadonlySet<PlaceKind> = new Set(["interior"]);
