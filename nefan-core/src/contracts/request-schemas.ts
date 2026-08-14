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
  InventoryRemoveRequest,
  PluginRegisterRequest,
  SceneValidateRequest,
} from "./world-state.js";
import type { AssetRegisterRequest } from "./asset-store.js";

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

/** `item` es libre (unknown) pero DEBE estar presente — z.unknown() infiere
 *  opcional, así que la presencia se comprueba con un refine y este schema
 *  queda fuera de la guardia de deriva (el tipo del contrato es
 *  `{ item: unknown }`). */
export const InventoryAddRequestSchema = z
  .object({ item: z.unknown() })
  .refine((b) => b.item !== undefined, { message: "body requires { item }" });

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

export const AssetRegisterRequestSchema = z.object({
  hash: z.string().min(1),
  type: z.string().min(1),
  subtype: z.string().min(1),
  prompt: z.string(),
  size_bytes: z.number().min(0),
  extra: z.record(z.unknown()).optional(),
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
assertMirror<InventoryRemoveRequest, z.infer<typeof InventoryRemoveRequestSchema>>();
assertMirror<z.infer<typeof InventoryRemoveRequestSchema>, InventoryRemoveRequest>();
assertMirror<NarrativeProgressRequest, z.infer<typeof NarrativeProgressRequestSchema>>();
assertMirror<z.infer<typeof NarrativeProgressRequestSchema>, NarrativeProgressRequest>();
assertMirror<SceneValidateRequest, z.infer<typeof SceneValidateRequestSchema>>();
assertMirror<z.infer<typeof SceneValidateRequestSchema>, SceneValidateRequest>();
assertMirror<PluginRegisterRequest, z.infer<typeof PluginRegisterRequestSchema>>();
assertMirror<z.infer<typeof PluginRegisterRequestSchema>, PluginRegisterRequest>();
assertMirror<AssetRegisterRequest, z.infer<typeof AssetRegisterRequestSchema>>();
assertMirror<z.infer<typeof AssetRegisterRequestSchema>, AssetRegisterRequest>();

assertSameKeys<PlaceUpsert, z.infer<typeof PlaceUpsertSchema>>();
assertSameKeys<LinkSpec, z.infer<typeof LinkSpecSchema>>();
assertSameKeys<MapTriggerRequest, z.infer<typeof MapTriggerRequestSchema>>();
assertSameKeys<PlaceTriggerSpec, z.infer<typeof PlaceTriggerSpecSchema>>();
assertSameKeys<NpcDirectiveRequest, z.infer<typeof NpcDirectiveRequestSchema>>();
assertSameKeys<NpcMoveToPlaceRequest, z.infer<typeof NpcMoveToPlaceRequestSchema>>();
assertSameKeys<InventoryRemoveRequest, z.infer<typeof InventoryRemoveRequestSchema>>();
assertSameKeys<NarrativeProgressRequest, z.infer<typeof NarrativeProgressRequestSchema>>();
assertSameKeys<SceneValidateRequest, z.infer<typeof SceneValidateRequestSchema>>();
assertSameKeys<PluginRegisterRequest, z.infer<typeof PluginRegisterRequestSchema>>();
assertSameKeys<AssetRegisterRequest, z.infer<typeof AssetRegisterRequestSchema>>();
