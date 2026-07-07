/** Proyecciones del compositor de blueprints.
 *
 *  Ambas perspectivas comparten el contrato: un punto de mundo (u, v) en
 *  celdas del tile (0..128) con altura h (celdas) se proyecta a coordenadas
 *  de usuario del SVG compuesto. El plano del suelo (h=0) es SIEMPRE afín e
 *  invertible — el arte plano del LLM (`map_ground`) se incrusta con una
 *  única transform y las posiciones de pantalla vuelven a mundo sin
 *  ambigüedad; la altura solo desplaza en -y de pantalla.
 *
 *  - topdown  ("cenital con caras"): identidad en el suelo; las caras sur de
 *    los volúmenes se pintan entre v y v−h (el voladizo sale por el margen
 *    superior del canvas).
 *  - isometric (2:1 exacto): x = CX + (u−v)·SX, y = (u+v)·SY − h·HS.
 *
 *  El canvas incluye un MARGEN superior fijo para el voladizo de alturas:
 *  viewBox "minX minY width height" con minY negativo. El compositing del
 *  cliente enmascara la imagen final con el alpha de este blueprint, así el
 *  voladizo pisa al tile de detrás en el orden del pintor. */

import { TILE_CELLS } from "../tile.js";

export type Perspective = "topdown" | "isometric";

export const PERSPECTIVES: readonly Perspective[] = ["topdown", "isometric"] as const;

export function isPerspective(v: unknown): v is Perspective {
  return v === "topdown" || v === "isometric";
}

/** Margen superior del canvas en unidades de usuario (voladizo de alturas:
 *  la torre más alta admitida son 32 celdas → 32 en topdown, 32·HS en iso). */
export const TOPDOWN_MARGIN = 32;
export const ISO_MARGIN = 14;

/** Escalas de la iso 2:1 exacta. Con CX=64: x∈[0,128], y∈[0,64]. */
export const ISO_SX = 0.5;
export const ISO_SY = 0.25;
/** Altura: 1 celda de alto ≈ 1.5 celdas de fondo en pantalla (mismo ratio
 *  validado en la demo: HS/SY ≈ 1.5). */
export const ISO_HS = 0.375;

export interface Projection {
  readonly kind: Perspective;
  /** viewBox del SVG compuesto. */
  readonly viewBox: { minX: number; minY: number; width: number; height: number };
  /** (u,v,h) en celdas → [x,y] en unidades de usuario del SVG. */
  pt(u: number, v: number, h?: number): [number, number];
  /** Inversa sobre el plano del suelo (h=0). */
  ground(x: number, y: number): [number, number];
  /** Clave del orden del pintor: mayor = más cerca de cámara (se pinta después). */
  depth(u: number, v: number): number;
  /** Atributo transform para incrustar arte plano dibujado en celdas. */
  groundTransform: string;
}

class TopdownProjection implements Projection {
  readonly kind = "topdown" as const;
  readonly viewBox = { minX: 0, minY: -TOPDOWN_MARGIN, width: TILE_CELLS, height: TILE_CELLS + TOPDOWN_MARGIN };
  pt(u: number, v: number, h = 0): [number, number] {
    return [u, v - h];
  }
  ground(x: number, y: number): [number, number] {
    return [x, y];
  }
  depth(_u: number, v: number): number {
    return v;
  }
  readonly groundTransform = "";
}

class IsoProjection implements Projection {
  readonly kind = "isometric" as const;
  readonly cx = TILE_CELLS * ISO_SX; // 64
  readonly viewBox = {
    minX: 0,
    minY: -ISO_MARGIN,
    width: TILE_CELLS * 2 * ISO_SX,
    height: TILE_CELLS * 2 * ISO_SY + ISO_MARGIN,
  };
  pt(u: number, v: number, h = 0): [number, number] {
    return [this.cx + (u - v) * ISO_SX, (u + v) * ISO_SY - h * ISO_HS];
  }
  ground(x: number, y: number): [number, number] {
    const a = (x - this.cx) / ISO_SX; // u - v
    const b = y / ISO_SY; // u + v
    return [(a + b) / 2, (b - a) / 2];
  }
  depth(u: number, v: number): number {
    return u + v;
  }
  /** matrix(a,b,c,d,e,f): x' = a·u + c·v + e ; y' = b·u + d·v + f. */
  readonly groundTransform = `matrix(${ISO_SX} ${ISO_SY} ${-ISO_SX} ${ISO_SY} ${this.cx} 0)`;
}

export function projectionFor(perspective: Perspective): Projection {
  return perspective === "isometric" ? new IsoProjection() : new TopdownProjection();
}
