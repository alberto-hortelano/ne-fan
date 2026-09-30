/** La tabla ruta→handler del asset-store, DERIVADA de `AssetStoreApi` en vez
 *  de copiada a mano.
 *
 *  Hasta la tanda BR el router era una cadena de trece guardas
 *  `method === … && parts[1] === …` que duplicaba una tabla que el contrato ya
 *  declaraba y que nadie leía en tiempo de ejecución: `GET /health` se servía
 *  sin estar en el contrato, la subcarpeta de rol de los estilos tampoco, y la
 *  precedencia de `/cache/sprite_hero/{key}` sobre `/cache/{kind}/{hash}`
 *  colgaba del ORDEN de los `if` con un comentario avisándolo. Es el mismo
 *  caso que el State API cerró con `bridge/state-http/routes.ts`, y la misma
 *  garantía, que va en el TIPO:
 *   1. un endpoint del contrato sin handler → falla `Record<AssetStoreRouteKey, …>`;
 *   2. un handler sin endpoint → el mismo literal, por propiedad sobrante (aquí
 *      no hay spreads que se la traguen: la tabla es UN objeto literal).
 *  Las dos comprobadas rompiéndolas a mano (implementacion.md de la tanda BR).
 *  La precedencia la decide `matchRoute` por especificidad, no esta tabla.
 *
 *  Sin transporte, como `bridge/state-http/context.ts`: un handler recibe
 *  params, query y un lector de cuerpo, y devuelve QUÉ contestar; cómo se
 *  escribe en el socket es de `http-server.ts`, que es su único sitio (regla
 *  `handlers-sin-servidor` de arch-rules.json). Cada handler es el cuerpo de
 *  su antiguo `if`, sin cambiar un status ni un byte de lo que emite. */
import type { ErrorResponse } from "../../src/contracts/common.js";
import type {
  AssetByHashResponse,
  AssetCharacterRegisterRequest,
  AssetCharacterRegisterResponse,
  AssetKind,
  AssetListResponse,
  AssetPinResponse,
  AssetRegisterResponse,
  AssetStoreHealthResponse,
  AssetUnpinResponse,
  CachePruneResponse,
} from "../../src/contracts/asset-store.js";
import {
  AssetStoreApi,
  SURFACE_KINDS,
  esKindDePersonaje,
  KIND_BLOB_PLANO,
  refDeArteDePersonaje,
} from "../../src/contracts/asset-store.js";
import {
  AssetCharacterRegisterRequestSchema,
  AssetPinRequestSchema,
  AssetRegisterRequestSchema,
} from "../../src/contracts/request-schemas.js";
import { formatZodError } from "../../src/contract/model-io/validate.js";
import type { FiltroDeListado, ManifestDb, RegistroDeAsset } from "./manifest-db.js";
import { readBlob, readSpriteHero, readSpriteSheetFrame, readStyleFile } from "./blob-store.js";
import { ficheroDeEstilo, type WireBlob } from "./http-wire.js";
import { fetchKeepList, prune } from "./prune.js";

export interface AssetStoreServerOptions {
  port: number;
  db: ManifestDb;
  /** Raíz de blobs por kind — ver AssetStoreConfig.blobDirs. */
  blobDirs: Record<AssetKind, string>;
  stylesDir: string;
  cacheMaxBytes: number;
  /** Base del world-state para la keep-list del prune (resolveServiceUrl). */
  worldStateUrl: string;
}

export type AssetStoreRouteKey = keyof typeof AssetStoreApi;

/** Lo que un handler sabe de la petición: ya enrutada, sin socket. */
export interface AssetRouteRequest {
  /** Los `{param}` de la plantilla, SIN decodificar (como los da `matchRoute`). */
  params: Record<string, string>;
  query: URLSearchParams;
  /** El cuerpo JSON; `undefined` si venía vacío. Rechaza si no es JSON o si
   *  pasa del tope — y ese rechazo es el 500 del servidor. */
  readBody: () => Promise<unknown>;
}

/** QUÉ contestar. Los errores de blob son texto plano (cable de FastAPI) y los
 *  de los endpoints JSON, `ErrorResponse`: por eso hay tres formas y no una. */
export type AssetRouteResult =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "text"; status: number; body: string }
  | { kind: "blob"; blob: WireBlob };

export type AssetRouteHandler = (
  opts: AssetStoreServerOptions,
  req: AssetRouteRequest,
) => AssetRouteResult | Promise<AssetRouteResult>;

/** La query de `GET /assets` ya leída, o por qué es un 400. Función pura y
 *  fuera del handler para que el parseo tenga test propio. Un filtro presente
 *  pero vacío es un error, no «sin filtro»: `?style=` sin valor devolvería la
 *  librería de TODOS los estilos, que es justo lo que el filtro impide. */
export type ConsultaLeida =
  | { ok: true; assetType: string | undefined; limit: number; filtro: FiltroDeListado }
  | { ok: false; error: string };

export function leerConsultaDeListado(query: URLSearchParams): ConsultaLeida {
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isFinite(limit) || limit < 0) return { ok: false, error: `invalid limit "${rawLimit}"` };
  const filtro: FiltroDeListado = {};
  const style = query.get("style");
  if (style !== null) {
    if (style.trim() === "") return { ok: false, error: "invalid style \"\": omit it or give the cache-key style" };
    filtro.style = style;
  }
  const kind = query.get("surface_kind");
  if (kind !== null) {
    if (!(SURFACE_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: `invalid surface_kind "${kind}" (expected ${SURFACE_KINDS.join(" | ")})` };
    }
    filtro.surfaceKind = kind;
  }
  return { ok: true, assetType: query.get("asset_type") ?? undefined, limit, filtro };
}

const json = (status: number, body: unknown): AssetRouteResult => ({ kind: "json", status, body });
const blob = (b: WireBlob): AssetRouteResult => ({ kind: "blob", blob: b });

export const RUTAS: Record<AssetStoreRouteKey, AssetRouteHandler> = {
  // Nuevo, aditivo respecto a FastAPI — probe del launcher y del ai_server.
  health: ({ db }) =>
    json(200, {
      ok: true,
      total_count: db.totalCount(),
      total_bytes: db.totalBytes(),
    } satisfies AssetStoreHealthResponse),

  // Solo KIND_BLOB_PLANO; el resto 400 (blob-store.ts).
  getBlob: ({ db, blobDirs }, { params }) => {
    const result = readBlob(blobDirs, params.kind, params.hash);
    if (result.touched) db.touch(result.touched);
    return blob(result);
  },

  getSpriteSheetFrame: ({ blobDirs }, { params }) =>
    blob(readSpriteSheetFrame(blobDirs, params.hash, params.filename)),

  getSpriteHero: ({ blobDirs }, { params }) => blob(readSpriteHero(blobDirs, params.key)),

  prune: async (opts) => {
    if (opts.cacheMaxBytes <= 0) {
      return json(400, {
        ok: false,
        error: "cache_max_bytes is 0 (no limit configured)",
      } satisfies ErrorResponse);
    }
    const keepRes = await fetchKeepList(opts.worldStateUrl);
    if (!keepRes.ok) {
      // Sin keep-list no se puede saber qué assets referencian los saves; los
      // saves post-F2 referencian por hash, así que podar sin ella borraría
      // assets en uso (resume con texturas rotas). Se ABORTA en vez de podar
      // a ciegas — mejor no liberar espacio que corromper una partida. La
      // causa real (timeout, DNS, 500, JSON corrupto) viaja al log Y al 503:
      // quien depura el prune no tiene otra traza.
      console.warn(`asset-store prune: keep-list no disponible (${keepRes.error}) — prune ABORTADO`);
      return json(503, {
        ok: false,
        error: `keep-list unavailable (${keepRes.error}): prune aborted to avoid deleting in-use assets`,
      } satisfies ErrorResponse);
    }
    const keep = keepRes.keep;
    // Protegidos = referenciados por saves vivos ∪ pineados (aplicaciones de
    // estilo a juegos: assets pre-generados sin save que los referencie aún).
    for (const h of opts.db.pinnedHashes()) keep.add(h);
    const summary = prune(opts.db, opts.blobDirs, opts.cacheMaxBytes, keep);
    return json(200, { ok: true, ...summary } satisfies CachePruneResponse);
  },

  listAssets: ({ db }, { query }) => {
    const consulta = leerConsultaDeListado(query);
    if (!consulta.ok) {
      return json(400, { ok: false, error: consulta.error } satisfies ErrorResponse);
    }
    const { assetType, limit, filtro } = consulta;
    return json(200, {
      assets: db.listAssets(assetType, limit, filtro),
      total: db.totalCount(),
    } satisfies AssetListResponse);
  },

  getAssetByHash: ({ db }, { params }) => {
    const hash = params.hash;
    const matches = db.findByHash(hash);
    if (matches.length === 0) {
      // 404 TEXTO PLANO, como el Response(content="Not found") de FastAPI.
      return { kind: "text", status: 404, body: "Not found" };
    }
    db.touch(hash);
    // `cache_url` SOLO para el kind que sirve el catch-all: desde #376 el
    // índice tiene además los dos del arte de personaje, y una URL
    // `/cache/sprite_sheet/{hash}` no sirve nada (el sheet es un directorio
    // de frames). Prometerla sería un 400 con forma de enlace.
    const enriched = matches.map((m) =>
      m.type === KIND_BLOB_PLANO ? { ...m, cache_url: `/cache/${m.type}/${hash}` } : m,
    );
    return json(200, { matches: enriched } satisfies AssetByHashResponse);
  },

  pinAssets: async ({ db }, { readBody }) => {
    const parsed = AssetPinRequestSchema.safeParse(await readBody());
    if (!parsed.success) {
      return json(400, { ok: false, error: formatZodError(parsed.error) } satisfies ErrorResponse);
    }
    db.pin(parsed.data.ref, parsed.data.hashes);
    return json(200, {
      ok: true,
      ref: parsed.data.ref,
      pinned: parsed.data.hashes.length,
    } satisfies AssetPinResponse);
  },

  unpinAssets: ({ db }, { params }) => {
    // El matcher no decodifica (a propósito, ver `RouteMatch`); el unpin sí,
    // y siempre lo hizo: el cliente manda el ref con `encodeURIComponent`.
    const ref = decodeURIComponent(params.ref);
    const removed = db.unpin(ref);
    return json(200, { ok: true, ref, removed } satisfies AssetUnpinResponse);
  },

  // Registro remoto — sustituye la escritura in-process.
  registerAsset: async ({ db }, { readBody }) => {
    // Borde de entrada: espejo zod del contrato (request-schemas.ts, con
    // guardia de deriva) en vez del predicado a mano.
    const cuerpo = await readBody();
    const parsed = AssetRegisterRequestSchema.safeParse(cuerpo);
    if (!parsed.success) {
      return json(400, {
        ok: false,
        error: `${formaEsperada(cuerpo)} — ${formatZodError(parsed.error)}`,
      } satisfies ErrorResponse);
    }
    // created_at lo estampa el store (como _now() en register()); duplicado
    // (mismo hash+type+subtype) = éxito idempotente, igual que el return
    // silencioso del Python. NO se verifica el blob en disco: hay entradas
    // legítimas sin blob propio (analysis, bbox legadas).
    db.register(parsed.data);
    return json(200, { ok: true } satisfies AssetRegisterResponse);
  },

  // El arte de UN personaje, en una transacción.
  registerCharacterArt: async ({ db }, { readBody }) => {
    const parsed = AssetCharacterRegisterRequestSchema.safeParse(await readBody());
    if (!parsed.success) {
      return json(400, {
        ok: false,
        error:
          `body requires { hero_key, hero?: { prompt, size_bytes, extra? }, sheets?: [{ hash, prompt, size_bytes, extra? }] } ` +
          `— el ref de pin lo DERIVA el store de hero_key, no viaja por fila (#376) — ${formatZodError(parsed.error)}`,
      } satisfies ErrorResponse);
    }
    const { ref, rows } = registrarPersonaje(db, parsed.data);
    return json(200, { ok: true, ref, rows } satisfies AssetCharacterRegisterResponse);
  },

  // Movido desde world-state en F2.
  getStyleFile: ({ stylesDir }, { params }) =>
    blob(readStyleFile(stylesDir, params.style_id, ficheroDeEstilo(params))),

  getStyleRoleFile: ({ stylesDir }, { params }) =>
    blob(readStyleFile(stylesDir, params.style_id, ficheroDeEstilo(params))),
};

/** Qué forma pedía `POST /assets`, y a dónde va lo que no cabe ahí.
 *
 *  El cliente es fail-loud (`asset_store_client.py` lanza con el cuerpo
 *  dentro), así que este texto es lo que ve quien depura una generación que se
 *  ha caído. Un «type: Invalid literal» a secas no dice que el arte de
 *  personaje tiene su propia ruta ni por qué. */
function formaEsperada(cuerpo: unknown): string {
  const type = (cuerpo as { type?: unknown } | null)?.type;
  return typeof type === "string" && esKindDePersonaje(type)
    ? `el arte de personaje no se registra fila a fila por aquí: va entero por POST /assets/character ` +
        `(hero + sheets en una transacción, con el ref de pin DERIVADO de hero_key — #376)`
    : "body requires { hash (16 hex), type, subtype, prompt, size_bytes, extra? }";
}

/** El arte de un personaje: sus filas y su pin, en una transacción.
 *
 *  El `ref` sale de `hero_key` y de nada más, y las N filas van bajo ESE ref.
 *  Que el `character_ref` acabe también en el `extra` de cada fila es
 *  procedencia (dice de quién es cada blob), no una entrada: lo estampa el
 *  store desde la misma fuente que el pin, así que los dos no pueden
 *  discrepar. Con la forma anterior sí podían, y el QA lo midió: un sheet
 *  declaraba el ref de otro personaje y soltar A se llevaba los frames de B. */
function registrarPersonaje(
  db: ManifestDb,
  data: AssetCharacterRegisterRequest,
): { ref: string; rows: number } {
  const ref = refDeArteDePersonaje(data.hero_key);
  const conProcedencia = (extra: Record<string, unknown> | undefined): Record<string, unknown> => ({
    ...extra,
    character_ref: data.hero_key,
  });
  const filas: RegistroDeAsset[] = [];
  if (data.hero) {
    filas.push({
      hash: data.hero_key,
      type: "sprite_hero",
      subtype: "sprite_hero",
      prompt: data.hero.prompt,
      size_bytes: data.hero.size_bytes,
      extra: conProcedencia(data.hero.extra),
    });
  }
  for (const s of data.sheets ?? []) {
    filas.push({
      hash: s.hash,
      type: "sprite_sheet",
      subtype: "sprite_sheet",
      prompt: s.prompt,
      size_bytes: s.size_bytes,
      extra: conProcedencia(s.extra),
    });
  }
  db.registrarArteDePersonaje(filas, ref);
  return { ref, rows: filas.length };
}
