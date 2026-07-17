/** Compositor de blueprints — API pública.
 *
 *  El motor narrativo declara el tile de forma semántica (`map_ground` plano
 *  + `volumes` tipados) y este módulo lo proyecta a la oblicua única del
 *  formato 2D (suelo identidad + cizalla KX en la altura). Consumers: el
 *  cliente 2D (rasteriza el SVG compuesto, colisión, occluders) y el bridge
 *  (validación). */

export { composeBlueprint, COMPOSER_VERSION } from "./compose.js";
export type { BlueprintPlan, ComposedBlueprint, ComposedElement, ComposedOccluder } from "./compose.js";
export { volumeCollisionGrid } from "./collision.js";
export { deriveVolumesFromSchema } from "./derive.js";
export type { DeriveInput } from "./derive.js";
export { PROJECTION, OBLIQUE_KX, OBLIQUE_KY } from "./projection.js";
export type { Projection } from "./projection.js";
export { parseVolumes, VolumesSchema, VolumeSchema, MAX_VOLUMES, TREE_MAX_S } from "./volumes.js";
export type { Volume } from "./volumes.js";
