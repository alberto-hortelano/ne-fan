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
