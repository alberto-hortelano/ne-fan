/** Categorías de referencia de un style pack y selección por tile.
 *
 * Módulo PURO (sin node:fs) para que el cliente 2D pueda importarlo en el
 * bundle del navegador; `games/loader.ts` re-exporta las constantes.
 *
 * Cada categoría de entorno es una ZONA de mundo abierto: la imagen de
 * referencia debe ser una escena completa con varios elementos y transiciones
 * hacia las zonas vecinas (ver data/styles/README.md), no un sujeto aislado.
 * Espejos y candados: el codegen (`npm run gen:contract`) emite
 * data/contract/style_categories.json desde estas constantes; el lado Python
 * tiene UNA fuente (ai_server/style_categories.py — style_packs,
 * narrative_schemas y remote_generation derivan de ella) candada contra ese
 * JSON por ai_server/tests/test_style_categories_sync.py. Los enums en prosa
 * de world_rules.md/stage_instructions.md y el tool generate_scene.json los
 * canda contract-prompts.test.ts.
 */

/** Vistas de mundo. La vista se elige en el título (game.json aporta el
 *  default del mundo) y queda CONGELADA en el save (`world.view`).
 *  "fps" (primera persona, tiles en 3D con atlas de superficies) no tiene
 *  categorías de ref propias: comparte las zonas cenitales de overworld
 *  (el prompt del atlas es material-first y solo necesita paleta), así que
 *  viewForCategory NUNCA la devuelve — styleViews la deriva de overworld. */
export const WORLD_VIEWS = ["overworld", "proscenium", "fps"] as const;
export type WorldView = (typeof WORLD_VIEWS)[number];

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

/** Categorías de PLATÓ (vista proscenio): referencias a nivel de suelo,
 *  cámara al sur mirando al norte. Namespace propio con prefijo `stage_` — el
 *  nombre ya codifica la vista (viewForCategory) y el fallback del resolver
 *  NUNCA cruza a las zonas cenitales (una ref aérea contamina el repintado
 *  ground-level del plató). */
export const STYLE_STAGE_CATEGORIES = [
  "stage_interior",
  "stage_street",
  "stage_plaza",
  "stage_nature",
  "stage_harbor",
  "stage_gate",
] as const;
export type StyleStageCategory = (typeof STYLE_STAGE_CATEGORIES)[number];

export const STYLE_CATEGORIES = [
  ...STYLE_ENV_CATEGORIES,
  ...STYLE_CHARACTER_CATEGORIES,
] as const;
export type StyleCategory = (typeof STYLE_CATEGORIES)[number];

/** Alias legacy: packs y escenas anteriores usaban "nature". `satisfies`
 *  conserva las claves literales (LegacyStyleTag) sin perder el chequeo del
 *  valor. */
export const LEGACY_STYLE_ALIASES = {
  nature: "forest",
} as const satisfies Record<string, StyleEnvCategory>;
export type LegacyStyleTag = keyof typeof LEGACY_STYLE_ALIASES;

/** Categorías admitidas en style.json: las canónicas + plató + alias legacy,
 *  para que un pack de usuario anterior al set de zonas siga cargando. */
export const STYLE_MANIFEST_CATEGORIES = [
  ...STYLE_CATEGORIES,
  ...STYLE_STAGE_CATEGORIES,
  ...(Object.keys(LEGACY_STYLE_ALIASES) as LegacyStyleTag[]),
] as const;

/** Vista a la que pertenece una categoría de ref: el namespace manda
 *  (`stage_*` → proscenium). Las categorías de personaje cuentan como
 *  overworld a efectos de declaración — los model sheets se comparten entre
 *  vistas en runtime. */
export function viewForCategory(category: string): WorldView {
  return category.startsWith("stage_") ? "proscenium" : "overworld";
}

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
  const tag = (LEGACY_STYLE_ALIASES as Record<string, StyleEnvCategory>)[raw] ?? raw;
  const known = (STYLE_ENV_CATEGORIES as readonly string[]).includes(tag)
    ? (tag as StyleEnvCategory)
    : undefined;
  const fromBiome = biome ? BIOME_TO_STYLE[biome] : undefined;
  if (known && !NATURAL_CATEGORIES.has(known)) return known;
  return fromBiome ?? known ?? "";
}

/** Zona cenital → categoría de plató más cercana. Red de seguridad para
 *  escenas proscenio cuyo `style_tag` sigue en vocabulario de zona (motor
 *  legacy, fixtures viejas). Espejo Python: ai_server/style_packs.py. */
export const ZONE_TO_STAGE: Record<string, StyleStageCategory> = {
  interior: "stage_interior",
  underground: "stage_interior",
  settlement: "stage_street",
  farmland: "stage_street",
  fortress: "stage_gate",
  forest: "stage_nature",
  wetland: "stage_nature",
  desert: "stage_nature",
  snow: "stage_nature",
  nature: "stage_nature",
};

/** Categoría de plató efectiva para una escena proscenio.
 *
 *  - `styleTag`: lo que etiquetó el motor narrativo (puede ser ya `stage_*`,
 *    una zona cenital legacy, desconocido o faltar).
 *  - `fourthWall`: la escena tiene cuarta pared (interior de plató).
 *
 *  Devuelve "" cuando no hay información — el servidor aplica su default. */
export function stageCategoryForScene(
  styleTag: string | undefined,
  fourthWall: boolean,
): StyleStageCategory | "" {
  const raw = styleTag ?? "";
  if ((STYLE_STAGE_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as StyleStageCategory;
  }
  const mapped = ZONE_TO_STAGE[raw];
  if (mapped) return mapped;
  if (fourthWall) return "stage_interior";
  return "";
}
