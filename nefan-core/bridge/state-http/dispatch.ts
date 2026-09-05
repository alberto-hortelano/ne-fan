/** El despacho del State API: sesión, ruta y handler. Sin transporte.
 *
 *  Recibe un `StateRequest` —cuatro campos y una función para leer el body—
 *  en vez del objeto de petición del servidor: por eso se puede ejercer
 *  entero desde un test sin abrir un puerto. `state-http-server.ts` solo
 *  traduce el transporte a esto y de vuelta. */
import { matchRoute, normalizePath } from "../../src/contracts/http.js";
import { WorldStateApi } from "../../src/contracts/world-state.js";
import type { ErrorResponse } from "../../src/contracts/common.js";
import type { RouteHandler, RouteResult, StateHttpContext } from "./context.js";
import { ROUTES } from "./routes.js";

/** Una petición al State API, sin nada de HTTP dentro. */
export interface StateRequest {
  method: string;
  /** Path + query tal y como llegó, p. ej. "/plugins/abc/inspect?view=x". */
  url: string;
  /** Sesión que el llamante dice tener (cabecera `x-nefan-session`).
   *  `undefined` o vacía = sin guardia (el cliente y los benches no la mandan). */
  session?: string;
  /** Lee y parsea el body JSON de la petición. Solo se llama en los POST.
   *  Lanza si el body no es JSON o supera el tope de tamaño: el fallo sube
   *  hasta el borde y sale como 500, nunca como un 200 con basura dentro. */
  readBody: () => Promise<unknown>;
}

export async function dispatchStateRequest(
  ctx: StateHttpContext,
  req: StateRequest,
): Promise<RouteResult> {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = normalizePath(url.pathname);
  const method = req.method;

  // Guardia de sesión: narrative-mcp adjunta en `x-nefan-session` la sesión
  // del request narrativo en curso. NarrativeState es un singleton — si un
  // start/resume lo pisó con la petición en vuelo, TODO lo que el motor lea
  // o escriba iría a la sesión equivocada (reproducido 2026-08-17: places de
  // un mundo inyectados en el world_map de otro save). 409 fail-loud; solo
  // /health queda fuera. Sin cabecera (cliente, benches) no hay guardia.
  //
  // Va UNA vez y ANTES del despacho a propósito: es un invariante de
  // seguridad, y repartido por handler bastaría con que a uno se le olvidara
  // —o con que una ruta nueva naciera sin él— para abrir el agujero entero.
  // Aquí protege hasta las rutas que no existen.
  const mismatch = sessionMismatch(ctx, req.session, path);
  if (mismatch) return mismatch;

  const match = matchRoute(WorldStateApi, method, path);
  const handler: RouteHandler | undefined = match
    ? (ROUTES as Partial<Record<keyof typeof WorldStateApi, RouteHandler>>)[match.key]
    : undefined;
  if (!match || !handler) return noRoute(method, path);

  // Guardia de PARTIDA: una ruta que el contrato declara mutadora no se
  // despacha sin sesión activa (#453). Antes entraba, el handler escribía en
  // el NarrativeState vacío y contestaba 200, y `save()` lanzaba después en
  // `onMutation` —donde solo lo veía el log del bridge—: el motor se quedaba
  // con un «hecho» sobre algo que no existía. Va aquí y no en cada handler
  // por el mismo motivo que la guardia de arriba: repartida, la primera ruta
  // nueva nacería sin ella. Y va ANTES de leer el body: no hay nada que
  // validar de una petición que no se va a aplicar. Las lecturas y los POST
  // que no mutan (`/scene/validate`, `/narrative_progress`) siguen pasando:
  // la regla es «mutadora», no «POST». La sesión PROVISIONAL (#279) tiene
  // `session_id` y NO es este caso: muta en memoria y `save()` devuelve
  // `escrito: false` sin lanzar, que es su diseño.
  const sinPartida = sinSesionParaMutar(ctx, match.key, method, path);
  if (sinPartida) return sinPartida;

  const body = method === "POST" ? await req.readBody() : undefined;
  const result = await handler(ctx, {
    params: match.params,
    query: url.searchParams,
    body,
  });
  // `null` = la ruta existe en el contrato pero no está montada en este
  // bridge (sessionStorage ausente): para quien llama, no existe.
  return result ?? noRoute(method, path);
}

function noRoute(method: string, path: string): RouteResult {
  return {
    status: 404,
    body: { ok: false, error: `no route for ${method} ${path}` } satisfies ErrorResponse,
  };
}

function sinSesionParaMutar(
  ctx: StateHttpContext,
  key: keyof typeof WorldStateApi,
  method: string,
  path: string,
): RouteResult | null {
  if (!WorldStateApi[key].mutates) return null;
  if (ctx.narrative.session_id !== "") return null;
  return {
    status: 409,
    body: {
      ok: false,
      error:
        `no_session: ${method} ${path} muta la partida y el bridge no tiene ninguna activa ` +
        `(ni start_session ni resume_session han corrido, o el save se borró). No se ha aplicado ` +
        `nada. Abre o reanuda una partida antes de volver a intentarlo.`,
    } satisfies ErrorResponse,
  };
}

function sessionMismatch(
  ctx: StateHttpContext,
  claimed: string | undefined,
  path: string,
): RouteResult | null {
  if (claimed === undefined || claimed === "") return null;
  if (path === "/health") return null;
  if (claimed === ctx.narrative.session_id) return null;
  return {
    status: 409,
    body: {
      ok: false,
      error:
        `session_mismatch: la petición pertenece a la sesión ${claimed} pero la ` +
        `sesión activa del bridge es ${ctx.narrative.session_id} — un start/resume_session ` +
        `pisó tu sesión con la petición en vuelo. NO sigas leyendo ni mutando estado: ` +
        `deja caducar la petición sin responder.`,
    } satisfies ErrorResponse,
  };
}
