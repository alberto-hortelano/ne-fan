/** Primitivas greybox de los rasgos `ground` (area/path/water/deck) para el
 *  builder del TILE, en celdas.
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
import { MIN_GROUND_SEGMENT_LENGTH, type GroundFeature, type GroundLayer, type GroundMaterial } from "./ground.js";
import type { GreyboxPrimitive } from "../greybox/common.js";

/** Colores de suelo por material declarado (rasgos `ground`). Un
 *  `Record<GroundMaterial, …>`: un material nuevo en el schema no compila
 *  hasta que tiene color, así que no hay material sin color que resolver. */
export const GROUND_MATERIAL_COLORS: Record<GroundMaterial, string> = {
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

export interface GroundPrimsOptions {
  /** Elevación de CADA capa plana, en celdas. Es un
   *  `Record<GroundLayer, …>`: un `kind` plano nuevo en el schema no compila
   *  hasta que se le da su cota, y de esta misma tabla sale el techo del suelo
   *  (`GROUND_STACK_TOP_CELLS`). Ninguna capa puede aparecer por libre. */
  layers: Record<GroundLayer, number>;
  /** Grosor de toda capa plana, en celdas. */
  layerT: number;
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
    return [{ shape: "box", size: [w, o.layerT, d], pos: [c0 + w / 2, yBase, r0 + d / 2], color, cat, noShadow: true, groundLayer: layer }];
  }
  if (f.ellipse) {
    const pts = ellipsePoints(f.ellipse.center[0], f.ellipse.center[1], f.ellipse.rx, f.ellipse.ry);
    return [{ shape: "polygon", size: [o.layerT], pos: [0, yBase, 0], points: pts, color, cat, noShadow: true, groundLayer: layer }];
  }
  if (f.polygon) {
    const pts = f.polygon as [number, number][];
    return [{ shape: "polygon", size: [o.layerT], pos: [0, yBase, 0], points: pts, color, cat, noShadow: true, groundLayer: layer }];
  }
  // El zod (ground.ts) exige una de las tres formas: llegar aquí sin ninguna
  // es un rasgo que se saltó el contrato, y callarlo lo haría desaparecer.
  throw new Error(`ground "${f.id}": sin rect, polygon ni ellipse`);
}

/** Camino como cajas por segmento + juntas cilíndricas (linecap round). */
function pathPrims(
  f: Extract<GroundFeature, { kind: "path" }>,
  color: string,
  o: GroundPrimsOptions,
): GreyboxPrimitive[] {
  const w = f.w ?? 4;
  const yPath = o.layers.path;
  const prims: GreyboxPrimitive[] = [];
  const pts = f.points as [number, number][];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < MIN_GROUND_SEGMENT_LENGTH) continue;
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
  const out: GreyboxPrimitive[] = [];
  for (const f of features) {
    if (f.kind === "area") out.push(...flatShapePrims(f, "area", GROUND_MATERIAL_COLORS[f.material], "terrain", o));
  }
  for (const f of features) {
    if (f.kind === "path") out.push(...pathPrims(f, GROUND_MATERIAL_COLORS[f.material ?? "dirt"], o));
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
