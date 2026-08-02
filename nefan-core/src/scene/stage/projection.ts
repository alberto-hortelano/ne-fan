/** Proyección perspectiva del plató proscenio — pura y stateless.
 *
 *  Espacios de coordenadas (documentados una vez, usados en todo el módulo):
 *
 *  - MUNDO (metros): el de la simulación/colisión. La escena legacy queda
 *    centrada en el origen (scene-normalize): x ∈ [−W/2, W/2],
 *    z ∈ [−D/2, D/2]. La cámara está al SUR (+z) mirando al norte (−z).
 *
 *  - PLATÓ (metros): xStage = distancia al eje central (x mundo tal cual,
 *    centrado en 0); zStage = distancia a la EMBOCADURA (borde sur):
 *    zStage = maxZ − zMundo ∈ [0, depth]. zStage=0 es lo más cercano a
 *    cámara, zStage=depth el telón de fondo.
 *
 *  - VISTA (unidades de usuario del SVG/canvas): perspectiva de suelo con
 *    escala s(z) = f/(f+z). La embocadura proyecta a ground_y con escala 1;
 *    el fondo converge hacia horizon_y. Vertical: un objeto de h metros a
 *    profundidad z mide h·px_per_m·s(z) unidades.
 *
 *  El renderer del cliente pinta en vista y NUNCA al revés: colisión, input
 *  y simulación siguen en mundo (viewToStage existe solo para picking). */

export interface StageProjParams {
  /** Distancia focal en metros: s(z) = focal_m / (focal_m + z). */
  focal_m: number;
  /** Profundidad jugable del plató en metros (rows × mpc). */
  depth_m: number;
  /** Ancho del plató en metros (cols × mpc). */
  width_m: number;
  /** Unidades de vista por metro en la embocadura (z=0). */
  px_per_m: number;
  /** y de vista del horizonte (límite al que converge el suelo). */
  horizon_y: number;
  /** y de vista de la línea de suelo en la embocadura (z=0). */
  ground_y: number;
  /** x de vista del punto de fuga lateral (default 0 = centro del viewBox).
   *  Solo lo fija la calibración a la perspectiva PINTADA; el compositor
   *  nunca lo emite (default ⇒ salida byte a byte idéntica). */
  center_x?: number;
  /** x lateral de la cámara en metros de plató (default 0 = eje central).
   *  Con center_x forma el modelo vx = center_x + (xStage − cam_x_m)·ppm·s. */
  cam_x_m?: number;
}

/** Límites jugables del plató en metros de MUNDO. */
export interface StageBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Escala de perspectiva a profundidad zStage (1 en la embocadura, →0 al
 *  fondo). zStage negativo (delante de la embocadura) clampa a 1. */
export function scaleAt(p: StageProjParams, zStage: number): number {
  const z = Math.max(0, zStage);
  return p.focal_m / (p.focal_m + z);
}

/** [xStage, zStage] metros de plató → [vx, vy] unidades de vista. vx=0 es el
 *  eje central; vy es la línea de CONTACTO con el suelo a esa profundidad. */
export function stageToView(p: StageProjParams, xStage: number, zStage: number): [number, number] {
  const s = scaleAt(p, zStage);
  const cx = p.center_x ?? 0;
  const xc = p.cam_x_m ?? 0;
  return [cx + (xStage - xc) * p.px_per_m * s, p.horizon_y + (p.ground_y - p.horizon_y) * s];
}

/** Inversa de stageToView sobre el plano del suelo (picking). Un vy en o por
 *  encima del horizonte no corta el suelo → null. */
export function viewToStage(p: StageProjParams, vx: number, vy: number): [number, number] | null {
  const s = (vy - p.horizon_y) / (p.ground_y - p.horizon_y);
  if (s <= 0) return null;
  const z = (p.focal_m * (1 - s)) / s;
  return [(vx - (p.center_x ?? 0)) / (p.px_per_m * s) + (p.cam_x_m ?? 0), z];
}

/** Mundo → plató (metros). El eje X del plató ES el eje X del mundo centrado;
 *  zStage crece hacia el fondo (norte). */
export function worldToStage(b: StageBounds, x: number, z: number): [number, number] {
  return [x - (b.minX + b.maxX) / 2, b.maxZ - z];
}

export function stageToWorld(b: StageBounds, xStage: number, zStage: number): [number, number] {
  return [xStage + (b.minX + b.maxX) / 2, b.maxZ - zStage];
}
