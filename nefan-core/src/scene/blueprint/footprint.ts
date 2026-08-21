/** Huella y altura analíticas de un volumen — la fuente ÚNICA de colisión,
 *  orden del pintor y manifest: siempre la huella DECLARADA en celdas de
 *  mundo, nunca los píxeles pintados. */

import { volumeSolidDiscRadiusCells } from "./collision.js";
import type { Volume } from "./volumes.js";
import { customPartTop } from "../greybox/volume-prims.js";

/** Las 4 esquinas de un rect rotado `angle` GRADOS (antihorario visto desde
 *  arriba, convención de `rotY`) alrededor de su centro. En el plano de celdas
 *  (v crece hacia el sur) un rotY antihorario es horario visto en pantalla,
 *  de ahí el signo de `s` en la fila de v. */
export function rotatedRectCorners(
  rect: [number, number, number, number],
  angleDeg: number,
): [number, number][] {
  const [u0, v0, w, d] = rect;
  const cu = u0 + w / 2;
  const cv = v0 + d / 2;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as const).map(
    ([du, dv]) => [cu + du * c + dv * s, cv - du * s + dv * c] as [number, number],
  );
}

function rotatedFootprint(
  rect: [number, number, number, number],
  angleDeg: number,
): { depthPoint: [number, number]; cells: [number, number, number, number] } {
  const corners = rotatedRectCorners(rect, angleDeg);
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  let depth: [number, number] = corners[0];
  for (const [u, vv] of corners) {
    minU = Math.min(minU, u);
    minV = Math.min(minV, vv);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, vv);
    if (vv > depth[1]) depth = [u, vv];
  }
  return { depthPoint: depth, cells: [minU, minV, maxU, maxV] };
}

/** Punto de contacto con el suelo más profundo (clave del orden del pintor)
 *  y huella en celdas [minU, minV, maxU, maxV] de un volumen. Con `angle`, la
 *  huella es el AABB del rect rotado (colisión y orden conservadores). */
export function volumeFootprint(v: Volume): { depthPoint: [number, number]; cells: [number, number, number, number] } {
  switch (v.type) {
    case "building": {
      if (v.angle) return rotatedFootprint(v.rect, v.angle);
      const [u0, v0, w, d] = v.rect;
      return { depthPoint: [u0 + w, v0 + d], cells: [u0, v0, u0 + w, v0 + d] };
    }
    case "prop": {
      if (v.rect) {
        if (v.angle) return rotatedFootprint(v.rect, v.angle);
        const [u0, v0, w, d] = v.rect;
        return { depthPoint: [u0 + w, v0 + d], cells: [u0, v0, u0 + w, v0 + d] };
      }
      const [u, vv] = v.at!;
      return { depthPoint: [u + 1.4, vv + 1.4], cells: [u - 1.4, vv - 1.4, u + 1.4, vv + 1.4] };
    }
    case "wall": {
      let minU = Infinity;
      let minV = Infinity;
      let maxU = -Infinity;
      let maxV = -Infinity;
      for (const [u, vv] of v.points) {
        minU = Math.min(minU, u);
        minV = Math.min(minV, vv);
        maxU = Math.max(maxU, u);
        maxV = Math.max(maxV, vv);
      }
      const half = (v.width ?? 3) / 2;
      return { depthPoint: [maxU + half, maxV + half], cells: [minU - half, minV - half, maxU + half, maxV + half] };
    }
    case "tower": {
      const r = v.r ?? 6;
      return { depthPoint: [v.at[0] + r, v.at[1] + r], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
    case "gate": {
      const w = v.w ?? 8;
      const along = w / 2 + 3;
      const dh = 2.2;
      const cells: [number, number, number, number] =
        v.orient === "x"
          ? [v.at[0] - along, v.at[1] - dh, v.at[0] + along, v.at[1] + dh]
          : [v.at[0] - dh, v.at[1] - along, v.at[0] + dh, v.at[1] + along];
      return { depthPoint: [cells[2], cells[3]], cells };
    }
    case "fountain": {
      const r = v.r ?? 5;
      return { depthPoint: [v.at[0] + r, v.at[1] + r], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
    case "custom": {
      // AABB XZ de las piezas (dims × scale) alrededor de `at`, rotado por
      // `angle` alrededor del origen (mismo convenio que las prims emitidas).
      const angleRad = ((v.angle ?? 0) * Math.PI) / 180;
      const ca = Math.cos(angleRad);
      const sa = Math.sin(angleRad);
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const p of v.parts) {
        const [ox, , oz] = p.pos ?? [0, 0, 0];
        const sx = p.scale?.[0] ?? 1;
        const sz = p.scale?.[2] ?? 1;
        let eu: number;
        let ev: number;
        if (p.shape === "box" || p.shape === "gable") {
          eu = (p.size![0] / 2) * sx;
          ev = (p.size![2] / 2) * sz;
        } else {
          const r = p.shape === "cylinder" ? Math.max(p.rBottom!, p.rTop ?? 0) : p.r!;
          // Una pieza tumbada (rotX/rotZ) extiende su altura en planta.
          const e = p.rotX || p.rotZ ? Math.max(r, (p.h ?? 2 * r) / 2) : r;
          eu = e * sx;
          ev = e * sz;
        }
        // Esquinas del AABB local de la pieza, rotadas por angle.
        for (const [du, dv] of [[-eu, -ev], [eu, -ev], [-eu, ev], [eu, ev]] as const) {
          const lu = ox + du;
          const lv = oz + dv;
          const [ru, rv] = v.angle ? [lu * ca + lv * sa, -lu * sa + lv * ca] : [lu, lv];
          minU = Math.min(minU, v.at[0] + ru);
          minV = Math.min(minV, v.at[1] + rv);
          maxU = Math.max(maxU, v.at[0] + ru);
          maxV = Math.max(maxV, v.at[1] + rv);
        }
      }
      return { depthPoint: [maxU, maxV], cells: [minU, minV, maxU, maxV] };
    }
    case "prism": {
      // Huella = AABB del contorno poligonal (sin margen: el polígono ES la
      // huella).
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const [u, vv] of v.points) {
        minU = Math.min(minU, u); minV = Math.min(minV, vv);
        maxU = Math.max(maxU, u); maxV = Math.max(maxV, vv);
      }
      return { depthPoint: [maxU, maxV], cells: [minU, minV, maxU, maxV] };
    }
    default: {
      const s = ("s" in v ? v.s : 1) ?? 1;
      const r = v.type === "rock" ? 2.1 * s : 1.2 * s;
      return { depthPoint: [v.at[0], v.at[1]], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
  }
}

/** Huella en celdas [c0, r0, w, h] de un volumen según su tipo — ÚNICO origen
 *  compartido por el manifest del greybox y la colisión declarada (si
 *  divergieran, colisión y render dejarían de casar). null = sin huella
 *  razonable (prop sin at ni rect). */
export function volumeFootprintCells(v: Volume): [number, number, number, number] | null {
  switch (v.type) {
    case "building": {
      if (v.angle) {
        const { cells } = volumeFootprint(v);
        return [cells[0], cells[1], cells[2] - cells[0], cells[3] - cells[1]];
      }
      return v.rect;
    }
    case "wall": {
      let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
      for (const [c, r] of v.points) {
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      }
      const half = (v.width ?? 3) / 2;
      return [minC - half, minR - half, maxC - minC + 2 * half, maxR - minR + 2 * half];
    }
    case "tower": {
      // Radio de la MISMA fuente que la colisión (antes r??3 aquí vs r??6 en
      // volumeCollisionGrid → la huella del manifest no casaba con el bloqueo).
      const r = volumeSolidDiscRadiusCells(v)!;
      return [v.at[0] - r, v.at[1] - r, 2 * r, 2 * r];
    }
    case "gate": {
      const w = v.w ?? 8;
      return v.orient === "x" ? [v.at[0] - w / 2, v.at[1] - 1.5, w, 3] : [v.at[0] - 1.5, v.at[1] - w / 2, 3, w];
    }
    case "tree": {
      const s = v.s ?? 1;
      return [v.at[0] - 1.6 * s, v.at[1] - 1.6 * s, 3.2 * s, 3.2 * s];
    }
    case "bush": {
      const s = v.s ?? 1;
      return [v.at[0] - s, v.at[1] - s, 2 * s, 2 * s];
    }
    case "rock": {
      const r = volumeSolidDiscRadiusCells(v)!; // 2.1·s, igual que la colisión
      return [v.at[0] - r, v.at[1] - r, 2 * r, 2 * r];
    }
    case "fountain": {
      const r = volumeSolidDiscRadiusCells(v)!; // r??5, igual que la colisión
      return [v.at[0] - r, v.at[1] - r, 2 * r, 2 * r];
    }
    case "prop": {
      if (v.rect) {
        if (v.angle) {
          const { cells } = volumeFootprint(v);
          return [cells[0], cells[1], cells[2] - cells[0], cells[3] - cells[1]];
        }
        return v.rect;
      }
      if (v.at) {
        const r = volumeSolidDiscRadiusCells(v)!; // 1.3, igual que la colisión
        return [v.at[0] - r, v.at[1] - r, 2 * r, 2 * r];
      }
      return null;
    }
    case "prism": {
      // AABB del contorno poligonal (misma huella que footprint.ts y colisión).
      let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
      for (const [c, r] of v.points) {
        minC = Math.min(minC, c); minR = Math.min(minR, r);
        maxC = Math.max(maxC, c); maxR = Math.max(maxR, r);
      }
      return [minC, minR, maxC - minC, maxR - minR];
    }
    case "custom": {
      // Composición libre: la MISMA huella que footprint.ts (AABB de piezas).
      const { cells } = volumeFootprint(v);
      return [cells[0], cells[1], cells[2] - cells[0], cells[3] - cells[1]];
    }
  }
}

/** Altura total (m) de un volumen — la que el greybox 3D levanta y la que el
 *  manifest publica (`hM`). */
export function volumeHeightM(v: Volume, mpc: number): number {
  switch (v.type) {
    case "building": {
      const wallHM = (v.wall_h ?? 5) * mpc;
      const roofKind = v.roof?.kind ?? "gable";
      return roofKind === "flat" || roofKind === "none"
        ? wallHM + 0.3
        : wallHM + Math.max(1, wallHM * 0.5);
    }
    case "wall":
      return (v.h ?? 5) * mpc + (v.crenellated ? 0.4 : 0);
    case "tower":
      return (v.h ?? 12) * mpc + 0.5;
    case "gate":
      return (v.h ?? 8) * mpc;
    case "tree":
      return (1.6 + 1.7 * 1.9) * (v.s ?? 1); // tronco + copa (≈ SVG)
    case "bush":
      return 1.3 * (v.s ?? 1);
    case "rock":
      return 1.1 * (v.s ?? 1);
    case "fountain":
      return 1.4;
    case "prop":
      return (v.h ?? 2) * mpc;
    case "prism":
      return v.h * mpc;
    case "custom":
      return Math.max(...v.parts.map(customPartTop)) * mpc;
  }
}
