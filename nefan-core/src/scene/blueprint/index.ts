/** Compositor de blueprints con perspectiva — API pública.
 *
 *  El motor narrativo declara el tile de forma semántica (`map_ground` plano
 *  + `volumes` tipados) y este módulo lo proyecta a la perspectiva congelada
 *  en la sesión ("topdown" cenital con caras | "isometric" 2:1). Consumers:
 *  el cliente 2D (rasteriza el SVG compuesto, colisión, occluders) y el
 *  bridge (validación). */

export { composeBlueprint, COMPOSER_VERSION } from "./compose.js";
export type { BlueprintPlan, ComposedBlueprint, ComposedElement } from "./compose.js";
export { volumeCollisionGrid } from "./collision.js";
export { deriveVolumesFromSchema } from "./derive.js";
export type { DeriveInput } from "./derive.js";
export { projectionFor, isPerspective, PERSPECTIVES } from "./projection.js";
export type { Perspective, Projection } from "./projection.js";
export { parseVolumes, VolumesSchema, VolumeSchema, MAX_VOLUMES } from "./volumes.js";
export type { Volume } from "./volumes.js";
