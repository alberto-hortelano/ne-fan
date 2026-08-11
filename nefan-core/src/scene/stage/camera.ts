/** Cámara de raíl del proscenio — lógica pura, frame-independent.
 *
 *  La cámara del plató solo se traslada en X (raíl lateral del cine clásico):
 *  zona muerta alrededor del actor (mientras esté dentro, la cámara no se
 *  mueve) + lerp exponencial cuando la abandona + clamp al recorrido del
 *  raíl para no enseñar más allá de los bastidores. */

export interface RailCameraOpts {
  /** Semiancho de la zona muerta en metros (el actor camina libre dentro). */
  deadZone: number;
  /** Velocidad del lerp (1/s). ~6 sigue con suavidad cinematográfica. */
  rate: number;
  /** Recorrido del raíl en X mundo (clamp del centro de cámara). */
  minX: number;
  maxX: number;
}

/** Nueva X de cámara tras dt segundos siguiendo a playerX. Exponencial
 *  independiente del framerate: factor = 1 − e^(−rate·dt). */
export function railCamera(prevX: number, playerX: number, dt: number, opts: RailCameraOpts): number {
  const err = playerX - prevX;
  let next = prevX;
  if (Math.abs(err) > opts.deadZone) {
    const target = playerX - Math.sign(err) * opts.deadZone;
    const factor = 1 - Math.exp(-opts.rate * Math.max(0, dt));
    next = prevX + (target - prevX) * factor;
  }
  return Math.min(opts.maxX, Math.max(opts.minX, next));
}

// ── Seguimiento con paralaje (pan X + dolly Z) ──────────────────────────────
// La cámara sigue al personaje a un PORCENTAJE de su movimiento real: el
// paralaje entre capas (lo cercano corre/amplía más que el telón) da la
// sensación de 3D, y el follow en METROS es independiente del ancho de
// pantalla (en canvas estrechos el raíl gana recorrido, no al revés).

import type { StageCam } from "./framing.js";

/** Fracción del movimiento del jugador que recorre la cámara (lateral). */
export const FOLLOW_X = 0.2;
/** Ídem en profundidad (dolly hacia el telón al avanzar al norte). */
export const FOLLOW_Z = 0.2;

export interface StageFollowOpts {
  /** Velocidad del lerp exponencial (1/s). ~5: el gain 0.2 ya suaviza. */
  rate: number;
  /** Clamp lateral (±, metros) — railHalfM del framing. */
  railHalfM: number;
  /** Clamp del dolly ([0, maxDollyM], metros) — maxDollyFor(proj). */
  maxDollyM: number;
}

/** Avanza la cámara de runtime hacia sus targets (ya multiplicados por el
 *  gain de follow) con lerp exponencial + clamps. deadZone 0: una zona
 *  muerta sobre un follow proporcional produce stiction. */
export function stageFollow(
  prev: StageCam,
  targets: { camXM: number; dollyM: number },
  dt: number,
  opts: StageFollowOpts,
): StageCam {
  return {
    camXM: railCamera(prev.camXM, targets.camXM, dt, {
      deadZone: 0,
      rate: opts.rate,
      minX: -opts.railHalfM,
      maxX: opts.railHalfM,
    }),
    dollyM: railCamera(prev.dollyM, targets.dollyM, dt, {
      deadZone: 0,
      rate: opts.rate,
      minX: 0,
      maxX: Math.max(0, opts.maxDollyM),
    }),
  };
}
