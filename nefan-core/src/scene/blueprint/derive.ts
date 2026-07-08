/** Fallback de volúmenes desde el esquema del tile: cuando el motor
 *  narrativo no declara `volumes` (o los declara parciales), el compositor
 *  sintetiza los que el esquema ya implica — `structures` → edificios
 *  cutaway, `entities` estáticas (building/tree/prop/decor) → su volumen
 *  equivalente, `vegetation_zones` → árboles/matas dispersos. Así TODO tile
 *  tiene blueprint con volumen coherente y el modo legacy "boxes" desaparece.
 *
 *  Determinista: el scatter usa SeededRng derivado de `scene_id` + índice de
 *  zona (mismo criterio que la expansión de vegetación de scene-expand). Los
 *  volúmenes del LLM mandan: una estructura cuyo rect ya solapa un `building`
 *  declarado no se deriva. */

import { TILE_CELLS } from "../tile.js";
import { volumeFootprint } from "./render.js";
import { fnv1a, seededRng, uniform } from "./svg.js";
import type { Volume } from "./volumes.js";

interface RawDoor {
  side?: string;
  at?: number;
  width?: number;
}

interface RawStructure {
  type?: string;
  rect?: unknown;
  doors?: RawDoor[];
}

interface RawZone {
  type?: string;
  area?: unknown;
  density?: number;
}

interface RawFeature {
  points?: unknown;
  width?: number;
}

interface RawEntity {
  id?: string;
  kind?: string;
  cell?: unknown;
  footprint?: unknown;
  name?: string;
  shape?: string;
}

export interface DeriveInput {
  scene_id?: string;
  structures?: RawStructure[];
  vegetation_zones?: RawZone[];
  /** Entities del esquema — las estáticas (building/tree/prop/decor) derivan
   *  su volumen para que el blueprint las pinte proyectadas (sin esto, el
   *  cliente caería a cajas sin proyectar sobre el plan). */
  entities?: RawEntity[];
  /** Caminos/ríos del esquema — el scatter de vegetación no los pisa. */
  terrain_features?: RawFeature[];
}

const SIDE_TO_EDGE: Record<string, "n" | "s" | "e" | "w"> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

function asRect4(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [c, r, w, d] = raw as number[];
  if (w <= 0 || d <= 0) return null;
  return [c, r, w, d];
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

const BUSH_TYPES = /arbusto|mata|matorral|helecho|zarza|bush/i;

/** Deriva los volúmenes implícitos del esquema. Devuelve SOLO las adiciones
 *  (el caller concatena tras los del LLM). Silencioso ante primitivas mal
 *  formadas — el esquema ya pasó por validateScene; esto es un fallback
 *  visual, no un validador. */
export function deriveVolumesFromSchema(raw: DeriveInput, declared: Volume[]): Volume[] {
  const out: Volume[] = [];
  const declaredRects = declared.map((v) => {
    const [u0, v0, u1, v1] = volumeFootprint(v).cells;
    return [u0, v0, u1 - u0, v1 - v0] as [number, number, number, number];
  });
  const blockers: [number, number, number, number][] = [...declaredRects];

  const structures = Array.isArray(raw.structures) ? raw.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    if (s?.type !== "room") continue;
    const rect = asRect4(s.rect);
    if (!rect) continue;
    if (declaredRects.some((r) => overlaps(r, rect))) continue; // el LLM ya lo cubrió
    const doors = (Array.isArray(s.doors) ? s.doors : [])
      .filter((d) => d && typeof d.at === "number" && typeof d.side === "string" && SIDE_TO_EDGE[d.side])
      .map((d) => ({ edge: SIDE_TO_EDGE[d.side!], at: d.at!, w: d.width ?? 4 }));
    out.push({
      id: `derived_room_${i}`,
      label: "edificio",
      type: "building",
      rect,
      cutaway: true,
      doors,
    });
    blockers.push(rect);
  }

  // ── Entities estáticas del esquema → su volumen equivalente ──────────────
  // building = edificio NO enterable (con techo — los enterables son
  // structures); tree/prop/decor = su primitiva. Los ids llevan el id de la
  // entity para poder correlacionar (occluders, debug).
  const entities = Array.isArray(raw.entities) ? raw.entities : [];
  for (const ent of entities) {
    const kind = ent?.kind;
    if (kind !== "building" && kind !== "tree" && kind !== "prop" && kind !== "decor") continue;
    const cell = ent.cell;
    const fp = ent.footprint;
    if (!Array.isArray(cell) || cell.length < 2 || !Array.isArray(fp) || fp.length < 2) continue;
    const [c, r] = cell as number[];
    const [w, d] = fp as number[];
    if (![c, r, w, d].every((n) => typeof n === "number" && Number.isFinite(n)) || w <= 0 || d <= 0) continue;
    const rect: [number, number, number, number] = [
      Math.max(0, Math.min(TILE_CELLS - 1, c)),
      Math.max(0, Math.min(TILE_CELLS - 1, r)),
      Math.min(w, TILE_CELLS),
      Math.min(d, TILE_CELLS),
    ];
    if (blockers.some((b) => overlaps(b, rect))) continue; // el LLM/structures ya lo cubren
    const label = typeof ent.name === "string" && ent.name ? ent.name : kind;
    const id = `derived_ent_${ent.id ?? `${c}_${r}`}`;
    if (kind === "tree") {
      const s = Math.min(2.5, Math.max(0.5, Math.max(w, d) / 4));
      out.push({ id, label, type: "tree", at: [round1(c + w / 2), round1(r + d / 2)], s: round1(s) });
    } else if (kind === "building") {
      out.push({ id, label, type: "building", rect, roof: { kind: "gable" } });
    } else {
      const shape = ent.shape === "cylinder" || ent.shape === "sphere" ? "cylinder" : "box";
      out.push(
        kind === "decor"
          ? { id, label, type: "prop", rect, shape, h: 1, passable: true }
          : { id, label, type: "prop", rect, shape, h: 3 },
      );
    }
    blockers.push(rect);
  }

  // Bandas de caminos/ríos: el scatter las esquiva con margen.
  const bands: { points: [number, number][]; half: number }[] = [];
  for (const f of Array.isArray(raw.terrain_features) ? raw.terrain_features : []) {
    if (!Array.isArray(f?.points)) continue;
    const pts = f.points.filter(
      (p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"),
    );
    if (pts.length >= 2) bands.push({ points: pts, half: ((f.width ?? 2) / 2) + 4 });
  }
  const nearBand = (u: number, v: number): boolean =>
    bands.some(({ points, half }) => {
      for (let i = 0; i < points.length - 1; i++) {
        const [au, av] = points[i];
        const [bu, bv] = points[i + 1];
        const dU = bu - au;
        const dV = bv - av;
        const t = Math.max(0, Math.min(1, ((u - au) * dU + (v - av) * dV) / (dU * dU + dV * dV || 1)));
        const dx = u - (au + t * dU);
        const dy = v - (av + t * dV);
        if (dx * dx + dy * dy <= half * half) return true;
      }
      return false;
    });

  const zones = Array.isArray(raw.vegetation_zones) ? raw.vegetation_zones : [];
  const placed: [number, number][] = declared
    .filter((v) => v.type === "tree")
    .map((v) => (v as Extract<Volume, { type: "tree" }>).at as [number, number]);
  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    const density = typeof zone?.density === "number" ? Math.min(1, Math.max(0, zone.density)) : 0;
    if (density <= 0) continue;
    const area = zone.area === "rest" ? ([0, 0, TILE_CELLS, TILE_CELLS] as [number, number, number, number]) : asRect4(zone.area);
    if (!area) continue;
    const isBush = BUSH_TYPES.test(zone.type ?? "");
    const rng = seededRng(`${raw.scene_id ?? "tile"}:veg:${zi}:${fnv1a(zone.type ?? "veg")}`);
    // El scatter visual es más ralo que el del grid ASCII: un árbol del
    // blueprint son ~10 celdas de copa, no 1. Cap duro para no saturar.
    const target = Math.min(48, Math.round((area[2] * area[3] * density) / 22));
    let attempts = 0;
    let placedCount = 0;
    const minSep = isBush ? 5 : 8;
    while (placedCount < target && attempts < target * 12) {
      attempts++;
      const u = uniform(rng, area[0] + 2, area[0] + area[2] - 2);
      const v = uniform(rng, area[1] + 2, area[1] + area[3] - 2);
      if (blockers.some((r) => u > r[0] - 3 && u < r[0] + r[2] + 3 && v > r[1] - 3 && v < r[1] + r[3] + 3)) continue;
      if (nearBand(u, v)) continue;
      if (placed.some(([pu, pv]) => (pu - u) * (pu - u) + (pv - v) * (pv - v) < minSep * minSep)) continue;
      placed.push([u, v]);
      const s = Math.round(uniform(rng, isBush ? 0.7 : 0.75, isBush ? 1.1 : 1.2) * 100) / 100;
      out.push(
        isBush
          ? { id: `derived_veg_${zi}_${placedCount}`, label: zone.type ?? "arbusto", type: "bush", at: [round1(u), round1(v)], s }
          : { id: `derived_veg_${zi}_${placedCount}`, label: zone.type ?? "árbol", type: "tree", at: [round1(u), round1(v)], s },
      );
      placedCount++;
    }
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
