/** Bloque `stage` de una escena proscenio — la declaración semántica del
 *  plató. El motor narrativo lo adjunta a una escena Format D clásica (por
 *  place, sin `tile`): salidas con su borde y destino, telón de fondo,
 *  cuarta pared y tarimas. El compositor (`compose.ts`) lo proyecta a capas
 *  en perspectiva; la colisión y las zonas de transición salen de lo
 *  declarado — nunca de píxeles pintados.
 *
 *  Convención de cámara: la cámara está al SUR del plató. `north` (−z) es el
 *  telón de fondo, `south` (+z) la embocadura (salida hacia cámara),
 *  `east`/`west` los laterales. Así `StageExit.edge` es un `Edge` del world
 *  map y `oppositeEdge`/`resolveExitEdge` funcionan sin cambios.
 *
 *  Unidades: celdas de la escena (size.cols × size.rows, 1 celda = 0.5 m en
 *  interiores). `label` en español (se muestra al jugador). */

import { z } from "zod";
import type { Edge } from "../../world-map/types.js";

export const StageEdgeSchema = z.enum(["north", "south", "east", "west"]);

const cell = z.number().min(0).max(200);
const span = z.number().positive().max(200);
/** [col, row, ancho, fondo] en celdas de la escena. */
const zoneRect = z.tuple([cell, cell, span, span]);

export const StageExitSchema = z
  .object({
    id: z.string().min(1).max(64),
    /** Borde del plató donde está la salida (convención cámara-sur). */
    edge: StageEdgeSchema,
    /** Place del world map al que transiciona (debe existir un link). */
    to_place_id: z.string().min(1).max(64),
    /** Zona en celdas que dispara la transición al pisarla. */
    zone: zoneRect,
    kind: z.enum(["door", "opening", "stairs"]),
    /** Etiqueta visible en español: "Puerta a la cocina". */
    label: z.string().min(1).max(64),
  })
  .strict();

export const MAX_STAGE_EXITS = 8;

/** Coordenada de `surroundings` en METROS DE MUNDO relativos al CENTRO del
 *  plató (mismo sistema que las primitivas del greybox): x crece al este,
 *  z al sur (el fondo tras el telón es z NEGATIVA). Admite negativos y
 *  posiciones mucho más allá de los bounds jugables. */
const sm = z.number().min(-400).max(400);
const surPos = z.tuple([sm, sm]);
/** Altura de la base sobre el suelo (elevación decorativa, p. ej. un
 *  edificio sobre su cerro). */
const surYBase = z.number().min(0).max(60).optional();
/** Rotación en grados, misma convención que `Volume.angle`. */
const surAngle = z.number().min(-180).max(180).optional();

/** Decorado FUERA de los bounds jugables: el caserío que recede, el castillo
 *  en su cerro, tapias y árboles del borde. Sin colisión, sin manifest, sin
 *  segmentación — pura escenografía del greybox (sustituye a las colinas
 *  genéricas cuando se declara). */
export const StageSurroundingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("house"),
      pos: surPos,
      /** Ancho × fondo × alto de muros, en metros. */
      w: z.number().min(2).max(40),
      d: z.number().min(2).max(40),
      h: z.number().min(2).max(30),
      wall_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      roof_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      y_base: surYBase,
      angle: surAngle,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tower"),
      pos: surPos,
      r: z.number().min(1).max(20).optional(),
      h: z.number().min(3).max(60).optional(),
      y_base: surYBase,
    })
    .strict(),
  z
    .object({
      kind: z.literal("wall"),
      pos: surPos,
      /** Longitud del lienzo en metros (a lo largo de x local antes de girar). */
      len: z.number().min(3).max(120),
      h: z.number().min(1.5).max(20).optional(),
      y_base: surYBase,
      angle: surAngle,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tree"),
      pos: surPos,
      s: z.number().min(0.4).max(2.5).optional(),
      y_base: surYBase,
    })
    .strict(),
  z
    .object({
      kind: z.literal("hill"),
      pos: surPos,
      /** Radio de la falda y altura de la cima, en metros. */
      r: z.number().min(5).max(300),
      h: z.number().min(1).max(60),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    })
    .strict(),
]);

export const MAX_STAGE_SURROUNDINGS = 48;

export const StageBlockSchema = z
  .object({
    /** Distancia focal en metros para scaleAt(z) = f/(f+z). Default 12. */
    focal_m: z.number().min(2).max(64).optional(),
    exits: z.array(StageExitSchema).min(1).max(MAX_STAGE_EXITS),
    /** Guía del telón de fondo (y del repintado por capas futuro). */
    backdrop: z.object({ description: z.string().min(1).max(400) }).strict().optional(),
    /** Atmósfera del plató: hora del día (presets de sol/cielo/niebla del
     *  greybox) y mood en texto libre (entra al prompt del repintado). Sin
     *  ella el greybox infiere la hora del texto de backdrop/descripción. */
    ambience: z
      .object({
        time_of_day: z.enum(["amanecer", "dia", "atardecer", "noche"]).optional(),
        mood: z.string().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
    /** Altura de las paredes/techo de un INTERIOR en metros — a escala de la
     *  sala (choza 2.4, taberna 3.5, salón noble 5+). Default del motor si
     *  falta; en exteriores se ignora. */
    wall_h_m: z.number().min(2.2).max(8).optional(),
    /** Cuarta pared frontal (lado cámara); se desvanece por proximidad. */
    fourth_wall: z
      .object({
        present: z.boolean(),
        /** Huecos de puerta en la cuarta pared: col de inicio + ancho, celdas. */
        doors: z.array(z.object({ col: cell, w: span }).strict()).max(4).optional(),
      })
      .strict()
      .optional(),
    /** Tarimas/niveles elevados. v1: NADIE los consume (ni compositor ni
     *  greybox) — el suelo jugable es PLANO; la elevación decorativa va en
     *  `surroundings` (y_base/hill). */
    platforms: z
      .array(z.object({ rect: zoneRect, h: z.number().positive().max(4), label: z.string().min(1).max(48) }).strict())
      .max(8)
      .optional(),
    /** Decorado fuera de bounds (ver StageSurroundingSchema). */
    surroundings: z.array(StageSurroundingSchema).max(MAX_STAGE_SURROUNDINGS).optional(),
  })
  .strict();

export type StageExit = z.infer<typeof StageExitSchema> & { edge: Edge };
export type StageBlock = z.infer<typeof StageBlockSchema>;
export type StageSurrounding = z.infer<typeof StageSurroundingSchema>;

export type ParseStageResult =
  | { ok: true; stage: StageBlock }
  | { ok: false; error: string };

/** Valida el bloque `stage` de una escena. Ids de exit duplicados = error
 *  (identifican la zona en transiciones y en el spawn de entrada). */
export function parseStage(raw: unknown): ParseStageResult {
  const parsed = StageBlockSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `stage${first.path.length ? "." + first.path.join(".") : ""}: ${first.message}` };
  }
  const seen = new Set<string>();
  for (const exit of parsed.data.exits) {
    if (seen.has(exit.id)) return { ok: false, error: `stage.exits: id duplicado "${exit.id}"` };
    seen.add(exit.id);
  }
  return { ok: true, stage: parsed.data };
}
