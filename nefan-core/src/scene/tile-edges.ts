/** Costuras entre tiles — lógica pura.
 *
 *  De un tile EXPANDIDO se computa, por cada borde, qué "sale" de él: el bioma
 *  dominante y los cruces (runs de celdas transitables/de agua que tocan la
 *  línea de borde: caminos, carreteras, ríos, puentes). El bridge persiste
 *  este resumen en el SceneRecord y se lo inyecta al motor al generar el tile
 *  vecino, que DEBE continuar cada cruce (lo verifica el validador).
 *
 *  Coordenadas espejo: los bordes east/west comparten la coordenada `row` y
 *  north/south comparten `col` — el cruce del borde east del vecino oeste
 *  aparece en el borde west del tile nuevo con el MISMO `at`, sin
 *  transformación. */

import type { Edge } from "../world-map/types.js";
import { TILE_CELLS } from "./tile.js";
import { resolveBiome } from "./tile.js";

export type CrossingType = "path" | "road" | "river" | "bridge";

export interface EdgeCrossing {
  type: CrossingType;
  /** Celda central del run sobre la línea de borde (misma coordenada en el
   *  borde espejo del vecino). */
  at: number;
  /** Longitud del run en celdas. */
  width: number;
}

export interface TileEdgeSummary {
  /** Bioma dominante del borde (nombre de catálogo o char). */
  biome: string;
  crossings: EdgeCrossing[];
}

export type TileEdges = Record<Edge, TileEdgeSummary>;

/** Char de borde → tipo de cruce. Los muros ("W") NO son cruces (una
 *  estructura tocando la costura es un warning del validador, no un cruce). */
const CROSSING_BY_CHAR: Record<string, CrossingType> = {
  _: "path",
  s: "road",
  w: "river",
  b: "bridge",
};

/** Categorías compatibles al continuar un cruce: un camino puede seguir como
 *  camino o carretera; el agua como río o puente (vado). */
const COMPATIBLE: Record<CrossingType, ReadonlySet<CrossingType>> = {
  path: new Set(["path", "road"]),
  road: new Set(["path", "road"]),
  river: new Set(["river", "bridge"]),
  bridge: new Set(["river", "bridge"]),
};

/** Línea de celdas de un borde del grid (índice = coordenada compartida). */
function edgeLine(grid: string[], edge: Edge): string {
  switch (edge) {
    case "north": return grid[0];
    case "south": return grid[TILE_CELLS - 1];
    case "west": return grid.map((row) => row[0]).join("");
    case "east": return grid.map((row) => row[TILE_CELLS - 1]).join("");
  }
}

/** Resumen de los 4 bordes de un tile EXPANDIDO (Format D v3 plano). */
export function computeTileEdges(expanded: Record<string, unknown>): TileEdges {
  const grid = expanded.terrain as string[];
  if (!Array.isArray(grid) || grid.length !== TILE_CELLS || grid.some((r) => typeof r !== "string" || r.length !== TILE_CELLS)) {
    throw new Error(`computeTileEdges: se espera un tile expandido de ${TILE_CELLS}x${TILE_CELLS}`);
  }
  const biome = typeof expanded.biome === "string" ? expanded.biome : "grass";
  resolveBiome(biome); // fail-loud si el tile llegó con un bioma inválido

  const edges = {} as TileEdges;
  for (const edge of ["north", "south", "east", "west"] as Edge[]) {
    const line = edgeLine(grid, edge);
    const crossings: EdgeCrossing[] = [];
    let runStart = -1;
    let runType: CrossingType | null = null;
    const flush = (end: number): void => {
      if (runType !== null && runStart >= 0) {
        // Centro del run con redondeo hacia arriba en empates: un camino de
        // width 2 declarado en `at` cubre [at-1, at] y recupera `at` exacto.
        crossings.push({ type: runType, at: Math.round((runStart + end - 1) / 2), width: end - runStart });
      }
      runStart = -1;
      runType = null;
    };
    for (let i = 0; i < line.length; i++) {
      const t = CROSSING_BY_CHAR[line[i]] ?? null;
      if (t !== runType) {
        flush(i);
        if (t !== null) {
          runStart = i;
          runType = t;
        }
      }
    }
    flush(line.length);
    edges[edge] = { biome, crossings };
  }
  return edges;
}

/** Cruces requeridos (del vecino) sin continuación en los reales (del tile
 *  nuevo): mismo borde implícito, `at ± tolerance`, categoría compatible. */
export function matchCrossings(
  required: EdgeCrossing[],
  actual: EdgeCrossing[],
  tolerance = 2,
): { missing: EdgeCrossing[] } {
  const missing: EdgeCrossing[] = [];
  for (const req of required) {
    const ok = actual.some(
      (a) => COMPATIBLE[req.type].has(a.type) && Math.abs(a.at - req.at) <= tolerance,
    );
    if (!ok) missing.push(req);
  }
  return { missing };
}
