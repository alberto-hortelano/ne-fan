/** La sesión vista desde fuera: diagnóstico de infra, keep-list del prune y
 *  el latido del motor narrativo. Es lo único que NO cuelga del mundo. */
import { NarrativeProgressRequestSchema } from "../../src/contracts/request-schemas.js";
import type { ResponseOf } from "../../src/contracts/http.js";
import type { WorldStateApi, WorldStateHealthResponse } from "../../src/contracts/world-state.js";
import { ok, parseBody } from "./context.js";
import type { RouteGroup } from "./routes.js";

export const sessionRoutes = {
  health: (ctx) =>
    ok({
      ok: true,
      session_id: ctx.narrative.session_id,
      has_session: Boolean(ctx.narrative.session_id),
      game_id: ctx.narrative.game_id,
      ai_server_url: ctx.aiServerUrl,
    } satisfies WorldStateHealthResponse),

  /** Keep-list del asset-store (F2): unión de hashes referenciados por
   *  CUALQUIER save vivo (asset_refs de escenas y entidades +
   *  asset_index_snapshot). El prune la consulta para no podar assets que un
   *  resume necesitará.
   *
   *  Hueco reservado para #224 (título a 200 ms): esta es la ÚNICA
   *  dependencia del handler; cambiar la API de `SessionStorage` para no
   *  parsear el corpus dos veces se hace aquí y en `SessionStorage`, y en
   *  ningún sitio más. */
  getAssetRefs: async (ctx) => {
    const storage = ctx.sessionStorage;
    if (!storage) return null; // sin storage la ruta no existe (404 genérico)
    const refs = new Set<string>();
    for (const meta of await storage.list()) {
      let data;
      try {
        data = await storage.read(meta.session_id);
      } catch (err) {
        // Un save corrupto no debe vaciar la keep-list ni tumbar la ruta.
        console.warn(`asset_refs: save "${meta.session_id}" ilegible:`, err);
        continue;
      }
      if (!data) continue;
      for (const scene of Object.values(data.scenes_loaded ?? {})) {
        for (const r of scene.asset_refs ?? []) refs.add(r);
      }
      for (const entity of data.entities ?? []) {
        for (const r of entity.asset_refs ?? []) refs.add(r);
      }
      for (const asset of data.asset_index_snapshot ?? []) refs.add(asset.hash);
    }
    return ok({ refs: [...refs].sort() } satisfies ResponseOf<typeof WorldStateApi.getAssetRefs>);
  },

  /** Latido del motor narrativo en cada paso observable (tool MCP llamada,
   *  petición recogida). Sin sesión que mutar: solo difusión al cliente. */
  narrativeProgress: (ctx, { body }) => {
    const parsed = parseBody(NarrativeProgressRequestSchema, body);
    if (!parsed.ok) return parsed.result;
    ctx.onProgress(parsed.data.message.slice(0, 300));
    return ok({ ok: true } satisfies ResponseOf<typeof WorldStateApi.narrativeProgress>);
  },
} satisfies RouteGroup;
