/** Tests del asset-store (services/asset-store/): cable HTTP exacto del
 *  router FastAPI original, escrituras concurrentes (el criterio "hecho" de
 *  F2 — imposible con el rewrite de 5,8 MB del JSON) y prune LRU con
 *  keep-list. Desde #257 el índice solo admite el kind `surface`: aquí se
 *  fija que cualquier otro es 400 en el blob y en el registro.
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
    surfaceDir: surfaceDir(root),
    spriteSheetsDir: join(root, "sprite_sheets"),
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
    assert.ok(isAbsolute(cfg.surfaceDir) && cfg.surfaceDir.endsWith(join("cache", "surfaces")), cfg.surfaceDir);
    assert.ok(isAbsolute(cfg.dbPath) && cfg.dbPath.endsWith(join("cache", "manifest.sqlite3")), cfg.dbPath);
    assert.ok(cfg.spriteSheetsDir.endsWith(join("cache", "sprite_sheets")), cfg.spriteSheetsDir);
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
    for (const kind of ["nonsense", "albedo", "normal", "roughness", "model", "skin", "sprite", "scene", "plate", "segment", "check"]) {
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
      (await post("/assets", { hash: "y", type: "surface", subtype: "surface", prompt: "p", size_bytes: -1 })).status,
      400,
    );
    // El registro de un kind sin productor es 400 aquí, no una fila que el
    // prune nunca podrá tocar (#257). Hasta esta tanda entraba y se indexaba.
    const texture = await post("/assets", { hash: "t1", type: "texture", subtype: "albedo", prompt: "p", size_bytes: 1 });
    assert.equal(texture.status, 400);
    assert.match(String(texture.body.error), /type/);
    assert.equal(db.findByHash("t1").length, 0, "el 400 no deja fila");
    // Y el subtype también es el literal.
    assert.equal(
      (await post("/assets", { hash: "t2", type: "surface", subtype: "albedo", prompt: "p", size_bytes: 1 })).status,
      400,
    );
    const entry = { hash: "reg1", type: "surface", subtype: "surface", prompt: "piedra", size_bytes: 10 };
    assert.deepEqual((await post("/assets", entry)).body, { ok: true });
    assert.deepEqual((await post("/assets", entry)).body, { ok: true }); // dup = éxito
    assert.equal(db.findByHash("reg1").length, 1);
  });

  it("by_hash: cache_url /cache/surface/{hash}, touch, y 404 texto plano", async () => {
    await post("/assets", { hash: "bh1", type: "surface", subtype: "surface", prompt: "p", size_bytes: 1 });
    const t = await getJson("/assets/by_hash/bh1");
    assert.equal(t.status, 200);
    const matches = t.body.matches as Array<Record<string, unknown>>;
    assert.equal(matches.length, 1);
    assert.equal(matches[0].cache_url, "/cache/surface/bh1");
    // touch estampó last_used
    assert.ok(db.findByHash("bh1")[0].last_used);
    const miss = await getRaw("/assets/by_hash/noexiste");
    assert.equal(miss.status, 404);
    assert.equal(miss.body.toString(), "Not found");
  });

  it("GET /assets: collapse por (hash,type), más reciente primero, filtro y limit", async () => {
    const fresh = new ManifestDb(join(root, "list.sqlite3"));
    // El collapse por (hash,type) es SQL sobre filas crudas: con un solo kind
    // vivo, `register` no puede producir dos subtypes del mismo hash, así que
    // se plantan con `importEntry` (la costura declarada para filas históricas).
    const fila = (hash: string, type: string, subtype: string, prompt: string, i: number) => ({
      hash, type, subtype, prompt, created_at: `2026-01-0${i}T00:00:00.000Z`, size_bytes: 1, extra: {},
    });
    fresh.importEntry(fila("a", "texture", "albedo", "pa", 1));
    fresh.importEntry(fila("a", "texture", "normal", "pa2", 2));
    fresh.importEntry(fila("b", "scene", "scene", "pb", 3));
    fresh.importEntry(fila("c", "texture", "albedo", "pc", 4));
    // Semántica Python: reverse + primera aparición por (hash,type) — la
    // entrada más RECIENTE del grupo aporta prompt/created_at.
    const all = fresh.listAssets(undefined, 50);
    assert.deepEqual(all.map((e) => e.hash), ["c", "b", "a"]);
    assert.equal(all[2].prompt, "pa2");
    // subtype viaja en el summary (fila ganadora del collapse).
    assert.equal(all[2].subtype, "normal");
    assert.deepEqual(fresh.listAssets("texture", 50).map((e) => e.hash), ["c", "a"]);
    assert.equal(fresh.listAssets(undefined, 1).length, 1);
    // Filtro CSV multi-tipo.
    fresh.register({ hash: "d", type: "surface", subtype: "surface", prompt: "pd", size_bytes: 1 });
    assert.deepEqual(
      fresh.listAssets("texture,surface", 50).map((e) => e.hash),
      ["d", "c", "a"],
    );
    // Un type que no tiene filas: lista vacía, no error (es lo que ve el
    // motor si alguien le pide un kind retirado).
    assert.deepEqual(fresh.listAssets("model", 50), []);
    fresh.close();
  });

  it("kind surface: blob servido con touch y by_hash con cache_url", async () => {
    writeSurface(root, "s1hash");
    db.register({ hash: "s1hash", type: "surface", subtype: "surface", prompt: "aged plaster", size_bytes: 4 });
    const blob = await getRaw("/cache/surface/s1hash");
    assert.equal(blob.status, 200);
    assert.equal(blob.contentType, "image/png");
    const by = await getJson("/assets/by_hash/s1hash");
    assert.equal(by.status, 200);
    assert.equal(by.body.matches[0].cache_url, "/cache/surface/s1hash");
  });

  it("limit no numérico → 400 ErrorResponse (desviación documentada del 422)", async () => {
    const r = await getJson("/assets?limit=pollo");
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });
});

describe("concurrencia (criterio 'hecho' de F2)", () => {
  it("200 POST /assets en paralelo + lecturas intercaladas: cero pérdidas, DB íntegra", async () => {
    const posts = Array.from({ length: 200 }, (_, i) =>
      post("/assets", {
        hash: `cc${i % 150}`, // colisiones deliberadas de (hash,type,subtype)
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
    const count = db.findByHash("cc0").length;
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
    const summary = prune(pdb, surfaceDir(base), 150, new Set(["old"]));
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
    const s = prune(pdb, surfaceDir(join(root, "nada")), 0, null);
    assert.deepEqual(s, { pruned: 0, freed_bytes: 0, total_bytes: 42 });
    pdb.close();
  });

  it("POST /cache/prune vía HTTP consulta la keep-list del world-state fake", async () => {
    keepRefs = ["reg1", "bh1", "s1hash", "h1"];
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
        surfaceDir: surfaceDir(join(root, "prune503fs")),
        spriteSheetsDir: join(root, "sprite_sheets"),
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
