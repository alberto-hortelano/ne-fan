/** Schema PURO del registro de "estilo aplicado a un juego" — importable
 *  desde el navegador (el batch del título lo construye y el bridge lo
 *  valida). Las operaciones de FS viven en style-application.ts (node). */
import { z } from "zod";

import { SAFE_ID, WORLD_VIEWS } from "./style-categories.js";

export const STYLE_APPLICATION_SCHEMA_VERSION = 1;

export const StyleApplicationRecordSchema = z
  .object({
    schema_version: z.literal(STYLE_APPLICATION_SCHEMA_VERSION),
    game_id: z.string().regex(SAFE_ID),
    view: z.enum(WORLD_VIEWS),
    style_id: z.string().regex(SAFE_ID),
    /** Hash del world.md del snapshot sobre el que corrió el batch. */
    world_doc_hash: z.string().min(1),
    applied_at: z.string().min(1),
    /** Hashes pineados en el asset-store bajo el ref de esta aplicación. */
    pinned_hashes: z.array(z.string().min(1)).max(4096),
    summary: z
      .object({
        pack_generated: z.number().int().min(0),
        atlas_cells_painted: z.number().int().min(0),
        atlas_cells_total: z.number().int().min(0),
        skins_painted: z.number().int().min(0),
        skins_total: z.number().int().min(0),
        cost_usd: z.number().min(0),
      })
      .strict(),
    /** Limitaciones/pendientes REPORTADOS (p. ej. "repintados oblicuos:
     *  se pintan al explorar"). Nunca se omiten en silencio. */
    notes: z.array(z.string()).max(32).default([]),
  })
  .strict();
export type StyleApplicationRecord = z.infer<typeof StyleApplicationRecordSchema>;

/** Ref de pin en el asset-store para una aplicación (game, view, style). */
export function styleApplicationPinRef(gameId: string, view: string, styleId: string): string {
  return `game_style:${gameId}:${view}:${styleId}`;
}
