/** Primitivas greybox 3D de los volúmenes del TILE oblicuo — lógica pura.
 *
 *  Porta el intérprete de volúmenes de labs/render/exp2_three/plan_to_scene.mjs
 *  (E2a: fidelidad 100/100 del bench) al vocabulario `GreyboxPrimitive`.
 *  Unidades: CELDAS del tile (posiciones y alturas; 1 celda = 0.5 m).
 *  pos = [u, hBase, v] con y = BASE de la pieza (contrato de greybox/common).
 *
 *  Cada volumen se emite como PARTES (tramos): la unidad de oclusión del
 *  depth-sort del cliente y del recorte por occluder — espejo exacto de la
 *  segmentación del extinto compositor SVG (cutaway en floor/back_n/back_w/
 *  front, muros troceados a ~14 celdas, árbol en tronco + copa aérea). */

import { PALETTE, wallColors, roofColors, darken, lighten } from "../blueprint/palette.js";
import type { GateVolume, Volume } from "../blueprint/volumes.js";
import type { GreyboxPrimitive } from "./common.js";

/** Opacidad de la copa del árbol al pintar su recorte (cubre sin ocultar del
 *  todo lo que hay debajo). La aplica el cliente al canvas del occluder. */
export const CANOPY_OPACITY = 0.65;

/** Un tramo de volumen: primitivas + metadatos del depth-sort. */
export interface VolumePart {
  /** Sufijo estable del tramo dentro del volumen ("floor", "back_n", "2_1"…). */
  part: string;
  prims: GreyboxPrimitive[];
  /** Huella del tramo en celdas [minU, minV, maxU, maxV]. */
  footprint: [number, number, number, number];
  /** Punto de contacto más profundo (u, v) — baseline del depth-sort. */
  depthPt: [number, number];
  /** false = el tramo no se recorta como occluder aunque el volumen sea tall
   *  (el suelo del cutaway pintado encima taparía sus muebles). */
  occludes: boolean;
  /** true = tramo aéreo (copa): se pinta SIEMPRE encima de las entidades. */
  overhead?: boolean;
}

/** solid/tall por tipo — la semántica del clasificador de visión: solid = un
 *  personaje no lo atraviesa; tall = se dibuja encima de quien esté detrás. */
export function classifyVolume(v: Volume): { solid: boolean; tall: boolean } {
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

/** Divide el intervalo [a,b] quitando los huecos `gaps` = [[g0,g1],...]. */
function carve(a: number, b: number, gaps: Array<[number, number]>): Array<[number, number]> {
  let spans: Array<[number, number]> = [[a, b]];
  for (const [g0, g1] of gaps) {
    const next: Array<[number, number]> = [];
    for (const [s0, s1] of spans) {
      if (g1 <= s0 || g0 >= s1) {
        next.push([s0, s1]);
        continue;
      }
      if (g0 > s0) next.push([s0, g0]);
      if (g1 < s1) next.push([g1, s1]);
    }
    spans = next;
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.3);
}

const box = (
  w: number,
  h: number,
  d: number,
  cx: number,
  yBase: number,
  cz: number,
  color: string,
  cat: GreyboxPrimitive["cat"],
  extra: Partial<GreyboxPrimitive> = {},
): GreyboxPrimitive => ({ shape: "box", size: [w, h, d], pos: [cx, yBase, cz], color, cat, ...extra });

/** Partes greybox de un volumen. `gates` talla los vanos en los muros que los
 *  cruzan (el visual debe coincidir con clearGatePassage de la colisión). */
export function volumePartsForTile(v: Volume, gates: GateVolume[]): VolumePart[] {
  const wall = (mat?: string, color?: string) => wallColors(mat as never, color);
  switch (v.type) {
    case "building": {
      const [u0, v0, w, d] = v.rect;
      const wallH = v.wall_h ?? 5;
      const wc = wall(v.walls?.material, v.walls?.color);
      const cx = u0 + w / 2;
      const cz = v0 + d / 2;
      if (v.cutaway) {
        // Muros traseros (N y O) altos; frontales (S y E) bajos; suelo de
        // madera. Cada muro talla los huecos de sus `doors`.
        const t = 1.2;
        const lowH = 1.6;
        const doorGaps = (edge: "n" | "s" | "e" | "w", base: number): Array<[number, number]> =>
          (v.doors ?? [])
            .filter((dr) => dr.edge === edge)
            .map((dr) => [base + dr.at, base + dr.at + (dr.w ?? 4)] as [number, number]);
        const strips = (
          edge: "n" | "s" | "e" | "w",
          isX: boolean,
          at: number,
          lo: number,
          hi: number,
          hgt: number,
          tone: string,
        ): GreyboxPrimitive[] =>
          carve(lo, hi, doorGaps(edge, isX ? u0 : v0)).map(([s0, s1]) =>
            isX
              ? box(s1 - s0, hgt, t, (s0 + s1) / 2, 0, at, tone, "building", { volId: `vol_${v.id}` })
              : box(t, hgt, s1 - s0, at, 0, (s0 + s1) / 2, tone, "building", { volId: `vol_${v.id}` }),
          );
        const shade = darken(wc.lit, 0.14);
        const floorPrim = box(w, 0.1, d, cx, 0.02, cz, darken(PALETTE.woodTop, 0.05), "building", {
          volId: `vol_${v.id}`,
          noShadow: true,
        });
        return [
          { part: "floor", prims: [floorPrim], footprint: [u0, v0, u0 + w, v0 + d], depthPt: [u0 + w, v0], occludes: false },
          { part: "back_n", prims: strips("n", true, v0 + t / 2, u0, u0 + w, wallH, wc.lit), footprint: [u0, v0, u0 + w, v0 + t], depthPt: [u0 + w, v0], occludes: true },
          { part: "back_w", prims: strips("w", false, u0 + t / 2, v0, v0 + d, wallH, shade), footprint: [u0, v0, u0 + t, v0 + d], depthPt: [u0 + w, v0], occludes: true },
          {
            part: "front",
            prims: [
              ...strips("s", true, v0 + d - t / 2, u0, u0 + w, lowH, wc.lit),
              ...strips("e", false, u0 + w - t / 2, v0, v0 + d, lowH, shade),
            ],
            footprint: [u0, v0 + d - t, u0 + w, v0 + d],
            depthPt: [u0 + w, v0 + d],
            occludes: true,
          },
        ];
      }
      // Edificio con techo: cuerpo + tejado + puertas pintadas.
      const prims: GreyboxPrimitive[] = [
        box(w, wallH, d, cx, 0, cz, wc.lit, "building", { volId: `vol_${v.id}` }),
      ];
      const roofKind = v.roof?.kind ?? "gable";
      const rc = roofColors(v.roof?.material, v.roof?.color);
      if (roofKind === "flat") {
        prims.push(box(w + 0.8, 0.4, d + 0.8, cx, wallH, cz, rc.lit, "building", { volId: `vol_${v.id}` }));
      } else if (roofKind !== "none") {
        const axis = v.roof?.axis ?? (w >= d ? "x" : "y");
        const rise = Math.min(w, d) * 0.45;
        prims.push({
          shape: "gable",
          // gable: cumbrera a lo largo de d ANTES de rotY (contrato common).
          size: axis === "x" ? [d + 1.2, rise, w + 1.2] : [w + 1.2, rise, d + 1.2],
          pos: [cx, wallH, cz],
          rotY: axis === "x" ? Math.PI / 2 : 0,
          color: rc.lit,
          cat: "building",
          volId: `vol_${v.id}`,
        });
      }
      for (const door of v.doors ?? []) {
        const dw = door.w ?? 3;
        const alongX = door.edge === "n" || door.edge === "s";
        const at = door.at ?? 0;
        const pos: [number, number, number] =
          door.edge === "s" ? [u0 + at + dw / 2, 0, v0 + d]
          : door.edge === "n" ? [u0 + at + dw / 2, 0, v0]
          : door.edge === "e" ? [u0 + w, 0, v0 + at + dw / 2]
          : [u0, 0, v0 + at + dw / 2];
        prims.push({
          shape: "box",
          size: alongX ? [dw, 3, 0.3] : [0.3, 3, dw],
          pos,
          color: "#2a2018",
          cat: "building",
          volId: `vol_${v.id}`,
        });
      }
      return [{ part: "base", prims, footprint: [u0, v0, u0 + w, v0 + d], depthPt: [u0 + w, v0 + d], occludes: true }];
    }
    case "wall": {
      const width = v.width ?? 3;
      const h = v.h ?? 5;
      const wc = wall("stone");
      const parts: VolumePart[] = [];
      const pts = v.points as [number, number][];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const dirU = (x2 - x1) / (len || 1);
        const dirV = (z2 - z1) / (len || 1);
        // Vanos de los gates que caen sobre este segmento.
        const gateGaps: Array<[number, number]> = [];
        for (const g of gates) {
          const t = (g.at[0] - x1) * dirU + (g.at[1] - z1) * dirV;
          if (t < -2 || t > len + 2) continue;
          const px = x1 + dirU * t;
          const pz = z1 + dirV * t;
          if (Math.hypot(g.at[0] - px, g.at[1] - pz) > width / 2 + 2) continue;
          const gw = g.w ?? 8;
          gateGaps.push([t - gw / 2, t + gw / 2]);
        }
        // Tramos de ~14 celdas: cada uno es su propia unidad de oclusión. Los
        // extremos ganan media anchura de tapa (continuidad entre tramos)
        // pero CLAMPADA al span tallado — el vano de un gate queda limpio.
        const chunks: Array<[number, number]> = [];
        for (const [s0, s1] of carve(0, len, gateGaps)) {
          const n = Math.max(1, Math.ceil((s1 - s0) / 14));
          for (let c = 0; c < n; c++) {
            const t0 = s0 + ((s1 - s0) * c) / n;
            const t1 = s0 + ((s1 - s0) * (c + 1)) / n;
            chunks.push([Math.max(s0, t0 - width / 2), Math.min(s1, t1 + width / 2)]);
          }
        }
        chunks.forEach(([t0, t1], ci) => {
          const ax = x1 + dirU * t0;
          const az = z1 + dirV * t0;
          const bx = x1 + dirU * t1;
          const bz = z1 + dirV * t1;
          const clen = t1 - t0;
          const prims: GreyboxPrimitive[] = [
            {
              shape: "box",
              size: [clen, h, width],
              pos: [(ax + bx) / 2, 0, (az + bz) / 2],
              rotY: -Math.atan2(bz - az, bx - ax),
              color: wc.lit,
              cat: "wall",
              volId: `vol_${v.id}`,
            },
          ];
          if (v.crenellated) {
            for (let o = width / 2; o < clen; o += 2.4) {
              const f = o / clen;
              prims.push(
                box(1, 1, width + 0.4, ax + (bx - ax) * f, h, az + (bz - az) * f, PALETTE.merlon, "wall", {
                  volId: `vol_${v.id}`,
                }),
              );
            }
          }
          // Huella = AABB real de la caja del tramo (longitudinal exacta —
          // nunca invade un vano tallado; transversal con la media anchura).
          const cU = Math.abs(dirU);
          const cV = Math.abs(dirV);
          const exU = (cU * clen + cV * width) / 2;
          const exV = (cV * clen + cU * width) / 2;
          const mx = (ax + bx) / 2;
          const mz = (az + bz) / 2;
          parts.push({
            part: `${i}_${ci}`,
            prims,
            footprint: [mx - exU, mz - exV, mx + exU, mz + exV],
            depthPt: [mx + exU, mz + exV],
            occludes: true,
          });
        });
      }
      return parts;
    }
    case "tower": {
      const r = v.r ?? 6;
      const h = v.h ?? 12;
      const wc = wall("stone");
      const prims: GreyboxPrimitive[] = [
        { shape: "cylinder", size: [r, h, r * 1.08], pos: [v.at[0], 0, v.at[1]], color: wc.lit, cat: "wall", volId: `vol_${v.id}` },
        { shape: "cylinder", size: [r * 1.04, 0.5], pos: [v.at[0], h, v.at[1]], color: wc.top, cat: "wall", volId: `vol_${v.id}` },
      ];
      if (v.crenellated) {
        for (let k = 0; k < 12; k++) {
          const a = (k * Math.PI) / 6;
          prims.push(
            box(1, 1, 1, v.at[0] + Math.cos(a) * (r - 0.5), h + 0.5, v.at[1] + Math.sin(a) * (r - 0.5), PALETTE.merlon, "wall", {
              volId: `vol_${v.id}`,
            }),
          );
        }
      }
      return [
        {
          part: "base",
          prims,
          footprint: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r],
          depthPt: [v.at[0] + r, v.at[1] + r],
          occludes: true,
        },
      ];
    }
    case "gate": {
      // Gatehouse: jambas robustas + dintel de madera oscura que cruza el
      // muro anfitrión + almenas. El vano queda libre (el muro lo talla).
      const w = v.w ?? 8;
      const h = v.h ?? 8;
      // Jamba de 3 celdas: el borde exterior queda EXACTAMENTE en w/2 + 3 —
      // la huella declarada de volumeFootprint (el bbox proyectado la cubre).
      const jambW = 3;
      const [gx, gz] = v.at;
      const wc = wall("stone");
      const alongX = v.orient === "x"; // el muro corre a lo largo de col
      const jamb = (off: number): GreyboxPrimitive =>
        alongX
          ? box(jambW, h, 5, gx + off, 0, gz, wc.lit, "wall", { volId: `vol_${v.id}` })
          : box(5, h, jambW, gx, 0, gz + off, wc.lit, "wall", { volId: `vol_${v.id}` });
      const prims: GreyboxPrimitive[] = [
        jamb(-(w / 2 + jambW / 2)),
        jamb(w / 2 + jambW / 2),
        alongX
          ? box(w + 2 * jambW, 1.8, 6.5, gx, h - 0.9, gz, "#6b4a2c", "wall", { volId: `vol_${v.id}` })
          : box(6.5, 1.8, w + 2 * jambW, gx, h - 0.9, gz, "#6b4a2c", "wall", { volId: `vol_${v.id}` }),
      ];
      for (const off of [-(w / 2 + jambW / 2), w / 2 + jambW / 2]) {
        for (const oo of [-1.8, 0, 1.8]) {
          prims.push(
            alongX
              ? box(1.1, 1.1, 1.1, gx + off, h + 0.55, gz + oo, PALETTE.merlon, "wall", { volId: `vol_${v.id}` })
              : box(1.1, 1.1, 1.1, gx + oo, h + 0.55, gz + off, PALETTE.merlon, "wall", { volId: `vol_${v.id}` }),
          );
        }
      }
      const fp: [number, number, number, number] = alongX
        ? [gx - w / 2 - jambW, gz - 3, gx + w / 2 + jambW, gz + 3]
        : [gx - 3, gz - w / 2 - jambW, gx + 3, gz + w / 2 + jambW];
      return [{ part: "base", prims, footprint: fp, depthPt: [fp[2], fp[3]], occludes: true }];
    }
    case "tree": {
      const s = v.s ?? 1;
      const trunkH = 3.2 * s;
      const trunkFp: [number, number, number, number] = [
        v.at[0] - 0.9 * s,
        v.at[1] - 0.9 * s,
        v.at[0] + 0.9 * s,
        v.at[1] + 0.9 * s,
      ];
      const trunk: GreyboxPrimitive = {
        shape: "cylinder",
        size: [0.5 * s, trunkH, 0.4 * s],
        pos: [v.at[0], 0, v.at[1]],
        color: PALETTE.trunk,
        cat: "tree",
        volId: `vol_${v.id}`,
      };
      // Copa: masa cónica ancha (legible como copa en clay y desde arriba).
      const canopy: GreyboxPrimitive = {
        shape: "cone",
        size: [3.2 * s, 5.2 * s, 10],
        pos: [v.at[0], trunkH * 0.75, v.at[1]],
        color: PALETTE.canopy,
        cat: "tree",
        volId: `vol_${v.id}`,
      };
      const depthPt: [number, number] = [v.at[0] + 1.2 * s, v.at[1] + 1.2 * s];
      return [
        { part: "trunk", prims: [trunk], footprint: trunkFp, depthPt, occludes: true },
        { part: "canopy", prims: [canopy], footprint: trunkFp, depthPt, occludes: true, overhead: true },
      ];
    }
    case "bush": {
      const s = v.s ?? 1;
      return [
        {
          part: "base",
          prims: [
            { shape: "cone", size: [1.3 * s, 1.9 * s, 8], pos: [v.at[0], 0, v.at[1]], color: PALETTE.canopy, cat: "tree", volId: `vol_${v.id}` },
          ],
          footprint: [v.at[0] - 1.2 * s, v.at[1] - 1.2 * s, v.at[0] + 1.2 * s, v.at[1] + 1.2 * s],
          depthPt: [v.at[0], v.at[1]],
          occludes: false,
        },
      ];
    }
    case "rock": {
      const s = v.s ?? 1;
      // Radio 2.1·s: el MISMO de su huella declarada (volumeFootprint y
      // markDisc de la colisión) — visual y colisión coinciden.
      return [
        {
          part: "base",
          prims: [
            { shape: "cone", size: [2.1 * s, 1.6 * s, 5], pos: [v.at[0], 0, v.at[1]], color: PALETTE.stoneTop, cat: "prop", volId: `vol_${v.id}` },
          ],
          footprint: [v.at[0] - 2.1 * s, v.at[1] - 2.1 * s, v.at[0] + 2.1 * s, v.at[1] + 2.1 * s],
          depthPt: [v.at[0], v.at[1]],
          occludes: false,
        },
      ];
    }
    case "fountain": {
      const r = v.r ?? 5;
      return [
        {
          part: "base",
          prims: [
            { shape: "cylinder", size: [r, 1.1], pos: [v.at[0], 0, v.at[1]], color: PALETTE.stoneTop, cat: "prop", volId: `vol_${v.id}` },
            { shape: "cylinder", size: [r * 0.82, 0.12], pos: [v.at[0], 1.05, v.at[1]], color: PALETTE.water, cat: "water", volId: `vol_${v.id}`, noShadow: true },
            { shape: "cylinder", size: [0.4, 2.6], pos: [v.at[0], 0, v.at[1]], color: PALETTE.stoneFace, cat: "prop", volId: `vol_${v.id}` },
          ],
          footprint: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r],
          depthPt: [v.at[0] + r, v.at[1] + r],
          occludes: false,
        },
      ];
    }
    case "prop": {
      const h = v.h ?? 2;
      const color = v.color ?? PALETTE.woodTop;
      const fp: [number, number, number, number] = v.rect
        ? [v.rect[0], v.rect[1], v.rect[0] + v.rect[2], v.rect[1] + v.rect[3]]
        : [v.at![0] - 1.4, v.at![1] - 1.4, v.at![0] + 1.4, v.at![1] + 1.4];
      const cx = (fp[0] + fp[2]) / 2;
      const cz = (fp[1] + fp[3]) / 2;
      const w = fp[2] - fp[0];
      const d = fp[3] - fp[1];
      const prims: GreyboxPrimitive[] =
        v.shape === "cylinder"
          ? [
              { shape: "cylinder", size: [Math.min(w, d) / 2, h], pos: [cx, 0, cz], color, cat: "prop", volId: `vol_${v.id}` },
              { shape: "cylinder", size: [Math.min(w, d) / 2, 0.06], pos: [cx, h, cz], color: lighten(color, 0.15), cat: "prop", volId: `vol_${v.id}`, noShadow: true },
            ]
          : [box(w, h, d, cx, 0, cz, color, "prop", { volId: `vol_${v.id}` })];
      return [
        { part: "base", prims, footprint: fp, depthPt: [fp[2], fp[3]], occludes: classifyVolume(v).tall },
      ];
    }
  }
}
