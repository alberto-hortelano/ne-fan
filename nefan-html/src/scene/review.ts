/** Retoque del blueprint por visión (fase "revisión") — extraído de main.ts.
 *
 *  Claude mira el blueprint rasterizado del tile (con map_svg, el plano SVG)
 *  vía /review_scene_blueprint y devuelve fixes parciales; el map_svg
 *  corregido (o aprobado sin cambios) se re-aplica en local y se persiste al
 *  bridge con map_svg_update, que estampa `map_svg_reviewed` para que el
 *  resume no re-revise (y el blueprint quede byte-idéntico ⇒ hit de caché de
 *  imagen). main.ts solo cablea las deps. */

import { parseTileKey } from "@nefan-core/src/scene/tile.js";
import type { BlueprintReview, SceneImageController } from "./scene-image.js";
import type { TileStore } from "../world/tile-store.js";

/** Aplica los fixes de un blueprint_review sobre una copia del Format D. */
export function applyReviewFixes(
  fd: Record<string, unknown>,
  fixes: NonNullable<BlueprintReview["fixes"]>,
): Record<string, unknown> {
  const fixed: Record<string, unknown> = { ...fd };
  if (fixes.terrain) fixed.terrain = fixes.terrain;
  if (fixes.terrain_features) fixed.terrain_features = fixes.terrain_features;
  if (fixes.map_svg) fixed.map_svg = fixes.map_svg;
  if (fixes.entity_moves?.length) {
    const moves = new Map(fixes.entity_moves.map((m) => [m.id, m.cell]));
    const ents = (fixed.entities as Record<string, unknown>[] | undefined) ?? [];
    fixed.entities = ents.map((e) =>
      moves.has(e.id as string) ? { ...e, cell: moves.get(e.id as string) } : e,
    );
  }
  return fixed;
}

export interface ReviewDeps {
  tileStore: TileStore;
  controller: SceneImageController;
  /** Re-registra el Format D corregido (re-rasteriza blueprint + colisión). */
  addTile(raw: Record<string, unknown>): Promise<void>;
  /** Persiste el map_svg revisado al bridge (solo con sesión activa). */
  reportMapSvg(tx: number, ty: number, mapSvg: string): void;
  log(msg: string): void;
}

/** Fase "revisión" (auto-pipeline y tecla R en tiles). Tiles sin map_svg o ya
 *  revisados: no-op inmediato. */
export async function reviewTileBlueprint(key: string, deps: ReviewDeps): Promise<void> {
  const entry = deps.tileStore.entries.get(key);
  const raw = (entry?.scene as { __format_d?: Record<string, unknown> } | undefined)?.__format_d;
  const mapSvg = raw?.map_svg;
  if (!entry || !raw || typeof mapSvg !== "string") return;
  if (raw.map_svg_reviewed === true) return;
  deps.log(`blueprint ${key} → revisión por visión (Claude)…`);
  const review = await deps.controller.reviewBlueprint(raw, entry.rect, key);
  for (const issue of review.issues) deps.log(`review ${key}: ${issue}`);
  const finalSvg = review.fixes?.map_svg ?? mapSvg;
  // Estampar SIEMPRE map_svg_reviewed (con o sin fixes) y re-registrar: el
  // save del bridge y el estado local deben coincidir campo a campo para que
  // el resume preserve la imagen (fingerprint) y no re-revise.
  const fixed = review.fixes ? applyReviewFixes(raw, review.fixes) : { ...raw };
  fixed.map_svg = finalSvg;
  fixed.map_svg_reviewed = true;
  await deps.addTile(fixed);
  const tc = parseTileKey(key);
  if (tc) deps.reportMapSvg(tc.tx, tc.ty, finalSvg);
  deps.log(
    review.fixes?.map_svg
      ? `review ${key}: map_svg corregido aplicado (${review.issues.length} issue(s))`
      : `review ${key}: blueprint aprobado`,
  );
}
