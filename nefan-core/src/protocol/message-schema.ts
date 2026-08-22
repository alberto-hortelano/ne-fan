/** Validación runtime del input WS del cliente (cliente web → bridge).
 *
 *  `messages.ts` (los tipos TS) es el CONTRATO; este módulo es su espejo zod
 *  para validar en el BORDE del transporte antes de enrutar. Sin esto,
 *  `ws-server.ts` hacía `JSON.parse(raw) as ClientMessage` y pasaba el objeto
 *  crudo (sin auth, sin comprobar) directo a los handlers, que leen campos
 *  anidados (`msg.inputs.playerPosition.x`, `msg.enemies[i].personality…`) y
 *  petaban con un TypeError opaco ante un frame malformado.
 *
 *  Regla de tolerancia: los objetos zod hacen STRIP de claves no modeladas por
 *  defecto — un cliente más nuevo que envíe campos extra no es rechazado (los
 *  handlers solo leen los campos tipados). Se rechaza lo que falta o tiene mal
 *  el tipo. El `message-schema.test.ts` fuerza `tsc` a romper si el union TS y
 *  este zod divergen (deriva a nivel de tipos en ambos sentidos).
 *
 *  NOTA hot loop: el mensaje `input` se valida en cada frame. Es un objeto
 *  pequeño y `safeParse` sobre él cuesta microsegundos; a cambio, un frame de
 *  input malformado deja de alcanzar el tick del sim con NaN/undefined. */

import { z } from "zod";
import type { ClientMessage } from "./messages.js";

const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const EnemyPersonalitySchema = z.object({
  aggression: z.number(),
  preferred_attacks: z.array(z.string()),
  reaction_time: z.number(),
  combat_range: z.number().optional(),
  difficulty: z.string().optional(),
  aggression_style: z.string().optional(),
  attack_cooldown_mult: z.number().optional(),
  block_chance: z.number().optional(),
  preferred_distance: z.number().optional(),
  move_speed: z.number().optional(),
});

const EnemySpawnSchema = z.object({
  id: z.string(),
  position: Vec3Schema,
  health: z.number(),
  weaponId: z.string(),
  personality: EnemyPersonalitySchema,
});

const EdgeSchema = z.enum(["north", "south", "east", "west"]);

// ── Frontend → Logic (una variante por mensaje, mismo orden que messages.ts) ──

const InputMessageSchema = z.object({
  type: z.literal("input"),
  delta: z.number(),
  inputs: z.object({
    playerPosition: Vec3Schema,
    playerForward: Vec3Schema,
    playerMoving: z.boolean(),
    attackRequested: z.boolean().optional(),
    attackType: z.string().optional(),
  }),
});

const LoadRoomMessageSchema = z.object({
  type: z.literal("load_room"),
  roomId: z.string(),
  dimensions: z.object({ width: z.number(), depth: z.number() }).optional(),
  enemies: z.array(EnemySpawnSchema),
});

const RespawnMessageSchema = z.object({
  type: z.literal("respawn"),
  pos: Vec3Schema.optional(),
});

const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

const ListSessionsMessageSchema = z.object({
  type: z.literal("list_sessions"),
  requestId: z.string(),
});

const StartSessionMessageSchema = z.object({
  type: z.literal("start_session"),
  requestId: z.string(),
  gameId: z.string(),
  appearance: z.object({ model_id: z.string(), skin_path: z.string() }).optional(),
  styleId: z.string().optional(),
  renderMode: z.string().optional(),
  characterMode: z.string().optional(),
});

const ResumeSessionMessageSchema = z.object({
  type: z.literal("resume_session"),
  requestId: z.string(),
  sessionId: z.string(),
});

const DeleteSessionMessageSchema = z.object({
  type: z.literal("delete_session"),
  requestId: z.string(),
  sessionId: z.string(),
});

const SetRenderModeMessageSchema = z.object({
  type: z.literal("set_render_mode"),
  requestId: z.string(),
  sessionId: z.string(),
  renderMode: z.enum(["image", "vector"]),
  facet: z.enum(["scenes", "characters"]).optional(),
});

const DialogueChoiceMessageSchema = z.object({
  type: z.literal("dialogue_choice"),
  requestId: z.string().optional(),
  eventId: z.string(),
  choiceIndex: z.number(),
  freeText: z.string().optional(),
  speaker: z.string(),
  speakerId: z.string().optional(),
  chosenText: z.string(),
});

const CreateGameMessageSchema = z.object({
  type: z.literal("create_game"),
  requestId: z.string(),
  draftText: z.string(),
});

const ListGamesMessageSchema = z.object({
  type: z.literal("list_games"),
  requestId: z.string(),
});

const GenerateGameMessageSchema = z.object({
  type: z.literal("generate_game"),
  requestId: z.string(),
  gameId: z.string(),
});

const GetWorldSnapshotMessageSchema = z.object({
  type: z.literal("get_world_snapshot"),
  requestId: z.string(),
  gameId: z.string(),
});

const RecordStyleApplicationMessageSchema = z.object({
  type: z.literal("record_style_application"),
  requestId: z.string(),
  // Validación profunda aguas abajo (StyleApplicationRecordSchema en el
  // handler) — el borde garantiza el sobre.
  record: z.record(z.string(), z.unknown()),
});

const SaveSessionMessageSchema = z.object({
  type: z.literal("save_session"),
  requestId: z.string().optional(),
});

const PlayerEnteredPlaceMessageSchema = z.object({
  type: z.literal("player_entered_place"),
  placeId: z.string(),
});

const RequestTileMessageSchema = z.object({
  type: z.literal("request_tile"),
  tx: z.number(),
  ty: z.number(),
  reason: z.enum(["prefetch", "blocking"]),
  edge: EdgeSchema.optional(),
});

const AddCombatantsMessageSchema = z.object({
  type: z.literal("add_combatants"),
  enemies: z.array(EnemySpawnSchema),
});

const InteractEntityMessageSchema = z.object({
  type: z.literal("interact_entity"),
  entityId: z.string(),
  entityName: z.string(),
});

/** Union discriminado por `type` de TODO el input cliente→bridge. El
 *  discriminador da un error preciso ("Invalid discriminator value…") cuando el
 *  `type` no existe, y valida los campos de la variante concreta. */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  InputMessageSchema,
  LoadRoomMessageSchema,
  RespawnMessageSchema,
  PingMessageSchema,
  ListSessionsMessageSchema,
  StartSessionMessageSchema,
  ResumeSessionMessageSchema,
  DeleteSessionMessageSchema,
  SetRenderModeMessageSchema,
  DialogueChoiceMessageSchema,
  CreateGameMessageSchema,
  ListGamesMessageSchema,
  GenerateGameMessageSchema,
  GetWorldSnapshotMessageSchema,
  RecordStyleApplicationMessageSchema,
  SaveSessionMessageSchema,
  PlayerEnteredPlaceMessageSchema,
  RequestTileMessageSchema,
  AddCombatantsMessageSchema,
  InteractEntityMessageSchema,
]);

export type ClientMessageFromSchema = z.infer<typeof ClientMessageSchema>;

// ── Guardia de deriva (compile-time) ──
// El zod de arriba debe ser un espejo EXACTO del union TS `ClientMessage`
// (el contrato en messages.ts). Si divergen — una variante de más/de menos, un
// campo con distinto tipo/opcionalidad — una de estas dos asignaciones deja de
// compilar en `tsc`. VIVE AQUÍ y no en el test porque el tsconfig sólo incluye
// src/bridge/services: test/ corre con tsx sin typecheck, así que un guardia en
// el test sería letra muerta. `null as unknown as …` no ejecuta nada.
const _zodMatchesContract: ClientMessage = null as unknown as ClientMessageFromSchema;
const _contractMatchesZod: ClientMessageFromSchema = null as unknown as ClientMessage;
void _zodMatchesContract;
void _contractMatchesZod;
