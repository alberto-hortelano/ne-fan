export * from "./types.js";
export * from "./vec3.js";
export { CONFIG } from "./config.js";
export type { NefanConfig } from "./config.js";
export * from "./combat/combat-resolver.js";
export * from "./combat/combat-data.js";
export * as Combatant from "./combat/combatant.js";
export { CombatManager } from "./combat/combat-manager.js";
export { EnemyAI } from "./combat/enemy-ai.js";
export { SeededRng, fnv1a, seededRng } from "./rng.js";
export type { CombatSystem, AttackSpec } from "./combat/combat-system.js";
export { StandardCombatSystem } from "./combat/standard-combat-system.js";
export { BasicCombatSystem } from "./combat/basic-combat-system.js";
export { combatRegistry } from "./combat/registry.js";
export { createSystemRegistry } from "./systems/registry.js";
export type { SystemRegistry } from "./systems/registry.js";
export { GameStore, createInitialState } from "./store/game-store.js";
export { GameSimulation } from "./simulation/game-loop.js";
export type { FrameInputs, FrameResult } from "./simulation/game-loop.js";
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
export * from "./plugins/types.js";
export { canonicalJson, computePluginId } from "./plugins/hash.js";
export * from "./plugins/dsl/evaluate.js";
export { DslError } from "./plugins/dsl/errors.js";
export { deepEqual } from "./plugins/dsl/deep-equal.js";
export { validateManifestStatic } from "./plugins/validate.js";
export { registerRuntimePlugin, PluginRegisterError } from "./plugins/register.js";
export { buildPluginLlmViews, inspectPlugin } from "./plugins/views.js";
export type { PluginViewSources, ManifestResolver } from "./plugins/views.js";
