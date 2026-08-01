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
  STAGE_COMPOSER_VERSION,
  type ComposedStage,
  type ComposedStageExit,
  type StageLayer,
  type StageScenePlan,
} from "./compose.js";
export { stagePlanFromScene } from "./plan.js";
export {
  peelPlanFor,
  paintableVolumeLayers,
  buildPeelPrompt,
  STAGE_PEEL_VERSION,
  type PeelPlan,
  type PeelStep,
} from "./peel.js";
export { railCamera, type RailCameraOpts } from "./camera.js";
export { exitZoneAt, spawnPointForEntry } from "./entry.js";
export { fourthWallAlpha, FOURTH_WALL_FADE_DEFAULTS, type FourthWallFadeOpts } from "./fade.js";
