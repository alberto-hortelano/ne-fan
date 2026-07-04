/** Colisión derivada de la IMAGEN IA de un tile — lógica pura compartida.
 *
 *  En el mundo derivado de imagen, los segmentos clasificados como sólidos
 *  por el modelo de visión aportan la colisión real del tile: cada sprite
 *  RGBA recortado lleva su máscara en el canal alpha. Este módulo rasteriza
 *  ese conjunto de máscaras al grid de celdas del tile (mismo shape que
 *  `TerrainGridData`, ver terrain-collision.ts) para reutilizar
 *  `createTerrainCollider` sin código de colisión nuevo.
 *
 *  Convención de coordenadas: la imagen cubre el rect completo del tile
 *  (mapeo lineal 1:1); `imageBbox` posiciona la máscara dentro de la imagen
 *  en píxeles [x, y, w, h]. La celda (col, row) del grid cubre el rect de
 *  píxeles [col·imgW/cols, row·imgH/rows] — con imagen 1024² y grid 128×128,
 *  8×8 px por celda.
 *
 *  Fail-loud: una máscara inconsistente (dims ≤ 0, alpha de tamaño distinto a
 *  width×height, bbox fuera de la imagen) lanza. Sin ninguna celda sólida
 *  devuelve null — el caller se ahorra el collider. */

/** Máscara alpha de un segmento sólido, tal como llega en su sprite RGBA. */
export interface AlphaMask {
  /** Canal alpha del sprite, row-major, width×height valores 0..255. */
  alpha: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** Posición del sprite dentro de la imagen de escena: [x, y, w, h] px.
   *  w/h pueden diferir de width/height (sprite reescalado): se muestrea
   *  con mapeo lineal. */
  imageBbox: [number, number, number, number];
  /** Dimensiones de la imagen de escena completa. */
  imgW: number;
  imgH: number;
}

const SOLID_ALPHA = 128;
export const IMAGE_SOLID_CHAR = "S";

/** Rasteriza las máscaras al grid del tile: una celda es sólida si la
 *  fracción de sus píxeles cubiertos por alpha ≥ 128 alcanza `coverage`.
 *  Devuelve las filas del grid (chars `S`/`g`) o null si no hay ninguna
 *  celda sólida. */
export function solidGridFromMasks(
  masks: AlphaMask[],
  cols: number,
  rows: number,
  coverage = 0.5,
): string[] | null {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    throw new Error(`solidGridFromMasks: grid ${cols}x${rows} inválido`);
  }
  if (!(coverage > 0 && coverage <= 1)) {
    throw new Error(`solidGridFromMasks: coverage ${coverage} fuera de (0, 1]`);
  }
  // Bitmap de píxeles sólidos sobre la imagen: un píxel es sólido si
  // CUALQUIER máscara lo cubre — así las máscaras solapadas no doblan la
  // cobertura de una celda. Se asigna al ver la primera máscara.
  let bitmap: Uint8Array | null = null;
  let imgW = 0;
  let imgH = 0;

  for (const m of masks) {
    if (m.width <= 0 || m.height <= 0) {
      throw new Error(`solidGridFromMasks: máscara ${m.width}x${m.height} inválida`);
    }
    if (m.alpha.length !== m.width * m.height) {
      throw new Error(
        `solidGridFromMasks: alpha de ${m.alpha.length} valores para ${m.width}x${m.height}`,
      );
    }
    const [bx, by, bw, bh] = m.imageBbox;
    if (m.imgW <= 0 || m.imgH <= 0 || bw <= 0 || bh <= 0 ||
        bx < 0 || by < 0 || bx + bw > m.imgW || by + bh > m.imgH) {
      throw new Error(
        `solidGridFromMasks: bbox [${m.imageBbox.join(",")}] fuera de imagen ${m.imgW}x${m.imgH}`,
      );
    }
    if (bitmap === null) {
      imgW = m.imgW;
      imgH = m.imgH;
      bitmap = new Uint8Array(imgW * imgH);
    } else if (m.imgW !== imgW || m.imgH !== imgH) {
      throw new Error(
        `solidGridFromMasks: máscaras de imágenes distintas (${imgW}x${imgH} vs ${m.imgW}x${m.imgH})`,
      );
    }

    // Marca los píxeles de IMAGEN que cubre el bbox. Muestreo del sprite con
    // mapeo lineal bbox→sprite (nearest).
    const x0 = Math.floor(bx);
    const y0 = Math.floor(by);
    const x1 = Math.ceil(bx + bw);
    const y1 = Math.ceil(by + bh);
    for (let py = y0; py < y1; py++) {
      const sy = Math.min(m.height - 1, Math.floor(((py - by) / bh) * m.height));
      if (sy < 0) continue;
      for (let px = x0; px < x1; px++) {
        const sx = Math.min(m.width - 1, Math.floor(((px - bx) / bw) * m.width));
        if (sx < 0) continue;
        if (m.alpha[sy * m.width + sx] < SOLID_ALPHA) continue;
        bitmap[py * imgW + px] = 1;
      }
    }
  }

  if (bitmap === null) return null; // sin máscaras

  // Agrega el bitmap por celda y aplica el umbral de cobertura.
  const solidPx = new Float64Array(cols * rows);
  for (let py = 0; py < imgH; py++) {
    const row = Math.floor((py / imgH) * rows);
    const base = py * imgW;
    for (let px = 0; px < imgW; px++) {
      if (bitmap[base + px] === 0) continue;
      const col = Math.floor((px / imgW) * cols);
      solidPx[row * cols + col] += 1;
    }
  }

  const cellPx = (imgW / cols) * (imgH / rows);
  const threshold = cellPx * coverage;
  let solidCount = 0;
  const gridRows: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const solid = solidPx[r * cols + c] >= threshold;
      if (solid) solidCount++;
      line += solid ? IMAGE_SOLID_CHAR : "g";
    }
    gridRows.push(line);
  }
  return solidCount > 0 ? gridRows : null;
}
