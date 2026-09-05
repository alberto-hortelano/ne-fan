/** Espejos zod de los REQUEST bodies de los HTTP internos — el análogo del
 *  candado WS (`protocol/message-schema.ts`) para el State API del bridge
 *  (`bridge/state-http-server.ts`) y el asset-store
 *  (`services/asset-store/http-server.ts`), que hasta ahora validaban a mano
 *  (2-3 campos comprobados y cast del resto).
 *
 *  Convención idéntica al espejo WS: objetos NO strict (campos extra se
 *  toleran, como en el tipado estructural TS), campos requeridos/tipados
 *  exactos, y GUARDIA DE DERIVA a nivel de tipos — la doble asignación de
 *  abajo deja de compilar si el zod y el tipo del contrato divergen. VIVE en
 *  src (no en test/) porque test/ corre con tsx sin typecheck.
 *
 *  Los payloads con validación profunda propia aguas abajo (manifest de
 *  plugin → registerRuntimePlugin; escena → validateScene; consequences →
 *  dispatch) se cubren con `z.custom<T>` superficial: el borde garantiza el
 *  sobre, el especialista el contenido. */
import { z } from "zod";

import { EDGES, LINK_KINDS, PLACE_KINDS } from "../world-map/types.js";
import type { TriggerWhen } from "../world-map/types.js";
import type {
  Consequence,
  FormatDScene,
  LinkSpec,
  PlaceTriggerSpec,
  PlaceUpsert,
  PluginManifest,
} from "./common.js";
import type {
  MapTriggerRequest,
  NarrativeProgressRequest,
  NpcDirectiveRequest,
  NpcMoveToPlaceRequest,
  InventoryAddRequest,
  InventoryRemoveRequest,
  PluginRegisterRequest,
  SceneAssetRefsRequest,
  SceneValidateRequest,
} from "./world-state.js";
import { HASH_DE_ASSET } from "./asset-store.js";
import type {
  AssetCharacterRegisterRequest,
  AssetPinRequest,
  AssetRegisterRequest,
} from "./asset-store.js";
import {
  MAX_VOCABULARY_ENTRIES,
  VocabularyEntrySchema,
} from "../games/vocabulary.js";
import type { VocabularySetRequest } from "./world-state.js";

// ── Piezas compartidas ──

const EdgeSchema = z.enum(EDGES);

/** Sobre superficial de una consequence: objeto con `type` string. La forma
 *  completa la valida el consumidor (dispatchConsequences tolera y audita;
 *  el pre-flight del modelo usa ConsequenceSchema del SoT). */
const ConsequenceEnvelope = z.custom<Consequence>(
  (v) => !!v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string",
  { message: "consequence must be an object with a string `type`" },
);

const TriggerWhenSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_entered") }),
  z.object({ type: z.literal("player_left") }),
  z.object({ type: z.literal("player_near"), radius: z.number() }),
  z.object({ type: z.literal("first_visit") }),
]);

const PlaceTriggerSpecSchema = z.object({
  id: z.string().min(1),
  when: TriggerWhenSchema,
  // Ausente → [] (como el coerce histórico); presente pero no-array → error
  // (antes se MACHACABA a [] en silencio).
  consequences: z.array(ConsequenceEnvelope).default([]),
  fired_at: z.string().optional(),
});

const AnchorSchema = z.object({
  tx: z.number().int(),
  ty: z.number().int(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

// ── State API (bridge/state-http-server.ts) ──

export const PlaceUpsertSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PLACE_KINDS),
  // La cadena literal "null" es siempre un error del emisor (quiso el null de
  // JSON); aceptarla crearía un place colgando de un padre "null" fantasma o
  // dependería de que el harness MCP la coercione en silencio.
  parent_id: z
    .string()
    .nullable()
    .refine((v) => v !== "null", {
      message: 'parent_id: use JSON null for the root world, not the string "null"',
    }),
  name: z.string().min(1),
  description: z.string().optional(),
  approx_position: z.tuple([z.number(), z.number()]).optional(),
  approx_radius: z.number().optional(),
  attrs: z.record(z.unknown()).optional(),
  realized_scene_id: z.string().optional(),
  introduced_event_id: z.string().optional(),
  triggers: z.array(PlaceTriggerSpecSchema).optional(),
  visited: z.boolean().optional(),
  anchor: AnchorSchema.optional(),
});

export const LinkSpecSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(LINK_KINDS),
  travel_hours: z.number().optional(),
  description: z.string().optional(),
  bidirectional: z.boolean().optional(),
  edge: EdgeSchema.optional(),
});

export const MapTriggerRequestSchema = z.object({
  place_id: z.string().min(1),
  trigger: PlaceTriggerSpecSchema,
});

export const NpcDirectiveRequestSchema = z.object({
  directive: z
    .object({ type: z.string().min(1), target_place_id: z.string().optional() })
    .passthrough()
    .nullable(),
});

export const NpcMoveToPlaceRequestSchema = z.object({
  place_id: z.string().min(1),
});

export const InventoryRemoveRequestSchema = z.object({
  item_id: z.string().min(1),
});

/** `item` lleva `id` obligatorio (es por lo que `inventory_remove` lo
 *  encuentra: un ítem sin `id` no se podría quitar nunca) y el resto pasa tal
 *  cual — lo pone el motor. `passthrough` porque el tipo (`InventoryItem`)
 *  tiene índice libre; la guardia de deriva de abajo lo cubre igual. */
export const InventoryAddRequestSchema = z.object({
  item: z.object({ id: z.string().min(1) }).passthrough(),
});

export const NarrativeProgressRequestSchema = z.object({
  message: z.string().min(1),
});

export const SceneValidateRequestSchema = z.object({
  scene: z.custom<FormatDScene>(
    (v) => !!v && typeof v === "object" && !Array.isArray(v),
    { message: "scene must be a Format D scene object" },
  ),
});

export const PluginRegisterRequestSchema = z.object({
  manifest: z.custom<PluginManifest>(
    (v) => v !== undefined && v !== null,
    { message: "body requires { manifest: <PluginManifest> }" },
  ),
});

// ── asset-store (services/asset-store/http-server.ts) ──

// `POST /assets` es la puerta de la SUPERFICIE y solo de ella (#257, #376):
// un registro de otro kind es 400 aquí, no una fila que el prune no sabrá
// tocar. El arte de personaje tiene la suya, abajo.
//
// El `hash` lleva FORMA y no solo `min(1)`. No es celo: el prune borra
// `rutaDeBlob(kind, hash)` con `rmSync recursive`, así que un hash que sea un
// nombre de directorio plausible borra ese directorio, y un `../..` sale de
// `cache/`. Los dos productores emiten `sha256(...)[:16]` y el LECTOR ya lo
// exigía para el hero: lo que faltaba era exigirlo al escribir.
export const AssetRegisterRequestSchema = z.object({
  hash: z.string().regex(HASH_DE_ASSET),
  type: z.literal("surface"),
  subtype: z.literal("surface"),
  prompt: z.string(),
  size_bytes: z.number().min(0),
  extra: z.record(z.unknown()).optional(),
});

// ── El arte de UN personaje, en UNA petición (POST /assets/character) ──
//
// Lo que este schema hace inexpresable, y que la primera forma de #376 no
// alcanzaba: **el `ref` de pin no es una entrada**. Con un `character_ref` por
// fila, un `sprite_sheet` podía declarar el ref de otro personaje —medido por
// QA: soltar A se llevaba los frames de B—, o sea que «un hero sin sus
// frames», la frase del criterio de cierre, seguía siendo un estado
// expresable. Aquí el ref se deriva de `hero_key` para las N filas y no hay
// campo en el que escribir la contradicción. El `hash` del hero tampoco se
// manda: ES `hero_key`.
//
// `prompt` no vacío en TODAS las filas: es la procedencia, que es el motivo
// entero por el que este arte se indexa (#293).
const ArteDePersonajeFilaSchema = z.object({
  hash: z.string().regex(HASH_DE_ASSET),
  prompt: z.string().min(1),
  size_bytes: z.number().min(0),
  extra: z.record(z.unknown()).optional(),
});

export const AssetCharacterRegisterRequestSchema = z
  .object({
    hero_key: z.string().regex(HASH_DE_ASSET),
    hero: ArteDePersonajeFilaSchema.omit({ hash: true }).optional(),
    sheets: z.array(ArteDePersonajeFilaSchema).max(64).optional(),
  })
  .refine((v) => v.hero !== undefined || (v.sheets?.length ?? 0) > 0, {
    message: "una petición sin hero y sin sheets no registra nada: manda al menos uno",
  });

export const SceneAssetRefsRequestSchema = z.object({
  scene_id: z.string().min(1),
  refs: z.array(z.string().min(1)).max(256),
});

export const VocabularySetRequestSchema = z.object({
  entries: z.array(VocabularyEntrySchema).max(MAX_VOCABULARY_ENTRIES),
});

export const AssetPinRequestSchema = z.object({
  ref: z.string().min(1).max(200),
  hashes: z.array(z.string().min(1)).max(4096),
});

// ── Guardia de deriva (compile-time) ──
// Cada espejo debe coincidir EXACTAMENTE con su tipo del contrato, en DOS
// capas: (1) asignabilidad en ambos sentidos (campo requerido de más/de
// menos, tipo distinto) y (2) IGUALDAD DE CLAVES (assertSameKeys) — la
// asignabilidad estructural NO detecta un campo OPCIONAL caído del espejo, y
// como los z.object no-strict STRIPEAN claves desconocidas, ese campo se
// perdería en silencio al parsear. (InventoryAdd queda fuera: ver su
// comentario.)
type Mirror<A, B> = [A, B];
function assertMirror<A, B extends A>(_pair?: Mirror<A, B>): void {
  void _pair;
}
type KeyDiff<A, B> = {
  missing_in_schema: Exclude<keyof A, keyof B>;
  extra_in_schema: Exclude<keyof B, keyof A>;
};
// Si las claves difieren, la llamada sin argumentos deja de compilar
// ("Expected 1 arguments") y el tipo del argumento que falta NOMBRA las
// claves divergentes.
function assertSameKeys<A, B>(
  ...diff: [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never]
    ? []
    : [KeyDiff<A, B>]
): void {
  void diff;
}
assertMirror<PlaceUpsert, z.infer<typeof PlaceUpsertSchema>>();
assertMirror<z.infer<typeof PlaceUpsertSchema>, PlaceUpsert>();
assertMirror<LinkSpec, z.infer<typeof LinkSpecSchema>>();
assertMirror<z.infer<typeof LinkSpecSchema>, LinkSpec>();
assertMirror<MapTriggerRequest, z.infer<typeof MapTriggerRequestSchema>>();
assertMirror<z.infer<typeof MapTriggerRequestSchema>, MapTriggerRequest>();
assertMirror<PlaceTriggerSpec, z.infer<typeof PlaceTriggerSpecSchema>>();
assertMirror<z.infer<typeof PlaceTriggerSpecSchema>, PlaceTriggerSpec>();
assertMirror<TriggerWhen, z.infer<typeof TriggerWhenSchema>>();
assertMirror<z.infer<typeof TriggerWhenSchema>, TriggerWhen>();
assertMirror<NpcDirectiveRequest, z.infer<typeof NpcDirectiveRequestSchema>>();
assertMirror<z.infer<typeof NpcDirectiveRequestSchema>, NpcDirectiveRequest>();
assertMirror<NpcMoveToPlaceRequest, z.infer<typeof NpcMoveToPlaceRequestSchema>>();
assertMirror<z.infer<typeof NpcMoveToPlaceRequestSchema>, NpcMoveToPlaceRequest>();
assertMirror<InventoryAddRequest, z.infer<typeof InventoryAddRequestSchema>>();
assertMirror<z.infer<typeof InventoryAddRequestSchema>, InventoryAddRequest>();
assertMirror<InventoryRemoveRequest, z.infer<typeof InventoryRemoveRequestSchema>>();
assertMirror<z.infer<typeof InventoryRemoveRequestSchema>, InventoryRemoveRequest>();
assertMirror<NarrativeProgressRequest, z.infer<typeof NarrativeProgressRequestSchema>>();
assertMirror<z.infer<typeof NarrativeProgressRequestSchema>, NarrativeProgressRequest>();
assertMirror<SceneValidateRequest, z.infer<typeof SceneValidateRequestSchema>>();
assertMirror<z.infer<typeof SceneValidateRequestSchema>, SceneValidateRequest>();
assertMirror<PluginRegisterRequest, z.infer<typeof PluginRegisterRequestSchema>>();
assertMirror<z.infer<typeof PluginRegisterRequestSchema>, PluginRegisterRequest>();
assertMirror<SceneAssetRefsRequest, z.infer<typeof SceneAssetRefsRequestSchema>>();
assertMirror<z.infer<typeof SceneAssetRefsRequestSchema>, SceneAssetRefsRequest>();
assertMirror<AssetRegisterRequest, z.infer<typeof AssetRegisterRequestSchema>>();
assertMirror<z.infer<typeof AssetRegisterRequestSchema>, AssetRegisterRequest>();
assertMirror<AssetCharacterRegisterRequest, z.infer<typeof AssetCharacterRegisterRequestSchema>>();
assertMirror<z.infer<typeof AssetCharacterRegisterRequestSchema>, AssetCharacterRegisterRequest>();

assertSameKeys<SceneAssetRefsRequest, z.infer<typeof SceneAssetRefsRequestSchema>>();
assertSameKeys<PlaceUpsert, z.infer<typeof PlaceUpsertSchema>>();
assertSameKeys<LinkSpec, z.infer<typeof LinkSpecSchema>>();
assertSameKeys<MapTriggerRequest, z.infer<typeof MapTriggerRequestSchema>>();
assertSameKeys<PlaceTriggerSpec, z.infer<typeof PlaceTriggerSpecSchema>>();
assertSameKeys<NpcDirectiveRequest, z.infer<typeof NpcDirectiveRequestSchema>>();
assertSameKeys<NpcMoveToPlaceRequest, z.infer<typeof NpcMoveToPlaceRequestSchema>>();
assertSameKeys<InventoryAddRequest, z.infer<typeof InventoryAddRequestSchema>>();
assertSameKeys<InventoryRemoveRequest, z.infer<typeof InventoryRemoveRequestSchema>>();
assertSameKeys<NarrativeProgressRequest, z.infer<typeof NarrativeProgressRequestSchema>>();
assertSameKeys<SceneValidateRequest, z.infer<typeof SceneValidateRequestSchema>>();
assertSameKeys<PluginRegisterRequest, z.infer<typeof PluginRegisterRequestSchema>>();
assertSameKeys<AssetRegisterRequest, z.infer<typeof AssetRegisterRequestSchema>>();
assertSameKeys<AssetCharacterRegisterRequest, z.infer<typeof AssetCharacterRegisterRequestSchema>>();

assertMirror<VocabularySetRequest, z.infer<typeof VocabularySetRequestSchema>>();
assertMirror<z.infer<typeof VocabularySetRequestSchema>, VocabularySetRequest>();
assertSameKeys<VocabularySetRequest, z.infer<typeof VocabularySetRequestSchema>>();

assertMirror<AssetPinRequest, z.infer<typeof AssetPinRequestSchema>>();
assertMirror<z.infer<typeof AssetPinRequestSchema>, AssetPinRequest>();
assertSameKeys<AssetPinRequest, z.infer<typeof AssetPinRequestSchema>>();
