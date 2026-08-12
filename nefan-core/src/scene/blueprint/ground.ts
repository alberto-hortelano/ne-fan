/** Rasgos del SUELO del plan de tile (`ground`) — la mitad "plana" del plan,
 *  el sustituto declarativo del extinto `map_ground` SVG. El motor narrativo
 *  declara caminos, plazas/parches, agua y decks como DATOS puros; el builder
 *  greybox los convierte en geometría plana three.js y la colisión
 *  (`ground-collision.ts`) sale de los polígonos declarados — nunca de
 *  píxeles pintados ni de rasterizar nada.
 *
 *  Unidades: celdas del tile (0..128, 1 celda = 0.5 m), como `volumes`.
 *  `label` es un sustantivo en español (guía del clasificador de visión). */

import { z } from "zod";
import { TILE_CELLS } from "../tile.js";

/** Coordenada de celda (admite fracción y un margen fuera del tile — un río
 *  que entra por el borde necesita puntos más allá de la costura). */
const cell = z.number().min(-16).max(TILE_CELLS + 16);
const at = z.tuple([cell, cell]);
/** [col, row, ancho, fondo] en celdas. */
const rect = z.tuple([
  cell,
  cell,
  z.number().positive().max(TILE_CELLS + 32),
  z.number().positive().max(TILE_CELLS + 32),
]);

const base = {
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(48).optional(),
};

export const GroundMaterialSchema = z.enum(["dirt", "cobble", "stone", "sand", "wood", "gravel", "grass"]);

/** Forma plana: exactamente una de rect | polygon | ellipse. */
const shapeFields = {
  rect: rect.optional(),
  polygon: z.array(at).min(3).max(32).optional(),
  ellipse: z.object({ center: at, rx: z.number().positive().max(96), ry: z.number().positive().max(96) }).optional(),
};

/** Camino: polilínea con ancho. */
export const GroundPathSchema = z
  .object({
    ...base,
    kind: z.literal("path"),
    points: z.array(at).min(2).max(16),
    /** Ancho en celdas (default 4). */
    w: z.number().positive().max(24).optional(),
    material: GroundMaterialSchema.optional(),
  })
  .strict();

/** Área de material: plazas, patios, parches de terreno. */
export const GroundAreaSchema = z
  .object({
    ...base,
    kind: z.literal("area"),
    ...shapeFields,
    material: GroundMaterialSchema,
  })
  .strict();

/** Agua: ríos, lagos, mar. BLOQUEA el paso (colisión declarativa). */
export const GroundWaterSchema = z
  .object({
    ...base,
    kind: z.literal("water"),
    ...shapeFields,
  })
  .strict();

/** Deck: puente/embarcadero/pasarela SOBRE el agua — transitable (perfora la
 *  colisión del agua) y pintado por encima. */
export const GroundDeckSchema = z
  .object({
    ...base,
    kind: z.literal("deck"),
    ...shapeFields,
    material: z.enum(["wood", "stone"]).optional(),
  })
  .strict();

export const GroundFeatureSchema = z
  .discriminatedUnion("kind", [
    GroundPathSchema,
    GroundAreaSchema,
    GroundWaterSchema,
    GroundDeckSchema,
  ])
  // Área/agua/deck necesitan EXACTAMENTE una forma (rect|polygon|ellipse). El
  // schema por sí solo las deja opcionales; sin esta regla un rasgo sin forma
  // se colaba (la comprobaba solo el validador a mano de narrative-mcp). Ahora
  // es autoritativa: scene y blueprint_review la heredan.
  .superRefine((f, ctx) => {
    if (f.kind === "path") return;
    const shapes = [f.rect, f.polygon, f.ellipse].filter((s) => s !== undefined).length;
    if (shapes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ground "${f.id}" (${f.kind}) necesita exactamente una de rect|polygon|ellipse (tiene ${shapes})`,
      });
    }
  });

/** Cap de rasgos de suelo por tile. */
export const MAX_GROUND_FEATURES = 64;

export const GroundSchema = z.array(GroundFeatureSchema).max(MAX_GROUND_FEATURES);

export type GroundFeature = z.infer<typeof GroundFeatureSchema>;
export type GroundPath = z.infer<typeof GroundPathSchema>;
export type GroundArea = z.infer<typeof GroundAreaSchema>;
export type GroundWater = z.infer<typeof GroundWaterSchema>;
export type GroundDeck = z.infer<typeof GroundDeckSchema>;

export type ParseGroundResult =
  | { ok: true; features: GroundFeature[] }
  | { ok: false; error: string };

/** Valida el array `ground` de un tile. Ids duplicados = error; las formas
 *  con shape necesitan EXACTAMENTE una de rect|polygon|ellipse. */
export function parseGround(raw: unknown): ParseGroundResult {
  const parsed = GroundSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `ground[${first.path.join(".")}]: ${first.message}` };
  }
  const seen = new Set<string>();
  for (const f of parsed.data) {
    if (seen.has(f.id)) return { ok: false, error: `ground: id duplicado "${f.id}"` };
    seen.add(f.id);
    if (f.kind !== "path") {
      const shapes = [f.rect, f.polygon, f.ellipse].filter((s) => s !== undefined).length;
      if (shapes !== 1) {
        return { ok: false, error: `ground: "${f.id}" necesita exactamente una de rect|polygon|ellipse (tiene ${shapes})` };
      }
    }
  }
  return { ok: true, features: parsed.data };
}

/** true si el plan declara agua (el prompt del repintado condiciona sus
 *  cláusulas de agua a esto — sustituye al regex sobre el SVG). */
export function groundHasWater(features: GroundFeature[]): boolean {
  return features.some((f) => f.kind === "water");
}
