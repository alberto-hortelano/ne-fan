/** Compositor de blueprints: plan semántico → SVG proyectado + elementos.
 *
 *  Entrada: el plan del tile que declara el motor narrativo —
 *  `map_ground` (arte plano del suelo, celdas de mundo, capas
 *  ground/water/deck, YA sanitizado) + `volumes` (huellas con altura). Salida:
 *  el blueprint SVG en la proyección oblicua única, listo para rasterizar y
 *  repintar por el modelo de imagen, más la lista de elementos con su bbox
 *  proyectado y baseline — la guía exacta del clasificador de visión y de los
 *  occluders (sustituye al scraping con getBBox del map_svg antiguo).
 *
 *  DETERMINISMO ES CONTRATO: mismo plan + mismo seedKey ⇒ bytes idénticos.
 *  El hash del blueprint gobierna la caché de imagen de ai_server (el resume
 *  debe hacer cache-hit). Sin Date.now/Math.random; el detalle procedural usa
 *  SeededRng por volumen. Subir COMPOSER_VERSION al cambiar CUALQUIER byte de
 *  salida — viaja en la clave de caché. */

import { BIOME_COLORS, darken, lighten } from "./palette.js";
import type { Projection } from "./projection.js";
import { PROJECTION } from "./projection.js";
import { renderVolume, volumeFootprint, type RenderCtx } from "./render.js";
import { circle, ellipse, fmt, innerSvg, seededRng, uniform } from "./svg.js";
import { TILE_CELLS } from "../tile.js";
import type { Volume } from "./volumes.js";

/** Subir en cada cambio de bytes de salida del compositor.
 *  v2: las entities estáticas del esquema (building/tree/prop/decor) derivan
 *  volumen — el blueprint de tiles existentes cambia.
 *  v3: detalle procedural del suelo (manchas de bioma, flores, piedritas)
 *  bajo el arte del LLM — el suelo deja de ser un color plano.
 *  v4: los muros traseros del cutaway se emiten en dos grupos (back_n /
 *  back_w) — tramos de occluder con huella fina para el depth-sort.
 *  v5: árbol en dos grupos (tronco / copa — la copa es occluder AÉREO) y
 *  sombras pegadas a la base de los volúmenes.
 *  v6: la copa es traslúcida (opacity + data-part="canopy") — deja ver el
 *  suelo y a quien pase debajo; el cliente la excluye de la capa base y la
 *  pinta solo como occluder aéreo, así el alpha se aplica una vez. La escala
 *  de árbol queda acotada a TREE_MAX_S (parseVolumes clampa).
 *  v7: todo tramo que emite occluder va marcado data-part="tall" — el cliente
 *  lo excluye de la capa base (como la copa) y lo pinta solo vía su cutout en
 *  el depth-sort, para poder fundirlo por proximidad del jugador revelando el
 *  suelo real que hay debajo.
 *  v8: proyección OBLICUA única (sustituye a topdown e isometric): suelo
 *  identidad + cizalla KX=−0.35 en la altura — los volúmenes muestran cara
 *  sur iluminada y cara este en sombra, viewBox con margen oeste. */
export const COMPOSER_VERSION = 8;

/** Opacidad de la copa del árbol: cubre sin ocultar del todo lo que hay
 *  debajo (las copas tapan mucha superficie de tile). */
export const CANOPY_OPACITY = 0.65;

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

/** Sprite vectorial recortable de UN tramo de volumen alto: SVG standalone
 *  (mismas unidades de usuario que el blueprint) + bbox + baseline. El
 *  cliente lo rasteriza y lo usa como occluder de depth-sort cuando no hay
 *  imagen IA (modo vectorial / interim hasta el análisis). Un muro largo
 *  emite un occluder POR TRAMO (cada uno con su baseline local); un edificio
 *  cutaway emite cada muro trasero y los frontales bajos por separado. */
export interface ComposedOccluder {
  /** Único dentro del tile (id del volumen + sufijo de tramo/fase). */
  id: string;
  /** Volumen padre (correlaciona con `elements`). */
  vid: string;
  label: string;
  /** SVG standalone listo para rasterizar (viewBox = bbox con margen). */
  svg: string;
  /** [x, y, w, h] en unidades de usuario del blueprint compuesto. */
  bbox: [number, number, number, number];
  /** Y (unidades de usuario) del punto de contacto más profundo del tramo. */
  baseline_y: number;
  /** Huella del TRAMO en celdas de mundo [minU, minV, maxU, maxV] — el
   *  depth-sort del cliente compara la posición de cada entidad contra ella
   *  (delante ⇔ este o sur de la huella); para árboles es SOLO el tronco. */
  footprint_cells: [number, number, number, number];
  /** true = tramo AÉREO (copa de árbol): está por encima de la altura de un
   *  personaje y se pinta SIEMPRE encima de las entidades, sin importar su
   *  posición en el suelo. */
  overhead?: boolean;
}

export interface ComposedBlueprint {
  svg: string;
  viewBox: { minX: number; minY: number; width: number; height: number };
  elements: ComposedElement[];
  /** Tramos recortables de los volúmenes `tall` (depth-sort sin imagen IA). */
  occluders: ComposedOccluder[];
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

/** Flores por bioma (círculos diminutos): tonos que leen como vegetación
 *  floreciendo sin gritar. Biomas áridos/nevados no llevan. */
const BIOME_FLOWERS: Record<string, string[]> = {
  grass: ["#d8c458", "#c8d2df", "#c98a9a"],
  meadow: ["#d8c458", "#c8d2df", "#c98a9a", "#b48ac9"],
  forest_floor: ["#c8d2df", "#a9b86a"],
  swamp: ["#a9b86a"],
};

/** Detalle procedural del suelo — la base de calidad NO depende del arte del
 *  LLM: manchas orgánicas del bioma en dos tonos, piedritas y flores
 *  dispersas (el estilo de las demos del blueprint lab). Va DEBAJO del
 *  map_ground: los caminos/plazas del LLM pintan encima y las flores no los
 *  invaden. Determinista por seedKey (caché de imagen intacta por tile). */
function groundDetail(base: string, biome: string, seedKey: string): string {
  const rng = seededRng(`${seedKey}:ground`);
  const light = lighten(base, 0.09);
  const dark = darken(base, 0.13);
  const out: string[] = [];
  // Manchas grandes de variación (elipses solapadas, 2 tonos, sutiles).
  for (let i = 0; i < 10; i++) {
    const cx = uniform(rng, 6, TILE_CELLS - 6);
    const cy = uniform(rng, 6, TILE_CELLS - 6);
    const rx = uniform(rng, 8, 14);
    const ry = rx * uniform(rng, 0.55, 0.8);
    const tone = i % 2 === 0 ? light : dark;
    const op = uniform(rng, 0.28, 0.48);
    out.push(ellipse(cx, cy, rx, ry, tone, `opacity="${op.toFixed(2)}"`));
  }
  // Piedritas (elipses pequeñas en gris piedra).
  for (let i = 0; i < 6; i++) {
    const cx = uniform(rng, 3, TILE_CELLS - 3);
    const cy = uniform(rng, 3, TILE_CELLS - 3);
    const r = uniform(rng, 0.7, 1.3);
    out.push(ellipse(cx, cy, r, r * 0.7, i % 2 === 0 ? "#8f887a" : "#7d7869", 'opacity="0.75"'));
  }
  // Flores/motas de color del bioma.
  const flowers = BIOME_FLOWERS[biome] ?? [];
  if (flowers.length > 0) {
    for (let i = 0; i < 16; i++) {
      const cx = uniform(rng, 2, TILE_CELLS - 2);
      const cy = uniform(rng, 2, TILE_CELLS - 2);
      out.push(circle(cx, cy, 0.45, flowers[i % flowers.length], 'opacity="0.85"'));
    }
  }
  return out.join("");
}

function groundLayer(plan: BlueprintPlan, proj: Projection, seedKey: string): string {
  const parts: string[] = [];
  const biome = plan.biome ?? "grass";
  const base = BIOME_COLORS[biome] ?? BIOME_COLORS.grass;
  parts.push(`<rect x="0" y="0" width="${TILE_CELLS}" height="${TILE_CELLS}" fill="${base}"/>`);
  parts.push(groundDetail(base, biome, seedKey));
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

/** Compone el blueprint del tile en la proyección oblicua. `seedKey`
 *  (tileKey) siembra el detalle procedural — estable por tile entre
 *  sesiones. */
export function composeBlueprint(plan: BlueprintPlan, seedKey: string): ComposedBlueprint {
  const proj = PROJECTION;
  const vb = proj.viewBox;
  const out: string[] = [];
  out.push(groundLayer(plan, proj, seedKey));

  // Orden del pintor: profundidad del punto de contacto más profundo.
  // Ajustes que evitan los fallos clásicos del criterio "max corner":
  //  - Edificios cutaway en cuatro pasadas: suelo (sin occluder), cada muro
  //    trasero por separado (huella fina — juntos, su AABB en L cubría el
  //    interior y tapaba al personaje) y muros frontales bajos al borde sur.
  //  - Muros largos troceados en segmentos (~14 celdas) que se ordenan
  //    localmente — si no, una muralla que cruza el tile tendría la
  //    profundidad de su extremo y taparía torres y edificios enteros.
  //  - Torres y puertas con un sesgo de profundidad: se asientan SOBRE su
  //    muro anfitrión y deben pintarse después que sus segmentos.
  interface Entry {
    render: Volume;
    vid: string;
    seed: string;
    phase: "floor" | "back_n" | "back_w" | "base" | "front" | "trunk" | "canopy";
    depth: number;
    /** Punto de mundo (u,v) del contacto más profundo del tramo — baseline. */
    depthPt: [number, number];
    /** Huella del TRAMO en celdas [minU, minV, maxU, maxV] — comparador del
     *  depth-sort del cliente. Árboles: SOLO el tronco (la copa no ordena). */
    footprint: [number, number, number, number];
    /** false = el tramo no se recorta como occluder aunque el volumen sea
     *  tall (el suelo del cutaway pintado encima taparía sus muebles). */
    occludes?: boolean;
    /** true = tramo aéreo (copa): occluder que se pinta sobre las entidades. */
    overhead?: boolean;
  }
  const entries: Entry[] = [];
  for (const v of plan.volumes) {
    const fp = volumeFootprint(v);
    if (v.type === "building" && v.cutaway) {
      const [u0, v0, w, d] = v.rect;
      const t = 1.2; // grosor de los muros traseros (renderBuilding)
      entries.push({ render: v, vid: v.id, seed: `${v.id}:floor`, phase: "floor", depth: proj.depth(fp.cells[2], fp.cells[1]) - 0.01, depthPt: [fp.cells[2], fp.cells[1]], footprint: fp.cells, occludes: false });
      entries.push({ render: v, vid: v.id, seed: `${v.id}:back_n`, phase: "back_n", depth: proj.depth(fp.cells[2], fp.cells[1]), depthPt: [fp.cells[2], fp.cells[1]], footprint: [u0, v0, u0 + w, v0 + t] });
      entries.push({ render: v, vid: v.id, seed: `${v.id}:back_w`, phase: "back_w", depth: proj.depth(fp.cells[2], fp.cells[1]) + 0.01, depthPt: [fp.cells[2], fp.cells[1]], footprint: [u0, v0, u0 + t, v0 + d] });
      // frontal: franjas sur + este bajas (huella = la unión de ambas menos
      // el interior — como AABB, la franja sur domina el criterio)
      entries.push({ render: v, vid: v.id, seed: `${v.id}:front`, phase: "front", depth: proj.depth(fp.depthPoint[0], fp.depthPoint[1]), depthPt: fp.depthPoint, footprint: [u0, v0 + d - t, u0 + w, v0 + d] });
      continue;
    }
    if (v.type === "wall") {
      const half = (v.width ?? 3) / 2;
      const chunks = chunkPolyline(v.points as [number, number][], 14);
      chunks.forEach((points, i) => {
        const sub: Volume = { ...v, points };
        const sfp = volumeFootprint(sub);
        const minU = Math.min(points[0][0], points[1][0]) - half;
        const maxU = Math.max(points[0][0], points[1][0]) + half;
        const minV = Math.min(points[0][1], points[1][1]) - half;
        const maxV = Math.max(points[0][1], points[1][1]) + half;
        entries.push({ render: sub, vid: v.id, seed: `${v.id}:${i}`, phase: "base", depth: proj.depth(sfp.depthPoint[0], sfp.depthPoint[1]), depthPt: sfp.depthPoint, footprint: [minU, minV, maxU, maxV] });
      });
      continue;
    }
    if (v.type === "tree") {
      // Árbol en dos tramos: tronco (occluder normal, huella fina) y copa —
      // tramo AÉREO que el cliente pinta encima de las entidades siempre
      // (está a 4-12 m; quien pasa por debajo queda cubierto).
      const s = v.s ?? 1;
      const trunkFp: [number, number, number, number] = [v.at[0] - 0.9 * s, v.at[1] - 0.9 * s, v.at[0] + 0.9 * s, v.at[1] + 0.9 * s];
      const d = proj.depth(fp.depthPoint[0], fp.depthPoint[1]);
      entries.push({ render: v, vid: v.id, seed: `${v.id}:trunk`, phase: "trunk", depth: d, depthPt: fp.depthPoint, footprint: trunkFp });
      entries.push({ render: v, vid: v.id, seed: `${v.id}:canopy`, phase: "canopy", depth: d + 0.01, depthPt: fp.depthPoint, footprint: trunkFp, overhead: true });
      continue;
    }
    const bias = v.type === "tower" || v.type === "gate" ? 4 : 0;
    entries.push({ render: v, vid: v.id, seed: v.id, phase: "base", depth: proj.depth(fp.depthPoint[0], fp.depthPoint[1]) + bias, depthPt: fp.depthPoint, footprint: fp.cells });
  }
  entries.sort((a, b) => a.depth - b.depth || a.vid.localeCompare(b.vid) || a.seed.localeCompare(b.seed));

  const bboxByVid = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  const labelByVid = new Map(plan.volumes.map((v) => [v.id, v.label]));
  const tallByVid = new Map(plan.volumes.map((v) => [v.id, classify(v).tall]));
  const occluders: ComposedOccluder[] = [];
  out.push('<g id="volumes">');
  for (const { render, vid, seed, depthPt, phase, occludes, footprint, overhead } of entries) {
    // bbox FRESCO por entry: el occluder del tramo necesita el suyo; el del
    // elemento (visión) se acumula uniendo los tramos.
    const ctx: RenderCtx = { proj, rng: seededRng(`${seedKey}:${seed}`), out: [], bbox: null };
    renderVolume(ctx, render, phase);
    if (ctx.out.length === 0) continue;
    // Marca del tramo para el cliente: "canopy" (traslúcida) y "tall" (tramos
    // con occluder) se excluyen de la capa base — los pinta solo su cutout en
    // el depth-sort, y así pueden fundirse por proximidad revelando el suelo.
    const isTall = tallByVid.get(vid) === true && occludes !== false;
    const partAttrs =
      phase === "canopy"
        ? ` data-part="canopy" opacity="${CANOPY_OPACITY}"`
        : isTall
          ? ` data-part="tall"`
          : "";
    const markup = `<g data-vid="${vid}"${partAttrs} data-label="${escapeAttr(labelByVid.get(vid) ?? vid)}">${ctx.out.join("")}</g>`;
    out.push(markup);
    if (ctx.bbox) {
      const acc = bboxByVid.get(vid);
      bboxByVid.set(
        vid,
        acc
          ? {
              minX: Math.min(acc.minX, ctx.bbox.minX),
              minY: Math.min(acc.minY, ctx.bbox.minY),
              maxX: Math.max(acc.maxX, ctx.bbox.maxX),
              maxY: Math.max(acc.maxY, ctx.bbox.maxY),
            }
          : { ...ctx.bbox },
      );
      if (tallByVid.get(vid) && occludes !== false) {
        // Margen de 1 unidad: strokes/antialias no se cortan en el borde.
        const p = 1;
        const bx = ctx.bbox.minX - p;
        const by = ctx.bbox.minY - p;
        const bw = ctx.bbox.maxX - ctx.bbox.minX + 2 * p;
        const bh = ctx.bbox.maxY - ctx.bbox.minY + 2 * p;
        occluders.push({
          id: seed,
          vid,
          label: labelByVid.get(vid) ?? vid,
          svg: `<svg viewBox="${fmt(bx)} ${fmt(by)} ${fmt(bw)} ${fmt(bh)}" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
          bbox: [round2(bx), round2(by), round2(bw), round2(bh)],
          baseline_y: round2(proj.pt(depthPt[0], depthPt[1])[1]),
          footprint_cells: [round2(footprint[0]), round2(footprint[1]), round2(footprint[2]), round2(footprint[3])],
          ...(overhead ? { overhead: true } : {}),
        });
      }
    }
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
  return { svg, viewBox: vb, elements, occluders, composer_version: COMPOSER_VERSION };
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
