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

/** Lado de una escena por el que se sale/entra. Mismos ejes que el cliente 2D:
 *  east = +x, west = -x, south = +z, north = -z; en `approx_position` [x, y]
 *  del espacio local del parent, y+ = south. */
export type Edge = "north" | "south" | "east" | "west";

export const EDGES: readonly Edge[] = ["north", "south", "east", "west"];

export function isEdge(v: unknown): v is Edge {
  return typeof v === "string" && (EDGES as readonly string[]).includes(v);
}

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
  /** Anclaje al plano continuo de tiles: el place VIVE en el tile (tx,ty),
   *  opcionalmente acotado a un rect [col,row,w,h] en celdas del tile. El
   *  bridge activa el place (y dispara sus triggers) cuando la POSICIÓN del
   *  jugador entra en el anchor. */
  anchor?: { tx: number; ty: number; rect?: [number, number, number, number] };
}

export interface PlaceLink {
  from: string;
  to: string;
  kind: LinkKind;
  travel_hours?: number;
  description?: string;
  bidirectional: boolean;
  /** Lado de la escena del place `from` donde está la salida hacia `to`.
   *  Recorrer el link al revés (bidirectional, estando en `to`) pone la
   *  salida en oppositeEdge(edge) de la escena de `to`. Ausente = sin
   *  orientación conocida (resolveExitEdge puede inferirla por
   *  approx_position). */
  edge?: Edge;
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
