/** Tests del asset-store (services/asset-store/): cable HTTP exacto del
 *  router FastAPI original, migración idempotente del manifest.json,
 *  escrituras concurrentes (el criterio "hecho" de F2 — imposible con el
 *  rewrite de 5,8 MB del JSON) y prune LRU con keep-list. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { ManifestDb } from "../services/asset-store/manifest-db.js";
import { migrateManifest } from "../services/asset-store/migrate-manifest.js";
import { createAssetStoreServer } from "../services/asset-store/http-server.js";
import { fetchKeepList, prune } from "../services/asset-store/prune.js";

let root: string;
let db: ManifestDb;
let server: Server;
let baseUrl: string;
let worldState: Server;
let keepRefs: string[] = [];

function dirsByType(base: string): Record<string, string> {
  return {
    texture: join(base, "textures"),
    model: join(base, "models"),
    skin: join(base, "skins"),
    sprite: join(base, "sprites"),
    scene: join(base, "scenes"),
    segment: join(base, "segments"),
    surface: join(base, "surfaces"),
  };
}

function writeBlob(base: string, type: string, hash: string, filename: string, bytes = 4): void {
  const dir = join(base, `${type}s`, hash);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), Buffer.alloc(bytes, 1));
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
    dirsByType: dirsByType(root),
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

describe("CORS (espejo del CORSMiddleware de los FastAPI)", () => {
  it("toda respuesta lleva Access-Control-Allow-Origin: * (el cliente pide blobs con crossOrigin)", async () => {
    // Blob (aunque sea miss), JSON y error: la cabecera va SIEMPRE — sin
    // ella Chrome bloquea la imagen y el decode() del plató da EncodingError.
    for (const path of ["/cache/albedo/nadaquever", "/health", "/no-existe"]) {
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
  it("/cache/check/{hash} sigue MUERTO: 400 texto 'Invalid map type'", async () => {
    const r = await getRaw("/cache/check/abc123");
    assert.equal(r.status, 400);
    assert.equal(r.body.toString(), "Invalid map type");
    assert.match(r.contentType, /^text\/plain/);
  });

  it("kind desconocido → 400 texto; miss en disco → 404 texto 'Not found'", async () => {
    assert.equal((await getRaw("/cache/nonsense/abc")).status, 400);
    const miss = await getRaw("/cache/albedo/nadaquever");
    assert.equal(miss.status, 404);
    assert.equal(miss.body.toString(), "Not found");
  });

  it("albedo|normal|roughness sirven de textures/; plate sale de scenes/; model es GLB", async () => {
    writeBlob(root, "texture", "t1", "albedo.png");
    writeBlob(root, "texture", "t1", "normal.png");
    writeBlob(root, "scene", "s1", "plate.png");
    writeBlob(root, "model", "m1", "model.glb");
    assert.equal((await getRaw("/cache/albedo/t1")).status, 200);
    assert.equal((await getRaw("/cache/normal/t1")).status, 200);
    assert.equal((await getRaw("/cache/plate/s1")).status, 200);
    const model = await getRaw("/cache/model/m1");
    assert.equal(model.status, 200);
    assert.equal(model.contentType, "model/gltf-binary");
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
    // map type") en vez de servir la imagen.
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
  it("POST /assets: shape inválido → 400; válido → {ok:true}; duplicado idempotente", async () => {
    assert.equal((await post("/assets", { hash: "x" })).status, 400);
    // Borde zod (request-schemas): campo con tipo/rango inválido también 400.
    assert.equal(
      (await post("/assets", { hash: "y", type: "texture", subtype: "albedo", prompt: "p", size_bytes: -1 })).status,
      400,
    );
    const entry = { hash: "reg1", type: "texture", subtype: "albedo", prompt: "piedra", size_bytes: 10 };
    assert.deepEqual((await post("/assets", entry)).body, { ok: true });
    assert.deepEqual((await post("/assets", entry)).body, { ok: true }); // dup = éxito
    assert.equal(db.findByHash("reg1").length, 1);
  });

  it("by_hash: enriquecimiento cache_url por tipo, touch, y 404 texto plano", async () => {
    await post("/assets", { hash: "bh1", type: "texture", subtype: "albedo", prompt: "p", size_bytes: 1 });
    await post("/assets", { hash: "bh1", type: "texture", subtype: "normal", prompt: "p", size_bytes: 1 });
    await post("/assets", { hash: "bh2", type: "segment", subtype: "segment", prompt: "q", size_bytes: 1 });
    const t = await getJson("/assets/by_hash/bh1");
    assert.equal(t.status, 200);
    const matches = t.body.matches as Array<Record<string, unknown>>;
    assert.equal(matches[0].cache_url, "/cache/albedo/bh1");
    assert.equal(matches[1].cache_url, "/cache/normal/bh1");
    const seg = await getJson("/assets/by_hash/bh2");
    assert.equal((seg.body.matches as Array<Record<string, unknown>>)[0].cache_url, undefined);
    // touch estampó last_used
    assert.ok(db.findByHash("bh1")[0].last_used);
    const miss = await getRaw("/assets/by_hash/noexiste");
    assert.equal(miss.status, 404);
    assert.equal(miss.body.toString(), "Not found");
  });

  it("GET /assets: collapse por (hash,type), más reciente primero, filtro y limit", async () => {
    const fresh = new ManifestDb(join(root, "list.sqlite3"));
    fresh.register({ hash: "a", type: "texture", subtype: "albedo", prompt: "pa", size_bytes: 1 });
    fresh.register({ hash: "a", type: "texture", subtype: "normal", prompt: "pa2", size_bytes: 1 });
    fresh.register({ hash: "b", type: "scene", subtype: "scene", prompt: "pb", size_bytes: 1 });
    fresh.register({ hash: "c", type: "texture", subtype: "albedo", prompt: "pc", size_bytes: 1 });
    // Semántica Python: reverse + primera aparición por (hash,type) — la
    // entrada más RECIENTE del grupo aporta prompt/created_at.
    const all = fresh.listAssets(undefined, 50);
    assert.deepEqual(all.map((e) => e.hash), ["c", "b", "a"]);
    assert.equal(all[2].prompt, "pa2");
    // subtype viaja en el summary (fila ganadora del collapse).
    assert.equal(all[2].subtype, "normal");
    assert.deepEqual(fresh.listAssets("texture", 50).map((e) => e.hash), ["c", "a"]);
    assert.equal(fresh.listAssets(undefined, 1).length, 1);
    // Filtro CSV multi-tipo (librería del motor narrativo).
    fresh.register({ hash: "d", type: "surface", subtype: "surface", prompt: "pd", size_bytes: 1 });
    assert.deepEqual(
      fresh.listAssets("texture,surface", 50).map((e) => e.hash),
      ["d", "c", "a"],
    );
    fresh.close();
  });

  it("kind surface: blob servido con touch y by_hash con cache_url", async () => {
    writeBlob(root, "surface", "s1hash", "surface.png");
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

describe("migración one-shot idempotente", () => {
  it("importa en orden de array, conserva last_used, y re-ejecutar no duplica", () => {
    const mpath = join(root, "manifest-fixture.json");
    const fixture = [
      { hash: "m1", type: "texture", subtype: "albedo", prompt: "vieja", created_at: "2026-01-01T00:00:00+00:00", size_bytes: 5, extra: {} },
      { hash: "m1", type: "texture", subtype: "normal", prompt: "vieja", created_at: "2026-01-01T00:00:01+00:00", size_bytes: 5, extra: {} },
      // subtype muerto (bbox): se importa verbatim, decisión documentada
      { hash: "m2", type: "segment", subtype: "bbox", prompt: "m2", created_at: "2026-01-02T00:00:00+00:00", size_bytes: 7, extra: { layout: "x" }, last_used: "2026-03-01T00:00:00+00:00" },
      { hash: "m3", type: "scene", subtype: "scene", prompt: "nueva", created_at: "2026-01-03T00:00:00+00:00", size_bytes: 9, extra: {} },
    ];
    writeFileSync(mpath, JSON.stringify(fixture));
    const mdb = new ManifestDb(join(root, "migrate.sqlite3"));
    const s1 = migrateManifest(mdb, mpath, dirsByType(join(root, "empty")));
    assert.equal(s1.imported, 4);
    const s2 = migrateManifest(mdb, mpath, dirsByType(join(root, "empty")));
    assert.equal(s2.imported, 0);
    assert.equal(s2.ignored, 4);
    assert.equal(mdb.totalCount(), 4);
    // Collapse de oro (calcado del Python): m3, m2, m1 — más reciente primero
    assert.deepEqual(mdb.listAssets(undefined, 50).map((e) => e.hash), ["m3", "m2", "m1"]);
    // last_used sobrevive; extra sobrevive
    const m2 = mdb.findByHash("m2")[0];
    assert.equal(m2.last_used, "2026-03-01T00:00:00+00:00");
    assert.deepEqual(m2.extra, { layout: "x" });
    // El que nunca fue tocado NO tiene la clave (como el JSON legado)
    assert.equal("last_used" in mdb.findByHash("m3")[0], false);
    mdb.close();
  });

  it("recovery scan solo con índice vacío (port del bloque de main.py)", () => {
    const base = join(root, "recovery");
    writeBlob(base, "texture", "r1", "albedo.png", 11);
    writeBlob(base, "texture", "r1", "normal.png", 12);
    writeBlob(base, "skin", "r2", "skin.png", 13);
    const mdb = new ManifestDb(join(root, "recovery.sqlite3"));
    const s = migrateManifest(mdb, join(root, "no-manifest.json"), dirsByType(base));
    assert.equal(s.recovered, 3);
    const r1 = mdb.findByHash("r1");
    assert.equal(r1.length, 2);
    assert.equal(r1[0].prompt, "");
    assert.deepEqual(r1[0].extra, { recovered: true });
    // Con índice poblado, NO re-escanea
    const again = migrateManifest(mdb, join(root, "no-manifest.json"), dirsByType(base));
    assert.equal(again.recovered, 0);
    mdb.close();
  });
});

describe("concurrencia (criterio 'hecho' de F2)", () => {
  it("200 POST /assets en paralelo + lecturas intercaladas: cero pérdidas, DB íntegra", async () => {
    const posts = Array.from({ length: 200 }, (_, i) =>
      post("/assets", {
        hash: `cc${i % 150}`, // colisiones deliberadas de (hash,type,subtype)
        type: "segment",
        subtype: `sub${i % 150}`,
        prompt: `concurrente ${i}`,
        size_bytes: i,
      }),
    );
    const reads = Array.from({ length: 20 }, () => getJson("/assets?asset_type=segment&limit=10"));
    const results = await Promise.all([...posts, ...reads]);
    for (const r of results) assert.equal(r.status, 200);
    // 200 posts sobre 150 claves únicas → exactamente 150 filas nuevas
    const count = db.findByHash("cc0").length;
    assert.equal(count, 1);
    const listed = await getJson("/assets?asset_type=segment&limit=500");
    const segTotal = (listed.body.assets as unknown[]).length;
    assert.ok(segTotal >= 150, `esperaba >=150 grupos segment, hay ${segTotal}`);
    assert.equal(db.integrityCheck(), "ok");
  });
});

describe("prune LRU con keep-list", () => {
  it("evicta el más antiguo primero, respeta keep-list y types sin dir", () => {
    const base = join(root, "prunefs");
    const dirs = dirsByType(base);
    const pdb = new ManifestDb(join(root, "prune.sqlite3"));
    // 3 grupos de 100 bytes; techo 150 → debe evictar 2 (los más antiguos)
    for (const [i, h] of ["old", "mid", "new"].entries()) {
      writeBlob(base, "scene", h, "scene.png", 100);
      pdb.importEntry({
        hash: h, type: "scene", subtype: "scene", prompt: h,
        created_at: `2026-0${i + 1}-01T00:00:00.000Z`, size_bytes: 100, extra: {},
      });
    }
    // keep-list protege a "old": el eviction salta al siguiente
    const summary = prune(pdb, dirs, 150, new Set(["old"]));
    assert.equal(summary.pruned, 2);
    assert.equal(summary.freed_bytes, 200);
    assert.ok(existsSync(join(base, "scenes", "old")));
    assert.ok(!existsSync(join(base, "scenes", "mid")));
    assert.ok(!existsSync(join(base, "scenes", "new")));
    assert.equal(pdb.findByHash("old").length, 1);
    assert.equal(pdb.findByHash("mid").length, 0);
    // type sin dir conocido → intocable
    pdb.importEntry({
      hash: "weird", type: "tipo_desconocido", subtype: "x", prompt: "",
      created_at: "2020-01-01T00:00:00.000Z", size_bytes: 500, extra: {},
    });
    const s2 = prune(pdb, dirs, 10, null);
    assert.equal(pdb.findByHash("weird").length, 1, "type sin dir no se desindexa");
    assert.ok(s2.total_bytes >= 500);
    pdb.close();
  });

  it("max_bytes <= 0 → no-op con el total real", () => {
    const pdb = new ManifestDb(join(root, "prune2.sqlite3"));
    pdb.register({ hash: "z", type: "scene", subtype: "scene", prompt: "", size_bytes: 42 });
    const s = prune(pdb, dirsByType(join(root, "nada")), 0, null);
    assert.deepEqual(s, { pruned: 0, freed_bytes: 0, total_bytes: 42 });
    pdb.close();
  });

  it("POST /cache/prune vía HTTP consulta la keep-list del world-state fake", async () => {
    keepRefs = ["reg1", "bh1", "bh2", "t1", "s1", "m1", "h1"];
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
        dirsByType: dirsByType(join(root, "prune503fs")),
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
