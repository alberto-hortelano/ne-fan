/** Huella analítica de un volumen — la fuente ÚNICA de colisión, orden del
 *  pintor y manifest: siempre la huella DECLARADA en celdas de mundo, nunca
 *  los píxeles pintados. */

import type { Volume } from "./volumes.js";

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
