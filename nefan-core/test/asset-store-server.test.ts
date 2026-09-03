/** El ARRANQUE del asset-store (`services/asset-store/server.ts`), ejercido de
 *  verdad: se lanza el proceso hijo y se mira con qué sale.
 *
 *  POR QUÉ ASÍ (#391). El único camino de fallo del arranque —negarse a servir
 *  un índice con kinds sin productor— vivía en un fichero sin un solo test:
 *  `verificarKindsConProductor` sí lo tenía
 *  (`manifest-kinds-con-productor.test.ts`), pero
 *  quien traduce el veredicto en `exit 1` es `server.ts`, y para ejercerlo
 *  hacía falta plantar una fila ajena en la DB DEL CHECKOUT. El QA de T4
 *  exportó el árbol entero a un temporal para poder hacerlo: ese workaround es
 *  el defecto que arregla `NEFAN_MANIFEST_DB`, así que el test que lo estrena
 *  es este.
 *
 *  Se arranca el hijo de verdad y no se importa `server.ts` porque lo que se
 *  fija es el CÓDIGO DE SALIDA, que es lo que ve `start.sh`: importarlo
 *  mataría también al proceso de test.
 *
 *  Cero riesgo para el vecino: cada caso corre contra su propio `mkdtemp`, el
 *  puerto es 0 (efímero, lo elige el kernel: no pisa el stack de nadie) y el
 *  hijo lo mata este test por su PID — nunca por puerto ni por nombre. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENV_MANIFEST_DB, loadAssetStoreConfig } from "../services/asset-store/config.js";
import type { AssetStoreHealthResponse } from "../services/asset-store/http-server.js";
import { ManifestDb } from "../services/asset-store/manifest-db.js";
import { SCRIPT_DE_PURGA } from "../services/asset-store/kinds-con-productor.js";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(CORE, "services", "asset-store", "server.ts");

/** Lo que dejó el hijo al morir. `signal` no es null solo si murió sin
 *  manejarlo — que aquí sería un fallo, no una forma de parar. */
interface Salida {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Lo que devolvió `alEscuchar`, si se pasó (la respuesta de `/health`). */
  extra: unknown;
}

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), "asset-store-server-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** La línea que imprime el servidor cuando ya tiene el socket, con el puerto
 *  donde escucha DE VERDAD. Que ese número sea el real y no el pedido es lo que
 *  permite llamarlo con `port: 0`: hasta que QA lo midió, la línea decía `:0`
 *  mientras el kernel servía en otro, y la URL del log no era llamable. */
const LINEA_ESCUCHANDO = /listening on http:\/\/127\.0\.0\.1:(\d+)/;

/** El puerto que el hijo ANUNCIA, o null si todavía no lo ha dicho. */
function puertoAnunciado(stdout: string): number | null {
  const m = LINEA_ESCUCHANDO.exec(stdout);
  return m ? Number(m[1]) : null;
}

/** Arranca `server.ts` como HIJO de este proceso y espera a que muera.
 *
 *  En cuanto el hijo dice que escucha se le llama (si hay algo que llamar) y se
 *  le manda SIGTERM. Para el caso POSITIVO es la única forma de pararlo (si
 *  todo va bien no termina solo), y para los NEGATIVOS es lo que hace que
 *  fallen rápido: un arranque que debería haber muerto y se queda sirviendo se
 *  corta ahí en vez de agotar la red de seguridad — medido, 60 s por caso. No
 *  es una espera por reloj: se espera a que el proceso DIGA algo, no a que
 *  pasen N milisegundos. */
function arrancar(
  env: Record<string, string>,
  alEscuchar?: (puerto: number) => Promise<unknown>,
): Promise<Salida> {
  return new Promise((cumplir, fallar) => {
    const hijo = spawn(process.execPath, ["--import", "tsx", SERVER], {
      cwd: CORE,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let extra: unknown = null;
    let disparado = false;
    // Red de seguridad: un hijo que ni arranca, ni muere, ni llega a escuchar
    // colgaría la suite entera. Se mata por PID (el suyo, el que arrancó este
    // test) y el caso falla por lo que asegure.
    const guardia = setTimeout(() => hijo.kill("SIGKILL"), 60_000);
    hijo.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
      const puerto = puertoAnunciado(stdout);
      if (disparado || puerto === null) return;
      disparado = true;
      const parar = (): void => {
        hijo.kill("SIGTERM");
      };
      if (!alEscuchar) return parar();
      void alEscuchar(puerto)
        .then((r) => {
          extra = r;
        })
        .catch((e: unknown) => {
          extra = { error: String(e) };
        })
        .finally(parar);
    });
    hijo.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    hijo.on("error", fallar);
    hijo.on("close", (code, signal) => {
      clearTimeout(guardia);
      cumplir({ code, signal, stdout, stderr, extra });
    });
  });
}

/** Una DB de usar y tirar con las filas que se le pidan. Se CIERRA antes de
 *  devolverla: el índice lo abre un proceso a la vez (invariante de
 *  `ManifestDb`), y el que va a abrirlo es el hijo. */
function dbTemporal(nombre: string, sembrar: (db: ManifestDb) => void): string {
  const ruta = join(root, nombre, "manifest.sqlite3");
  const db = new ManifestDb(ruta);
  sembrar(db);
  db.close();
  return ruta;
}

describe("loadAssetStoreConfig: la ruta del índice admite override (#391)", () => {
  it("sin la variable, el índice del checkout; con ella, el que diga", () => {
    const porDefecto = loadAssetStoreConfig({}).dbPath;
    assert.ok(isAbsolute(porDefecto) && porDefecto.endsWith(join("cache", "manifest.sqlite3")), porDefecto);

    // Absoluta: pasa intacta (es lo que usa el test del arranque, con mkdtemp).
    const absoluta = join(root, "sitio", "otro.sqlite3");
    assert.equal(loadAssetStoreConfig({ [ENV_MANIFEST_DB]: absoluta }).dbPath, absoluta);

    // Relativa: contra la raíz del repo, como las del snapshot.
    const relativa = loadAssetStoreConfig({ [ENV_MANIFEST_DB]: "cache/otro.sqlite3" }).dbPath;
    assert.ok(isAbsolute(relativa) && relativa.endsWith(join("cache", "otro.sqlite3")), relativa);

    // El override es SOLO del índice: los demás campos no se mueven.
    const conOverride = loadAssetStoreConfig({ [ENV_MANIFEST_DB]: absoluta });
    const sinOverride = loadAssetStoreConfig({});
    assert.deepEqual(conOverride.blobDirs, sinOverride.blobDirs);
    assert.equal(conOverride.stylesDir, sinOverride.stylesDir);
    assert.equal(conOverride.cacheMaxBytes, sinOverride.cacheMaxBytes);
  });

  it("puesta pero en blanco es una variable mal puesta, y se dice", () => {
    // Medido quitando la guarda: `""` acaba en la RAÍZ del repo («unable to
    // open database file», sin decir por qué) y `"  "` crea un fichero
    // llamado dos espacios ahí mismo y el store arranca sobre él, callado.
    for (const crudo of ["", "   ", "\t"]) {
      assert.throws(
        () => loadAssetStoreConfig({ [ENV_MANIFEST_DB]: crudo }),
        new RegExp(`${ENV_MANIFEST_DB} está puesta pero vacía`),
        JSON.stringify(crudo),
      );
    }
  });
});

describe("server.ts: el fail-loud del índice, contra una DB temporal", () => {
  it("con una fila de un kind sin productor: exit 1, el motivo y el script de purga", async () => {
    const ruta = dbTemporal("ajena", (db) => {
      db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "yeso", size_bytes: 10 });
      db.importEntry({
        hash: "t1",
        type: "texture",
        subtype: "albedo",
        prompt: "piedra musgosa",
        created_at: "2026-01-01T00:00:00.000Z",
        size_bytes: 5_000_000,
        extra: {},
      });
    });

    const salida = await arrancar({ [ENV_MANIFEST_DB]: ruta, NEFAN_ASSET_STORE_PORT: "0" });

    assert.equal(salida.code, 1, `no salió con 1.\nstdout: ${salida.stdout}\nstderr: ${salida.stderr}`);
    assert.match(salida.stderr, /kinds SIN productor/);
    assert.match(salida.stderr, /texture \(albedo 1\)/, "nombra el kind que sobra y cuántas filas");
    assert.ok(salida.stderr.includes(SCRIPT_DE_PURGA), "dice con qué script se purga");
    assert.doesNotMatch(salida.stdout, /índice/, "muere ANTES de anunciar el índice y de escuchar");
    // De QUÉ índice habla. Sin esto el aserto de arriba lo satisface igual de
    // bien el del checkout, y con el override roto este caso daría verde por
    // el motivo equivocado (lo midió QA el 2026-09-03).
    assert.ok(salida.stderr.includes(ruta), `el veredicto no nombra su índice: ${salida.stderr}`);

    // No hace daño al pasar: la fila ajena sigue ahí (purgar es otra cosa).
    const db = new ManifestDb(ruta);
    assert.equal(db.kindsAjenos().length, 1);
    db.close();
  });

  it("con el índice limpio arranca, SIRVE lo que hay en él y anuncia el puerto de verdad", async () => {
    const ruta = dbTemporal("limpia", (db) => {
      db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "adoquín", size_bytes: 42 });
    });

    // Puerto 0 = lo elige el kernel, así que no se pisa el stack de nadie. La
    // dirección a la que se llama sale de lo que el propio hijo ANUNCIA: si la
    // línea mintiera (decía `:0` hasta que QA lo midió), este `fetch` no
    // encontraría a nadie.
    const salida = await arrancar(
      { [ENV_MANIFEST_DB]: ruta, NEFAN_ASSET_STORE_PORT: "0" },
      async (puerto) => {
        const res = await fetch(`http://127.0.0.1:${puerto}/health`, { signal: AbortSignal.timeout(5_000) });
        return { status: res.status, cuerpo: (await res.json()) as AssetStoreHealthResponse };
      },
    );

    // La línea del índice nombra la DB TEMPORAL con su recuento: es la prueba
    // de que el override llega hasta el proceso, no solo hasta la función.
    assert.ok(salida.stdout.includes(`índice ${ruta} (1 entradas, 42 bytes)`), salida.stdout);
    assert.doesNotMatch(salida.stdout, /cache[/\\]manifest\.sqlite3/, "el índice del checkout no se abre");

    const puerto = puertoAnunciado(salida.stdout);
    assert.ok(puerto !== null && puerto > 0, `anunció un puerto que no es llamable: ${salida.stdout}`);

    const salud = salida.extra as { status?: number; cuerpo?: AssetStoreHealthResponse };
    assert.equal(salud.status, 200, `/health no contestó: ${JSON.stringify(salida.extra)}`);
    assert.deepEqual(
      { total_count: salud.cuerpo?.total_count, total_bytes: salud.cuerpo?.total_bytes },
      { total_count: 1, total_bytes: 42 },
      "lo que sirve es el índice de la variable, no otro",
    );

    assert.equal(salida.code, 0, "SIGTERM lo baja por su manejador, no a lo bruto");
    assert.equal(salida.signal, null);
    // El stderr solo lleva el ExperimentalWarning de node:sqlite: ni veredicto
    // ni excepción (comparar con "" lo ataría a esa advertencia de node).
    assert.doesNotMatch(salida.stderr, /kinds SIN productor|Error/, salida.stderr);
  });

  it("arranca con los TRES kinds del índice y sirve el listado del arte de personaje (#376)", async () => {
    // El sujeto es el arranque: hasta #376 una fila `sprite_hero` era «un kind
    // sin productor» y el store se habría NEGADO a arrancar sobre este índice.
    const ruta = dbTemporal("tres-kinds", (db) => {
      db.register({ hash: "s1", type: "surface", subtype: "surface", prompt: "adoquín", size_bytes: 10 });
      db.registrarPineado(
        { hash: "0123456789abcdef", type: "sprite_hero", subtype: "sprite_hero", prompt: "Blas, el tabernero", size_bytes: 20, extra: { character_ref: "0123456789abcdef" } },
        "character:0123456789abcdef",
      );
      db.registrarPineado(
        { hash: "fedcba9876543210", type: "sprite_sheet", subtype: "sprite_sheet", prompt: "Blas, el tabernero", size_bytes: 30, extra: { character_ref: "0123456789abcdef" } },
        "character:0123456789abcdef",
      );
    });

    const salida = await arrancar(
      { [ENV_MANIFEST_DB]: ruta, NEFAN_ASSET_STORE_PORT: "0" },
      async (puerto) => {
        const res = await fetch(`http://127.0.0.1:${puerto}/assets?asset_type=sprite_hero&limit=50`, {
          signal: AbortSignal.timeout(5_000),
        });
        return (await res.json()) as { assets: Array<{ hash: string; prompt: string }> };
      },
    );

    assert.ok(salida.stdout.includes(`índice ${ruta} (3 entradas, 60 bytes)`), salida.stdout);
    assert.doesNotMatch(salida.stderr, /kinds SIN productor/, salida.stderr);
    // Y el hero se puede consultar POR SU PROMPT, que es para lo que se indexa.
    const listado = salida.extra as { assets?: Array<{ hash: string; prompt: string }> };
    assert.deepEqual(
      listado.assets?.map((a) => [a.hash, a.prompt]),
      [["0123456789abcdef", "Blas, el tabernero"]],
      JSON.stringify(salida.extra),
    );
    assert.equal(salida.code, 0);
  });

  it("con la variable en blanco no arranca y dice cuál es", async () => {
    const salida = await arrancar({ [ENV_MANIFEST_DB]: "  ", NEFAN_ASSET_STORE_PORT: "0" });

    assert.equal(salida.code, 1, salida.stdout);
    assert.match(salida.stderr, new RegExp(`${ENV_MANIFEST_DB} está puesta pero vacía`));
    // Y sobre todo: no se ha ido a abrir la raíz del repo por su cuenta,
    // que es con lo que moría antes de la guarda.
    assert.doesNotMatch(salida.stderr, /unable to open database file/);
  });
});
