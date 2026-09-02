/** La purga del índice del asset-store (#257) y el veredicto de arranque que
 *  la exige. Todo sobre una DB temporal: la real se purgó UNA vez, con el
 *  `mv` de los blobs delante, y lo que aquí se fija es que el script no pueda
 *  hacer daño en ningún orden distinto de ese. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ManifestDb } from "../services/asset-store/manifest-db.js";
import { SCRIPT_DE_PURGA, verificarSoloSurface } from "../services/asset-store/solo-surface.js";
import {
  compararExport,
  FICHERO_EXPORT,
  guardiaDeOrden,
  purgar,
} from "../scripts/manifest-solo-surface.js";

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "manifest-solo-surface-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 2 filas vivas + 3 ajenas (una `surface` con subtype ajeno, a propósito: el
 *  WHERE es `type<>? OR subtype<>?`), un pin sobre una ajena y la meta del
 *  import legado. */
function sembrar(nombre: string): ManifestDb {
  const db = new ManifestDb(join(root, `${nombre}.sqlite3`));
  db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "yeso viejo", size_bytes: 10 });
  db.register({ hash: "s2", type: "surface", subtype: "surface", prompt: "adoquín", size_bytes: 20 });
  db.importEntry({
    hash: "t1", type: "texture", subtype: "albedo", prompt: "piedra musgosa",
    created_at: "2026-01-01T00:00:00.000Z", size_bytes: 100, extra: { pipeline: "v2" },
    last_used: "2026-02-01T00:00:00.000Z",
  });
  db.importEntry({
    hash: "p1", type: "scene", subtype: "plate", prompt: "The object being removed is a cart",
    created_at: "2026-01-02T00:00:00.000Z", size_bytes: 200, extra: {},
  });
  db.importEntry({
    hash: "x1", type: "surface", subtype: "albedo", prompt: "subtype ajeno sobre type vivo",
    created_at: "2026-01-03T00:00:00.000Z", size_bytes: 300, extra: {},
  });
  db.pin("game_style:g:e", ["t1", "s1"]);
  db.setMeta("imported_at", "2026-08-05T00:00:00.000Z");
  db.setMeta("imported_source", "/cache/manifest.json");
  db.setMeta("otra", "se queda");
  return db;
}

describe("ManifestDb: kinds ajenos", () => {
  it("kindsAjenos agrupa por (type, subtype) y filasAjenas devuelve las mismas filas completas", () => {
    const db = sembrar("kinds");
    assert.deepEqual(db.kindsAjenos(), [
      { type: "scene", subtype: "plate", filas: 1, bytes: 200 },
      { type: "surface", subtype: "albedo", filas: 1, bytes: 300 },
      { type: "texture", subtype: "albedo", filas: 1, bytes: 100 },
    ]);
    const filas = db.filasAjenas();
    assert.deepEqual(filas.map((f) => f.hash), ["t1", "p1", "x1"], "orden de inserción");
    // La procedencia entera viaja: prompt, created_at, extra y last_used.
    assert.deepEqual(filas[0], {
      hash: "t1", type: "texture", subtype: "albedo", prompt: "piedra musgosa",
      created_at: "2026-01-01T00:00:00.000Z", size_bytes: 100, extra: { pipeline: "v2" },
      last_used: "2026-02-01T00:00:00.000Z",
    });
    assert.equal("last_used" in filas[1], false, "sin touch, sin clave (como el JSON legado)");
    db.close();
  });
});

describe("guardias del script", () => {
  it("guardiaDeOrden nombra lo que sobra en cache/ y calla con solo lo vivo", () => {
    assert.deepEqual(
      guardiaDeOrden(["surfaces", "textures", "manifest.json", "sprite_sheets", "manifest.sqlite3", "spend"]),
      ["manifest.json", "textures"],
    );
    assert.deepEqual(
      guardiaDeOrden(["surfaces", "sprite_sheets", "dev_api_cache", "spend", "manifest.sqlite3", "manifest.sqlite3-wal", "manifest.sqlite3-shm"]),
      [],
    );
    // `cache/sprites` (muerto) no es `cache/sprite_sheets` (vivo).
    assert.deepEqual(guardiaDeOrden(["sprites"]), ["sprites"]);
  });

  it("compararExport: ausente, igual o distinto", () => {
    const filas = [
      { hash: "a", type: "texture", subtype: "albedo", prompt: "p", created_at: "c", size_bytes: 1, extra: {} },
    ];
    assert.equal(compararExport(undefined, filas), "ausente");
    assert.equal(compararExport({ filas: structuredClone(filas) }, filas), "igual");
    assert.equal(compararExport({ filas: [] }, filas), "distinto");
    assert.equal(compararExport({ sin_filas: true }, filas), "distinto");
    assert.equal(compararExport(null, filas), "distinto");
  });
});

describe("purgar", () => {
  it("dry-run: enseña la tabla y no toca nada", () => {
    const db = sembrar("dry");
    const archivoDir = join(root, "archivo-dry");
    const r = purgar(db, { dbPath: "x", archivoDir, ejecutar: false });
    assert.equal(r.totalFilas, 3);
    assert.equal(r.totalBytes, 600);
    assert.equal(r.kinds.length, 3);
    assert.equal(r.exportado, undefined);
    assert.equal(r.borradas, undefined);
    assert.equal(db.totalCount(), 5, "nada borrado");
    assert.equal(db.pinnedHashes().size, 2, "pins intactos");
    assert.equal(db.getMeta("imported_at"), "2026-08-05T00:00:00.000Z");
    assert.equal(existsSync(join(archivoDir, FICHERO_EXPORT)), false, "sin export en dry-run");
    db.close();
  });

  it("--ejecutar: exporta ANTES de borrar, y deja el índice solo con el kind vivo", () => {
    const db = sembrar("ejecutar");
    const archivoDir = join(root, "archivo-ejecutar");
    const r = purgar(db, { dbPath: "/tmp/x.sqlite3", archivoDir, ejecutar: true });

    // El export existe y lleva la procedencia de las 3 ajenas.
    const ruta = join(archivoDir, FICHERO_EXPORT);
    assert.deepEqual(r.exportado, { ruta, filas: 3, reutilizado: false });
    const doc = JSON.parse(readFileSync(ruta, "utf-8")) as { total: number; db: string; filas: Array<{ hash: string; prompt: string }> };
    assert.equal(doc.total, 3);
    assert.equal(doc.db, "/tmp/x.sqlite3");
    assert.deepEqual(doc.filas.map((f) => f.hash), ["t1", "p1", "x1"]);
    assert.ok(doc.filas.every((f) => f.prompt.length > 0), "cada fila con su prompt");

    // La DB: solo surface/surface, pins huérfanos fuera, meta imported_* fuera.
    assert.deepEqual(r.borradas, { filas: 3, pins: 1, meta: 2 });
    assert.equal(r.quedan, 0);
    assert.deepEqual(db.kindsAjenos(), []);
    assert.equal(db.totalCount(), 2);
    assert.deepEqual([...db.pinnedHashes()], ["s1"], "el pin sobre la viva sobrevive");
    assert.equal(db.getMeta("imported_at"), undefined);
    assert.equal(db.getMeta("imported_source"), undefined);
    assert.equal(db.getMeta("otra"), "se queda");
    assert.equal(db.integrityCheck(), "ok");

    // Segunda pasada: nada que hacer, y el export byte a byte igual.
    const antes = readFileSync(ruta);
    const r2 = purgar(db, { dbPath: "/tmp/x.sqlite3", archivoDir, ejecutar: true });
    assert.equal(r2.totalFilas, 0);
    assert.equal(r2.quedan, 0);
    assert.equal(r2.exportado, undefined);
    assert.ok(antes.equals(readFileSync(ruta)), "el export no se toca en la segunda pasada");
    db.close();
  });

  it("un export previo con OTRO contenido aborta con la DB intacta", () => {
    const db = sembrar("choque");
    const archivoDir = join(root, "archivo-choque");
    const ruta = join(archivoDir, FICHERO_EXPORT);
    mkdirSync(archivoDir, { recursive: true });
    // Fichero de otra purga: otras filas.
    const ajeno = JSON.stringify({ total: 1, filas: [{ hash: "otra", type: "skin", subtype: "skin", prompt: "x", created_at: "c", size_bytes: 1, extra: {} }] });
    writeFileSync(ruta, ajeno, "utf-8");
    assert.throws(
      () => purgar(db, { dbPath: "x", archivoDir, ejecutar: true }),
      /ya existe con OTRO contenido/,
    );
    assert.equal(db.totalCount(), 5, "ni una fila borrada");
    assert.equal(db.pinnedHashes().size, 2);
    assert.equal(db.getMeta("imported_at"), "2026-08-05T00:00:00.000Z");
    assert.equal(readFileSync(ruta, "utf-8"), ajeno, "el export ajeno no se pisa");
    db.close();
  });
});

describe("verificarSoloSurface (el arranque del asset-store)", () => {
  it("con una fila ajena: ok:false y el mensaje nombra el script de purga", () => {
    const db = new ManifestDb(join(root, "veredicto.sqlite3"));
    db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "p", size_bytes: 1 });
    assert.deepEqual(verificarSoloSurface(db), { ok: true });
    db.importEntry({
      hash: "t1", type: "texture", subtype: "albedo", prompt: "", created_at: "2026-01-01T00:00:00.000Z",
      size_bytes: 5_000_000, extra: {},
    });
    const v = verificarSoloSurface(db);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.match(v.mensaje, /1 filas de kinds SIN productor/);
    assert.match(v.mensaje, /texture \(albedo 1\): 1 filas, 5\.0 MB/);
    assert.ok(v.mensaje.includes(SCRIPT_DE_PURGA), v.mensaje);
    assert.ok(v.mensaje.includes("--ejecutar"), v.mensaje);
    // El nombre del script va al FINAL: es lo que sobrevive al `tail` de start.sh.
    const ultima = v.mensaje.trimEnd().split("\n").at(-1) ?? "";
    assert.ok(ultima.includes(SCRIPT_DE_PURGA), ultima);
    db.close();
  });
});
