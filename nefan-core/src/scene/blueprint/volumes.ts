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

/** Rotación en GRADOS alrededor del centro de la huella, positivo antihorario
 *  visto desde arriba (mismo signo que `rotY`). Las casas de un pueblo real no
 *  comparten retícula: ±5..±30° rompen la monotonía. Solo building/prop; los
 *  builders convierten a radianes una única vez. */
const angle = z.number().min(-180).max(180);

/** Descripción de la SUPERFICIE visible del volumen para la vista fps: si
 *  está, las caras del CUERPO se pintan como celda "hero" única del atlas con
 *  esta descripción (p. ej. "facade with a faded mural of a sun"), y la
 *  textura resultante entra en la librería de superficies reutilizable.
 *  Opcional siempre — sin ella la superficie se deriva del material/color.
 *  Inglés recomendado (es un prompt de imagen). */
const surfaceDescStr = z.string().min(1).max(200);

/** Forma objeto: una descripción DISTINTA por cara/rol (cada una es su propia
 *  imagen — el hash del asset es la descripción). Claves: `n|s|e|w` caras
 *  laterales individuales en el marco LOCAL del volumen (pre-`angle`, mismo
 *  vocabulario que `doors[].edge`); `side` = todas las laterales (equivale a
 *  la forma string); `roof` tejado; `door` puertas; `caps` hastiales del
 *  gable / tapa de un prism; `top` cara superior de un prop/prism. Las caras
 *  sin descripción usan su material derivado (teja, madera…). */
const surfaceDescFaces = z
  .object({
    side: surfaceDescStr.optional(),
    n: surfaceDescStr.optional(),
    s: surfaceDescStr.optional(),
    e: surfaceDescStr.optional(),
    w: surfaceDescStr.optional(),
    roof: surfaceDescStr.optional(),
    door: surfaceDescStr.optional(),
    caps: surfaceDescStr.optional(),
    top: surfaceDescStr.optional(),
  })
  .strict()
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: "surface_desc objeto necesita al menos una cara",
  });

const surfaceDesc = z.union([surfaceDescStr, surfaceDescFaces]);

export type SurfaceDescFaces = z.infer<typeof surfaceDescFaces>;
export type SurfaceDesc = z.infer<typeof surfaceDesc>;

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
    /** Incompatible con `cutaway` (el anillo de muros/puertas es axis-aligned
     *  y rotar el edificio jugable perjudica la navegación). */
    angle: angle.optional(),
    surface_desc: surfaceDesc.optional(),
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
    surface_desc: surfaceDesc.optional(),
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

/** Tope EFECTIVO de escala de árbol: por encima la copa domina el tile (a
 *  s=2.5 ronda los 13 m de diámetro). El schema sigue aceptando hasta 2.5
 *  para no rechazar planes/saves existentes — parseVolumes clampa. */
export const TREE_MAX_S = 1.8;

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
    /** Solo con `rect` (un `at` es un punto: no hay nada que rotar). */
    angle: angle.optional(),
    surface_desc: surfaceDesc.optional(),
  })
  .strict();

/** Geometría LIBRE: un contorno poligonal arbitrario extruido a una altura.
 *  La escotilla para lo que ningún preset expresa (el arco de un muro de torre
 *  derruida, un ala en L, una plataforma irregular). El greybox lo extruye y la
 *  imagen IA lo repinta; el modelo declara `solid`/`tall` (no se infieren de una
 *  forma cualquiera). Curvas: muestrear en puntos (semicírculo ≈ 8-12). */
export const PrismSchema = z
  .object({
    ...base,
    type: z.literal("prism"),
    /** Contorno en celdas [col,row] (≥3, mismo `at` que el resto). */
    points: z.array(at).min(3).max(24),
    /** Altura en celdas (obligatoria: no hay preset del que heredar). */
    h: z.number().positive().max(24),
    /** Colisiona (default true); false = decorativo atravesable. */
    solid: z.boolean().optional(),
    /** Se dibuja sobre quien esté detrás (default true); false = plano bajo. */
    tall: z.boolean().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    surface_desc: surfaceDesc.optional(),
  })
  .strict();

/** Pieza de un volumen `custom`: misma gramática de campos que las parts del
 *  scatter (una sola gramática de piezas para el motor), con valores
 *  LITERALES. Coordenadas locales en celdas relativas al `at` del volumen;
 *  `pos[1]` es la BASE de la pieza y las rotaciones (radianes) giran
 *  alrededor de su origen local. `desc` opcional pinta la superficie de ESA
 *  pieza como celda hero del atlas fps (entra en la librería); sin desc la
 *  pieza queda en clay con su color. */
const customDim = z.number().positive().max(64);
const customLocal = z.number().min(-32).max(32);

export const CustomPartSchema = z
  .object({
    shape: z.enum(["box", "cylinder", "cone", "sphere", "gable"]),
    /** box|gable: [w, h, d] (gable: cumbrera a lo largo de d, pre-rotY). */
    size: z.tuple([customDim, customDim, customDim]).optional(),
    r: customDim.optional(),
    h: customDim.optional(),
    rBottom: customDim.optional(),
    rTop: customDim.optional(),
    seg: z.number().min(3).max(24).optional(),
    pos: z.tuple([customLocal, z.number().min(-8).max(64), customLocal]).optional(),
    rotX: z.number().min(-6.3).max(6.3).optional(),
    rotY: z.number().min(-6.3).max(6.3).optional(),
    rotZ: z.number().min(-6.3).max(6.3).optional(),
    scale: z.tuple([z.number().min(0.1).max(4), z.number().min(0.1).max(4), z.number().min(0.1).max(4)]).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    desc: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const need = (field: "size" | "r" | "h" | "rBottom", ok: boolean): void => {
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.shape} requiere \`${field}\`` });
    };
    if (p.shape === "box" || p.shape === "gable") need("size", p.size !== undefined);
    if (p.shape === "cylinder") {
      need("rBottom", p.rBottom !== undefined);
      need("h", p.h !== undefined);
    }
    if (p.shape === "cone") {
      need("r", p.r !== undefined);
      need("h", p.h !== undefined);
    }
    if (p.shape === "sphere") need("r", p.r !== undefined);
  });

/** Composición 3D LIBRE: el motor declara cualquier objeto como piezas
 *  sólidas con posiciones/rotaciones/escala locales — sin catálogo y sin
 *  preset intermedio. Colisión = AABB de las piezas (rotado por `angle`)
 *  salvo `solid: false`. */
export const CustomSchema = z
  .object({
    ...base,
    type: z.literal("custom"),
    at,
    /** Rotación del CONJUNTO en grados (mismo convenio que building/prop). */
    angle: angle.optional(),
    parts: z.array(CustomPartSchema).min(1).max(24),
    solid: z.boolean().optional(),
    /** Se dibuja sobre quien esté detrás; default: altura máxima > 4 celdas. */
    tall: z.boolean().optional(),
  })
  .strict();

export const VolumeSchema = z.discriminatedUnion("type", [
  CustomSchema,
  BuildingSchema,
  WallSchema,
  TowerSchema,
  GateSchema,
  TreeSchema,
  BushSchema,
  RockSchema,
  FountainSchema,
  PropSchema,
  PrismSchema,
]);

/** Cap de volúmenes por tile (un pueblo denso ronda 80–120). */
export const MAX_VOLUMES = 160;

export const VolumesSchema = z.array(VolumeSchema).max(MAX_VOLUMES);

export type Volume = z.infer<typeof VolumeSchema>;
export type CustomVolume = z.infer<typeof CustomSchema>;
export type CustomPart = z.infer<typeof CustomPartSchema>;
export type BuildingVolume = z.infer<typeof BuildingSchema>;
export type WallVolume = z.infer<typeof WallSchema>;
export type TowerVolume = z.infer<typeof TowerSchema>;
export type GateVolume = z.infer<typeof GateSchema>;
export type TreeVolume = z.infer<typeof TreeSchema>;
export type PropVolume = z.infer<typeof PropSchema>;
export type PrismVolume = z.infer<typeof PrismSchema>;

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
    if (v.type === "building" && v.cutaway && v.angle !== undefined) {
      return { ok: false, error: `volumes: building "${v.id}" no admite \`angle\` con \`cutaway\`` };
    }
    if (v.type === "prop" && v.at !== undefined && v.angle !== undefined) {
      return { ok: false, error: `volumes: prop "${v.id}" solo admite \`angle\` con \`rect\`` };
    }
  }
  // Tope de escala de árbol: clamp (no rechazo) — todos los consumidores
  // (render, huella del compose, colisión) ven el MISMO valor acotado.
  const volumes = parsed.data.map((v) =>
    v.type === "tree" && (v.s ?? 1) > TREE_MAX_S ? { ...v, s: TREE_MAX_S } : v,
  );
  return { ok: true, volumes };
}
