/** Juegos = mundos + estilos visuales (formato canónico).
 *
 * Un juego es `data/games/{game_id}/` con:
 *  - `game.json`  — metadata validada por GameMetaSchema (título, descripción,
 *    estilo por defecto y `world_brief`, el resumen que viaja al LLM en cada
 *    turno).
 *  - `world.md`   — el documento completo del mundo (reinos, razas, magia,
 *    facciones…). Solo se inyecta entero en el bootstrap; después se consulta
 *    bajo demanda vía la tool MCP `world_doc_get`.
 *  - `plugins/`   — manifests de plugins shipped (mecanismo existente).
 *
 * Un estilo es `data/styles/{style_id}/` con `style.json` (StyleManifestSchema)
 * más las imágenes de referencia por categoría que consume ai_server.
 *
 * El listado DEGRADA POR JUEGO: un game.json malformado se omite con warning
 * (con juegos subidos por el usuario, uno roto no puede tumbar el título);
 * cargar un juego concreto para arrancar sesión sigue siendo fail-loud.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Misma regla que InitialSceneCache.pathFor — ids usables como nombre de
 *  archivo/clave de cache sin sorpresas. */
export const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

/** Categorías de referencia de un style pack. Las de entorno las elige el
 *  generador de imagen de escena según lo que pinta; las de personaje, el
 *  generador de sprites según el rol descrito. */
export const STYLE_ENV_CATEGORIES = [
  "nature",
  "settlement",
  "fortress",
  "interior",
  "underground",
] as const;
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

const SafeId = z.string().regex(SAFE_ID, "id must be filesystem-safe (A-Za-z0-9_.-)");

export const GameMetaSchema = z
  .object({
    game_id: SafeId,
    title: z.string().min(1),
    /** 1-2 frases para la tarjeta del título. */
    description: z.string().min(1),
    /** Estilo visual por defecto (el jugador puede cambiarlo al empezar). */
    style_id: SafeId,
    /** Perspectiva 2D por defecto ("topdown" | "isometric"); el jugador puede
     *  cambiarla al empezar. Ausente = "topdown". */
    default_perspective: z.enum(["topdown", "isometric"]).optional(),
    /** Resumen del mundo (~1.200 chars) inyectado en CADA turno del LLM. */
    world_brief: z.string().min(100),
    /** Sistemas de juego intercambiables (registros de src/systems/). Ausente
     *  = defaults (combat: "standard"). La validación semántica del id la
     *  hace el bridge contra el registro — el loader es FS/zod puro. */
    systems: z
      .object({
        combat: SafeId.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GameMeta = z.infer<typeof GameMetaSchema>;

export const StyleManifestSchema = z
  .object({
    style_id: SafeId,
    name: z.string().min(1),
    description: z.string().min(1),
    /** Token de texto para prompts de imagen (complementa las referencias). */
    style_token: z.string().min(1),
    /** Archivo de portada (relativo al dir del estilo) para la title screen. */
    cover: z.string().min(1),
    refs: z
      .array(
        z
          .object({
            category: z.enum(STYLE_CATEGORIES),
            file: z.string().min(1),
            tags: z.array(z.string()).default([]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type StyleManifest = z.infer<typeof StyleManifestSchema>;

/** Entrada del listado para la title screen (games_listed). */
export interface GameListing {
  game_id: string;
  title: string;
  description: string;
  style_id: string;
  world_brief: string;
}

export interface StyleListing {
  style_id: string;
  name: string;
  description: string;
  /** Ruta servida por el State API del bridge (GET /styles/{id}/{file}),
   *  ausente si el archivo de portada aún no existe en disco. */
  cover_url?: string;
}

/** Carga y valida `game.json` + presencia de `world.md`. Fail-loud: se usa al
 *  arrancar sesión, donde un juego roto debe abortar con motivo. */
export function loadGameMeta(gamesDir: string, gameId: string): GameMeta {
  if (!SAFE_ID.test(gameId)) {
    throw new Error(`loadGameMeta: unsafe gameId "${gameId}"`);
  }
  const dir = join(gamesDir, gameId);
  const metaPath = join(dir, "game.json");
  if (!existsSync(metaPath)) {
    throw new Error(`game.json not found for game "${gameId}" (${metaPath})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch (err) {
    throw new Error(`game.json malformed (${metaPath}): ${(err as Error).message}`, {
      cause: err,
    });
  }
  const meta = GameMetaSchema.parse(raw);
  if (meta.game_id !== gameId) {
    throw new Error(
      `game.json game_id "${meta.game_id}" does not match its directory "${gameId}"`,
    );
  }
  if (!existsSync(join(dir, "world.md"))) {
    throw new Error(`world.md not found for game "${gameId}"`);
  }
  return meta;
}

/** Documento completo del mundo. Fail-loud (mismo contrato que loadGameMeta). */
export function loadWorldDoc(gamesDir: string, gameId: string): string {
  if (!SAFE_ID.test(gameId)) {
    throw new Error(`loadWorldDoc: unsafe gameId "${gameId}"`);
  }
  return readFileSync(join(gamesDir, gameId, "world.md"), "utf-8");
}

/** Carga y valida `style.json`. Fail-loud. */
export function loadStyleManifest(stylesDir: string, styleId: string): StyleManifest {
  if (!SAFE_ID.test(styleId)) {
    throw new Error(`loadStyleManifest: unsafe styleId "${styleId}"`);
  }
  const path = join(stylesDir, styleId, "style.json");
  if (!existsSync(path)) {
    throw new Error(`style.json not found for style "${styleId}" (${path})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`style.json malformed (${path}): ${(err as Error).message}`, {
      cause: err,
    });
  }
  const manifest = StyleManifestSchema.parse(raw);
  if (manifest.style_id !== styleId) {
    throw new Error(
      `style.json style_id "${manifest.style_id}" does not match its directory "${styleId}"`,
    );
  }
  return manifest;
}

/** Lista los juegos disponibles DEGRADANDO POR JUEGO: uno malformado se omite
 *  con warning en vez de tumbar el listado entero. Directorio ausente sí es
 *  error (config rota, no contenido roto). */
export function listGames(gamesDir: string): GameListing[] {
  if (!existsSync(gamesDir)) {
    throw new Error(`games directory not found: ${gamesDir}`);
  }
  const out: GameListing[] = [];
  for (const entry of readdirSync(gamesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = loadGameMeta(gamesDir, entry.name);
      out.push({
        game_id: meta.game_id,
        title: meta.title,
        description: meta.description,
        style_id: meta.style_id,
        world_brief: meta.world_brief,
      });
    } catch (err) {
      console.warn(
        `listGames: skipping game "${entry.name}": ${(err as Error).message}`,
      );
    }
  }
  return out.sort((a, b) => a.game_id.localeCompare(b.game_id));
}

/** Lista los estilos disponibles, degradando por estilo (mismo criterio que
 *  listGames). `cover_url` solo si el archivo existe en disco. */
export function listStyles(stylesDir: string): StyleListing[] {
  if (!existsSync(stylesDir)) {
    throw new Error(`styles directory not found: ${stylesDir}`);
  }
  const out: StyleListing[] = [];
  for (const entry of readdirSync(stylesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = loadStyleManifest(stylesDir, entry.name);
      const coverPath = join(stylesDir, entry.name, manifest.cover);
      const hasCover = existsSync(coverPath) && statSync(coverPath).isFile();
      out.push({
        style_id: manifest.style_id,
        name: manifest.name,
        description: manifest.description,
        cover_url: hasCover ? `/styles/${manifest.style_id}/${manifest.cover}` : undefined,
      });
    } catch (err) {
      console.warn(
        `listStyles: skipping style "${entry.name}": ${(err as Error).message}`,
      );
    }
  }
  return out.sort((a, b) => a.style_id.localeCompare(b.style_id));
}
