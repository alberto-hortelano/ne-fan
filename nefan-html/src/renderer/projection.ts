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
  worldToView(x: number, z: number): [number, number];
  viewToWorld(vx: number, vy: number): [number, number];
  /** Rect de VISTA que cubre el canvas del tile (su blueprint compuesto y la
   *  imagen IA enmascarada que lo repinta). Sin viewBox usa el equivalente
   *  sin voladizo. */
  tileViewRect(rect: WorldRectM, viewBox?: SvgViewBox | null): ViewRect;
  /** Clave del orden del pintor entre tiles (menor = más al fondo). */
  tileDepth(tx: number, ty: number): number;
}

class TopdownViewProjection implements ViewProjection {
  readonly kind = "topdown" as const;
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
}

class IsoViewProjection implements ViewProjection {
  readonly kind = "isometric" as const;
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
}

export function viewProjectionFor(kind: "topdown" | "isometric"): ViewProjection {
  return kind === "isometric" ? new IsoViewProjection() : new TopdownViewProjection();
}
