/** Métrica de un volumen en las unidades que consumen sus clientes: la huella
 *  en CELDAS que publica el manifest y la altura en METROS que se levanta.
 *
 *  Módulo propio y no un apartado de `footprint.ts`: estas dos derivan de la
 *  huella analítica (`volumeFootprint`), del radio de colisión
 *  (`volumeSolidDiscRadiusCells`) y de la geometría de las piezas
 *  (`customPartTop`), así que meterlas en `footprint.ts` obligaba a ese
 *  fichero —del que dependen los otros dos— a importarlos de vuelta: dos
 *  ciclos de import por un rincón de fichero. Aquí no depende nadie, así que
 *  puede depender de todos.
 *
 *  Invariante que las une, y por el que tienen test propio
 *  (`test/volume-metrics.test.ts`): la huella que publica el manifest tiene
 *  que CONTENER todo lo que la colisión bloquea. Cuando divergen no se rompe
 *  nada de golpe — el jugador choca con aire, o atraviesa una torre. */

import { volumeSolidDiscRadiusCells } from "./collision.js";
import { volumeFootprint } from "./footprint.js";
import type { Volume } from "./volumes.js";
import { customPartTop } from "../greybox/volume-prims.js";

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
