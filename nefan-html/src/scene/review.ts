/** Retoque del blueprint por visión (fase "revisión") — extraído de main.ts.
 *
 *  Claude mira el blueprint COMPUESTO del tile (map_ground + volumes
 *  proyectados a la perspectiva de la sesión) vía /review_scene_blueprint y
 *  devuelve fixes parciales; el plan corregido (o aprobado sin cambios) se
 *  re-aplica en local y se persiste al bridge con map_plan_update, que
 *  estampa `map_plan_reviewed` para que el resume no re-revise (y el
 *  blueprint compuesto quede byte-idéntico ⇒ hit de caché de imagen).
 *  main.ts solo cablea las deps. */

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
  if (fixes.map_ground) fixed.map_ground = fixes.map_ground;
  if (fixes.volumes) fixed.volumes = fixes.volumes;
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
  /** Persiste el plan revisado al bridge (solo con sesión activa). */
  reportMapPlan(tx: number, ty: number, plan: { map_ground?: string; volumes?: unknown[] }): void;
  log(msg: string): void;
}

/** Fase "revisión" (auto-pipeline y tecla R en tiles). Tiles sin plan
 *  (map_ground/volumes) o ya revisados: no-op inmediato. */
export async function reviewTileBlueprint(key: string, deps: ReviewDeps): Promise<void> {
  const entry = deps.tileStore.entries.get(key);
  const raw = (entry?.scene as { __format_d?: Record<string, unknown> } | undefined)?.__format_d;
  if (!entry || !raw) return;
  const hasPlan = typeof raw.map_ground === "string" || Array.isArray(raw.volumes);
  if (!hasPlan || raw.map_plan_reviewed === true) return;
  deps.log(`blueprint ${key} → revisión por visión (Claude)…`);
  const review = await deps.controller.reviewBlueprint(raw, entry.rect, key);
  for (const issue of review.issues) deps.log(`review ${key}: ${issue}`);
  // Estampar SIEMPRE map_plan_reviewed (con o sin fixes) y re-registrar: el
  // save del bridge y el estado local deben coincidir campo a campo para que
  // el resume preserve la imagen (fingerprint) y no re-revise.
  const fixed = review.fixes ? applyReviewFixes(raw, review.fixes) : { ...raw };
  fixed.map_plan_reviewed = true;
  await deps.addTile(fixed);
  const tc = parseTileKey(key);
  if (tc) {
    deps.reportMapPlan(tc.tx, tc.ty, {
      map_ground: review.fixes?.map_ground,
      volumes: review.fixes?.volumes,
    });
  }
  deps.log(
    review.fixes?.map_ground || review.fixes?.volumes
      ? `review ${key}: plan corregido aplicado (${review.issues.length} issue(s))`
      : `review ${key}: blueprint aprobado`,
  );
}
