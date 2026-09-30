/** La purga del índice (`scripts/manifest-kinds-con-productor.ts`) respeta el
 *  ORDEN de sus guardias DE PUNTA A PUNTA, y `npm run deuda` rechaza un argv
 *  malo con salida 2 (tanda BQ, QA).
 *
 *  POR QUÉ EXISTE. La tanda BQ sacó la decisión del `main` del script de purga
 *  a funciones puras con test (`veredictoDeGuardias`, `informeDePurga`,
 *  `rutasDeCli`) y dejó el `main` como cableado: mide tres hechos
 *  (`medirHechos`: sobrantes de `cache/`, store respondiendo, DB existe), pide
 *  el veredicto y SOLO ENTONCES abre la DB. Los unitarios prueban la
 *  precedencia sobre hechos ya medidos; no ven el cableado. QA lo probó en
 *  negativo sobre una copia de la rama y los tres sabotajes siguientes salían
 *  VERDES en `npm test`:
 *    S1 · abrir `new ManifestDb(dbPath)` ANTES del veredicto (y el constructor
 *         CREA el fichero si no existe);
 *    S2 · `medirHechos` con `storeArriba: false` fijo (nunca sondea el store,
 *         y `VACUUM` con el store vivo muere en SQLITE_BUSY a mitad de purga);
 *    S3 · `medirHechos` con `sobrantes: []` fijo (borra filas con los blobs
 *         pagados aún en `cache/`, sin índice que los encuentre).
 *  Y en `deuda`, S7 · un error de argv que sale con 0 en vez de 2.
 *  Este guion conduce el CLI de verdad en subprocesos y pone rojos los cuatro.
 *
 *  CÓMO. Todo en un temporal: una DB sembrada con una fila viva y una ajena
 *  (vía `ManifestDb`, el mismo código que el store), un `cache/` limpio o con
 *  un `textures/` sobrante, y un «store» que es un `http.createServer` en un
 *  puerto EFÍMERO que contesta `/health` — o el mismo puerto ya cerrado, para
 *  «store parado». El script lo encuentra por `NEFAN_URL_ASSET_STORE`, así que
 *  no toca el bloque de puertos del catálogo ni el índice del checkout
 *  (`--db`/`--cache`/`--archivo` apuntan al temporal). Cada caso afirma código
 *  de salida, qué guardia habló (y cuál NO) y que la DB quedó byte a byte
 *  igual — o que no se creó.
 *
 *  LO QUE NO MIDE: el `--ejecutar` feliz de punta a punta (exporta + DELETE +
 *  VACUUM: lo cubren los unitarios de `purgar`), ni un asset-store REAL
 *  levantado (QA lo hizo a mano en un offset libre, ver `qa.md` de la tanda
 *  BQ: mismo veredicto que este servidor de juguete), ni la redacción de
 *  `deuda` (se comparó byte a byte contra la base una vez, en `qa.md`).
 *
 *      node qa/run.mjs --sin-navegador 300
 *
 *  PRECONDICIÓN: `nefan-core/node_modules` (`npm ci`). ~6 s.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "corre scripts de nefan-core en subprocesos sobre un temporal; no abre partida ni habla con el motor";
export const sinNavegador = "conduce dos CLI de nefan-core por subproceso y un /health de juguete; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const SCRIPT = "scripts/manifest-kinds-con-productor.ts";

const huella = (p) => (existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : "no-existe");

/** Un entorno sin nada que redirija el script a otro índice u otro bloque. */
function entorno(storeUrl) {
  const env = { ...process.env, NEFAN_URL_ASSET_STORE: storeUrl };
  delete env.NEFAN_PORT_OFFSET;
  delete env.NEFAN_MANIFEST_DB;
  return env;
}

/** ASÍNCRONO a propósito: el «store» de juguete vive en ESTE proceso, y un
 *  `spawnSync` bloquearía el bucle de eventos que tiene que contestar su
 *  `/health` — el script vería un store parado y el caso (b) mediría otra
 *  cosa (le pasó a la primera versión de este guion). */
function tsx(args, env) {
  return new Promise((ok, mal) => {
    const hijo = spawn("npx", ["tsx", ...args], { cwd: CORE, env });
    let out = "";
    let err = "";
    hijo.stdout.on("data", (b) => (out += b));
    hijo.stderr.on("data", (b) => (err += b));
    hijo.on("error", mal);
    hijo.on("close", (rc) => ok({ rc: rc ?? -1, out, err }));
  });
}

async function sembrar(temporal, db) {
  const semilla = join(temporal, "sembrar.ts");
  const manifestDb = join(CORE, "services", "asset-store", "manifest-db.ts");
  writeFileSync(
    semilla,
    [
      `import { ManifestDb } from ${JSON.stringify(manifestDb)};`,
      `const db = new ManifestDb(${JSON.stringify(db)});`,
      `db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "yeso", size_bytes: 10 });`,
      `db.importEntry({ hash: "t1", type: "texture", subtype: "albedo", prompt: "piedra", created_at: "2026-01-01T00:00:00.000Z", size_bytes: 100, extra: {} });`,
      `db.close();`,
    ].join("\n"),
  );
  const r = await tsx([semilla], entorno("http://127.0.0.1:1"));
  if (r.rc !== 0) throw new Error(`no pude sembrar la DB: ${r.err}`);
}

/** Levanta un /health de juguete; `cerrado` devuelve un puerto que YA no escucha. */
async function store() {
  const srv = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { url, cerrar: () => new Promise((ok) => srv.close(ok)) };
}

export default async function (ctx) {
  const temporal = mkdtempSync(join(tmpdir(), "guion-300-"));
  const arriba = await store();
  const parado = await store();
  await parado.cerrar();
  try {
    /** Un caso: dir propio, cache sucia o limpia, DB sembrada o ausente. */
    const caso = async (nombre, { sucia, db, storeUrl, flags = [] }) => {
      const w = join(temporal, nombre);
      mkdirSync(join(w, "cache"), { recursive: true });
      mkdirSync(join(w, "archivo"), { recursive: true });
      if (sucia) mkdirSync(join(w, "cache", "textures"));
      const dbPath = join(w, "m.sqlite3");
      if (db) await sembrar(temporal, dbPath);
      const antes = huella(dbPath);
      const r = await tsx(
        [SCRIPT, "--db", dbPath, "--cache", join(w, "cache"), "--archivo", join(w, "archivo"), ...flags],
        entorno(storeUrl),
      );
      return { ...r, antes, despues: huella(dbPath), exportado: existsSync(join(w, "archivo", "manifest-retirado.json")) };
    };
    const MV = /^\s+mv \S+\/cache\/textures \S+\/archivo\/textures$/mu;
    const STORE = /hay un asset-store respondiendo en/u;
    const NO_EXISTE = /no existe \S+m\.sqlite3/u;
    const det = (r) => `rc=${r.rc} db ${r.antes.slice(0, 8)}→${r.despues.slice(0, 8)}\nstderr: ${r.err.trim().slice(0, 400)}\nstdout: ${r.out.trim().slice(0, 200)}`;

    // a · las TRES guardias fallan a la vez y se pide --ejecutar: manda blobs.
    const a = await caso("a", { sucia: true, db: true, storeUrl: arriba.url, flags: ["--ejecutar"] });
    ctx.expect(
      "a · blobs sobrantes + store arriba + --ejecutar: sale 1 con el `mv` a archivo/, SIN hablar del store, y la DB queda intacta y sin export",
      a.rc === 1 && MV.test(a.err) && !STORE.test(a.err) && a.antes === a.despues && !a.exportado,
      det(a),
    );

    // b · cache limpia, store arriba: la guardia del store tiene que SONDEAR (S2).
    const b = await caso("b", { sucia: false, db: true, storeUrl: arriba.url, flags: ["--ejecutar"] });
    ctx.expect(
      "b · cache limpia + store respondiendo + --ejecutar: sale 1 nombrando la URL del store, y la DB queda intacta y sin export",
      b.rc === 1 && STORE.test(b.err) && b.err.includes(arriba.url) && b.antes === b.despues && !b.exportado,
      det(b),
    );

    // c · store arriba y SIN DB: manda el store, y la DB no se crea (S1).
    const c = await caso("c", { sucia: false, db: false, storeUrl: arriba.url });
    ctx.expect(
      "c · store respondiendo + DB inexistente: manda el store (no «no existe») y la DB NO se crea",
      c.rc === 1 && STORE.test(c.err) && !NO_EXISTE.test(c.err) && c.despues === "no-existe",
      det(c),
    );

    // d · store parado y sin DB: «no existe», y sigue sin crearse (S1).
    const d = await caso("d", { sucia: false, db: false, storeUrl: parado.url });
    ctx.expect(
      "d · store parado + DB inexistente: sale 1 con «no existe …» y la DB NO se crea (nadie abre el índice antes del veredicto)",
      d.rc === 1 && NO_EXISTE.test(d.err) && d.despues === "no-existe",
      det(d),
    );

    // e · blobs sobrantes con el store parado: la guardia mira cache/ de verdad (S3).
    const e = await caso("e", { sucia: true, db: true, storeUrl: parado.url, flags: ["--ejecutar"] });
    ctx.expect(
      "e · blobs sobrantes + store parado + --ejecutar: sale 1 con el `mv`, la DB intacta y sin export",
      e.rc === 1 && MV.test(e.err) && e.antes === e.despues && !e.exportado,
      det(e),
    );

    // f · todo en verde, dry-run: tabla, «dry-run: nada tocado», sale 0 sin tocar la DB.
    const f = await caso("f", { sucia: false, db: true, storeUrl: parado.url });
    ctx.expect(
      "f · guardias en verde, dry-run: sale 0, dice «dry-run: nada tocado» y la DB queda intacta",
      f.rc === 0 && /dry-run: nada tocado/u.test(f.out) && f.antes === f.despues && !f.exportado,
      det(f),
    );

    // g · deuda: un argv malo sale con 2 antes de medir nada (S7).
    for (const argv of [["--top", "0"], ["5"]]) {
      const g = await tsx(["scripts/deuda.ts", ...argv], entorno(parado.url));
      ctx.expect(
        `g · \`deuda ${argv.join(" ")}\` sale con 2 y dice qué argumento no vale`,
        g.rc === 2 && /^deuda: /mu.test(g.err) && g.out === "",
        `rc=${g.rc}\nstderr: ${g.err.trim().slice(0, 300)}\nstdout: ${g.out.slice(0, 120)}`,
      );
    }
  } finally {
    await arriba.cerrar();
    rmSync(temporal, { recursive: true, force: true });
  }
}
