/** El CABLE del asset-store: cómo se lee una URL contra `AssetStoreApi` y
 *  cómo se emite el blob. Sin `ManifestDb`, sin `node:sqlite` y sin nada del
 *  almacén. Nació para `GET /styles/{style_id}/{file}` y por eso la historia de
 *  abajo es la de esa ruta; desde la tanda BR también enruta el store entero
 *  (`casarRuta`), por la misma razón: una sola lectura de la URL.
 *
 *  Existe porque el motor falso del bench (`labs/narrative/fake-ai-server.ts`)
 *  sirve esa misma ruta y la había COPIADO a mano. Quien la copió sabía que
 *  copiaba y había medido la paridad; QA la volvió a medir el MISMO DÍA y
 *  encontró cuatro desvíos (`cover%2Ejpg` 400 contra 200-con-imagen, la barra
 *  final, el `Content-Length` ausente, el fichero-punto). Se arreglaron
 *  copiando aún más literalmente, que deja el mecanismo intacto: la copia
 *  siguiente vuelve a divergir y nadie se entera, porque el que se entera es un
 *  bench y un bench no falla, miente (#280).
 *
 *  Importar `readStyleFile` no bastaba, y es el matiz que decide el tamaño de
 *  esto: el MIME y el 404 viven en el lector, pero **la barra final vive en la
 *  ruta** y **el `Content-Length` en la emisión**. Cerrar solo el lector deja
 *  copiados justo los dos desvíos que QA midió.
 *
 *  Lo que este módulo NO hace, a propósito: no decide el CORS (el asset-store
 *  lo pone en su `createServer`, el fake en su `send`) y no conoce el
 *  directorio de estilos. Es cable, no política. */
import type { ServerResponse } from "node:http";

import { AssetStoreApi } from "../../src/contracts/asset-store.js";
import { matchRoute, type EndpointTable, type RouteMatch } from "../../src/contracts/http.js";

/** La ruta de una petición, ya normalizada, tal como la lee el asset-store.
 *
 *  `new URL(...)` normaliza `..`, `%2e%2e` y los `%XX` del pathname; el recorte
 *  de la barra final es lo que hace que `/styles/x/cover.jpg/` y
 *  `/styles/x/cover.jpg` sean la misma ruta. Escribirlo «parecido» en dos
 *  sitios es exactamente lo que produjo dos de los cuatro desvíos. */
export interface RequestPath {
  /** Pathname normalizado, sin barra final (o "/" si no quedaba nada). */
  path: string;
  /** Segmentos no vacíos del pathname. */
  parts: string[];
  /** La query, para quien la necesite (`/assets?limit=`). */
  query: URLSearchParams;
}

export function parseRequestPath(rawUrl: string | undefined): RequestPath {
  const url = new URL(rawUrl ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return { path, parts: path.split("/").filter(Boolean), query: url.searchParams };
}

/** Los segmentos, vueltos a unir: lo que se le da a `matchRoute`.
 *
 *  No es `path`: `parts` ya se comió las barras dobles interiores
 *  (`filter(Boolean)`), y las rutas con `{param}` del store las han colapsado
 *  siempre (`/cache//surface/x` es el blob `x`). `matchRoute` no colapsa a
 *  propósito, así que dárselo sin esto cambiaría el cable. */
export function rutaDePartes(parts: string[]): string {
  return "/" + parts.join("/");
}

/** Qué endpoint de `table` pidió esta URL, leída como la lee el asset-store.
 *
 *  Es `matchRoute` más UNA rareza del router de los trece `if`, conservada a
 *  propósito porque cambiarla es cambiar el cable (tanda BR): la barra doble
 *  interior se colapsa en las rutas con parámetros —que leían segmentos— y NO
 *  en las literales —que comparaban el path entero—. `POST /cache//prune` es
 *  404, `/cache//surface/x` es el blob. Unificarlo es una decisión de wire, no
 *  de este refactor. */
export function casarRuta<T extends EndpointTable>(
  table: T,
  method: string,
  pedido: RequestPath,
): RouteMatch<Extract<keyof T, string>> | null {
  const match = matchRoute(table, method, rutaDePartes(pedido.parts));
  const literal = match !== null && Object.keys(match.params).length === 0;
  if (literal && pedido.path !== table[match.key].path) return null;
  return match;
}

/** Las dos rutas de estilos del contrato, y solo esas: es la tabla con la que
 *  el motor falso del bench decide qué URL es de estilos. */
const RUTAS_DE_ESTILOS = {
  getStyleFile: AssetStoreApi.getStyleFile,
  getStyleRoleFile: AssetStoreApi.getStyleRoleFile,
} as const;

/** El `file` que se le da a `readStyleFile`: con la carpeta de rol delante si
 *  la URL la traía. Quien valide el nombre es el lector, no esto. */
export function ficheroDeEstilo(params: Record<string, string>): string {
  return params.role === undefined ? params.file : `${params.role}/${params.file}`;
}

/** ¿Es esto un `GET /styles/{style_id}/{file}` (o con su carpeta de rol)?
 *  Devuelve sus dos piezas o null.
 *
 *  Sale de `AssetStoreApi` (`getStyleFile` + `getStyleRoleFile`), la misma
 *  tabla que enruta el store: el fake no tiene una definición propia de qué URL
 *  es de estilos. De ahí los 3 o 4 segmentos, y no más. */
export function matchStylesRoute(
  method: string,
  parts: string[],
): { styleId: string; file: string } | null {
  const match = matchRoute(RUTAS_DE_ESTILOS, method, rutaDePartes(parts));
  return match ? { styleId: match.params.style_id, file: ficheroDeEstilo(match.params) } : null;
}

/** Lo que devuelve un lector de blobs (`readBlob`, `readStyleFile`…). Se declara
 *  aquí y no en `blob-store.ts` para que quien solo emite no tenga que importar
 *  el lector — y para que el tipo sea el mismo a los dos lados del cable. */
export interface WireBlob {
  status: number;
  contentType: string;
  body: Buffer;
  cacheControl?: string;
}

/** Emite un blob: status, tipo, **`Content-Length`** y el `Cache-Control` que
 *  traiga el lector, más las cabeceras que añada quien llama (el CORS).
 *
 *  El `Content-Length` está aquí y no en cada servidor porque su ausencia es
 *  invisible: sin él la respuesta sale *chunked*, un `<img>` no lo nota, y la
 *  diferencia solo aparece cuando alguien la busca. Una diferencia que nadie
 *  mide es la que después explica una hora de bench. */
export function writeBlob(
  res: ServerResponse,
  r: WireBlob,
  extra: Record<string, string> = {},
): void {
  res.writeHead(r.status, {
    "Content-Type": r.contentType,
    "Content-Length": r.body.byteLength,
    ...(r.cacheControl ? { "Cache-Control": r.cacheControl } : {}),
    ...extra,
  });
  res.end(r.body);
}
