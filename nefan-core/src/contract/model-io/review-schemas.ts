/** Fuente única (zod) de los kinds de VISIÓN/REVIEW del modelo:
 *  scene_classify, image_review, blueprint_review. Reemplazan a
 *  los validadores a mano de narrative-mcp/validators.ts (que el pre-flight
 *  usaba como gate). Las comprobaciones que dependen del CONTEXTO de la
 *  petición (índices/ids esperados) siguen en el wrapper de validators.ts; el
 *  zod valida la FORMA (y las reglas internas: floor, trapecio, keep→tall/solid). */

import { z } from "zod";
import { GroundSchema } from "../../scene/blueprint/ground.js";
import { VolumesSchema } from "../../scene/blueprint/volumes.js";

const px = z.number().finite();
/** [x, y, ancho, alto] en píxeles; ancho/alto > 0. */
const BoxPx = z.tuple([px, px, z.number().finite().positive(), z.number().finite().positive()]);

// ── scene_classify ──────────────────────────────────────────────────────────

const SegmentSchema = z
  .object({
    index: z.number().int().min(0).describe("Índice de la región del overlay"),
    label: z.string().min(1).describe("Sustantivo corto en español"),
    solid: z.boolean().describe("true si un personaje a pie NO puede atravesarlo"),
    tall: z.boolean().describe("true si es más alto que un personaje (se dibuja por encima)"),
    element_id: z.string().min(1).optional().describe("id del volumen declarado al que pertenece (mismas partes = mismo id)"),
  })
  .strict();

export const SceneClassifySchema = z.object({
  segments: z.array(SegmentSchema).describe("Una entrada por CADA índice del overlay, exactamente una vez"),
});

// ── extras de image_review: objetos que el modelo de imagen INVENTÓ sobre el
//    tile repintado. `h` va en CELDAS del tile (el parámetro sobrevive al
//    plató, que las medía en metros, porque la unidad es contrato del prompt
//    y se lee en el `describe`). ────────────────────────────────────────────

function extrasArray(hUnit: string) {
  const keep = z.object({
    label: z.string().min(1),
    action: z.literal("keep"),
    box_px: BoxPx,
    tall: z.boolean().describe("true si es más alto que un personaje (gana oclusión)"),
    solid: z.boolean().describe("false solo para decoración atravesable"),
    h: z.number().positive().optional().describe(`Altura estimada en ${hUnit}`),
    depth_cells: z.number().positive().optional().describe("Profundidad de su base en celdas hacia el fondo"),
  });
  const remove = z.object({
    label: z.string().min(1),
    action: z.literal("remove"),
    box_px: BoxPx,
  });
  return z.array(z.discriminatedUnion("action", [keep, remove])).max(12).describe("Máx 12 objetos inventados por la imagen; [] si no inventó nada");
}

export const ImageReviewSchema = z.object({
  extras: extrasArray("celdas (un personaje ≈ 3.6)"),
});

// ── blueprint_review (referencia ground/volumes → NO entra en codegen de
//    prompt: el bloque de tipo sería enorme; se usa solo como validador) ──────

const EntityMoveSchema = z.object({
  id: z.string().min(1),
  cell: z.tuple([z.number(), z.number()]),
});

/** El suelo se corrige con `ground`. `.strict()` rechaza claves de fix
 *  desconocidas. */
const BlueprintFixesSchema = z
  .object({
    terrain: z.array(z.string()).optional(),
    entity_moves: z.array(EntityMoveSchema).optional(),
    ground: GroundSchema.optional(),
    volumes: VolumesSchema.optional(),
  })
  .strict();

export const BlueprintReviewSchema = z
  .object({
    approved: z.boolean(),
    issues: z.array(z.string()).optional(),
    fixes: BlueprintFixesSchema.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.approved === false && (!r.issues || r.issues.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["issues"], message: "approved=false requiere una lista `issues` no vacía explicando qué está mal" });
    }
  });

export type SceneClassify = z.infer<typeof SceneClassifySchema>;
export type ImageReview = z.infer<typeof ImageReviewSchema>;
export type BlueprintReview = z.infer<typeof BlueprintReviewSchema>;
