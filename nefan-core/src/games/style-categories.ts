/** Categorías de referencia de un style pack y selección por tile.
 *
 * Módulo PURO (sin node:fs) para que el cliente 2D pueda importarlo en el
 * bundle del navegador; `games/loader.ts` re-exporta las constantes.
 *
 * Cada categoría de entorno es una ZONA de mundo abierto: la imagen de
 * referencia debe ser una escena completa con varios elementos y transiciones
 * hacia las zonas vecinas (ver data/styles/README.md), no un sujeto aislado.
 * Espejos que deben mantenerse sincronizados: ai_server/style_packs.py
 * (ENV_CATEGORIES), ai_server/narrative_schemas.py (_valid_style_tags),
 * ai_server/routers/generation.py (regex de style_tag) y
 * data/contract/prompts/world_rules.md (enum en prosa para el LLM).
 */

export const STYLE_ENV_CATEGORIES = [
  "settlement",
  "farmland",
  "forest",
  "wetland",
  "desert",
  "snow",
  "fortress",
  "interior",
  "underground",
] as const;
export type StyleEnvCategory = (typeof STYLE_ENV_CATEGORIES)[number];

export const STYLE_CHARACTER_CATEGORIES = [
  "character_commoner",
  "character_noble",
  "character_warrior",
] as const;

export const STYLE_CATEGORIES = [
  ...STYLE_ENV_CATEGORIES,
  ...STYLE_CHARACTER_CATEGORIES,
] as const;
export type StyleCategory = (typeof STYLE_CATEGORIES)[number];

/** Alias legacy: packs y escenas anteriores usaban "nature". */
export const LEGACY_STYLE_ALIASES: Record<string, StyleEnvCategory> = {
  nature: "forest",
};

/** Categorías admitidas en style.json: las canónicas + alias legacy, para que
 *  un pack de usuario anterior al set de zonas siga cargando. */
export const STYLE_MANIFEST_CATEGORIES = [
  ...STYLE_CATEGORIES,
  ...(Object.keys(LEGACY_STYLE_ALIASES) as ["nature"]),
] as const;

/** Bioma del tile (tile.ts BIOME_CATALOG) → zona de estilo más cercana.
 *  grass/meadow/stone caen en forest porque su referencia incluye claros,
 *  praderas y rocas; dirt se lee como campo trabajado. */
const BIOME_TO_STYLE: Record<string, StyleEnvCategory> = {
  grass: "forest",
  forest_floor: "forest",
  meadow: "forest",
  stone: "forest",
  dirt: "farmland",
  sand: "desert",
  snow: "snow",
  swamp: "wetland",
};

/** Zonas "naturales": el bioma real del tile las afina (una escena etiquetada
 *  forest puede tener tiles de pantano en su borde). Las construidas o
 *  interiores mandan siempre — sus referencias ya contienen la transición al
 *  entorno. */
const NATURAL_CATEGORIES: ReadonlySet<string> = new Set([
  "forest",
  "wetland",
  "desert",
  "snow",
]);

/** Categoría de referencia de estilo efectiva para un tile.
 *
 *  - `styleTag`: lo que etiquetó el motor narrativo para la escena/tile
 *    (puede ser legacy "nature", desconocido o faltar).
 *  - `biome`: bioma dominante del tile (Format D v3).
 *
 *  Devuelve "" cuando no hay información — el servidor aplica su default. */
export function styleCategoryForTile(
  styleTag: string | undefined,
  biome: string | undefined,
): StyleEnvCategory | "" {
  const raw = styleTag ?? "";
  const tag = LEGACY_STYLE_ALIASES[raw] ?? raw;
  const known = (STYLE_ENV_CATEGORIES as readonly string[]).includes(tag)
    ? (tag as StyleEnvCategory)
    : undefined;
  const fromBiome = biome ? BIOME_TO_STYLE[biome] : undefined;
  if (known && !NATURAL_CATEGORIES.has(known)) return known;
  return fromBiome ?? known ?? "";
}
