/** La tabla ruta→handler, DERIVADA del contrato en vez de copiada a mano.
 *
 *  `WorldStateApi` ya era el dato con los 29 endpoints (method + path); el
 *  router lo duplicaba en 28 guardas `method === … && path === …`, y un
 *  endpoint nuevo sin rama solo lo cazaba un test de contrato al que había
 *  que acordarse de mirar. Aquí la garantía va en el TIPO, y son tres cosas
 *  distintas que NO compilan (las tres comprobadas rompiéndolas a mano):
 *   1. un endpoint del contrato sin handler → falla `Record<RouteKey, …>` aquí;
 *   2. AMPLIAR el contrato con un endpoint 29 → el mismo error, así que no se
 *      puede añadir una ruta sin decidir quién la contesta;
 *   3. un handler que no corresponde a ningún endpoint → falla `RouteGroup` en
 *      el fichero del handler.
 *  La 3 no salía gratis: con `Record<string, RouteHandler>` compilaba, porque
 *  TypeScript no comprueba propiedades sobrantes a través de un spread. Lo
 *  cazó QA leyendo esta misma cabecera, que prometía una garantía que no
 *  existía. */
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

/** El tipo con el que cada fichero de handlers se declara.
 *
 *  `Partial<Record<RouteKey, …>>` y no `Record<string, …>`: la diferencia es
 *  justo la SEGUNDA dirección de la garantía. Con `string` por clave, un
 *  handler que no corresponde a ningún endpoint del contrato compilaba tan
 *  campante y se quedaba ahí, muerto, pareciendo vivo — y el `Record<RouteKey,
 *  RouteHandler>` de abajo no lo cazaba porque TypeScript no comprueba
 *  propiedades sobrantes a través de un spread. Con `RouteKey`, el error sale
 *  en el fichero del handler, que es donde está el fallo.
 *
 *  Lo que esto NO canda, y lo canda un test: el mismo endpoint servido por dos
 *  ficheros. Los dos serían claves válidas, el último spread ganaría en
 *  silencio, y quien lo caza es el aserto de unicidad de
 *  test/state-http-dispatch.test.ts. */
export type RouteGroup = Partial<Record<RouteKey, RouteHandler>>;

export const ROUTES: Record<RouteKey, RouteHandler> = {
  ...sessionRoutes,
  ...mapRoutes,
  ...entityRoutes,
  ...npcRoutes,
  ...sceneRoutes,
  ...docRoutes,
  ...pluginRoutes,
};
