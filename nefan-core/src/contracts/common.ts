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

export type ServiceName =
  | "game-gateway"
  | "world-state"
  | "narrative-llm"
  | "gpu-worker"
  | "remote-gen"
  | "asset-store";

export interface ServiceSpec {
  readonly protocol: "ws" | "http";
  /** Puerto OBJETIVO del servicio una vez extraído. */
  readonly port: number;
  /** Puerto donde escucha HOY (los servicios aún no extraídos co-viven en el
   *  proceso ai_server :8765). `resolveServiceUrl` usa este. */
  readonly currentPort: number;
  /** Fase de docs/microservices/migration.md en la que se extrae; ausente =
   *  ya corre en su proceso/puerto. */
  readonly extractionPhase?: "F2" | "F3" | "F4" | "F6";
  readonly description: string;
}

export const SERVICES = {
  "game-gateway": {
    protocol: "ws",
    port: 9877,
    currentPort: 9877,
    description:
      "Sesiones de juego en vivo: WS con clientes, routing, GameSimulation (hot loop) y SceneGenQueue in-process.",
  },
  "world-state": {
    protocol: "http",
    port: 9878,
    currentPort: 9878,
    extractionPhase: "F6",
    description:
      "Fuente de verdad del mundo: NarrativeState (único escritor de saves), WorldMapManager, NpcDirector, plugins. Hoy co-vive en el proceso del gateway (puerto propio; separar proceso es F6, opcional).",
  },
  "narrative-llm": {
    protocol: "http",
    port: 8765,
    currentPort: 8765,
    description:
      "Narrativa con LLM: generate_scene, choices, develop_world, reviews con visión. narrative-mcp (:3737) es su sidecar.",
  },
  "gpu-worker": {
    protocol: "http",
    port: 8766,
    currentPort: 8765,
    extractionPhase: "F3",
    description:
      "Generación local con GPU: texturas SD1.5, skins, sprites, modelos, inpainting LaMa. 1 proceso = 1 GPU.",
  },
  "asset-store": {
    protocol: "http",
    port: 8767,
    currentPort: 8765,
    extractionPhase: "F2",
    description:
      "Almacén content-addressed: blobs de cache/, manifest (SQLite tras F2), styles binarios.",
  },
  "remote-gen": {
    protocol: "http",
    port: 8768,
    currentPort: 8765,
    extractionPhase: "F4",
    description:
      "Adaptador de APIs de pago (Meshy/fal): scene images, sprite sheets, style packs, segmentación SAM2.",
  },
} as const satisfies Record<ServiceName, ServiceSpec>;

/** URL base de un servicio. Orden: override por env (`NEFAN_URL_GPU_WORKER`,
 *  `NEFAN_URL_ASSET_STORE`…) → loopback con el puerto ACTUAL. `env` se inyecta
 *  (process.env en Node, import.meta.env o {} en el navegador) para que el
 *  módulo siga siendo puro. */
export function resolveServiceUrl(
  name: ServiceName,
  env: Record<string, string | undefined> = {},
): string {
  const override = env[`NEFAN_URL_${name.toUpperCase().replace(/-/g, "_")}`];
  if (override) return override.replace(/\/+$/, "");
  const spec = SERVICES[name];
  const scheme = spec.protocol === "ws" ? "ws" : "http";
  return `${scheme}://127.0.0.1:${spec.currentPort}`;
}

// ── Sobres de error ──

/** Error de los servicios Node (world-state, y game-gateway en sus responses
 *  con `ok`): status 4xx/5xx con este body. */
export interface ErrorResponse {
  ok: false;
  error: string;
}

/** Error de los servicios FastAPI (narrative-llm, gpu-worker, remote-gen,
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

// Wire del review del plató (narrative-llm /review_stage_image ⇄ cliente 2D).
export type { StageExpectedElement, StageReviewItem, PaintedFloor } from "../scene/stage/segments.js";

// Juegos y estilos (gateway list_games; remote-gen /styles/*).
export type { GameMeta, StyleManifest, GameListing, StyleListing } from "../games/loader.js";

/** Escena Format D cruda tal y como la produce el motor narrativo. El
 *  contrato JSON completo vive en data/contract/tools/generate_scene.json y
 *  el validador en src/scene/scene-validate.ts — aquí queda opaca a
 *  propósito: los servicios la transportan, no la interpretan. */
export type FormatDScene = Record<string, unknown>;
