/** Plan del tile — API pública.
 *
 *  El motor narrativo declara el tile de forma semántica (`ground` plano +
 *  `volumes` tipados) y el builder greybox lo convierte en primitivas 3D que
 *  la vista fps post-procesa y renderiza con three.js. Consumers: el cliente
 *  (render + atlas de superficies), la colisión declarativa y el bridge
 *  (validación). */

export { buildTileGreyboxSpec, TILE_GREYBOX_VERSION } from "./greybox.js";
export type { TileGreyboxPlan, TileGreyboxSpec } from "./greybox.js";
export { classifyVolume, volumePartsForTile } from "../greybox/volume-prims.js";
export { canonicalGreyboxJson } from "../greybox/common.js";
export type { GreyboxPrimitive, GreyboxLight } from "../greybox/common.js";
export { volumeCollisionGrid, volumeSolidDiscRadiusCells } from "./collision.js";
export { buildFpsTileSpec } from "./fps-spec.js";
export type { FpsTileSpec, FpsTilePlanInput } from "./fps-spec.js";
export { enrichFpsPrims } from "./fps-detail.js";
export {
  parseScatter,
  runScatter,
  buildScatterExclusions,
  MAX_SCATTER_INSTANCES,
} from "./scatter.js";
export type { ScatterZone, ScatterCount, ScatterRunResult, ParseScatterResult } from "./scatter.js";
export { deriveVolumesFromSchema } from "./derive.js";
export type { DeriveInput } from "./derive.js";
export { parseVolumes, VolumesSchema, VolumeSchema, CustomSchema, CustomPartSchema, MAX_VOLUMES, TREE_MAX_S } from "./volumes.js";
export type { Volume, CustomVolume, CustomPart } from "./volumes.js";
export { parseGround, groundHasWater, GroundSchema, GroundFeatureSchema, MAX_GROUND_FEATURES } from "./ground.js";
export type { GroundFeature, GroundPath, GroundArea, GroundWater, GroundDeck } from "./ground.js";
export { groundCollisionGrid, shapeContains, TILE_GRID_DIMS, type CollisionGridDims } from "./ground-collision.js";
export { planCollisionGrid, unionCollisionGrids } from "./plan-collision.js";
export { GROUND_MATERIAL_COLORS, groundFeaturePrims, catmullRomSample } from "./ground-prims.js";
