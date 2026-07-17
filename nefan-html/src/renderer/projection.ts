/** Proyección de vista del cliente 2D — el puente entre el espacio de MUNDO
 *  (metros XZ, donde vive la simulación/colisión) y el espacio de VISTA (lo
 *  que se pinta; el canvas escala y desplaza vista→píxeles).
 *
 *  Formato oblicuo único: vista == mundo en el plano del suelo (identidad).
 *  La altura ciza en −x (`shearX`, espejo de OBLIQUE_KX del compositor) y
 *  eleva en −y (`verticalScale`) — los prismas vectoriales muestran cara sur
 *  y cara este igual que los blueprints compuestos. */

import { OBLIQUE_KX } from "@nefan-core/src/scene/blueprint/index.js";
import { TILE_CELLS, TILE_MPC } from "@nefan-core/src/scene/tile.js";

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
  /** Metros de VISTA por metro de ALTURA de mundo (OBLIQUE_KY del compositor:
   *  h celdas → h user × 0.5 m = 1.0). Dimensiona los sprites de personaje
   *  para que casen con muros/puertas del blueprint. */
  readonly verticalScale: number;
  /** Cizalla horizontal por metro de altura (OBLIQUE_KX del compositor;
   *  negativa ⇒ tapas al oeste, cara este visible). */
  readonly shearX: number;
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
   *  donde se desplaza. Devuelve la dirección de mundo unitaria del eje. */
  snapForwardToAxis(wx: number, wz: number): [number, number];
}

const OCTANT = Math.PI / 4;

/** Snap de (x, z) al octante más cercano en su propio espacio (unitario). */
function snapToOctant(x: number, z: number): [number, number] {
  const a = Math.round(Math.atan2(x, z) / OCTANT) * OCTANT;
  return [Math.sin(a), Math.cos(a)];
}

class ObliqueViewProjection implements ViewProjection {
  readonly verticalScale = 1.0;
  readonly shearX = OBLIQUE_KX;
  worldToView(x: number, z: number): [number, number] {
    return [x, z];
  }
  viewToWorld(vx: number, vy: number): [number, number] {
    return [vx, vy];
  }
  tileViewRect(rect: WorldRectM, viewBox?: SvgViewBox | null): ViewRect {
    // Unidad del SVG compuesto = 1 celda = TILE_MPC metros. minX/minY
    // negativos del viewBox = voladizos oeste/norte sobre los vecinos.
    const vb = viewBox ?? { minX: 0, minY: 0, width: TILE_CELLS, height: TILE_CELLS };
    return {
      x: rect.minX + vb.minX * TILE_MPC,
      y: rect.minZ + vb.minY * TILE_MPC,
      w: vb.width * TILE_MPC,
      h: vb.height * TILE_MPC,
    };
  }
  tileDepth(tx: number, ty: number): number {
    // Fila a fila (los voladizos norte/oeste pisan a vecinos ya pintados).
    return ty * 4096 + tx;
  }
  snapForwardToAxis(wx: number, wz: number): [number, number] {
    // Cámara alineada con el mundo: los ejes de animación son los octantes
    // de mundo tal cual.
    return snapToOctant(wx, wz);
  }
}

/** Proyección de vista única del formato oblicuo (stateless). */
export const VIEW_PROJECTION: ViewProjection = new ObliqueViewProjection();
