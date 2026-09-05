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
  /** `true` = la petición cambia el estado autoritativo (el save). Es parte
   *  del CONTRATO y no un detalle del handler porque decide dos cosas que
   *  quien llama tiene que poder saber de antemano: que sin sesión activa no
   *  se acepta (409, #453 — mutar un `NarrativeState` sin partida es escribir
   *  en el vacío y el fallo de guardar salía solo por el log), y que su 200
   *  significa «aplicado Y persistido». Un POST que no lo declara es un
   *  cálculo (`/scene/validate`) o un latido (`/narrative_progress`): puede
   *  responder sin partida. La tabla de test/state-http-caracterizacion.test.ts
   *  contrasta esta declaración con el flag `mutated` que devuelve cada handler. */
  readonly mutates?: true;
  readonly _req?: Req;
  readonly _res?: Res;
  readonly _params?: Record<Params, string>;
  readonly _query?: Query;
}

export const endpoint = <Req, Res, Params extends string = never, Query = never>(
  method: HttpMethod,
  path: string,
  opts?: { mutates: true },
): Endpoint<Req, Res, Params, Query> => (opts?.mutates ? { method, path, mutates: true } : { method, path });

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

/** Una tabla de endpoints como `WorldStateApi`: nombre → endpoint. El
 *  matcher solo mira `method` y `path`, así que la restricción se queda en
 *  esos dos campos: pedir `Endpoint<…>` con sus phantom types haría que
 *  `WorldStateApi` —29 endpoints con 29 pares de tipos distintos— no casara. */
export type EndpointTable = Record<
  string,
  { readonly method: HttpMethod; readonly path: string; readonly mutates?: true }
>;

export interface RouteMatch<K extends string> {
  /** La clave de la tabla, no el path: el que despacha ya no re-parsea nada. */
  key: K;
  /** Los `{param}` de la plantilla, tal cual venían en la URL (SIN decodificar
   *  el percent-encoding: es lo que hacía el router de la cadena de ifs y
   *  cambiarlo aquí sería un cambio de contrato disfrazado de refactor). */
  params: Record<string, string>;
}

/** La INVERSA exacta de `fillPath`: qué endpoint de la tabla pidió esta URL.
 *
 *  Existe porque sin ella cada router improvisa su propio `parts[2] === …`
 *  duplicando a mano una tabla que ya es un dato — y ahí es donde nacen las
 *  rutas que contestan por una URL que nadie pidió.
 *
 *  Reglas, todas verificables:
 *  - Segmentos EXACTOS: `/map/place/x/y` no es `/map/place/{id}`, y una barra
 *    doble interior tampoco se colapsa. Un `{param}` nunca casa con vacío.
 *  - Las barras FINALES se recortan (`/health/` ≡ `/health`), que es lo que
 *    hacía el router y lo que emiten los clientes despistados.
 *  - Precedencia: si una URL casa con una plantilla literal y con otra que usa
 *    `{param}`, gana la literal (`/npcs/in_transit` antes que `/npcs/{id}`).
 *  - El método forma parte de la identidad: `GET /vocabulary` no es
 *    `POST /vocabulary`. */
export function matchRoute<T extends EndpointTable>(
  table: T,
  method: string,
  path: string,
): RouteMatch<Extract<keyof T, string>> | null {
  const pedido = normalizePath(path).split("/");
  let conParams: RouteMatch<Extract<keyof T, string>> | null = null;
  for (const key of Object.keys(table)) {
    const ep = table[key];
    if (ep.method !== method) continue;
    const plantilla = ep.path.split("/");
    if (plantilla.length !== pedido.length) continue;
    const params: Record<string, string> = {};
    let casa = true;
    let literal = true;
    for (const [i, segmento] of plantilla.entries()) {
      const nombre = paramName(segmento);
      if (nombre === null) {
        if (segmento !== pedido[i]) {
          casa = false;
          break;
        }
      } else if (pedido[i] === "") {
        // `/npc//arrive`: el id vendría VACÍO y el handler buscaría el npc "".
        // Tiene que rebotar aquí; la comprobación de longitud no lo caza,
        // porque los segmentos cuadran.
        casa = false;
        break;
      } else {
        params[nombre] = pedido[i];
        literal = false;
      }
    }
    if (!casa) continue;
    const encontrado = { key: key as Extract<keyof T, string>, params };
    if (literal) return encontrado;
    conParams ??= encontrado;
  }
  return conParams;
}

/** Un path en su forma canónica: sin barras finales, y `/` para la raíz.
 *  Vive aquí y no en el router porque el despacho la necesita para las MISMAS
 *  dos cosas que el matcher —decidir qué ruta es y nombrarla en el error— y
 *  dos normalizaciones separadas divergen: bastaría con que una recortara una
 *  barra y la otra todas para que `/health//` fuese una ruta para el matcher y
 *  otra distinta para la guarda de sesión. */
export function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/** `"{id}"` → `"id"`; cualquier otro segmento → `null`.
 *  Anclado a propósito: un `{param}` ocupa el segmento ENTERO. `x{id}` es un
 *  literal, no un parámetro — y que ningún endpoint escriba algo así lo canda
 *  test/state-http-dispatch.test.ts sobre la tabla real, porque `fillPath` SÍ
 *  sustituiría ahí dentro y las dos funciones dejarían de ser inversas. */
function paramName(segmento: string): string | null {
  const m = /^\{([^}]+)\}$/.exec(segmento);
  return m ? m[1] : null;
}
