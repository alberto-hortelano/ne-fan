/** ¿A qué está mirando el jugador? — selección pura por desviación angular.
 *
 *  En primera persona "lo que tienes delante" NO es lo más cercano: un NPC a
 *  medio metro a tu espalda sigue siendo el más cercano y no lo estás mirando.
 *  La etiqueta de mundo y la mirilla necesitan la otra pregunta —qué enfila la
 *  cámara— y esa es esta función: entrada → salida, sin DOM ni three.
 *
 *  Se mide en las TRES dimensiones, contra la dirección real de la cámara.
 *  Antes bastaba el plano XZ porque la vista era de yaw puro; desde que se
 *  puede mirar arriba y abajo, la proyección horizontal mentiría: con la
 *  mirada clavada en tus botas, el tabernero seguiría "apuntado" y su nombre
 *  encendido.
 *
 *  Y se mide con la DESVIACIÓN ANGULAR, no con la distancia perpendicular: a
 *  10 m un objeto desviado 1 m está casi en el centro de la pantalla, y a 1 m
 *  está fuera de ella. El cono se declara en radianes de pantalla, que es lo
 *  que el jugador ve. */

export interface Punto3 {
  x: number;
  y: number;
  z: number;
}

export interface AimCandidate {
  id: string;
  /** Punto de mira en METROS: el centro del cuerpo, no los pies. */
  pos: Punto3;
  /** Media anchura del candidato en METROS. Se apunta a un CUERPO, no a su
   *  punto central: sin esto, un NPC a un metro y medio paso a la izquierda
   *  llena media pantalla y aun así queda "sin apuntar". */
  radiusM?: number;
  /** Media ALTURA en metros. Un personaje es un elipsoide DE PIE, no una
   *  bola: mirarle a las rodillas desde cerca sigue siendo mirarle. Sin
   *  declararla, el cuerpo es una esfera de radio `radiusM`. */
  halfHeightM?: number;
}

export interface AimPick {
  id: string;
  /** Distancia en METROS del ojo al punto de mira del candidato. */
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

/** Ángulo sin signo entre dos vectores UNITARIOS.
 *  atan2(|cruz|, punto) en vez de acos(punto): acos se satura cerca de 0 y de
 *  π, justo donde viven "lo tengo enfilado" y "lo tengo a la espalda". */
function anguloEntre(
  ux: number, uy: number, uz: number,
  vx: number, vy: number, vz: number,
): number {
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.atan2(Math.hypot(cx, cy, cz), ux * vx + uy * vy + uz * vz);
}

/** ¿La línea de mirada TOCA el cuerpo del candidato?
 *
 *  El cuerpo se modela como un elipsoide de pie de semiejes (r, h, r).
 *  Comprimiendo la vertical por r/h el elipsoide vuelve a ser una esfera de
 *  radio r, y el test es otra vez "distancia de la recta al centro ≤ r": las
 *  transformaciones lineales conservan las intersecciones, así que la
 *  respuesta es exacta y no una aproximación.
 *
 *  Lo de detrás nunca entra: se exige además que el candidato esté por
 *  delante del ojo (producto escalar positivo). */
function miraAlCuerpo(
  fx: number, fy: number, fz: number,
  dx: number, dy: number, dz: number,
  r: number, h: number,
): boolean {
  if (r <= 0 || h <= 0) return false;
  const k = r / h;
  const flen = Math.hypot(fx, fy * k, fz);
  if (flen < 1e-9) return false;
  const ux = fx / flen;
  const uy = (fy * k) / flen;
  const uz = fz / flen;
  const ey = dy * k;
  if (ux * dx + uy * ey + uz * dz <= 0) return false;
  const cx = uy * dz - uz * ey;
  const cy = uz * dx - ux * dz;
  const cz = ux * ey - uy * dx;
  return Math.hypot(cx, cy, cz) <= r;
}

/** Candidato que la cámara enfila, o null si no hay ninguno dentro del cono.
 *  Gana la menor desviación angular; a igualdad, el más cercano.
 *
 *  Fail-loud: un `forward` de longitud cero no es "no hay objetivo", es una
 *  llamada mal construida — la dirección de la cámara nunca es nula. */
export function pickAimTarget(
  origin: Punto3,
  forward: Punto3,
  candidates: readonly AimCandidate[],
  opts: AimOptions,
): AimPick | null {
  const fLen = Math.hypot(forward.x, forward.y, forward.z);
  if (fLen < 1e-9) throw new Error("pickAimTarget: forward nulo (sin dirección de mirada)");
  const fx = forward.x / fLen;
  const fy = forward.y / fLen;
  const fz = forward.z / fLen;

  let best: AimPick | null = null;
  for (const c of candidates) {
    const dx = c.pos.x - origin.x;
    const dy = c.pos.y - origin.y;
    const dz = c.pos.z - origin.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > opts.maxDistanceM) continue;
    const offAxis = d < 1e-9 ? 0 : anguloEntre(fx, fy, fz, dx / d, dy / d, dz / d);
    // Entra por CONO (lo que enfila el centro de la pantalla) o por CUERPO
    // (lo que llena media pantalla aunque su centro quede fuera del cono).
    const r = c.radiusM ?? 0;
    if (offAxis > opts.coneRad && !miraAlCuerpo(fx, fy, fz, dx, dy, dz, r, c.halfHeightM ?? r)) {
      continue;
    }
    if (best === null || offAxis < best.offAxisRad ||
        (offAxis === best.offAxisRad && d < best.distanceM)) {
      best = { id: c.id, distanceM: d, offAxisRad: offAxis };
    }
  }
  return best;
}
