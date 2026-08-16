/** Interior fps de los edificios `cutaway` — post-proceso FPS-ONLY.
 *
 *  En la vista cenital el cutaway es una casa de muñecas (suelo + muros
 *  traseros altos y frente bajo); en fps ese recorte no vale y hasta ahora se
 *  "cerraba" en un box MACIZO: la colisión (anillo de muros con vanos de
 *  puerta, `markBuilding`) decía "enterable" pero el visual era un bloque —
 *  entrabas por el vano a un vacío negro con los muebles embebidos.
 *
 *  Este módulo sustituye el cuerpo macizo por geometría real espejo de la
 *  colisión: 4 muros de altura completa y grosor `T` (== markBuilding) con
 *  los vanos de puerta tallados (ancho == colisión), dintel sobre cada vano
 *  y suelo interior. El tejado del builder compartido se conserva; las caras
 *  interiores de los muros son caras de box normales → heredan material y
 *  color de walls (se acabó el negro). Unidades: CELDAS (como las prims del
 *  builder compartido). NO toca el builder cenital ni sus hashes. */

import { PALETTE, wallColors, darken } from "./palette.js";
import type { BuildingVolume } from "./volumes.js";
import type { GreyboxPrimitive } from "../greybox/common.js";

/** Grosor del muro (celdas) — ESPEJO de markBuilding (collision.ts). */
const WALL_T = 1.5;
/** Ancho de vano por defecto — espejo de `door.w ?? 4` de la colisión. */
const DOOR_W = 4;
/** Base del dintel (celdas): 4 = 2 m de paso libre. */
const LINTEL_BASE = 4;

/** Segmentos de [lo,hi] que quedan tras quitar los huecos `gaps`. */
function carveSpan(lo: number, hi: number, gaps: Array<[number, number]>): Array<[number, number]> {
  let kept: Array<[number, number]> = [[lo, hi]];
  for (const [g0, g1] of gaps) {
    const next: Array<[number, number]> = [];
    for (const [s0, s1] of kept) {
      if (g1 <= s0 || g0 >= s1) {
        next.push([s0, s1]);
        continue;
      }
      if (g0 > s0) next.push([s0, g0]);
      if (g1 < s1) next.push([g1, s1]);
    }
    kept = next;
  }
  return kept.filter(([s0, s1]) => s1 - s0 > 0.05);
}

function wallBox(
  isX: boolean,
  at: number,
  s0: number,
  s1: number,
  y: number,
  h: number,
  color: string,
  volId: string,
): GreyboxPrimitive {
  return {
    shape: "box",
    size: isX ? [s1 - s0, h, WALL_T] : [WALL_T, h, s1 - s0],
    pos: isX ? [(s0 + s1) / 2, y, at] : [at, y, (s0 + s1) / 2],
    color,
    cat: "building",
    volId,
  };
}

/** Prims del cuerpo enterable de un cutaway: muros con vanos + dinteles +
 *  suelo. El tejado NO se emite aquí (se conserva el del builder). */
export function cutawayBodyPrims(v: BuildingVolume): GreyboxPrimitive[] {
  const [u0, v0, w, d] = v.rect;
  const u1 = u0 + w;
  const v1 = v0 + d;
  const wallH = v.wall_h ?? 5;
  const wc = wallColors(v.walls?.material, v.walls?.color);
  const shade = darken(wc.lit, 0.14);
  const volId = `vol_${v.id}`;
  const prims: GreyboxPrimitive[] = [];

  const edges: Array<{ edge: "n" | "s" | "e" | "w"; isX: boolean; at: number; lo: number; hi: number; tone: string }> = [
    { edge: "n", isX: true, at: v0 + WALL_T / 2, lo: u0, hi: u1, tone: wc.lit },
    { edge: "s", isX: true, at: v1 - WALL_T / 2, lo: u0, hi: u1, tone: wc.lit },
    { edge: "w", isX: false, at: u0 + WALL_T / 2, lo: v0, hi: v1, tone: shade },
    { edge: "e", isX: false, at: u1 - WALL_T / 2, lo: v0, hi: v1, tone: shade },
  ];
  for (const e of edges) {
    const base = e.isX ? u0 : v0;
    const gaps: Array<[number, number]> = (v.doors ?? [])
      .filter((dr) => dr.edge === e.edge)
      .map((dr) => [base + dr.at, base + dr.at + (dr.w ?? DOOR_W)]);
    for (const [s0, s1] of carveSpan(e.lo, e.hi, gaps))
      prims.push(wallBox(e.isX, e.at, s0, s1, 0, wallH, e.tone, volId));
    // Dintel sobre cada vano (el vano de colisión es de altura completa;
    // el visual deja LINTEL_BASE de paso y cierra hasta wallH).
    if (wallH > LINTEL_BASE)
      for (const [g0, g1] of gaps)
        prims.push(wallBox(e.isX, e.at, Math.max(g0, e.lo), Math.min(g1, e.hi), LINTEL_BASE, wallH - LINTEL_BASE, e.tone, volId));
  }

  prims.push({
    shape: "box",
    size: [w, 0.1, d],
    pos: [u0 + w / 2, 0.02, v0 + d / 2],
    color: darken(PALETTE.woodTop, 0.05),
    cat: "building",
    volId,
    noShadow: true,
  });
  // Techo interior de tablones a la altura del muro: sin él, desde dentro se
  // veía el envés del tejado con su textura de TEJA (crítica externa
  // 2026-08-16 — "teja como techo interior es un bug de contenido").
  prims.push({
    shape: "box",
    size: [w, 0.15, d],
    pos: [u0 + w / 2, wallH, v0 + d / 2],
    color: darken(PALETTE.woodTop, 0.25),
    cat: "building",
    volId,
    noShadow: true,
    mat: { bottom: "wood_floor" },
  } as GreyboxPrimitive);
  return prims;
}

/** Sustituye en `prims` el cuerpo macizo (y los paneles de puerta pintados)
 *  de cada building cutaway por su versión enterable. El resto de prims del
 *  volumen (tejado, ventanas/chimeneas del detalle) se conservan. */
export function applyFpsCutawayInteriors(
  prims: GreyboxPrimitive[],
  volumes: Array<{ type: string } & Record<string, unknown>>,
): GreyboxPrimitive[] {
  const cutaways = volumes.filter(
    (v): v is BuildingVolume & Record<string, unknown> => v.type === "building" && v.cutaway === true,
  );
  if (cutaways.length === 0) return prims;
  const out: GreyboxPrimitive[] = [];
  const replaced = new Set<string>();
  for (const v of cutaways) replaced.add(`vol_${v.id}`);
  for (const p of prims) {
    if (!p.volId || !replaced.has(p.volId)) {
      out.push(p);
      continue;
    }
    const v = cutaways.find((c) => `vol_${c.id}` === p.volId)!;
    const [, , w, d] = v.rect;
    const wallH = v.wall_h ?? 5;
    const isBody =
      p.shape === "box" && p.size[0] === w && p.size[1] === wallH && p.size[2] === d && p.pos[1] === 0;
    // Panel de puerta pintado del builder (decorativo): en el cutaway el
    // vano queda abierto de verdad.
    const isDoorPanel = p.shape === "box" && p.color === "#2a2018" && p.size[1] === 3;
    if (isBody) {
      out.push(...cutawayBodyPrims(v));
      continue;
    }
    if (isDoorPanel) continue;
    out.push(p);
  }
  return out;
}
