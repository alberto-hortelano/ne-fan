/** Rasgos del SUELO del plan de tile (`ground`) — la mitad "plana" del plan,
 *  el sustituto declarativo del extinto `map_ground` SVG. El motor narrativo
 *  declara caminos, plazas/parches, agua y decks como DATOS puros; el builder
 *  greybox los convierte en geometría plana three.js y la colisión
 *  (`ground-collision.ts`) sale de los polígonos declarados — nunca de
 *  píxeles pintados ni de rasterizar nada. La única excepción a "plano" es
 *  `hill`: relieve suave declarable (fps-relief.ts), sin efecto en colisión.
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

/** Cap de altura declarable de una colina/hondonada (metros). */
export const HILL_MAX_H_M = 6;

/** Colina/hondonada: relieve SUAVE del suelo. `h` en METROS (positivo =
 *  loma, negativo = hondonada), rampa suave hacia el borde de la forma.
 *  Presentación pura: la colisión sigue plana, se aplana bajo lo construido
 *  (volúmenes/caminos/áreas/agua) y muere en las costuras del tile. Hoy solo
 *  la vista fps la levanta; el clay cenital la ignora. */
export const GroundHillSchema = z
  .object({
    ...base,
    kind: z.literal("hill"),
    ...shapeFields,
    /** Altura en metros, |h| ≤ 6 y ≠ 0. */
    h: z
      .number()
      .min(-HILL_MAX_H_M)
      .max(HILL_MAX_H_M)
      .refine((v) => v !== 0, { message: "h debe ser distinto de 0" }),
  })
  .strict();

export const GroundFeatureSchema = z
  .discriminatedUnion("kind", [
    GroundPathSchema,
    GroundAreaSchema,
    GroundWaterSchema,
    GroundDeckSchema,
    GroundHillSchema,
  ])
  // Área/agua/deck necesitan EXACTAMENTE una forma (rect|polygon|ellipse). El
  // schema por sí solo las deja opcionales; sin esta regla un rasgo sin forma
  // se colaba (la comprobaba solo el validador a mano de narrative-mcp). Ahora
  // es autoritativa: la escena Format D la hereda.
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

/** Presupuesto de mallas planas por tile (#264). Puerto emite 57 y Robledo 14;
 *  128 permite dos suelos de la complejidad del puerto más 14 piezas. Es un
 *  presupuesto de geometría, no una promesa de FPS; medida en docs/arquitectura/vistas.md. */
export const MAX_GROUND_PRIMS = 128;
/** El builder omite los segmentos degenerados; el contador usa la misma cota. */
export const MIN_GROUND_SEGMENT_LENGTH = 1e-3;

/** Cuenta antes de construir: juntas + segmentos de paths; una pieza por
 *  forma plana. Las colinas deforman la malla existente, sin primitivas nuevas. */
export function groundPrimCount(features: readonly GroundFeature[]): number {
  let total = 0;
  for (const f of features) {
    switch (f.kind) {
      case "hill": break;
      case "area": case "water": case "deck": total++; break;
      case "path":
        total += f.points.length;
        for (let i = 1; i < f.points.length; i++) {
          const [x, z] = f.points[i];
          const [px, pz] = f.points[i - 1];
          if (Math.hypot(x - px, z - pz) >= MIN_GROUND_SEGMENT_LENGTH) total++;
        }
        break;
      default: { const imposible: never = f; return imposible; }
    }
  }
  return total;
}

export const GroundSchema = z.array(GroundFeatureSchema).max(MAX_GROUND_FEATURES).superRefine((features, ctx) => {
  const prims = groundPrimCount(features);
  if (prims > MAX_GROUND_PRIMS) ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `ground genera ${prims} primitivas planas; máximo ${MAX_GROUND_PRIMS} por tile. Reduce el número de caminos o sus puntos: cada camino emite una junta por punto y una caja por segmento no degenerado.`,
  });
}).describe(`At most ${MAX_GROUND_PRIMS} flat primitives per tile: a path emits one joint per point and one box per non-degenerate segment; area/water/deck emit one each, hill emits none.`);

export type GroundFeature = z.infer<typeof GroundFeatureSchema>;

/** CAPA plana del suelo: todo rasgo menos `hill`, que no es una capa sino
 *  relieve del terreno (no emite prim plana). Cada capa tiene UNA elevación,
 *  declarada en la tabla del builder (`greybox.ts`), y de esa tabla sale el
 *  techo del suelo. Añadir un `kind` plano al schema rompe la compilación de
 *  la tabla hasta que se le da su capa: es la única forma de que el techo
 *  siga siendo cierto. */
export type GroundLayer = Exclude<GroundFeature["kind"], "hill">;
export type GroundPath = z.infer<typeof GroundPathSchema>;
export type GroundArea = z.infer<typeof GroundAreaSchema>;
export type GroundWater = z.infer<typeof GroundWaterSchema>;
export type GroundDeck = z.infer<typeof GroundDeckSchema>;
export type GroundHill = z.infer<typeof GroundHillSchema>;

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
