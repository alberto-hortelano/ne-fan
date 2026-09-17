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
import type { EnemyPersonality } from "../types.js";

const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/** LOS CUATRO CAMPOS DEL BLOQUE `combat` SOLO DECLARAN SU TIPO AQUÍ; quién
 *  decide si sirven es `parseHostileCombat`, UNA vez y en el orden del parser,
 *  y desde #529 lo hace YA DENTRO DEL HANDLER (`cribarHostiles`), no en este
 *  refinamiento.
 *
 *  `z.custom<T>()` acepta cualquier cosa en runtime y sigue infiriendo `T`, así
 *  que la guardia de deriva de `message-schema.test.ts` (que fuerza a `tsc` a
 *  romper si este zod y el union TS se separan) sigue sujetándolos.
 *
 *  Por qué, y es lo que arregló #530-p3: un `z.number()` en `health` rechaza el
 *  frame ANTES del refinamiento —zod no llega a un `superRefine` si el objeto
 *  ya falló—, así que un error de TIPO daba el mensaje de zod («Expected
 *  number, received string») donde el cliente daba el del parser
 *  («combat.health inválido ("x")»). Medido por QA en la PR 6 de #241: en 11 de
 *  49 casos el motivo difería entre las dos puertas, todos de tipo o de
 *  ausencia; en los 38 de VALOR era idéntico. «Mismo criterio, mismo
 *  desenlace» no puede depender de si el error es de tipo o de valor, y con el
 *  criterio fuera del zod tampoco puede hacerlo el desenlace.
 *
 *  ESTE ZOD MIRA LA FORMA DEL FRAME, NO LA VALIDEZ DE CADA ENEMIGO (#529). El
 *  criterio vivió aquí dentro, en un `superRefine`, del 2026-09-07 al 09-14, y
 *  el precio era que un enemigo malo tumbaba el frame ENTERO: un
 *  `add_combatants` que no pasa el intake se contesta con `kind:"protocolo"`,
 *  o sea un modal a pantalla completa, y los dos enemigos buenos que venían al
 *  lado se iban con él. El cliente, con el MISMO criterio, descartaba uno y
 *  seguía. Hoy el desenlace es el del cliente en las dos puertas: `id` y
 *  `position` SÍ llevan zod de verdad —sin ellos no hay a quién dar de alta ni
 *  dónde, y eso sí es un frame ilegible—, y los cuatro del bloque los juzga
 *  `cribarHostiles` enemigo a enemigo en `bridge/handlers/simulation.ts`. */
const EnemyPersonalitySchema = z.custom<EnemyPersonality>();

const EnemySpawnSchema = z.object({
  id: z.string(),
  position: Vec3Schema,
  /** La vida que le queda AHORA (un herido que vuelve de un save trae la
   *  suya, no la del contrato). */
  health: z.custom<number>(),
  /** …y sobre cuánta. REQUERIDO, sin default: derivarlo de `health` es
   *  exactamente la mentira que había —barra llena para un herido, y la IA
   *  creyéndolo entero— y un default lo dejaría entrar otra vez en silencio.
   *  Quien exige que esté y sea usable es el parser, en la criba del handler. */
  maxHealth: z.custom<number>(),
  weaponId: z.custom<string>(),
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

const SessionEnteredMessageSchema = z.object({
  type: z.literal("session_entered"),
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

const RepairGameWorldMessageSchema = z.object({
  type: z.literal("repair_game_world"),
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
  SessionEnteredMessageSchema,
  SetRenderModeMessageSchema,
  DialogueChoiceMessageSchema,
  CreateGameMessageSchema,
  ListGamesMessageSchema,
  GenerateGameMessageSchema,
  RepairGameWorldMessageSchema,
  GetWorldSnapshotMessageSchema,
  RecordStyleApplicationMessageSchema,
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
