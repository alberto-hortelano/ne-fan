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
 *  `.passthrough()` a propósito en scene y entity: campos tolerados que el
 *  modelo puede seguir emitiendo (exits, ambient_event…) NO deben provocar
 *  rechazo (tolerancia: fixtures offline y saves viejos siguen pasando). El
 *  gate cubre lo que el modelo DEBE emitir bien, no lo que sobra. */

import { z } from "zod";
import { GroundSchema } from "../../scene/blueprint/ground.js";
import { VolumesSchema } from "../../scene/blueprint/volumes.js";
import { NPC_ROLES } from "../../simulation/npc-roles.js";

export const ENTITY_KINDS = ["building", "prop", "item", "tree", "npc", "player", "decor"] as const;
export const SCENE_BIOMES = ["grass", "forest_floor", "meadow", "sand", "dirt", "stone", "snow", "swamp"] as const;

export const EntitySchema = z
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
    description: z.string().min(1).optional(),
    // Ref de personaje del catálogo del pack (world.style_refs.characters)
    // ELEGIDA por el motor; sin ella, el default sale del `role`.
    style_ref: z.string().min(1).optional(),
  })
  .passthrough()
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

export const FormatDSceneSchema = z
  .object({
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
    entities: z.array(EntitySchema),
  })
  .passthrough()
  .superRefine((s, ctx) => {
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

export type FormatDScene = z.infer<typeof FormatDSceneSchema>;
