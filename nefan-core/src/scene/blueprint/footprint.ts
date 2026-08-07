/** Huella analítica de un volumen — la fuente ÚNICA de colisión, orden del
 *  pintor y manifest: siempre la huella DECLARADA en celdas de mundo, nunca
 *  los píxeles pintados. */

import type { Volume } from "./volumes.js";

/** Punto de contacto con el suelo más profundo (clave del orden del pintor)
 *  y huella en celdas [minU, minV, maxU, maxV] de un volumen. */
export function volumeFootprint(v: Volume): { depthPoint: [number, number]; cells: [number, number, number, number] } {
  switch (v.type) {
    case "building": {
      const [u0, v0, w, d] = v.rect;
      return { depthPoint: [u0 + w, v0 + d], cells: [u0, v0, u0 + w, v0 + d] };
    }
    case "prop": {
      if (v.rect) {
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
    default: {
      const s = ("s" in v ? v.s : 1) ?? 1;
      const r = v.type === "rock" ? 2.1 * s : 1.2 * s;
      return { depthPoint: [v.at[0], v.at[1]], cells: [v.at[0] - r, v.at[1] - r, v.at[0] + r, v.at[1] + r] };
    }
  }
}
