/** ¿A qué está mirando el jugador? — selección pura por desviación angular.
 *
 *  En primera persona "lo que tienes delante" NO es lo más cercano: un NPC a
 *  medio metro a tu espalda sigue siendo el más cercano y no lo estás mirando.
 *  La etiqueta de mundo y la mirilla necesitan la otra pregunta —qué enfila la
 *  cámara— y esa es esta función: entrada → salida, sin DOM ni three.
 *
 *  Se mide en el plano XZ (la cámara solo tiene yaw en fps) y con la
 *  DESVIACIÓN ANGULAR, no con la distancia perpendicular: a 10 m un objeto
 *  desviado 1 m está casi en el centro de la pantalla, y a 1 m está fuera de
 *  ella. El cono se declara en radianes de pantalla, que es lo que el jugador
 *  ve. */

export interface AimCandidate {
  id: string;
  pos: { x: number; z: number };
  /** Media anchura del candidato en METROS. Se apunta a un CUERPO, no a su
   *  punto central: sin esto, un NPC a un metro y medio paso a la izquierda
   *  llena media pantalla y aun así queda "sin apuntar". */
  radiusM?: number;
}

export interface AimPick {
  id: string;
  /** Distancia en METROS del origen al candidato (plano XZ). */
  distanceM: number;
  /** Desviación angular respecto al forward, en RADIANES (siempre ≥ 0). */
  offAxisRad: number;
}

export interface AimOptions {
  /** Alcance máximo en metros: más allá no se etiqueta nada. */
  maxDistanceM: number;
  /** Semiángulo del cono de puntería, en radianes. */
  coneRad: number;
}

/** Candidato que la cámara enfila, o null si no hay ninguno dentro del cono.
 *  Gana la menor desviación angular; a igualdad, el más cercano.
 *
 *  Fail-loud: un `forward` de longitud cero no es "no hay objetivo", es una
 *  llamada mal construida — el yaw del jugador nunca es nulo. */
export function pickAimTarget(
  origin: { x: number; z: number },
  forward: { x: number; z: number },
  candidates: readonly AimCandidate[],
  opts: AimOptions,
): AimPick | null {
  const fLen = Math.hypot(forward.x, forward.z);
  if (fLen < 1e-9) throw new Error("pickAimTarget: forward nulo (sin dirección de mirada)");
  const fx = forward.x / fLen;
  const fz = forward.z / fLen;

  let best: AimPick | null = null;
  for (const c of candidates) {
    const dx = c.pos.x - origin.x;
    const dz = c.pos.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > opts.maxDistanceM) continue;
    // atan2(|cruz|, punto): ángulo sin signo entre forward y el vector al
    // candidato. Robusto en los dos extremos (acos se satura cerca de 0 y π).
    const offAxis = d < 1e-9 ? 0 : Math.atan2(Math.abs(fx * dz - fz * dx), fx * dx + fz * dz);
    // Entra por cono O por cuerpo: `d·sin(offAxis)` es la distancia de la
    // línea de mirada al centro del candidato, así que compararla con su
    // radio es preguntar si la mirada le da. Lo de detrás nunca entra: con
    // offAxis > 90° el coseno es negativo y el cono no lo admite; el radio
    // tampoco, porque exige además estar por delante.
    const enCono = offAxis <= opts.coneRad;
    const enCuerpo =
      offAxis < Math.PI / 2 && d * Math.sin(offAxis) <= (c.radiusM ?? 0);
    if (!enCono && !enCuerpo) continue;
    if (best === null || offAxis < best.offAxisRad ||
        (offAxis === best.offAxisRad && d < best.distanceM)) {
      best = { id: c.id, distanceM: d, offAxisRad: offAxis };
    }
  }
  return best;
}
