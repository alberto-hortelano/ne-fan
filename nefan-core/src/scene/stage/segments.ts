/** Segmentación del plató PINTADO — lógica pura (sin DOM, sin red).
 *
 *  El pipeline de imagen del proscenio recorta SIEMPRE lo que el modelo de
 *  imagen PINTÓ: un modelo de visión inventaría cada elemento (declarados +
 *  extras inventados) con su caja REAL, SAM2 extrae la máscara de la imagen,
 *  y de la línea de contacto pintada salen la profundidad (z de plató), la
 *  huella de mundo y la colisión. PROHIBIDO derivar máscaras del SVG
 *  declarado del compositor (probado: el modelo recoloca/reorienta lo
 *  declarado y la silueta declarada recorta suelo con forma de objeto). Lo
 *  declarado solo viaja como PISTA: etiquetas + cajas esperadas.
 *
 *  Espacio de píxel: la imagen pintada vive ESTIRADA a un cuadrado
 *  renderSize² (espejo del prestretch del servidor); la inversa exacta es
 *  lineal contra el view_box del compositor. */

import type { ComposedStage, ComposedStageExit, StageLayer } from "./compose.js";
import { viewToStage, stageToWorld, type StageProjParams, type StageBounds } from "./projection.js";
import { paintableVolumeLayers, buildPeelPrompt } from "./peel.js";
import type { TerrainGridData } from "../terrain-collision.js";

/** Lado del cuadrado de trabajo (espejo del prestretch del ai_server). */
export const STAGE_RENDER_SIZE = 1024;

/** Radio del jugador (m) — espejo de PLAYER_RADIUS del cliente; las zonas de
 *  salida se limpian infladas por él para que siempre sean transitables. */
const PLAYER_RADIUS_M = 0.4;

/** Mínimo de puntos de contacto válidos para derivar una pose. */
const MIN_CONTACT_POINTS = 3;

/** Tolerancia (m de plató) de un punto de contacto respecto a la MEDIANA:
 *  el contorno inferior de una máscara SUBE al faldón/asiento entre las
 *  patas (mesas, taburetes) y esos puntos desproyectan varios metros más
 *  lejos — sin el filtro, la banda de colisión se hace profundísima y
 *  cierra pasillos (visto en el E2E real del salón). */
const CONTACT_Z_TOLERANCE_M = 0.75;

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Rect completo de la escena en metros de MUNDO (centrado en el origen). */
export interface WorldRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Pista declarada para la visión: qué elementos DEBERÍAN estar pintados y
 *  aproximadamente dónde (caja proyectada por el compositor, en píxeles del
 *  cuadrado de trabajo). La visión responde con las cajas REALES. */
export interface StageExpectedElement {
  /** layerId del compositor ("vol_<volId>"). */
  id: string;
  label: string;
  /** [x, y, w, h] en píxeles del cuadrado renderSize². */
  box_px: [number, number, number, number];
  tall: boolean;
  solid: boolean;
}

/** Item del inventario devuelto por /review_stage_image (wire). */
export interface StageReviewItem {
  /** layerId casado (expected) o id sintético del servidor (extra). */
  id: string;
  label: string;
  source: "expected" | "extra";
  action: "keep" | "remove";
  sprite_url?: string;
  /** Máscara L full-frame de SAM (blanco = elemento) — la del pelado. */
  mask_url?: string;
  /** [x, y, w, h] px del cuadrado de trabajo (bbox tight de la máscara). */
  image_bbox: [number, number, number, number];
  img_w: number;
  img_h: number;
  /** Línea de contacto con el suelo PINTADA: [x, y][] px (solo keep). */
  contact_px?: [number, number][];
  tall?: boolean;
  solid?: boolean;
  h?: number;
  depth_cells?: number;
}

/** Línea de suelo de la PINTURA (visión): dónde toca el suelo transitable la
 *  pared del fondo, y (opcional) dónde acaba por delante si el modelo pintó
 *  una banda no jugable al pie del cuadro. */
export interface PaintedFloor {
  /** y (px del cuadrado) donde el suelo se encuentra con el fondo. */
  wall_base_px: number;
  /** y (px) del borde delantero del suelo jugable; ausente = borde inferior. */
  front_px?: number;
}

/** Proyección CALIBRADA a la perspectiva que el modelo de imagen horneó en la
 *  pintura. El repintado nunca respeta la franja de suelo del blueprint
 *  (teleobjetivo ⇒ franja minúscula; el modelo pinta un suelo profundo a su
 *  gusto), así que en modo imagen la perspectiva pintada MANDA: mismo focal y
 *  métrica de mundo, pero ground_y/horizon_y reajustados para que z=0 caiga
 *  en el borde delantero pintado y z=depth en la base de la pared pintada.
 *  Con ella deproyectan los contactos y proyectan las entidades/warp — el
 *  jugador pisa el suelo PINTADO. */
export function calibratedProjection(
  proj: StageProjParams,
  vb: ViewBox,
  floor: PaintedFloor,
  renderSize: number = STAGE_RENDER_SIZE,
): StageProjParams {
  const frontPx = floor.front_px ?? renderSize;
  if (!(floor.wall_base_px < frontPx)) {
    throw new Error(
      `calibratedProjection: wall_base_px (${floor.wall_base_px}) debe estar por encima de front_px (${frontPx})`,
    );
  }
  const vyWall = vb.minY + (floor.wall_base_px / renderSize) * vb.height;
  const vyFront = vb.minY + (frontPx / renderSize) * vb.height;
  const sD = proj.focal_m / (proj.focal_m + proj.depth_m);
  const groundY = vyFront;
  const horizonY = (vyWall - groundY * sD) / (1 - sD);
  return { ...proj, ground_y: groundY, horizon_y: horizonY };
}

/** Pose de un elemento derivada de su línea de contacto pintada. */
export interface CutoutPose {
  /** zStage (m desde la embocadura) — mediana del contacto. */
  z: number;
  /** Contactos desproyectados a metros de MUNDO. */
  contactWorld: [number, number][];
}

/** Elementos esperados para la visión: los volúmenes pintables del compositor
 *  con su caja proyectada al cuadrado de trabajo. */
export function expectedElementsFor(
  stage: ComposedStage,
  renderSize: number = STAGE_RENDER_SIZE,
): StageExpectedElement[] {
  const vb = stage.view_box;
  return paintableVolumeLayers(stage).map((layer: StageLayer) => {
    const [minX, minY, maxX, maxY] = layer.bbox;
    const x = ((minX - vb.minX) / vb.width) * renderSize;
    const y = ((minY - vb.minY) / vb.height) * renderSize;
    return {
      id: layer.id,
      label: layer.label ?? layer.id,
      box_px: [
        Math.round(x),
        Math.round(y),
        Math.round(((maxX - minX) / vb.width) * renderSize),
        Math.round(((maxY - minY) / vb.height) * renderSize),
      ],
      tall: true,
      solid: layer.footprint !== undefined,
    };
  });
}

/** Píxel del cuadrado de trabajo → unidades de vista (inversa exacta del
 *  estirado de rasterizeSvgSquare / prestretch). */
export function pxToView(
  vb: ViewBox,
  px: number,
  py: number,
  renderSize: number = STAGE_RENDER_SIZE,
): [number, number] {
  return [vb.minX + (px / renderSize) * vb.width, vb.minY + (py / renderSize) * vb.height];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pose desde la línea de contacto pintada: cada punto px → vista →
 *  viewToStage (los que caen en o sobre el horizonte se descartan) → clamp a
 *  [0, depth]. z = MEDIANA (robusta ante puntos de la máscara que muerden un
 *  vecino). null si quedan menos de MIN_CONTACT_POINTS válidos — el caller
 *  degrada el item a solo-inpaint. */
export function contactToPose(
  proj: StageProjParams,
  vb: ViewBox,
  rect: WorldRect,
  contactPx: [number, number][],
  renderSize: number = STAGE_RENDER_SIZE,
): CutoutPose | null {
  const bounds: StageBounds = rect;
  const raw: { zStage: number; xStage: number }[] = [];
  for (const [px, py] of contactPx) {
    const [vx, vy] = pxToView(vb, px, py, renderSize);
    const st = viewToStage(proj, vx, vy);
    if (!st) continue;
    raw.push({ xStage: st[0], zStage: Math.min(proj.depth_m, Math.max(0, st[1])) });
  }
  if (raw.length < MIN_CONTACT_POINTS) return null;
  const zMed = median(raw.map((p) => p.zStage));
  // Solo los puntos que de verdad tocan el suelo cerca de la línea mediana:
  // los saltos del contorno entre patas quedan fuera de la huella/colisión.
  let filtered = raw.filter((p) => Math.abs(p.zStage - zMed) <= CONTACT_Z_TOLERANCE_M);
  if (filtered.length < MIN_CONTACT_POINTS) filtered = raw;
  return {
    z: zMed,
    contactWorld: filtered.map((p) => stageToWorld(bounds, p.xStage, p.zStage)),
  };
}

/** Huella de mundo desde el contacto pintado: el contacto es el borde SUR
 *  (cara vista); la extrusión va hacia el NORTE (zMundo decreciente). */
export function footprintFromContact(
  contactWorld: [number, number][],
  depthM: number,
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const xs = contactWorld.map((c) => c[0]);
  const maxZ = median(contactWorld.map((c) => c[1]));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: maxZ - depthM,
    maxZ,
  };
}

export interface InventoryMatch {
  /** layerId → item de la visión (expected encontrados). */
  matched: Map<string, StageReviewItem>;
  extras: StageReviewItem[];
  /** layerIds declarados que el modelo NO pintó (sin recorte, sin colisión). */
  missing: string[];
}

/** Casa el inventario de la visión contra los layerIds esperados. Fail-loud
 *  ante ids duplicados o expected desconocidos (contrato roto). */
export function matchInventory(expectedIds: string[], items: StageReviewItem[]): InventoryMatch {
  const expected = new Set(expectedIds);
  const matched = new Map<string, StageReviewItem>();
  const extras: StageReviewItem[] = [];
  for (const item of items) {
    if (item.source === "expected") {
      if (!expected.has(item.id)) {
        throw new Error(`matchInventory: item expected con id desconocido "${item.id}"`);
      }
      if (matched.has(item.id)) {
        throw new Error(`matchInventory: id duplicado en el inventario "${item.id}"`);
      }
      matched.set(item.id, item);
    } else {
      extras.push(item);
    }
  }
  const missing = expectedIds.filter((id) => !matched.has(id));
  return { matched, extras, missing };
}

export interface InventoryPeelStep {
  itemId: string;
  label: string;
  action: "keep" | "remove";
  /** Lo pintado DETRÁS (z mayor), de cerca a lejos — guía del relleno. */
  behindLabels: string[];
  prompt: string;
}

/** Margen (px) del test de solape entre huecos y elementos de detrás. */
const BEHIND_OVERLAP_PAD_PX = 16;

const bboxesOverlap = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  pad = BEHIND_OVERLAP_PAD_PX,
): boolean =>
  !(a[0] + a[2] + pad < b[0] || b[0] + b[2] + pad < a[0] ||
    a[1] + a[3] + pad < b[1] || b[1] + b[3] + pad < a[1]);

/** Pasos de pelado desde el inventario PINTADO, de cerca a lejos por la z
 *  derivada del contacto (un elemento recolocado cambia de plano y el orden
 *  declarado dejaría huecos mal guiados). Los items sin pose (removes sin
 *  contacto, contactos degenerados) van al final: su recorte no se conserva y
 *  el orden solo afecta a la guía del relleno. `behindLabels` SOLO incluye lo
 *  que de verdad SOLAPA el hueco en pantalla — enumerar todo lo lejano invita
 *  al modelo de fill a pintar muebles dentro del hueco (bench 003). */
export function peelStepsFromInventory(
  items: { item: StageReviewItem; z: number | null }[],
  backdrop?: string,
): InventoryPeelStep[] {
  const withZ = items.filter((e) => e.z !== null) as { item: StageReviewItem; z: number }[];
  const withoutZ = items.filter((e) => e.z === null);
  withZ.sort((a, b) => a.z - b.z);
  const ordered = [...withZ, ...withoutZ.map((e) => ({ item: e.item, z: Infinity }))];
  return ordered.map((entry, i) => {
    const behind = ordered
      .slice(i + 1)
      .filter((e) => e.item.action === "keep" && bboxesOverlap(entry.item.image_bbox, e.item.image_bbox))
      .map((e) => e.item.label);
    return {
      itemId: entry.item.id,
      label: entry.item.label,
      action: entry.item.action,
      behindLabels: behind,
      prompt: buildPeelPrompt(behind, backdrop, entry.item.label),
    };
  });
}

export interface CollisionCutout {
  id: string;
  label: string;
  /** Contactos en metros de MUNDO (de contactToPose). */
  contactWorld: [number, number][];
  /** Profundidad de la huella (m): la declarada del layer casado, o
   *  depth_cells·mpc para extras. */
  depthM: number;
}

export interface StageCollisionResult {
  grid: TerrainGridData;
  /** Avisos (celdas limpiadas por solapar una zona de salida, etc.). */
  warnings: string[];
}

/** Grid de colisión desde los contactos PINTADOS: por cutout sólido, banda
 *  [zContacto − depth, zContacto] siguiendo la polilínea de contacto
 *  interpolada (la banda sigue la inclinación pintada y nunca se sale del
 *  elemento). Las celdas que invadan una zona de salida (inflada por el radio
 *  del jugador) se LIMPIAN — cruzar es innegociable — y se reporta. */
export function collisionGridFromCutouts(
  cutouts: CollisionCutout[],
  rect: WorldRect,
  exits: ComposedStageExit[],
  mpc = 0.5,
): StageCollisionResult {
  const cols = Math.max(1, Math.round((rect.maxX - rect.minX) / mpc));
  const rows = Math.max(1, Math.round((rect.maxZ - rect.minZ) / mpc));
  const solid = new Uint8Array(cols * rows);
  const cellOf = (x: number, z: number): [number, number] => [
    Math.floor((x - rect.minX) / mpc),
    Math.floor((z - rect.minZ) / mpc),
  ];
  const mark = (x: number, z: number): void => {
    const [c, r] = cellOf(x, z);
    if (c >= 0 && r >= 0 && c < cols && r < rows) solid[r * cols + c] = 1;
  };

  for (const cut of cutouts) {
    const pts = cut.contactWorld;
    for (let i = 0; i < pts.length; i++) {
      // Interpolar el tramo hasta el siguiente punto a pasos de media celda.
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1] ?? pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (mpc / 2)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x0 + (x1 - x0) * t;
        const zContact = z0 + (z1 - z0) * t;
        for (let z = zContact - cut.depthM; z <= zContact + 1e-9; z += mpc / 2) {
          mark(x, z);
        }
        mark(x, zContact);
      }
    }
  }

  const warnings: string[] = [];
  for (const exit of exits) {
    const ex = {
      minX: exit.rect.minX - PLAYER_RADIUS_M,
      minZ: exit.rect.minZ - PLAYER_RADIUS_M,
      maxX: exit.rect.maxX + PLAYER_RADIUS_M,
      maxZ: exit.rect.maxZ + PLAYER_RADIUS_M,
    };
    const c0 = Math.max(0, Math.floor((ex.minX - rect.minX) / mpc));
    const c1 = Math.min(cols - 1, Math.floor((ex.maxX - rect.minX) / mpc));
    const r0 = Math.max(0, Math.floor((ex.minZ - rect.minZ) / mpc));
    const r1 = Math.min(rows - 1, Math.floor((ex.maxZ - rect.minZ) / mpc));
    let cleared = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (solid[r * cols + c]) {
          solid[r * cols + c] = 0;
          cleared++;
        }
      }
    }
    if (cleared > 0) {
      warnings.push(
        `salida "${exit.id}" invadida por colisión pintada — ${cleared} celda/s limpiadas para mantenerla transitable`,
      );
    }
  }

  const grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) row += solid[r * cols + c] ? "S" : ".";
    grid.push(row);
  }
  return {
    grid: {
      grid,
      cols,
      rows,
      meters_per_cell: mpc,
      origin: [rect.minX, rect.minZ],
      solid_chars: ["S"],
    },
    warnings,
  };
}

export interface ReconstructionBlock {
  x: number;
  y: number;
  diff: number;
}

export interface ReconstructionReport {
  /** Diferencia media (0-255) fuera de la zona excluida. */
  meanDiff: number;
  /** Bloques 32×32 por encima del umbral de bloque, peor primero. */
  hotBlocks: ReconstructionBlock[];
}

export const RECONSTRUCTION_DEFAULTS = {
  /** Media global tolerable fuera de máscaras (ruido de re-encode). */
  maxMeanDiff: 3,
  /** Un bloque por encima delata desalineación o un elemento mal compuesto. */
  blockSize: 32,
  maxBlockDiff: 25,
};

/** Smoke-test de integridad del pipeline: placa + recortes compuestos deben
 *  reproducir la imagen pintada original salvo en los halos de inpaint
 *  (excludeMask). Detecta bugs de coordenadas/composición — NO detecta
 *  elementos sin identificar (siguen cocidos en la placa y el composite los
 *  reproduce igual); esa garantía es el inventario COMPLETO de la visión. */
export function reconstructionDiff(
  original: Uint8ClampedArray,
  composed: Uint8ClampedArray,
  width: number,
  height: number,
  excludeMask?: Uint8Array,
  opts: Partial<typeof RECONSTRUCTION_DEFAULTS> = {},
): ReconstructionReport {
  const o = { ...RECONSTRUCTION_DEFAULTS, ...opts };
  if (original.length !== composed.length || original.length !== width * height * 4) {
    throw new Error("reconstructionDiff: tamaños de imagen inconsistentes");
  }
  const bs = o.blockSize;
  const bCols = Math.ceil(width / bs);
  const bRows = Math.ceil(height / bs);
  const blockSum = new Float64Array(bCols * bRows);
  const blockN = new Float64Array(bCols * bRows);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (excludeMask && excludeMask[i]) continue;
      const p = i * 4;
      const d =
        (Math.abs(original[p] - composed[p]) +
          Math.abs(original[p + 1] - composed[p + 1]) +
          Math.abs(original[p + 2] - composed[p + 2])) /
        3;
      sum += d;
      n++;
      const bi = Math.floor(y / bs) * bCols + Math.floor(x / bs);
      blockSum[bi] += d;
      blockN[bi]++;
    }
  }
  const hotBlocks: ReconstructionBlock[] = [];
  for (let bi = 0; bi < blockSum.length; bi++) {
    if (blockN[bi] === 0) continue;
    const diff = blockSum[bi] / blockN[bi];
    if (diff > o.maxBlockDiff) {
      hotBlocks.push({ x: (bi % bCols) * bs, y: Math.floor(bi / bCols) * bs, diff });
    }
  }
  hotBlocks.sort((a, b) => b.diff - a.diff);
  return { meanDiff: n > 0 ? sum / n : 0, hotBlocks };
}
