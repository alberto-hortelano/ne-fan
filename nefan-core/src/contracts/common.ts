/** Documento de interfaces COMÚN a todos los microservicios.
 *
 * Tres cosas viven aquí:
 *  1. El registro `SERVICES` (nombre → protocolo → puerto objetivo/actual) y
 *     `resolveServiceUrl` — la única fuente de URLs entre servicios (sustituye
 *     a las URLs hardcodeadas de los clientes en F1).
 *  2. Los sobres de error compartidos.
 *  3. Reexports de los tipos de dominio que cruzan más de un servicio. Regla:
 *     un tipo compartido se reexporta SOLO desde aquí (los módulos por
 *     servicio los importan pero no los reexportan — evita colisiones en el
 *     `export *` de index.ts) y NUNCA se duplica: la fuente sigue siendo el
 *     módulo original de nefan-core.
 *
 * Versionado: `CONTRACTS_VERSION` cubre el conjunto. Regla de compatibilidad:
 * solo cambios aditivos con campos opcionales; un cambio breaking exige bump
 * y un periodo de doble aceptación en el servidor. Los schemas de dominio ya
 * versionados (SCHEMA_VERSION=4 de narrativa, WORLD_MAP_SCHEMA_VERSION=1)
 * siguen mandando dentro de sus payloads.
 */

export const CONTRACTS_VERSION = 1;

// ── Registro de servicios ──
// Vive en service-registry.ts (módulo HOJA sin dependencias, importable desde
// el navegador — este common.ts arrastra módulos node-only vía los reexports
// de dominio de abajo). Se reexporta aquí para el resto de consumidores.

export {
  SERVICES,
  resolveServiceUrl,
  portOf,
  portOffset,
  type ServiceName,
  type ServiceSpec,
} from "./service-registry.js";

// ── Sobres de error ──

/** Error de los servicios Node (world-state, y game-gateway en sus responses
 *  con `ok`): status 4xx/5xx con este body. */
export interface ErrorResponse {
  ok: false;
  error: string;
}

/** Error de los servicios FastAPI (narrative-llm, remote-gen,
 *  asset-store mientras vivan en Python): HTTPException → `{detail}`. Los
 *  422 de validación llevan el detail estructurado de Pydantic. */
export interface FastApiErrorResponse {
  detail: unknown;
}

// ── Tipos de dominio compartidos (reexports — la fuente NO se mueve) ──

// Núcleo geométrico y de combate (gateway ⇄ clientes; fixtures).
export type { Vec3, CombatEvent, CombatConfig, EnemyPersonality } from "../types.js";

// Sesión y narrativa (gateway, world-state, narrative-llm).
export type {
  SessionData,
  SessionMetadata,
  SceneRecord,
  EntityRecord,
  DialogueEvent,
  DialogueChoice,
  Consequence,
  ConsequenceEffect,
  AssetEntry,
  LlmContext,
  NarrativeWorldState,
  NarrativePlayerState,
  PlayerAppearance,
} from "../narrative/types.js";
export { SCHEMA_VERSION } from "../narrative/types.js";

// World map (world-state, gateway; el motor narrativo lo muta vía tools MCP).
export type {
  WorldMap,
  Place,
  PlaceLink,
  PlaceKind,
  LinkKind,
  Edge,
  PlaceTriggerSpec,
  TriggerWhen,
} from "../world-map/types.js";
export { WORLD_MAP_SCHEMA_VERSION } from "../world-map/types.js";
export type { PlaceUpsert, LinkSpec } from "../world-map/world-map.js";
export type {
  NpcDirective,
  NpcTransit,
  NpcPlaceInfo,
  NpcDirectorResult,
} from "../world-map/npc-director.js";

// Plugins declarativos (world-state ⇄ motor narrativo). El schema zod se
// reexporta como valor: es la validación runtime canónica del manifest.
export type {
  PluginManifest,
  PluginRecord,
  PluginLlmView,
  PluginInspectResult,
} from "../plugins/types.js";
export { PluginManifestSchema } from "../plugins/types.js";

// Validación de escenas Format D (world-state /scene/validate y pre-flight de
// narrative_respond en narrative-mcp).
export type { SceneValidationResult, TileValidationContext } from "../scene/scene-validate.js";


// Juegos y estilos (gateway list_games; remote-gen /styles/*).
export type { GameMeta, StyleManifest, GameListing, StyleListing } from "../games/loader.js";

/** Escena Format D cruda tal y como la produce el motor narrativo. El
 *  contrato JSON completo vive en data/contract/tools/generate_scene.json y
 *  el validador en src/scene/scene-validate.ts — aquí queda opaca a
 *  propósito: los servicios la transportan, no la interpretan. */
export type FormatDScene = Record<string, unknown>;
