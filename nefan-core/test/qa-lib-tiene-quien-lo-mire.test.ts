/** Totalidad del banco de pruebas (#357, T11): todo módulo de `qa/lib` tiene
 *  quien lo mire, o una exención escrita.
 *
 *  `qa/` es el instrumento con el que se aceptan las tandas, y hasta T11 no lo
 *  medía nadie más que su autor. La decisión (2026-09-05) tiene tres partes y
 *  esta es la segunda: (1) la dirección de dependencia es test → banco —lo
 *  canda `el-banco-no-entra-en-produccion` en arch-rules.json—; (2) cada
 *  `qa/lib/*.mjs` está IMPORTADO por algún `test/*.test.ts` o está en
 *  `data/contract/banco-medido.json` con su motivo; (3) el CI corre los
 *  candados headless de `qa/` (job `candados-headless`).
 *
 *  Es el mismo patrón que `sin_mutar` en `mutation-targets.json`: sin
 *  totalidad, un módulo nuevo del banco nace sin dueño y nadie lo echa de
 *  menos. Y como allí, la exención caduca sola: un exento que pase a estar
 *  importado es una entrada que miente, y se borra.
 *
 *  EL DETECTOR MIRA IMPORTS, NO MENCIONES. `esperas-de-qa.test.ts` cita
 *  `qa/lib/sonda.mjs` dentro de una traza de fixture (un string), y eso NO
 *  cuenta: contar menciones convertiría cualquier comentario en cobertura. Las
 *  tres formas que cuentan son las que existen en el árbol —
 *  `import(join(repoRoot, "qa", "lib", "x.mjs"))`, `from "…/qa/lib/x.mjs"` e
 *  `import("…/qa/lib/x.mjs")`— y el detector se prueba aparte con textos
 *  sintéticos, en las dos direcciones. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(core, "..");
const QA_LIB = join(repoRoot, "qa", "lib");
const TEST_DIR = join(core, "test");
const CONTRATO = join(core, "data", "contract", "banco-medido.json");

const BancoMedidoSchema = z
  .object({
    _comment: z.string().min(1),
    exentos: z
      .array(
        z
          .object({
            /** Ruta relativa a la raíz del repo, como la escribe `git`. */
            fichero: z.string().regex(/^qa\/lib\/[\w.-]+\.mjs$/, "una exención nombra un `qa/lib/*.mjs`"),
            /** Obligatorio: una exención sin motivo es una regla que ya no sirve. */
            porque: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type BancoMedido = z.infer<typeof BancoMedidoSchema>;

/** Nombres de fichero (`x.mjs`) de `qa/lib` que un test importa DE VERDAD.
 *
 *  Tres formas, y solo tres:
 *   · `import(join(<algo>, "qa", "lib", "x.mjs"))` — la del árbol, con o sin
 *     saltos de línea entre los paréntesis (`port-offset-paridad` parte la
 *     llamada en tres líneas);
 *   · `from "…/qa/lib/x.mjs"` — import estático con ruta relativa;
 *   · `import("…/qa/lib/x.mjs")` — import dinámico con literal.
 *  Una ruta que aparezca en cualquier otro sitio (una traza en un string, un
 *  comentario, un `join(repoRoot, "qa", "lib")` sin fichero) no cuenta. */
export function importsDeQaLib(textoDelTest: string): Set<string> {
  const vistos = new Set<string>();
  const formas = [
    /import\(\s*join\((?:[^()]*?,)?\s*"qa"\s*,\s*"lib"\s*,\s*"([\w.-]+\.mjs)"\s*\)\s*\)/g,
    /from\s+"[^"\n]*\/qa\/lib\/([\w.-]+\.mjs)"/g,
    /import\(\s*"[^"\n]*\/qa\/lib\/([\w.-]+\.mjs)"\s*\)/g,
  ];
  for (const re of formas) for (const m of textoDelTest.matchAll(re)) vistos.add(m[1]);
  return vistos;
}

const contrato: BancoMedido = BancoMedidoSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const modulos = readdirSync(QA_LIB)
  .filter((f) => f.endsWith(".mjs"))
  .sort();
const tests = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

/** módulo → tests que lo importan. */
const importadores = new Map<string, string[]>();
for (const t of tests) {
  for (const m of importsDeQaLib(readFileSync(join(TEST_DIR, t), "utf8"))) {
    importadores.set(m, [...(importadores.get(m) ?? []), t]);
  }
}
const exentos = new Map(contrato.exentos.map((e) => [e.fichero.slice("qa/lib/".length), e]));

describe("qa/lib tiene quien lo mire (#357)", () => {
  it("el árbol tiene sujeto: hay módulos en qa/lib y tests que importan alguno", () => {
    // Sin esto, un `qa/lib` vacío o un detector roto aprobarían sin mirar
    // nada: el peor de los verdes.
    assert.ok(modulos.length > 0, `no hay ningún .mjs en ${QA_LIB}`);
    assert.ok(
      importadores.size >= 2,
      `el detector solo ve ${importadores.size} módulo(s) importado(s) desde test/ — hoy son cuatro; ` +
        `si los tests se movieron, muévelo con ellos`,
    );
  });

  it("cada módulo de qa/lib está importado por algún test, o eximido con motivo", () => {
    const huerfanos = modulos.filter((m) => !importadores.has(m) && !exentos.has(m));
    assert.deepEqual(
      huerfanos,
      [],
      `qa/lib sin quien lo mire: ${huerfanos.join(", ")}. O un test de nefan-core/test/ lo importa ` +
        `(patrón: test/veredictos.test.ts), o entra en data/contract/banco-medido.json con su motivo.`,
    );
  });

  it("ninguna exención está caducada: un exento que ya se importa se borra del JSON", () => {
    const caducadas = [...exentos.keys()].filter((m) => importadores.has(m));
    assert.deepEqual(
      caducadas,
      [],
      caducadas
        .map((m) => `${m} está exento y lo importa ${(importadores.get(m) ?? []).join(", ")}: quita la exención`)
        .join("\n"),
    );
  });

  it("ninguna exención apunta a un fichero que ya no existe", () => {
    const muertas = contrato.exentos.filter((e) => !existsSync(join(repoRoot, e.fichero)));
    assert.deepEqual(
      muertas.map((e) => e.fichero),
      [],
      "una exención a un fichero borrado revive sola el día que alguien vuelva a crear esa ruta",
    );
  });

  it("una exención no puede ser un encogimiento de hombros", () => {
    // Mismo umbral que `sin_mutar` (mutation-config.test.ts): ocho palabras
    // no garantizan un motivo, pero sí impiden el «TODO» y el «difícil».
    for (const e of contrato.exentos) {
      assert.ok(
        e.porque.split(/\s+/).length >= 8,
        `banco-medido.json["${e.fichero}"]: "${e.porque}" no explica nada — di por qué NO se mide`,
      );
    }
  });

  it("qa/lib no entra en el perímetro de mutación: la dirección es test → banco", () => {
    // La decisión (1) de #357, la mitad que no cubre arch-rules: que nadie
    // meta el banco en `mutation-targets.json` «para medirlo». Se mide desde
    // los tests; el reloj de mutación ya rebosa el lote y son `.mjs` con
    // `node:*`, fuera de `core-puro-sin-node`.
    const plan = JSON.parse(readFileSync(join(core, "data", "contract", "mutation-targets.json"), "utf8")) as {
      modulos: { id: string; mutate: string[]; tests: string[] }[];
      sin_mutar: { fichero: string }[];
    };
    const enMutacion = plan.modulos.flatMap((m) => [...m.mutate, ...m.tests]).filter((f) => /(^|\/)qa\//.test(f));
    assert.deepEqual(enMutacion, [], "mutation-targets.json nombra qa/: el banco no se muta, se mide desde test/");
    assert.deepEqual(
      plan.sin_mutar.map((e) => e.fichero).filter((f) => /(^|\/)qa\//.test(f)),
      [],
      "qa/ no necesita exención en sin_mutar: nunca estuvo en el perímetro",
    );
  });
});

describe("el detector de imports de qa/lib", () => {
  it("cuenta las tres formas de importar, también partidas en varias líneas", () => {
    const texto = [
      'const mod = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as X;',
      "const { offsetActual } = (await import(",
      '  join(repoRoot, "qa", "lib", "stack.mjs")',
      ")) as Y;",
      'import { VERDE } from "../../qa/lib/veredictos.mjs";',
      'const c = await import("../../qa/lib/presets-clasifica.mjs");',
    ].join("\n");
    assert.deepEqual(
      [...importsDeQaLib(texto)].sort(),
      ["esperas.mjs", "presets-clasifica.mjs", "stack.mjs", "veredictos.mjs"],
    );
  });

  it("NO cuenta una mención en un string, un comentario ni un join sin fichero", () => {
    // La traza de fixture de `esperas-de-qa.test.ts:196`, tal cual, y las
    // otras formas de NOMBRAR el banco sin importarlo. Si esto contara, la
    // totalidad se cumpliría escribiendo el nombre en un comentario.
    const texto = [
      '  "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:64:13)",',
      '  "    at acercarse (/home/al/code/ne-fan/qa/lib/combate.mjs:40:5)",',
      "// el sujeto es `qa/lib/saves.mjs`, que se prueba en otro sitio",
      'const dirs = [join(repoRoot, "qa", "guiones"), join(repoRoot, "qa", "lib")];',
      'const ruta = join(repoRoot, "qa", "lib", "navegador.mjs"); // sin import(...)',
      'const s = "qa/lib/fixtures.mjs";',
    ].join("\n");
    assert.deepEqual([...importsDeQaLib(texto)], []);
  });
});
