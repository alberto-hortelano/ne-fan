/** Referencias LIBRES de un style pack y compatibilidad estilo↔juego.
 *
 * Módulo PURO (sin node:fs) para que el cliente 2D pueda importarlo en el
 * bundle del navegador; `games/loader.ts` re-exporta lo público.
 *
 * Un pack ya no declara categorías de un enum: declara imágenes LIBRES, cada
 * una con un `id` estable, un archivo dentro de una carpeta del pack y una
 * `description` en español. El motor narrativo ve ese catálogo
 * (`world.style_refs`) y elige la ref de cada NPC (`style_ref`) y la de cada
 * cara de volumen (`surface_ref`); sin elección se usa la PRIMERA ref de la
 * carpeta en el orden del manifest (fallback determinista, editable a mano).
 */

/** Ids usables como nombre de archivo/clave de caché sin sorpresas (juegos,
 *  estilos, refs, snapshots). */
export const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

/** Carpetas admitidas dentro de un pack. NO son vistas de mundo (el juego
 *  tiene UNA vista y no es una elección): son el ROL del contenido —
 *  `fps/` = la lámina de materiales y las refs de cara, `characters/` =
 *  model sheets. `overworld/` y `proscenium/` siguen aquí porque los 5 packs
 *  del repo aún tienen esas imágenes en disco y un manifest que las declara
 *  debe seguir cargando; se borran con ellas. */
export const STYLE_REF_FOLDERS = ["overworld", "proscenium", "fps", "characters"] as const;
export type StyleRefFolder = (typeof STYLE_REF_FOLDERS)[number];

/** Rol especial de ref: la lámina de materiales (rejilla de swatches
 *  frontales a 90°). No es una ref temática — alimenta como 2ª referencia
 *  cada página del atlas de superficies, queda FUERA del catálogo que ve el
 *  motor y no admite fallback (sin lámina el atlas degrada a solo
 *  style_token). Máximo una por pack, siempre en `fps/`. */
export const STYLE_REF_ROLE_FPS_SURFACES = "fps_surfaces" as const;

/** Carpeta de una ref por la ruta de su archivo. `null` si la ruta no cae en
 *  ninguna carpeta admitida — el schema del manifest lo convierte en rechazo
 *  fail-loud. */
export function folderForRefFile(file: string): StyleRefFolder | null {
  const slash = file.indexOf("/");
  if (slash <= 0) return null;
  const folder = file.slice(0, slash);
  return (STYLE_REF_FOLDERS as readonly string[]).includes(folder)
    ? (folder as StyleRefFolder)
    : null;
}

/** Vocabulario SUGERIDO de etiquetas temáticas (chips de la UI y guía de los
 *  prompts). Es una guía, no un enum: estilo y juego declaran tags libres y
 *  se casan por intersección normalizada — un enum cerrado recrearía el
 *  problema de las categorías fijas. */
export const SUGGESTED_THEME_TAGS = [
  "medieval",
  "historico",
  "fantasia",
  "futurista",
  "espacial",
  "moderno",
  "oscuro",
  "luminoso",
  "rural",
  "urbano",
  "marino",
  "cuento",
] as const;

/** Normaliza una etiqueta para el matching: sin diacríticos, minúsculas,
 *  sin espacios sobrantes ("Histórico " ≡ "historico"). */
export function normalizeTag(tag: string): string {
  return tag
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Compatibilidad temática estilo↔juego: intersección de tags normalizados
 *  no vacía. Un juego SIN tags es compatible con todo (mundos de usuario
 *  anteriores al campo); un estilo sin tags no debería existir (el schema
 *  los exige), pero se trata igual de permisivo para no brickear packs a
 *  medio editar. */
export function styleCompatibleWithGame(
  styleTags: readonly string[] | undefined,
  gameTags: readonly string[] | undefined,
): boolean {
  if (!gameTags || gameTags.length === 0) return true;
  if (!styleTags || styleTags.length === 0) return true;
  const game = new Set(gameTags.map(normalizeTag));
  return styleTags.some((t) => game.has(normalizeTag(t)));
}
