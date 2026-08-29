/** El CABLE de `GET /styles/{style_id}/{file}`: cómo se lee la ruta y cómo se
 *  emite el blob. Sin `ManifestDb`, sin `node:sqlite` y sin nada del almacén.
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

/** ¿Es esto un `GET /styles/{style_id}/{file}`? Devuelve sus dos piezas o null.
 *
 *  El `file` admite UNA subcarpeta de rol (`faces/fachada.jpg`), que es el
 *  formato de los packs por vista: de ahí los 3 o 4 segmentos. Quien valide el
 *  nombre es `readStyleFile`, no esto — aquí solo se decide QUÉ ruta es. */
export function matchStylesRoute(
  method: string,
  parts: string[],
): { styleId: string; file: string } | null {
  if (method !== "GET" || parts[0] !== "styles") return null;
  if (parts.length !== 3 && parts.length !== 4) return null;
  return { styleId: parts[1], file: parts.slice(2).join("/") };
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
