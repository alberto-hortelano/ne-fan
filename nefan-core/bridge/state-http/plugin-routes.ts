/** Plugins runtime (F5/F6): alta, listado e inspección del registry activo.
 *  El registry vive en ws-server; aquí solo se llaman sus hooks. */
import { PluginRegisterRequestSchema } from "../../src/contracts/request-schemas.js";
import type { ResponseOf } from "../../src/contracts/http.js";
import type {
  PluginListResponse,
  PluginRegisterResponse,
  WorldStateApi,
} from "../../src/contracts/world-state.js";
import { bad, mutated, ok, parseBody, type RouteHandler } from "./context.js";

export const pluginRoutes = {
  listPlugins: (ctx) => ok({ plugins: ctx.plugins.list() } satisfies PluginListResponse),

  /** GET /plugins/{id}/inspect?view=<name>: una derived_view concreta o el
   *  slice completo. Plugin o vista inexistentes → 400 con el motivo. */
  inspectPlugin: (ctx, { params, query }) => {
    try {
      const view = query.get("view") ?? undefined;
      return ok(
        ctx.plugins.inspect(params.id, view) satisfies ResponseOf<typeof WorldStateApi.inspectPlugin>,
      );
    } catch (err) {
      return bad((err as Error).message);
    }
  },

  registerPlugin: (ctx, { body }) => {
    const parsed = parseBody(PluginRegisterRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    try {
      const result = ctx.plugins.register(parsed.data.manifest);
      return mutated({ ok: true, ...result } satisfies PluginRegisterResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  },
} satisfies Record<string, RouteHandler>;
