/** Volúmenes tipados del plan de tile (`volumes`) — la mitad "con altura" del
 *  blueprint. El motor narrativo declara CADA elemento vertical del tile como
 *  un volumen semántico (huella en celdas + altura + materiales); el
 *  compositor (`compose.ts`) los proyecta a la perspectiva de la sesión y la
 *  colisión (`collision.ts`) sale de las huellas — nunca de píxeles pintados.
 *
 *  Unidades: celdas del tile (0..128, 1 celda = 0.5 m), alturas también en
 *  celdas. `label` es un sustantivo en español (hereda el rol del antiguo
 *  `data-label`: guía del clasificador de visión). */

import { z } from "zod";
import { TILE_CELLS } from "../tile.js";

/** Coordenada de celda (admite fracción — media celda importa en props). */
const cell = z.number().min(-8).max(TILE_CELLS + 8);
const cellStrict = z.number().min(0).max(TILE_CELLS);
const at = z.tuple([cell, cell]);
/** [col, row, ancho, fondo] en celdas. */
const rect = z.tuple([cellStrict, cellStrict, z.number().positive().max(TILE_CELLS), z.number().positive().max(TILE_CELLS)]);

const base = {
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(48),
};

export const RoofKindSchema = z.enum(["gable", "hip", "shed", "flat", "none"]);
export const RoofMaterialSchema = z.enum(["slate", "tile", "thatch", "wood"]);
export const WallMaterialSchema = z.enum(["timber", "stone", "wood", "plaster"]);
export const DoorEdgeSchema = z.enum(["n", "s", "e", "w"]);

export const BuildingSchema = z
  .object({
    ...base,
    type: z.literal("building"),
    rect,
    /** Altura de muros en celdas (default 5). */
    wall_h: z.number().positive().max(24).optional(),
    roof: z
      .object({
        kind: RoofKindSchema,
        /** Eje del caballete: "x" (a lo largo de col) o "y". Default: lado largo. */
        axis: z.enum(["x", "y"]).optional(),
        material: RoofMaterialSchema.optional(),
        /** Override de color (hex) — armoniza con el estilo del mundo. */
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .optional(),
    walls: z
      .object({
        material: WallMaterialSchema.optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      })
      .optional(),
    /** Puertas: hueco en el muro. `at` = celdas desde la esquina NO del lado. */
    doors: z
      .array(z.object({ edge: DoorEdgeSchema, at: z.number().min(0).max(TILE_CELLS), w: z.number().positive().max(16).optional() }))
      .max(8)
      .optional(),
    /** Cutaway (edificio interactivo): sin techo y muros frontales bajos —
     *  el jugador ve el interior. Los muebles interiores son `prop`s. */
    cutaway: z.boolean().optional(),
  })
  .strict();

export const WallSchema = z
  .object({
    ...base,
    type: z.literal("wall"),
    /** Polilínea del eje del muro, en celdas. */
    points: z.array(at).min(2).max(24),
    /** Grosor en celdas (default 3). */
    width: z.number().positive().max(12).optional(),
    h: z.number().positive().max(24).optional(),
    crenellated: z.boolean().optional(),
  })
  .strict();

export const TowerSchema = z
  .object({
    ...base,
    type: z.literal("tower"),
    at,
    r: z.number().positive().max(16).optional(),
    h: z.number().positive().max(32).optional(),
    crenellated: z.boolean().optional(),
  })
  .strict();

/** Puerta monumental (arco) sobre un tramo de muro: hueco transitable. El
 *  compositor pinta el cuerpo con arco; la colisión deja el vano libre. */
export const GateSchema = z
  .object({
    ...base,
    type: z.literal("gate"),
    at,
    /** Ancho del vano en celdas (default 8). */
    w: z.number().positive().max(24).optional(),
    h: z.number().positive().max(24).optional(),
    /** Orientación del muro que atraviesa: "x" = muro que corre a lo largo
     *  de col (el vano se cruza andando en fila), "y" = a lo largo de row. */
    orient: z.enum(["x", "y"]),
    banners: z.boolean().optional(),
  })
  .strict();

export const TreeSchema = z
  .object({ ...base, type: z.literal("tree"), at, s: z.number().min(0.4).max(2.5).optional(), species: z.string().max(32).optional() })
  .strict();

export const BushSchema = z
  .object({ ...base, type: z.literal("bush"), at, s: z.number().min(0.4).max(2.5).optional() })
  .strict();

export const RockSchema = z
  .object({ ...base, type: z.literal("rock"), at, s: z.number().min(0.4).max(4).optional() })
  .strict();

export const FountainSchema = z
  .object({ ...base, type: z.literal("fountain"), at, r: z.number().positive().max(12).optional() })
  .strict();

/** Fallback genérico: caja o cilindro con altura y color — mesas, barriles,
 *  cajas, pozos, puestos, letreros... Colisiona salvo `passable`. */
export const PropSchema = z
  .object({
    ...base,
    type: z.literal("prop"),
    at: at.optional(),
    rect: rect.optional(),
    shape: z.enum(["box", "cylinder"]),
    h: z.number().positive().max(16).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** true = decorativo, no bloquea (alfombras, toldos). */
    passable: z.boolean().optional(),
  })
  .strict();

export const VolumeSchema = z.discriminatedUnion("type", [
  BuildingSchema,
  WallSchema,
  TowerSchema,
  GateSchema,
  TreeSchema,
  BushSchema,
  RockSchema,
  FountainSchema,
  PropSchema,
]);

/** Cap de volúmenes por tile (un pueblo denso ronda 80–120). */
export const MAX_VOLUMES = 160;

export const VolumesSchema = z.array(VolumeSchema).max(MAX_VOLUMES);

export type Volume = z.infer<typeof VolumeSchema>;
export type BuildingVolume = z.infer<typeof BuildingSchema>;
export type WallVolume = z.infer<typeof WallSchema>;
export type TowerVolume = z.infer<typeof TowerSchema>;
export type GateVolume = z.infer<typeof GateSchema>;
export type TreeVolume = z.infer<typeof TreeSchema>;
export type PropVolume = z.infer<typeof PropSchema>;

export type ParseVolumesResult =
  | { ok: true; volumes: Volume[] }
  | { ok: false; error: string };

/** Valida el array `volumes` de un tile. Ids duplicados = error (los usa la
 *  segmentación y el seed del detalle procedural). */
export function parseVolumes(raw: unknown): ParseVolumesResult {
  const parsed = VolumesSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `volumes[${first.path.join(".")}]: ${first.message}` };
  }
  const seen = new Set<string>();
  for (const v of parsed.data) {
    if (seen.has(v.id)) return { ok: false, error: `volumes: id duplicado "${v.id}"` };
    seen.add(v.id);
    if (v.type === "prop" && (v.at !== undefined) === (v.rect !== undefined)) {
      return { ok: false, error: `volumes: prop "${v.id}" necesita exactamente uno de \`at\` o \`rect\`` };
    }
  }
  return { ok: true, volumes: parsed.data };
}
