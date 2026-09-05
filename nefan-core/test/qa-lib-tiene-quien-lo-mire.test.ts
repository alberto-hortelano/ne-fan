/** Totalidad del banco de pruebas (#357, T11): todo módulo de `qa/lib` tiene
 *  quien lo mire, o una exención escrita.
 *
 *  `qa/` es el instrumento con el que se aceptan las tandas, y hasta T11 no lo
 *  medía nadie más que su autor. La decisión (2026-09-05) tiene tres partes y
 *  esta es la segunda: (1) la dirección de dependencia es test → banco —lo
 *  candan `el-banco-no-entra-en-produccion` y su hermana `…-ni-por-join` en
 *  arch-rules.json—; (2) cada `qa/lib/*.mjs` está IMPORTADO por algún
 *  `test/*.test.ts` o está en `data/contract/banco-medido.json` con su motivo;
 *  (3) el CI corre los candados headless de `qa/` (job `candados-headless`).
 *
 *  Es el mismo patrón que `sin_mutar` en `mutation-targets.json`: sin
 *  totalidad, un módulo nuevo del banco nace sin dueño y nadie lo echa de
 *  menos. Y como allí, la exención caduca sola: un exento que pase a estar
 *  importado es una entrada que miente, y se borra.
 *
 *  EL DETECTOR LEE EL ÁRBOL DE SINTAXIS, NO EL TEXTO. La primera versión era
 *  un puñado de regex sobre el fuente, y QA (#454, H1) demostró lo que eso
 *  vale: sus propias fixtures —y las de `architecture.test.ts`, que enseñan a
 *  una regla la forma `import(join(…, "qa", "lib", …))` dentro de un string—
 *  contaban como imports reales, así que borrar los tres tests de `esperas`,
 *  `presets-clasifica` y `veredictos` dejaba la totalidad 8/8 en verde. El
 *  verde que no comprueba, en el test escrito para impedirlo. Ahora se parsea
 *  con `typescript` y solo cuentan los NODOS de import: una declaración
 *  `import … from`, un `import(…)` o un `require(…)` cuyo argumento es un
 *  literal o un `join`/`resolve` con `"qa", "lib", "x.mjs"` como segmentos.
 *  Un string que contenga esas mismas letras es un string. El negativo que QA
 *  hizo a mano (sin `veredictos.test.ts`, `veredictos.mjs` queda huérfano) vive
 *  abajo como test permanente. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
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

const MODULO_DEL_BANCO = /^[\w.-]+\.mjs$/;

/** Nombres de fichero (`x.mjs`) de `qa/lib` que un test importa DE VERDAD,
 *  leídos del AST: declaraciones `import`, `import()` y `require()` con literal
 *  (`…/qa/lib/x.mjs`) o con `join`/`resolve` cuyos segmentos literales llevan
 *  `"qa", "lib", "x.mjs"` seguidos. Lo que va dentro de un string, de un
 *  comentario o de un `join` que no es argumento de import no es un import. */
export function importsDeQaLib(textoDelTest: string): Set<string> {
  const vistos = new Set<string>();
  const porRuta = (ruta: string): void => {
    const m = /(?:^|\/)qa\/lib\/([\w.-]+\.mjs)$/.exec(ruta);
    if (m) vistos.add(m[1]);
  };
  const porSegmentos = (llamada: ts.CallExpression): void => {
    if (!ts.isIdentifier(llamada.expression) || !["join", "resolve"].includes(llamada.expression.text)) return;
    const segs = llamada.arguments.map((a) => (ts.isStringLiteralLike(a) ? a.text : null));
    for (let i = 0; i + 2 < segs.length; i++) {
      const fichero = segs[i + 2];
      if (segs[i] === "qa" && segs[i + 1] === "lib" && fichero !== null && MODULO_DEL_BANCO.test(fichero)) {
        vistos.add(fichero);
      }
    }
  };
  const visita = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      porRuta(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const esImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      const arg = n.arguments[0];
      if ((esImport || esRequire) && arg) {
        if (ts.isStringLiteralLike(arg)) porRuta(arg.text);
        else if (ts.isCallExpression(arg)) porSegmentos(arg);
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(ts.createSourceFile("test.ts", textoDelTest, ts.ScriptTarget.Latest, true));
  return vistos;
}

/** módulo → tests (nombres de fichero) que lo importan, sobre los tests dados. */
export function importadoresEn(dirTests: string, tests: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tests) {
    for (const m of importsDeQaLib(readFileSync(join(dirTests, t), "utf8"))) {
      out.set(m, [...(out.get(m) ?? []), t]);
    }
  }
  return out;
}

/** Los módulos que ni se importan ni están eximidos. */
export function huerfanosDe(
  modulos: readonly string[],
  importadores: ReadonlyMap<string, string[]>,
  exentos: ReadonlySet<string>,
): string[] {
  return modulos.filter((m) => !importadores.has(m) && !exentos.has(m));
}

const contrato: BancoMedido = BancoMedidoSchema.parse(JSON.parse(readFileSync(CONTRATO, "utf8")));
const modulos = readdirSync(QA_LIB)
  .filter((f) => f.endsWith(".mjs"))
  .sort();
const tests = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

const importadores = importadoresEn(TEST_DIR, tests);
const exentos = new Map(contrato.exentos.map((e) => [e.fichero.slice("qa/lib/".length), e]));
const nombresExentos = new Set(exentos.keys());

describe("qa/lib tiene quien lo mire (#357)", () => {
  it("el árbol tiene sujeto: hay módulos en qa/lib y tests que importan alguno", () => {
    // Sin esto, un `qa/lib` vacío o un detector roto aprobarían sin mirar
    // nada: el peor de los verdes.
    assert.ok(modulos.length > 0, `no hay ningún .mjs en ${QA_LIB}`);
    assert.ok(
      importadores.size >= 2,
      `el detector solo ve ${importadores.size} módulo(s) importado(s) desde test/ — hoy son cinco; ` +
        `si los tests se movieron, muévelo con ellos`,
    );
  });

  it("cada módulo de qa/lib está importado por algún test, o eximido con motivo", () => {
    const huerfanos = huerfanosDe(modulos, importadores, nombresExentos);
    assert.deepEqual(
      huerfanos,
      [],
      `qa/lib sin quien lo mire: ${huerfanos.join(", ")}. O un test de nefan-core/test/ lo importa ` +
        `(patrón: test/veredictos.test.ts), o entra en data/contract/banco-medido.json con su motivo.`,
    );
  });

  it("el verde depende del test REAL: sin veredictos.test.ts, veredictos.mjs queda huérfano", () => {
    // Lo que QA (#454) hizo a mano moviendo el fichero fuera de test/, sin
    // mover nada: el mismo barrido sobre la lista de tests menos uno. Con el
    // detector textual esto salía verde, porque otros tests NOMBRAN el módulo.
    const sinVeredictos = tests.filter((t) => t !== "veredictos.test.ts");
    assert.equal(sinVeredictos.length, tests.length - 1, "veredictos.test.ts ya no existe: elige otro test real");
    assert.deepEqual(
      huerfanosDe(modulos, importadoresEn(TEST_DIR, sinVeredictos), nombresExentos),
      ["veredictos.mjs"],
      "quitar el test real de veredictos.mjs tiene que dejarlo huérfano, y solo a él",
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
  it("cuenta las cuatro formas de importar, también partidas en varias líneas", () => {
    const texto = [
      'const mod = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as X;',
      "const { offsetActual } = (await import(",
      '  join(repoRoot, "qa", "lib", "stack.mjs")',
      ")) as Y;",
      'import { VERDE } from "../../qa/lib/veredictos.mjs";',
      'const c = await import("../../qa/lib/presets-clasifica.mjs");',
      'const r = require(resolve(raiz, "..", "qa", "lib", "python.mjs"));',
    ].join("\n");
    assert.deepEqual(
      [...importsDeQaLib(texto)].sort(),
      ["esperas.mjs", "presets-clasifica.mjs", "python.mjs", "stack.mjs", "veredictos.mjs"],
    );
  });

  it("NO cuenta un import escrito DENTRO de un string: la fixture de un test no es un import", () => {
    // Exactamente lo que H1 de QA (#454) encontró: las fixtures de este mismo
    // test y las de `architecture.test.ts` tienen la forma de un import, y
    // estaban contando. Para el AST son literales.
    const texto = [
      'const fixture = \'const m = await import(join(process.cwd(), "..", "qa", "lib", "stack.mjs"));\';',
      "const otra = `import { VERDE } from \"../../qa/lib/veredictos.mjs\";`;",
      '{ path: "nefan-html/src/x.ts", text: \'await import("../../qa/lib/sonda.mjs");\', imports: [] },',
    ].join("\n");
    assert.deepEqual([...importsDeQaLib(texto)], []);
  });

  it("NO cuenta una mención en un string de traza, un comentario ni un join sin import", () => {
    // La traza de fixture de `esperas-de-qa.test.ts`, tal cual, y las otras
    // formas de NOMBRAR el banco sin importarlo. Si esto contara, la totalidad
    // se cumpliría escribiendo el nombre en un comentario.
    const texto = [
      '  "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:64:13)",',
      '  "    at acercarse (/home/al/code/ne-fan/qa/lib/combate.mjs:40:5)",',
      "// el sujeto es `qa/lib/saves.mjs`, que se prueba en otro sitio",
      'const dirs = [join(repoRoot, "qa", "guiones"), join(repoRoot, "qa", "lib")];',
      'const ruta = join(repoRoot, "qa", "lib", "navegador.mjs"); // sin import(...)',
      'const s = "qa/lib/fixtures.mjs";',
      'const otro = await import(join(repoRoot, "qa", "guiones", "01.mjs"));',
    ].join("\n");
    assert.deepEqual([...importsDeQaLib(texto)], []);
  });
});
