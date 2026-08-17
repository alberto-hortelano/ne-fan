/** Relieve del suelo — post-proceso FPS-ONLY (no toca el builder compartido
 *  ni sus hashes cenitales).
 *
 *  Heightfield determinista: ruido de valor de ondulación suave en una
 *  RETÍCULA GLOBAL de celdas de mundo (dos octavas), así los tiles vecinos
 *  empalman sin costura, MÁS el relieve DECLARADO por el plan (rasgos
 *  `ground` kind "hill": lomas/hondonadas con faldón suave, que mueren en
 *  las costuras del tile), con amplitud por bioma y una máscara de aplanado
 *  alrededor de todo lo construido/declarado (huellas de volúmenes, caminos,
 *  agua, decks Y áreas de material — una plaza queda plana). El resultado es
 *  una rejilla de alturas en METROS que el renderer usa para desplazar el
 *  suelo y anclar cámara, billboards y scatter. La COLISIÓN no cambia (sigue
 *  siendo XZ pura): el relieve es presentación. */

import { fnv1a } from "../../rng.js";
import { TILE_CELLS, TILE_MPC } from "../tile.js";
import { buildScatterExclusions } from "./scatter.js";
import { shapeContains } from "./ground-collision.js";
import type { GroundFeature, GroundHill } from "./ground.js";
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
/** Faldón (celdas) de una colina declarada: 0 en el borde de su forma,
 *  altura plena a esta profundidad hacia dentro. También es la rampa con la
 *  que el relieve declarado muere en las costuras del tile (el vecino no
 *  conoce estas colinas — sin esto habría un escalón en el borde). */
const HILL_RAMP = 12;

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
  const hills = ground.filter((f): f is GroundHill => f.kind === "hill");
  if (amp <= 0 && hills.length === 0) return undefined;
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

  // Relieve DECLARADO (`ground` hill): suma de colinas/hondonadas con faldón
  // suave desde el borde de su forma (misma técnica de anillos que la máscara)
  // y rampa a 0 en las costuras del tile.
  const hillAt = (cx: number, cz: number): number => {
    let sum = 0;
    for (const hill of hills) {
      if (!shapeContains(hill, cx, cz)) continue;
      let d = HILL_RAMP;
      for (let r = 2; r < HILL_RAMP; r += 2) {
        let outside = false;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (!shapeContains(hill, cx + Math.cos(a) * r, cz + Math.sin(a) * r)) {
            outside = true;
            break;
          }
        }
        if (outside) {
          d = r;
          break;
        }
      }
      sum += hill.h * smooth(Math.min(1, d / HILL_RAMP));
    }
    return sum;
  };
  const borderT = (cx: number, cz: number): number => {
    const d = Math.min(cx, cz, TILE_CELLS - cx, TILE_CELLS - cz);
    return smooth(Math.max(0, Math.min(1, d / HILL_RAMP)));
  };

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const cx = i * stepC;
      const cz = j * stepC;
      const noise =
        amp > 0
          ? valueNoise(gx0 + cx, gz0 + cz, WAVELENGTHS[0], 0) * 0.7 +
            valueNoise(gx0 + cx, gz0 + cz, WAVELENGTHS[1], 1) * 0.3
          : 0;
      const declared = hills.length > 0 ? hillAt(cx, cz) * borderT(cx, cz) : 0;
      heights[j * (n + 1) + i] = (declared + noise * amp) * maskAt(cx, cz);
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
