/** Tests del asset-store (services/asset-store/): cable HTTP exacto del
 *  router FastAPI original, escrituras concurrentes (el criterio "hecho" de
 *  F2 — imposible con el rewrite de 5,8 MB del JSON) y prune LRU con
 *  keep-list. El índice admite los kinds de `ASSET_KINDS` y el catch-all de
 *  blobs solo `KIND_BLOB_PLANO`: aquí se fija que cualquier otro es 400 en el
 *  blob y en el registro, y que el arte de personaje entra PINEADO o no
 *  entra (#376).
 *
 *  Lo que se fue con #257 y ya no tiene sujeto: la ruta muerta `/cache/check`
 *  (400 por caer en el catch-all), los blobs de los siete kinds sin productor
 *  (albedo/normal/roughness de textures/, plate de scenes/, model GLB) y la
 *  migración one-shot desde manifest.json con su recovery scan. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import type { AssetKind } from "../src/contracts/asset-store.js";
import { refDeArteDePersonaje } from "../src/contracts/asset-store.js";
import { ManifestDb } from "../services/asset-store/manifest-db.js";
import { loadAssetStoreConfig } from "../services/asset-store/config.js";
import { createAssetStoreServer } from "../services/asset-store/http-server.js";
import { fetchKeepList, prune } from "../services/asset-store/prune.js";

let root: string;
let db: ManifestDb;
let server: Server;
let baseUrl: string;
let worldState: Server;
let keepRefs: string[] = [];

function surfaceDir(base: string): string {
  return join(base, "surfaces");
}

/** Las tres raíces de blobs, con la misma forma que `loadAssetStoreConfig`:
 *  el hero cuelga de `heroes/` DENTRO de la raíz de sheets. */
function blobDirs(base: string): Record<AssetKind, string> {
  return {
    surface: surfaceDir(base),
    sprite_sheet: join(base, "sprite_sheets"),
    sprite_hero: join(base, "sprite_sheets", "heroes"),
  };
}

/** Un blob de superficie en disco: {base}/surfaces/{hash}/surface.png. */
function writeSurface(base: string, hash: string, bytes = 4): void {
  const dir = join(surfaceDir(base), hash);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "surface.png"), Buffer.alloc(bytes, 1));
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "asset-store-test-"));
  db = new ManifestDb(join(root, "manifest.sqlite3"));

  // world-state fake para la keep-list del prune.
  worldState = createServer((req, res) => {
    if ((req.url ?? "").startsWith("/sessions/asset_refs")) {
      const body = JSON.stringify({ refs: keepRefs });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  });
  worldState.listen(0, "127.0.0.1");
  await new Promise<void>((r) => worldState.on("listening", () => r()));
  const wsPort = (worldState.address() as AddressInfo).port;

  server = createAssetStoreServer({
    port: 0,
    db,
    blobDirs: blobDirs(root),
    stylesDir: fileURLToPath(new URL("../data/styles", import.meta.url)),
    cacheMaxBytes: 1024 * 1024,
    worldStateUrl: `http://127.0.0.1:${wsPort}`,
  });
  await new Promise<void>((r) => server.on("listening", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  worldState.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function getRaw(path: string): Promise<{ status: number; contentType: string; body: Buffer }> {
  const res = await fetch(`${baseUrl}${path}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body: Buffer.from(await res.arrayBuffer()),
  };
}

async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("loadAssetStoreConfig", () => {
  it("resuelve las rutas del snapshot a absolutas desde la raíz del repo, y el puerto admite override por env", () => {
    const cfg = loadAssetStoreConfig({});
    assert.ok(
      isAbsolute(cfg.blobDirs.surface) && cfg.blobDirs.surface.endsWith(join("cache", "surfaces")),
      cfg.blobDirs.surface,
    );
    assert.ok(isAbsolute(cfg.dbPath) && cfg.dbPath.endsWith(join("cache", "manifest.sqlite3")), cfg.dbPath);
    assert.ok(cfg.blobDirs.sprite_sheet.endsWith(join("cache", "sprite_sheets")), cfg.blobDirs.sprite_sheet);
    // El hero cuelga DENTRO de la raíz de sheets: el prune borra exactamente
    // lo que `rutaDeBlob` devuelve, así que si estas dos raíces se separaran
    // el barrido de un hero se llevaría por delante otra carpeta.
    assert.equal(cfg.blobDirs.sprite_hero, join(cfg.blobDirs.sprite_sheet, "heroes"));
    assert.ok(isAbsolute(cfg.stylesDir), cfg.stylesDir);
    assert.equal(typeof cfg.port, "number");
    // El puerto del catálogo, salvo que el launcher lo desplace (NEFAN_PORT_OFFSET → env).
    assert.equal(loadAssetStoreConfig({ NEFAN_ASSET_STORE_PORT: "18767" }).port, 18767);
  });
});

describe("CORS (espejo del CORSMiddleware de los FastAPI)", () => {
  it("toda respuesta lleva Access-Control-Allow-Origin: * (el cliente pide blobs con crossOrigin)", async () => {
    // Blob (aunque sea miss), JSON y error: la cabecera va SIEMPRE — sin
    // ella Chrome bloquea la imagen y el decode() del plató da EncodingError.
    for (const path of ["/cache/surface/nadaquever", "/health", "/no-existe"]) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.equal(res.headers.get("access-control-allow-origin"), "*", path);
    }
  });

  it("preflight OPTIONS → 204 con métodos y cabeceras permitidos", async () => {
    const res = await fetch(`${baseUrl}/assets`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
  });
});

describe("cable exacto de blobs (cache_assets.py)", () => {
  it("solo el kind surface: cualquier otro → 400 texto 'Invalid kind'; miss en disco → 404 'Not found'", async () => {
    // Los siete kinds que este store sirvió hasta #257 son hoy tan
    // desconocidos como `nonsense`: no hay tabla que los mapee a un directorio.
    // `sprite_sheet` está en el ÍNDICE desde #376 y aun así es 400 aquí: es
    // un directorio de N frames y se sirve por `/cache/sprite_sheet/{h}/{f}`.
    // «Kinds del índice» y «kinds servibles por el catch-all» dejaron de
    // coincidir, y este 400 es lo que lo fija.
    for (const kind of ["nonsense", "albedo", "normal", "roughness", "model", "skin", "sprite", "scene", "plate", "segment", "check", "sprite_sheet"]) {
      const r = await getRaw(`/cache/${kind}/abc`);
      assert.equal(r.status, 400, kind);
      assert.equal(r.body.toString(), "Invalid kind", kind);
      assert.match(r.contentType, /^text\/plain/);
    }
    const miss = await getRaw("/cache/surface/nadaquever");
    assert.equal(miss.status, 404);
    assert.equal(miss.body.toString(), "Not found");
  });

  it("sprite_sheet: regex del filename → 400 'Invalid filename'; frame válido se sirve", async () => {
    const bad = await getRaw("/cache/sprite_sheet/h1/evil.png");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.toString(), "Invalid filename");
    mkdirSync(join(root, "sprite_sheets", "h1"), { recursive: true });
    writeFileSync(join(root, "sprite_sheets", "h1", "dir_0_frame_001.png"), Buffer.alloc(3, 1));
    assert.equal((await getRaw("/cache/sprite_sheet/h1/dir_0_frame_001.png")).status, 200);
  });

  it("sprite_hero: el retrato reusa el hero ya pagado; key inválida → 400", async () => {
    // La ruta tiene tres segmentos: si se registrara DESPUÉS del catch-all
    // /cache/{kind}/{hash}, caería ahí como un kind inexistente (400 "Invalid
    // kind") en vez de servir la imagen.
    const bad = await getRaw("/cache/sprite_hero/no-es-un-hash");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.toString(), "Invalid filename");
    assert.equal((await getRaw("/cache/sprite_hero/0123456789abcdef")).status, 404);
    mkdirSync(join(root, "sprite_sheets", "heroes"), { recursive: true });
    writeFileSync(join(root, "sprite_sheets", "heroes", "0123456789abcdef.png"), Buffer.alloc(4, 7));
    const ok = await getRaw("/cache/sprite_hero/0123456789abcdef");
    assert.equal(ok.status, 200);
    assert.equal(ok.contentType, "image/png");
  });

  it("styles: traversal inofensivo, id inválido → 400, manifest real con Cache-Control", async () => {
    // %2e%2e lo normaliza new URL() en el server: nunca llega a /styles y
    // jamás sirve el fichero de un nivel arriba.
    const evil = await getRaw("/styles/%2e%2e/runtime_config.json");
    assert.notEqual(evil.status, 200);
    // styleId con caracteres fuera de SAFE_ID → 400 del handler
    assert.equal((await getRaw("/styles/mal%25id/style.json")).status, 400);
    const res = await fetch(`${baseUrl}/styles/medievo_crudo/style.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("cache-control"), "max-age=300");
  });

  /** Los CUATRO desvíos que midió QA entre este servidor y la copia a mano que
   *  el motor falso tenía de esta ruta (#280). Ya no hay copia: el fake importa
   *  `parseRequestPath` + `readStyleFile` + `writeBlob` de aquí mismo, así que
   *  lo que este test fija es el cable ÚNICO, no una paridad entre dos.
   *
   *  Se prueban desde HTTP y no llamando a las funciones porque los dos que se
   *  escapaban vivían justo fuera del lector: la barra final es de la ruta y el
   *  `Content-Length` de la emisión. */
  it("styles: los cuatro bordes del cable (%2E, barra final, Content-Length, fichero-punto)", async () => {
    // 1 · `%2E` NO es un punto: `new URL` no lo decodifica en el pathname, así
    //     que el fichero no tiene extensión → 400. (La copia daba 200 con la
    //     imagen dentro.)
    assert.equal((await getRaw("/styles/medievo_crudo/cover%2Ejpg")).status, 400);

    // 2 · Una barra final es la MISMA ruta: 200 con la imagen. (La copia daba
    //     400.)
    const conBarra = await fetch(`${baseUrl}/styles/medievo_crudo/cover.jpg/`);
    assert.equal(conBarra.status, 200);
    assert.equal(conBarra.headers.get("content-type"), "image/jpeg");
    // 2 bis · Y la barra final se recorta del PATH, no solo de los segmentos:
    //     `filter(Boolean)` ya se come el segmento vacío, así que la ruta de
    //     estilos saldría igual con y sin recorte y el aserto de arriba no
    //     podría ponerse rojo. Quien lo nota es una ruta de igualdad exacta.
    assert.equal((await getRaw("/health/")).status, 200);

    // 3 · `Content-Length` real, no chunked. Es invisible para un <img>, y por
    //     eso se escapó: se afirma contra los bytes que de verdad llegan.
    const bytes = Buffer.from(await conBarra.arrayBuffer());
    assert.equal(conBarra.headers.get("content-length"), String(bytes.byteLength));

    // 4 · Fichero-punto: `.jpg` a secas no tiene extensión para `extname` → 400.
    assert.equal((await getRaw("/styles/medievo_crudo/.jpg")).status, 400);

    // Y la subcarpeta de rol sigue viva (3 o 4 segmentos, no más).
    assert.equal((await getRaw("/styles/medievo_crudo/faces/x/y.jpg")).status, 404);
  });
});

describe("registro e índice", () => {
  it("POST /assets: shape inválido → 400; kind sin productor → 400 (zod); válido → {ok:true}; duplicado idempotente", async () => {
    assert.equal((await post("/assets", { hash: "x" })).status, 400);
    // Borde zod (request-schemas): campo con tipo/rango inválido también 400.
    assert.equal(
      (await post("/assets", { hash: "aaaaaaaaaaaaaaaa", type: "surface", subtype: "surface", prompt: "p", size_bytes: -1 })).status,
      400,
    );
    // Un hash sin forma de hash es 400: el prune borra `rutaDeBlob(kind,hash)`
    // con `rmSync recursive`, así que un nombre de directorio plausible o un
    // `../..` borrarían lo que no toca (medido por QA el 2026-09-03).
    //
    // Los DOS anclajes se prueban con carga útil, no solo con basura: el
    // `../../fuera` de arriba no lleva 16 hex, así que un `HASH_DE_ASSET` al
    // que le falte el `^` lo rechaza IGUAL y el test no se entera. Los dos
    // mutantes que sobrevivieron en la corrida 33790710680 eran exactamente
    // esos anclajes, y no eran equivalentes: sin `^`, `../../fuera` + 16 hex
    // pasa la validación y entra en una ruta que se borra con `rmSync`.
    for (const hash of [
      "heroes",
      "../../fuera",
      "NOESUNHASH",
      "abc",
      "../../fuera0123456789abcdef", // sin `^`: pasaría (el sufijo son 16 hex)
      "0123456789abcdef/../../etc", // sin `$`: pasaría (el prefijo son 16 hex)
    ]) {
      const r = await post("/assets", { hash, type: "surface", subtype: "surface", prompt: "p", size_bytes: 1 });
      assert.equal(r.status, 400, hash);
      assert.equal(db.findByHash(hash).length, 0, `${hash}: el 400 no deja fila`);
    }
    // El registro de un kind sin productor es 400 aquí, no una fila que el
    // prune nunca podrá tocar (#257). Hasta esta tanda entraba y se indexaba.
    const texture = await post("/assets", { hash: "7e7e7e7e7e7e7e7e", type: "texture", subtype: "albedo", prompt: "p", size_bytes: 1 });
    assert.equal(texture.status, 400);
    assert.match(String(texture.body.error), /type/);
    assert.equal(db.findByHash("7e7e7e7e7e7e7e7e").length, 0, "el 400 no deja fila");
    // Y el subtype también es el literal.
    assert.equal(
      (await post("/assets", { hash: "7e7e7e7e7e7e7e7f", type: "surface", subtype: "albedo", prompt: "p", size_bytes: 1 })).status,
      400,
    );
    const entry = { hash: "1e91e91e91e91e91", type: "surface", subtype: "surface", prompt: "piedra", size_bytes: 10 };
    assert.deepEqual((await post("/assets", entry)).body, { ok: true });
    assert.deepEqual((await post("/assets", entry)).body, { ok: true }); // dup = éxito
    assert.equal(db.findByHash("1e91e91e91e91e91").length, 1);
  });

  it("by_hash: cache_url /cache/surface/{hash}, touch, y 404 texto plano", async () => {
    await post("/assets", { hash: "b0b0b0b0b0b0b0b0", type: "surface", subtype: "surface", prompt: "p", size_bytes: 1 });
    const t = await getJson("/assets/by_hash/b0b0b0b0b0b0b0b0");
    assert.equal(t.status, 200);
    const matches = t.body.matches as Array<Record<string, unknown>>;
    assert.equal(matches.length, 1);
    assert.equal(matches[0].cache_url, "/cache/surface/b0b0b0b0b0b0b0b0");
    // touch estampó last_used
    assert.ok(db.findByHash("b0b0b0b0b0b0b0b0")[0].last_used);
    const miss = await getRaw("/assets/by_hash/noexiste");
    assert.equal(miss.status, 404);
    assert.equal(miss.body.toString(), "Not found");
  });

  it("GET /assets: más reciente primero, limit, filtro por type y lista vacía para un type sin filas", async () => {
    // Con un solo kind, `register` no puede producir dos subtypes del mismo
    // hash: el collapse por (hash,type) que aquí se medía con texturas
    // albedo/normal es inalcanzable por el wire desde #257 y se retiró con su
    // fixture (QA de T4, H3). Queda lo que sí puede pasar: orden por recencia,
    // `limit`, el filtro por type (CSV incluido) y un type que no existe.
    const fresh = new ManifestDb(join(root, "list.sqlite3"));
    for (const [h, p] of [["a", "pa"], ["b", "pb"], ["c", "pc"]]) {
      fresh.register({ hash: h, type: "surface", subtype: "surface", prompt: p, size_bytes: 1 });
    }
    const all = fresh.listAssets(undefined, 50);
    assert.deepEqual(all.map((e) => e.hash), ["c", "b", "a"], "la más reciente primero");
    assert.deepEqual(all.map((e) => e.subtype), ["surface", "surface", "surface"]);
    assert.equal(all[2].prompt, "pa");
    assert.equal(fresh.listAssets(undefined, 1).length, 1);
    assert.deepEqual(fresh.listAssets("surface", 50).map((e) => e.hash), ["c", "b", "a"]);
    // El filtro CSV sigue aceptando varios types: los que no tienen filas no
    // aportan nada, y uno solo desconocido es lista vacía, no error (es lo que
    // ve el motor si alguien le pide un kind retirado).
    assert.deepEqual(fresh.listAssets("texture,surface", 50).map((e) => e.hash), ["c", "b", "a"]);
    assert.deepEqual(fresh.listAssets("model", 50), []);
    // Registrar el mismo (hash,type,subtype) no crea otra fila ni cambia el orden.
    fresh.register({ hash: "a", type: "surface", subtype: "surface", prompt: "otro", size_bytes: 9 });
    assert.deepEqual(fresh.listAssets(undefined, 50).map((e) => e.hash), ["c", "b", "a"]);
    assert.equal(fresh.findByHash("a").length, 1);
    fresh.close();
  });

  it("kind surface: blob servido con touch y by_hash con cache_url", async () => {
    writeSurface(root, "5115115115115115");
    db.register({ hash: "5115115115115115", type: "surface", subtype: "surface", prompt: "aged plaster", size_bytes: 4 });
    const blob = await getRaw("/cache/surface/5115115115115115");
    assert.equal(blob.status, 200);
    assert.equal(blob.contentType, "image/png");
    const by = await getJson("/assets/by_hash/5115115115115115");
    assert.equal(by.status, 200);
    assert.equal(by.body.matches[0].cache_url, "/cache/surface/5115115115115115");
  });

  it("limit no numérico → 400 ErrorResponse (desviación documentada del 422)", async () => {
    const r = await getJson("/assets?limit=pollo");
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });
});

/** #376 — el arte de personaje entra en el índice CON su prompt y PINEADO, y
 *  el `ref` de pin NO es una entrada.
 *
 *  Lo que estos tests fijan no es «el store sabe registrarlo» sino que los
 *  estados malos no son EXPRESABLES: una fila sin pin (que el prune podría
 *  evictar, y con ella la skin de un NPC vivo), una fila de hero sin la
 *  descripción con la que se pagó, y —lo que el QA de esta PR tumbó de la
 *  primera forma— un sheet colgando del `ref` de otro personaje. */
describe("arte de personaje en el índice (#376)", () => {
  const HERO = "0123456789abcdef";
  const SHEET = "fedcba9876543210";
  const OTRO_HERO = "aaaabbbbccccdddd";

  const character = (cuerpo: unknown): Promise<{ status: number; body: Record<string, unknown> }> =>
    post("/assets/character", cuerpo);

  it("el arte de personaje NO entra por POST /assets, y el 400 dice por dónde va", async () => {
    // La puerta vieja se cierra: mientras existiera, el `character_ref` por
    // fila seguiría siendo escribible y con él la contradicción que el QA
    // midió (un sheet bajo el ref de otro personaje).
    for (const kind of ["sprite_hero", "sprite_sheet"] as const) {
      const r = await post("/assets", {
        hash: kind === "sprite_hero" ? HERO : SHEET,
        type: kind, subtype: kind, prompt: "Blas", size_bytes: 10,
        extra: { character_ref: HERO },
      });
      assert.equal(r.status, 400, kind);
      assert.match(String(r.body.error), /POST \/assets\/character/, kind);
      assert.equal(db.findByHash(kind === "sprite_hero" ? HERO : SHEET).length, 0, kind);
    }
  });

  it("una petición que no registra nada es 400: no hay «personaje vacío»", async () => {
    const r = await character({ hero_key: HERO });
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /al menos uno/);
  });

  it("sin prompt no hay registro: el arte de personaje sin procedencia es 400", async () => {
    // Es LA queja de #376: el hero-shot son ~60 % de los bytes pagados en
    // personajes y su prompt no se guardaba en ningún sitio. Indexarlo con el
    // prompt en blanco sería la misma mentira, ahora escrita en el índice.
    const sinHero = await character({ hero_key: HERO, hero: { prompt: "", size_bytes: 10 } });
    assert.equal(sinHero.status, 400);
    const sinSheet = await character({
      hero_key: HERO, sheets: [{ hash: SHEET, prompt: "", size_bytes: 10 }],
    });
    assert.equal(sinSheet.status, 400);
    assert.equal(db.findByHash(HERO).length, 0);
    assert.equal(db.findByHash(SHEET).length, 0);
    // La superficie SÍ admite prompt vacío (cable de siempre): la diferencia
    // es del kind, no una regla global que alguien haya endurecido de paso.
    assert.equal(
      (await post("/assets", { hash: "5195195195195195", type: "surface", subtype: "surface", prompt: "", size_bytes: 1 })).status,
      200,
    );
  });

  it("un hash sin forma de hash es 400 en las dos mitades (el prune borra lo que ese hash nombre)", async () => {
    // `heroes` es el nombre de la carpeta de hero-shots, que cuelga DENTRO de
    // la raíz de sheets: sin forma, una fila así hacía que el prune borrara la
    // carpeta entera dejando sus filas apuntando a nada (medido por QA).
    for (const malo of [
      "heroes",
      "../../fuera",
      "no-es-un-hash",
      "../../fuera0123456789abcdef",
      "0123456789abcdef/../../etc",
    ]) {
      assert.equal((await character({ hero_key: malo, hero: { prompt: "p", size_bytes: 1 } })).status, 400, malo);
      assert.equal(
        (await character({ hero_key: HERO, sheets: [{ hash: malo, prompt: "p", size_bytes: 1 }] })).status,
        400,
        malo,
      );
    }
    assert.equal(db.findByHash("heroes").length, 0);
  });

  it("registro válido: hero y sheets en UNA transacción, con el ref DERIVADO y la procedencia estampada", async () => {
    const r = await character({
      hero_key: HERO,
      hero: { prompt: "Blas, el tabernero", size_bytes: 900, extra: { model: "y_bot", angle: "frontal_8" } },
      sheets: [{ hash: SHEET, prompt: "Blas, el tabernero", size_bytes: 1_000, extra: { model: "y_bot", anim: "idle" } }],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, ref: refDeArteDePersonaje(HERO), rows: 2 });

    // El hash del hero es su hero_key: no se manda, así que no puede diferir.
    const fila = db.findByHash(HERO)[0];
    assert.equal(fila.type, "sprite_hero");
    assert.equal(fila.prompt, "Blas, el tabernero");
    // El `character_ref` lo ESTAMPA el store, de la misma fuente que el pin.
    assert.equal(fila.extra.character_ref, HERO);
    assert.equal(db.findByHash(SHEET)[0].extra.character_ref, HERO);
    // Y el resto de `extra` sobrevive: es con lo que se vuelve a pedir este
    // arte. Un `z.object` sin `.passthrough()` lo stripearía en silencio.
    assert.equal(fila.extra.model, "y_bot");
    assert.equal(db.findByHash(SHEET)[0].extra.anim, "idle");

    // Los dos pineados bajo el MISMO ref: por eso se sueltan juntos.
    assert.ok(db.pinnedHashes().has(HERO));
    assert.ok(db.pinnedHashes().has(SHEET));
    const listado = await getJson(`/assets?asset_type=sprite_hero&limit=50`);
    const filas = listado.body.assets as Array<Record<string, string>>;
    assert.ok(filas.some((f) => f.hash === HERO && f.prompt === "Blas, el tabernero"), JSON.stringify(filas));
  });

  it("un sheet de OTRO personaje no puede colgar de este ref: no hay campo en el que decirlo", async () => {
    // El hallazgo que tumbó la primera forma de esta PR: con `character_ref`
    // por fila, el sheet de B se registraba bajo el ref de A y soltar A se
    // llevaba sus frames (`removed: 3`). Aquí el ref sale de `hero_key` y de
    // nada más, así que el sheet que entra en la petición de A ES de A: no
    // existe la contradicción, y el pin del vecino no se toca.
    await character({ hero_key: OTRO_HERO, hero: { prompt: "Nuño", size_bytes: 10 } });
    const antes = [...db.pinnedHashes()].filter((h) => h === OTRO_HERO).length;
    // `extra.character_ref` es una clave más de `extra`, y el store la PISA.
    const r = await character({
      hero_key: HERO,
      sheets: [{ hash: "1234123412341234", prompt: "Blas", size_bytes: 10, extra: { character_ref: OTRO_HERO } }],
    });
    assert.equal(r.status, 200);
    assert.equal(db.findByHash("1234123412341234")[0].extra.character_ref, HERO, "el store estampa el suyo");
    // Y el ref del vecino sigue teniendo exactamente lo que tenía.
    assert.equal([...db.pinnedHashes()].filter((h) => h === OTRO_HERO).length, antes);
    const del = await fetch(`${baseUrl}/assets/pin/${encodeURIComponent(refDeArteDePersonaje(OTRO_HERO))}`, { method: "DELETE" });
    assert.deepEqual((await del.json()) as unknown, { ok: true, ref: refDeArteDePersonaje(OTRO_HERO), removed: 1 });
  });

  it("las dos ausencias son estados reales del productor: hero sin sheets, y sheets sin hero", async () => {
    // hero sin sheets = el barrido (`arte_de_personaje.py`): un hero cuyas
    // anims ya no están. sheets sin hero = un sheet servido de caché cuyo
    // hero se archivó; registrar su fila sería prometer un blob que no está.
    const soloHero = await character({ hero_key: "1111222233334444", hero: { prompt: "solo", size_bytes: 1 } });
    assert.deepEqual(soloHero.body, { ok: true, ref: "character:1111222233334444", rows: 1 });
    const soloSheets = await character({
      hero_key: "5555666677778888",
      sheets: [{ hash: "9999aaaabbbbcccc", prompt: "solo frames", size_bytes: 1 }],
    });
    assert.deepEqual(soloSheets.body, { ok: true, ref: "character:5555666677778888", rows: 1 });
    assert.equal(db.findByHash("5555666677778888").length, 0, "no se inventa la fila del hero");
    // Y los frames quedan pineados bajo el ref de su hero igual.
    assert.ok(db.pinnedHashes().has("9999aaaabbbbcccc"));
  });

  it("un solo DELETE suelta hero Y frames, y repetir la petición no duplica", async () => {
    const clave = "dddd0000eeee1111";
    const sheet = "dddd0000eeee2222";
    const cuerpo = {
      hero_key: clave,
      hero: { prompt: "Telmo", size_bytes: 10 },
      sheets: [{ hash: sheet, prompt: "Telmo", size_bytes: 10 }],
    };
    // El cache-hit apunta en CADA servida: idempotente por (hash,type,subtype).
    for (let i = 0; i < 3; i++) assert.equal((await character(cuerpo)).status, 200);
    assert.equal(db.findByHash(clave).length, 1);
    assert.equal(db.findByHash(sheet).length, 1);
    const ref = refDeArteDePersonaje(clave);
    const del = await fetch(`${baseUrl}/assets/pin/${encodeURIComponent(ref)}`, { method: "DELETE" });
    assert.deepEqual((await del.json()) as unknown, { ok: true, ref, removed: 2 });
    db.pin(ref, [clave, sheet]);
  });

  it("by_hash: el arte de personaje NO promete cache_url (esa forma no lo sirve)", async () => {
    const by = await getJson(`/assets/by_hash/${SHEET}`);
    assert.equal(by.status, 200);
    const m = (by.body.matches as Array<Record<string, unknown>>)[0];
    assert.equal(m.type, "sprite_sheet");
    assert.ok(!("cache_url" in m), JSON.stringify(m));
  });

  it("registrado por HTTP ⇒ protegido del prune en el mismo instante, sin que nadie pine aparte", async () => {
    // La cadena entera y la única que importa: zod → handler → filas + pin. Si
    // el handler llamara a `register` en vez de a `registrarArteDePersonaje`,
    // el arte entraría EVICTABLE y el prune podría borrar la skin de un NPC
    // vivo — que es lo que convertiría #376 en un empeoramiento.
    const base = join(root, "reciencreado");
    const d = blobDirs(base);
    const hero = "3333333333333333";
    mkdirSync(d.sprite_hero, { recursive: true });
    writeFileSync(join(d.sprite_hero, `${hero}.png`), Buffer.alloc(100));
    const pdb = new ManifestDb(join(root, "reciencreado.sqlite3"));
    const srv = createAssetStoreServer({
      port: 0, db: pdb, blobDirs: d,
      stylesDir: fileURLToPath(new URL("../data/styles", import.meta.url)),
      cacheMaxBytes: 1, worldStateUrl: "http://127.0.0.1:1",
    });
    await new Promise<void>((r) => srv.on("listening", () => r()));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/assets/character`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hero_key: hero, hero: { prompt: "Blas, el tabernero", size_bytes: 100 } }),
      });
      assert.equal(res.status, 200);
      const keep = new Set<string>(pdb.pinnedHashes());
      const s = prune(pdb, d, 1, keep);
      assert.equal(s.pruned, 0, "el arte recién registrado no se poda");
      assert.ok(existsSync(join(d.sprite_hero, `${hero}.png`)), "el hero sigue en disco");
      assert.equal(pdb.findByHash(hero).length, 1, "y sigue indexado");
    } finally {
      srv.close();
      pdb.close();
    }
  });

  it("si una fila de la petición no entra, no entra NINGUNA (ni el pin)", async () => {
    // La segunda grieta de la forma anterior, que nadie había mirado: con dos
    // POST, un fallo entre ellos dejaba un hero pineado sin sus frames. Aquí
    // la petición entera es una transacción.
    const pdb = new ManifestDb(join(root, "atomico.sqlite3"));
    const clave = "0f0f0f0f0f0f0f0f";
    assert.throws(() =>
      pdb.registrarArteDePersonaje(
        [
          { hash: clave, type: "sprite_hero", subtype: "sprite_hero", prompt: "Blas", size_bytes: 1 },
          // `extra` no serializable: revienta DENTRO de la transacción.
          { hash: "0f0f0f0f0f0f0f01", type: "sprite_sheet", subtype: "sprite_sheet", prompt: "Blas", size_bytes: 1, extra: { ciclo: circular() } },
        ],
        refDeArteDePersonaje(clave),
      ),
    );
    assert.equal(pdb.findByHash(clave).length, 0, "el hero no sobrevive al fallo de su sheet");
    assert.equal(pdb.pinnedHashes().size, 0, "y no queda pin colgando");
    pdb.close();
  });
});

/** Un objeto con un ciclo: `JSON.stringify` lanza sobre él. */
function circular(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  o.yo = o;
  return o;
}

describe("prune con los tres kinds (#376)", () => {
  /** Escribe el blob de cada kind con la FORMA que tiene en producción:
   *  dos directorios y un fichero suelto. */
  function sembrarBlobs(base: string, hash: string, hero: string): void {
    const d = blobDirs(base);
    mkdirSync(join(d.surface, hash), { recursive: true });
    writeFileSync(join(d.surface, hash, "surface.png"), Buffer.alloc(100));
    mkdirSync(join(d.sprite_sheet, hash), { recursive: true });
    writeFileSync(join(d.sprite_sheet, hash, "dir_0_frame_000.png"), Buffer.alloc(100));
    mkdirSync(d.sprite_hero, { recursive: true });
    writeFileSync(join(d.sprite_hero, `${hero}.png`), Buffer.alloc(100));
  }

  it("sin pins borra el blob correcto de CADA kind — y el hero es un fichero, no un directorio", () => {
    const base = join(root, "prune3kinds");
    const hero = "1111111111111111";
    sembrarBlobs(base, "h", hero);
    const d = blobDirs(base);
    const pdb = new ManifestDb(join(root, "prune3kinds.sqlite3"));
    pdb.importEntry({ hash: "h", type: "surface", subtype: "surface", prompt: "s", created_at: "2026-01-01T00:00:00.000Z", size_bytes: 100, extra: {} });
    pdb.importEntry({ hash: "h", type: "sprite_sheet", subtype: "sprite_sheet", prompt: "Blas", created_at: "2026-01-02T00:00:00.000Z", size_bytes: 100, extra: { character_ref: hero } });
    pdb.importEntry({ hash: hero, type: "sprite_hero", subtype: "sprite_hero", prompt: "Blas", created_at: "2026-01-03T00:00:00.000Z", size_bytes: 100, extra: { character_ref: hero } });

    const s = prune(pdb, d, 1, null);
    assert.equal(s.pruned, 3, "los tres grupos");
    assert.ok(!existsSync(join(d.surface, "h")), "surface: se va el directorio");
    assert.ok(!existsSync(join(d.sprite_sheet, "h")), "sprite_sheet: se va el directorio de frames");
    assert.ok(!existsSync(join(d.sprite_hero, `${hero}.png`)), "sprite_hero: se va el PNG");
    // Y no se lleva por delante la carpeta `heroes/` entera, que cuelga
    // DENTRO de la de sheets: borrar el directorio en vez del fichero
    // arrasaría los heroes de todos los demás personajes.
    assert.ok(existsSync(d.sprite_hero), "la carpeta heroes/ sigue ahí");
    pdb.close();
  });

  it("con el pin del personaje no borra ni el hero ni sus frames, y sí la superficie", () => {
    const base = join(root, "prune3pin");
    const hero = "2222222222222222";
    sembrarBlobs(base, "h", hero);
    const d = blobDirs(base);
    const pdb = new ManifestDb(join(root, "prune3pin.sqlite3"));
    pdb.importEntry({ hash: "h", type: "surface", subtype: "surface", prompt: "s", created_at: "2026-01-01T00:00:00.000Z", size_bytes: 100, extra: {} });
    pdb.importEntry({ hash: "h", type: "sprite_sheet", subtype: "sprite_sheet", prompt: "Blas", created_at: "2026-01-02T00:00:00.000Z", size_bytes: 100, extra: {} });
    pdb.importEntry({ hash: hero, type: "sprite_hero", subtype: "sprite_hero", prompt: "Blas", created_at: "2026-01-03T00:00:00.000Z", size_bytes: 100, extra: {} });
    pdb.pin(refDeArteDePersonaje(hero), ["h", hero]);

    // Lo que hace el handler: keep = saves ∪ pineados.
    const keep = new Set<string>(pdb.pinnedHashes());
    const s = prune(pdb, d, 1, keep);
    // El hash "h" tiene DOS grupos (surface y sprite_sheet) y el pin protege
    // por hash, así que aquí no se poda nada: es el comportamiento real del
    // pin, y el sheet queda protegido junto a su hero.
    assert.equal(s.pruned, 0);
    assert.ok(existsSync(join(d.sprite_sheet, "h")));
    assert.ok(existsSync(join(d.sprite_hero, `${hero}.png`)));
    pdb.close();
  });

  it("un type que no es un kind con productor es FAIL-LOUD, no un salto callado", () => {
    // El arranque lo impide (kinds-con-productor.ts), pero si alguna vez
    // colara, desindexar una fila cuyo blob no se sabe borrar es el estado que
    // #257 tardó meses en descubrir: 16.986 filas inmunes al prune.
    const pdb = new ManifestDb(join(root, "prune-ajeno.sqlite3"));
    pdb.importEntry({ hash: "7e7e7e7e7e7e7e7e", type: "texture", subtype: "albedo", prompt: "", created_at: "2026-01-01T00:00:00.000Z", size_bytes: 100, extra: {} });
    assert.throws(
      () => prune(pdb, blobDirs(join(root, "prune-ajeno")), 1, null),
      /type "texture".*no es un kind con productor/s,
    );
    assert.equal(pdb.findByHash("7e7e7e7e7e7e7e7e").length, 1, "la fila NO se desindexa");
    pdb.close();
  });
});

describe("concurrencia (criterio 'hecho' de F2)", () => {
  it("200 POST /assets en paralelo + lecturas intercaladas: cero pérdidas, DB íntegra", async () => {
    // Los hashes tienen la FORMA de un hash (16 hex): el zod la exige desde
    // #376, porque el prune borra `rutaDeBlob(kind, hash)` recursivamente.
    const ccHash = (n: number): string => `cc${String(n).padStart(14, "0")}`;
    const posts = Array.from({ length: 200 }, (_, i) =>
      post("/assets", {
        hash: ccHash(i % 150), // colisiones deliberadas de (hash,type,subtype)
        type: "surface",
        subtype: "surface",
        prompt: `concurrente ${i}`,
        size_bytes: i,
      }),
    );
    const reads = Array.from({ length: 20 }, () => getJson("/assets?asset_type=surface&limit=10"));
    const results = await Promise.all([...posts, ...reads]);
    for (const r of results) assert.equal(r.status, 200);
    // 200 posts sobre 150 claves únicas → exactamente 150 filas nuevas
    const count = db.findByHash(ccHash(0)).length;
    assert.equal(count, 1);
    const listed = await getJson("/assets?asset_type=surface&limit=500");
    const total = (listed.body.assets as unknown[]).length;
    assert.ok(total >= 150, `esperaba >=150 grupos surface, hay ${total}`);
    assert.equal(db.integrityCheck(), "ok");
  });
});

describe("prune LRU con keep-list", () => {
  it("evicta el más antiguo primero y respeta la keep-list", () => {
    const base = join(root, "prunefs");
    const pdb = new ManifestDb(join(root, "prune.sqlite3"));
    // 3 grupos de 100 bytes; techo 150 → debe evictar 2 (los más antiguos)
    for (const [i, h] of ["old", "mid", "new"].entries()) {
      writeSurface(base, h, 100);
      pdb.importEntry({
        hash: h, type: "surface", subtype: "surface", prompt: h,
        created_at: `2026-0${i + 1}-01T00:00:00.000Z`, size_bytes: 100, extra: {},
      });
    }
    // keep-list protege a "old": el eviction salta al siguiente
    const summary = prune(pdb, blobDirs(base), 150, new Set(["old"]));
    assert.equal(summary.pruned, 2);
    assert.equal(summary.freed_bytes, 200);
    assert.ok(existsSync(join(surfaceDir(base), "old")));
    assert.ok(!existsSync(join(surfaceDir(base), "mid")));
    assert.ok(!existsSync(join(surfaceDir(base), "new")));
    assert.equal(pdb.findByHash("old").length, 1);
    assert.equal(pdb.findByHash("mid").length, 0);
    pdb.close();
  });

  it("max_bytes <= 0 → no-op con el total real", () => {
    const pdb = new ManifestDb(join(root, "prune2.sqlite3"));
    pdb.register({ hash: "z", type: "surface", subtype: "surface", prompt: "", size_bytes: 42 });
    const s = prune(pdb, blobDirs(join(root, "nada")), 0, null);
    assert.deepEqual(s, { pruned: 0, freed_bytes: 0, total_bytes: 42 });
    pdb.close();
  });

  it("POST /cache/prune vía HTTP consulta la keep-list del world-state fake", async () => {
    keepRefs = ["1e91e91e91e91e91", "b0b0b0b0b0b0b0b0", "5115115115115115", "h1"];
    const r = await post("/cache/prune", {});
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.total_bytes, "number");
  });

  // Antes fetchKeepList devolvía `Set | null` y timeout, DNS, 500 y JSON
  // corrupto colapsaban en el mismo null: el 503 del prune no podía decir por
  // qué. El Result<T,E> existe para que cada causa llegue con su texto.
  describe("fetchKeepList distingue las causas", () => {
    /** Servidor de un solo uso que contesta lo que le digas. */
    async function conServidor(
      status: number,
      body: string,
      fn: (url: string) => Promise<void>,
    ): Promise<void> {
      const srv = createServer((_req, res) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      });
      srv.listen(0, "127.0.0.1");
      await new Promise<void>((r) => srv.on("listening", () => r()));
      try {
        await fn(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
      } finally {
        srv.close();
      }
    }

    it("HTTP 500 → la causa dice el status", async () => {
      await conServidor(500, "{}", async (url) => {
        const r = await fetchKeepList(url);
        assert.ok(!r.ok && r.error.includes("HTTP 500"), JSON.stringify(r));
      });
    });

    it("200 con JSON corrupto → la causa dice que es ilegible", async () => {
      await conServidor(200, "esto no es json", async (url) => {
        const r = await fetchKeepList(url);
        assert.ok(!r.ok && r.error.includes("ilegible"), JSON.stringify(r));
      });
    });

    it("200 sin refs[] → la causa señala el contrato", async () => {
      await conServidor(200, '{"otra_cosa": []}', async (url) => {
        const r = await fetchKeepList(url);
        assert.ok(!r.ok && r.error.includes("sin refs[]"), JSON.stringify(r));
      });
    });

    it("world-state caído → la causa dice inalcanzable, y el 503 del prune la lleva", async () => {
      // Puerto recién liberado: nadie escucha ahí.
      const muerto = createServer(() => {});
      muerto.listen(0, "127.0.0.1");
      await new Promise<void>((r) => muerto.on("listening", () => r()));
      const urlMuerta = `http://127.0.0.1:${(muerto.address() as AddressInfo).port}`;
      await new Promise<void>((r) => muerto.close(() => r()));

      const r = await fetchKeepList(urlMuerta);
      assert.ok(!r.ok && r.error.includes("inalcanzable"), JSON.stringify(r));

      // Y de punta a punta: un asset-store apuntando ahí ABORTA el prune con
      // la causa dentro del 503 — no con un "unavailable" genérico.
      const db2 = new ManifestDb(join(root, "prune503.sqlite3"));
      const srv2 = createAssetStoreServer({
        port: 0,
        db: db2,
        blobDirs: blobDirs(join(root, "prune503fs")),
        stylesDir: fileURLToPath(new URL("../data/styles", import.meta.url)),
        cacheMaxBytes: 1,
        worldStateUrl: urlMuerta,
      });
      await new Promise<void>((r2) => srv2.on("listening", () => r2()));
      try {
        const base2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;
        const res = await fetch(`${base2}/cache/prune`, { method: "POST" });
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error?: string };
        assert.ok(body.error?.includes("inalcanzable"), body.error);
      } finally {
        srv2.close();
        db2.close();
      }
    });

    it("con refs → el Set filtrado", async () => {
      await conServidor(200, '{"refs": ["a", "b", 3]}', async (url) => {
        const r = await fetchKeepList(url);
        assert.ok(r.ok);
        assert.deepEqual([...r.keep].sort(), ["a", "b"]);
      });
    });
  });
});
