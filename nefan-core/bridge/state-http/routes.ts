/** La tabla ruta→handler, DERIVADA del contrato en vez de copiada a mano.
 *
 *  `WorldStateApi` ya era el dato con los 29 endpoints (method + path); el
 *  router lo duplicaba en 28 guardas `method === … && path === …`, y un
 *  endpoint nuevo sin rama solo lo cazaba un test de contrato al que había
 *  que acordarse de mirar. Aquí la garantía va en el TIPO:
 *  `Record<RouteKey, RouteHandler>` hace que un endpoint sin handler NO
 *  COMPILE, y el `satisfies` de cada fichero de handlers hace que un handler
 *  sin endpoint tampoco. */
import { WorldStateApi } from "../../src/contracts/world-state.js";
import type { RouteHandler } from "./context.js";
import { docRoutes } from "./doc-routes.js";
import { entityRoutes } from "./entity-routes.js";
import { mapRoutes } from "./map-routes.js";
import { npcRoutes } from "./npc-routes.js";
import { pluginRoutes } from "./plugin-routes.js";
import { sceneRoutes } from "./scene-routes.js";
import { sessionRoutes } from "./session-routes.js";

/** Endpoints declarados en el contrato que TODAVÍA no tienen implementación,
 *  con el motivo. Estar aquí no los hace opcionales: los saca del tipo, que
 *  es distinto de olvidarlos. Una petición a uno de ellos cae al 404 genérico,
 *  igual que antes del corte.
 *  - `getLlmContext`: PLANNED F5 (des-stickyficar el LLMClient de
 *    narrative-llm; hoy ese contexto viaja empujado en cada petición). */
export const PLANNED_ROUTES = ["getLlmContext"] as const;

export type RouteKey = Exclude<keyof typeof WorldStateApi, (typeof PLANNED_ROUTES)[number]>;

export const ROUTES: Record<RouteKey, RouteHandler> = {
  ...sessionRoutes,
  ...mapRoutes,
  ...entityRoutes,
  ...npcRoutes,
  ...sceneRoutes,
  ...docRoutes,
  ...pluginRoutes,
};
