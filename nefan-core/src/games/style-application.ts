/** Registro de "estilo aplicado a un juego" — el recibo persistente del batch
 *  de assets estilizados de un estilo sobre el snapshot de mundo:
 *  `data/games/{id}/world/styles/{style_id}.json`.
 *
 *  No es una caché de assets (eso vive en el asset-store, indexado por las
 *  claves naturales descripción+estilo): es el ESTADO para la UI del título
 *  (chips aplicado/obsoleto), la lista de hashes pineados contra el prune y
 *  el resumen de coste. Regenerar mundo o editar world.md lo deja stale. */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SAFE_ID } from "./loader.js";
import {
  StyleApplicationRecordSchema,
  styleApplicationPinRef,
  STYLE_APPLICATION_SCHEMA_VERSION,
  type StyleApplicationRecord,
} from "./style-application-schema.js";

export {
  StyleApplicationRecordSchema,
  styleApplicationPinRef,
  STYLE_APPLICATION_SCHEMA_VERSION,
  type StyleApplicationRecord,
};

export function styleApplicationPath(
  gamesDir: string,
  gameId: string,
  styleId: string,
): string {
  if (!SAFE_ID.test(gameId) || !SAFE_ID.test(styleId)) {
    throw new Error(`styleApplicationPath: unsafe ids "${gameId}"/"${styleId}"`);
  }
  return join(gamesDir, gameId, "world", "styles", `${styleId}.json`);
}

export function writeStyleApplication(gamesDir: string, record: StyleApplicationRecord): void {
  const parsed = StyleApplicationRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error(
      `writeStyleApplication: registro inválido: ${parsed.error.message.slice(0, 500)}`,
    );
  }
  mkdirSync(join(gamesDir, record.game_id, "world", "styles"), { recursive: true });
  writeFileSync(
    styleApplicationPath(gamesDir, record.game_id, record.style_id),
    JSON.stringify(parsed.data, null, 2) + "\n",
    "utf-8",
  );
}

/** Carga un registro. Ausente → null; malformado → throw (fail-loud). */
export function loadStyleApplication(
  gamesDir: string,
  gameId: string,
  styleId: string,
): StyleApplicationRecord | null {
  const path = styleApplicationPath(gamesDir, gameId, styleId);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`style application malformado (${path}): ${(err as Error).message}`, {
      cause: err,
    });
  }
  const parsed = StyleApplicationRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `style application inválido (${path}): ${parsed.error.message.slice(0, 500)}`,
    );
  }
  return parsed.data;
}

export function deleteStyleApplication(
  gamesDir: string,
  gameId: string,
  styleId: string,
): boolean {
  const path = styleApplicationPath(gamesDir, gameId, styleId);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Lista los estilos aplicados de un juego para games_listed. Degrada por
 *  registro (uno malformado se reporta como stale con warning). */
export function listStyleApplications(
  gamesDir: string,
  gameId: string,
  worldDocHash: string,
): Array<{ style_id: string; status: "ready" | "stale" }> {
  const dir = join(gamesDir, gameId, "world", "styles");
  if (!SAFE_ID.test(gameId) || !existsSync(dir)) return [];
  const out: Array<{ style_id: string; status: "ready" | "stale" }> = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const styleId = file.slice(0, -".json".length);
    if (!SAFE_ID.test(styleId)) continue;
    try {
      const rec = loadStyleApplication(gamesDir, gameId, styleId);
      if (!rec) continue;
      out.push({
        style_id: rec.style_id,
        status: rec.world_doc_hash === worldDocHash ? "ready" : "stale",
      });
    } catch (err) {
      console.warn(`listStyleApplications("${gameId}", ${file}): ${(err as Error).message}`);
      out.push({ style_id: styleId, status: "stale" });
    }
  }
  return out.sort((a, b) => a.style_id.localeCompare(b.style_id));
}
