/** Plan del tile oblicuo — API pública.
 *
 *  El motor narrativo declara el tile de forma semántica (`ground` plano +
 *  `volumes` tipados) y el builder greybox lo convierte en una escena 3D que
 *  el cliente renderiza con three.js en la oblicua única del formato 2D
 *  (suelo identidad + cizalla KX en la altura). Consumers: el cliente 2D
 *  (render + occluders + expected_elements), la colisión declarativa y el
 *  bridge (validación). */

export {
  buildTileGreyboxSpec,
  TILE_GREYBOX_VERSION,
  TILE_GREYBOX_PX_PER_CELL,
} from "./greybox.js";
export type {
  TileGreyboxPlan,
  TileGreyboxSpec,
  TileGreyboxCamera,
  TileOccluderSpec,
  ComposedElement,
} from "./greybox.js";
export { CANOPY_OPACITY, classifyVolume, volumePartsForTile } from "../greybox/volume-prims.js";
export { canonicalGreyboxJson } from "../greybox/common.js";
export type { GreyboxPrimitive, GreyboxLight } from "../greybox/common.js";
export { volumeCollisionGrid } from "./collision.js";
export { deriveVolumesFromSchema } from "./derive.js";
export type { DeriveInput } from "./derive.js";
export { PROJECTION, OBLIQUE_KX, OBLIQUE_KY } from "./projection.js";
export type { Projection } from "./projection.js";
export { parseVolumes, VolumesSchema, VolumeSchema, MAX_VOLUMES, TREE_MAX_S } from "./volumes.js";
export type { Volume } from "./volumes.js";
export { parseGround, groundHasWater, GroundSchema, GroundFeatureSchema, MAX_GROUND_FEATURES } from "./ground.js";
export type { GroundFeature, GroundPath, GroundArea, GroundWater, GroundDeck } from "./ground.js";
export { groundCollisionGrid } from "./ground-collision.js";
