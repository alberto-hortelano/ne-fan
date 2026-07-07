/** Compositor de blueprints: plan semántico → SVG proyectado + elementos.
 *
 *  Entrada: el plan del tile que declara el motor narrativo —
 *  `map_ground` (arte plano del suelo, celdas de mundo, capas
 *  ground/water/deck, YA sanitizado) + `volumes` (huellas con altura). Salida:
 *  el blueprint SVG en la perspectiva de la sesión, listo para rasterizar y
 *  repintar por el modelo de imagen, más la lista de elementos con su bbox
 *  proyectado y baseline — la guía exacta del clasificador de visión y de los
 *  occluders (sustituye al scraping con getBBox del map_svg antiguo).
 *
 *  DETERMINISMO ES CONTRATO: mismo plan + misma perspectiva + mismo seedKey
 *  ⇒ bytes idénticos. El hash del blueprint gobierna la caché de imagen de
 *  ai_server (el resume debe hacer cache-hit). Sin Date.now/Math.random; el
 *  detalle procedural usa SeededRng por volumen. Subir COMPOSER_VERSION al
 *  cambiar CUALQUIER byte de salida — viaja en la clave de caché. */

import { BIOME_COLORS } from "./palette.js";
import type { Perspective, Projection } from "./projection.js";
import { projectionFor } from "./projection.js";
import { renderVolume, volumeFootprint, type RenderCtx } from "./render.js";
import { fmt, innerSvg, seededRng } from "./svg.js";
import { TILE_CELLS } from "../tile.js";
import type { Volume } from "./volumes.js";

/** Subir en cada cambio de bytes de salida del compositor. */
export const COMPOSER_VERSION = 1;

export interface BlueprintPlan {
  /** SVG plano del suelo (viewBox "0 0 128 128"), ya pasado por
   *  sanitizeGroundSvg. Ausente ⇒ relleno del bioma. */
  map_ground?: string | null;
  volumes: Volume[];
  /** Bioma del tile — color del relleno base bajo el arte del suelo. */
  biome?: string;
}

export interface ComposedElement {
  id: string;
  label: string;
  solid: boolean;
  tall: boolean;
  /** [x, y, w, h] en unidades de usuario del SVG compuesto (escala a px de
   *  imagen con imgW / viewBox.width). */
  bbox: [number, number, number, number];
  /** Y (unidades de usuario) de la línea de contacto con el suelo del punto
   *  más profundo — baseline del depth-sort de occluders. */
  baseline_y: number;
  /** Huella en celdas de mundo [minU, minV, maxU, maxV] — colisión y rect
   *  mundial del occluder. */
  footprint_cells: [number, number, number, number];
}

export interface ComposedBlueprint {
  svg: string;
  viewBox: { minX: number; minY: number; width: number; height: number };
  elements: ComposedElement[];
  perspective: Perspective;
  composer_version: number;
}

/** solid/tall por tipo — la semántica del clasificador de visión: solid = un
 *  personaje no lo atraviesa; tall = se dibuja encima de quien esté detrás. */
function classify(v: Volume): { solid: boolean; tall: boolean } {
  switch (v.type) {
    case "building":
    case "wall":
    case "tower":
    case "gate":
    case "tree":
      return { solid: true, tall: true };
    case "rock":
    case "fountain":
      return { solid: true, tall: false };
    case "bush":
      return { solid: false, tall: false };
    case "prop":
    default:
      return { solid: v.passable !== true, tall: (v.h ?? 2) > 4 };
  }
}

function groundLayer(plan: BlueprintPlan, proj: Projection): string {
  const parts: string[] = [];
  const base = BIOME_COLORS[plan.biome ?? "grass"] ?? BIOME_COLORS.grass;
  parts.push(`<rect x="0" y="0" width="${TILE_CELLS}" height="${TILE_CELLS}" fill="${base}"/>`);
  if (plan.map_ground) parts.push(innerSvg(plan.map_ground));
  const transform = proj.groundTransform ? ` transform="${proj.groundTransform}"` : "";
  // El clip aplica en coords locales del grupo (tras la transform): recorta el
  // arte del suelo al cuadrado del tile — fuera de él el canvas queda
  // transparente y el compositing por máscara del cliente funciona.
  return (
    `<defs><clipPath id="tileclip"><rect x="0" y="0" width="${TILE_CELLS}" height="${TILE_CELLS}"/></clipPath></defs>` +
    `<g id="ground"${transform} clip-path="url(#tileclip)">${parts.join("")}</g>`
  );
}

/** Compone el blueprint del tile en la perspectiva dada. `seedKey` (tileKey)
 *  siembra el detalle procedural — estable por tile entre sesiones. */
export function composeBlueprint(plan: BlueprintPlan, perspective: Perspective, seedKey: string): ComposedBlueprint {
  const proj = projectionFor(perspective);
  const vb = proj.viewBox;
  const out: string[] = [];
  out.push(groundLayer(plan, proj));

  // Orden del pintor: profundidad del punto de contacto más profundo.
  // Ajustes que evitan los fallos clásicos del criterio "max corner":
  //  - Edificios cutaway en dos pasadas: suelo+muros traseros a la
  //    profundidad de su borde norte (los muebles interiores quedan encima)
  //    y muros frontales bajos a la del borde sur.
  //  - Muros largos troceados en segmentos (~14 celdas) que se ordenan
  //    localmente — si no, una muralla que cruza el tile tendría la
  //    profundidad de su extremo y taparía torres y edificios enteros.
  //  - Torres y puertas con un sesgo de profundidad: se asientan SOBRE su
  //    muro anfitrión y deben pintarse después que sus segmentos.
  interface Entry {
    render: Volume;
    vid: string;
    seed: string;
    phase: "base" | "front";
    depth: number;
  }
  const entries: Entry[] = [];
  for (const v of plan.volumes) {
    const fp = volumeFootprint(v);
    if (v.type === "building" && v.cutaway) {
      entries.push({ render: v, vid: v.id, seed: `${v.id}:base`, phase: "base", depth: proj.depth(fp.cells[2], fp.cells[1]) });
      entries.push({ render: v, vid: v.id, seed: `${v.id}:front`, phase: "front", depth: proj.depth(fp.depthPoint[0], fp.depthPoint[1]) });
      continue;
    }
    if (v.type === "wall") {
      const chunks = chunkPolyline(v.points as [number, number][], 14);
      chunks.forEach((points, i) => {
        const sub: Volume = { ...v, points };
        const sfp = volumeFootprint(sub);
        entries.push({ render: sub, vid: v.id, seed: `${v.id}:${i}`, phase: "base", depth: proj.depth(sfp.depthPoint[0], sfp.depthPoint[1]) });
      });
      continue;
    }
    const bias = v.type === "tower" || v.type === "gate" ? 4 : 0;
    entries.push({ render: v, vid: v.id, seed: v.id, phase: "base", depth: proj.depth(fp.depthPoint[0], fp.depthPoint[1]) + bias });
  }
  entries.sort((a, b) => a.depth - b.depth || a.vid.localeCompare(b.vid) || a.seed.localeCompare(b.seed));

  const bboxByVid = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  const labelByVid = new Map(plan.volumes.map((v) => [v.id, v.label]));
  out.push('<g id="volumes">');
  for (const { render, vid, seed, phase } of entries) {
    const ctx: RenderCtx = { proj, rng: seededRng(`${seedKey}:${seed}`), out: [], bbox: bboxByVid.get(vid) ?? null };
    renderVolume(ctx, render, phase);
    if (ctx.out.length > 0) out.push(`<g data-vid="${vid}" data-label="${escapeAttr(labelByVid.get(vid) ?? vid)}">${ctx.out.join("")}</g>`);
    if (ctx.bbox) bboxByVid.set(vid, ctx.bbox);
  }
  out.push("</g>");

  const elements: ComposedElement[] = [];
  for (const v of plan.volumes) {
    const fp = volumeFootprint(v);
    const b = bboxByVid.get(v.id) ?? { minX: fp.cells[0], minY: fp.cells[1], maxX: fp.cells[2], maxY: fp.cells[3] };
    const [, dy] = proj.pt(fp.depthPoint[0], fp.depthPoint[1]);
    elements.push({
      id: v.id,
      label: v.label,
      ...classify(v),
      bbox: [round2(b.minX), round2(b.minY), round2(b.maxX - b.minX), round2(b.maxY - b.minY)],
      baseline_y: round2(dy),
      footprint_cells: [round2(fp.cells[0]), round2(fp.cells[1]), round2(fp.cells[2]), round2(fp.cells[3])],
    });
  }

  const svg =
    `<svg viewBox="${fmt(vb.minX)} ${fmt(vb.minY)} ${fmt(vb.width)} ${fmt(vb.height)}" xmlns="http://www.w3.org/2000/svg">` +
    out.join("") +
    "</svg>";
  return { svg, viewBox: vb, elements, perspective, composer_version: COMPOSER_VERSION };
}

/** Trocea una polilínea en tramos de 2 puntos de longitud ≤ maxLen (los
 *  segmentos largos se subdividen interpolando). */
function chunkPolyline(points: [number, number][], maxLen: number): [number, number][][] {
  const chunks: [number, number][][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [au, av] = points[i];
    const [bu, bv] = points[i + 1];
    const len = Math.hypot(bu - au, bv - av);
    const n = Math.max(1, Math.ceil(len / maxLen));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      chunks.push([
        [au + (bu - au) * t0, av + (bv - av) * t0],
        [au + (bu - au) * t1, av + (bv - av) * t1],
      ]);
    }
  }
  return chunks;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
