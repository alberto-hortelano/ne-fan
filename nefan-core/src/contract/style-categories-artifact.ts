/** Artefacto JSON puente del enum de categorías de estilo.
 *
 *  `npm run gen:contract` escribe data/contract/style_categories.json con este
 *  contenido, generado desde la fuente única games/style-categories.ts. El
 *  lado Python (ai_server/style_categories.py — del que derivan style_packs,
 *  narrative_schemas y remote_generation) se canda contra ese JSON en
 *  ai_server/tests/test_style_categories_sync.py; el lado TS, en
 *  test/contract-style-categories.test.ts. Así una categoría añadida o
 *  retirada en un solo lado rompe CI en vez de derivar en silencio. */
import {
  STYLE_ENV_CATEGORIES,
  STYLE_CHARACTER_CATEGORIES,
  STYLE_STAGE_CATEGORIES,
  LEGACY_STYLE_ALIASES,
  ZONE_TO_STAGE,
} from "../games/style-categories.js";

export function renderStyleCategoriesArtifact(): string {
  const artifact = {
    _comment:
      "GENERADO por `npm run gen:contract` desde src/games/style-categories.ts — no editar a mano.",
    env: STYLE_ENV_CATEGORIES,
    character: STYLE_CHARACTER_CATEGORIES,
    stage: STYLE_STAGE_CATEGORIES,
    legacy_aliases: LEGACY_STYLE_ALIASES,
    zone_to_stage: ZONE_TO_STAGE,
  };
  return JSON.stringify(artifact, null, 2) + "\n";
}
