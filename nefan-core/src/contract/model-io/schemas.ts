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
import { TILE_CELLS, TILE_MPC } from "../../scene/tile.js";
import { VocabularioDeEntity } from "./entity-vocabulary.js";

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

/** Por qué se rechaza un `footprint` en un NPC. La MISMA frase en el zod y en
 *  el espejo Python (`narrative_schemas.py`), como `MOTIVO_NAME_INVALIDO`: el
 *  modelo entra por las dos vías —MCP y API directa— y tiene que leer el mismo
 *  motivo por las dos. Lo canda `test/entity-vocabulary.test.ts`. */
/** El tope del `footprint` de un spawn, en celdas: el LADO DEL TILE. No es un
 *  número inventado —lo pedía el plan y con razón—: es el mismo suelo sobre el
 *  que se pone la cosa. Una caja más ancha que el tile lo vuelve sólido entero,
 *  y el gate de la escena ya acota por aquí (`topeDeFootprint` para los móviles,
 *  y el grid para el resto); el del spawn no acotaba por ninguna (QA de la PR 1,
 *  H-5: `[400,400]` pasaba los dos gates y salían 200×200 m sobre un tile de
 *  64). Viaja al espejo Python por `physics.json` (`tile_cells`), no copiado. */
export const TOPE_DE_FOOTPRINT_CELDAS = TILE_CELLS;

export const MOTIVO_FOOTPRINT_DEMASIADO_GRANDE =
  `un \`footprint\` no puede pasar de ${TILE_CELLS} celdas de lado (${TILE_CELLS * TILE_MPC} m, el lado del tile): ` +
  "lo que pones tiene que caber en el suelo sobre el que lo pones. Si querías algo enorme, " +
  "son varias entidades o un `building` del tamaño del tile";

/** Por qué se rechazan `role` y `style_ref` en algo que no es un `npc`. Los dos
 *  campos son de PERSONAJE —preset de conducta y ref de skin— y en un objeto no
 *  los lee nadie: aceptarlos en silencio deja al motor creyendo que puso algo
 *  hostil cuando puso una bolsa (QA de la PR 1, H-8). Simétrico del de abajo. */
export const MOTIVO_CAMPO_DE_NPC_EN_OTRA_CLASE =
  "`role` y `style_ref` son de PERSONAJE (la conducta y la ref de su skin) y solo valen en un " +
  "`entity_kind: \"npc\"`: en un objeto, un edificio o un item no los lee nadie. Si querías algo " +
  "hostil, ponlo como `npc` con `role: \"hostile\"`";

export const MOTIVO_FOOTPRINT_EN_NPC =
  "un `npc` no declara `footprint`: un personaje colisiona por el radio de su cuerpo, no por una huella. " +
  "Si lo que quieres es algo grande que se rodea, ponlo como `building` o `object` con su `footprint`";

const SpawnEntityConsequence = z
  .object({
    type: z.literal("spawn_entity"),
    entity_kind: z
      .enum(["npc", "building", "object", "item"])
      .describe(
        "Qué clase de cosa es, y con ello si el jugador la RODEA o la PISA: `building` y " +
          "`object` son sólidos (una forja, un carro, un yunque); `item` NO frena — se le " +
          "pasa por encima, que es lo que hace de algo un objeto suelto (una bolsa de " +
          "monedas, una llave caída, una carta en el suelo); `npc` es un personaje. El " +
          "tamaño lo afina `footprint`, no esto",
      ),
    footprint: z
      .tuple([z.number().int().min(1), z.number().int().min(1)])
      .optional()
      .describe(
        "Cuánto ocupa en el suelo: [ancho, fondo] en CELDAS de 0,5 m, enteros ≥ 1. Solo " +
          "afina el tamaño; lo que decide si frena es `entity_kind`. Ausente ⇒ el de su " +
          "clase (object 3×3 = 1,5 m, building 8×8 = 4 m, item 1×1 = 0,5 m). Un carro es " +
          "[6,6] y una moneda [1,1]. Un `npc` no lo declara",
      ),
    // El MISMO vocabulario que una entity de `generate_scene`
    // (entity-vocabulary.ts): `name` obligatorio y es el rótulo,
    // `description` opcional y es la procedencia (#397).
    name: VocabularioDeEntity.name,
    description: VocabularioDeEntity.description,
    position_hint: z.string().optional().describe("Pista de dónde aparece, p.ej. 'junto a la fuente'"),
    role: z
      .enum(NPC_ROLES)
      .optional()
      .describe(
        "NPCs: preset de conducta. Los cuatro ambientales (peasant/guard/villager/merchant) " +
          "deambulan; `hostile` ATACA al jugador y el motor del juego deriva su vida, arma y " +
          "agresividad — no las declaras tú. No es el oficio: un bandido o un lobo son " +
          "`hostile` y su identidad va en `name`/`description`. Ausente ⇒ villager",
      ),
    style_ref: z
      .string()
      .optional()
      .describe(
        "NPCs: id de la referencia de personaje de world.style_refs.characters que mejor " +
          "case con su aspecto (guía el skin IA). Ausente/desconocido cae al default por rol",
      ),
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

// La ÚNICA curación del jugador (#613, decisión del usuario 2026-09-29: «se
// cura por consecuencias»). Solo la cantidad: el tope, el muerto y el save son
// del juego, no del motor.
const PlayerHealedConsequence = z.object({
  type: z.literal("player_healed"),
  amount: z
    .number()
    .int()
    .min(1)
    .describe(
      "Puntos de vida que recupera el jugador (entero ≥ 1). El juego los topa en su máximo; " +
        "a un jugador muerto no le hace nada. Su vida actual está en context.player.health",
    ),
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
  PlayerHealedConsequence,
  NoopConsequence,
]);

export const MAX_CONSEQUENCES = 4;

/** Payload completo de una respuesta narrative_event. `dialogue` es SIEMPRE
 *  una entrada del array `consequences`, nunca un campo de nivel superior. */
export const NarrativeReactionSchema = z
  .object({
    consequences: z
      .array(ConsequenceSchema)
      .max(MAX_CONSEQUENCES)
      .describe(`Lista de consecuencias (máx ${MAX_CONSEQUENCES}). [] si no hay reacción`),
  })
  // La regla cruzada (`footprint` solo en lo que tiene huella) vive AQUÍ y no
  // en `SpawnEntityConsequence` por una restricción de zod, dicha para que
  // nadie la "arregle": un `.superRefine()` convierte el objeto en ZodEffects y
  // `z.discriminatedUnion` solo admite ZodObject, así que ponerla dentro deja
  // de compilar. El `path` completo la devuelve al motor igual de precisa.
  .superRefine((r, ctx) => {
    r.consequences.forEach((c, i) => {
      if (c.type !== "spawn_entity") return;
      const esNpc = c.entity_kind === "npc";
      if (esNpc && c.footprint !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consequences", i, "footprint"],
          message: MOTIVO_FOOTPRINT_EN_NPC,
        });
      }
      // El TECHO de la huella: el lado del tile. Va aquí y no como `.max()` en
      // el tuple porque el mensaje es la pieza que trabaja —este gate es el
      // único cuyo error vuelve al modelo— y un `.max()` solo sabe decir
      // «Number must be less than or equal to 128», sin metros ni salida.
      if (c.footprint !== undefined && Math.max(c.footprint[0], c.footprint[1]) > TOPE_DE_FOOTPRINT_CELDAS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consequences", i, "footprint"],
          message: MOTIVO_FOOTPRINT_DEMASIADO_GRANDE,
        });
      }
      // Y la simétrica: los campos de PERSONAJE solo valen en un personaje.
      for (const campo of ["role", "style_ref"] as const) {
        if (!esNpc && c[campo] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["consequences", i, campo],
            message: MOTIVO_CAMPO_DE_NPC_EN_OTRA_CLASE,
          });
        }
      }
    });
  });

export type Consequence = z.infer<typeof ConsequenceSchema>;
export type NarrativeReaction = z.infer<typeof NarrativeReactionSchema>;

// ── player_death (el motor decide dónde despierta el jugador, #613) ─────────

/** Motivo que vuelve al motor cuando pone un hostil en el despertar. */
export const MOTIVO_HOSTIL_EN_EL_DESPERTAR =
  "no despiertes al jugador con un hostil al lado: un `spawn_entity` con `role: \"hostile\"` " +
  "no cabe en un despertar. Si la historia pide amenaza, que llegue después, en otro turno";

/** Dónde despierta: un LUGAR del mapa o un PUNTO en metros de mundo. El juego
 *  lo valida (tile realizado, sitio libre, fuera del radio de todo hostil vivo)
 *  y, si no vale, te devuelve el motivo con la lista de lugares válidos. */
export const WakeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place"),
    place_id: z
      .string()
      .min(1)
      .describe("Id de un lugar de context.muerte.lugares: despierta en su sitio libre más cercano"),
  }),
  z.object({
    type: z.literal("point"),
    x: z.number().describe("Metros de mundo, eje X"),
    z: z.number().describe("Metros de mundo, eje Z"),
  }),
]);

/** La respuesta a un `player_death`: dónde despierta y qué pasa al despertar
 *  (las mismas consequences que un `narrative_event`, sin hostiles). */
export const DeathResolutionSchema = z
  .object({
    wake: WakeSchema.describe("Dónde despierta el jugador"),
    consequences: z
      .array(ConsequenceSchema)
      .max(MAX_CONSEQUENCES)
      .describe(`Qué pasa al despertar (máx ${MAX_CONSEQUENCES}). [] si nada`),
  })
  .superRefine((r, ctx) => {
    r.consequences.forEach((c, i) => {
      if (c.type === "spawn_entity" && c.role === "hostile") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["consequences", i, "role"],
          message: MOTIVO_HOSTIL_EN_EL_DESPERTAR,
        });
      }
    });
  });

export type Wake = z.infer<typeof WakeSchema>;
export type DeathResolution = z.infer<typeof DeathResolutionSchema>;

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
    kind: "player_death",
    name: "DeathResolution",
    schema: DeathResolutionSchema,
    promptFile: "player_death.md",
    toolFile: "narrative_wake.json",
  },
];
