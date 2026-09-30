/** La puerta de la población CRUDA hacia `formatDToWorld` (#782).
 *
 *  `formatDToWorld` solo acepta `ExpandedScene`: lo que el bridge registra ya
 *  lo es (lo da `recordSceneLoaded`, que pasa el gate). Pero hay otro camino
 *  legítimo hasta la world scene que no pasa por el bridge: las fixtures de
 *  `data/scenes/` (el selector «Room» del cliente, el hook `addTileRaw` del
 *  banco, los candados `.mjs` de `qa/`), que están en disco CRUDAS. Hasta #782
 *  las expandía `formatDToWorld` por dentro y luego las revalidaba a mano,
 *  entity a entity, con un rasero más laxo que el zod: una `shape` inventada o
 *  una `h` negativa caían al defecto en silencio.
 *
 *  Aquí una fixture pasa por el MISMO gate que una escena del motor: emitida
 *  → `EmittedSceneSchema` → `expandScenePrimitives` → `ExpandedSceneSchema`.
 *  Una ya expandida (la marca `__expanded`) va directa al segundo gate. Lo que
 *  no pasa LANZA con el motivo del primer issue, que es el que el motor leería.
 *
 *  Puro y sin `node:*`: lo importa el cliente. */

import { EmittedSceneSchema, gateEscenaExpandida, type ExpandedScene } from "../contract/model-io/scene-schema.js";
import { formatZodError, validateContract } from "../contract/model-io/validate.js";
import { expandScenePrimitives } from "./scene-expand.js";

const PREFIJO = "escenaCargable: no es Format D (ni emitido ni expandido)";

/** `raw` como escena cargable, o LANZA diciendo por qué no lo es. Una escena ya
 *  expandida vuelve con la MISMA referencia (el gate no la copia). */
export function escenaCargable(raw: unknown): ExpandedScene {
  const expandida = typeof raw === "object" && raw !== null && (raw as { __expanded?: unknown }).__expanded === true;
  if (!expandida) {
    const emitida = validateContract(EmittedSceneSchema, raw);
    if (!emitida.ok) throw new Error(`${PREFIJO}: ${emitida.error}`);
  }
  const g = gateEscenaExpandida(expandida ? raw : expandScenePrimitives(raw as Record<string, unknown>));
  if (!g.ok) throw new Error(`${PREFIJO}: ${formatZodError(g.error)}`);
  return g.escena;
}
