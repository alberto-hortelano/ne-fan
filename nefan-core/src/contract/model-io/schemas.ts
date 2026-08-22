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
import { NPC_ROLES } from "../../simulation/npc-roles.js";

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
      .enum(NPC_ROLES)
      .optional()
      .describe("Rol de comportamiento ambiental (NPCs); desconocido degrada a villager"),
    style_ref: z
      .string()
      .optional()
      .describe(
        "NPCs: id de la referencia de personaje de world.style_refs.characters que mejor " +
          "case con su aspecto (guía el skin IA). Ausente/desconocido cae al default por rol",
      ),
    texture_hash: z.string().optional().describe("Reusar textura cacheada por hash"),
    model_hash: z.string().optional().describe("Reusar modelo cacheado por hash"),
    character_type: z.string().optional(),
  })
  .passthrough();

const ScheduleEventConsequence = z
  .object({
    type: z.literal("schedule_event"),
    description: z.string().min(1).describe(
      "Qué ocurrirá y bajo qué condición. Persiste en tu agenda (context.scheduled_events) hasta que lo dispares y lo retires con la tool scheduled_event_resolve(id)",
    ),
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
// ── weapon_orient (visión: orientar una malla 3D de arma) ───────────────────

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

function length3(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}
function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export const WeaponOrientSchema = z
  .object({
    grip_point_normalized: Vec3.describe("Punto de agarre en bbox normalizada [0..1]^3"),
    blade_direction: Vec3.describe("Vector (será normalizado): del agarre hacia punta/filo/frente"),
    up_direction: Vec3.describe("Vector (será normalizado): perpendicular a blade_direction, cara 'arriba'"),
    weapon_type: z.enum([
      "sword",
      "shield",
      "axe",
      "mace",
      "staff",
      "bow",
      "dagger",
      "spear",
      "generic",
    ]),
    grip_length_normalized: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Fracción de la longitud del arma ocupada por el agarre"),
    confidence: z.number().min(0).max(1).describe("0.9+ si agarre y hoja son claros; <0.5 si la malla parece rota"),
    notes: z.string().optional().describe("Justificación breve para depuración"),
  })
  // Invariantes geométricos (espejo de validate_weapon_orient_response): los
  // vectores no pueden ser degenerados y blade/up no pueden ser casi paralelos
  // (el frame sería singular). Se normalizan aguas abajo, así que no exigimos
  // norma unitaria exacta, solo que definan un frame válido.
  .refine((o) => length3(o.blade_direction) > 1e-6, {
    message: "blade_direction es degenerado (longitud ~0)",
    path: ["blade_direction"],
  })
  .refine((o) => length3(o.up_direction) > 1e-6, {
    message: "up_direction es degenerado (longitud ~0)",
    path: ["up_direction"],
  })
  .refine(
    (o) => {
      const bl = length3(o.blade_direction);
      const ul = length3(o.up_direction);
      if (bl < 1e-6 || ul < 1e-6) return true; // ya reportado arriba
      const cos = Math.abs(dot3(o.blade_direction, o.up_direction) / (bl * ul));
      return cos < 0.95;
    },
    { message: "blade_direction y up_direction son casi paralelos (frame singular)", path: ["up_direction"] },
  );

// ── weapon_verify (visión: comprobar el arma en la mano) ─────────────────────

export const WeaponVerifySchema = z.object({
  ok: z.boolean().describe("true si el arma está bien colocada en la mano para combate"),
  issue: z.string().optional().describe("Qué está mal (cuando ok=false)"),
  suggested_delta_euler: Vec3.optional().describe("Corrección sugerida [rx, ry, rz] en grados (cuando ok=false)"),
});

export type WeaponOrient = z.infer<typeof WeaponOrientSchema>;
export type WeaponVerify = z.infer<typeof WeaponVerifySchema>;

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
  {
    kind: "weapon_orient",
    name: "WeaponOrient",
    schema: WeaponOrientSchema,
    promptFile: "weapon_orient.md",
    toolFile: "weapon_orient.json",
  },
  {
    kind: "weapon_verify",
    name: "WeaponVerify",
    schema: WeaponVerifySchema,
    promptFile: "weapon_verify.md",
    toolFile: "weapon_verify.json",
  },
];
