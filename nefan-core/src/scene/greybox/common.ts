/** Vocabulario COMPARTIDO de los builders greybox 3D (proscenio y tile
 *  oblicuo) — lógica pura, sin three.js. Cada vista tiene su builder y su
 *  versión propia; lo que comparten es el lenguaje de primitivas/luces, el
 *  JSON canónico que gobierna las claves de caché y el mapeo terreno→color. */

import { PALETTE } from "../blueprint/palette.js";

export interface GreyboxPrimitive {
  shape: "box" | "gable" | "cylinder" | "cone" | "polygon";
  /** box/gable: [w, h, d] m (gable: cumbrera a lo largo de d antes de rotY).
   *  cylinder: [r, h, rTop?]. cone: [r, h, segmentos?]. polygon: [grosor]. */
  size: number[];
  /** Posición MUNDO: x centrado, y = BASE de la pieza, z mundo (+z sur).
   *  polygon: los `points` son absolutos y pos solo aporta la y de la base. */
  pos: [number, number, number];
  /** Solo shape "polygon": contorno plano horizontal [x, z][] en unidades de
   *  mundo del builder (metros en proscenio, celdas en el tile). */
  points?: [number, number][];
  rotY?: number;
  color: string;
  roughness?: number;
  cat: "building" | "prop" | "terrain" | "wall" | "tree" | "water" | "decor";
  /** "vol_<id>" del volumen al que pertenece (ausente en decorado). */
  volId?: string;
  noShadow?: boolean;
}

export interface GreyboxLight {
  kind: "sun" | "hemi" | "ambient";
  color: string;
  intensity: number;
  pos?: [number, number, number];
  groundColor?: string;
  castShadow?: boolean;
}

/** Color de suelo por tipo de terreno de la leyenda (matching por
 *  subcadena, la leyenda es texto libre del motor narrativo). null = tipo
 *  desconocido o muro (los muros son volúmenes, no suelo). */
export function groundColorFor(type: string): string | null {
  const t = type.toLowerCase();
  if (t.includes("muro") || t.includes("wall")) return null;
  if (t.includes("water") || t.includes("agua")) return PALETTE.water;
  if (t.includes("bridge") || t.includes("puente")) return PALETTE.woodTop;
  if (t.includes("wood") || t.includes("madera")) return PALETTE.woodTop;
  if (t.includes("stone") || t.includes("piedra") || t.includes("empedrado")) return "#8b8678";
  if (t.includes("path") || t.includes("camino") || t.includes("tierra") || t.includes("dirt")) return "#8f7757";
  if (t.includes("sand") || t.includes("arena")) return "#c2b184";
  if (t.includes("snow") || t.includes("nieve")) return "#dfe5ea";
  if (t.includes("grass") || t.includes("hierba") || t.includes("prado")) return PALETTE.grassBase;
  return null;
}

/** JSON canónico de un spec greybox: claves ordenadas + números redondeados a
 *  1e-4. Su sha256 es la clave de caché del repintado (cliente y servidor). */
export function canonicalGreyboxJson(spec: unknown): string {
  const canon = (v: unknown): unknown => {
    if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const val = (v as Record<string, unknown>)[k];
        if (val !== undefined) out[k] = canon(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(canon(spec));
}
