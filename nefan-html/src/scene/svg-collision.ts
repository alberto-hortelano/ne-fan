/** Colisión base derivada del blueprint SVG (`map_svg`).
 *
 *  Rasteriza SOLO las capas que bloquean el paso (`#water` + `#solid`) a un
 *  canvas offscreen, perfora la capa opcional `#deck` (transitable SOBRE el
 *  agua: puentes, embarcaderos) con `destination-out`, y agrega el alpha a un
 *  grid de celdas con `solidGridFromMasks` — el mismo camino que la colisión
 *  derivada de la imagen, así ambas son consistentes por construcción.
 *
 *  Fail-loud: SVG que no parsea o no decodifica → throw (el caller decide si
 *  degrada a la colisión del esquema y lo registra en el ErrorLog). */

import { solidGridFromMasks } from "@nefan-core/src/scene/image-collision.js";
import type { TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { TILE_CELLS, TILE_MPC } from "@nefan-core/src/scene/tile.js";
import type { WorldRect } from "@nefan-core/src/scene/tile.js";

/** Resolución del raster de colisión: 8 px/celda (1024² para 128 celdas),
 *  la misma densidad que el análisis de imagen (imagen 1024² / grid 128). */
const PX_PER_CELL = 8;

/** Capas del map_svg que participan en la colisión. El resto (#ground,
 *  #tall) es visual. */
const BLOCKING_LAYERS = new Set(["water", "solid"]);
const PUNCH_LAYER = "deck";

/** Rasteriza el SVG con solo las capas `visible` mostradas. */
async function rasterizeLayers(
  doc: Document,
  visible: (id: string) => boolean,
  w: number,
  h: number,
): Promise<HTMLImageElement> {
  const root = doc.documentElement.cloneNode(true) as Element;
  for (const g of root.querySelectorAll("g[id]")) {
    if (!visible(g.id)) g.setAttribute("display", "none");
  }
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  const src = new XMLSerializer().serializeToString(root);
  const blob = new Blob([src], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("map_svg no decodifica como imagen"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Elemento que el plano SVG declara (shape con data-label en #solid/#tall),
 *  con su bbox en píxeles de la imagen pintada — guía para el clasificador de
 *  visión del análisis. */
export interface ExpectedElement {
  label: string;
  solid: boolean;
  tall: boolean;
  /** [x, y, w, h] en píxeles de la imagen (imgW×imgH). */
  bbox_px: [number, number, number, number];
}

/** Cap de elementos declarados enviados al clasificador (los mayores). */
const MAX_EXPECTED = 64;

/** Extrae los elementos declarados del map_svg. Necesita el SVG montado en el
 *  DOM (getBBox solo funciona en árboles renderizados): se inserta oculto y
 *  se retira. Un shape que no mide (getBBox lanza) se omite. */
export function expectedElementsFromSvg(
  mapSvg: string,
  imgW: number,
  imgH: number,
): ExpectedElement[] {
  const doc = new DOMParser().parseFromString(mapSvg, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("map_svg no parsea como XML");
  }
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.visibility = "hidden";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "hidden";
  const svgEl = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
  host.appendChild(svgEl);
  document.body.appendChild(host);
  try {
    const sx = imgW / TILE_CELLS;
    const sy = imgH / TILE_CELLS;
    const out: ExpectedElement[] = [];
    for (const layer of ["solid", "tall"] as const) {
      const g = svgEl.querySelector(`g[id="${layer}"]`);
      if (!g) continue;
      for (const el of g.querySelectorAll("[data-label]")) {
        const label = el.getAttribute("data-label")?.trim();
        if (!label) continue;
        let b: DOMRect;
        try {
          b = (el as SVGGraphicsElement).getBBox();
        } catch {
          continue; // shape sin geometría medible
        }
        if (!(b.width > 0) || !(b.height > 0)) continue;
        out.push({
          label,
          solid: layer === "solid",
          tall: layer === "tall",
          bbox_px: [
            Math.round(b.x * sx),
            Math.round(b.y * sy),
            Math.round(b.width * sx),
            Math.round(b.height * sy),
          ],
        });
      }
    }
    out.sort((a, b) => b.bbox_px[2] * b.bbox_px[3] - a.bbox_px[2] * a.bbox_px[3]);
    return out.slice(0, MAX_EXPECTED);
  } finally {
    host.remove();
  }
}

/** Deriva el grid de colisión base del `map_svg` de un tile. Devuelve null si
 *  el SVG no contiene ninguna celda sólida (tile abierto sin agua ni muros). */
export async function svgCollisionGrid(
  mapSvg: string,
  rect: WorldRect,
): Promise<TerrainGridData | null> {
  const doc = new DOMParser().parseFromString(mapSvg, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("map_svg no parsea como XML");
  }
  const w = TILE_CELLS * PX_PER_CELL;
  const h = TILE_CELLS * PX_PER_CELL;

  const blocking = await rasterizeLayers(doc, (id) => BLOCKING_LAYERS.has(id), w, h);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("svgCollisionGrid: sin contexto 2D offscreen");
  ctx.drawImage(blocking, 0, 0, w, h);

  // La pasarela perfora el agua: lo pintado en #deck deja de bloquear.
  const svgText = mapSvg.toLowerCase();
  if (svgText.includes(`id="${PUNCH_LAYER}"`) || svgText.includes(`id='${PUNCH_LAYER}'`)) {
    const deck = await rasterizeLayers(doc, (id) => id === PUNCH_LAYER, w, h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(deck, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  const alpha = new Uint8Array(w * h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];

  const rows = solidGridFromMasks(
    [{ alpha, width: w, height: h, imageBbox: [0, 0, w, h], imgW: w, imgH: h }],
    TILE_CELLS,
    TILE_CELLS,
  );
  if (!rows) return null;
  return {
    grid: rows,
    cols: TILE_CELLS,
    rows: TILE_CELLS,
    meters_per_cell: TILE_MPC,
    origin: [rect.minX, rect.minZ],
    solid_chars: ["S"],
  };
}
