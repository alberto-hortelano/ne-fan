/** `vegetation_zones` — el DIAL de la masa forestal del tile.
 *
 *  El motor narrativo no coloca un bosque árbol a árbol: declara ZONAS con una
 *  densidad y el engine las puebla de forma determinista con volúmenes
 *  tree/bush REALES (los mismos que si los hubiera escrito a mano en
 *  `volumes`: se ven, dan sombra y su tronco frena).
 *
 *  ── La unidad ────────────────────────────────────────────────────────────
 *  `density` son **ejemplares por m²**, que es como se mide una masa forestal
 *  (0,01/m² = 100 pies/ha, robledal abierto; 0,05 = bosque maduro; el tope,
 *  pinar cerrado). Es la MISMA unidad que ya tenía `scatter_zones.density`, y
 *  a propósito: antes este campo era «fracción de celdas elegibles» en una
 *  ruta y `área·d/22` en la otra, así que la misma palabra significaba tres
 *  cosas dentro del mismo tool.
 *
 *  ── Por qué hay un techo, y de dónde sale ────────────────────────────────
 *  Un bosque por el que no se puede pasar es un bosque roto, así que el techo
 *  no es una opinión: se DERIVA de la geometría del jugador y del tronco, y
 *  por eso no hace falta un test que vigile a posteriori que queda camino —
 *  un bosque intransitable no se puede expresar.
 *
 *    · dos troncos derivados ocupan como mucho `2·treeTrunkRadiusCells(S_MAX)`
 *    · el jugador necesita `PASO_LIBRE_CELDAS` celdas LIBRES entre ellos
 *    · luego dos ejemplares nunca pueden estar a menos de `MIN_SEP_TREE`
 *    · y la densidad que pide esa separación es el tope: `MAX_VEG_DENSITY`
 *
 *  El paso se mide en CELDAS libres y no en metros porque la colisión es un
 *  grid: `volumeCollisionGrid` marca la celda entera cuyo CENTRO cae dentro
 *  del tronco, así que el hueco analítico se redondea hacia fuera hasta media
 *  celda por lado. Con el hueco medido en metros (1,00 m analítico) el peor
 *  caso de rasterización dejaba 0,50 m de celdas libres — menos que el
 *  jugador, y la garantía sería falsa justo donde importa. */

import { z } from "zod";
import { TILE_CELLS, TILE_MPC } from "../tile.js";
import { BODY_RADIUS_M, celdasLibresParaRadio } from "../terrain-collision.js";
import { treeTrunkRadiusCells } from "./collision.js";

/** Escala de los ejemplares que planta el scatter (rango del sorteo). Los
 *  árboles del MOTOR pueden llegar a `TREE_MAX_S`; estos no — son masa, no
 *  ejemplares singulares, y de su máximo sale la separación mínima. */
export const VEG_TREE_S_MIN = 0.75;
export const VEG_TREE_S_MAX = 1.2;
export const VEG_BUSH_S_MIN = 0.7;
export const VEG_BUSH_S_MAX = 1.1;

/** Celdas LIBRES que necesita el CUERPO MAYOR para pasar entre dos troncos.
 *
 *  La MISMA regla que usa el validador (`celdasLibresParaRadio`), y a
 *  propósito: el productor y el verificador no pueden tener dos ideas de
 *  cuánto hueco hace falta o el bosque se planta con una y se juzga con otra.
 *  El collider bloquea por SOLAPE de celda, así que un hueco de n celdas
 *  admite radio R solo si `n·mpc > 2R`.
 *
 *  Antes esto era `ceil(2R/mpc) + 1` y se derivaba solo de `PLAYER_RADIUS_M`.
 *  Lo segundo era el agujero (#289): dos árboles podían dejar un paso que el
 *  jugador cruzaba y un NPC no. Lo primero no era ni más laxo ni más estricto
 *  —`ceil(x)+1 ≥ floor(x)+1` para todo x, así que nunca puede aprobar un
 *  hueco que el collider bloquee—, solo era una segunda fórmula sin motivo. A
 *  mpc 0,5 las dos dan 3; con una sola, no hay que comprobar cuál gana.
 *
 *  La holgura de rasterizado —la región marcada se redondea hasta media celda
 *  por lado— NO vive aquí: la lleva el radio del tronco
 *  (`treeTrunkRadiusCells`), que es lo que se rasteriza. */
export const PASO_LIBRE_CELDAS = celdasLibresParaRadio(BODY_RADIUS_M, TILE_MPC);

/** Distancia mínima (celdas) entre los CENTROS de dos ejemplares para que el
 *  jugador quepa entre sus troncos. Un arbusto no colisiona (radio 0), así que
 *  su separación es solo visual: la que deja el propio paso libre. */
export function sepEntreTroncos(radioA: number, radioB: number): number {
  return radioA + radioB + PASO_LIBRE_CELDAS;
}

/** Separación mínima (celdas) entre dos árboles derivados: el peor caso de
 *  `sepEntreTroncos` con los dos ejemplares al máximo de escala. NO es una
 *  constante mágica — si engorda el tronco o el jugador, sube sola. */
export const MIN_SEP_TREE = sepEntreTroncos(
  treeTrunkRadiusCells(VEG_TREE_S_MAX),
  treeTrunkRadiusCells(VEG_TREE_S_MAX),
);

/** Coeficiente de empaquetado: cuánta separación pide una densidad dada.
 *
 *  `sep = COEF / (√density · mpc)` celdas. Con un muestreo por rechazo (RSA),
 *  el objetivo pedido queda en una fracción FIJA del empaquetado de saturación
 *  —`COEF²/0,697 ≈ 0,81`— sea cual sea la densidad y el área, así que la
 *  curva es alcanzable en TODO el rango con el mismo presupuesto de intentos.
 *  MEDIDO: con 0,75 y `VEG_ATTEMPTS_PER_TARGET` el objetivo se entrega exacto
 *  en zona pequeña y en tile entero (test `vegetation-density.test.ts`). */
export const VEG_SPACING_COEF = 0.75;

/** Intentos de colocación por ejemplar pedido. La cola del RSA es lenta: con
 *  menos, las densidades altas se quedan cortas y la curva del contrato deja
 *  de ser verdad. */
export const VEG_ATTEMPTS_PER_TARGET = 40;

/** Separación (celdas) que pide una densidad. */
export function sepPorDensidad(density: number): number {
  return VEG_SPACING_COEF / (Math.sqrt(density) * TILE_MPC);
}

/** Densidad máxima (ejemplares/m²): aquella cuya separación es exactamente el
 *  suelo geométrico. Por encima, el suelo mandaría igual y el motor pediría un
 *  bosque que el engine no puede entregar — se le rebota en vez de saturar
 *  callando. Truncada a dos decimales para que el número del contrato sea
 *  legible y siga cabiendo bajo el suelo. */
export const MAX_VEG_DENSITY =
  Math.floor((VEG_SPACING_COEF / (MIN_SEP_TREE * TILE_MPC)) ** 2 * 100) / 100;

/** Máximo de zonas por tile: son composición (dónde empieza y acaba cada
 *  masa), no una lista de la compra. */
export const MAX_VEGETATION_ZONES = 8;

const areaRect = z.tuple([
  z.number().int().min(0).max(TILE_CELLS),
  z.number().int().min(0).max(TILE_CELLS),
  z.number().int().min(1).max(TILE_CELLS),
  z.number().int().min(1).max(TILE_CELLS),
]);

export const VegetationZoneSchema = z
  .object({
    /** Nombre en español de la planta ("pino", "matorral", "zarza"…). Un type
     *  de matorral planta arbustos; cualquier otro, árboles. */
    type: z.string().min(1).max(48),
    /** Rect [col,row,w,h] en celdas o "rest" (todo el tile). */
    area: z.union([areaRect, z.literal("rest")]),
    /** Ejemplares por m². */
    density: z.number(),
    seed: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((z0, ctx) => {
    if (!(z0.density > 0) || z0.density > MAX_VEG_DENSITY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["density"],
        message:
          `density=${z0.density} fuera de rango: son EJEMPLARES POR m², (0, ${MAX_VEG_DENSITY}] ` +
          `(0.01 robledal abierto · 0.05 bosque maduro · ${MAX_VEG_DENSITY} pinar cerrado). ` +
          `El tope es donde satura el suelo: dos troncos no caben a menos de ` +
          `${(MIN_SEP_TREE * TILE_MPC).toFixed(2)} m sin cerrarle el paso al jugador.`,
      });
    }
    if (z0.area !== "rest") {
      const [c, r, w, h] = z0.area;
      if (c + w > TILE_CELLS || r + h > TILE_CELLS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["area"],
          message: `area [${c},${r},${w},${h}] se sale del tile ${TILE_CELLS}x${TILE_CELLS}`,
        });
      }
    }
  });

export const VegetationZonesSchema = z.array(VegetationZoneSchema).max(MAX_VEGETATION_ZONES);

export type VegetationZone = z.infer<typeof VegetationZoneSchema>;

export type ParseVegetationResult =
  | { ok: true; zones: VegetationZone[] }
  | { ok: false; error: string };

/** Valida el array `vegetation_zones` de un tile. Mismo contrato que
 *  `parseGround`/`parseVolumes`: el fail-loud vive en el call site, que decide
 *  por qué canal lo reporta. */
export function parseVegetationZones(raw: unknown): ParseVegetationResult {
  if (raw === undefined) return { ok: true, zones: [] };
  const parsed = VegetationZonesSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // Ruta al estilo del resto del contrato: `vegetation_zones[0].density`, no
    // `vegetation_zones[0.density]` — el mensaje lo lee el motor y tiene que
    // poder señalar el campo que ha de corregir.
    const [zona, ...campo] = first.path;
    const ruta = `vegetation_zones[${zona ?? ""}]${campo.length > 0 ? `.${campo.join(".")}` : ""}`;
    return { ok: false, error: `${ruta}: ${first.message}` };
  }
  return { ok: true, zones: parsed.data };
}

/** Área de una zona en m² — de aquí sale cuántos ejemplares pide. */
export function zoneAreaM2(area: VegetationZone["area"]): number {
  const [, , w, h] = area === "rest" ? [0, 0, TILE_CELLS, TILE_CELLS] : area;
  return w * h * TILE_MPC * TILE_MPC;
}

/** Rect en celdas de la zona ("rest" = el tile entero). */
export function zoneRect(area: VegetationZone["area"]): [number, number, number, number] {
  return area === "rest" ? [0, 0, TILE_CELLS, TILE_CELLS] : area;
}

const BUSH_TYPES = /arbusto|mata|matorral|helecho|zarza|bush/i;

/** ¿Esta zona planta arbustos (decorativos, no bloquean) o árboles? */
export function zoneIsBush(type: string): boolean {
  return BUSH_TYPES.test(type);
}
