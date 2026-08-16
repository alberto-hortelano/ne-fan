/** Relieve del suelo — post-proceso FPS-ONLY (no toca el builder compartido
 *  ni sus hashes cenitales).
 *
 *  Heightfield determinista de ondulación suave: ruido de valor en una
 *  RETÍCULA GLOBAL de celdas de mundo (dos octavas), así los tiles vecinos
 *  empalman sin costura, con amplitud por bioma y una máscara de aplanado
 *  alrededor de todo lo construido/declarado (huellas de volúmenes, caminos,
 *  agua, decks Y áreas de material — una plaza queda plana). El resultado es
 *  una rejilla de alturas en METROS que el renderer usa para desplazar el
 *  suelo y anclar cámara, billboards y scatter. La COLISIÓN no cambia (sigue
 *  siendo XZ pura): el relieve es presentación. */

import { fnv1a } from "../../rng.js";
import { TILE_CELLS, TILE_MPC } from "../tile.js";
import { buildScatterExclusions } from "./scatter.js";
import type { GroundFeature } from "./ground.js";
import type { Volume } from "./volumes.js";

/** Rejilla de alturas (metros) de un tile: (n+1)×(n+1) muestras, fila a fila
 *  (z mayor → sur), paso `stepM` sobre el cuadrado del tile. */
export interface ReliefGrid {
  n: number;
  stepM: number;
  heights: number[];
}

/** Amplitud (metros) de la ondulación por bioma. */
const BIOME_AMP: Record<string, number> = {
  grass: 0.35,
  meadow: 0.35,
  forest_floor: 0.5,
  dirt: 0.3,
  sand: 0.35,
  stone: 0.55,
  snow: 0.5,
  swamp: 0.15,
};

/** Muestras por lado (paso = 64 m / 32 = 2 m). */
const RELIEF_N = 32;
/** Longitudes de onda del ruido (celdas de mundo). */
const WAVELENGTHS = [48, 20] as const;
/** Radio (celdas) del degradado de la máscara alrededor de lo excluido. */
const MASK_RADIUS = 10;

/** Valor pseudoaleatorio [-1,1] estable por nodo GLOBAL de retícula. */
function lattice(ix: number, iz: number, octave: number): number {
  return ((fnv1a(`relief:${octave}:${ix}:${iz}`) % 20001) / 10000) - 1;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Ruido de valor en celdas GLOBALES (continuo entre tiles). */
function valueNoise(gx: number, gz: number, wavelength: number, octave: number): number {
  const fx = gx / wavelength;
  const fz = gz / wavelength;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smooth(fx - ix);
  const tz = smooth(fz - iz);
  const a = lattice(ix, iz, octave);
  const b = lattice(ix + 1, iz, octave);
  const c = lattice(ix, iz + 1, octave);
  const d = lattice(ix + 1, iz + 1, octave);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** tx/ty del tile desde su seedKey ("tile_-1_2") — 0,0 si no casa (bench). */
function tileOrigin(seedKey: string): [number, number] {
  const m = /^tile_(-?\d+)_(-?\d+)$/.exec(seedKey);
  return m ? [Number(m[1]) * TILE_CELLS, Number(m[2]) * TILE_CELLS] : [0, 0];
}

/** Construye la rejilla de relieve del tile. `undefined` si el bioma no
 *  ondula (amplitud 0 — no hay bioma así hoy, pero el contrato lo admite). */
export function buildReliefGrid(
  biome: string | undefined,
  volumes: Volume[],
  ground: GroundFeature[],
  seedKey: string,
): ReliefGrid | undefined {
  const amp = BIOME_AMP[biome ?? ""] ?? 0.35;
  if (amp <= 0) return undefined;
  const excluded = buildScatterExclusions(volumes, ground, { areas: true });
  const [gx0, gz0] = tileOrigin(seedKey);
  const n = RELIEF_N;
  const stepC = TILE_CELLS / n;
  const heights: number[] = new Array((n + 1) * (n + 1));

  // Máscara: 0 sobre lo excluido, rampa suave hasta 1 a MASK_RADIUS celdas.
  const maskAt = (cx: number, cz: number): number => {
    if (excluded(cx, cz)) return 0;
    let d = MASK_RADIUS;
    for (let r = 2; r < MASK_RADIUS; r += 2) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (excluded(cx + Math.cos(a) * r, cz + Math.sin(a) * r)) {
          d = Math.min(d, r);
          break;
        }
      }
      if (d <= r) break;
    }
    return smooth(Math.min(1, d / MASK_RADIUS));
  };

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const cx = i * stepC;
      const cz = j * stepC;
      const noise =
        valueNoise(gx0 + cx, gz0 + cz, WAVELENGTHS[0], 0) * 0.7 +
        valueNoise(gx0 + cx, gz0 + cz, WAVELENGTHS[1], 1) * 0.3;
      heights[j * (n + 1) + i] = noise * amp * maskAt(cx, cz);
    }
  }
  return { n, stepM: (TILE_CELLS * TILE_MPC) / n, heights };
}

/** Altura (metros) en un punto LOCAL del tile en metros (bilineal). */
export function reliefAtM(grid: ReliefGrid, xM: number, zM: number): number {
  const n = grid.n;
  const fx = Math.min(n, Math.max(0, xM / grid.stepM));
  const fz = Math.min(n, Math.max(0, zM / grid.stepM));
  const i = Math.min(n - 1, Math.floor(fx));
  const j = Math.min(n - 1, Math.floor(fz));
  const tx = fx - i;
  const tz = fz - j;
  const h = grid.heights;
  const w = n + 1;
  return (
    (h[j * w + i] * (1 - tx) + h[j * w + i + 1] * tx) * (1 - tz) +
    (h[(j + 1) * w + i] * (1 - tx) + h[(j + 1) * w + i + 1] * tx) * tz
  );
}
