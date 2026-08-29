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
// Vocabulario NPC (fuente única): roles con preset + directivas ejecutables.
export { NPC_ROLES, type NpcRole } from "./simulation/npc-roles.js";
export { NPC_DIRECTIVE_TYPES, type NpcDirectiveType } from "./simulation/npc-behavior.js";
// Enums del world map (fuente única): las tools de narrative-mcp y el espejo
// zod de los requests HTTP derivan de estas listas.
export { PLACE_KINDS, LINK_KINDS, EDGES } from "./world-map/types.js";
export type { PlaceKind, LinkKind, Edge } from "./world-map/types.js";
export { buildPersonality, DIFFICULTY, AGGRESSION_STYLE } from "./combat/difficulty-presets.js";
export { NarrativeState } from "./narrative/narrative-state.js";
export { FsSessionStorage, MemorySessionStorage } from "./narrative/session-storage.js";
export type { SessionStorage } from "./narrative/session-storage.js";
export { AiClient } from "./narrative/ai-client.js";
export type {
  AiClientOptions,
  SceneGenerationResult,
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

// Parsers zod de escena (fuente de verdad) — los consume el preflight de
// narrative-mcp para que el MCP rechace EXACTAMENTE lo que el cliente
// rechazaría (un espejo a mano siempre acaba más laxo que el zod).
export { parseVolumes } from "./scene/blueprint/volumes.js";
export { parseGround } from "./scene/blueprint/ground.js";

// Contratos entrada/salida del modelo (SoT zod → prompt + tool JSON +
// pre-flight): el pre-flight de narrative-mcp valida con estos schemas para
// que "opcional en el prompt" == "opcional en el validador" por construcción.
export { validateContract, type ContractCheck } from "./contract/model-io/validate.js";
export {
  NarrativeReactionSchema,
  ConsequenceSchema,
  MAX_CONSEQUENCES,
  WeaponOrientSchema,
  WeaponVerifySchema,
  CONTRACTS,
  type ContractSpec,
} from "./contract/model-io/schemas.js";
export {
  EmittedSceneSchema,
  ExpandedSceneSchema,
  EntitySchema,
  ENTITY_FIELDS,
  SceneSizeSchema,
  type EmittedScene,
  type ExpandedScene,
} from "./contract/model-io/scene-schema.js";
