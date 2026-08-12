/** Fuente única de verdad (SoT) de los contratos entrada/salida del modelo.
 *
 *  Cada schema zod de este módulo genera TRES artefactos derivados (codegen
 *  `npm run gen:contract`, verificado por el test de deriva):
 *    1. el bloque de contrato inyectado en el prompt `.md` correspondiente
 *       (render.ts) — lo que el modelo VE,
 *    2. el `input_schema` del tool JSON del fallback por API (json-schema.ts),
 *    3. el validador del pre-flight MCP (`safeParse` directo) — el ÚNICO gate
 *       cuyo error vuelve al modelo.
 *  Así "opcional en el prompt" == "opcional en el validador" por construcción.
 *
 *  Las reglas aquí son el ESPEJO CANÓNICO de ai_server/narrative_schemas.py;
 *  las fixtures de data/contract/fixtures/ ejecutan ambos lados y CI grita si
 *  divergen. */

import { z } from "zod";

// ── narrative_event (reacción del motor a una elección del jugador) ─────────

const DialogueConsequence = z.object({
  type: z.literal("dialogue"),
  speaker: z.string().min(1).describe("Quién habla (nombre del NPC)"),
  text: z.string().min(1).describe("Lo que dice"),
  choices: z
    .array(z.string().min(1))
    .max(3)
    .optional()
    .describe("Hasta 3 opciones de respuesta ofrecidas al jugador"),
});

const StoryUpdateConsequence = z.object({
  type: z.literal("story_update"),
  delta: z.string().min(1).describe("Frase que se añade al hilo narrativo (story_so_far)"),
});

const SpawnEntityConsequence = z
  .object({
    type: z.literal("spawn_entity"),
    entity_kind: z.enum(["npc", "building", "object"]),
    description: z.string().min(1).describe("Descripción en español de la entidad a materializar"),
    name: z.string().optional().describe("Nombre propio (NPCs)"),
    position_hint: z.string().optional().describe("Pista de dónde aparece, p.ej. 'junto a la fuente'"),
    role: z
      .enum(["peasant", "guard", "villager", "merchant"])
      .optional()
      .describe("Rol de comportamiento ambiental (NPCs); desconocido degrada a villager"),
    texture_hash: z.string().optional().describe("Reusar textura cacheada por hash"),
    model_hash: z.string().optional().describe("Reusar modelo cacheado por hash"),
    character_type: z.string().optional(),
  })
  .passthrough();

const ScheduleEventConsequence = z
  .object({
    type: z.literal("schedule_event"),
    description: z.string().min(1).describe("Qué ocurrirá y bajo qué condición"),
    trigger: z.string().optional().describe("Condición de disparo (texto libre)"),
  })
  .passthrough();

const PluginEventConsequence = z.object({
  type: z.literal("plugin_event"),
  plugin_id: z.string().min(1).describe("Id del plugin declarativo destino"),
  event_type: z.string().min(1).describe("Tipo de evento que consume el plugin"),
  payload: z.record(z.unknown()).optional().describe("Datos del evento (objeto)"),
});

const NoopConsequence = z.object({
  type: z.literal("noop"),
});

export const ConsequenceSchema = z.discriminatedUnion("type", [
  DialogueConsequence,
  StoryUpdateConsequence,
  SpawnEntityConsequence,
  ScheduleEventConsequence,
  PluginEventConsequence,
  NoopConsequence,
]);

export const MAX_CONSEQUENCES = 4;

/** Payload completo de una respuesta narrative_event. `dialogue` es SIEMPRE
 *  una entrada del array `consequences`, nunca un campo de nivel superior. */
export const NarrativeReactionSchema = z.object({
  consequences: z
    .array(ConsequenceSchema)
    .max(MAX_CONSEQUENCES)
    .describe(`Lista de consecuencias (máx ${MAX_CONSEQUENCES}). [] si no hay reacción`),
});

export type Consequence = z.infer<typeof ConsequenceSchema>;
export type NarrativeReaction = z.infer<typeof NarrativeReactionSchema>;

/** Registro de todos los contratos del modelo, indexado por el `kind` del
 *  pre-flight. El codegen y el test de deriva iteran sobre esto. `name` es el
 *  identificador del tipo raíz en el bloque de prompt; `promptFile` el .md
 *  destino; `toolFile` el tool JSON (o null si ese kind no tiene fallback API). */
export interface ContractSpec {
  kind: string;
  name: string;
  schema: z.ZodTypeAny;
  promptFile: string;
  toolFile: string | null;
}

export const CONTRACTS: ContractSpec[] = [
  {
    kind: "narrative_event",
    name: "NarrativeReaction",
    schema: NarrativeReactionSchema,
    promptFile: "narrative_event.md",
    toolFile: "narrative_react.json",
  },
];
