/** Zod de una escena Format D — el GATE estructural fail-loud del pre-flight.
 *
 *  Hasta ahora la única "validación" del top-level de una escena era
 *  ai_server/validate_scene_response, que DEGRADABA en silencio (terrain no
 *  lista → todo hierba, filas mal → padding, entities malformadas → clamp…),
 *  así que un error de forma del modelo nunca volvía al modelo. Este schema lo
 *  valida en el pre-flight MCP y devuelve el error preciso para re-responder.
 *
 *  Alcance: FORMA estructural (entities, size, terrain, legend, tile, biome) +
 *  las sub-partes tipadas (ground/volumes/stage reutilizan su propio zod). La
 *  JUGABILIDAD (flood-fill, alcanzabilidad, costuras de tile, exits de plató)
 *  la sigue validando scene-validate.ts; aquí no se duplica.
 *
 *  `.passthrough()` a propósito en scene y entity: campos legacy/retirados
 *  (terrain_features, room_id, style_tag, exits, ambient_event…) NO deben
 *  provocar rechazo (tolerancia: fixtures offline y saves viejos siguen
 *  pasando). El gate cubre lo que el modelo DEBE emitir bien, no lo que sobra. */

import { z } from "zod";
import { GroundSchema } from "../../scene/blueprint/ground.js";
import { VolumesSchema } from "../../scene/blueprint/volumes.js";
import { StageBlockSchema } from "../../scene/stage/schema.js";

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
    texture_hash: z.string().optional(),
    model_hash: z.string().optional(),
    attach: z.literal("wall").optional(),
  })
  .passthrough();

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
    stage: StageBlockSchema.optional(),
    entities: z.array(EntitySchema),
  })
  .passthrough()
  .superRefine((s, ctx) => {
    const isTile = s.tile !== undefined;
    if (isTile) {
      // Un tile NO lleva size/terrain (la base es biome + primitivas; el
      // engine sintetiza el grid). Es exactamente lo que prepareTileBase exige.
      if (s.size !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["size"], message: "un tile no lleva `size` (la base es `biome` + primitivas)" });
      }
      if (Array.isArray(s.terrain) && s.terrain.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["terrain"], message: "un tile no lleva grid `terrain` completo (usa `biome` + `ground`/`volumes`)" });
      }
      if (s.biome === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["biome"], message: "un tile necesita `biome`" });
      }
    } else {
      // Escena/plató: el grid es la base. size y terrain van juntos y las
      // filas deben cuadrar EXACTAMENTE (antes el saneador Python rellenaba/
      // truncaba en silencio — la causa de mapas deformados).
      if (s.size !== undefined && s.terrain === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["terrain"], message: "falta el grid `terrain` (una escena con `size` lo necesita)" });
      }
      if (s.terrain !== undefined && s.size === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["size"], message: "falta `size` (un grid `terrain` necesita sus dimensiones)" });
      }
      if (s.size && Array.isArray(s.terrain)) {
        if (s.terrain.length !== s.size.rows) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["terrain"], message: `terrain tiene ${s.terrain.length} filas pero size.rows=${s.size.rows}` });
        }
        s.terrain.forEach((row, i) => {
          if (row.length !== s.size!.cols) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["terrain", i], message: `terrain[${i}] tiene ${row.length} chars pero size.cols=${s.size!.cols}` });
          }
        });
      }
    }
  });

export type FormatDScene = z.infer<typeof FormatDSceneSchema>;
