/** Borde de I/O del checker de fronteras: recorre el repo y parsea imports.
 *
 *  Vive aquí y no en `src/` porque toca disco, y `src/contract/**` es un árbol
 *  puro (regla `core-puro-sin-node`). Lo comparten los dos consumidores del
 *  motor: el test guardia (`test/architecture.test.ts`), que falla cuando algo
 *  cruza una frontera, y la cola de deuda (`scripts/deuda.ts`), que lista las
 *  violaciones congeladas como trabajo pendiente. Antes estaba dentro del test
 *  y la cola habría tenido que duplicarlo — dos recorridos que se desincronizan
 *  es exactamente la deuda que el checker existe para evitar.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  ArchConfigSchema,
  lineOf,
  type ArchConfig,
  type ImportRef,
  type SourceFile,
} from "../src/contract/arch/check.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

export const archConfig: ArchConfig = ArchConfigSchema.parse(
  JSON.parse(readFileSync(join(here, "..", "data", "contract", "arch-rules.json"), "utf-8")),
);

/** Recorre un directorio y devuelve las rutas con alguna de las extensiones. */
function walk(dir: string, ext: readonly string[], ignore: readonly string[]): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`arch-rules.json apunta a un directorio inexistente: ${dir}`);
  }
  for (const name of entries) {
    if (ignore.includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext, ignore));
    else if (ext.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Imports de un fichero TS, con su línea. `preProcessFile` entiende de
 *  verdad la sintaxis: no confunde un "three" escrito en un comentario con un
 *  import — que es justo el falso positivo que tendría una regex. */
function importsOf(text: string): ImportRef[] {
  const pre = ts.preProcessFile(text, true, true);
  return pre.importedFiles.map((ref) => ({ spec: ref.fileName, line: lineOf(text, ref.pos) }));
}

export function loadArchFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  for (const root of archConfig.scan.roots) {
    for (const abs of walk(join(repoRoot, root.dir), root.ext, archConfig.scan.ignore)) {
      const text = readFileSync(abs, "utf-8");
      const path = relative(repoRoot, abs).split(sep).join("/");
      out.push({ path, text, imports: abs.endsWith(".ts") ? importsOf(text) : undefined });
    }
  }
  return out;
}
