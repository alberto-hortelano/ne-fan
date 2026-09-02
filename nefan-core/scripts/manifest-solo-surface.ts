/** Purga del índice del asset-store: se queda SOLO con el kind vivo (#257).
 *
 *  El manifest indexaba 16.986 filas de siete kinds que ningún proceso vuelve
 *  a producir (texturas PBR y modelos del gpu-worker, skins y sprites 2D,
 *  repintados de la oblicua, recortes SAM2 y un type de renders huérfano que
 *  ni siquiera tenía directorio conocido). `prune` no podía tocarlas y el asset-store se
 *  niega a arrancar con ellas (`services/asset-store/solo-surface.ts`). Este
 *  script es la única vía de purgarlas, y lo es a propósito: irreproducible
 *  sería un `DELETE` a mano desde `node -e`.
 *
 *  ORDEN, y por qué cada guardia:
 *
 *  1. Los BLOBS se archivan antes (`mv cache/<dir> archivo/cache/<dir>`,
 *     jamás `rm`: es material pagado). Si `cache/` todavía tiene un directorio
 *     que no es de lo vivo, o el `manifest.json` legado, el script lo nombra
 *     y aborta — borrar la fila con el blob aún en su sitio dejaría 445 MB de
 *     repintados sin índice que los encuentre.
 *  2. El store tiene que estar PARADO: `VACUUM` exige exclusividad y con otro
 *     proceso en la DB muere en `SQLITE_BUSY`.
 *  3. Con `--ejecutar`, ANTES del `DELETE` se exportan las filas ajenas
 *     completas —`prompt`, `created_at`, `extra`, `last_used`— a
 *     `archivo/cache/manifest-retirado.json`. Es #293 (decisión del usuario:
 *     todo lo generado conserva la descripción con la que se generó), y el
 *     `manifest.json` archivado no lo cubre: 79 filas se registraron después
 *     de su import y solo existen en la DB. Un export previo con OTRO
 *     contenido aborta con la DB intacta; con el mismo, es una repetición.
 *  4. Solo entonces: `DELETE` de filas ajenas, pins huérfanos y `meta`
 *     `imported_*`, en una transacción; `VACUUM` fuera de ella. Idempotente:
 *     la segunda pasada dice «0 filas ajenas» y no toca el export.
 *
 *  Sin `--ejecutar` es un dry-run: imprime la tabla y no escribe nada.
 *
 *  Códigos de salida: 0 = dry-run impreso, purga hecha o nada que hacer;
 *  1 = cualquier guardia; 2 = flag desconocida.
 *
 *  Uso:
 *    npx tsx scripts/manifest-solo-surface.ts [--ejecutar] [--db <p>] [--cache <dir>] [--archivo <dir>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { CONFIG } from "../src/config.js";
import { resolveServiceUrl } from "../src/contracts/service-registry.js";
import { loadAssetStoreConfig } from "../services/asset-store/config.js";
import {
  ManifestDb,
  type KindAjeno,
  type ManifestEntryRow,
  type PurgaAjenos,
} from "../services/asset-store/manifest-db.js";

/** nefan-core/scripts → dos niveles arriba = raíz del repo. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const FICHERO_EXPORT = "manifest-retirado.json";

/** Lo que puede haber en `cache/` sin que sea un blob de un kind muerto: el
 *  directorio del kind vivo, el almacén paralelo de sprite-forge, las cachés
 *  de las APIs de pago (que no son del asset-store) y el propio índice con
 *  sus ficheros WAL. Todo lo demás es «archívalo primero». */
export const LO_VIVO_EN_CACHE: ReadonlySet<string> = new Set([
  "surfaces",
  "sprite_sheets",
  "dev_api_cache",
  "spend",
  "manifest.sqlite3",
  "manifest.sqlite3-wal",
  "manifest.sqlite3-shm",
]);

/** Guardia 1: qué entradas de `cache/` sobran. Vacío = se puede purgar. */
export function guardiaDeOrden(entradas: string[]): string[] {
  return entradas.filter((e) => !LO_VIVO_EN_CACHE.has(e)).sort();
}

/** Guardia 3: el export que ya existe, comparado con lo que se exportaría. */
export function compararExport(
  existente: unknown,
  filas: ManifestEntryRow[],
): "igual" | "distinto" | "ausente" {
  if (existente === undefined) return "ausente";
  const previas = (existente as { filas?: unknown } | null)?.filas;
  return isDeepStrictEqual(previas, filas) ? "igual" : "distinto";
}

export interface ExportRetirado {
  generado: string;
  db: string;
  motivo: string;
  total: number;
  filas: ManifestEntryRow[];
}

export interface Resumen {
  kinds: KindAjeno[];
  totalFilas: number;
  totalBytes: number;
  /** Solo con `--ejecutar` y algo que purgar. */
  exportado?: { ruta: string; filas: number; reutilizado: boolean };
  borradas?: PurgaAjenos;
  /** Filas ajenas tras la purga (0 si todo fue bien). */
  quedan?: number;
}

export interface OpcionesPurga {
  dbPath: string;
  archivoDir: string;
  ejecutar: boolean;
}

/** El corazón del script, sin CLI ni sondeo de red: dry-run o purga sobre una
 *  DB ya abierta. Lanza en cualquier guardia — el llamador traduce a exit 1. */
export function purgar(db: ManifestDb, opts: OpcionesPurga): Resumen {
  const kinds = db.kindsAjenos();
  const totalFilas = kinds.reduce((n, k) => n + k.filas, 0);
  const totalBytes = kinds.reduce((n, k) => n + k.bytes, 0);
  const resumen: Resumen = { kinds, totalFilas, totalBytes };
  if (!opts.ejecutar) return resumen;
  if (totalFilas === 0) return { ...resumen, quedan: 0 };

  // Export ANTES del DELETE (#293).
  const filas = db.filasAjenas();
  if (filas.length !== totalFilas) {
    throw new Error(`recuento inconsistente: kindsAjenos suma ${totalFilas} y filasAjenas devuelve ${filas.length}`);
  }
  const ruta = join(opts.archivoDir, FICHERO_EXPORT);
  const existente = existsSync(ruta) ? (JSON.parse(readFileSync(ruta, "utf-8")) as unknown) : undefined;
  const veredicto = compararExport(existente, filas);
  if (veredicto === "distinto") {
    throw new Error(
      `${ruta} ya existe con OTRO contenido: no lo piso ni borro nada. ` +
        `Si es de otra purga, muévelo y vuelve a lanzar.`,
    );
  }
  if (veredicto === "ausente") {
    const doc: ExportRetirado = {
      generado: new Date().toISOString(),
      db: opts.dbPath,
      motivo: "#257 · #293",
      total: filas.length,
      filas,
    };
    mkdirSync(opts.archivoDir, { recursive: true });
    const tmp = `${ruta}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1), "utf-8");
    renameSync(tmp, ruta);
    // Releer lo escrito: lo que protege la procedencia es el fichero, no la
    // intención de escribirlo.
    const releido = JSON.parse(readFileSync(ruta, "utf-8")) as ExportRetirado;
    if (releido.total !== filas.length || releido.filas.length !== filas.length) {
      throw new Error(`el export releído no cuadra (${releido.total}/${releido.filas.length} ≠ ${filas.length}): DB intacta`);
    }
  }
  resumen.exportado = { ruta, filas: filas.length, reutilizado: veredicto === "igual" };

  // Solo con el export en disco: DELETE en transacción, VACUUM fuera.
  resumen.borradas = db.transaction(() => db.borrarKindsAjenos());
  db.vacuum();
  resumen.quedan = db.kindsAjenos().reduce((n, k) => n + k.filas, 0);
  return resumen;
}

// ── CLI ──

interface Args {
  ejecutar: boolean;
  db?: string;
  cache?: string;
  archivo?: string;
}

function parseArgs(argv: string[]): Args | { error: string } {
  const args: Args = { ejecutar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ejecutar") args.ejecutar = true;
    else if (a === "--db" || a === "--cache" || a === "--archivo") {
      const v = argv[++i];
      if (!v) return { error: `${a} necesita un valor` };
      args[a.slice(2) as "db" | "cache" | "archivo"] = v;
    } else return { error: `flag desconocida: ${a}` };
  }
  return args;
}

async function storeArriba(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1_000);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    // Sin respuesta en 1 s = nadie escucha: es lo que queremos. Cualquier otro
    // error (DNS, rechazo) significa lo mismo para esta guardia.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function tabla(r: Resumen): string {
  const filas = r.kinds.map(
    (k) => `  ${k.type.padEnd(14)} ${k.subtype.padEnd(10)} ${String(k.filas).padStart(6)} ${String(k.bytes).padStart(12)}`,
  );
  return [
    `  ${"type".padEnd(14)} ${"subtype".padEnd(10)} ${"filas".padStart(6)} ${"bytes".padStart(12)}`,
    ...filas,
    `  total ajeno: ${r.totalFilas} filas, ${r.totalBytes} bytes`,
  ].join("\n");
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`manifest-solo-surface: ${parsed.error}`);
    console.error("uso: npx tsx scripts/manifest-solo-surface.ts [--ejecutar] [--db <p>] [--cache <dir>] [--archivo <dir>]");
    return 2;
  }
  const cfg = loadAssetStoreConfig(process.env);
  const dbPath = parsed.db ?? cfg.dbPath;
  const cacheDir = parsed.cache ?? resolve(REPO_ROOT, CONFIG.ai_server.cache_root);
  const archivoDir = parsed.archivo ?? resolve(REPO_ROOT, "archivo", "cache");

  // Guardia 1: blobs archivados.
  const sobrantes = guardiaDeOrden(existsSync(cacheDir) ? readdirSync(cacheDir) : []);
  if (sobrantes.length > 0) {
    console.error(`manifest-solo-surface: ${cacheDir} todavía tiene material que no es del kind vivo — archívalo primero:`);
    for (const s of sobrantes) console.error(`  mv ${join(cacheDir, s)} ${join(archivoDir, s)}`);
    return 1;
  }

  // Guardia 2: store parado.
  const storeUrl = resolveServiceUrl("asset-store", process.env);
  if (await storeArriba(storeUrl)) {
    console.error(`manifest-solo-surface: hay un asset-store respondiendo en ${storeUrl} — párale primero (tecla k de start.sh): VACUUM exige exclusividad.`);
    return 1;
  }

  if (!existsSync(dbPath)) {
    console.error(`manifest-solo-surface: no existe ${dbPath}`);
    return 1;
  }

  const db = new ManifestDb(dbPath);
  try {
    const r = purgar(db, { dbPath, archivoDir, ejecutar: parsed.ejecutar });
    console.log(`manifest-solo-surface: ${dbPath}`);
    console.log(tabla(r));
    if (!parsed.ejecutar) {
      console.log(r.totalFilas === 0 ? "0 filas ajenas, nada que hacer." : "dry-run: nada tocado. Repite con --ejecutar para exportar y borrar.");
      return 0;
    }
    if (r.exportado === undefined) {
      console.log("0 filas ajenas, nada que hacer.");
      return 0;
    }
    console.log(
      `exportadas ${r.exportado.filas} → ${r.exportado.ruta}${r.exportado.reutilizado ? " (ya existía con el mismo contenido)" : ""}`,
    );
    console.log(`borradas ${r.borradas!.filas} filas, ${r.borradas!.pins} pins, ${r.borradas!.meta} meta`);
    console.log("VACUUM ok");
    console.log(`quedan ${r.quedan} filas ajenas`);
    return r.quedan === 0 ? 0 : 1;
  } catch (err) {
    console.error(`manifest-solo-surface: ${(err as Error).message}`);
    return 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
