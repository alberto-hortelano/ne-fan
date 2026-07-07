/** Sanitizado de los SVG por capas semánticas del plan de tile.
 *
 *  Formato actual: el motor narrativo emite el arte plano del suelo como
 *  `map_ground` (capas `g#ground` + `g#water`, `g#deck` opcional; celdas de
 *  mundo sin proyectar) y los elementos con altura como `volumes` — el
 *  compositor (`blueprint/`) proyecta ambos a la perspectiva de la sesión.
 *  Este módulo es el espejo TS del validador de ai_server
 *  (`narrative_schemas.py`): lo usa el bridge al persistir un plan corregido
 *  por el retoque de visión — mismo criterio en ambos lados o un SVG aceptado
 *  por uno sería rechazado por el otro. */

/** Capas obligatorias del `map_ground`: SOLO el plano del suelo, sin
 *  proyectar. Los elementos con altura viajan aparte en `volumes` y el
 *  compositor (`blueprint/`) los proyecta a la perspectiva de la sesión.
 *  Existe además una capa opcional `deck` (transitable SOBRE el agua:
 *  puentes, embarcaderos, pasaderas) — la rasterización de colisión la usa
 *  para perforar el agua (destination-out). */
export const GROUND_SVG_LAYERS = ["ground", "water"] as const;

/** Cap de tamaño (bytes UTF-8). Más generoso que terrain_svg (20 KB): un
 *  plano de aldea con interiores cutaway ronda los 10 KB. */
export const MAP_SVG_MAX_BYTES = 32_000;

export type MapSvgResult = { ok: true; svg: string } | { ok: false; error: string };

/** Valida un documento `map_ground` (arte plano del suelo del plan de tile).
 *  `cols`/`rows` es el viewBox esperado (celdas del tile, 128×128). Devuelve
 *  el SVG recortado de espacios o el motivo de rechazo — el caller decide si
 *  degrada (validador de escena) o falla (persistencia de un retoque). */
export function sanitizeGroundSvg(svg: unknown, cols: number, rows: number): MapSvgResult {
  return sanitizeLayeredSvg(svg, cols, rows, GROUND_SVG_LAYERS);
}


function sanitizeLayeredSvg(
  svg: unknown,
  cols: number,
  rows: number,
  layers: readonly string[],
): MapSvgResult {
  if (typeof svg !== "string" || !svg.trim()) {
    return { ok: false, error: "map_ground vacío o no es string" };
  }
  const s = svg.trim();
  if (new TextEncoder().encode(s).length > MAP_SVG_MAX_BYTES) {
    return { ok: false, error: `supera ${MAP_SVG_MAX_BYTES / 1000}KB` };
  }
  if (!s.startsWith("<svg")) return { ok: false, error: "no empieza por <svg" };
  const low = s.toLowerCase();
  if (low.includes("<script") || low.includes("foreignobject") || low.includes("href=")) {
    return { ok: false, error: "contiene script/foreignObject/href" };
  }
  const vb = /viewBox\s*=\s*"([\d.\s-]+)"/.exec(s);
  const parts = vb ? vb[1].trim().split(/\s+/) : [];
  const okViewBox =
    parts.length === 4 &&
    Number(parts[0]) === 0 &&
    Number(parts[1]) === 0 &&
    Math.abs(Number(parts[2]) - cols) < 0.01 &&
    Math.abs(Number(parts[3]) - rows) < 0.01;
  if (!okViewBox) return { ok: false, error: `viewBox debe ser "0 0 ${cols} ${rows}"` };
  const missing = layers.filter(
    (layer) => !s.includes(`id="${layer}"`) && !s.includes(`id='${layer}'`),
  );
  if (missing.length > 0) {
    return { ok: false, error: `faltan capas obligatorias: ${missing.join(", ")}` };
  }
  // Sin xmlns el navegador no decodifica el SVG como imagen (Blob→Image) y
  // DOMParser lo deja fuera del namespace SVG. Los LLM lo omiten a menudo:
  // inyectarlo aquí en vez de rechazar.
  const withNs = s.includes("xmlns=") ? s : s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return { ok: true, svg: withNs };
}
