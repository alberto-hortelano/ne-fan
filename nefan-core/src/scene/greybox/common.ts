/** Vocabulario COMPARTIDO de los builders greybox 3D — lógica pura, sin
 *  three.js: el lenguaje de primitivas y luces, y el JSON canónico que
 *  gobierna las claves de caché.
 *
 *  Aquí vivía además `groundColorFor` (char del grid → color de suelo),
 *  cuyo único consumidor era el builder del PLATÓ: murió con él. El suelo del
 *  tile se colorea desde `GROUND_MATERIAL_COLORS` (blueprint/ground-prims.ts),
 *  que es otra tabla y sigue viva. */

import type { GroundLayer } from "../blueprint/ground.js";

export interface GreyboxPrimitive {
  shape: "box" | "gable" | "cylinder" | "cone" | "polygon" | "sphere";
  /** box/gable: [w, h, d] m (gable: cumbrera a lo largo de d antes de rotY).
   *  cylinder: [r, h, rTop?]. cone: [r, h, segmentos?]. polygon: [grosor].
   *  sphere: [r, segmentos?] — como el resto, pos.y es la BASE (centro a +r). */
  size: number[];
  /** Posición MUNDO: x centrado, y = BASE de la pieza, z mundo (+z sur).
   *  polygon: los `points` son absolutos y pos solo aporta la y de la base. */
  pos: [number, number, number];
  /** Solo shape "polygon": contorno plano horizontal [x, z][] en unidades de
   *  mundo del builder (metros en proscenio, celdas en el tile). */
  points?: [number, number][];
  rotY?: number;
  /** Rotación sobre X tras rotY (cilindro tumbado con el eje en Z: ruedas). */
  rotX?: number;
  /** Rotación sobre Z (cilindro tumbado con el eje en X: toldos, troncos
   *  caídos). Solo la emiten los volúmenes custom y el scatter (fps). */
  rotZ?: number;
  /** Escala no uniforme del mesh (esferas achatadas de matorral/roca). La
   *  base sigue en pos.y (la geometría se ancla en y=0 antes de escalar).
   *  Solo la emite la vista fps (detalle/scatter) — los builders cenitales
   *  no la usan y sus specs canónicos (claves de caché) no cambian. */
  scale?: [number, number, number];
  color: string;
  roughness?: number;
  cat: "building" | "prop" | "terrain" | "wall" | "tree" | "water" | "decor";
  /** "vol_<id>" del volumen al que pertenece (ausente en decorado). */
  volId?: string;
  noShadow?: boolean;
  /** CAPA plana del suelo de la que sale esta prim. **Solo la escribe
   *  `groundFeaturePrims`**, y la escribe en TODAS las que emite: es la marca
   *  que dice "esto es suelo", en vez de adivinarlo después por su cota.
   *
   *  Adivinarlo era el agujero: el post-proceso fps olfateaba `cat` + `y` en
   *  una banda, así que una capa por encima del deck se quedaba FUERA —ni
   *  calco (enterraba lo que se dibuja encima) ni medida por el candado del
   *  techo (issue #185, hallazgo H1 de QA)—. Marcada en origen, el alcance del
   *  candado no depende de a qué altura viva la capa. */
  groundLayer?: GroundLayer;
}

export interface GreyboxLight {
  kind: "sun" | "hemi" | "ambient" | "point";
  color: string;
  intensity: number;
  pos?: [number, number, number];
  groundColor?: string;
  castShadow?: boolean;
  /** Solo "point": alcance en metros (0/ausente = infinito) y decaimiento. */
  distance?: number;
  decay?: number;
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
