export * from "./types.js";
export * from "./vec3.js";
export * from "./combat/combat-resolver.js";
export * from "./combat/combat-data.js";
export * as Combatant from "./combat/combatant.js";
export { CombatManager } from "./combat/combat-manager.js";
export { EnemyAI, SeededRng } from "./combat/enemy-ai.js";
export { GameStore, createInitialState } from "./store/game-store.js";
export { GameSimulation } from "./simulation/game-loop.js";
export type { FrameInputs, FrameResult } from "./simulation/game-loop.js";
export { ROOMS, getRooms, getRoomsByCategory, getRoomEntry } from "./dev/room-registry.js";
export type { RoomEntry } from "./dev/room-registry.js";
export { createDevState } from "./dev/dev-state.js";
export type { DevState } from "./dev/dev-state.js";
export { AnimationController } from "./animation/animation-controller.js";
export { loadAnimationConfigs } from "./animation/animation-state.js";
export type { AnimationConfig, AnimEvent } from "./animation/animation-state.js";
export { buildTransitionMap, canTransition } from "./animation/animation-transitions.js";
export { buildPersonality, DIFFICULTY, AGGRESSION_STYLE } from "./combat/difficulty-presets.js";
export { NarrativeState } from "./narrative/narrative-state.js";
export { FsSessionStorage, MemorySessionStorage } from "./narrative/session-storage.js";
export type { SessionStorage } from "./narrative/session-storage.js";
export { AiClient } from "./narrative/ai-client.js";
export type {
  AiClientOptions,
  SceneGenerationResult,
  SkinGenerationResult,
  SpriteGenerationResult,
  SpriteAngle,
} from "./narrative/ai-client.js";
export { dispatchConsequences } from "./narrative/consequence-handler.js";
export type {
  ConsequenceEffect,
  DispatchOptions,
  DispatchResult,
} from "./narrative/consequence-handler.js";
export { AssetIndex } from "./narrative/asset-index.js";
export type { AssetIndexFilter } from "./narrative/asset-index.js";
export * from "./narrative/types.js";
