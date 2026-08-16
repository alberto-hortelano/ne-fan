/** Ambientación del tile fps — post-proceso FPS-ONLY (no toca el builder
 *  compartido ni la caché cenital).
 *
 *  El motor narrativo NO declara campos de luz: la hora del día se INFIERE de
 *  su `scene_description` (el mismo inferidor del proscenio — "cae la tarde
 *  sobre el lindero" atardece de verdad) y los volúmenes cuyo label nombra
 *  fuego o lámpara (farol, vela, chimenea, lamparilla…) emiten un punto
 *  cálido al caer la luz. De DÍA no se toca nada: luces, cielo y niebla son
 *  EXACTAMENTE las históricas (cero regresión, hashes y capturas intactos). */

import { seededRng, uniform } from "../../rng.js";
import { PRACTICAL_LIGHT_RE, timeOfDayFromText, volumeFootprintCells, volumeHeightM, type TimeOfDay } from "../stage/greybox.js";
import { TILE_MPC } from "../tile.js";
import type { GreyboxLight } from "../greybox/common.js";
import type { Volume } from "./volumes.js";

export interface FpsAmbience {
  timeOfDay: TimeOfDay;
  /** Luces en METROS que sustituyen a las históricas (solo si tod ≠ dia). */
  lightsM?: GreyboxLight[];
  /** Prácticas de INTERIOR (volúmenes de luz dentro de un cutaway): se añaden
   *  SIEMPRE, también de día — un interior sin su lámpara es un quirófano. */
  extraM?: GreyboxLight[];
  /** Cielo del domo {top,bottom} — ausente = constantes del renderer. */
  sky?: { top: string; bottom: string };
  /** Niebla — ausente = constantes del renderer. */
  fog?: { color: string; near: number; far: number };
}

/** Presets exteriores por hora (paleta del plató, azimut del sol fps fijo al
 *  SO como el histórico para que las sombras sigan leyendo igual). */
const PRESET: Record<Exclude<TimeOfDay, "dia">, {
  sun: string; sunI: number; elev: number;
  hemi: string; ground: string; hemiI: number;
  ambient?: { color: string; intensity: number };
  sky: { top: string; bottom: string };
  fogColor: string;
}> = {
  amanecer: {
    sun: "#ffd9a0", sunI: 1.9, elev: 20,
    hemi: "#a8b4cc", ground: "#7a6a58", hemiI: 0.9,
    sky: { top: "#7a88aa", bottom: "#e4cca8" },
    fogColor: "#d8c8b0",
  },
  atardecer: {
    sun: "#ffb36b", sunI: 2.0, elev: 16,
    hemi: "#9a86a0", ground: "#8a6a4a", hemiI: 1.3,
    sky: { top: "#6a6488", bottom: "#d8ac84" },
    fogColor: "#c39a74",
  },
  noche: {
    sun: "#9ab0d8", sunI: 0.7, elev: 45,
    hemi: "#4a5878", ground: "#2e3040", hemiI: 0.8,
    ambient: { color: "#30405c", intensity: 0.45 },
    sky: { top: "#101828", bottom: "#2e3e5e" },
    fogColor: "#223048",
  },
};

/** Ambientación del tile: hora inferida del texto + luces/cielo/niebla y
 *  prácticas por label. `lightsM` ausente ⇒ el renderer usa lo histórico. */
/** Punto cálido de práctica sobre un volumen (posición en metros). */
function practicalLight(v: Volume): GreyboxLight | null {
  const fp = volumeFootprintCells(v);
  if (!fp) return null;
  const hM = volumeHeightM(v, TILE_MPC);
  return {
    kind: "point",
    color: "#ff9b4a",
    intensity: 14,
    pos: [(fp[0] + fp[2] / 2) * TILE_MPC, Math.min(Math.max(hM * 0.7, 0.6), 2.4), (fp[1] + fp[3] / 2) * TILE_MPC],
    distance: 10,
    decay: 1.8,
  };
}

function hasLightLabel(v: Volume): boolean {
  const texts = [v.label ?? ""];
  if (v.type === "custom") for (const part of v.parts) texts.push(part.desc ?? "");
  return texts.some((t) => PRACTICAL_LIGHT_RE.test(t));
}

export function buildFpsAmbience(
  sceneDescription: string | undefined,
  volumes: Volume[],
  seedKey: string,
): FpsAmbience {
  const timeOfDay = timeOfDayFromText(sceneDescription ?? "");
  // Prácticas de INTERIOR: volúmenes de luz cuyo centro cae en la huella de
  // un building cutaway — encendidas SIEMPRE (dentro no llega el sol).
  const cutRects = volumes
    .filter((v): v is Extract<Volume, { type: "building" }> => v.type === "building" && v.cutaway === true)
    .map((v) => v.rect);
  const isInterior = (v: Volume): boolean => {
    const fp = volumeFootprintCells(v);
    if (!fp) return false;
    const cx = fp[0] + fp[2] / 2;
    const cz = fp[1] + fp[3] / 2;
    return cutRects.some(([u0, v0, w, d]) => cx >= u0 && cx <= u0 + w && cz >= v0 && cz <= v0 + d);
  };
  const extraM: GreyboxLight[] = [];
  for (const v of volumes) {
    if (extraM.length >= 4) break;
    if (v.type === "building" || !hasLightLabel(v) || !isInterior(v)) continue;
    const l = practicalLight(v);
    if (l) extraM.push(l);
  }
  if (timeOfDay === "dia") return { timeOfDay, extraM: extraM.length ? extraM : undefined };
  const p = PRESET[timeOfDay];
  const rng = seededRng(`fps-amb:${seedKey}`);
  const lightsM: GreyboxLight[] = [];
  lightsM.push({ kind: "hemi", color: p.hemi, groundColor: p.ground, intensity: p.hemiI });
  if (p.ambient) lightsM.push({ kind: "ambient", color: p.ambient.color, intensity: p.ambient.intensity });
  // Sol/luna: azimut SO histórico (pos [-80,140,220] celdas ≈ SO alto), con
  // la elevación del preset.
  const az = Math.atan2(-80, 220) + uniform(rng, -0.15, 0.15);
  const dist = 160;
  const elevRad = (p.elev * Math.PI) / 180;
  lightsM.push({
    kind: "sun",
    color: p.sun,
    intensity: p.sunI,
    pos: [Math.sin(az) * dist, Math.tan(elevRad) * dist, Math.cos(az) * dist],
    castShadow: true,
  });
  // Prácticas exteriores: labels de fuego/lámpara (volúmenes y piezas
  // custom) — cap 8; las de interior ya van en extraM (siempre encendidas).
  let practicals = 0;
  for (const v of volumes) {
    if (practicals >= 8) break;
    if (v.type === "building" || !hasLightLabel(v) || isInterior(v)) continue;
    const l = practicalLight(v);
    if (!l) continue;
    lightsM.push(l);
    practicals += 1;
  }
  return {
    timeOfDay,
    lightsM,
    extraM: extraM.length ? extraM : undefined,
    sky: p.sky,
    fog: { color: p.fogColor, near: 20, far: timeOfDay === "noche" ? 70 : 90 },
  };
}
