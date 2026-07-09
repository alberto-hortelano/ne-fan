/** Proyección de vista del cliente 2D — el puente entre el espacio de MUNDO
 *  (metros XZ, donde vive la simulación/colisión, idéntico en ambas
 *  perspectivas) y el espacio de VISTA (lo que se pinta; el canvas escala y
 *  desplaza vista→píxeles).
 *
 *  - topdown: vista == mundo (identidad) — el comportamiento de siempre.
 *  - isometric (2:1): vx = x − z ; vy = (x + z) / 2. Es EXACTAMENTE el plano
 *    de los blueprints compuestos (1 unidad de usuario del SVG = 1 metro de
 *    vista), así que las imágenes de tile se dibujan como rects alineados en
 *    vista y las entidades se proyectan con la misma fórmula.
 *
 *  La perspectiva viene congelada en la sesión; se instala una vez
 *  (renderer.setProjection) y no cambia en toda la partida. */

import { TILE_CELLS, TILE_MPC, TILE_SIZE_M } from "@nefan-core/src/scene/tile.js";

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WorldRectM {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** viewBox del blueprint compuesto (unidades de usuario del SVG). */
interface SvgViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ViewProjection {
  readonly kind: "topdown" | "isometric";
  /** Metros de VISTA por metro de ALTURA de mundo — espejo de los factores
   *  del compositor (topdown: h celdas → h user × 0.5 m = 1.0; iso:
   *  ISO_HS=0.375 user/celda × 2 celdas/m × 1 m/user = 0.75). Dimensiona los
   *  sprites de personaje para que casen con muros/puertas del blueprint. */
  readonly verticalScale: number;
  worldToView(x: number, z: number): [number, number];
  viewToWorld(vx: number, vy: number): [number, number];
  /** Rect de VISTA que cubre el canvas del tile (su blueprint compuesto y la
   *  imagen IA enmascarada que lo repinta). Sin viewBox usa el equivalente
   *  sin voladizo. */
  tileViewRect(rect: WorldRectM, viewBox?: SvgViewBox | null): ViewRect;
  /** Clave del orden del pintor entre tiles (menor = más al fondo). */
  tileDepth(tx: number, ty: number): number;
  /** Snapea una dirección de MUNDO al eje de ANIMACIÓN más cercano: los
   *  sprites tienen 8 facings (octantes de cámara), y el giro/movimiento del
   *  personaje solo vive sobre esos 8 ejes — el sprite mira EXACTAMENTE hacia
   *  donde se desplaza. El octante se elige en espacio de cámara (en iso la
   *  cámara está girada 45° respecto al mundo), así que en iso los 4 ejes
   *  diagonales de pantalla son los ejes X/Z del mundo — las líneas de la
   *  cuadrícula — y los 4 cardinales las diagonales de celda. Devuelve la
   *  dirección de mundo unitaria del eje. */
  snapForwardToAxis(wx: number, wz: number): [number, number];
}

const OCTANT = Math.PI / 4;

/** Snap de (x, z) al octante más cercano en su propio espacio (unitario). */
function snapToOctant(x: number, z: number): [number, number] {
  const a = Math.round(Math.atan2(x, z) / OCTANT) * OCTANT;
  return [Math.sin(a), Math.cos(a)];
}

class TopdownViewProjection implements ViewProjection {
  readonly kind = "topdown" as const;
  readonly verticalScale = 1.0;
  worldToView(x: number, z: number): [number, number] {
    return [x, z];
  }
  viewToWorld(vx: number, vy: number): [number, number] {
    return [vx, vy];
  }
  tileViewRect(rect: WorldRectM, viewBox?: SvgViewBox | null): ViewRect {
    // Unidad del SVG compuesto topdown = 1 celda = TILE_MPC metros.
    const vb = viewBox ?? { minX: 0, minY: 0, width: TILE_CELLS, height: TILE_CELLS };
    return {
      x: rect.minX + vb.minX * TILE_MPC,
      y: rect.minZ + vb.minY * TILE_MPC,
      w: vb.width * TILE_MPC,
      h: vb.height * TILE_MPC,
    };
  }
  tileDepth(tx: number, ty: number): number {
    return ty * 4096 + tx;
  }
  snapForwardToAxis(wx: number, wz: number): [number, number] {
    // Cámara alineada con el mundo: los ejes de animación son los octantes
    // de mundo tal cual.
    return snapToOctant(wx, wz);
  }
}

class IsoViewProjection implements ViewProjection {
  readonly kind = "isometric" as const;
  readonly verticalScale = 0.75;
  worldToView(x: number, z: number): [number, number] {
    return [x - z, (x + z) / 2];
  }
  viewToWorld(vx: number, vy: number): [number, number] {
    // x − z = vx ; x + z = 2·vy
    return [(vx + 2 * vy) / 2, (2 * vy - vx) / 2];
  }
  tileViewRect(rect: WorldRectM, viewBox?: SvgViewBox | null): ViewRect {
    // 1 unidad del SVG compuesto iso = 1 metro de vista (svg_x = 64 + vx −
    // (minX−minZ); svg_y = vy − (minX+minZ)/2), así que el canvas del tile es
    // un rect ALINEADO en vista: origen svg (0, minY) ↦ vista
    // ((minX−minZ) − 64, (minX+minZ)/2 + minY).
    const vb = viewBox ?? { minX: 0, minY: 0, width: TILE_SIZE_M * 2, height: TILE_SIZE_M };
    return {
      x: rect.minX - rect.minZ - TILE_SIZE_M + vb.minX,
      y: (rect.minX + rect.minZ) / 2 + vb.minY,
      w: vb.width,
      h: vb.height,
    };
  }
  tileDepth(tx: number, ty: number): number {
    return (tx + ty) * 4096 + (tx - ty);
  }
  snapForwardToAxis(wx: number, wz: number): [number, number] {
    // A espacio de cámara (rotación pura de 45°, la misma que usa la
    // selección de octante del sprite — sin el aplastamiento 2:1), snap al
    // octante, y de vuelta a mundo normalizado. Los octantes diagonales de
    // cámara caen en los ejes X/Z de mundo: andar en diagonal sigue las
    // líneas de la cuadrícula sin desvío.
    const [cx, cz] = snapToOctant(wx - wz, wx + wz);
    const x = (cx + cz) / 2;
    const z = (cz - cx) / 2;
    const len = Math.hypot(x, z) || 1;
    return [x / len, z / len];
  }
}

export function viewProjectionFor(kind: "topdown" | "isometric"): ViewProjection {
  return kind === "isometric" ? new IsoViewProjection() : new TopdownViewProjection();
}
