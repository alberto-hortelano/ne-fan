/** Paleta del compositor: colores planos por material/especie, validados en
 *  las demos de ambas perspectivas. El blueprint es una guía de layout para
 *  el modelo de imagen — colores legibles y consistentes importan más que la
 *  fidelidad final (Meshy repinta encima).
 *
 *  Convención de luz (iso): caras SO iluminadas, caras SE en sombra. En
 *  topdown solo hay una cara (sur): usa el tono medio. */

export const PALETTE = {
  grassBase: "#547233",
  grassLight: "#5f8039",
  grassDark: "#47612c",
  cobble: "#a29b8b",
  cobbleLight: "#b0a999",
  cobbleDark: "#8f887a",
  dirt: "#a89162",
  dirtDark: "#8a7650",
  stoneTop: "#8b8678",
  stoneFace: "#6e6960", // topdown: única cara / iso: no usado directo
  stoneSW: "#767162",
  stoneSE: "#5f5a50",
  stoneJoint: "#514c43",
  merlon: "#96917f",
  woodTop: "#7c5a36",
  woodWallTop: "#55402a",
  woodFace: "#43301f",
  woodSW: "#5c452c",
  woodSE: "#47341f",
  canopy: "#3a5624",
  canopyLight: "#4c7030",
  canopyDark: "#2e451c",
  trunk: "#5a4228",
  trunkDark: "#48351f",
  water: "#2e6e8e",
  glow: "#efb95a",
  shadow: "#000000",
} as const;

export interface FaceColors {
  /** Superficie superior (techo plano, adarve, tapa). */
  top: string;
  /** Cara iluminada (topdown: la única; iso: SO). */
  lit: string;
  /** Cara en sombra (iso: SE; topdown: no usada). */
  shade: string;
  /** Línea de junta/detalle sobre las caras. */
  joint: string;
}

const WALL_MATERIALS: Record<string, FaceColors> = {
  stone: { top: PALETTE.stoneTop, lit: PALETTE.stoneSW, shade: PALETTE.stoneSE, joint: PALETTE.stoneJoint },
  timber: { top: "#8a7a5c", lit: "#94805e", shade: "#7a6849", joint: "#503c26" },
  wood: { top: PALETTE.woodWallTop, lit: PALETTE.woodSW, shade: PALETTE.woodSE, joint: "#332516" },
  plaster: { top: "#b8ac92", lit: "#c4b89e", shade: "#a3977e", joint: "#8a7f68" },
};

const ROOF_MATERIALS: Record<string, { lit: string; shade: string; line: string }> = {
  slate: { lit: "#557694", shade: "#40596e", line: "#5f80a0" },
  tile: { lit: "#b95a3e", shade: "#96402b", line: "#7e3020" },
  thatch: { lit: "#b09a5e", shade: "#93794a", line: "#7d6638" },
  wood: { lit: "#8a6a44", shade: "#6d5234", line: "#523d24" },
};

export function wallColors(material?: string, override?: string): FaceColors {
  const base = WALL_MATERIALS[material ?? "stone"] ?? WALL_MATERIALS.stone;
  if (!override) return base;
  return { ...base, lit: override, top: override };
}

export function roofColors(material?: string, override?: string): { lit: string; shade: string; line: string } {
  const base = ROOF_MATERIALS[material ?? "tile"] ?? ROOF_MATERIALS.tile;
  if (!override) return base;
  return { ...base, lit: override, shade: override };
}

/** Color base por bioma (fallback cuando el tile no trae `map_ground`). */
export const BIOME_COLORS: Record<string, string> = {
  grass: PALETTE.grassBase,
  forest_floor: "#3d5a2c",
  meadow: "#5d7c38",
  sand: "#cbb87e",
  dirt: "#8f7a52",
  stone: "#8a857a",
  snow: "#d9dde2",
  swamp: "#4a5a38",
};

/** Sombreo relativo: oscurece un hex un factor 0..1. */
export function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - f));
  const g = Math.round(((n >> 8) & 255) * (1 - f));
  const b = Math.round((n & 255) * (1 - f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
