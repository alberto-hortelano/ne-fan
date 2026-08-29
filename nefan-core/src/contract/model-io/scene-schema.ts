/** Zod de una escena Format D — el GATE estructural fail-loud del pre-flight.
 *
 *  Hasta ahora la única "validación" del top-level de una escena era
 *  ai_server/validate_scene_response, que DEGRADABA en silencio (terrain no
 *  lista → todo hierba, filas mal → padding, entities malformadas → clamp…),
 *  así que un error de forma del modelo nunca volvía al modelo. Este schema lo
 *  valida en el pre-flight MCP y devuelve el error preciso para re-responder.
 *
 *  Alcance: FORMA estructural (entities, tile, biome) + las sub-partes
 *  tipadas (ground/volumes reutilizan su propio zod). La JUGABILIDAD
 *  (flood-fill, alcanzabilidad, costuras de tile) la sigue validando
 *  scene-validate.ts; aquí no se duplica.
 *
 *  Format D tiene UNA variante y este schema es su candado: el `tile` del
 *  mundo continuo. La "suelta" (`size`/`terrain` a elección del motor, sin
 *  sitio en el plano) se retiró con el issue #172, y el `stage` proscenio con
 *  la vista que lo pintaba: una escena sin `tile` es un error de contrato, no
 *  una escena pequeña.
 *
 *  `.passthrough()` a nivel ESCENA y `.strict()` en la entity, y la asimetría
 *  está medida, no razonada: el passthrough de escena sostiene campos vivos
 *  que el zod aún no declara (`ambient_event` en las 3 fixtures commiteadas;
 *  `__expanded`, `structures` y `place_anchors` en los snapshots, más
 *  `terrain_patches` en el espejo Python) — declararlos y cerrarlo es otro
 *  issue; el de la entity no sostenía NINGUNO — censadas las 95
 *  entities de las 7 escenas Format D del árbol (fixtures, snapshots, saves,
 *  labs), cero claves fuera de las 12. Un passthrough que no protege tráfico
 *  legítimo solo se traga las erratas del modelo, y ese es justo el
 *  fail-silent que este gate existe para cerrar (#259). */

import { z } from "zod";
import { GroundSchema } from "../../scene/blueprint/ground.js";
import { VegetationZonesSchema } from "../../scene/blueprint/vegetation.js";
import { VolumesSchema } from "../../scene/blueprint/volumes.js";
import { parseScatter } from "../../scene/blueprint/scatter.js";
import { NPC_ROLES } from "../../simulation/npc-roles.js";

export const ENTITY_KINDS = ["building", "prop", "item", "tree", "npc", "player", "decor"] as const;
export const SCENE_BIOMES = ["grass", "forest_floor", "meadow", "sand", "dirt", "stone", "snow", "swamp"] as const;

/** Mensaje de la clave desconocida. Va por `errorMap` y no por `.strict(msg)`
 *  porque ese solo admite texto fijo: aquí hay que nombrar LA clave que sobra
 *  y la entity que la trae, que es lo accionable cuando el tile llega con
 *  ochenta. Mismo criterio que el `superRefine` de `role` (que no corre en
 *  este caso: si el objeto falla por clave desconocida, zod no llega al
 *  refinamiento). */
const entityErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code !== z.ZodIssueCode.unrecognized_keys) return { message: ctx.defaultError };
  const id = (ctx.data as { id?: unknown } | null)?.id;
  const quien = typeof id === "string" && id ? `la entity "${id}"` : "una entity";
  return {
    message:
      `${quien} trae ${issue.keys.length === 1 ? "la clave" : "las claves"} ` +
      `${issue.keys.map((k) => `\`${k}\``).join(", ")}, que no existe${issue.keys.length === 1 ? "" : "n"} ` +
      `en el contrato. Una entity tiene EXACTAMENTE estos campos: ${ENTITY_FIELDS.join(" | ")}. ` +
      `Lo que quisieras contar de ella va en \`description\`, que es de donde sale su aspecto.`,
  };
};

const EntityBase = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ENTITY_KINDS),
    name: z.string(),
    // Celda [col,row]: admite fracción (colocación fina — media celda importa
    // en el z-order y en props pequeños), como los `at` de volumes.
    cell: z.tuple([z.number(), z.number()]),
    footprint: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    glyph: z.string().length(1),
    shape: z.enum(["box", "cylinder", "sphere", "cone"]).optional(),
    h: z.number().positive().optional(),
    attach: z.literal("wall").optional(),
    // ── NPCs: con qué se viste y cómo se comporta ────────────────────────
    // `role` NO es el oficio: es el preset de conducta que el sim implementa
    // (NPC_ROLES, la misma lista que el enum de `spawn_entity` — un NPC no
    // puede declarar su oficio con un vocabulario en un tool y con otro en el
    // vecino). Vocabulario CERRADO a propósito: un `role: "herrero"` no
    // degradaría a villager en silencio, se le devuelve al motor. El oficio
    // viaja en `name` y en `description`, que es de donde sale el prompt del
    // skin IA.
    //
    // `z.string()` + refinamiento en vez de `z.enum(NPC_ROLES)`, y no es un
    // aflojamiento: la lista es la misma y el rechazo también. Lo que cambia
    // es el MENSAJE, que aquí es la pieza que trabaja — este gate es el único
    // cuyo error vuelve al modelo, y `formatError` solo le enseña el PRIMER
    // issue. Un enum solo sabe decir «entities[37].role: Invalid enum value»;
    // el refinamiento tiene la entity entera delante, así que puede nombrar
    // al NPC por su id y decir dónde va el oficio — que es lo accionable
    // cuando el tile trae ochenta entidades. Espejo exacto del mensaje que da
    // `clean_ent` en ai_server.
    role: z.string().min(1).optional(),
    // `description` es el PROMPT del skin del personaje (aspecto, no
    // biografía). Opcional en el zod y exigida en la prosa del prompt: este
    // schema canda también las fixtures de `data/scenes/`, y las 14 sondas de
    // z-order de zorder_test.json no tienen aspecto que describir ni deben
    // pagar un skin. Sin ella, el prompt del skin es el nombre propio del
    // NPC («Beltrán»), que no describe a nadie.
    // `.trim().min(1)` y no `.min(1)` a secas: sin el trim, una description de
    // tres espacios pasaba este gate y el saneador de ai_server la tiraba al
    // hacer `.strip()` — el mismo NPC aceptado aquí y desvestido allí. Los dos
    // lados rechazan ahora lo mismo (#237).
    description: z.string().trim().min(1).optional(),
    // Ref de personaje del catálogo del pack (world.style_refs.characters)
    // ELEGIDA por el motor; sin ella, el default sale del `role`.
    style_ref: z.string().min(1).optional(),
  }, { errorMap: entityErrorMap });

/** Los campos de una entity, DERIVADOS del shape — no una copia a mano que se
 *  quede atrás. Los lee el mensaje de error y el guardia de campos JSON→zod
 *  de `contract-prompts.test.ts`. */
export const ENTITY_FIELDS = Object.keys(EntityBase.shape) as readonly string[];

export const EntitySchema = EntityBase
  // CERRADO (#259): una clave que no esté entre las 12 vuelve al modelo con su
  // nombre en vez de caerse por el desagüe. La poda muda de `clean_ent` en
  // ai_server hacía lo mismo por el otro lado y es su espejo exacto.
  .strict()
  .superRefine((e, ctx) => {
    if (e.role === undefined || (NPC_ROLES as readonly string[]).includes(e.role)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["role"],
      message:
        `el NPC "${e.id}" declara role "${e.role}", que no es un rol de conducta. ` +
        `Los únicos son ${NPC_ROLES.join(" | ")} (los mismos que en spawn_entity). ` +
        `El oficio —herrero, alcaldesa, molinero— va en \`name\` y en \`description\`, ` +
        `que es de donde sale su aspecto; \`role\` solo elige cómo se comporta.`,
    });
  });

export const SceneSizeSchema = z.object({
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
  meters_per_cell: z.number().positive(),
});

const TerrainLegendEntry = z.union([
  z.string(),
  z.object({ name: z.string(), solid: z.boolean().optional() }).passthrough(),
]);
export const TerrainLegendSchema = z.record(TerrainLegendEntry);

const TileCoordSchema = z.object({ tx: z.number().int(), ty: z.number().int() });

/** Lo que las DOS poblaciones tienen en común. Está fuera de los dos schemas
 *  a propósito: la frontera entre lo que el modelo EMITE y lo que el juego
 *  CARGA se cruza una sola vez, en `expandScenePrimitives`, y hasta hoy no
 *  tenía tipo por ninguno de los dos lados. */
const sceneBaseShape = {
  scene_id: z.string().min(1),
  scene_description: z.string().min(1),
  place_id: z.string().min(1).optional(),
  tile: TileCoordSchema.optional(),
  biome: z.enum(SCENE_BIOMES).optional(),
  size: SceneSizeSchema.optional(),
  terrain: z.array(z.string()).optional(),
  terrain_legend: TerrainLegendSchema.optional(),
  ground: GroundSchema.optional(),
  volumes: VolumesSchema.optional(),
  // Vegetación de masa: el MISMO zod que compone el plan
  // (blueprint/vegetation.ts), no una copia con las mismas reglas. Su
  // `density` va en ejemplares/m² con un tope derivado de la geometría del
  // paso del jugador: un bosque intransitable no se puede pedir.
  vegetation_zones: VegetationZonesSchema.optional(),
  // Scatter (#203): estaba en `generate_scene.json` y NO en el zod, así que el
  // tool se lo ofrecía al modelo y el gate no sabía ni que existía. Se cierra
  // llevando el zod al JSON, nunca al revés — el campo está vivo y lo consumen
  // scene-expand, blueprint/scatter y fps-spec.
  //
  // La FORMA aquí es deliberadamente abierta porque la comprobación de verdad
  // la hace `refineScatter` más abajo con `parseScatter`, el MISMO validador
  // fail-loud que ya corre en producción (`scene-validate.ts`). La alternativa
  // era escribir un zod paralelo con sus reglas: un SEXTO espejo del contrato,
  // que es justo la enfermedad que esta tanda vino a tratar. Un `z.unknown()`
  // a secas sí sería verde que no comprueba nada; con el refinamiento no lo es.
  scatter_generators: z.unknown().optional(),
  scatter_zones: z.unknown().optional(),
  entities: z.array(EntitySchema),
} as const;

/** Delega en `parseScatter` (blueprint/scatter.ts) — su mensaje ya trae la
 *  ruta exacta (`scatter_zones[0].shape.pts[2]: …`) y está congelado en el
 *  golden de scene-validate, así que se propaga tal cual. Los dos campos se
 *  validan juntos porque una zona nombra a su generador: por separado no se
 *  puede contestar si la escena es válida. */
function refineScatter(
  s: { scatter_generators?: unknown; scatter_zones?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (s.scatter_generators === undefined && s.scatter_zones === undefined) return;
  const r = parseScatter(s.scatter_generators, s.scatter_zones);
  if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: r.error });
}

/** Los campos de nivel superior de una escena, DERIVADOS del shape. Los lee el
 *  guardia JSON→zod de `contract-prompts.test.ts`: un campo que
 *  `generate_scene.json` le ofrezca al modelo y que no esté aquí pone rojo. */
export const SCENE_FIELDS = Object.keys(sceneBaseShape) as readonly string[];

/** Lo que el motor EMITE (pre-expansión) — el gate del pre-flight MCP, cuyo
 *  error vuelve al modelo. Sus reglas describen al MODELO: un tile no lleva
 *  `size` ni grid `terrain`, y `style_ref` de escena está retirada. NO
 *  describen lo que hay en disco: los snapshots de los juegos (world/tile.json) son
 *  POST-expansión y llevan las tres cosas legítimamente — eso lo vigila
 *  `ExpandedSceneSchema`, y confundirlas rompe el arranque (#237). */
export const EmittedSceneSchema = z
  .object(sceneBaseShape)
  .passthrough()
  .superRefine((s, ctx) => {
    refineScatter(s, ctx);
    // CANDADO de las variantes retiradas: Format D tiene UNA forma y ninguna
    // más. Sin `tile` la escena era la "suelta" (size/terrain a elección del
    // motor, sin sitio en el mundo) o el `stage` proscenio. El error va en la
    // RAÍZ: el pre-flight de narrative-mcp se lo devuelve al modelo para que
    // re-responda con la que toca.
    if (s.tile === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message:
          "una escena necesita `tile` {tx,ty}: es la única variante de Format D " +
          "(mundo continuo, pídela con generate_tile)",
      });
      return;
    }
    // Un tile NO lleva size/terrain (la base es biome + primitivas; el engine
    // sintetiza el grid). Es exactamente lo que prepareTileBase exige.
    if (s.size !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["size"], message: "un tile no lleva `size` (la base es `biome` + primitivas)" });
    }
    if (Array.isArray(s.terrain) && s.terrain.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["terrain"], message: "un tile no lleva grid `terrain` completo (usa `biome` + `ground`/`volumes`)" });
    }
    if (s.biome === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["biome"], message: "un tile necesita `biome`" });
    }
    // `style_ref` de ESCENA: retirado. Elegía la lámina temática que guiaba
    // el repintado del tile, y ese repintado murió con la vista oblicua — la
    // primera persona no consume una sola de esas refs (su arte sale de
    // style_token + lámina de superficies + refs de CARA). El motor lo lleva
    // en su historial y va a seguir emitiéndolo un rato: como `.passthrough()`
    // lo dejaría entrar y scene-normalize lo tiraría después, el eje era
    // FAIL-SILENT. Aquí se rebota con el motivo (regla del repo: salida
    // inválida del modelo → error preciso y re-respuesta). OJO: la `style_ref`
    // de ENTIDAD (npc) sigue viva — elige el aspecto del skin.
    if ("style_ref" in s) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["style_ref"],
        message:
          "`style_ref` de escena está retirado (no existe catálogo world.style_refs.scene): " +
          "quítalo. Para guiar el arte usa `surface_ref` por cara de volumen y `style_ref` en los NPCs",
      });
    }
  });

export type EmittedScene = z.infer<typeof EmittedSceneSchema>;

/** Lo que el juego CARGA (post-expansión) — la otra población, la que vive en
 *  el `world/tile.json` de cada juego y entra por `loadWorldSnapshot`.
 *
 *  Hasta #237 no tenía tipo ninguno (`z.record(z.string(), z.unknown())` en
 *  `WorldSnapshotSchema.scenes`), y como el único schema de escena que existía
 *  describía la población CONTRARIA, apuntarlo a los snapshots rechazaba 20 de
 *  20 y dejaba al juego sin mundo pre-generado. Por eso aquí:
 *
 *  - Se EXIGE lo que escribe `expandScenePrimitives` y sin lo cual el cliente
 *    no puede pintar: `size`, `terrain` no vacío, `terrain_legend` y la marca
 *    `__expanded`, que es la frontera y ya existía en el dato desde siempre.
 *  - NO se re-litiga nada del modelo. En concreto NO se rechaza `style_ref` de
 *    escena: 18 de los 20 tiles del árbol la llevan heredada de antes de su
 *    retirada, y rebotarlos aquí no arregla un contrato — apaga el arranque.
 *    Ese eje se vigila donde se emite, no donde se lee.
 *
 *  Dos tipos con nombre y no una variante con flag: con un flag, un consumidor
 *  puede preguntar por la población equivocada y seguir compilando. */
export const ExpandedSceneSchema = z
  .object({
    ...sceneBaseShape,
    size: SceneSizeSchema,
    terrain: z.array(z.string()).min(1),
    terrain_legend: TerrainLegendSchema,
    /** La frontera, y la escribe `expandScenePrimitives` (scene-expand.ts).
     *  `z.literal(true)` y no `z.boolean()`: una escena a medio expandir no es
     *  una escena cargable. */
    __expanded: z.literal(true),
  })
  .passthrough();

export type ExpandedScene = z.infer<typeof ExpandedSceneSchema>;
