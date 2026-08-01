/** Encuadre cinematográfico y PARALLAX por profundidad del proscenio — puro.
 *
 *  La cámara del plató recorre un raíl en X. Proyectar cada capa/entidad con
 *  su desplazamiento `parallaxPanX(z) = camOffsetM · ppm · s(z)` NO es una
 *  aproximación de parallax: sustituyendo `vx = xStage·ppm·s(z)` queda
 *  `screenX = cw/2 + (xStage − camOffsetM)·ppm·s(z)·fit` — la proyección
 *  EXACTA respecto a la x de la cámara. Un sprite y una capa a la misma z
 *  comparten fórmula y quedan clavados entre sí; el movimiento relativo
 *  emerge solo entre profundidades distintas (lo cercano corre más).
 *
 *  El suelo es continuo en z (una imagen rígida no puede panearse por
 *  profundidad): se warpea por BANDAS horizontales — solo la franja
 *  yBack < vy < ground_y necesita bandear; el backdrop (z = depth constante)
 *  y el delantal (z = 0) son una banda cada uno. El plan de bandas es
 *  precomputable por (plató, tamaño de canvas) y usa un PRESUPUESTO de
 *  desplazamiento (Δdx máximo entre el borde superior e inferior de una
 *  banda en el extremo del raíl): bandas finas cerca, gruesas lejos — la
 *  causa raíz del moiré del experimento de julio, atacada de origen. El
 *  renderer las pinta con drawImage (jamás ctx.clip(): congela Chrome).
 *
 *  Garantía anti-huecos: clampando el raíl con el ancho JUGABLE
 *  (width_m/2 − viewport/2), la columna fuente que pide una banda a
 *  profundidad z en el extremo del raíl es width_m/2·ppm·s + (1−s)·cw/(2·fit)
 *  y su déficit respecto al ancho pintado es −(1−s)·railHalfM·ppm ≤ 0:
 *  las bandas cercanas llegan JUSTO al borde pintado y las lejanas sobran. */

import { scaleAt, stageToView, viewToStage, type StageProjParams } from "./projection.js";

export interface ViewBoxRect {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Encuadre del plató en el canvas: zoom adaptativo + anclaje vertical. */
export interface StageFraming {
  /** px de canvas por unidad de vista (fit0 · zoom). */
  fit: number;
  zoom: number;
  /** Fila de canvas donde cae ground_y (línea de suelo de la embocadura). */
  groundScreenY: number;
  /** Semirrecorrido del raíl en METROS (clamp con el ancho jugable). */
  railHalfM: number;
}

export interface FramingOpts {
  /** Fracción máxima del ancho jugable visible en el viewport. */
  coverFraction?: number;
  maxZoom?: number;
  minZoom?: number;
  /** Fracción de la altura del canvas donde se ancla ground_y. */
  groundAnchor?: number;
}

export const FRAMING_DEFAULTS: Required<FramingOpts> = {
  coverFraction: 0.7,
  // 2.8 garantiza recorrido de raíl incluso en platós enanos (12 m) con
  // canvas ancho; los medianos (16–32 m) no llegan al clamp.
  maxZoom: 2.8,
  minZoom: 1,
  groundAnchor: 0.78,
};

export function frameStage(
  p: StageProjParams,
  vb: ViewBoxRect,
  canvasW: number,
  canvasH: number,
  opts: FramingOpts = {},
): StageFraming {
  const o = { ...FRAMING_DEFAULTS, ...opts };
  const fit0 = canvasH / vb.height;
  // Zoom adaptativo: el viewport abarca como mucho coverFraction del ancho
  // jugable — así el raíl SIEMPRE tiene recorrido (platós enanos clampan a
  // maxZoom; los gigantes a minZoom, donde fit0 ya deja raíl de sobra).
  const zoomRaw = canvasW / (o.coverFraction * p.width_m * p.px_per_m * fit0);
  const zoom = Math.min(o.maxZoom, Math.max(o.minZoom, zoomRaw));
  const fit = fit0 * zoom;
  const groundScreenY = o.groundAnchor * canvasH;
  const railHalfM = Math.max(0, p.width_m / 2 - canvasW / (2 * fit * p.px_per_m));
  return { fit, zoom, groundScreenY, railHalfM };
}

/** Desplazamiento de paneo (unidades de VISTA) a profundidad zStage. */
export function parallaxPanX(p: StageProjParams, zStage: number, camOffsetM: number): number {
  return camOffsetM * p.px_per_m * scaleAt(p, zStage);
}

/** Vista → canvas con parallax por profundidad y anclaje vertical. */
export function viewToScreen(
  p: StageProjParams,
  f: StageFraming,
  canvasW: number,
  vx: number,
  vy: number,
  zStage: number,
  camOffsetM: number,
): [number, number] {
  return [
    canvasW / 2 + (vx - parallaxPanX(p, zStage, camOffsetM)) * f.fit,
    f.groundScreenY + (vy - p.ground_y) * f.fit,
  ];
}

/** Banda horizontal del warp del suelo. Destino en FILAS ENTERAS de canvas
 *  (contiguas, sin solapes); fuente en unidades de vista del viewBox. */
export interface GroundBand {
  destY: number;
  destH: number;
  srcVy: number;
  srcVh: number;
  /** zStage del centro de la banda — alimenta parallaxPanX. */
  z: number;
}

export interface BandPlan {
  /** Muro/cielo del fondo (vy ≤ yBack): z = depth constante, una banda. */
  backdrop: GroundBand;
  /** Franja de suelo en perspectiva (yBack < vy < ground_y). */
  ground: GroundBand[];
  /** Delantal (vy ≥ ground_y): z = 0, estirado hasta el borde del canvas. */
  apron: GroundBand;
}

export interface BandPlanOpts {
  /** Δdx máximo (px) dentro de una banda en el extremo del raíl. */
  maxShiftPx?: number;
  maxBandPx?: number;
}

export const BAND_PLAN_DEFAULTS: Required<BandPlanOpts> = {
  maxShiftPx: 0.75,
  maxBandPx: 8,
};

export function bandPlanFor(
  p: StageProjParams,
  vb: ViewBoxRect,
  f: StageFraming,
  canvasW: number,
  canvasH: number,
  opts: BandPlanOpts = {},
): BandPlan {
  void canvasW;
  const o = { ...BAND_PLAN_DEFAULTS, ...opts };
  const yBack = stageToView(p, 0, p.depth_m)[1];
  const destYof = (vy: number): number => f.groundScreenY + (vy - p.ground_y) * f.fit;
  const vyAt = (destY: number): number => (destY - f.groundScreenY) / f.fit + p.ground_y;
  /** z del suelo en vy, clampada al plató (sobre el horizonte → depth). */
  const zAt = (vy: number): number => {
    const st = viewToStage(p, 0, vy);
    return st ? Math.min(p.depth_m, Math.max(0, st[1])) : p.depth_m;
  };

  // Backdrop: desde el techo del viewBox (o del canvas) hasta la línea de
  // contacto del fondo — z constante, un solo drawImage.
  const backdropTop = Math.max(0, Math.ceil(destYof(vb.minY)));
  const backdropBottom = Math.max(backdropTop, Math.floor(destYof(yBack)));
  const backdrop: GroundBand = {
    destY: backdropTop,
    destH: backdropBottom - backdropTop,
    srcVy: vyAt(backdropTop),
    srcVh: vyAt(backdropBottom) - vyAt(backdropTop),
    z: p.depth_m,
  };

  // Franja de suelo: bandas adaptativas por presupuesto de desplazamiento.
  const ground: GroundBand[] = [];
  const groundEnd = Math.min(canvasH, Math.floor(f.groundScreenY));
  const shiftAt = (z: number): number => f.railHalfM * p.px_per_m * f.fit * scaleAt(p, z);
  let y = backdropBottom;
  while (y < groundEnd) {
    const shiftTop = shiftAt(zAt(vyAt(y)));
    let h = 1;
    while (
      h < o.maxBandPx &&
      y + h < groundEnd &&
      Math.abs(shiftAt(zAt(vyAt(y + h + 1))) - shiftTop) <= o.maxShiftPx
    ) {
      h++;
    }
    ground.push({
      destY: y,
      destH: h,
      srcVy: vyAt(y),
      srcVh: vyAt(y + h) - vyAt(y),
      z: zAt(vyAt(y + h / 2)),
    });
    y += h;
  }

  // Delantal: el resto del canvas, estirando la franja bajo ground_y (suelo
  // cercano) — rellena el hueco que abre el anclaje vertical.
  const viewBottom = vb.minY + vb.height;
  const apron: GroundBand = {
    destY: groundEnd,
    destH: Math.max(0, canvasH - groundEnd),
    srcVy: p.ground_y,
    srcVh: Math.max(0.001, viewBottom - p.ground_y),
    z: 0,
  };

  return { backdrop, ground, apron };
}
