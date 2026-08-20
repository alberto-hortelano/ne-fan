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


/** Formato de refs de un style pack: vive en style-refs.ts (módulo puro,
 *  importable desde el navegador); aquí se re-exporta lo público. */
import {
  SAFE_ID,
  STYLE_REF_FOLDERS,
  STYLE_REF_ROLE_FPS_SURFACES,
  SUGGESTED_THEME_TAGS,
  WORLD_VIEWS,
  folderForRefFile,
  normalizeTag,
  styleCompatibleWithGame,
  viewForRefFile,
  type StyleRefFolder,
  type WorldView,
} from "./style-refs.js";

/** Tema de UI del pack: módulo puro también (el cliente lo importa). */
import {
  BASE_UI_THEME,
  UiThemeSchema,
  resolveUiTheme,
  type UiTheme,
  type UiThemeInput,
} from "./ui-theme.js";

export {
  BASE_UI_THEME,
  UiThemeSchema,
  resolveUiTheme,
  type UiTheme,
  type UiThemeInput,
};

export {
  SAFE_ID,
  STYLE_REF_FOLDERS,
  STYLE_REF_ROLE_FPS_SURFACES,
  SUGGESTED_THEME_TAGS,
  WORLD_VIEWS,
  folderForRefFile,
  normalizeTag,
  styleCompatibleWithGame,
  viewForRefFile,
  type StyleRefFolder,
  type WorldView,
};

const SafeId = z.string().regex(SAFE_ID, "id must be filesystem-safe (A-Za-z0-9_.-)");

export const GameMetaSchema = z
  .object({
    game_id: SafeId,
    title: z.string().min(1),
    /** 1-2 frases para la tarjeta del título. */
    description: z.string().min(1),
    /** Estilo visual por defecto (el jugador puede cambiarlo al empezar). */
    style_id: SafeId,
    /** Resumen del mundo (~1.200 chars) inyectado en CADA turno del LLM. */
    world_brief: z.string().min(100),
    /** Etiquetas temáticas del mundo (medieval, futurista…): filtran qué
     *  estilos se ofrecen (styleCompatibleWithGame). OPCIONAL: un juego sin
     *  tags (mundos user_* anteriores al campo) es compatible con todo;
     *  develop_world los exige para mundos nuevos. */
    tags: z.array(z.string().min(1)).optional(),
    /** Vista del mundo. "overworld" (default) = plano continuo de tiles;
     *  "proscenium" = escenas discretas tipo plató de cine enlazadas por el
     *  world map (bloque `stage` obligatorio en cada escena); "fps" =
     *  primera persona sobre los mismos tiles (atlas de superficies).
     *  Congelada en el save como el estilo. */
    view: z.enum(WORLD_VIEWS).optional(),
    /** Sistemas de juego intercambiables (registros de src/systems/). Ausente
     *  = defaults (combat: "standard"). La validación semántica del id la
     *  hace el bridge contra el registro — el loader es FS/zod puro. */
    systems: z
      .object({
        combat: SafeId.optional(),
        /** Vida ambiental de NPCs (default "ambient"). */
        npc_behavior: SafeId.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GameMeta = z.infer<typeof GameMetaSchema>;

/** Una imagen de referencia del pack. Sin categorías: el contenido es LIBRE
 *  (una catedral, una estación espacial, un cementerio…) y lo describe
 *  `description`; la vista la declara la CARPETA del archivo. */
export const StyleRefSchema = z
  .object({
    /** Id estable de la ref: lo que emite el motor narrativo al elegirla y
     *  lo que entra en la clave de caché de imagen — renombrarlo repaga
     *  todas las escenas generadas con esta ref; renombrar `file` o
     *  `description` no. */
    id: SafeId,
    /** Ruta relativa al dir del pack, SIEMPRE dentro de la carpeta de su
     *  vista: overworld/ | proscenium/ | fps/ | characters/. */
    file: z.string().min(1),
    /** Qué muestra la imagen, en español y en una frase — es lo que lee el
     *  motor narrativo para elegir la referencia de cada escena. */
    description: z.string().min(1),
    /** Prompt EN de CONTENIDO para (re)generar esta imagen con el builder
     *  (style_pack_builder). Sin él se usa `description` tal cual. */
    gen_scene: z.string().min(1).optional(),
    /** Seed de encuadre de `_plantilla/` (ruta relativa a _plantilla/) para
     *  generarla; sin él, el default de su vista. */
    seed: z.string().min(1).optional(),
    /** Rol especial: "fps_surfaces" = lámina de materiales del atlas fps
     *  (máx 1 por pack, solo en fps/). Fuera del catálogo del motor. */
    role: z.literal(STYLE_REF_ROLE_FPS_SURFACES).optional(),
  })
  .strict();
export type StyleRef = z.infer<typeof StyleRefSchema>;

export const StyleManifestSchema = z
  .object({
    style_id: SafeId,
    name: z.string().min(1),
    description: z.string().min(1),
    /** Token de texto para prompts de imagen (complementa las referencias). */
    style_token: z.string().min(1),
    /** Archivo de portada (raíz del pack) para la title screen. */
    cover: z.string().min(1),
    /** Etiquetas temáticas del estilo (medieval, futurista, oscuro…): se
     *  casan por intersección con las del juego (styleCompatibleWithGame).
     *  Vocabulario libre; SUGGESTED_THEME_TAGS es solo guía. */
    tags: z.array(z.string().min(1)).min(1),
    /** El ORDEN importa: la primera ref de cada vista es el fallback cuando
     *  el motor no elige (o su elección no existe). */
    refs: z.array(StyleRefSchema).default([]),
    /** Tema de la INTERFAZ DE JUEGO (paleta, tipografía, forma). Opcional y
     *  parcial: lo no declarado cae al BASE_UI_THEME. Ver games/ui-theme.ts. */
    ui: UiThemeSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    let laminas = 0;
    for (const [i, ref] of manifest.refs.entries()) {
      if (seen.has(ref.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["refs", i, "id"],
          message: `ref id duplicado "${ref.id}"`,
        });
      }
      seen.add(ref.id);
      const folder = folderForRefFile(ref.file);
      if (!folder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["refs", i, "file"],
          message:
            `ref "${ref.id}": file "${ref.file}" debe vivir en una carpeta ` +
            `de vista (${STYLE_REF_FOLDERS.join("/ | ")}/)`,
        });
      }
      if (ref.role === STYLE_REF_ROLE_FPS_SURFACES) {
        laminas++;
        if (folder !== "fps") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["refs", i, "role"],
            message: `ref "${ref.id}": role fps_surfaces exige carpeta fps/`,
          });
        }
        if (laminas > 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["refs", i, "role"],
            message: "más de una lámina fps_surfaces en el pack",
          });
        }
      }
    }
  });
export type StyleManifest = z.infer<typeof StyleManifestSchema>;

/** Vistas a las que sirve un estilo, DERIVADAS de las carpetas de sus refs
 *  declaradas (no de los archivos en disco — un pack "en construcción" ya
 *  aparece en el selector y el runtime degrada a blueprint-solo mientras
 *  falten imágenes). Las refs de `characters/` no cuentan (compartidas entre
 *  vistas) y la lámina fps_surfaces tampoco (mejora el atlas, no habilita la
 *  vista). `refs: []` → sin vistas: el estilo queda invisible en el
 *  selector. */
export function styleViews(manifest: StyleManifest): WorldView[] {
  const present = new Set<WorldView>();
  for (const ref of manifest.refs) {
    if (ref.role === STYLE_REF_ROLE_FPS_SURFACES) continue;
    const view = viewForRefFile(ref.file);
    if (view) present.add(view);
  }
  // La vista fps se deriva de overworld: su ref propia (la lámina de
  // materiales) es una MEJORA opcional del atlas de superficies — sin ella
  // el atlas degrada a solo style_token, así que ningún pack pierde fps por
  // no tenerla.
  if (present.has("overworld")) present.add("fps");
  return WORLD_VIEWS.filter((v) => present.has(v));
}

/** Refs elegibles por el motor para una vista: las de la carpeta de la vista
 *  (sin la lámina fps_surfaces). La PRIMERA es el fallback sin elección. */
export function styleRefsForView(
  manifest: StyleManifest,
  view: WorldView,
): StyleRef[] {
  return manifest.refs.filter(
    (r) => r.role !== STYLE_REF_ROLE_FPS_SURFACES && viewForRefFile(r.file) === view,
  );
}

/** Refs de personaje del pack (carpeta characters/). La PRIMERA es el
 *  fallback para NPCs sin elección. */
export function styleCharacterRefs(manifest: StyleManifest): StyleRef[] {
  return manifest.refs.filter((r) => folderForRefFile(r.file) === "characters");
}

/** Entrada del listado para la title screen (games_listed). */
export interface GameListing {
  game_id: string;
  title: string;
  description: string;
  style_id: string;
  world_brief: string;
  /** Vista DEFAULT del mundo (game.json, ya resuelta: ausente = overworld).
   *  El selector del título la preselecciona; el jugador puede cambiarla. */
  view: WorldView;
  /** Etiquetas temáticas del mundo ([] = sin declarar, compatible con todo). */
  tags: string[];
}

export interface StyleListing {
  style_id: string;
  name: string;
  description: string;
  /** Ruta servida por el State API del bridge (GET /styles/{id}/{file}),
   *  ausente si el archivo de portada aún no existe en disco. */
  cover_url?: string;
  /** Vistas a las que sirve el estilo (styleViews). El título filtra con esto. */
  views: WorldView[];
  /** Etiquetas temáticas del estilo — el título filtra además por
   *  compatibilidad con las del juego (styleCompatibleWithGame). */
  tags: string[];
  /** Tema de UI RESUELTO (lo declarado en el pack fundido sobre el base): el
   *  título tiñe con él la tarjeta del estilo. */
  ui_theme: UiTheme;
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
        view: meta.view ?? "overworld",
        tags: meta.tags ?? [],
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
    // Directorios de soporte (p. ej. _plantilla) no son estilos.
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    try {
      const manifest = loadStyleManifest(stylesDir, entry.name);
      const coverPath = join(stylesDir, entry.name, manifest.cover);
      const hasCover = existsSync(coverPath) && statSync(coverPath).isFile();
      out.push({
        style_id: manifest.style_id,
        name: manifest.name,
        description: manifest.description,
        cover_url: hasCover ? `/styles/${manifest.style_id}/${manifest.cover}` : undefined,
        views: styleViews(manifest),
        tags: manifest.tags,
        ui_theme: resolveUiTheme(manifest.ui),
      });
    } catch (err) {
      console.warn(
        `listStyles: skipping style "${entry.name}": ${(err as Error).message}`,
      );
    }
  }
  return out.sort((a, b) => a.style_id.localeCompare(b.style_id));
}
