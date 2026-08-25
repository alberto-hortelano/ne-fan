/** Primitivas greybox de los rasgos `ground` (area/path/water/deck) para el
 *  builder del TILE (celdas, transform identidad).
 *
 *  Contrato de orden: SIEMPRE cuatro pasadas areas→paths→water→decks — el
 *  array de primitivas es posicional (los occluders del tile indexan por
 *  rango) y de ese orden sale el orden de PINTADO de los calcos (`groundOrder`
 *  en fps-spec): las capas ya no se separan en y.
 *
 *  Contrato de cota: la elevación de un rasgo sale SIEMPRE de la tabla de
 *  capas que pasa el builder (`o.layers`), nunca de un número escrito aquí, y
 *  cada prim sale MARCADA con su capa (`groundLayer`). Las dos cosas son la
 *  misma: quien conoce el techo del suelo es la tabla, y quien sabe qué prims
 *  son suelo es quien las emite. */

import { PALETTE } from "./palette.js";
import type { GroundFeature, GroundLayer } from "./ground.js";
import type { GreyboxPrimitive } from "../greybox/common.js";

/** Colores de suelo por material declarado (rasgos `ground`). */
export const GROUND_MATERIAL_COLORS: Record<string, string> = {
  dirt: "#8f7757",
  cobble: "#a29b8b",
  stone: "#8b8678",
  sand: "#c2b184",
  wood: PALETTE.woodTop,
  gravel: "#9a917f",
  grass: PALETTE.grassBase,
};

/** Polígono-elipse determinista. */
export function ellipsePoints(
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  segments = 16,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

/** Muestreo Catmull-Rom (centrípeta uniforme, extremos clampados) de una
 *  polilínea: `subdiv` muestras por segmento. Determinista — el suavizado de
 *  caminos del plató; el tile no lo usa (byte-identidad de su caché). */
export function catmullRomSample(pts: [number, number][], subdiv: number): [number, number][] {
  if (pts.length < 3 || subdiv <= 1) return pts;
  const P = (i: number): [number, number] => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    for (let s = 1; s <= subdiv; s++) {
      const t = s / subdiv;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

export interface GroundPrimsOptions {
  /** Transform celda→unidades del builder (identidad en el tile). */
  toXZ: (u: number, v: number) => [number, number];
  /** Escala de LONGITUDES celda→unidades (1 en el tile). */
  scale: number;
  /** Elevación de CADA capa plana, en unidades del builder. Es un
   *  `Record<GroundLayer, …>`: un `kind` plano nuevo en el schema no compila
   *  hasta que se le da su cota, y de esta misma tabla sale el techo del suelo
   *  (`GROUND_STACK_TOP_CELLS`). Ninguna capa puede aparecer por libre. */
  layers: Record<GroundLayer, number>;
  /** Grosor de toda capa plana, en unidades del builder. */
  layerT: number;
  /** Overrides de color por material (encima de GROUND_MATERIAL_COLORS). */
  colors?: Record<string, string>;
  /** Suavizado Catmull-Rom de paths con ≥3 puntos (subdivisiones/segmento). */
  smoothPathSubdiv?: number;
  ellipseSegments?: number;
}

function flatShapePrims(
  f: Extract<GroundFeature, { kind: "area" | "water" | "deck" }>,
  layer: GroundLayer,
  color: string,
  cat: GreyboxPrimitive["cat"],
  o: GroundPrimsOptions,
): GreyboxPrimitive[] {
  const yBase = o.layers[layer];
  if (f.rect) {
    const [c0, r0, w, d] = f.rect;
    const [x, z] = o.toXZ(c0 + w / 2, r0 + d / 2);
    return [{ shape: "box", size: [w * o.scale, o.layerT, d * o.scale], pos: [x, yBase, z], color, cat, noShadow: true, groundLayer: layer }];
  }
  if (f.ellipse) {
    const pts = ellipsePoints(
      f.ellipse.center[0], f.ellipse.center[1], f.ellipse.rx, f.ellipse.ry,
      o.ellipseSegments ?? 16,
    ).map(([u, v]) => o.toXZ(u, v));
    return [{ shape: "polygon", size: [o.layerT], pos: [0, yBase, 0], points: pts, color, cat, noShadow: true, groundLayer: layer }];
  }
  if (f.polygon) {
    const pts = (f.polygon as [number, number][]).map(([u, v]) => o.toXZ(u, v));
    return [{ shape: "polygon", size: [o.layerT], pos: [0, yBase, 0], points: pts, color, cat, noShadow: true, groundLayer: layer }];
  }
  return [];
}

/** Camino como cajas por segmento + juntas cilíndricas (linecap round). */
function pathPrims(
  f: Extract<GroundFeature, { kind: "path" }>,
  color: string,
  o: GroundPrimsOptions,
): GreyboxPrimitive[] {
  const w = (f.w ?? 4) * o.scale;
  const yPath = o.layers.path;
  const prims: GreyboxPrimitive[] = [];
  let pts = (f.points as [number, number][]).map(([u, v]) => o.toXZ(u, v));
  if (o.smoothPathSubdiv && o.smoothPathSubdiv > 1) pts = catmullRomSample(pts, o.smoothPathSubdiv);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) continue;
    prims.push({
      shape: "box",
      size: [len, o.layerT, w],
      pos: [(ax + bx) / 2, yPath, (az + bz) / 2],
      rotY: -Math.atan2(bz - az, bx - ax),
      color,
      cat: "terrain",
      noShadow: true,
      groundLayer: "path",
    });
  }
  for (const [px, pz] of pts) {
    prims.push({ shape: "cylinder", size: [w / 2, o.layerT], pos: [px, yPath, pz], color, cat: "terrain", noShadow: true, groundLayer: "path" });
  }
  return prims;
}

/** Primitivas de TODOS los rasgos ground, en el orden contractual. */
export function groundFeaturePrims(features: GroundFeature[], o: GroundPrimsOptions): GreyboxPrimitive[] {
  const color = (material: string | undefined, fallback: string): string => {
    const key = material ?? "";
    return o.colors?.[key] ?? GROUND_MATERIAL_COLORS[key] ?? fallback;
  };
  const out: GreyboxPrimitive[] = [];
  for (const f of features) {
    if (f.kind === "area") out.push(...flatShapePrims(f, "area", color(f.material, "#8f7757"), "terrain", o));
  }
  for (const f of features) {
    if (f.kind === "path") out.push(...pathPrims(f, color(f.material ?? "dirt", "#8f7757"), o));
  }
  for (const f of features) {
    if (f.kind === "water") out.push(...flatShapePrims(f, "water", PALETTE.water, "water", o));
  }
  for (const f of features) {
    if (f.kind === "deck") {
      out.push(...flatShapePrims(f, "deck", f.material === "stone" ? "#8b8678" : PALETTE.woodTop, "terrain", o));
    }
  }
  return out;
}
