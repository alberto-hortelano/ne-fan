/** Metamodelo de los contratos HTTP entre microservicios.
 *
 * Un `Endpoint` es un valor en runtime (method + path plantilla) con tipos
 * phantom para request/response/params/query: los clientes tipados y los
 * tests de contrato lo consumen sin duplicar shapes. Los tipos documentan el
 * CABLE REAL (aunque la implementación sea Python), no un ideal.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Definición tipada de un endpoint HTTP.
 *  - `Req`: body JSON de la petición (`void` = sin body).
 *  - `Res`: body JSON de la respuesta 2xx (o `BinaryResponse`).
 *  - `Params`: nombres de los segmentos `{param}` del path.
 *  - `Query`: shape de los query params opcionales.
 *  Los campos `_req/_res/_params/_query` son phantom types: nunca se asignan,
 *  solo existen en compile-time para que `RequestOf<E>`/`ResponseOf<E>`
 *  funcionen. */
export interface Endpoint<Req, Res, Params extends string = never, Query = never> {
  readonly method: HttpMethod;
  /** Plantilla de ruta, p. ej. "/npc/{id}/directive". */
  readonly path: string;
  readonly _req?: Req;
  readonly _res?: Res;
  readonly _params?: Record<Params, string>;
  readonly _query?: Query;
}

export const endpoint = <Req, Res, Params extends string = never, Query = never>(
  method: HttpMethod,
  path: string,
): Endpoint<Req, Res, Params, Query> => ({ method, path });

/** Extractores para clientes tipados. */
export type RequestOf<E> = E extends Endpoint<infer Req, unknown, string, unknown> ? Req : never;
export type ResponseOf<E> = E extends Endpoint<unknown, infer Res, string, unknown> ? Res : never;

/** Respuesta binaria (imágenes, GLB…): el contrato solo fija el content-type. */
export interface BinaryResponse {
  readonly _binary: true;
  readonly contentType: string;
}

/** Sustituye los `{param}` de una plantilla de ruta. Fail-loud si falta uno. */
export function fillPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`fillPath: missing path param "${name}" for ${template}`);
    return encodeURIComponent(value);
  });
}
