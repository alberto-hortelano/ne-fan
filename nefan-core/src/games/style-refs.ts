/** Referencias LIBRES de un style pack y compatibilidad estilo↔juego.
 *
 * Módulo PURO (sin node:fs) para que el cliente 2D pueda importarlo en el
 * bundle del navegador; `games/loader.ts` re-exporta lo público.
 *
 * Un pack ya no declara categorías de un enum: declara imágenes LIBRES, cada
 * una con un `id` estable, un archivo dentro de la carpeta de su vista y una
 * `description` en español. El motor narrativo ve ese catálogo
 * (`world.style_refs`) y elige por escena qué referencia acompaña al
 * repintado (`style_ref` en la escena); sin elección se usa la PRIMERA ref de
 * la vista en el orden del manifest (fallback determinista, editable a mano).
 */

/** Vistas de mundo. La vista se elige en el título (game.json aporta el
 *  default del mundo) y queda CONGELADA en el save (`world.view`). */
export const WORLD_VIEWS = ["overworld", "proscenium", "fps"] as const;
export type WorldView = (typeof WORLD_VIEWS)[number];

/** Ids usables como nombre de archivo/clave de caché sin sorpresas (juegos,
 *  estilos, refs, snapshots). */
export const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

/** Carpetas admitidas dentro de un pack: una por vista + `characters/`
 *  (model sheets compartidos entre vistas). La carpeta del archivo ES la
 *  declaración de vista de la ref — no hay campo aparte. */
export const STYLE_REF_FOLDERS = [...WORLD_VIEWS, "characters"] as const;
export type StyleRefFolder = (typeof STYLE_REF_FOLDERS)[number];

/** Rol especial de ref: la lámina de materiales de la vista fps (rejilla de
 *  swatches frontales a 90°). No es una ref temática — alimenta como 2ª
 *  referencia cada página del atlas de superficies, queda FUERA del catálogo
 *  que ve el motor y no admite fallback (sin lámina el atlas degrada a solo
 *  style_token). Máximo una por pack, siempre en `fps/`. */
export const STYLE_REF_ROLE_FPS_SURFACES = "fps_surfaces" as const;

/** Carpeta (= vista o "characters") de una ref por la ruta de su archivo.
 *  `null` si la ruta no cae en ninguna carpeta admitida — el schema del
 *  manifest lo convierte en rechazo fail-loud. */
export function folderForRefFile(file: string): StyleRefFolder | null {
  const slash = file.indexOf("/");
  if (slash <= 0) return null;
  const folder = file.slice(0, slash);
  return (STYLE_REF_FOLDERS as readonly string[]).includes(folder)
    ? (folder as StyleRefFolder)
    : null;
}

/** Vista a la que sirve una ref (las de `characters/` no declaran vista:
 *  se comparten en runtime). */
export function viewForRefFile(file: string): WorldView | null {
  const folder = folderForRefFile(file);
  return folder && folder !== "characters" ? folder : null;
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
