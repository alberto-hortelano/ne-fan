/** Geometría de prismas/cilindros en ESPACIO DE VISTA para el renderer 2D.
 *
 *  Espejo vectorial de lo que el compositor de blueprints hace en espacio de
 *  celdas (`blueprint/render.ts`): una caja con altura se pinta como huella
 *  proyectada + caras verticales orientadas a cámara + tapa desplazada
 *  `(+h·shearX, −h·verticalScale)` — la cizalla oblicua. Aquí las unidades
 *  son METROS de mundo y la proyección la aporta el cliente — el módulo es
 *  puro y testeable sin canvas.
 *
 *  Convención de cámara (la del compositor): cara SUR (+z) iluminada, cara
 *  ESTE (+x) en sombra. Con shearX=0 la cara este degenera a área 0 y se
 *  descarta (cenital pura).
 */

/** Lo que este módulo necesita de la proyección de vista del cliente
 *  (shape estructural de `nefan-html/src/renderer/projection.ts`). */
export interface ViewProjLike {
  /** Metros de vista por metro de altura de mundo. */
  readonly verticalScale: number;
  /** Cizalla horizontal por metro de altura (OBLIQUE_KX del compositor;
   *  negativa ⇒ tapas al oeste, cara este visible). */
  readonly shearX: number;
  worldToView(x: number, z: number): [number, number];
}

export type ViewPoint = [number, number];

export interface ViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PrismGeom {
  /** Huella proyectada a ras de suelo, orden nw→ne→se→sw. */
  base: ViewPoint[];
  /** La misma huella con la tapa desplazada (vx + h·shearX, vy − h·verticalScale). */
  top: ViewPoint[];
  /** Cara sur (+z, iluminada) — ausente si degenera (área ~0). */
  south?: ViewPoint[];
  /** Cara este (+x, en sombra) — ausente si degenera (shearX = 0). */
  east?: ViewPoint[];
  /** vy máximo de la base (borde/esquina sur) — clave de profundidad para el
   *  depth-sort, mismo criterio que los occluders del plan. */
  baselineViewY: number;
  /** AABB en vista de todo el prisma (base + tapa). */
  viewBounds: ViewBounds;
}

/** Área con signo de un polígono en vista (shoelace). */
function polyArea(pts: ViewPoint[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const DEGENERATE_AREA = 1e-6;

function boundsOf(...polys: ViewPoint[][]): ViewBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Prisma de huella `sx×sz` metros centrada en (cx,cz), altura `h` metros,
 *  con la base a ras de suelo (position = base, como la colisión). */
export function prismQuads(
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  h: number,
  proj: ViewProjLike,
): PrismGeom {
  const hw = sx / 2;
  const hd = sz / 2;
  // Esquinas de mundo en orden nw, ne, se, sw (norte = −z, este = +x).
  const corners: [number, number][] = [
    [cx - hw, cz - hd],
    [cx + hw, cz - hd],
    [cx + hw, cz + hd],
    [cx - hw, cz + hd],
  ];
  const base = corners.map(([x, z]) => proj.worldToView(x, z));
  const lift = h * proj.verticalScale;
  const shear = h * proj.shearX;
  const top: ViewPoint[] = base.map(([vx, vy]) => [vx + shear, vy - lift]);

  // Índices del orden nw(0), ne(1), se(2), sw(3). Caras orientadas a cámara:
  // sur (sw→se) y este (se→ne), de suelo a tapa.
  const south: ViewPoint[] = [base[3], base[2], top[2], top[3]];
  const east: ViewPoint[] = [base[2], base[1], top[1], top[2]];

  const geom: PrismGeom = {
    base,
    top,
    baselineViewY: Math.max(...base.map(([, vy]) => vy)),
    viewBounds: boundsOf(base, top),
  };
  if (h > 0 && Math.abs(polyArea(south)) > DEGENERATE_AREA) geom.south = south;
  if (h > 0 && Math.abs(polyArea(east)) > DEGENERATE_AREA) geom.east = east;
  return geom;
}

export interface CylinderGeom {
  /** Centro de la elipse base en vista. */
  center: ViewPoint;
  /** Semiejes de la elipse proyectada (suelo identidad ⇒ r, r). */
  rx: number;
  ry: number;
  /** Centro de la tapa: (center[0] + h·shearX, center[1] − h·verticalScale). */
  topCx: number;
  topCy: number;
  baselineViewY: number;
  viewBounds: ViewBounds;
}

/** Cilindro de radio `r` metros y altura `h` metros con base en (cx,cz).
 *  La elipse proyectada replica `groundEllipse` del compositor. */
export function cylinderGeom(
  cx: number,
  cz: number,
  r: number,
  h: number,
  proj: ViewProjLike,
): CylinderGeom {
  const [vx, vy] = proj.worldToView(cx, cz);
  // Semiejes en vista: extremos de |Δvx|/|Δvy| sondeando puntos DEL círculo
  // en las direcciones singulares de la proyección (0°, 45°, 90°, 135°).
  // Con el suelo identidad → (r, r).
  const s = Math.SQRT1_2 * r;
  let rx = 0;
  let ry = 0;
  for (const [dx, dz] of [[r, 0], [s, s], [0, r], [s, -s]] as const) {
    const [px, py] = proj.worldToView(cx + dx, cz + dz);
    rx = Math.max(rx, Math.abs(px - vx));
    ry = Math.max(ry, Math.abs(py - vy));
  }
  const topCx = vx + h * proj.shearX;
  const topCy = vy - h * proj.verticalScale;
  return {
    center: [vx, vy],
    rx,
    ry,
    topCx,
    topCy,
    baselineViewY: vy + ry,
    viewBounds: {
      minX: Math.min(vx, topCx) - rx,
      minY: topCy - ry,
      maxX: Math.max(vx, topCx) + rx,
      maxY: vy + ry,
    },
  };
}
