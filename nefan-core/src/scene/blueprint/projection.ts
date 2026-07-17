/** Proyección OBLICUA única del compositor de blueprints.
 *
 *  Un punto de mundo (u, v) en celdas del tile (0..128) con altura h (celdas)
 *  se proyecta a coordenadas de usuario del SVG compuesto:
 *
 *      pt(u, v, h) = [u + h·KX, v − h·KY]
 *
 *  El plano del suelo (h=0) es la IDENTIDAD — el arte plano del LLM
 *  (`map_ground`) se incrusta sin transform, la colisión y las costuras entre
 *  tiles son triviales (mundo == vista). La altura desplaza en −y (voladizo
 *  norte, como la cenital clásica) y además ciza en −x (KX negativo): los
 *  volúmenes muestran su cara sur (iluminada) y su cara este (en sombra),
 *  el look "3/4" de la oblicua militar. Con KX=0 sería la cenital pura —
 *  ambos tratamientos son mezclables porque colisión y baselines salen de la
 *  huella declarada, nunca de los píxeles.
 *
 *  El canvas incluye margen superior (voladizo norte) e izquierdo (voladizo
 *  oeste de la cizalla): viewBox con minX/minY negativos. El compositing del
 *  cliente enmascara la imagen final con el alpha de este blueprint y pinta
 *  los tiles en orden (ty, tx) ascendente, así ambos voladizos pisan a los
 *  vecinos norte/oeste ya pintados. */

import { TILE_CELLS } from "../tile.js";

/** Cizalla horizontal por celda de altura. Negativa ⇒ las tapas se inclinan
 *  al oeste, la cara ESTE queda visible (nu=+1 → shade en faceColor: sur
 *  iluminada / este en sombra) y el voladizo cae sobre el vecino oeste, que
 *  el orden de pintado por (ty, tx) ya cubre. atan(0.35) ≈ 19.3°. */
export const OBLIQUE_KX = -0.35;
/** Escala vertical de la altura: 1 celda de alto = 1 celda de pantalla
 *  (== la cenital clásica; el verticalScale del cliente sigue siendo 1). */
export const OBLIQUE_KY = 1;

/** Márgenes del canvas en unidades de usuario para los voladizos de alturas
 *  (la torre más alta admitida son 32 celdas): 32·KY arriba, 32·|KX| ≈ 11.2
 *  → 12 a la izquierda. */
export const MARGIN_Y = 32;
export const MARGIN_X = 12;

/** Desempate del orden del pintor entre volúmenes con la misma v: la cizalla
 *  solapa vecinos en u y con cámara al SE el más al este está más cerca.
 *  1/512 acota el sesgo a 0.25 en 128 celdas — nunca pisa una diferencia
 *  real de v ni los offsets ±0.01 del cutaway o el bias +4 de torres. */
const U_EPS = 1 / 512;

export interface Projection {
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

class ObliqueProjection implements Projection {
  readonly viewBox = {
    minX: -MARGIN_X,
    minY: -MARGIN_Y,
    width: TILE_CELLS + MARGIN_X,
    height: TILE_CELLS + MARGIN_Y,
  };
  pt(u: number, v: number, h = 0): [number, number] {
    return [u + h * OBLIQUE_KX, v - h * OBLIQUE_KY];
  }
  ground(x: number, y: number): [number, number] {
    return [x, y];
  }
  depth(u: number, v: number): number {
    return v + u * U_EPS;
  }
  readonly groundTransform = "";
}

/** Proyección única del formato oblicuo (stateless — instancia compartida). */
export const PROJECTION: Projection = new ObliqueProjection();
