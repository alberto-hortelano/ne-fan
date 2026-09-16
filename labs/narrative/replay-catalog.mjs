// @ts-check
/** El replay no inventa mundos ni estilos ausentes de la grabación (#317).
 * El schema está comprobado contra el wire: añadir un campo obligatorio al
 * título obliga a revisar esta puerta durante typecheck:labs. */
import { z } from "../../nefan-core/node_modules/zod/index.js";

/** @type {z.ZodType<Omit<import('../../nefan-core/src/protocol/messages.js').GamesListedMessage, 'requestId'>>} */
const Catalogo = z.object({
  type: z.literal("games_listed"),
  error: z.string().optional(),
  games: z.array(z.object({
    game_id: z.string(), title: z.string(), description: z.string(), style_id: z.string(), world_brief: z.string(),
    tags: z.array(z.string()), generation: z.enum(["ready", "stale", "missing"]),
    styles_applied: z.array(z.object({ style_id: z.string(), status: z.enum(["ready", "stale"]) })),
    escenas: z.object({ servibles: z.number(), total: z.number() }).optional(),
  })),
  styles: z.array(z.object({
    style_id: z.string(), name: z.string(), description: z.string(), tags: z.array(z.string()), cover_url: z.string().optional(),
    ui_theme: z.object({
      surface: z.string(), raised: z.string(), border: z.string(), ink: z.string(), ink_dim: z.string(),
      accent: z.string(), accent_ink: z.string(), danger: z.string(), fade: z.string(), font: z.string(), font_display: z.string(),
      radius_px: z.number(), hairline_px: z.number(), tracking_em: z.number(), glow: z.boolean(),
    }),
  })),
});

/** @param {unknown} grabado @param {string} archivo */
export function catalogoDeReplay(grabado, archivo) {
  const resultado = Catalogo.safeParse(grabado);
  if (resultado.success) return resultado.data;
  const campos = resultado.error.issues.map(i => i.path.join(".") || "games_listed").join(", ");
  return {
    type: /** @type {const} */ ("games_listed"), games: [], styles: [],
    error: `La grabación «${archivo}» no contiene un catálogo compatible: falta o no es válido ${campos}. Graba una sesión con esta versión para reproducirla.`,
  };
}

/** @param {string} tipo @param {string} archivo
 * @returns {Omit<import('../../nefan-core/src/protocol/messages.js').GamesListedMessage, 'requestId'> | Omit<import('../../nefan-core/src/protocol/messages.js').SessionsListedMessage, 'requestId'> | Omit<import('../../nefan-core/src/protocol/messages.js').SessionDeletedMessage, 'requestId'> | null} */
export function respuestaNoGrabada(tipo, archivo) {
  switch (tipo) {
    case "games_listed": return catalogoDeReplay(undefined, archivo);
    case "sessions_listed": return { type: "sessions_listed", sessions: [] };
    case "session_deleted": return { type: "session_deleted", outcome: "deleted" };
    default: return null;
  }
}
