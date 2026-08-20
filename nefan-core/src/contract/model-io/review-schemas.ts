/** Fuente única (zod) de los kinds de VISIÓN/REVIEW del modelo:
 *  scene_classify, image_review, stage_review, blueprint_review. Reemplazan a
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

// ── extras (compartido por image_review y stage_review, con unidad de `h`
//    distinta por vista: tile en celdas, plató en metros) ─────────────────────

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

// ── stage_review ──────────────────────────────────────────────────────────

const StageExpectedSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["found", "missing"]),
    box_px: BoxPx.optional().describe("Caja REAL pintada; obligatoria si status=found"),
  })
  .superRefine((e, ctx) => {
    if (e.status === "found" && e.box_px === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["box_px"], message: `expected "${e.id}" es found pero le falta box_px` });
    }
  });

const StageFloorSchema = z
  .object({
    wall_base_px: z.number().finite().positive().describe("y donde el suelo transitable toca la pared del fondo"),
    front_px: z.number().finite().optional().describe("y del borde delantero del suelo (opcional; debe ser > wall_base_px)"),
    left_wall_px: z.number().finite().optional(),
    right_wall_px: z.number().finite().optional(),
    left_front_px: z.number().finite().optional(),
    right_front_px: z.number().finite().optional(),
  })
  .superRefine((f, ctx) => {
    if (f.front_px !== undefined && f.front_px <= f.wall_base_px) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["front_px"], message: "front_px debe ser mayor que wall_base_px (el frente está MÁS ABAJO en la imagen)" });
    }
    const keys = ["left_wall_px", "right_wall_px", "left_front_px", "right_front_px"] as const;
    const present = keys.filter((k) => f[k] !== undefined);
    if (present.length > 0 && present.length < keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["left_wall_px"], message: `el trapecio del suelo necesita los 4 (${keys.join(", ")}) o ninguno` });
    }
    if (present.length === keys.length) {
      const lw = f.left_wall_px!, rw = f.right_wall_px!, lf = f.left_front_px!, rf = f.right_front_px!;
      if (lw >= rw) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["left_wall_px"], message: "left_wall_px debe ser < right_wall_px" });
      if (lf >= rf) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["left_front_px"], message: "left_front_px debe ser < right_front_px" });
      if (rw - lw >= rf - lf) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["right_wall_px"], message: "el suelo debe converger hacia el fondo: (right_wall-left_wall) < (right_front-left_front)" });
      }
    }
  });

export const StageReviewSchema = z.object({
  expected: z.array(StageExpectedSchema).describe("TODOS los ids de expected_elements, una vez cada uno"),
  extras: extrasArray("metros").optional().describe("Objetos inventados no declarados; [] u omitido si ninguno"),
  floor: StageFloorSchema.describe("Geometría del suelo pintado — calibra la perspectiva"),
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
export type StageReview = z.infer<typeof StageReviewSchema>;
export type BlueprintReview = z.infer<typeof BlueprintReviewSchema>;
