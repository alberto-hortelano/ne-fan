/** API pública del módulo proscenio (stage). */

export {
  parseStage,
  StageBlockSchema,
  StageExitSchema,
  MAX_STAGE_EXITS,
  type StageBlock,
  type StageExit,
  type ParseStageResult,
} from "./schema.js";
export {
  scaleAt,
  stageToView,
  viewToStage,
  worldToStage,
  stageToWorld,
  type StageProjParams,
  type StageBounds,
} from "./projection.js";
export {
  composeStage,
  volumeFootprintCells,
  STAGE_COMPOSER_VERSION,
  type ComposedStage,
  type ComposedStageExit,
  type StageLayer,
  type StageScenePlan,
} from "./compose.js";
export { stageToViewAt } from "./projection.js";
export {
  buildGreyboxSpec,
  expectedElementsFromGreybox,
  canonicalGreyboxJson,
  volumeHeightM,
  STAGE_GREYBOX_VERSION,
  GREYBOX_EYE_M,
  type GreyboxSpec,
  type GreyboxPrimitive,
  type GreyboxLight,
  type GreyboxCamera,
  type GreyboxManifestItem,
} from "./greybox.js";
export { stagePlanFromScene } from "./plan.js";
export {
  peelPlanFor,
  paintableVolumeLayers,
  buildPeelPrompt,
  STAGE_PEEL_VERSION,
  type PeelPlan,
  type PeelStep,
} from "./peel.js";
export {
  expectedElementsFor,
  pxToView,
  calibratedProjection,
  contactToPose,
  footprintFromContact,
  matchInventory,
  peelStepsFromInventory,
  collisionGridFromCutouts,
  reconstructionDiff,
  declaredLayerHeightM,
  fitSpriteScale,
  spriteScaleAt,
  SPRITE_SCALE_IDENTITY,
  type SpriteScaleModel,
  type SpriteScalePoint,
  STAGE_RENDER_SIZE,
  RECONSTRUCTION_DEFAULTS,
  type StageExpectedElement,
  type StageReviewItem,
  type PaintedFloor,
  type CutoutPose,
  type InventoryMatch,
  type InventoryPeelStep,
  type CollisionCutout,
  type StageCollisionResult,
  type ReconstructionReport,
} from "./segments.js";
export {
  frameStage,
  parallaxPanX,
  viewToScreen,
  bandPlanFor,
  FRAMING_DEFAULTS,
  BAND_PLAN_DEFAULTS,
  type StageFraming,
  type FramingOpts,
  type ViewBoxRect,
  type GroundBand,
  type BandPlan,
  type BandPlanOpts,
} from "./framing.js";
export { railCamera, type RailCameraOpts } from "./camera.js";
export { exitZoneAt, spawnPointForEntry } from "./entry.js";
export { fourthWallAlpha, FOURTH_WALL_FADE_DEFAULTS, type FourthWallFadeOpts } from "./fade.js";
