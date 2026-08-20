/** Guardia de fronteras arquitectónicas.
 *
 *  Las reglas viven en `data/contract/arch-rules.json` y el motor que las
 *  aplica en `src/contract/arch/check.ts`. Este fichero es el borde: hace el
 *  I/O (recorrer el repo) y el parseo de imports con la API de TypeScript, y
 *  falla con `ruta:línea → regla` cuando algo cruza una frontera.
 *
 *  Si falla: repara el import o el patrón. Si de verdad es legítimo, añade una
 *  excepción CON MOTIVO en el JSON — una excepción sin motivo no valida.
 *
 *  Las reglas `warn` son deuda YA existente, congelada en `max`: el test falla
 *  si CRECE, y avisa (sin fallar) cuando alguien la baja y toca reapretar. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  ArchConfigSchema,
  checkArchitecture,
  formatFailure,
  globToRegExp,
  lineOf,
  reportByRule,
  type ImportRef,
  type SourceFile,
} from "../src/contract/arch/check.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const config = ArchConfigSchema.parse(
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

function loadFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  for (const root of config.scan.roots) {
    for (const abs of walk(join(repoRoot, root.dir), root.ext, config.scan.ignore)) {
      const text = readFileSync(abs, "utf-8");
      const path = relative(repoRoot, abs).split(sep).join("/");
      out.push({ path, text, imports: abs.endsWith(".ts") ? importsOf(text) : undefined });
    }
  }
  return out;
}

const files = loadFiles();
const violations = checkArchitecture(config, files);
const reports = reportByRule(config, violations);

describe("fronteras arquitectónicas", () => {
  it("el escaneo encuentra el árbol del repo", () => {
    assert.ok(files.length > 200, `solo ${files.length} ficheros escaneados — ¿mal la raíz del repo?`);
  });

  for (const report of reports) {
    const { rule } = report;
    if (rule.severity === "error") {
      it(`[error] ${rule.id}`, () => {
        assert.equal(report.violations.length, 0, `\n${formatFailure(report)}\n`);
      });
    } else {
      it(`[deuda] ${rule.id} (max ${rule.max})`, () => {
        assert.ok(report.budget !== "excedido", `\n${formatFailure(report)}\n`);
        if (report.budget === "mejorable") {
          console.log(
            `  ℹ ${rule.id}: la deuda bajó a ${report.violations.length} (max=${rule.max}). ` +
              `Baja el max en data/contract/arch-rules.json para que no vuelva a subir.`,
          );
        }
      });
    }
  }
});

describe("motor de reglas", () => {
  it("glob: ** cruza directorios y también casa con cero", () => {
    const re = globToRegExp("a/**/*.ts");
    assert.ok(re.test("a/b.ts"));
    assert.ok(re.test("a/b/c/d.ts"));
    assert.ok(!re.test("z/b.ts"));
  });

  it("glob: * no cruza el separador", () => {
    const re = globToRegExp("a/*.ts");
    assert.ok(re.test("a/b.ts"));
    assert.ok(!re.test("a/b/c.ts"));
  });

  it("glob: los metacaracteres de regex se escapan", () => {
    assert.ok(globToRegExp("a.b/c.ts").test("a.b/c.ts"));
    assert.ok(!globToRegExp("a.b/c.ts").test("axb/c.ts"));
  });

  it("detecta un import prohibido y da su línea", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["x/**/*.ts"],
          imports: { forbid: ["^three$"] },
        },
      ],
    });
    const found = checkArchitecture(cfg, [
      { path: "x/a.ts", text: "// three\nimport a from 'three';\n", imports: [{ spec: "three", line: 2 }] },
    ]);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  it("una excepción exime al fichero nombrado, no a sus vecinos", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        {
          id: "r",
          desc: "d",
          why: "w",
          severity: "error",
          files: ["x/**/*.ts"],
          imports: { forbid: ["^three$"] },
          exceptions: [{ path: "x/ok.ts", reason: "es el dueño del renderer" }],
        },
      ],
    });
    const files2: SourceFile[] = [
      { path: "x/ok.ts", text: "", imports: [{ spec: "three", line: 1 }] },
      { path: "x/no.ts", text: "", imports: [{ spec: "three", line: 1 }] },
    ];
    const found = checkArchitecture(cfg, files2);
    assert.deepEqual(
      found.map((v) => v.path),
      ["x/no.ts"],
    );
  });

  it("una excepción sin motivo no valida (fail-loud del propio contrato)", () => {
    assert.throws(() =>
      ArchConfigSchema.parse({
        scan: { roots: [{ dir: "x", ext: [".ts"] }] },
        rules: [
          {
            id: "r",
            desc: "d",
            why: "w",
            severity: "error",
            files: ["x/**/*.ts"],
            imports: { forbid: ["^three$"] },
            exceptions: [{ path: "x/ok.ts", reason: "" }],
          },
        ],
      }),
    );
  });

  it("una regla warn sin max no valida", () => {
    assert.throws(() =>
      ArchConfigSchema.parse({
        scan: { roots: [{ dir: "x", ext: [".ts"] }] },
        rules: [
          { id: "r", desc: "d", why: "w", severity: "warn", files: ["x/**"], text: { pattern: "a" } },
        ],
      }),
    );
  });

  it("la deuda que crece se marca excedida; la que baja, mejorable", () => {
    const cfg = ArchConfigSchema.parse({
      scan: { roots: [{ dir: "x", ext: [".ts"] }] },
      rules: [
        { id: "r", desc: "d", why: "w", severity: "warn", max: 1, files: ["x/**/*.ts"], text: { pattern: "mal" } },
      ],
    });
    const dos = checkArchitecture(cfg, [{ path: "x/a.ts", text: "mal\nmal\n" }]);
    assert.equal(reportByRule(cfg, dos)[0].budget, "excedido");
    const cero = checkArchitecture(cfg, [{ path: "x/a.ts", text: "bien\n" }]);
    assert.equal(reportByRule(cfg, cero)[0].budget, "mejorable");
  });
});
