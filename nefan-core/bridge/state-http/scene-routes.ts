/** Escenas: validación de jugabilidad y registro de assets usados.
 *
 *  Hueco reservado para #195 (grid mal formado): el `validateScene` de aquí
 *  es la llamada sin try/catch que produce el 500 — el arreglo son tres
 *  líneas en ESTE handler y un test que lo invoca sin servidor. */
import {
  SceneAssetRefsRequestSchema,
  SceneValidateRequestSchema,
} from "../../src/contracts/request-schemas.js";
import { validateScene, type TileValidationContext } from "../../src/scene/scene-validate.js";
import { oppositeEdge } from "../../src/world-map/edges.js";
import type { Edge } from "../../src/world-map/types.js";
import type { SceneRecord } from "../../src/narrative/types.js";
import type { NarrativeState } from "../../src/narrative/narrative-state.js";
import type { ResponseOf } from "../../src/contracts/http.js";
import type { SceneAssetRefsResponse, WorldStateApi } from "../../src/contracts/world-state.js";
import { mutated, notFound, ok, parseBody } from "./context.js";
import type { RouteGroup } from "./routes.js";

/** Para un tile, el contexto de costuras lo construye el SERVIDOR desde los
 *  edges de los vecinos registrados — el motor no puede olvidarse de pasarlo
 *  y el pre-flight de narrative_respond no cambia. Para lo que no es un tile,
 *  no hay contexto que construir. */
export function tileContextFor(
  narrative: NarrativeState,
  scene: Record<string, unknown>,
): TileValidationContext | undefined {
  const rawTile = scene.tile as { tx?: number; ty?: number } | undefined;
  if (!rawTile || !Number.isInteger(rawTile.tx) || !Number.isInteger(rawTile.ty)) return undefined;
  const required: TileValidationContext["required_crossings"] = [];
  const neighbors = narrative.neighborsOf(rawTile.tx!, rawTile.ty!);
  for (const [edge, rec] of Object.entries(neighbors) as [Edge, SceneRecord][]) {
    // El borde del vecino que da a NUESTRO tile es el opuesto; el `at` es
    // espejo sin transformación.
    const shared = rec.edges?.[oppositeEdge(edge)];
    for (const c of shared?.crossings ?? []) required.push({ edge, ...c });
  }
  const hasAnyTile = Object.values(narrative.scenes_loaded).some((r) => r.tile);
  return { required_crossings: required, bootstrap: !hasAnyTile };
}

export const sceneRoutes = {
  /** Pre-flight de narrative_respond y tool scene_validate. No muta nada. */
  validateScene: (ctx, { body }) => {
    const parsed = parseBody(SceneValidateRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    const scene = parsed.data.scene as Record<string, unknown>;
    const result = validateScene(scene, tileContextFor(ctx.narrative, scene));
    return ok(result satisfies ResponseOf<typeof WorldStateApi.validateScene>);
  },

  appendSceneAssetRefs: (ctx, { body }) => {
    const parsed = parseBody(SceneAssetRefsRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    try {
      const total = ctx.narrative.appendSceneAssetRefs(parsed.data.scene_id, parsed.data.refs);
      return mutated({ ok: true, total } satisfies SceneAssetRefsResponse);
    } catch (err) {
      // Escena desconocida → 404 (la keep-list solo protege escenas vivas).
      return notFound((err as Error).message);
    }
  },
} satisfies RouteGroup;
