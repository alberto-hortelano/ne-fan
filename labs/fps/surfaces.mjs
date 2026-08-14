// surfaces.mjs — núcleo PURO del bench FPS (sin three.js, corre en node y en
// el navegador). Convierte la lista de GreyboxPrimitive de una escena en:
//   1) celdas de atlas (una por clase de material, más celdas "hero" únicas)
//   2) la asignación prim→celda por grupo de caras (side/top/caps…)
//   3) el layout en píxeles del atlas (shelf packing con gutter)
// gen.py lee el layout para pintar la base y recortar; el viewer lo lee para
// aplicar texturas con las UVs correctas. Una sola fuente de verdad.

/** Metros de mundo por repetición de una textura tileable. */
export const DENSITY_M = 2.5;

/** Grupos de caras por shape → índice(s) de material de three.js.
 *  box: [+x,-x,+y,-y,+z,-z]; extrude (gable/polygon): [caps, laterales];
 *  cylinder: [lateral, tapa, base]. */
export const SHAPE_GROUPS = {
  box: { side: [0, 1, 4, 5], top: [2], bottom: [3] },
  gable: { caps: [0], side: [1] },
  cylinder: { side: [0], top: [1], bottom: [2] },
  cone: { side: [0] },
  sphere: { side: [0] },
  polygon: { caps: [0], side: [1] },
};

/** Catálogo de clases de material: descripción para el prompt (en inglés, el
 *  modelo de imagen trabaja mejor así) + si la textura debe tilear. La
 *  etiqueta es de PROMPT — jamás se dibuja dentro del atlas. */
// Lección del run 001: describir la SUPERFICIE como muestra de material
// ("swatch"), nunca el lugar ("ceiling boards between beams" hizo que el
// modelo pintara la HABITACIÓN entera con fuga dentro de la celda).
export const MAT_INFO = {
  // Sin grietas: cualquier grieta única se repite cada DENSITY_M y canta.
  wall_plaster: { tile: true, en: "aged lime plaster surface, plain off-white with subtle uneven staining and fine texture, no cracks, no marks" },
  wall_timber: { tile: true, en: "half-timbered wall surface: dark oak beam grid over plaster infill panels" },
  wall_stone: { tile: true, en: "rough fieldstone masonry, irregular stones with thick mortar joints" },
  stone_wall: { tile: true, en: "large squared stone blocks in courses, weathered fortress masonry" },
  roof_tile: { tile: true, en: "curved terracotta roof tiles in straight horizontal rows, seen flat from directly above the roof plane, uniform tile size across the whole cell" },
  wood_planks: { tile: true, en: "vertical rough-sawn wood planks, warm medium brown, subtle weathering" },
  wood_floor: { tile: true, en: "parallel worn wood floorboards, straight grain, narrow gaps" },
  ceiling_planks: { tile: true, en: "parallel dark wood boards, tight seams, aged oak" },
  wood_beam: { tile: true, en: "dark oak wood grain surface, straight horizontal grain, rough hewn" },
  door_wood: { tile: false, en: "one single medieval plank door filling its rectangle completely edge to edge — the door IS the whole cell, with iron hinges and studs, no wall or background around it" },
  stone_floor: { tile: true, en: "worn stone flagstones, large irregular slabs, tight joints" },
  ground_dirt: { tile: true, en: "packed dirt with embedded small stones and sparse dry grass tufts, seen flat from directly above, uniform scale across the whole cell, no depth" },
  ground_grass: { tile: true, en: "short grass meadow with small earth patches, seen flat from directly above, uniform scale, no depth" },
  path_cobble: { tile: true, en: "rounded cobblestones set in packed earth" },
  bark: { tile: true, en: "tree bark with deep vertical furrows" },
  foliage: { tile: true, en: "dense leafy canopy foliage filling the whole cell edge to edge, no sky, no gaps, no branches structure visible" },
  water: { tile: true, en: "still dark water with subtle ripples" },
  barrel_wood: { tile: false, en: "flat pattern of vertical wooden barrel staves crossed by two horizontal dark iron bands spanning the full width of the rectangle" },
  thatch: { tile: true, en: "thick layered straw thatch bundles" },
};

const TIMBER_COLORS = new Set(["#6b543a", "#5c4832", "#765633"]);
const PLASTER_COLORS = new Set(["#c9b89a", "#cfc0a2"]);

/** Clase de material de un grupo de caras de una primitiva. `null` = se queda
 *  en clay (detalle de suelo, decoración menor). Las escenas pueden fijarla
 *  por prim con `mat` (string o {side,top,caps,bottom}) y marcar `hero`. */
export function classify(prim, group) {
  if (prim.mat != null) {
    if (typeof prim.mat === "string") return group === "bottom" ? null : prim.mat;
    // Objeto por grupo: clave ausente → reglas por defecto; `false` → clay.
    if (group in prim.mat) return prim.mat[group] || null;
  }
  const { shape, cat, color, size } = prim;
  if (group === "bottom") return null;
  if (cat === "water") return "water";
  if (cat === "tree") return shape === "cylinder" ? "bark" : "foliage";
  if (cat === "wall") return color === "#6b4a2c" ? "wood_beam" : "stone_wall";
  if (cat === "building") {
    // Faldones del gable = teja; los hastiales (caps) son MURO.
    if (shape === "gable") return group === "caps" ? "wall_plaster" : "roof_tile";
    if (size[1] <= 0.2) return "wood_floor"; // losa de suelo de un cutaway
    if (color === "#2a2018") return "door_wood"; // puerta pintada en fachada
    if (group === "top") return "roof_tile"; // azotea de shed/flat
    if (TIMBER_COLORS.has(color)) return "wall_timber";
    if (PLASTER_COLORS.has(color)) return "wall_plaster";
    return "wall_stone";
  }
  if (cat === "prop") {
    if (shape === "cylinder") return group === "side" ? "barrel_wood" : "wood_planks";
    return "wood_planks";
  }
  if (cat === "terrain") {
    // Solo el suelo base grande se texturiza; el detalle sembrado queda clay.
    if (shape === "box" && size[0] >= 60) return "ground_dirt";
    return null;
  }
  return null;
}

/** Enumera celdas y asignaciones. `variant`: "A" ignora heroes (todo por
 *  material), "C" respeta `hero` (celda única por prim+grupo). Devuelve
 *  { cells: [...], assign: [{primIndex, groups: {side: key|null, ...}}] }. */
export function surfaceCells(prims, { variant = "C" } = {}) {
  const cells = new Map();
  const assign = [];
  prims.forEach((prim, primIndex) => {
    const groups = SHAPE_GROUPS[prim.shape];
    if (!groups) throw new Error(`shape desconocida: ${prim.shape}`);
    const entry = { primIndex, groups: {} };
    for (const group of Object.keys(groups)) {
      const mat = classify(prim, group);
      if (!mat) {
        entry.groups[group] = null;
        continue;
      }
      if (!MAT_INFO[mat]) throw new Error(`clase de material sin catálogo: ${mat}`);
      // Hero solo en las caras laterales (lo que el jugador mira de frente);
      // la tapa de una barra o un sarcófago se queda en su clase genérica.
      const isHero = variant !== "A" && prim.hero && (group === "side" || group === "caps");
      const key = isHero ? `hero_${prim.volId ?? primIndex}_${group}` : mat;
      if (!cells.has(key)) {
        cells.set(key, {
          key,
          mat,
          kind: isHero ? "unique" : MAT_INFO[mat].tile ? "tile" : "unique",
          baseColor: prim.color,
          en: (isHero && prim.desc) || MAT_INFO[mat].en,
          // Sub-rects [x0,y0,x1,y1,color] en coords 0..1 de la celda: anclan
          // la estructura interna (arco de chimenea, baldas…) para que el
          // modelo no fragmente celdas anchas ni pinte en el gutter.
          hints: isHero ? prim.hints : undefined,
          heroOf: isHero ? (prim.volId ?? String(primIndex)) : undefined,
          // Tamaño de mundo representativo (para aspecto de celdas únicas).
          worldW: worldFaceSize(prim, group)[0],
          worldH: worldFaceSize(prim, group)[1],
          count: 0,
        });
      }
      cells.get(key).count += 1;
      entry.groups[group] = key;
    }
    assign.push(entry);
  });
  return { cells: [...cells.values()], assign };
}

/** [ancho, alto] en metros de la cara representativa de un grupo. */
export function worldFaceSize(prim, group) {
  const s = prim.size;
  switch (prim.shape) {
    case "box":
      if (group === "top" || group === "bottom") return [s[0], s[2]];
      return [Math.max(s[0], s[2]), s[1]];
    case "gable":
      if (group === "caps") return [s[0], s[1]];
      return [s[2], Math.hypot(s[0] / 2, s[1])];
    case "cylinder":
      if (group === "side") return [2 * Math.PI * s[0], s[1]];
      return [s[0] * 2, s[0] * 2];
    case "cone":
      return [2 * Math.PI * s[0], Math.hypot(s[0], s[1])];
    case "sphere":
      return [2 * Math.PI * s[0], Math.PI * s[0]];
    case "polygon": {
      const pts = prim.points ?? [];
      const xs = pts.map((p) => p[0]);
      const zs = pts.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs) || 1;
      const h = Math.max(...zs) - Math.min(...zs) || 1;
      return group === "caps" ? [w, h] : [Math.max(w, h), prim.size[0] ?? 0.1];
    }
    default:
      return [1, 1];
  }
}

/** Shelf packing: celdas tile = cuadradas; únicas = aspecto de mundo
 *  cuantizado a {0.5, 1, 1.5, 2}. Devuelve páginas de `pagePx` con rects
 *  [x, y, w, h] y el `inset` que gen.py debe descartar al recortar. */
export function layoutAtlas(cellList, { pagePx = 1024, gutterPx = 24, inset = 6, maxCellsPerPage = 12 } = {}) {
  const quant = (a) => (a <= 0.68 ? 0.5 : a <= 1.2 ? 1 : a <= 1.7 ? 1.5 : 2);
  // Tiles primero (cuadradas), heroes al final: con varias páginas los heroes
  // caen juntos en la última y la página 1 les sirve de ancla de estilo.
  const sorted = [...cellList].sort((a, b) =>
    a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === "tile" ? -1 : 1,
  );
  const N_ROWS = 3;
  const rowH = Math.floor((pagePx - gutterPx * (N_ROWS + 1)) / N_ROWS);
  const pages = [];
  let page = null;
  const newPage = () => {
    page = { cells: [], x: gutterPx, y: gutterPx };
    pages.push(page);
  };
  newPage();
  for (const cell of sorted) {
    const aspect = cell.kind === "tile" ? 1 : quant(cell.worldW / cell.worldH);
    const w = Math.min(Math.round(rowH * aspect), pagePx - 2 * gutterPx);
    if (page.x + w + gutterPx > pagePx) {
      page.x = gutterPx;
      page.y += rowH + gutterPx;
    }
    if (page.y + rowH + gutterPx > pagePx || page.cells.length >= maxCellsPerPage) newPage();
    cell.rect = [page.x, page.y, w, rowH];
    cell.page = pages.length - 1;
    page.cells.push(cell);
    page.x += w + gutterPx;
  }
  return {
    page_px: pagePx,
    gutter_px: gutterPx,
    inset_px: inset,
    density_m: DENSITY_M,
    pages: pages.map((p) => ({
      cells: p.cells.map(({ key, mat, kind, baseColor, en, heroOf, worldW, worldH, count, rect, hints }) => ({
        key, mat, kind, baseColor, en, heroOf, worldW, worldH, count, rect, hints,
      })),
    })),
  };
}

/** Layout completo de una escena: celdas + asignación + layout. */
export function buildLayout(prims, opts = {}) {
  const { cells, assign } = surfaceCells(prims, opts);
  const atlas = layoutAtlas(cells, opts);
  return { ...atlas, assign };
}
