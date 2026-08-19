/** Superficies del modo FPS — lógica PURA compartida con el pintor de atlas
 *  del ai_server (surface_atlas_generator.py, port 1:1 del packer).
 *
 *  Convierte la lista de GreyboxPrimitive de un tile (en METROS — ver
 *  buildFpsTileSpec) en celdas de atlas: una por CLASE de material tileable
 *  más celdas "hero" únicas (prims marcadas `hero`, p. ej. por el
 *  `surface_desc` de su volumen). Cada celda es un asset de primera clase en
 *  la librería (kind "surface"): su identidad es la DESCRIPCIÓN + estilo, no
 *  la escena, así se reutiliza entre escenas y el resume es gratis.
 *
 *  Origen: bench labs/fps (veredicto 2026-08-14) — los hallazgos de prompt
 *  y layout de su README están candados aquí y en los tests. */

import type { GreyboxPrimitive } from "./common.js";

/** Versión del pipeline de superficies: viaja dentro del layout canónico —
 *  bump ⇒ invalidación de todas las cachés de atlas (cliente y servidor).
 *  v2: celdas hero por CARA/rol (`heroCells` + `SurfaceAssign.faces`). */
export const SURFACE_LAYOUT_VERSION = 2;

/** Metros de mundo por repetición de una textura tileable. */
export const DENSITY_M = 2.5;

/** Cara con celda hero propia: los grupos clásicos (side/caps/top cubren el
 *  grupo entero) más las 4 caras laterales individuales de un box (frame
 *  LOCAL pre-rotY; +z = sur ⇒ s). */
export type HeroFace = "side" | "caps" | "top" | "n" | "s" | "e" | "w";

/** Prim con los campos opcionales del bench FPS: material fijado a mano,
 *  celda hero única y descripción/hints para el pintor. */
export interface SurfacePrim extends GreyboxPrimitive {
  /** Clase de material u objeto por grupo de caras; `false` fuerza clay
   *  (a nivel de prim o por grupo). */
  mat?: string | false | Record<string, string | false>;
  /** Celda de atlas única para las caras laterales de esta prim. */
  hero?: boolean;
  /** Descripción para el prompt de la celda hero (inglés recomendado). */
  desc?: string;
  /** Celdas hero por cara/rol con clave y descripción PROPIAS (imágenes
   *  distintas por cara — el hash del asset es la descripción). Tiene
   *  prioridad sobre `hero`/`desc` (la vía legacy de una celda por grupo). */
  heroCells?: Partial<Record<HeroFace, { key: string; desc: string; ref?: string }>>;
  /** Sub-rects [x0,y0,x1,y1,"#hex"] en coords 0..1 de la celda: anclan la
   *  estructura interna (arco de chimenea, baldas…) y evitan que el modelo
   *  fragmente celdas anchas. */
  hints?: [number, number, number, number, string][];
  /** Rejilla de relieve (metros) — SOLO el suelo del tile fps la lleva: el
   *  renderer desplaza su tapa y ancla cámara/billboards/decor con ella. */
  relief?: import("../blueprint/fps-relief.js").ReliefGrid;
  /** El renderer fps ancla esta prim al relieve por su centro. Lo marca
   *  fps-spec en las prims de volúmenes que NO aplanan el relieve
   *  (tree/bush/rock — viven sobre la ladera, no la allanan). */
  anchor?: boolean;
}

export type SurfaceGroup = "side" | "top" | "bottom" | "caps";

/** Slot de material de BoxGeometry por cara de mundo (orden three:
 *  [+x,-x,+y,-y,+z,-z]; +x = este, +z = sur — contrato de common.ts). */
export const BOX_FACE_SLOT: Record<"e" | "w" | "s" | "n", number> = { e: 0, w: 1, s: 4, n: 5 };

/** Grupos de caras por shape → índices de material de three.js.
 *  box: [+x,-x,+y,-y,+z,-z]; extrude (gable/polygon): [caps, laterales];
 *  cylinder: [lateral, tapa, base]. */
export const SHAPE_GROUPS: Record<string, Partial<Record<SurfaceGroup, number[]>>> = {
  box: { side: [0, 1, 4, 5], top: [2], bottom: [3] },
  gable: { caps: [0], side: [1] },
  cylinder: { side: [0], top: [1], bottom: [2] },
  cone: { side: [0] },
  sphere: { side: [0] },
  polygon: { caps: [0], side: [1] },
};

export interface MatInfo {
  tile: boolean;
  en: string;
}

/** Catálogo de clases de material: descripción para el prompt (en inglés) +
 *  si la textura debe tilear. Lecciones del bench candadas en las
 *  descripciones: describir la SUPERFICIE como muestra ("swatch"), nunca el
 *  lugar; sin motivos únicos en tileables (se repiten cada DENSITY_M);
 *  suelos/tejados "seen flat from directly above". La etiqueta es de PROMPT —
 *  jamás se dibuja dentro del atlas. */
export const MAT_INFO: Record<string, MatInfo> = {
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
  rock_stone: { tile: true, en: "weathered grey boulder rock surface, rough natural stone with fine cracks and sparse lichen spots, no marks" },
  window_glass: { tile: false, en: "one single medieval window filling its rectangle completely edge to edge: small diamond leaded glass panes in a dark wooden frame, faint warm interior glow, no wall around it" },
};

const TIMBER_COLORS = new Set(["#6b543a", "#5c4832", "#765633"]);
const PLASTER_COLORS = new Set(["#c9b89a", "#cfc0a2"]);

/** Rasgos del `ground` (caminos/plazas) → clase de material, mapeados por su
 *  color de GROUND_MATERIAL_COLORS (ground-prims.ts) + los dos contrastados
 *  de groundColorFor (greybox/common.ts). Sin esto los caminos quedaban en
 *  clay gris plano sobre el suelo texturizado (hallazgo de la prueba real
 *  con motor 2026-08-14). */
const GROUND_COLOR_TO_MAT: Record<string, string> = {
  "#a29b8b": "path_cobble", // cobble
  "#a4937c": "path_cobble", // stone/empedrado contrastado (groundColorFor)
  "#8b8678": "stone_floor", // stone
  "#8f7757": "ground_dirt", // dirt
  "#8d6f4e": "ground_dirt", // dirt contrastado (groundColorFor)
  "#c2b184": "ground_dirt", // sand (sin celda propia: arena ≈ tierra clara)
  "#9a917f": "path_cobble", // gravel
  "#547233": "ground_grass", // grass (PALETTE.grassBase)
};

/** Clase de material de un grupo de caras de una primitiva. `null` = se queda
 *  en clay (detalle de suelo, decoración menor). Con `mat` objeto, una clave
 *  ausente cae a las reglas por defecto y `false` fuerza clay. */
export function classify(prim: SurfacePrim, group: SurfaceGroup): string | null {
  if (prim.mat === false) return null;
  if (prim.mat != null) {
    if (typeof prim.mat === "string") return group === "bottom" ? null : prim.mat;
    if (typeof prim.mat === "object" && group in prim.mat) return prim.mat[group] || null;
  }
  const { shape, cat, color, size } = prim;
  if (group === "bottom") return null;
  if (cat === "water") return "water";
  if (cat === "tree") return shape === "cylinder" ? "bark" : "foliage";
  if (cat === "wall") return color === "#6b4a2c" ? "wood_beam" : "stone_wall";
  if (cat === "building") {
    // Faldones del gable = teja; los hastiales (caps) son MURO (bench).
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
    if (shape === "box" && size[0] >= 60) return "ground_dirt";
    // Caminos/plazas del `ground` (polígonos con color de material conocido)
    // se texturizan; el detalle procedural sembrado (elipses/piedritas de
    // colores derivados del bioma) queda clay y se oculta al texturizar.
    if (group === "caps" || group === "top") {
      const mat = GROUND_COLOR_TO_MAT[color];
      if (mat) return mat;
    }
    return null;
  }
  return null;
}

export interface SurfaceCell {
  key: string;
  mat: string;
  kind: "tile" | "unique";
  baseColor: string;
  en: string;
  /** Ref temática fps/ del pack elegida por el motor para esta celda hero
   *  (surface_ref). OMITIDA cuando ausente — así el JSON canónico (y los
   *  layoutKeys) del contenido sin refs queda byte-idéntico al histórico. */
  ref?: string;
  heroOf?: string;
  hints?: [number, number, number, number, string][];
  worldW: number;
  worldH: number;
  count: number;
  rect?: [number, number, number, number];
  page?: number;
}

export interface SurfaceAssign {
  primIndex: number;
  groups: Partial<Record<SurfaceGroup, string | null>>;
  /** Overrides por SLOT de material de la geometría (clave = índice como
   *  string, valor = celda): las caras n/s/e/w de un box con celda hero
   *  propia. Los slots ausentes siguen el grupo. */
  faces?: Record<string, string>;
}

/** [ancho, alto] en metros de UNA cara concreta de un box. */
export function worldBoxFaceSize(prim: SurfacePrim, face: "n" | "s" | "e" | "w" | "top"): [number, number] {
  const s = prim.size;
  if (face === "top") return [s[0], s[2]];
  return face === "n" || face === "s" ? [s[0], s[1]] : [s[2], s[1]];
}

/** [ancho, alto] en metros de la cara representativa de un grupo. */
export function worldFaceSize(prim: SurfacePrim, group: SurfaceGroup): [number, number] {
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
      const w = xs.length ? Math.max(...xs) - Math.min(...xs) || 1 : 1;
      const h = zs.length ? Math.max(...zs) - Math.min(...zs) || 1 : 1;
      return group === "caps" ? [w, h] : [Math.max(w, h), s[0] ?? 0.1];
    }
    default:
      return [1, 1];
  }
}

export interface SurfaceCellsResult {
  cells: SurfaceCell[];
  assign: SurfaceAssign[];
}

/** Enumera celdas y asignaciones prim→celda por grupo de caras (y por CARA
 *  individual con `heroCells` n/s/e/w). `variant`: "A" ignora heroes (todo por
 *  clase de material), "C" (default) los respeta. Vías hero:
 *  - `heroCells` (fps-spec): celda propia por rol/cara, clave y desc dadas.
 *  - `hero`+`desc` legacy (escenas autoradas del bench): una celda por
 *    prim+grupo lateral, clave `hero_<volId>_<grupo>`. */
export function surfaceCells(
  prims: SurfacePrim[],
  { variant = "C" }: { variant?: "A" | "C" } = {},
): SurfaceCellsResult {
  const cells = new Map<string, SurfaceCell>();
  const assign: SurfaceAssign[] = [];
  prims.forEach((prim, primIndex) => {
    const groups = SHAPE_GROUPS[prim.shape];
    if (!groups) throw new Error(`surfaces: shape desconocida "${prim.shape}"`);
    const entry: SurfaceAssign = { primIndex, groups: {} };
    const volKey = prim.volId ?? String(primIndex);
    const heroCells =
      variant === "A"
        ? undefined
        : prim.heroCells ??
          (prim.hero
            ? {
                side: { key: `hero_${volKey}_side`, desc: prim.desc ?? "" },
                caps: { key: `hero_${volKey}_caps`, desc: prim.desc ?? "" },
              }
            : undefined);
    const addCell = (
      key: string,
      mat: string,
      info: MatInfo,
      heroDesc: string | undefined,
      [worldW, worldH]: [number, number],
      heroRef?: string,
    ): void => {
      if (!cells.has(key)) {
        cells.set(key, {
          key,
          mat,
          kind: heroDesc !== undefined || !info.tile ? "unique" : "tile",
          baseColor: prim.color,
          en: heroDesc || info.en,
          ...(heroDesc !== undefined && heroRef ? { ref: heroRef } : {}),
          heroOf: heroDesc !== undefined ? volKey : undefined,
          hints: heroDesc !== undefined ? prim.hints : undefined,
          worldW,
          worldH,
          count: 0,
        });
      }
      const cell = cells.get(key);
      if (cell) cell.count += 1;
    };
    for (const group of Object.keys(groups) as SurfaceGroup[]) {
      const mat = classify(prim, group);
      if (!mat) {
        entry.groups[group] = null;
        continue;
      }
      const info = MAT_INFO[mat];
      if (!info) throw new Error(`surfaces: clase de material sin catálogo "${mat}"`);
      // Hero de grupo: side/caps/top con celda única (bottom nunca es hero).
      const hc = group === "bottom" ? undefined : heroCells?.[group];
      const key = hc ? hc.key : mat;
      addCell(key, mat, info, hc ? hc.desc : undefined, worldFaceSize(prim, group), hc?.ref);
      entry.groups[group] = key;
    }
    // Caras laterales individuales de un box (n/s/e/w): celda propia por cara
    // con su tamaño REAL — el resto de slots del grupo side no cambia.
    if (heroCells && prim.shape === "box") {
      const sideMat = classify(prim, "side");
      if (sideMat) {
        const info = MAT_INFO[sideMat];
        for (const face of ["n", "s", "e", "w"] as const) {
          const hc = heroCells[face];
          if (!hc) continue;
          addCell(hc.key, sideMat, info, hc.desc, worldBoxFaceSize(prim, face), hc.ref);
          (entry.faces ??= {})[String(BOX_FACE_SLOT[face])] = hc.key;
        }
      }
    }
    assign.push(entry);
  });
  return { cells: [...cells.values()], assign };
}

export interface SurfaceLayout {
  surface_layout_version: number;
  page_px: number;
  gutter_px: number;
  inset_px: number;
  density_m: number;
  pages: { cells: SurfaceCell[] }[];
  assign: SurfaceAssign[];
}

export interface LayoutOptions {
  variant?: "A" | "C";
  pagePx?: number;
  gutterPx?: number;
  inset?: number;
  maxCellsPerPage?: number;
}

/** Shelf packing determinista: celdas tile = cuadradas; únicas = aspecto de
 *  mundo cuantizado a {0.5, 1, 1.5, 2}. Tiles primero, heroes al final (con
 *  varias páginas caen juntos y la página previa les ancla la paleta).
 *  ≤12 celdas/página — hallazgo skinning V4: más celdas colapsan al modelo. */
export function layoutAtlas(
  cellList: SurfaceCell[],
  { pagePx = 1024, gutterPx = 24, inset = 6, maxCellsPerPage = 12 }: LayoutOptions = {},
): Omit<SurfaceLayout, "assign"> {
  const quant = (a: number) => (a <= 0.68 ? 0.5 : a <= 1.2 ? 1 : a <= 1.7 ? 1.5 : 2);
  const sorted = [...cellList].sort((a, b) =>
    a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === "tile" ? -1 : 1,
  );
  const N_ROWS = 3;
  const rowH = Math.floor((pagePx - gutterPx * (N_ROWS + 1)) / N_ROWS);
  const pages: { cells: SurfaceCell[]; x: number; y: number }[] = [];
  let page: { cells: SurfaceCell[]; x: number; y: number } | null = null;
  const newPage = () => {
    page = { cells: [], x: gutterPx, y: gutterPx };
    pages.push(page);
    return page;
  };
  page = newPage();
  for (const cell of sorted) {
    const aspect = cell.kind === "tile" ? 1 : quant(cell.worldW / cell.worldH);
    const w = Math.min(Math.round(rowH * aspect), pagePx - 2 * gutterPx);
    if (page.x + w + gutterPx > pagePx) {
      page.x = gutterPx;
      page.y += rowH + gutterPx;
    }
    if (page.y + rowH + gutterPx > pagePx || page.cells.length >= maxCellsPerPage) {
      page = newPage();
    }
    cell.rect = [page.x, page.y, w, rowH];
    cell.page = pages.length - 1;
    page.cells.push(cell);
    page.x += w + gutterPx;
  }
  return {
    surface_layout_version: SURFACE_LAYOUT_VERSION,
    page_px: pagePx,
    gutter_px: gutterPx,
    inset_px: inset,
    density_m: DENSITY_M,
    pages: pages.map((p) => ({ cells: p.cells })),
  };
}

/** Layout completo de una escena: celdas + asignación + layout. */
export function buildLayout(prims: SurfacePrim[], opts: LayoutOptions = {}): SurfaceLayout {
  const { cells, assign } = surfaceCells(prims, opts);
  const atlas = layoutAtlas(cells, opts);
  return { ...atlas, assign };
}

/** JSON canónico del layout (claves ordenadas, números redondeados a 1e-4):
 *  su sha256 + estilo es el `layout_key` compartido con el servidor. Misma
 *  canonicalización que canonicalGreyboxJson. */
export function canonicalSurfaceLayoutJson(layout: SurfaceLayout): string {
  const canon = (v: unknown): unknown => {
    if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const val = (v as Record<string, unknown>)[k];
        if (val !== undefined) out[k] = canon(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(canon(layout));
}
