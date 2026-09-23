/** El MAPPING LOCAL del atlas fps: celda→{url,kind} persistido en
 *  `localStorage` por layoutKey, para que el resume restaure el arte pagado
 *  con SOLO el asset-store arriba (sin remote-gen). Y la descarga de una
 *  imagen del asset-store, que usan las dos vías (mapping y librería).
 *
 *  Sale de `fps-atlas.ts` al darle a este su carril de restauración de
 *  vecinos (#714): el controller decide QUÉ tile recupera qué; esto solo
 *  guarda, lee y descarga. */

import type { AtlasImage } from "../renderer/fps-gl.js";

type CellKind = "tile" | "unique";
type StoredMap = Record<string, { url: string; kind: CellKind }>;

const claveDe = (layoutKey: string): string => `fps_atlas:${layoutKey}`;

/** Best-effort: localStorage lleno/bloqueado no es un error. */
export function guardarMapping(
  layoutKey: string,
  cells: Record<string, { hash: string; url: string }>,
  kindByKey: Map<string, CellKind>,
): void {
  try {
    const entry = Object.fromEntries(
      Object.entries(cells).map(([k, c]) => [k, { url: c.url, kind: kindByKey.get(k) ?? "tile" }]),
    );
    localStorage.setItem(claveDe(layoutKey), JSON.stringify(entry));
  } catch (err) {
    // best-effort, pero visible: sin el mapping, el resume offline degrada.
    console.warn("fps-atlas: mapping local no persistido:", err);
  }
}

/** Las imágenes del mapping de `layoutKey`, descargadas; `null` si no hay
 *  mapping o no está entero (blob podado, asset-store caído), y entonces se
 *  invalida para que el llamante siga por la librería. */
export async function leerMapping(
  layoutKey: string,
  assetsBase: string,
): Promise<Map<string, AtlasImage> | null> {
  let stored: StoredMap | null;
  try {
    const raw = localStorage.getItem(claveDe(layoutKey));
    stored = raw ? (JSON.parse(raw) as StoredMap) : null;
  } catch {
    stored = null;
  }
  if (!stored) return null;
  const images = new Map<string, AtlasImage>();
  try {
    await Promise.all(
      Object.entries(stored).map(async ([cellKey, c]) => {
        const img = await cargarImagen(`${assetsBase}${c.url}`);
        images.set(cellKey, { image: img, kind: c.kind });
      }),
    );
  } catch {
    // Blob podado o asset-store caído: invalidar y seguir por resolve.
    try {
      localStorage.removeItem(claveDe(layoutKey));
    } catch {
      /* best-effort */
    }
    return null;
  }
  return images.size === 0 ? null : images;
}

export function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`no se pudo cargar ${url}`));
    img.src = url;
  });
}
