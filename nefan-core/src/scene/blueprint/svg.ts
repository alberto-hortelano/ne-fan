/** Utilidades de construcción de SVG por strings (sin DOM — el compositor
 *  corre igual en node y navegador) + PRNG sembrado para el detalle
 *  procedural. El determinismo es contrato: el hash del blueprint gobierna la
 *  caché de imagen de ai_server, así que dos composiciones del mismo plan
 *  deben producir bytes idénticos (sin Date.now/Math.random). */

import { SeededRng, fnv1a, seededRng } from "../../rng.js";

export { fnv1a, seededRng };

/** Formato compacto y estable de números (2 decimales, sin ceros colgantes). */
export function fmt(n: number): string {
  const s = n.toFixed(2);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function polygon(pts: [number, number][], fill: string, extra = ""): string {
  const p = pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  return `<polygon points="${p}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

export function polyline(pts: [number, number][], stroke: string, width: number, extra = ""): string {
  const p = pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  return `<polyline points="${p}" fill="none" stroke="${stroke}" stroke-width="${fmt(width)}"${extra ? ` ${extra}` : ""}/>`;
}

export function line(a: [number, number], b: [number, number], stroke: string, width: number, extra = ""): string {
  return `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="${stroke}" stroke-width="${fmt(width)}"${extra ? ` ${extra}` : ""}/>`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, fill: string, extra = ""): string {
  return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

export function circle(cx: number, cy: number, r: number, fill: string, extra = ""): string {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

export function rectEl(x: number, y: number, w: number, h: number, fill: string, extra = ""): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

export function path(d: string, fill: string, extra = ""): string {
  return `<path d="${d}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

/** Uniforme en [lo, hi) sobre un SeededRng. */
export function uniform(rng: SeededRng, lo: number, hi: number): number {
  return lo + rng.next() * (hi - lo);
}

export function pick<T>(rng: SeededRng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))];
}

/** Extrae el contenido interior de un documento <svg …>…</svg> ya sanitizado
 *  (para incrustarlo en un <g transform> del blueprint compuesto). Fail-loud:
 *  el caller debe haber pasado el SVG por sanitizeGroundSvg antes. */
export function innerSvg(svgDoc: string): string {
  const open = svgDoc.indexOf(">");
  const close = svgDoc.lastIndexOf("</svg>");
  if (open < 0 || close < 0 || close <= open) {
    throw new Error("innerSvg: documento SVG mal formado");
  }
  return svgDoc.slice(open + 1, close);
}
