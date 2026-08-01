/** Desvanecimiento de la cuarta pared por proximidad del jugador — puro.
 *
 *  La cuarta pared vive en la embocadura (borde sur, lado cámara). Cuando el
 *  jugador se acerca a ella se vuelve transparente para no taparle; lejos,
 *  opaca (el interior se lee como habitación cerrada). */

import type { StageBounds } from "./projection.js";

export interface FourthWallFadeOpts {
  /** A esta distancia de la embocadura (o menos) la pared está en su alpha
   *  mínimo. */
  nearM: number;
  /** A esta distancia o más, alpha máximo. */
  farM: number;
  minAlpha: number;
  maxAlpha: number;
}

export const FOURTH_WALL_FADE_DEFAULTS: FourthWallFadeOpts = {
  nearM: 1.5,
  farM: 5,
  minAlpha: 0.08,
  maxAlpha: 0.92,
};

/** Alpha 0..1 de la cuarta pared para un jugador en z de MUNDO. */
export function fourthWallAlpha(
  playerZ: number,
  bounds: StageBounds,
  opts: FourthWallFadeOpts = FOURTH_WALL_FADE_DEFAULTS,
): number {
  const dist = bounds.maxZ - playerZ; // distancia a la embocadura
  const t = (dist - opts.nearM) / (opts.farM - opts.nearM);
  const clamped = Math.min(1, Math.max(0, t));
  return opts.minAlpha + (opts.maxAlpha - opts.minAlpha) * clamped;
}
