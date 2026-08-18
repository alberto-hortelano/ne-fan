/** Vocabulario canónico del mundo — descripciones reutilizables que el motor
 *  narrativo declara en la génesis del juego (tool MCP vocabulary_set durante
 *  generate_game) y que los turnos de tile/realize reciben como contexto.
 *
 *  Para qué existe: las cachés de assets estilizados se indexan POR
 *  DESCRIPCIÓN (+estilo) — celdas hero del atlas de superficies, skins de
 *  personaje. Si el mundo fija sus fachadas/props/arquetipos canónicos una
 *  vez, cada tile que los reutilice verbatim es un cache-hit en vez de una
 *  imagen nueva. El reuso es OPCIONAL para el motor (mismo contrato que
 *  available_assets), nunca forzado.
 *
 *  Vive en `data/games/{id}/world/vocabulary.json`, hermano de los snapshots
 *  de rama, con la misma política de staleness (world_doc_hash). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { SAFE_ID } from "./loader.js";

export const WORLD_VOCABULARY_SCHEMA_VERSION = 1;
export const MAX_VOCABULARY_ENTRIES = 64;

export const VocabularyEntrySchema = z
  .object({
    /** Slug estable, p. ej. "fachada_encalada" o "guardia_del_puerto". */
    id: z.string().regex(SAFE_ID).max(64),
    /** "surface" = descripción de material/fachada/prop (celdas hero del
     *  atlas); "character" = arquetipo de personaje (skins). */
    kind: z.enum(["surface", "character"]),
    /** La descripción CANÓNICA, tal cual se reutilizará en surface_desc o
     *  como prompt de skin (en el idioma que pidan esos campos). */
    desc: z.string().min(8).max(300),
    /** Solo characters: roles del mundo a los que sirve el arquetipo. */
    roles: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>;

export const WorldVocabularySchema = z
  .object({
    schema_version: z.literal(WORLD_VOCABULARY_SCHEMA_VERSION),
    game_id: z.string().regex(SAFE_ID),
    world_doc_hash: z.string().min(1),
    generated_at: z.string().min(1),
    entries: z.array(VocabularyEntrySchema).max(MAX_VOCABULARY_ENTRIES),
  })
  .strict()
  .superRefine((vocab, ctx) => {
    const seen = new Set<string>();
    for (const e of vocab.entries) {
      if (seen.has(e.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `entry id duplicado "${e.id}"` });
      }
      seen.add(e.id);
    }
  });
export type WorldVocabulary = z.infer<typeof WorldVocabularySchema>;

export function worldVocabularyPath(gamesDir: string, gameId: string): string {
  if (!SAFE_ID.test(gameId)) {
    throw new Error(`worldVocabularyPath: unsafe gameId "${gameId}"`);
  }
  return join(gamesDir, gameId, "world", "vocabulary.json");
}

/** Carga el vocabulario. Ausente → null; malformado → throw (fail-loud);
 *  world_doc_hash distinto del esperado → null + warn (stale: las
 *  descripciones canónicas de un world.md viejo no deben guiar tiles del
 *  nuevo). */
export function loadWorldVocabulary(
  gamesDir: string,
  gameId: string,
  expectedWorldDocHash: string,
): WorldVocabulary | null {
  const path = worldVocabularyPath(gamesDir, gameId);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`world vocabulary malformado (${path}): ${(err as Error).message}`, {
      cause: err,
    });
  }
  const parsed = WorldVocabularySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `world vocabulary inválido (${path}): ${parsed.error.message.slice(0, 500)}`,
    );
  }
  if (parsed.data.world_doc_hash !== expectedWorldDocHash) {
    console.warn(
      `world vocabulary stale para "${gameId}": world.md cambió desde la génesis — se ignora`,
    );
    return null;
  }
  return parsed.data;
}

export function writeWorldVocabulary(gamesDir: string, vocab: WorldVocabulary): void {
  const parsed = WorldVocabularySchema.safeParse(vocab);
  if (!parsed.success) {
    throw new Error(
      `writeWorldVocabulary: vocabulario inválido: ${parsed.error.message.slice(0, 500)}`,
    );
  }
  mkdirSync(join(gamesDir, vocab.game_id, "world"), { recursive: true });
  writeFileSync(
    worldVocabularyPath(gamesDir, vocab.game_id),
    JSON.stringify(vocab, null, 2) + "\n",
    "utf-8",
  );
}
