/** Builder greybox 3D del TILE oblicuo — lógica PURA (sin three.js).
 *
 *  Sustituye al compositor SVG: produce un `TileGreyboxSpec` (primitivas en
 *  CELDAS, luces fijas, cámara ortográfica+cizalla) que el cliente renderiza
 *  con three.js como arte del tile (modo vector) y plano base del repintado
 *  (bench labs/render E2a: fidelidad 100/100 a coste 0). DETERMINISTA: mismo
 *  plan + seedKey ⇒ mismo spec ⇒ mismo `canonicalGreyboxJson` — ese hash es
 *  el `layout_key` de la caché del repintado (el PNG WebGL NO es
 *  byte-determinista y jamás debe serlo).
 *
 *  La proyección es la OBLICUA de siempre (blueprint/projection.ts):
 *  pt(u,v,h) = [u + h·KX, v − h·KY]. En el cliente es una cámara ortográfica
 *  CENITAL + cizalla en la matriz del grupo raíz (labs/render viewer) — la
 *  equivalencia exacta con pt() la garantizan los tests de core. Sol fijo
 *  desde el sur(-oeste): cara sur iluminada / este en sombra SIEMPRE (el
 *  prompt del repintado lo afirma sin condiciones). */

import { seededRng, uniform } from "../../rng.js";
import { TILE_CELLS } from "../tile.js";
import { BIOME_COLORS, darken, lighten } from "./palette.js";
import { PROJECTION, OBLIQUE_KX, OBLIQUE_KY } from "./projection.js";
import { volumeFootprint } from "./footprint.js";
import { ellipsePoints, groundFeaturePrims } from "./ground-prims.js";
import type { GroundFeature } from "./ground.js";
import type { GateVolume, Volume } from "./volumes.js";
import type { GreyboxLight, GreyboxPrimitive } from "../greybox/common.js";
import { classifyVolume, volumePartsForTile } from "../greybox/volume-prims.js";

/** Versión del builder: viaja dentro del spec (y por tanto dentro del hash
 *  de caché `layout_key`). Bump ⇒ regeneración de todos los tiles pintados. */
export const TILE_GREYBOX_VERSION = 1;

/** Píxeles por celda del render base (canvas 1120×1280 con el viewBox
 *  140×160). Los occluders se renderizan a la MISMA densidad. */
export const TILE_GREYBOX_PX_PER_CELL = 8;

export interface TileGreyboxPlan {
  ground?: GroundFeature[];
  volumes: Volume[];
  biome?: string;
}

/** Cámara del tile: ortográfica cenital + cizalla oblicua (el cliente monta
 *  la matriz del grupo raíz con kx/ky — espejo exacto de PROJECTION.pt). */
export interface TileGreyboxCamera {
  kind: "ortho_shear";
  view_box: { minX: number; minY: number; width: number; height: number };
  kx: number;
  ky: number;
  px_per_cell: number;
}

export interface ComposedElement {
  id: string;
  label: string;
  solid: boolean;
  tall: boolean;
  /** [x, y, w, h] en unidades del view_box (escala a px de imagen con
   *  imgW / view_box.width). */
  bbox: [number, number, number, number];
  /** Y (unidades del view_box) de la línea de contacto con el suelo del
   *  punto más profundo — baseline del depth-sort. */
  baseline_y: number;
  /** Huella en celdas de mundo [minU, minV, maxU, maxV]. */
  footprint_cells: [number, number, number, number];
}

/** Un tramo de volumen alto recortable: el cliente lo renderiza aparte (solo
 *  sus primitivas, fondo transparente) y lo usa como occluder de depth-sort. */
export interface TileOccluderSpec {
  /** Único dentro del tile (id del volumen + sufijo de tramo). */
  id: string;
  /** Volumen padre (correlaciona con `elements`). */
  vid: string;
  label: string;
  /** Índices en `primitives` de las piezas de ESTE tramo. */
  prims: number[];
  /** [x, y, w, h] proyectado, en unidades del view_box (margen 1 incluido). */
  bbox: [number, number, number, number];
  baseline_y: number;
  /** Huella del tramo en celdas de mundo [minU, minV, maxU, maxV]. */
  footprint_cells: [number, number, number, number];
  /** true = tramo aéreo (copa): se pinta encima de las entidades, con
   *  CANOPY_OPACITY. */
  overhead?: boolean;
}

export interface TileGreyboxSpec {
  tile_greybox_version: number;
  camera: TileGreyboxCamera;
  lights: GreyboxLight[];
  /** Unidades = CELDAS del tile; pos = [u, hBase, v] (y = base). Los índices
   *  de `occluders.prims` apuntan aquí — el orden es parte del contrato. */
  primitives: GreyboxPrimitive[];
  elements: ComposedElement[];
  occluders: TileOccluderSpec[];
}

/** Flores por bioma: tonos que leen como vegetación sin gritar. */
const BIOME_FLOWERS: Record<string, string[]> = {
  grass: ["#d8c458", "#c8d2df", "#c98a9a"],
  meadow: ["#d8c458", "#c8d2df", "#c98a9a", "#b48ac9"],
  forest_floor: ["#c8d2df", "#a9b86a"],
  swamp: ["#a9b86a"],
};

/** Elevaciones (celdas) de las capas planas del suelo — separadas para que el
 *  z-buffer nunca haga z-fighting y el orden visual sea el del contrato:
 *  detalle < áreas/caminos < agua < deck. */
const Y_DETAIL = 0.02;
const Y_AREA = 0.05;
const Y_PATH = 0.09;
const Y_WATER = 0.13;
const Y_DECK = 0.18;
const LAYER_T = 0.03;

/** Detalle procedural del suelo — manchas orgánicas del bioma, piedritas y
 *  flores dispersas, sembradas por tile (determinista: caché intacta). */
function groundDetailPrims(base: string, biome: string, seedKey: string): GreyboxPrimitive[] {
  const rng = seededRng(`${seedKey}:ground`);
  const light = lighten(base, 0.09);
  const dark = darken(base, 0.13);
  const out: GreyboxPrimitive[] = [];
  for (let i = 0; i < 10; i++) {
    const cx = uniform(rng, 6, TILE_CELLS - 6);
    const cy = uniform(rng, 6, TILE_CELLS - 6);
    const rx = uniform(rng, 8, 14);
    const ry = rx * uniform(rng, 0.55, 0.8);
    out.push({
      shape: "polygon",
      size: [0.01],
      pos: [0, Y_DETAIL + i * 0.002, 0],
      points: ellipsePoints(cx, cy, rx, ry),
      color: i % 2 === 0 ? light : dark,
      cat: "terrain",
      noShadow: true,
    });
  }
  for (let i = 0; i < 6; i++) {
    const cx = uniform(rng, 3, TILE_CELLS - 3);
    const cy = uniform(rng, 3, TILE_CELLS - 3);
    const r = uniform(rng, 0.7, 1.3);
    out.push({
      shape: "cylinder",
      size: [r, 0.12],
      pos: [cx, Y_DETAIL, cy],
      color: i % 2 === 0 ? "#8f887a" : "#7d7869",
      cat: "terrain",
      noShadow: true,
    });
  }
  const flowers = BIOME_FLOWERS[biome] ?? [];
  if (flowers.length > 0) {
    for (let i = 0; i < 16; i++) {
      const cx = uniform(rng, 2, TILE_CELLS - 2);
      const cy = uniform(rng, 2, TILE_CELLS - 2);
      out.push({
        shape: "cylinder",
        size: [0.45, 0.08],
        pos: [cx, Y_DETAIL + 0.03, cy],
        color: flowers[i % flowers.length],
        cat: "decor",
        noShadow: true,
      });
    }
  }
  return out;
}

/** AABB de mundo (celdas + rango de altura) de una primitiva. */
function primWorldAabb(p: GreyboxPrimitive): { minU: number; minV: number; maxU: number; maxV: number; h0: number; h1: number } {
  let eu: number;
  let ev: number;
  switch (p.shape) {
    case "box":
    case "gable": {
      const [w, , d] = p.size;
      const c = Math.abs(Math.cos(p.rotY ?? 0));
      const s = Math.abs(Math.sin(p.rotY ?? 0));
      eu = (c * w + s * d) / 2;
      ev = (s * w + c * d) / 2;
      break;
    }
    case "cylinder": {
      const r = Math.max(p.size[0], p.size[2] ?? p.size[0]);
      eu = r;
      ev = r;
      break;
    }
    case "cone": {
      eu = p.size[0];
      ev = p.size[0];
      break;
    }
    case "polygon": {
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const [u, v] of p.points ?? []) {
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }
      return { minU, minV, maxU, maxV, h0: p.pos[1], h1: p.pos[1] + p.size[0] };
    }
    case "sphere": {
      // size = [r, segmentos?] — la altura NO está en size[1] (el return
      // genérico la leería mal): alto real = 2r desde la base.
      const r = p.size[0];
      return {
        minU: p.pos[0] - r,
        minV: p.pos[2] - r,
        maxU: p.pos[0] + r,
        maxV: p.pos[2] + r,
        h0: p.pos[1],
        h1: p.pos[1] + 2 * r,
      };
    }
  }
  return {
    minU: p.pos[0] - eu,
    minV: p.pos[2] - ev,
    maxU: p.pos[0] + eu,
    maxV: p.pos[2] + ev,
    h0: p.pos[1],
    h1: p.pos[1] + p.size[1],
  };
}

/** bbox PROYECTADO (unidades del view_box) de un conjunto de primitivas —
 *  esquinas del AABB de mundo pasadas por PROJECTION.pt. */
function projectedBbox(prims: GreyboxPrimitive[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of prims) {
    const a = primWorldAabb(p);
    for (const u of [a.minU, a.maxU]) {
      for (const v of [a.minV, a.maxV]) {
        for (const h of [a.h0, a.h1]) {
          const [x, y] = PROJECTION.pt(u, v, h);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Construye el spec greybox del tile. `seedKey` (tileKey) siembra el detalle
 *  procedural — estable por tile entre sesiones. */
export function buildTileGreyboxSpec(plan: TileGreyboxPlan, seedKey: string): TileGreyboxSpec {
  const biome = plan.biome ?? "grass";
  const base = BIOME_COLORS[biome] ?? BIOME_COLORS.grass;
  const primitives: GreyboxPrimitive[] = [];

  // ── Suelo: base del bioma (EXACTAMENTE el cuadrado del tile — su alpha es
  // la silueta del compositing) + detalle procedural sembrado. ─────────────
  primitives.push({
    shape: "box",
    size: [TILE_CELLS, 0.1, TILE_CELLS],
    pos: [TILE_CELLS / 2, -0.1, TILE_CELLS / 2],
    color: base,
    cat: "terrain",
    noShadow: true,
  });
  primitives.push(...groundDetailPrims(base, biome, seedKey));

  // ── Rasgos declarativos del suelo (áreas/caminos < agua < decks) — helper
  // compartido con el plató; aquí transform identidad y celdas (byte-idéntico
  // al emisor local que sustituye). ─────────────────────────────────────────
  primitives.push(
    ...groundFeaturePrims(plan.ground ?? [], {
      toXZ: (u, v) => [u, v],
      scale: 1,
      yArea: Y_AREA,
      yPath: Y_PATH,
      yWater: Y_WATER,
      yDeck: Y_DECK,
      layerT: LAYER_T,
    }),
  );

  // ── Volúmenes por tramos + occluders/elements analíticos. ────────────────
  const gates = plan.volumes.filter((v): v is GateVolume => v.type === "gate");
  const occluders: TileOccluderSpec[] = [];
  const bboxByVid = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const v of plan.volumes) {
    const tall = classifyVolume(v).tall;
    for (const part of volumePartsForTile(v, gates)) {
      const idx0 = primitives.length;
      primitives.push(...part.prims);
      const bb = projectedBbox(part.prims);
      if (!bb) continue;
      const acc = bboxByVid.get(v.id);
      bboxByVid.set(
        v.id,
        acc
          ? {
              minX: Math.min(acc.minX, bb.minX),
              minY: Math.min(acc.minY, bb.minY),
              maxX: Math.max(acc.maxX, bb.maxX),
              maxY: Math.max(acc.maxY, bb.maxY),
            }
          : { ...bb },
      );
      if (tall && part.occludes) {
        const p = 1; // margen: antialias no se corta en el borde
        occluders.push({
          id: `${v.id}:${part.part}`,
          vid: v.id,
          label: v.label,
          prims: part.prims.map((_, i) => idx0 + i),
          bbox: [round2(bb.minX - p), round2(bb.minY - p), round2(bb.maxX - bb.minX + 2 * p), round2(bb.maxY - bb.minY + 2 * p)],
          baseline_y: round2(PROJECTION.pt(part.depthPt[0], part.depthPt[1])[1]),
          footprint_cells: [round2(part.footprint[0]), round2(part.footprint[1]), round2(part.footprint[2]), round2(part.footprint[3])],
          ...(part.overhead ? { overhead: true } : {}),
        });
      }
    }
  }

  const elements: ComposedElement[] = [];
  for (const v of plan.volumes) {
    const fp = volumeFootprint(v);
    const b = bboxByVid.get(v.id) ?? { minX: fp.cells[0], minY: fp.cells[1], maxX: fp.cells[2], maxY: fp.cells[3] };
    const [, dy] = PROJECTION.pt(fp.depthPoint[0], fp.depthPoint[1]);
    elements.push({
      id: v.id,
      label: v.label,
      ...classifyVolume(v),
      bbox: [round2(b.minX), round2(b.minY), round2(b.maxX - b.minX), round2(b.maxY - b.minY)],
      baseline_y: round2(dy),
      footprint_cells: [round2(fp.cells[0]), round2(fp.cells[1]), round2(fp.cells[2]), round2(fp.cells[3])],
    });
  }

  // ── Luces FIJAS: sol desde el sur(-oeste) — cara sur lit / este en sombra
  // siempre (viewer del bench labs/render). ────────────────────────────────
  const lights: GreyboxLight[] = [
    { kind: "ambient", color: "#ffffff", intensity: 0.85 },
    { kind: "sun", color: "#ffffff", intensity: 1.6, pos: [-80, 140, 220], castShadow: true },
  ];

  return {
    tile_greybox_version: TILE_GREYBOX_VERSION,
    camera: {
      kind: "ortho_shear",
      view_box: { ...PROJECTION.viewBox },
      kx: OBLIQUE_KX,
      ky: OBLIQUE_KY,
      px_per_cell: TILE_GREYBOX_PX_PER_CELL,
    },
    lights,
    primitives,
    elements,
    occluders,
  };
}
