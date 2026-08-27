/** Lo que un handler del State API recibe y lo que devuelve.
 *
 *  Aquí no hay transporte: ni el módulo http de Node, ni sockets, ni
 *  cabeceras. Un handler es `(ctx, req) => RouteResult` y se puede llamar
 *  desde un test sin levantar un servidor — que es la definición falsable de
 *  «probable sola» con la que se partió el router (#225). Lo canda
 *  `handlers-sin-servidor` en data/contract/arch-rules.json, y la prueba de
 *  que muerde es que este fichero no puede ni NOMBRAR los tipos del
 *  transporte. */
import type { NarrativeState } from "../../src/narrative/narrative-state.js";
import type { SessionStorage } from "../../src/narrative/session-storage.js";
import type { NpcDirector } from "../../src/world-map/npc-director.js";
import type { ErrorResponse, PluginInspectResult } from "../../src/contracts/common.js";
import type { PluginRegisterResponse } from "../../src/contracts/world-state.js";
import type { RegisteredPlugin } from "../../src/plugins/register.js";
import { formatZodError } from "../../src/contract/model-io/validate.js";
import type { z, ZodTypeAny } from "zod";

/** Hooks de plugins (F5) — viven en ws-server porque el registry activo del
 *  dispatcher (`activePlugins`) es estado del bridge. */
export interface PluginHooks {
  /** Valida y activa un manifest runtime, o EVOLUCIONA el plugin vigente del
   *  mismo `name` (`action`, §7.3). Lanza PluginRegisterError con el motivo
   *  si es inválido o si el salto de versión no es legal. El cuerpo se arma
   *  con `pluginRegisterBody`. */
  register: (raw: unknown) => Omit<PluginRegisterResponse, "ok">;
  /** Plugins activos de la sesión, resumidos para el motor narrativo. */
  list: () => Array<Record<string, unknown>>;
  /** Detalle de un plugin (F6): una derived_view concreta o el slice
   *  completo. Lanza con el motivo si el plugin o la vista no existen. */
  inspect: (id: string, view?: string) => PluginInspectResult;
}

/** Todo lo que un handler puede tocar. Es el estado del bridge, no del
 *  request: se construye una vez en `createStateHttpServer` y no cambia. */
export interface StateHttpContext {
  narrative: NarrativeState;
  npcDirector: NpcDirector;
  plugins: PluginHooks;
  /** Directorio de juegos (data/games) — GET /world_doc lee de ahí el
   *  world.md del juego de la sesión activa (tool MCP world_doc_get). */
  gamesDir: string;
  /** Latido de progreso del motor narrativo (POST /narrative_progress desde
   *  narrative-mcp): el bridge lo difunde como narrative_status "progress"
   *  para que el loader del cliente muestre qué está pasando. */
  onProgress: (message: string) => void;
  /** Storage de saves — GET /sessions/asset_refs (F2) recorre TODOS los
   *  saves para construir la keep-list del prune del asset-store. Opcional:
   *  sin él la ruta no existe (404). */
  sessionStorage?: SessionStorage;
  /** A qué motor narrativo habla este bridge. Se publica en GET /health
   *  porque es la vía de gasto que NO pasa por el `?ai=` del cliente. */
  aiServerUrl: string;
  /** El gateway WS de este mismo proceso: la IDENTIDAD de esa vía. Sin ella,
   *  quien pregunta no puede saber si está hablando con SU bridge. */
  gatewayUrl: string;
}

/** El request ya despiezado: el handler no vuelve a mirar la URL. */
export interface RouteRequest {
  /** Los `{param}` de la plantilla, sin decodificar. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Body JSON ya parseado; `undefined` si la petición no traía ninguno. */
  body: unknown;
}

export interface RouteResult {
  status: number;
  body: unknown;
  /** true = la petición cambió el estado autoritativo y el bridge tiene que
   *  persistir el save. Es el flag que, perdido, deja de escribir la partida
   *  sin cambiar una sola respuesta: lo canda la tabla de
   *  test/state-http-caracterizacion.test.ts. */
  mutated?: boolean;
}

/** Un handler devuelve `null` cuando la ruta NO está montada en esta
 *  configuración del bridge — hoy solo `/sessions/asset_refs`, que necesita
 *  el `sessionStorage` opcional. El despacho lo traduce al mismo 404 genérico
 *  que una ruta inexistente, porque para quien llama no existe. Un `null` no
 *  es un error tragado: es la ausencia de la ruta, dicha en el tipo. */
export type RouteHandler = (
  ctx: StateHttpContext,
  req: RouteRequest,
) => RouteResult | null | Promise<RouteResult | null>;

// ── Respuestas ──

export function ok(body: unknown): RouteResult {
  return { status: 200, body };
}

export function mutated(body: unknown): RouteResult {
  return { status: 200, body, mutated: true };
}

export function bad(message: string): RouteResult {
  return { status: 400, body: { ok: false, error: message } satisfies ErrorResponse };
}

export function notFound(message: string): RouteResult {
  return { status: 404, body: { ok: false, error: message } satisfies ErrorResponse };
}

/** Borde de entrada: valida el body contra su espejo zod del contrato
 *  (contracts/request-schemas.ts, con guardia de deriva). Falla con 400 y el
 *  error zod formateado (ruta + motivo) — nunca se enruta un body no
 *  conforme a los mutadores. */
export function parseBody<S extends ZodTypeAny>(
  schema: S,
  body: unknown,
): { ok: true; data: z.output<S> } | { ok: false; result: RouteResult } {
  const res = schema.safeParse(body);
  if (!res.success) return { ok: false, result: bad(formatZodError(res.error)) };
  return { ok: true, data: res.data };
}

/** `RegisteredPlugin` (core) → cuerpo de `PluginRegisterResponse` (wire).
 *  Vive junto al tipo del hook para que el mapeo exista UNA vez: ws-server y
 *  los harnesses de test montan el mismo hook, y una traducción copiada en
 *  cada uno diverge sin que ningún test se entere. Los campos de `migrated`
 *  se omiten cuando no aplican en vez de viajar como `null`. */
export function pluginRegisterBody(result: RegisteredPlugin): Omit<PluginRegisterResponse, "ok"> {
  return {
    id: result.id,
    name: result.manifest.name,
    version: result.manifest.version,
    fixturesPassed: result.fixturesPassed,
    action: result.action,
    ...(result.fromVersion === undefined ? {} : { from_version: result.fromVersion }),
    ...(result.fromOriginAuthor === undefined
      ? {}
      : { from_origin_author: result.fromOriginAuthor }),
  };
}
